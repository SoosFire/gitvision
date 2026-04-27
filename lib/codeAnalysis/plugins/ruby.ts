// Ruby plugin — sixth migration off the regex-fallback (v0.23). The first
// fully-dynamic language we cover.
//
// The Phase 5 architecture (containerType + calleeType + pickCallTarget)
// holds, but type info comes from a different place than Java/C#/PHP:
// Ruby has no static type annotations, so we infer types only from
// CONSTRUCTOR INITIALIZERS — the `Klass.new` pattern. This is similar to
// JS's `new Foo()` initializer inference (v0.17) and Python's `x =
// SomeClass()` pattern (v0.18). Untyped variables fall through to
// pickCallTarget's name-fallback path; same-file and imported-file
// disambiguation handle the rest.
//
// Other Ruby quirks worth knowing about:
//
//   1. Imports are FILE PATHS, not FQNs:
//        require 'logger'           — searches load path
//        require_relative 'helpers' — relative to current file
//      We resolve these in parseDirect (not resolveImport) because the
//      resolution is path-based, not FQN-based. resolveImport only
//      handles class-name specs from `class X < Parent` extends edges.
//
//   2. Constructor calls go through `Klass.new` which dispatches to the
//      class's `initialize` method. We rewrite calleeName="initialize"
//      when the receiver is a constant — that's where the actual
//      constructor body lives in our function index.
//
//   3. `class X` and `module X` both name-scope their bodies. Methods
//      defined inside are owned by the innermost container — so
//      containerType correctly tracks the X in `class X; def y; end; end`.
//
//   4. `def self.method` is `singleton_method` (a class-level method),
//      structurally distinct from regular `method`. Both emit
//      ParsedFunction with containerType = current class.
//
//   5. Modifier forms — `expr if cond`, `expr unless cond`, `expr while
//      cond`, `expr until cond` — are separate node types
//      (`if_modifier`, etc.) and each counts as a decision point.
//
//   6. Bare identifiers are AMBIGUOUS in Ruby (could be local variable
//      OR method call to a self method). We only emit calls for explicit
//      `call` AST nodes — `helper()` (with parens) is a call,
//      `helper` (without) parses as `identifier` and stays unresolved.

import path from "node:path";
import { Parser } from "web-tree-sitter";
import type { Language, Node as TsNode } from "web-tree-sitter";
import type {
  CodeAnalysisPlugin,
  FileIndex,
  ParsedCall,
  ParsedFile,
  ParsedFunction,
  ParsedImport,
  PluginQueries,
  SourceFile,
} from "../types";
import { loadBuiltinGrammar } from "../runtime";

const PLUGIN_NAME = "ruby";
const EXTENSIONS = ["rb"] as const;

let lang: Language | null = null;

// ------------------- Module-level resolver context -------------------

interface RubyResolverContext {
  /** FQN ("App::Services::UserService") → repo-rel path. Built from class
   *  + module declarations via regex. Note "::" separator (Ruby's). */
  fqnToPath: Map<string, string>;
  /** Bare class name → repo-rel path. Used when `class X < Parent` has
   *  Parent unqualified — we look up just the class name. First-wins;
   *  for ambiguous names (rare in Ruby due to module nesting) the
   *  alphabetically-first file is picked. */
  byBareName: Map<string, string>;
}

/** Common load-path prefixes for `require` resolution. We search files
 *  matching `<prefix><spec>.rb` for each entry. The empty prefix catches
 *  root-level files; lib/ + src/ + app/ cover most Ruby project layouts.
 *  Kept as a module constant (not on the resolver context) so resolveRequire
 *  works even when prepareForRepo hasn't been called — useful for tests
 *  that exercise parseDirect directly. */
const LOAD_PATH_PREFIXES = ["lib/", "src/", "app/", ""] as const;

