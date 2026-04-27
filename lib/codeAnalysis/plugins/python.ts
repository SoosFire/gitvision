// Python plugin — first migration off the regex-fallback onto a real AST.
//
// Mirrors lib/codeAnalysis/plugins/javascript.ts:
//   - Tree-sitter queries with canonical capture names (@spec / @name /
//     @callee / @body)
//   - resolveImport ports the algorithm from lib/graph.ts:resolvePython so
//     resolution-rate stays at parity with the regex pipeline (we measured
//     99.99% on django/django before the migration)
//
// What this unlocks vs regex-fallback: call-graph at function level, per-
// function cyclomatic complexity, and the Code tab's blast-radius UI now
// works for Python repos the same way it works for JS/TS.

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

const PLUGIN_NAME = "python";
const EXTENSIONS = ["py"] as const;

let lang: Language | null = null;

// ------------------- Tree-sitter queries -------------------

/** Captures a single @spec per import statement. The captured text is the
 *  module path AS WRITTEN — leading dots preserved for relative imports.
 *  resolvePythonImport parses the dot prefix to determine relative depth.
 *
 *    import foo.bar              → spec = "foo.bar"
 *    import foo as f             → spec = "foo"
 *    from foo.bar import x       → spec = "foo.bar"
 *    from .foo import x          → spec = ".foo"
 *    from . import helper        → spec = "."
 *    from ..pkg import x         → spec = "..pkg"
 */
const IMPORTS_QUERY = `
; from X import ... (absolute, X is dotted_name)
(import_from_statement
  module_name: (dotted_name) @spec)

; from .X import ... or from . import ... (relative)
(import_from_statement
  module_name: (relative_import) @spec)

; import X.Y.Z
(import_statement
  name: (dotted_name) @spec)

; import X as Y
(import_statement
  name: (aliased_import name: (dotted_name) @spec))
`;

/** Function and method definitions. Methods are also function_definition
 *  nodes (nested in class_definition), so this covers both. */
const FUNCTION_DEFS_QUERY = `
(function_definition name: (identifier) @name body: (block) @body)
`;

/** Call sites. Two patterns: bare-identifier calls (foo()) and
 *  attribute-access calls (obj.method()) — the latter captures the rightmost
 *  attribute name, matching how the JS plugin handles member_expression. */
const CALL_SITES_QUERY = `
(call function: (identifier) @callee)
(call function: (attribute attribute: (identifier) @callee))
`;

/** McCabe decision points. Notes:
 *  - elif_clause counted in addition to its parent if_statement (each elif
 *    is an additional branch)
 *  - boolean_operator covers both `and` and `or`
 *  - except_clause counted (try_statement itself isn't a branch — it's the
 *    "no exception" path; each except adds a branch)
 *  - case_clause for Python 3.10+ pattern matching
 *  - We deliberately don't count `with_statement` (single-path context
 *    manager) or bare `try_statement` (only its excepts add branches)
 */
const DECISION_POINTS_QUERY = `
(if_statement) @p
(elif_clause) @p
(while_statement) @p
(for_statement) @p
(except_clause) @p
(boolean_operator) @p
(conditional_expression) @p
(case_clause) @p
`;

const QUERIES: PluginQueries = {
  imports: IMPORTS_QUERY,
  functionDefs: FUNCTION_DEFS_QUERY,
  callSites: CALL_SITES_QUERY,
  decisionPoints: DECISION_POINTS_QUERY,
};

// ------------------- Import resolution -------------------

/** Resolve a Python import spec (as captured by IMPORTS_QUERY) to a repo-rel
 *  file path, or null for external / unresolvable specs.
 *
 *  Algorithm matches lib/graph.ts:resolvePython for parity — porting the
 *  regex pipeline's behavior so resolution rate stays at the level we
 *  measured (django: 99.99%) and we can immediately compare AST output
 *  against the same files.
 *
 *  Steps:
 *   1. Strip leading dots (their count = relative depth + 1; "." = stay,
 *      ".." = up one, "..." = up two, etc.)
 *   2. Split remainder by "." into module-path parts
 *   3. For relative imports, walk up from the importing file's directory
 *   4. Try base.py first, then base/__init__.py
 *   5. Fall back to a fuzzy suffix match — handles repos whose source root
 *      is nested (e.g. src/) so absolute "foo.bar" still resolves to
 *      src/foo/bar.py
 */
