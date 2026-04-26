// Java plugin — third migration off the regex-fallback, type-aware since v0.15.
//
// What this plugin does that javascript.ts / python.ts / go.ts don't (yet):
//   1. Tracks variable types in scope while walking the AST (class fields,
//      method parameters, local variable declarations).
//   2. Resolves call receivers to a static type when possible — for
//      `validatePassword.validate(...)`, the receiver `validatePassword` has
//      a known type `ValidatePassword`, so the call gets `calleeType` set.
//   3. Emits FunctionDef.containerType for every method (the enclosing class
//      name).
//
// Why this matters: codeGraph.pickCallTarget uses calleeType + containerType
// as the primary disambiguator. Without it, a call to `validate()` ambiguous
// between 7 ValidateXxx classes would be picked by file order — wrong half
// the time. With it, we deterministically resolve to ValidatePassword's
// validate.
//
// Implementation note: this plugin uses the parseDirect path instead of the
// standard tree-sitter pipeline because type tracking needs ordered AST
// traversal (we maintain a scope stack). Queries can find call sites but
// can't tell us "which variable's type is this call's receiver" without
// walking the tree ourselves.

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

const PLUGIN_NAME = "java";
const EXTENSIONS = ["java"] as const;

let lang: Language | null = null;

// ------------------- Module-level resolver context -------------------

interface JavaResolverContext {
  /** FQN ("com.foo.Bar") → repo-rel path. Built from package declarations
   *  + filename in prepareForRepo. */
  fqnToPath: Map<string, string>;
  /** Package name ("com.foo") → repo-rel paths in that package. Used to
   *  resolve wildcard imports. Sorted alphabetically for determinism. */
  packageMembers: Map<string, string[]>;
}

// Detects the package declaration at the top of a Java file. Allows leading
// whitespace and comments — Java's grammar permits both before `package`.
const PACKAGE_RE = /^\s*package\s+([a-zA-Z0-9_.]+)\s*;/m;

// ------------------- Index construction -------------------

function buildJavaContext(ix: FileIndex): JavaResolverContext {
  const fqnToPath = new Map<string, string>();
  const packageMembers = new Map<string, string[]>();

  for (const f of ix.byPath.values()) {
    if (f.ext !== "java") continue;
    const head = f.content.slice(0, 2048);
    const m = PACKAGE_RE.exec(head);
    const pkg = m?.[1] ?? null;
    const className = path.posix.basename(f.rel, ".java");
    const fqn = pkg ? `${pkg}.${className}` : className;
    fqnToPath.set(fqn, f.rel);
    if (pkg) {
      let members = packageMembers.get(pkg);
      if (!members) {
        members = [];
        packageMembers.set(pkg, members);
      }
      members.push(f.rel);
    }
  }

  for (const arr of packageMembers.values()) arr.sort();

  return { fqnToPath, packageMembers };
}

// ------------------- Import resolution -------------------

function resolveJavaImport(
  spec: string,
  _fromPath: string,
  ix: FileIndex
): string | null {
  const ctx = ix.extras.get(PLUGIN_NAME) as JavaResolverContext | undefined;
  if (!ctx) return null;
  const direct = ctx.fqnToPath.get(spec);
  if (direct) return direct;
  const members = ctx.packageMembers.get(spec);
  if (members && members.length > 0) return members[0];
  return null;
}

// ------------------- Tree-sitter queries (kept for reference + tests) -------------------
//
// These are no longer used by parseDirect — we walk the AST manually for type
// tracking. They're retained as documentation of what the queries WOULD look
// like, and are still exposed via queriesFor() so the plugin contract stays
// satisfied for any caller that uses the standard pipeline.

const QUERIES: PluginQueries = {
  imports: `(import_declaration (scoped_identifier) @spec)`,
  functionDefs: `
    (method_declaration name: (identifier) @name body: (block) @body)
    (constructor_declaration name: (identifier) @name body: (constructor_body) @body)
  `,
  callSites: `
    (method_invocation name: (identifier) @callee)
    (object_creation_expression type: (type_identifier) @callee)
    (object_creation_expression type: (generic_type (type_identifier) @callee))
  `,
  decisionPoints: `
    (if_statement) @p
    (while_statement) @p
    (for_statement) @p
    (enhanced_for_statement) @p
    (do_statement) @p
    ((switch_label) @p (#match? @p "^case"))
    (catch_clause) @p
    (binary_expression operator: "&&") @p
    (binary_expression operator: "||") @p
    (ternary_expression) @p
  `,
};