// Top-level class/module declarations. Conservative: we don't try to
// reconstruct nesting via regex (block syntax is hard to track without
// AST). The plugin's parseDirect will get nesting right via the AST when
// we walk the file; prepareForRepo just needs to know which files contain
// which top-level types so resolveImport can find them.
const TYPE_DECL_RE =
  /(?:^|\n)\s*(?:class|module)\s+([A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*)/g;

// ------------------- Index construction -------------------

function buildRubyContext(ix: FileIndex): RubyResolverContext {
  const fqnToPath = new Map<string, string>();
  const byBareName = new Map<string, string>();

  for (const f of ix.byPath.values()) {
    if (f.ext !== "rb") continue;
    TYPE_DECL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TYPE_DECL_RE.exec(f.content)) !== null) {
      const name = m[1];
      if (!fqnToPath.has(name)) fqnToPath.set(name, f.rel);
      // Also index just the bare last segment so unqualified references
      // like `class X < Parent` can find Parent regardless of whether
      // it's actually `App::Parent` or just `Parent`.
      const bare = name.includes("::")
        ? name.slice(name.lastIndexOf("::") + 2)
        : name;
      if (!byBareName.has(bare)) byBareName.set(bare, f.rel);
    }
    TYPE_DECL_RE.lastIndex = 0;
  }

  return { fqnToPath, byBareName };
}

// ------------------- Import resolution (FQN-style) -------------------

function resolveRubyImport(
  spec: string,
  _fromPath: string,
  ix: FileIndex
): string | null {
  // This handles class-name specs from `class X < Parent` extends edges.
  // require / require_relative are resolved inline in parseDirect because
  // their resolution is path-based, not FQN-based.
  const ctx = ix.extras.get(PLUGIN_NAME) as RubyResolverContext | undefined;
  if (!ctx) return null;
  const direct = ctx.fqnToPath.get(spec);
  if (direct) return direct;
  // Bare-name fallback for unqualified references
  const bare = spec.includes("::")
    ? spec.slice(spec.lastIndexOf("::") + 2)
    : spec;
  return ctx.byBareName.get(bare) ?? null;
}

/** Resolve `require_relative 'foo'` against the from-file's directory. */
function resolveRequireRelative(
  spec: string,
  fromPath: string,
  ix: FileIndex
): string | null {
  const dir = path.posix.dirname(fromPath);
  const candidate = path.posix.normalize(
    path.posix.join(dir, spec.endsWith(".rb") ? spec : `${spec}.rb`)
  );
  return ix.byPath.has(candidate) ? candidate : null;
}

/** Resolve `require 'foo/bar'` by searching common Ruby load-path
 *  prefixes (lib/, src/, app/, repo root). Path-only — no FQN context
 *  needed. */
function resolveRequire(spec: string, ix: FileIndex): string | null {
  const cleaned = spec.endsWith(".rb") ? spec.slice(0, -3) : spec;
  for (const prefix of LOAD_PATH_PREFIXES) {
    const target = `${prefix}${cleaned}.rb`;
    if (ix.byPath.has(target)) return target;
  }
  return null;
}

// ------------------- Tree-sitter queries (kept for reference) -------------------

const QUERIES: PluginQueries = {
  imports: `
    (call method: (identifier) @callee
      (#match? @callee "^(require|require_relative)$"))
  `,
  functionDefs: `
    (method name: (identifier) @name body: (body_statement) @body)
    (singleton_method name: (identifier) @name body: (body_statement) @body)
  `,
  callSites: `(call method: (identifier) @callee)`,
  decisionPoints: `
    (if) @p
    (elsif) @p
    (unless) @p
    (while) @p
    (until) @p
    (for) @p
    (when) @p
    (rescue) @p
    (conditional) @p
    (if_modifier) @p
    (unless_modifier) @p
    (while_modifier) @p
    (until_modifier) @p
  `,
};

// ------------------- Type extraction helpers -------------------

/** Extract a class name from a constant or scope_resolution receiver.
 *  `Foo` → "Foo"; `Foo::Bar` → "Bar" (last segment, matching our index
 *  convention). */