function resolvePythonImport(
  spec: string,
  fromPath: string,
  ix: FileIndex
): string | null {
  // Count leading dots
  let dotCount = 0;
  while (dotCount < spec.length && spec[dotCount] === ".") dotCount++;
  const rest = spec.slice(dotCount);
  const parts = rest.split(".").filter(Boolean);

  // Compute base path
  let base: string;
  if (dotCount > 0) {
    const fromDir = path.posix.dirname(fromPath);
    const up = dotCount - 1; // 1 dot = current dir, 2 = parent, ...
    const fromParts = fromDir.split("/").filter(Boolean);
    if (up > fromParts.length) return null;
    base = fromParts
      .slice(0, fromParts.length - up)
      .concat(parts)
      .join("/");
  } else {
    base = parts.join("/");
  }

  if (!base) return null;

  // Direct file: foo/bar.py
  const direct = `${base}.py`;
  if (ix.byPath.has(direct)) return direct;

  // Package: foo/bar/__init__.py
  const pkg = `${base}/__init__.py`;
  if (ix.byPath.has(pkg)) return pkg;

  // Fuzzy suffix match — handles src/ wrappers and other layout quirks.
  // We check direct first (more specific), then pkg.
  for (const key of ix.byPath.keys()) {
    if (key.endsWith(`/${direct}`)) return key;
  }
  for (const key of ix.byPath.keys()) {
    if (key.endsWith(`/${pkg}`)) return key;
  }

  return null;
}

// ------------------- Type extraction (Python type hints) -------------------
//
// Python type hints are optional. Untyped Python code (the majority before
// type-checking became fashionable) gracefully degrades — the walker leaves
// calleeType undefined and pickCallTarget falls back to name-match.
// Typed Python (modern frameworks like FastAPI / Pydantic) gets the same
// type-aware treatment as TypeScript.

/** Pull the bare class name out of a Python type annotation. Strips
 *  generics (List[Foo] → Foo for our purposes — we want the methods on the
 *  collection type, but List itself rarely has same-named ambiguity, so
 *  we'd actually return List). Returns null for shapes we can't resolve
 *  (Union[A, B], Callable[..., R], string-quoted forward references). */