// ------------------- Type extraction -------------------

/** Extract a type name (just the bare class name) from a Java type AST node.
 *  Returns null for primitives, arrays, and types we can't statically resolve.
 *  We deliberately strip generics ("List<String>" → "List") because our type
 *  index is keyed by class name, not parameterized type. */
function extractTypeName(node: TsNode): string | null {
  switch (node.type) {
    case "type_identifier":
      return node.text;
    case "generic_type": {
      // generic_type's first named child is the base type (type_identifier
      // or scoped_type_identifier)
      for (const child of node.namedChildren) {
        if (
          child.type === "type_identifier" ||
          child.type === "scoped_type_identifier"
        ) {
          return extractTypeName(child);
        }
      }
      return null;
    }
    case "scoped_type_identifier": {
      // "java.util.Map.Entry" → "Entry" (last segment). Type tracking against
      // qualified names is rare in practice and the bare class name matches
      // our FQN→path index just as well.
      const parts = node.text.split(".");
      return parts[parts.length - 1] ?? null;
    }
    // Arrays + primitives + void → null (no methods we can resolve to in our
    // FunctionDef index)
    default:
      return null;
  }
}

/** Walk class body for field declarations, return name→type map. */
function collectFieldTypes(classBody: TsNode): Map<string, string> {
  const out = new Map<string, string>();
  for (const child of classBody.namedChildren) {
    if (child.type !== "field_declaration") continue;
    const typeNode = child.childForFieldName("type");
    if (!typeNode) continue;
    const typeName = extractTypeName(typeNode);
    if (!typeName) continue;
    // field_declaration may have multiple variable_declarator children for
    // forms like `int a, b, c;` — collect each name with the same type.
    for (const sub of child.namedChildren) {
      if (sub.type !== "variable_declarator") continue;
      const nameNode = sub.childForFieldName("name");
      if (nameNode?.text) out.set(nameNode.text, typeName);
    }
  }
  return out;
}

/** Walk a method's formal_parameters, return name→type map. */
function collectParamTypes(methodNode: TsNode): Map<string, string> {
  const out = new Map<string, string>();
  const params = methodNode.childForFieldName("parameters");
  if (!params) return out;
  for (const p of params.namedChildren) {
    if (p.type !== "formal_parameter" && p.type !== "spread_parameter") continue;
    const typeNode = p.childForFieldName("type");
    const nameNode = p.childForFieldName("name");
    if (!typeNode || !nameNode) continue;
    const typeName = extractTypeName(typeNode);
    if (typeName) out.set(nameNode.text, typeName);
  }
  return out;
}

// ------------------- parseDirect: AST walk with type tracking -------------------

interface MethodScope {
  name: string;
  /** Local variables (including parameters) → type. Pushed by the param
   *  collector; extended as we encounter local_variable_declaration nodes. */
  locals: Map<string, string>;
  /** McCabe decision points encountered inside this method's body. */
  decisionPoints: number;
}

interface ClassScope {
  name: string;
  fields: Map<string, string>;
}

