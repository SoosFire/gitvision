// C# plugin — fourth migration off the regex-fallback (v0.21).
//
// Same shape as the Java plugin (Phase 5 type-aware via parseDirect): tracks
// field/property/parameter/local types in scope, infers calleeType for
// `obj.method()` calls. C#'s namespace + class system maps neatly onto
// Java's package + class FQN model — the indexing strategy is identical,
// just with C# node names.
//
// Differences from java.ts worth noting:
//   1. Calls go through invocation_expression with a `function` field. The
//      function can be an `identifier` (bare call) or a
//      `member_access_expression` (obj.method() / this.method()). Java's
//      method_invocation exposes name + object directly; C# wraps the
//      receiver inside member_access_expression.
//   2. Properties (`property_declaration`) are tracked alongside fields. C#
//      idiomatically uses properties for state, and `public Foo MyField`
//      is rare — skipping properties would lose most type info.
//   3. C# allows multiple namespace declarations per file plus file-scoped
//      `namespace X.Y;`. The FQN-builder takes the FIRST namespace it sees
//      via regex (covers 95% of real-world files). Nested namespaces +
//      multi-namespace files lose some precision; acceptable for v1.
//   4. `var` keyword + `new Foo()` initializer triggers type inference for
//      locals (analog to JS plugin's untyped-const-with-new pattern).
//   5. Generic types: `List<Foo>` is `generic_name` in C# (Java calls it
//      `generic_type`). Stripping returns the base type for FQN lookup —
//      same convention as Java.

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

const PLUGIN_NAME = "csharp";
const EXTENSIONS = ["cs"] as const;

let lang: Language | null = null;

// ------------------- Module-level resolver context -------------------

interface CSharpResolverContext {
  /** FQN ("App.Services.UserService") → repo-rel path. Built from namespace
   *  declarations + class names found via regex in prepareForRepo. */
  fqnToPath: Map<string, string>;
  /** Namespace ("App.Services") → repo-rel paths in that namespace. Used to
   *  resolve wildcard `using App.Services;` imports (where the spec is just
   *  the namespace name and we need to map it to *some* file in that
   *  namespace). */
  namespaceMembers: Map<string, string[]>;
}

// First namespace declaration in the file. Handles both block form
// (`namespace X.Y { ... }`) and file-scoped form (`namespace X.Y;`).
// Multi-namespace files lose precision — we only index types in the first
// namespace. Acceptable trade-off; rare in practice.
const NAMESPACE_RE = /^\s*namespace\s+([A-Za-z_][A-Za-z0-9_.]*)\s*[;{]/m;

// Top-level class/interface/struct/record/enum names. Conservative: only
// matches declarations at column 0 or with leading whitespace (typical
// nesting). Multi-line modifier chains (`public sealed class`) are handled
// via the optional non-capturing modifier prefix.
const TYPE_DECL_RE =
  /(?:^|\n)\s*(?:(?:public|internal|private|protected|abstract|sealed|static|partial|new|unsafe|readonly|ref|virtual|override)\s+)*(?:class|interface|struct|record|enum)\s+([A-Z][A-Za-z0-9_]*)/g;

// ------------------- Index construction -------------------

function buildCSharpContext(ix: FileIndex): CSharpResolverContext {
  const fqnToPath = new Map<string, string>();
  const namespaceMembers = new Map<string, string[]>();

  for (const f of ix.byPath.values()) {
    if (f.ext !== "cs") continue;
    const head = f.content.slice(0, 8192);
    const nsMatch = NAMESPACE_RE.exec(head);
    const ns = nsMatch?.[1] ?? null;
    // Reset regex state — TYPE_DECL_RE is global and stateful
    TYPE_DECL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TYPE_DECL_RE.exec(f.content)) !== null) {
      const typeName = m[1];
      const fqn = ns ? `${ns}.${typeName}` : typeName;
      // First-write-wins: if the same FQN appears twice, keep the first file
      // (rare — typically partial classes split across files; we treat one
      // representative file as canonical for resolution).
      if (!fqnToPath.has(fqn)) fqnToPath.set(fqn, f.rel);
      // Also index bare class name for default-namespace files
      if (!ns && !fqnToPath.has(typeName)) fqnToPath.set(typeName, f.rel);
      if (ns) {
        let members = namespaceMembers.get(ns);
        if (!members) {
          members = [];
          namespaceMembers.set(ns, members);
        }
        if (!members.includes(f.rel)) members.push(f.rel);
      }
    }
    TYPE_DECL_RE.lastIndex = 0;
    // Defensive fallback: if a file has a namespace but no detectable type
    // declaration (rare — empty file, file with only `using`s), still tie it
    // to the namespace so namespaceMembers stays meaningful.
    if (ns && !path.posix.basename(f.rel).startsWith("Assembly")) {
      let members = namespaceMembers.get(ns);
      if (!members) {
        members = [];
        namespaceMembers.set(ns, members);
      }
      if (!members.includes(f.rel)) members.push(f.rel);
    }
  }

  for (const arr of namespaceMembers.values()) arr.sort();

  return { fqnToPath, namespaceMembers };
}