function extractPyTypeName(node: TsNode): string | null {
  switch (node.type) {
    case "identifier":
      return node.text;
    case "type": {
      // `type` wraps the actual type expression — recurse to its first child
      for (const child of node.namedChildren) {
        const t = extractPyTypeName(child);
        if (t) return t;
      }
      return null;
    }
    case "subscript": {
      // Indexing form `arr[0]` — rarely used as a type but handled
      // defensively. The base is in the "value" field.
      const value = node.childForFieldName("value") ?? node.namedChild(0);
      if (value) return extractPyTypeName(value);
      return null;
    }
    case "generic_type": {
      // tree-sitter-python's representation of `List[Foo]`, `Dict[K, V]`,
      // `Optional[Bar]` — the first named child (an identifier) is the
      // base type. Trailing `type_parameter` children hold the type args
      // which we strip.
      for (const child of node.namedChildren) {
        if (child.type === "identifier") return child.text;
        if (child.type === "attribute") return extractPyTypeName(child);
      }
      return null;
    }
    case "attribute": {
      // typing.Optional / pkg.Foo — take the rightmost attribute
      const attr = node.childForFieldName("attribute");
      if (attr?.type === "identifier") return attr.text;
      return null;
    }
    case "string": {
      // Forward references: `'Foo'` or `"Foo"`. Strip quotes, treat as type
      // name if valid identifier-shaped.
      const txt = node.text.replace(/^['"]|['"]$/g, "");
      if (/^[A-Za-z_][\w.]*$/.test(txt)) {
        // pkg.Foo → Foo (last segment)
        const parts = txt.split(".");
        return parts[parts.length - 1] ?? null;
      }
      return null;
    }
    // generic_type, union_type (PEP 604 X | Y), callable types, literal
    // types, etc → null
    default:
      return null;
  }
}

// ------------------- parseDirect: AST walk with type tracking -------------------

interface PyClassScope {
  name: string;
  /** Field name → type. Built from class-body assignments with annotations:
   *    class Service:
   *      validator: ValidatePassword
   *  Plus __init__ params with annotations that get assigned to self. */
  fields: Map<string, string>;
}

interface PyMethodScope {
  name: string;
  locals: Map<string, string>;
  decisionPoints: number;
  /** True for class methods — drives self.method() / cls.method() resolution. */
  isInClassMethod: boolean;
}

function parsePyDirect(file: SourceFile, ix: FileIndex): ParsedFile {
  if (!lang) {
    throw new Error("python plugin not loaded — call plugin.load() first");
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
  const classStack: PyClassScope[] = [];
  const methodStack: PyMethodScope[] = [];

  function currentClass(): PyClassScope | null {
    return classStack[classStack.length - 1] ?? null;
  }
  function currentMethod(): PyMethodScope | null {
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

  /** Walk a class body for `name: Type` annotated attributes (PEP 526),
   *  including `name: Type = default` forms. */
  function collectClassFields(classBody: TsNode): Map<string, string> {
    const out = new Map<string, string>();
    for (const child of classBody.namedChildren) {
      // Class body block — recurse one level
      if (child.type === "block") {
        for (const stmt of child.namedChildren) collectFromStmt(stmt, out);
      } else {
        collectFromStmt(child, out);
      }
    }
    return out;
  }

  function collectFromStmt(stmt: TsNode, out: Map<string, string>) {
    if (
      stmt.type === "expression_statement" &&
      stmt.namedChildren.length === 1
    ) {
      const inner = stmt.namedChildren[0];
      if (inner) {
        if (inner.type === "assignment") {
          // PEP 526: `name: Type = default` is parsed as `assignment` with a
          // type field.
          const left = inner.childForFieldName("left");
          const typeNode = inner.childForFieldName("type");
          if (left?.type === "identifier" && typeNode) {
            const typeName = extractPyTypeName(typeNode);
            if (typeName) out.set(left.text, typeName);
          }
        } else if (inner.type === "typed_default_parameter") {
          // shouldn't appear in class body, but handle defensively
        }
      }
    } else if (stmt.type === "assignment") {
      const left = stmt.childForFieldName("left");
      const typeNode = stmt.childForFieldName("type");
      if (left?.type === "identifier" && typeNode) {
        const typeName = extractPyTypeName(typeNode);
        if (typeName) out.set(left.text, typeName);
      }
    }
  }

  /** Walk an `__init__` body for `self.x = value` patterns, optionally with
   *  annotation `self.x: Foo = value`. The latter is rare; most Python uses
   *  bare `self.x = value` and relies on a class-level annotation for x.
   *  We focus on registering x even from bare assignments WHEN the rhs is a
   *  call/new whose return type we can infer. v1 doesn't infer so we skip. */
  function collectInitSelfAssignments(
    initBody: TsNode,
    paramTypes: Map<string, string>,
    fields: Map<string, string>
  ): void {
    function visitInit(node: TsNode) {
      if (
        node.type === "assignment" ||
        node.type === "expression_statement"
      ) {
        const target =
          node.type === "assignment"
            ? node.childForFieldName("left")
            : node.namedChildren[0]?.childForFieldName?.("left");
        const typeNode =
          node.type === "assignment"
            ? node.childForFieldName("type")
            : node.namedChildren[0]?.childForFieldName?.("type");
        const valueNode =
          node.type === "assignment"
            ? node.childForFieldName("right")
            : node.namedChildren[0]?.childForFieldName?.("right");

        // Detect self.X = ... patterns
        if (
          target?.type === "attribute" &&
          target.childForFieldName("object")?.type === "identifier" &&
          target.childForFieldName("object")?.text === "self"
        ) {
          const attrNode = target.childForFieldName("attribute");
          if (attrNode?.type === "identifier") {
            const fieldName = attrNode.text;
            // Annotation form: self.x: Foo = ...
            if (typeNode) {
              const typeName = extractPyTypeName(typeNode);
              if (typeName) fields.set(fieldName, typeName);
            } else if (valueNode?.type === "identifier") {
              // self.x = paramName — copy the param's type
              const paramType = paramTypes.get(valueNode.text);
              if (paramType) fields.set(fieldName, paramType);
            }
          }
        }
      }
      for (const child of node.namedChildren) visitInit(child);
    }
    visitInit(initBody);
  }

  /** Pull (paramName, typeName?) from a parameter node. Python has several
   *  parameter shapes — typed_default_parameter (with default + type),
   *  typed_parameter (with type, no default), default_parameter (default,
   *  no type), and bare identifier (no type, no default). */
  function extractPythonParam(
    paramNode: TsNode
  ): { name: string; type: string | null } | null {
    switch (paramNode.type) {
      case "identifier":
        return { name: paramNode.text, type: null };
      case "typed_parameter":
      case "typed_default_parameter": {
        // typed_parameter: name (identifier), type (type)
        const nameNode =
          paramNode.namedChildren.find((c) => c.type === "identifier") ??
          null;
        const typeNode = paramNode.childForFieldName("type");
        if (!nameNode) return null;
        const typeName = typeNode ? extractPyTypeName(typeNode) : null;
        return { name: nameNode.text, type: typeName };
      }
      case "default_parameter": {
        const nameNode = paramNode.childForFieldName("name");
        if (nameNode?.type === "identifier") {
          return { name: nameNode.text, type: null };
        }
        return null;
      }
      case "list_splat_pattern":
      case "dictionary_splat_pattern":
        // *args / **kwargs — skip
        return null;
      default:
        return null;
    }
  }

  function collectMethodParams(
    funcDef: TsNode,
    isInClass: boolean
  ): Map<string, string> {
    const out = new Map<string, string>();
    const params = funcDef.childForFieldName("parameters");
    if (!params) return out;
    for (const p of params.namedChildren) {
      const info = extractPythonParam(p);
      if (info && info.type) out.set(info.name, info.type);
    }
    // For class methods, register `self` / `cls` with the enclosing class
    // type so `self.method()` / `cls.method()` resolve.
    if (isInClass) {
      const cls = currentClass();
      if (cls) {
        // Scan params for self/cls (the first one usually)
        for (const p of params.namedChildren) {
          if (p.type === "identifier") {
            if (p.text === "self" || p.text === "cls") {
              out.set(p.text, cls.name);
            }
            break; // only the first positional param is self/cls
          }
        }
      }
    }
    return out;
  }

  function resolveReceiverType(receiver: TsNode): string | undefined {
    switch (receiver.type) {
      case "identifier": {
        const t = lookupVariableType(receiver.text);
        if (t) return t;
        // Could be a class/module name — return the bare name as a guess
        return receiver.text;
      }
      case "attribute": {
        // x.y — look up y in x's class fields
        const obj = receiver.childForFieldName("object");
        const attr = receiver.childForFieldName("attribute");
        if (!obj || attr?.type !== "identifier") return undefined;
        const objType = resolveReceiverType(obj);
        if (!objType) return undefined;
        // Look up attribute in the class table only for classes in this file.
        // We have only the current class's field map handy; cross-file
        // struct table would be a future enhancement.
        if (objType === currentClass()?.name) {
          return currentClass()?.fields.get(attr.text);
        }
        return undefined;
      }
      case "call": {
        // SomeType(...) → type is SomeType (Python's class instantiation)
        const fn = receiver.childForFieldName("function");
        if (fn?.type === "identifier") return fn.text;
        return undefined;
      }
      default:
        return undefined;
    }
  }

  function visit(node: TsNode) {
    switch (node.type) {
      case "import_statement": {
        // import X.Y as Z  /  import X
        for (const child of node.namedChildren) {
          let spec: string | null = null;
          if (child.type === "dotted_name") spec = child.text;
          else if (child.type === "aliased_import") {
            const inner = child.childForFieldName("name");
            if (inner?.type === "dotted_name") spec = inner.text;
          }
          if (spec && !seenImportSpecs.has(spec)) {
            seenImportSpecs.add(spec);
            imports.push({
              rawSpec: spec,
              resolvedPath: resolvePythonImport(spec, file.rel, ix),
            });
          }
        }
        return;
      }

      case "import_from_statement": {
        // from X import ...  or  from .X import ...  or  from . import ...
        const moduleNode = node.childForFieldName("module_name");
        if (moduleNode) {
          const spec = moduleNode.text;
          if (!seenImportSpecs.has(spec)) {
            seenImportSpecs.add(spec);
            imports.push({
              rawSpec: spec,
              resolvedPath: resolvePythonImport(spec, file.rel, ix),
            });
          }
        }
        return;
      }

      case "class_definition": {
        const nameNode = node.childForFieldName("name");
        const className = nameNode?.text ?? "<anon>";
        const bodyNode = node.childForFieldName("body");
        const fields = bodyNode
          ? collectClassFields(bodyNode)
          : new Map<string, string>();

        // Look for __init__ to capture self.X = param assignments
        if (bodyNode) {
          for (const stmt of bodyNode.namedChildren) {
            if (stmt.type !== "function_definition") continue;
            const stmtName = stmt.childForFieldName("name")?.text;
            if (stmtName !== "__init__") continue;
            const initBody = stmt.childForFieldName("body");
            if (!initBody) continue;
            // Build a temp class scope so collectMethodParams can see it
            // — but we actually push it below. Just collect param types
            // directly here:
            const params = stmt.childForFieldName("parameters");
            const initParamTypes = new Map<string, string>();
            if (params) {
              for (const p of params.namedChildren) {
                const info = extractPythonParam(p);
                if (info && info.type) initParamTypes.set(info.name, info.type);
              }
            }
            collectInitSelfAssignments(initBody, initParamTypes, fields);
          }
        }

        classStack.push({ name: className, fields });
        if (bodyNode) {
          for (const child of bodyNode.namedChildren) visit(child);
        }
        classStack.pop();
        return;
      }

      case "function_definition": {
        const nameNode = node.childForFieldName("name");
        const fnName = nameNode?.text ?? "<anon>";
        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const isInClass = classStack.length > 0;
        const locals = collectMethodParams(node, isInClass);

        methodStack.push({
          name: fnName,
          locals,
          decisionPoints: 0,
          isInClassMethod: isInClass,
        });
        const body = node.childForFieldName("body");
        if (body) for (const child of body.namedChildren) visit(child);
        const ms = methodStack.pop()!;
        functions.push({
          name: fnName,
          startRow,
          endRow,
          complexity: 1 + ms.decisionPoints,
          containerType: isInClass ? currentClass()?.name : undefined,
        });
        return;
      }

      case "assignment": {
        // Local annotated assignment: x: Foo = ... or `x = SomeType()`
        const left = node.childForFieldName("left");
        const typeNode = node.childForFieldName("type");
        const valueNode = node.childForFieldName("right");
        const m = currentMethod();
        if (left?.type === "identifier" && m) {
          let typeName: string | null = null;
          if (typeNode) {
            typeName = extractPyTypeName(typeNode);
          } else if (valueNode?.type === "call") {
            // x = SomeClass(...) — the constructor's name IS the type.
            const fn = valueNode.childForFieldName("function");
            if (fn?.type === "identifier") typeName = fn.text;
          }
          if (typeName) m.locals.set(left.text, typeName);
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "call": {
        const fnNode = node.childForFieldName("function");
        if (fnNode) {
          let calleeName: string | null = null;
          let calleeType: string | undefined;
          if (fnNode.type === "identifier") {
            calleeName = fnNode.text;
            // Python doesn't have implicit self — bare call is global
          } else if (fnNode.type === "attribute") {
            const attrNode = fnNode.childForFieldName("attribute");
            const objNode = fnNode.childForFieldName("object");
            if (attrNode?.type === "identifier") calleeName = attrNode.text;
            if (objNode) calleeType = resolveReceiverType(objNode);
          }
          if (calleeName) {
            calls.push({
              calleeName,
              inFunction: currentMethod()?.name ?? null,
              calleeType,
            });
          }
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "if_statement":
      case "elif_clause":
      case "while_statement":
      case "for_statement":
      case "except_clause":
      case "boolean_operator":
      case "conditional_expression":
      case "case_clause":
        countDecisionPoint();
        for (const child of node.namedChildren) visit(child);
        return;

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

export const pythonPlugin = {
  name: PLUGIN_NAME,
  extensions: EXTENSIONS,

  async load() {
    if (lang) return;
    lang = await loadBuiltinGrammar("tree-sitter-python");
  },

  languageFor(_ext) {
    if (!lang) {
      throw new Error(
        `python plugin not loaded — call plugin.load() before languageFor()`
      );
    }
    return lang;
  },

  queriesFor(_ext): PluginQueries {
    // Kept for any caller that prefers the standard pipeline; the
    // orchestrator routes through parseDirect since v0.18.
    return QUERIES;
  },

  parseDirect: parsePyDirect,

  resolveImport: resolvePythonImport,
} satisfies CodeAnalysisPlugin;