function extractConstantName(node: TsNode): string | null {
  if (node.type === "constant") return node.text;
  if (node.type === "scope_resolution") {
    const parts = node.text.split("::");
    return parts[parts.length - 1] ?? null;
  }
  return null;
}

/** Try to infer the class type of an `x = SomeClass.new` assignment.
 *  Returns the class name or null. Mirror of JS/Python's similar logic. */
function inferAssignmentType(rhs: TsNode): string | null {
  // RHS shape for `SomeClass.new`: a call node with receiver=constant
  // and method=identifier "new".
  if (rhs.type !== "call") return null;
  const method = rhs.childForFieldName("method")?.text;
  if (method !== "new") return null;
  const receiver = rhs.childForFieldName("receiver");
  if (!receiver) return null;
  return extractConstantName(receiver);
}

// ------------------- parseDirect: AST walk with type tracking -------------------

interface MethodScope {
  name: string;
  /** Local + instance variable types, keyed by name (without @ prefix for
   *  instance vars — same convention as PHP's bareVariableName). */
  locals: Map<string, string>;
  decisionPoints: number;
}

interface ClassScope {
  name: string;
  /** Instance variable types tracked from `@x = SomeClass.new` patterns
   *  inside any method of this class. Persists across methods because
   *  Ruby instance vars are class-level state. */
  instanceVars: Map<string, string>;
}