// ------------------- Import resolution -------------------

function resolveCSharpImport(
  spec: string,
  _fromPath: string,
  ix: FileIndex
): string | null {
  const ctx = ix.extras.get(PLUGIN_NAME) as CSharpResolverContext | undefined;
  if (!ctx) return null;
  // `using X.Y.SomeType;` direct match
  const direct = ctx.fqnToPath.get(spec);
  if (direct) return direct;
  // `using X.Y;` namespace-only match (no wildcard syntax in C#, but plain
  // `using <namespace>` is the equivalent)
  const members = ctx.namespaceMembers.get(spec);
  if (members && members.length > 0) return members[0];
  return null;
}

// ------------------- Tree-sitter queries (kept for reference) -------------------

const QUERIES: PluginQueries = {
  imports: `(using_directive (identifier) @spec)
            (using_directive (qualified_name) @spec)`,
  functionDefs: `
    (method_declaration name: (identifier) @name body: (block) @body)
    (constructor_declaration name: (identifier) @name body: (block) @body)
  `,
  callSites: `
    (invocation_expression function: (identifier) @callee)
    (invocation_expression function: (member_access_expression name: (identifier) @callee))
    (object_creation_expression type: (identifier) @callee)
  `,
  decisionPoints: `
    (if_statement) @p
    (while_statement) @p
    (for_statement) @p
    (for_each_statement) @p
    (do_statement) @p
    (catch_clause) @p
    (conditional_expression) @p
    (switch_section) @p
    (binary_expression operator: "&&") @p
    (binary_expression operator: "||") @p
  `,
};

// ------------------- Type extraction -------------------

/** Extract a type name (bare class name) from a C# type AST node. Returns
 *  null for primitives, arrays, tuples, and types we can't statically
 *  resolve. Generics are stripped to their base type — our type index is
 *  keyed by class name, not parameterized type. */
function extractTypeName(node: TsNode): string | null {
  switch (node.type) {
    case "identifier":
      return node.text;
    case "predefined_type":
      // int, string, bool, void — no class in our index
      return null;
    case "qualified_name": {
      // "System.Collections.List" → "List" (last segment). Type-tracking
      // against qualified names is rare in practice and the bare class name
      // matches our FQN→path index just as well via the namespaceMembers
      // pathway.
      const parts = node.text.split(".");
      return parts[parts.length - 1] ?? null;
    }
    case "generic_name": {
      // generic_name's named children are the base type (identifier) +
      // type_argument_list. Take the identifier.
      for (const child of node.namedChildren) {
        if (child.type === "identifier") return child.text;
      }
      return null;
    }
    case "nullable_type": {
      // Foo? — recurse on the inner type
      const inner = node.namedChildren[0];
      return inner ? extractTypeName(inner) : null;
    }
    // array_type, tuple_type, pointer_type → null (no class to look up)
    default:
      return null;
  }
}

/** Walk a class/struct/record body for fields + properties, return name→type
 *  map. C# uses property_declaration alongside field_declaration for state,
 *  and idiomatically prefers properties — both must be tracked. */