function parseJavaDirect(file: SourceFile, _ix: FileIndex): ParsedFile {
  if (!lang) {
    throw new Error("java plugin not loaded — call plugin.load() first");
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

  /** Look up a variable's type in the current scope, walking outwards from
   *  innermost method through class fields. */
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

  /** Bumps both the file-total counter and the innermost method's local
   *  counter (for per-function complexity). */
  function countDecisionPoint() {
    totalDecisionPoints++;
    const m = currentMethod();
    if (m) m.decisionPoints++;
  }

  /** Resolve the calleeType for a method_invocation given its receiver
   *  (`object` field). Returns the type when statically inferable. */
  function resolveCalleeType(objectNode: TsNode | null): string | undefined {
    const cls = currentClass();
    // Bare call: `helper()` → implicit `this`, type = current class
    if (!objectNode) return cls?.name ?? undefined;

    switch (objectNode.type) {
      case "this":
        return cls?.name ?? undefined;
      case "super": {
        // We don't track inheritance edges yet — leave undefined. Java's
        // call resolver will fall back to name-match for super.method() calls.
        return undefined;
      }
      case "identifier": {
        // Could be a variable in scope OR a class name (for static calls).
        const t = lookupVariableType(objectNode.text);
        if (t) return t;
        // Treat the bare identifier itself as a possible class name. This
        // catches `Math.max(...)` where Math isn't a variable. The candidate
        // disambiguator will succeed when there's a class with that name in
        // our function index.
        return objectNode.text;
      }
      case "field_access": {
        // `this.field.method()` — field is on the current class
        const objField = objectNode.childForFieldName("object");
        const fieldName = objectNode.childForFieldName("field")?.text;
        if (!fieldName) return undefined;
        if (objField?.type === "this") {
          return cls?.fields.get(fieldName);
        }
        // Other shapes (chained, etc.) — out of scope
        return undefined;
      }
      // method_invocation, parenthesized_expression, etc. — we'd need return-
      // type tracking. Skip in v1.
      default:
        return undefined;
    }
  }

  function visit(node: TsNode) {
    switch (node.type) {
      case "import_declaration": {
        // Find the scoped_identifier child — it's not a field on
        // import_declaration, just a child node.
        let spec: string | null = null;
        for (const child of node.namedChildren) {
          if (child.type === "scoped_identifier") {
            spec = child.text;
            break;
          }
        }
        if (spec && !seenImportSpecs.has(spec)) {
          seenImportSpecs.add(spec);
          imports.push({
            rawSpec: spec,
            resolvedPath: resolveJavaImport(spec, file.rel, _ix),
          });
        }
        return; // imports have no nested calls/decisions worth visiting
      }

      case "class_declaration":
      case "interface_declaration":
      case "enum_declaration":
      case "record_declaration": {
        const nameNode = node.childForFieldName("name");
        const className = nameNode?.text ?? "<anon>";
        const bodyNode = node.childForFieldName("body");
        const fields = bodyNode
          ? collectFieldTypes(bodyNode)
          : new Map<string, string>();
        classStack.push({ name: className, fields });
        // Walk body so nested methods/classes get visited
        if (bodyNode) {
          for (const child of bodyNode.namedChildren) visit(child);
        }
        classStack.pop();
        return;
      }

      case "method_declaration":
      case "constructor_declaration": {
        const nameNode = node.childForFieldName("name");
        const fnName = nameNode?.text ?? "<anon>";
        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const params = collectParamTypes(node);
        const locals = new Map(params); // params are visible like locals
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

      case "local_variable_declaration": {
        const typeNode = node.childForFieldName("type");
        const typeName = typeNode ? extractTypeName(typeNode) : null;
        if (typeName) {
          const m = currentMethod();
          if (m) {
            for (const sub of node.namedChildren) {
              if (sub.type !== "variable_declarator") continue;
              const varName = sub.childForFieldName("name")?.text;
              if (varName) m.locals.set(varName, typeName);
            }
          }
        }
        // Continue visiting — initializers may contain calls / decisions
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "method_invocation": {
        const nameNode = node.childForFieldName("name");
        const calleeName = nameNode?.text;
        if (calleeName) {
          const objectNode = node.childForFieldName("object");
          calls.push({
            calleeName,
            inFunction: currentMethod()?.name ?? null,
            calleeType: resolveCalleeType(objectNode),
          });
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "object_creation_expression": {
        // `new Foo()` / `new Foo<>()` — calleeName is the class itself.
        // calleeType = same class (you're calling its constructor).
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
      case "enhanced_for_statement":
      case "do_statement":
      case "catch_clause":
      case "ternary_expression":
        countDecisionPoint();
        for (const child of node.namedChildren) visit(child);
        return;

      case "switch_label": {
        // Count `case X:` clauses but not `default:` — matches the JS plugin's
        // McCabe convention.
        if (node.text.startsWith("case")) countDecisionPoint();
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

export const javaPlugin = {
  name: PLUGIN_NAME,
  extensions: EXTENSIONS,

  async load() {
    if (lang) return;
    lang = await loadBuiltinGrammar("tree-sitter-java");
  },

  async prepareForRepo(_root: string, ix: FileIndex) {
    ix.extras.set(PLUGIN_NAME, buildJavaContext(ix));
  },

  // languageFor + queriesFor are kept defined for any consumer that wants to
  // inspect them (e.g. tests), but the orchestrator routes through parseDirect.
  languageFor(_ext) {
    if (!lang) {
      throw new Error(
        `java plugin not loaded — call plugin.load() before languageFor()`
      );
    }
    return lang;
  },

  queriesFor(_ext): PluginQueries {
    return QUERIES;
  },

  parseDirect: parseJavaDirect,

  resolveImport: resolveJavaImport,
} satisfies CodeAnalysisPlugin;