function parseRubyDirect(file: SourceFile, ix: FileIndex): ParsedFile {
  if (!lang) {
    throw new Error("ruby plugin not loaded — call plugin.load() first");
  }
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(file.content);
  if (!tree) {
    parser.delete();
    return errorParsedFile(file);
  }

  const imports: ParsedImport[] = [];
  const functions: ParsedFunction[] = [];
  const calls: ParsedCall[] = [];
  let totalDecisionPoints = 0;

  const seenImportSpecs = new Set<string>();
  const classStack: ClassScope[] = [];
  const methodStack: MethodScope[] = [];

  function currentClass(): ClassScope | null {
    return classStack[classStack.length - 1] ?? null;
  }
  function currentMethod(): MethodScope | null {
    return methodStack[methodStack.length - 1] ?? null;
  }

  function lookupVariableType(name: string): string | null {
    // Local scope first (innermost method)
    for (let i = methodStack.length - 1; i >= 0; i--) {
      const t = methodStack[i].locals.get(name);
      if (t) return t;
    }
    // Then class instance vars
    const cls = currentClass();
    if (cls) {
      const t = cls.instanceVars.get(name);
      if (t) return t;
    }
    return null;
  }

  function countDecisionPoint() {
    totalDecisionPoints++;
    const m = currentMethod();
    if (m) m.decisionPoints++;
  }

  /** Resolve calleeType from a call's receiver. Handles:
   *   - self → current class
   *   - constant → that class name (static call)
   *   - scope_resolution → last segment
   *   - instance_variable / identifier → tracked type from scope */
  function resolveCallType(receiver: TsNode | null): string | undefined {
    const cls = currentClass();
    if (!receiver) return undefined; // bare call
    switch (receiver.type) {
      case "self":
        return cls?.name ?? undefined;
      case "constant":
        return receiver.text;
      case "scope_resolution":
        return extractConstantName(receiver) ?? undefined;
      case "instance_variable": {
        // @foo — strip the @ and look up
        const name = receiver.text.startsWith("@")
          ? receiver.text.slice(1)
          : receiver.text;
        return lookupVariableType(name) ?? undefined;
      }
      case "identifier": {
        // Local variable (or implicit-self method call — ambiguous in Ruby)
        return lookupVariableType(receiver.text) ?? undefined;
      }
      // Chained calls / parenthesized / etc. — out of scope for v1
      default:
        return undefined;
    }
  }

  function visit(node: TsNode) {
    switch (node.type) {
      case "call": {
        const methodName = node.childForFieldName("method")?.text;
        const receiver = node.childForFieldName("receiver");

        // Special case: require / require_relative as imports. These are
        // bare calls (no receiver) where the method name is one of those
        // identifiers and the first argument is a string literal.
        if (
          !receiver &&
          (methodName === "require" || methodName === "require_relative")
        ) {
          const args = node.childForFieldName("arguments");
          if (args) {
            for (const a of args.namedChildren) {
              // string literal — find string_content child
              if (a.type === "string") {
                let spec: string | null = null;
                for (const sc of a.namedChildren) {
                  if (sc.type === "string_content") {
                    spec = sc.text;
                    break;
                  }
                }
                if (spec && !seenImportSpecs.has(spec)) {
                  seenImportSpecs.add(spec);
                  const resolvedPath =
                    methodName === "require_relative"
                      ? resolveRequireRelative(spec, file.rel, ix)
                      : resolveRequire(spec, ix);
                  imports.push({ rawSpec: spec, resolvedPath });
                }
              }
            }
          }
          return; // require calls aren't tracked as method calls
        }

        // Special case: `.new` is Ruby's universal constructor invocation.
        // We rewrite to `initialize` so the call matches the actual
        // constructor body in our function index, and set calleeType to
        // the class being instantiated.
        //
        // Three receiver shapes worth distinguishing:
        //   1. Constant / scope_resolution receiver (`Foo.new` /
        //      `Foo::Bar.new`) — class is statically known.
        //   2. No receiver (bare `new(...)`), inside a class — implicit
        //      `self.new`, so the class is the enclosing class.
        //   3. Variable / method-chain receiver (`klass.new`,
        //      `factory.build.new`) — we can't determine which class's
        //      constructor is invoked. Skip the emit; emitting a generic
        //      `.new` edge has historically caused spurious resolutions to
        //      whatever `def new` exists in the codebase (discovered during
        //      v0.23 rspec-core validation: 109 bogus lib->spec edges going
        //      to spec_helper.rb's `new`).
        if (methodName === "new") {
          const cls = currentClass();
          if (receiver) {
            const className = extractConstantName(receiver);
            if (className) {
              calls.push({
                calleeName: "initialize",
                inFunction: currentMethod()?.name ?? null,
                calleeType: className,
                hasReceiver: true,
              });
            }
            // Non-constant receiver (variable / chain): skip emit
          } else if (cls) {
            // Bare `new(...)` inside a class body / method: implicit self
            calls.push({
              calleeName: "initialize",
              inFunction: currentMethod()?.name ?? null,
              calleeType: cls.name,
              hasReceiver: true,
            });
          }
          // Walk arguments either way for nested calls/decisions
          for (const child of node.namedChildren) visit(child);
          return;
        }

        // Regular method call. hasReceiver = receiver field present in
        // the AST (object.method, Foo.method, self.method). Drives
        // pickCallTarget's strict resolution: receiver-but-untyped calls
        // refuse single-candidate match to avoid spurious matches against
        // unrelated `def method` definitions in test fixtures.
        if (methodName) {
          calls.push({
            calleeName: methodName,
            inFunction: currentMethod()?.name ?? null,
            calleeType: resolveCallType(receiver),
            hasReceiver: receiver !== null,
          });
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "class": {
        const nameNode = node.childForFieldName("name");
        const className = nameNode?.text ?? "<anon>";
        // extends edge from `class X < Parent`. Parent might be a constant
        // or a scope_resolution.
        for (const child of node.namedChildren) {
          if (child.type === "superclass") {
            for (const sub of child.namedChildren) {
              if (sub.type === "constant" || sub.type === "scope_resolution") {
                imports.push({
                  rawSpec: sub.text,
                  resolvedPath: resolveRubyImport(sub.text, file.rel, ix),
                  kind: "extends",
                });
              }
            }
          }
        }
        classStack.push({
          name: className,
          instanceVars: new Map(),
        });
        const bodyNode = node.childForFieldName("body");
        if (bodyNode) {
          for (const child of bodyNode.namedChildren) visit(child);
        }
        classStack.pop();
        return;
      }

      case "module": {
        const nameNode = node.childForFieldName("name");
        const moduleName = nameNode?.text ?? "<anon>";
        // Modules can contain methods too (module functions). Treat the
        // module as a container scope with no instance vars.
        classStack.push({ name: moduleName, instanceVars: new Map() });
        const bodyNode = node.childForFieldName("body");
        if (bodyNode) {
          for (const child of bodyNode.namedChildren) visit(child);
        }
        classStack.pop();
        return;
      }

      case "method":
      case "singleton_method": {
        const nameNode = node.childForFieldName("name");
        const fnName = nameNode?.text ?? "<anon>";
        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        // Ruby has no parameter types, so locals starts empty
        methodStack.push({ name: fnName, locals: new Map(), decisionPoints: 0 });
        const body = node.childForFieldName("body");
        if (body) {
          for (const child of body.namedChildren) visit(child);
        }
        const ms = methodStack.pop()!;
        functions.push({
          name: fnName,
          startRow,
          endRow,
          complexity: 1 + ms.decisionPoints,
          containerType: currentClass()?.name,
        });
        return;
      }

      case "assignment": {
        // Track `x = SomeClass.new` and `@x = SomeClass.new` patterns to
        // populate scope variables for type-aware call resolution.
        const left = node.childForFieldName("left");
        const right = node.childForFieldName("right");
        if (left && right) {
          const inferred = inferAssignmentType(right);
          if (inferred) {
            if (left.type === "identifier") {
              // Local variable
              const m = currentMethod();
              if (m) m.locals.set(left.text, inferred);
            } else if (left.type === "instance_variable") {
              // @foo — store on class scope so other methods can see it
              const cls = currentClass();
              if (cls) {
                const name = left.text.startsWith("@")
                  ? left.text.slice(1)
                  : left.text;
                cls.instanceVars.set(name, inferred);
              }
            }
          }
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "if":
      case "elsif":
      case "unless":
      case "while":
      case "until":
      case "for":
      case "when":
      case "rescue":
      case "conditional":
      case "if_modifier":
      case "unless_modifier":
      case "while_modifier":
      case "until_modifier":
        countDecisionPoint();
        for (const child of node.namedChildren) visit(child);
        return;

      case "binary": {
        // Ruby's binary node doesn't expose operator as a field — text
        // match between left and right is the simplest reliable check.
        // The grammar is left-associative so `a && b || c` parses as
        // binary(binary(a,b), c) with one operator per node.
        const text = node.text;
        if (/\s(?:&&|\|\|)\s/.test(text) || /\s(?:and|or)\s/.test(text)) {
          countDecisionPoint();
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      default:
        for (const child of node.namedChildren) visit(child);
    }
  }

  visit(tree.rootNode);

  tree.delete();
  parser.delete();

  return {
    rel: file.rel,
    imports,
    functions,
    calls,
    fileComplexity: 1 + totalDecisionPoints,
    parseError: false,
  };
}

function errorParsedFile(file: SourceFile): ParsedFile {
  return {
    rel: file.rel,
    imports: [],
    functions: [],
    calls: [],
    fileComplexity: 1,
    parseError: true,
  };
}

// ------------------- Plugin -------------------

export const rubyPlugin = {
  name: PLUGIN_NAME,
  extensions: EXTENSIONS,

  async load() {
    if (lang) return;
    lang = await loadBuiltinGrammar("tree-sitter-ruby");
  },

  async prepareForRepo(_root: string, ix: FileIndex) {
    ix.extras.set(PLUGIN_NAME, buildRubyContext(ix));
  },

  languageFor(_ext) {
    if (!lang) {
      throw new Error(
        `ruby plugin not loaded — call plugin.load() before languageFor()`
      );
    }
    return lang;
  },

  queriesFor(_ext): PluginQueries {
    return QUERIES;
  },

  parseDirect: parseRubyDirect,

  resolveImport: resolveRubyImport,
} satisfies CodeAnalysisPlugin;