function collectMemberTypes(classBody: TsNode): Map<string, string> {
  const out = new Map<string, string>();

  for (const child of classBody.namedChildren) {
    if (child.type === "field_declaration") {
      // field_declaration wraps variable_declaration which has a `type` field
      // and one or more variable_declarator children.
      const vd = child.namedChildren.find((c) => c.type === "variable_declaration");
      if (!vd) continue;
      const typeNode = vd.childForFieldName("type");
      if (!typeNode) continue;
      const typeName = extractTypeName(typeNode);
      if (!typeName) continue;
      for (const sub of vd.namedChildren) {
        if (sub.type !== "variable_declarator") continue;
        // variable_declarator's first named child is typically the name
        const nameNode = sub.namedChildren[0];
        if (nameNode?.type === "identifier") out.set(nameNode.text, typeName);
      }
    } else if (child.type === "property_declaration") {
      // property_declaration has explicit `name` + `type` fields
      const typeNode = child.childForFieldName("type");
      const nameNode = child.childForFieldName("name");
      if (!typeNode || !nameNode) continue;
      const typeName = extractTypeName(typeNode);
      if (typeName) out.set(nameNode.text, typeName);
    }
  }

  return out;
}

/** Walk a method's parameter_list, return name→type map. */
function collectParamTypes(methodNode: TsNode): Map<string, string> {
  const out = new Map<string, string>();
  const params = methodNode.childForFieldName("parameters");
  if (!params) return out;
  for (const p of params.namedChildren) {
    if (p.type !== "parameter") continue;
    const typeNode = p.childForFieldName("type");
    const nameNode = p.childForFieldName("name");
    if (!typeNode || !nameNode) continue;
    const typeName = extractTypeName(typeNode);
    if (typeName) out.set(nameNode.text, typeName);
  }
  return out;
}

/** Try to infer the type of a `var` initializer. Specifically catches the
 *  `var x = new Foo()` pattern, which is the only form where we can be
 *  confident about the type without full inference. */
function inferInitializerType(initNode: TsNode | null): string | null {
  if (!initNode) return null;
  if (initNode.type !== "object_creation_expression") return null;
  const typeNode = initNode.childForFieldName("type");
  return typeNode ? extractTypeName(typeNode) : null;
}

// ------------------- parseDirect: AST walk with type tracking -------------------

interface MethodScope {
  name: string;
  locals: Map<string, string>;
  decisionPoints: number;
}

interface ClassScope {
  name: string;
  fields: Map<string, string>;
}

function parseCSharpDirect(file: SourceFile, _ix: FileIndex): ParsedFile {
  if (!lang) {
    throw new Error("csharp plugin not loaded — call plugin.load() first");
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
    for (let i = methodStack.length - 1; i >= 0; i--) {
      const t = methodStack[i].locals.get(name);
      if (t) return t;
    }
    const cls = currentClass();
    if (cls) {
      const t = cls.fields.get(name);
      if (t) return t;
    }
    return null;
  }

  function countDecisionPoint() {
    totalDecisionPoints++;
    const m = currentMethod();
    if (m) m.decisionPoints++;
  }

  /** Resolve calleeType from the receiver of a `obj.method()` call. The
   *  receiver comes in as the `expression` field of a member_access_expression.
   *  Bare calls (no receiver) get implicit `this` = current class. */
  function resolveCalleeType(receiver: TsNode | null): string | undefined {
    const cls = currentClass();
    if (!receiver) return cls?.name ?? undefined;
    switch (receiver.type) {
      case "this":
        return cls?.name ?? undefined;
      case "base":
        // No inheritance edges tracked yet — let pickCallTarget fall back to
        // name-match
        return undefined;
      case "identifier": {
        const t = lookupVariableType(receiver.text);
        if (t) return t;
        // Bare identifier could also be a class name (static call). Pass it
        // through; the candidate disambiguator will try.
        return receiver.text;
      }
      case "member_access_expression": {
        // `this.field.method()` — field on current class
        const innerExpr = receiver.childForFieldName("expression");
        const memberName = receiver.childForFieldName("name")?.text;
        if (!memberName) return undefined;
        if (innerExpr?.type === "this") {
          return cls?.fields.get(memberName);
        }
        return undefined;
      }
      case "cast_expression": {
        // tree-sitter-c-sharp parses `(T)x?.y()` as `((T)x)?.y()`, which is
        // at odds with C# precedence (where `(T)expr.method()` actually means
        // `(T)(expr.method())`). We treat the cast target as the receiver
        // type — works correctly for legitimate `((T)x).method()` patterns
        // and is also good enough for the precedence-mismatch case: if T is
        // external (like ICustomFormatter), pickCallTarget's strict
        // type-aware path turns the call into an unresolved edge, which is
        // the safe outcome. (Discovered during v0.21 serilog validation: a
        // `(ICustomFormatter?)formatProvider?.GetFormat(...)` was resolving
        // to a test method because cast_expression went undefined.)
        const typeChild = receiver.namedChildren[0];
        if (typeChild) {
          const castType = extractTypeName(typeChild);
          if (castType) return castType;
        }
        // Fall back to the inner expression's type when the cast target is a
        // primitive (e.g., `(int)x`) or otherwise unextractable.
        const innerExpr = receiver.namedChildren[1];
        if (innerExpr) return resolveCalleeType(innerExpr);
        return undefined;
      }
      case "parenthesized_expression": {
        // `(expr).method()` — the parens are syntactic, recurse on the
        // wrapped expression.
        const inner = receiver.namedChildren[0];
        return inner ? resolveCalleeType(inner) : undefined;
      }
      // invocation_expression (chained calls), etc. — would need return-type
      // tracking. Skip in v1.
      default:
        return undefined;
    }
  }

  function visit(node: TsNode) {
    switch (node.type) {
      case "using_directive": {
        // Single named child: identifier ("System") or qualified_name
        // ("System.Collections.Generic"). `using static` and `using Alias = ...`
        // also pass through this type — they show up with extra modifier
        // children that we ignore for spec extraction.
        let spec: string | null = null;
        for (const child of node.namedChildren) {
          if (child.type === "identifier" || child.type === "qualified_name") {
            spec = child.text;
            break;
          }
        }
        if (spec && !seenImportSpecs.has(spec)) {
          seenImportSpecs.add(spec);
          imports.push({
            rawSpec: spec,
            resolvedPath: resolveCSharpImport(spec, file.rel, _ix),
          });
        }
        return;
      }

      case "class_declaration":
      case "interface_declaration":
      case "struct_declaration":
      case "record_declaration":
      case "enum_declaration": {
        const nameNode = node.childForFieldName("name");
        const className = nameNode?.text ?? "<anon>";
        const bodyNode = node.childForFieldName("body");
        const fields = bodyNode
          ? collectMemberTypes(bodyNode)
          : new Map<string, string>();
        classStack.push({ name: className, fields });
        if (bodyNode) {
          for (const child of bodyNode.namedChildren) visit(child);
        }
        // Records can have a primary constructor inline (no body):
        // `public record Foo(int Bar);` — we don't extract those parameters
        // as fields in v1. The class scope still pushes/pops correctly.
        classStack.pop();
        return;
      }

      case "method_declaration":
      case "constructor_declaration":
      case "local_function_statement": {
        const nameNode = node.childForFieldName("name");
        const fnName = nameNode?.text ?? "<anon>";
        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const params = collectParamTypes(node);
        const locals = new Map(params);
        methodStack.push({ name: fnName, locals, decisionPoints: 0 });
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

      case "local_declaration_statement": {
        // local_declaration_statement wraps a single variable_declaration with
        // a type field + variable_declarator children.
        const vd = node.namedChildren.find(
          (c) => c.type === "variable_declaration"
        );
        if (vd) {
          const typeNode = vd.childForFieldName("type");
          // If type is `var` (an identifier with text "var"), try
          // initializer-inference. Otherwise extract type directly.
          let typeName: string | null = null;
          if (
            typeNode &&
            !(typeNode.type === "identifier" && typeNode.text === "var")
          ) {
            typeName = extractTypeName(typeNode);
          }
          for (const sub of vd.namedChildren) {
            if (sub.type !== "variable_declarator") continue;
            const nameNode = sub.namedChildren[0];
            if (nameNode?.type !== "identifier") continue;
            // For typed locals, use the declared type
            if (typeName) {
              const m = currentMethod();
              if (m) m.locals.set(nameNode.text, typeName);
              continue;
            }
            // For `var` locals, try to infer from initializer. The
            // variable_declarator's last child is the initializer expression
            // (e.g., object_creation_expression).
            const initializer = sub.namedChildren[sub.namedChildren.length - 1];
            if (initializer && initializer !== nameNode) {
              const inferred = inferInitializerType(initializer);
              if (inferred) {
                const m = currentMethod();
                if (m) m.locals.set(nameNode.text, inferred);
              }
            }
          }
        }
        // Continue visiting — initializers may have nested calls/decisions
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "invocation_expression": {
        const fn = node.childForFieldName("function");
        if (fn) {
          let calleeName: string | null = null;
          let receiver: TsNode | null = null;
          if (fn.type === "identifier") {
            calleeName = fn.text;
            receiver = null;
          } else if (fn.type === "member_access_expression") {
            calleeName = fn.childForFieldName("name")?.text ?? null;
            receiver = fn.childForFieldName("expression");
          } else if (fn.type === "conditional_access_expression") {
            // `obj?.method()` — the conditional_access_expression's first
            // named child is the receiver; subsequent member_binding_expression
            // contains the method name. C# specific: regular member access
            // uses member_access_expression, the null-conditional `?.` uses
            // this dedicated node type.
            const children = fn.namedChildren;
            receiver = children[0] ?? null;
            const binding = children.find(
              (c) => c.type === "member_binding_expression"
            );
            if (binding) {
              for (const sub of binding.namedChildren) {
                if (sub.type === "identifier") {
                  calleeName = sub.text;
                  break;
                }
              }
            }
          } else if (fn.type === "generic_name") {
            // `Foo.Bar<int>()` — the generic_name itself is the callee. The
            // identifier inside is the bare method name.
            for (const child of fn.namedChildren) {
              if (child.type === "identifier") {
                calleeName = child.text;
                break;
              }
            }
          }
          if (calleeName) {
            calls.push({
              calleeName,
              inFunction: currentMethod()?.name ?? null,
              calleeType: resolveCalleeType(receiver),
            });
          }
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "object_creation_expression": {
        // `new Foo()` / `new Foo<T>()` — calleeName = the class itself
        const typeNode = node.childForFieldName("type");
        if (typeNode) {
          const typeName = extractTypeName(typeNode);
          if (typeName) {
            calls.push({
              calleeName: typeName,
              inFunction: currentMethod()?.name ?? null,
              calleeType: typeName,
            });
          }
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "if_statement":
      case "while_statement":
      case "for_statement":
      case "for_each_statement":
      case "do_statement":
      case "catch_clause":
      case "conditional_expression":
        countDecisionPoint();
        for (const child of node.namedChildren) visit(child);
        return;

      case "switch_section": {
        // C#-specific: a `case X:` clause is a `switch_section` whose first
        // statement is preceded by a pattern child (constant_pattern,
        // type_pattern, etc.). `default:` switch_sections start with a
        // statement directly. Use the source-text prefix as a robust
        // discriminator — same shape as the Java plugin's switch_label
        // handling.
        if (node.text.trimStart().startsWith("case")) countDecisionPoint();
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "binary_expression": {
        const op = node.childForFieldName("operator")?.text;
        if (op === "&&" || op === "||") countDecisionPoint();
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

export const csharpPlugin = {
  name: PLUGIN_NAME,
  extensions: EXTENSIONS,

  async load() {
    if (lang) return;
    lang = await loadBuiltinGrammar("tree-sitter-c-sharp");
  },

  async prepareForRepo(_root: string, ix: FileIndex) {
    ix.extras.set(PLUGIN_NAME, buildCSharpContext(ix));
  },

  languageFor(_ext) {
    if (!lang) {
      throw new Error(
        `csharp plugin not loaded — call plugin.load() before languageFor()`
      );
    }
    return lang;
  },

  queriesFor(_ext): PluginQueries {
    return QUERIES;
  },

  parseDirect: parseCSharpDirect,

  resolveImport: resolveCSharpImport,
} satisfies CodeAnalysisPlugin;
