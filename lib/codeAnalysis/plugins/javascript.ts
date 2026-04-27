// JavaScript / TypeScript plugin.
//
// Covers the JS family (.js, .jsx, .mjs, .cjs) plus TypeScript (.ts, .tsx,
// .mts, .cts). They share the same module system so they live in one plugin,
// but TS needs its own grammar for type annotations and .tsx needs the tsx
// grammar for JSX inside a typed file. Three grammars, one plugin.
//
// Resolver responsibilities (in priority order):
//   1. tsconfig path mappings (loaded per-repo via prepareForRepo)
//   2. Relative/absolute path resolution
//   3. TypeScript ESM convention: ".js" specifier → ".ts" file (and the
//      .jsx/.tsx, .mjs/.mts, .cjs/.cts pairs)

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
import {
  applyPathMapping,
  loadTsconfigPaths,
  type TsPathMappings,
} from "../tsconfig";
import {
  loadWorkspacePackages,
  type WorkspaceMap,
} from "../workspaces";

/** Per-repo state carried on FileIndex.extras["javascript"]. Both fields are
 *  optional — repos without a tsconfig or workspaces still work. */
interface JsResolverContext {
  tsPathMappings?: TsPathMappings;
  workspaces?: WorkspaceMap;
}

const EXTENSIONS = [
  "js", "jsx", "mjs", "cjs",
  "ts", "tsx", "mts", "cts",
] as const;

type GrammarSlot = "javascript" | "typescript" | "tsx";

const langs: Record<GrammarSlot, Language | null> = {
  javascript: null,
  typescript: null,
  tsx: null,
};

function slotFor(ext: string): GrammarSlot {
  if (ext === "tsx") return "tsx";
  if (ext === "ts" || ext === "mts" || ext === "cts") return "typescript";
  return "javascript"; // js, jsx, mjs, cjs
}

// ------------------- Tree-sitter queries -------------------

const IMPORTS_QUERY = `
; ES module: import X from "y"
(import_statement source: (string (string_fragment) @spec))

; Re-export: export ... from "y"
(export_statement source: (string (string_fragment) @spec))

; CommonJS require("y")
((call_expression
  function: (identifier) @_fn
  arguments: (arguments (string (string_fragment) @spec)))
 (#eq? @_fn "require"))

; Dynamic import: import("y")
(call_expression
  function: (import)
  arguments: (arguments (string (string_fragment) @spec)))
`;

const FUNCTION_DEFS_QUERY = `
; function foo() {}
(function_declaration name: (identifier) @name body: (statement_block) @body)

; class Foo { bar() {} }
(method_definition name: (property_identifier) @name body: (statement_block) @body)

; const foo = () => {} / const foo = () => expr
(variable_declarator
  name: (identifier) @name
  value: (arrow_function body: (_) @body))

; const foo = function() {}
(variable_declarator
  name: (identifier) @name
  value: (function_expression body: (statement_block) @body))
`;

const CALL_SITES_QUERY = `
; foo()
(call_expression function: (identifier) @callee)

; obj.foo()
(call_expression function: (member_expression property: (property_identifier) @callee))
`;

const DECISION_POINTS_QUERY = `
(if_statement) @p
(while_statement) @p
(for_statement) @p
(for_in_statement) @p
(do_statement) @p
(switch_case) @p
(ternary_expression) @p
(catch_clause) @p
(binary_expression operator: "&&") @p
(binary_expression operator: "||") @p
(binary_expression operator: "??") @p
`;

const QUERIES: PluginQueries = {
  imports: IMPORTS_QUERY,
  functionDefs: FUNCTION_DEFS_QUERY,
  callSites: CALL_SITES_QUERY,
  decisionPoints: DECISION_POINTS_QUERY,
};

// ------------------- Import resolution -------------------

/** Extensions we'll try when a spec lacks one, ordered TS-first because TS
 *  files outnumber JS in modern repos. */
const RESOLVE_EXTS = [
  "ts", "tsx", "mts", "cts",
  "js", "jsx", "mjs", "cjs",
];

/** TypeScript ESM convention: source file is .ts but spec is written as .js
 *  (TS doesn't rewrite specifiers, so it must point at the runtime filename).
 *  Same logic for the jsx/tsx, mjs/mts, cjs/cts pairs. Maps the .js-side ext
 *  to its .ts-side equivalent so the resolver can retry once the literal
 *  spec doesn't resolve. */
const JS_TO_TS: Record<string, string> = {
  js: "ts",
  jsx: "tsx",
  mjs: "mts",
  cjs: "cts",
};

const PLUGIN_NAME = "javascript";

function resolveJsImport(
  spec: string,
  fromPath: string,
  ix: FileIndex
): string | null {
  const ctx = ix.extras.get(PLUGIN_NAME) as JsResolverContext | undefined;

  // 1. tsconfig path mapping — runs first so @/foo and ~/bar specs route
  //    through user-declared aliases before we treat them as external.
  if (ctx?.tsPathMappings) {
    for (const candidate of applyPathMapping(spec, ctx.tsPathMappings)) {
      const resolved = resolveAgainstFiles(candidate, ix);
      if (resolved) return resolved;
    }
  }

  // 2. Workspace packages — @scope/name or @scope/name/subpath. Catches the
  //    cross-package imports in pnpm/yarn/npm monorepos that aren't declared
  //    in tsconfig paths.
  if (ctx?.workspaces) {
    const direct = ctx.workspaces.get(spec);
    if (direct) {
      const resolved = resolveAgainstFiles(direct.sourcePath, ix);
      if (resolved) return resolved;
    }
    for (const [pkgName, ws] of ctx.workspaces) {
      if (!spec.startsWith(pkgName + "/")) continue;
      const sub = spec.slice(pkgName.length + 1);
      // Try the subpath as written; then under src/ since that's where the
      // sources actually live in most monorepo packages.
      const a = resolveAgainstFiles(
        path.posix.join(ws.packageDir, sub),
        ix
      );
      if (a) return a;
      const b = resolveAgainstFiles(
        path.posix.join(ws.packageDir, "src", sub),
        ix
      );
      if (b) return b;
    }
  }

  // 3. Relative / absolute paths in the repo. Anything else (bare specifiers
  //    not matched by tsconfig OR workspaces) is external.
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null;

  const fromDir = path.posix.dirname(fromPath);
  // Trailing slash on relative specs interacts oddly with `..` segments
  // ("../../" normalizes one level higher than "../..") so strip it. Trailing
  // slash on import specs is rarely meaningful — at most it suggests
  // directory-with-index, which we already try below.
  const cleanSpec =
    spec.length > 1 ? spec.replace(/\/+$/, "") : spec;
  const base = path.posix.normalize(path.posix.join(fromDir, cleanSpec));
  return resolveAgainstFiles(base, ix);
}

/** Try a candidate path against the file index, including extension fallback,
 *  TS-ESM js→ts swap, and directory-with-index resolution. */
function resolveAgainstFiles(
  candidate: string,
  ix: FileIndex
): string | null {
  // Empty / "." candidate means "repo root" — happens when a file like
  // examples/auth/index.js does `import "../.."`. Look for index.* at the
  // root directly, since "/index.ts" or "./index.ts" wouldn't match the
  // unprefixed keys we store in byPath.
  if (candidate === "" || candidate === ".") {
    for (const ext of RESOLVE_EXTS) {
      const cand = `index.${ext}`;
      if (ix.byPath.has(cand)) return cand;
    }
    return null;
  }

  // Exact match — handles specs that already include the right extension
  if (ix.byPath.has(candidate)) return candidate;

  // TypeScript ESM: spec uses .js-family ext but actual file is .ts-family
  const m = candidate.match(/\.(js|jsx|mjs|cjs)$/);
  if (m) {
    const swapped =
      candidate.slice(0, -m[1].length) + JS_TO_TS[m[1]];
    if (ix.byPath.has(swapped)) return swapped;
  }

  // Append each known extension
  for (const ext of RESOLVE_EXTS) {
    const cand = `${candidate}.${ext}`;
    if (ix.byPath.has(cand)) return cand;
  }

  // Directory with index file
  for (const ext of RESOLVE_EXTS) {
    const cand = `${candidate}/index.${ext}`;
    if (ix.byPath.has(cand)) return cand;
  }

  return null;
}

// ------------------- Type extraction (TypeScript) -------------------
//
// JS files have no type annotations so these helpers always return null —
// the walker then leaves calleeType undefined for those files and
// pickCallTarget falls back to name + same-file + imported-files heuristics.
// TS files (and TSX/MTS/CTS) supply explicit types via type_annotation
// nodes that we strip down to the bare class name used in our index.

/** Pull the bare class name out of a `: Type` annotation node. The
 *  type_annotation wraps a single type expression (type_identifier,
 *  generic_type, etc.). Returns null for types we can't resolve to a
 *  named class (unions, intersections, function types, etc.). */
function extractTypeFromAnnotation(annotation: TsNode): string | null {
  for (const child of annotation.namedChildren) {
    return extractTsTypeName(child);
  }
  return null;
}

function extractTsTypeName(node: TsNode): string | null {
  switch (node.type) {
    case "type_identifier":
      return node.text;
    case "predefined_type":
      // boolean / string / number / void / etc — primitives won't match a
      // FunctionDef.containerType in our index, but return them so the
      // type-table values stay informative for debugging.
      return null;
    case "generic_type": {
      // Map<K, V> → "Map"; the first named child is the bare name.
      for (const child of node.namedChildren) {
        if (
          child.type === "type_identifier" ||
          child.type === "nested_type_identifier"
        ) {
          return extractTsTypeName(child);
        }
      }
      return null;
    }
    case "nested_type_identifier": {
      // pkg.Foo / Map.Entry → "Foo" / "Entry"
      const parts = node.text.split(".");
      return parts[parts.length - 1] ?? null;
    }
    // union_type, intersection_type, tuple_type, literal_type, function_type,
    // object_type, type_query, conditional_type — all return null. We can't
    // resolve a method call against a sum type without runtime info.
    default:
      return null;
  }
}

/** For a parameter shape (required_parameter / optional_parameter / TS
 *  variants), pull (paramName, typeName?). The pattern child is usually an
 *  identifier; we ignore destructuring patterns in v1 (rare in scope of
 *  type-aware blast-radius). */
function extractParamNameAndType(
  paramNode: TsNode
): { name: string; type: string | null; isParamProperty: boolean } | null {
  // TS `required_parameter` / `optional_parameter` have:
  //   accessibility_modifier?  pattern: identifier  type: type_annotation?
  //   value: ?
  // Plain JS `formal_parameters` has bare `identifier` children — no type.
  if (paramNode.type === "identifier") {
    return { name: paramNode.text, type: null, isParamProperty: false };
  }

  // Detect TS parameter properties (constructor(public x: Foo)) — these
  // implicitly create class fields.
  let isParamProperty = false;
  for (const child of paramNode.namedChildren) {
    if (child.type === "accessibility_modifier") {
      isParamProperty = true;
      break;
    }
  }
  // `readonly` modifier (no accessibility but still creates a field) — also
  // common in TS constructors.
  for (const child of paramNode.children) {
    if (child.type === "readonly") {
      isParamProperty = true;
      break;
    }
  }

  const patternNode = paramNode.childForFieldName("pattern");
  if (!patternNode || patternNode.type !== "identifier") return null;
  const name = patternNode.text;

  const typeNode = paramNode.childForFieldName("type");
  const type = typeNode ? extractTypeFromAnnotation(typeNode) : null;

  return { name, type, isParamProperty };
}

// ------------------- parseDirect: AST walk with type tracking -------------------
//
// Same shape as plugins/java.ts and plugins/go.ts but adapted to the JS/TS
// AST. JS files (no type annotations) gracefully degrade — the walker still
// emits ParsedFunctions with containerType from class context, and calls
// with calleeType set when receiver = `this` or `new Foo()`. Type tracking
// fires only when the source actually has type annotations.
//
// Important difference from Java/Go: JS does NOT have implicit `this` for
// bare calls inside methods. `helper()` from inside a class method does not
// mean `this.helper()` — JS requires explicit `this.helper()`. So bare calls
// have undefined calleeType (unlike Java's implicit-this convention).

interface JsClassScope {
  name: string;
  /** Field name → type. Includes regular field declarations AND constructor
   *  parameter properties (`constructor(private x: Foo)` → adds x:Foo). */
  fields: Map<string, string>;
}

interface JsMethodScope {
  name: string;
  locals: Map<string, string>;
  decisionPoints: number;
}

function parseJsDirect(file: SourceFile, ix: FileIndex): ParsedFile {
  const lang = langs[slotFor(file.ext)];
  if (!lang) {
    throw new Error(
      `javascript plugin not loaded — call plugin.load() before parseDirect()`
    );
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
  const classStack: JsClassScope[] = [];
  const methodStack: JsMethodScope[] = [];

  function currentClass(): JsClassScope | null {
    return classStack[classStack.length - 1] ?? null;
  }
  function currentMethod(): JsMethodScope | null {
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

  /** Walk a class_body to populate the class's field map with declared
   *  field types. TS public_field_definition has a type_annotation; JS
   *  field_definition doesn't. */
  function collectClassFields(classBody: TsNode): Map<string, string> {
    const out = new Map<string, string>();
    for (const member of classBody.namedChildren) {
      if (
        member.type !== "public_field_definition" &&
        member.type !== "field_definition"
      ) {
        continue;
      }
      const typeNode = member.childForFieldName("type");
      if (!typeNode) continue;
      const typeName = extractTypeFromAnnotation(typeNode);
      if (!typeName) continue;
      const propNode =
        member.childForFieldName("property") ??
        member.childForFieldName("name");
      if (propNode?.type === "property_identifier") {
        out.set(propNode.text, typeName);
      }
    }
    return out;
  }

  /** Walk a constructor's formal_parameters, looking for TS parameter
   *  properties (public/private/protected/readonly modifiers). Each match
   *  ALSO becomes an implicit field on the surrounding class. Returns the
   *  param-property entries to be merged into the class's field map. */
  function collectConstructorParamProperties(
    constructorNode: TsNode
  ): Map<string, string> {
    const out = new Map<string, string>();
    const params = constructorNode.childForFieldName("parameters");
    if (!params) return out;
    for (const p of params.namedChildren) {
      const info = extractParamNameAndType(p);
      if (info && info.isParamProperty && info.type) {
        out.set(info.name, info.type);
      }
    }
    return out;
  }

  /** Resolve the type of a call's receiver (the `object` field of a
   *  member_expression, or whatever's left of the dot). */
  function resolveReceiverType(receiver: TsNode): string | undefined {
    switch (receiver.type) {
      case "this": {
        return currentClass()?.name;
      }
      case "identifier": {
        const t = lookupVariableType(receiver.text);
        if (t) return t;
        // Bare identifier could be a class name (Foo.staticMethod()) — return
        // it so the type-table lookup gets a shot.
        return receiver.text;
      }
      case "member_expression": {
        // obj.field → look up field's type in obj's struct/class
        const inner = receiver.childForFieldName("object");
        const propNode = receiver.childForFieldName("property");
        if (!inner || !propNode) return undefined;
        const innerType = resolveReceiverType(inner);
        if (!innerType) return undefined;
        // Same trick as Go: look up the receiver type in the file-local
        // class field map. Most blast-radius-relevant cases are within one
        // file (this.field.method()).
        if (innerType === currentClass()?.name) {
          return currentClass()?.fields.get(propNode.text);
        }
        return undefined;
      }
      case "new_expression": {
        // (new Foo()).method() — the type IS Foo
        const constructorNode = receiver.childForFieldName("constructor");
        if (!constructorNode) return undefined;
        if (constructorNode.type === "identifier") return constructorNode.text;
        if (constructorNode.type === "nested_identifier") {
          const parts = constructorNode.text.split(".");
          return parts[parts.length - 1] ?? undefined;
        }
        return undefined;
      }
      case "parenthesized_expression": {
        const inner = receiver.namedChildren[0];
        return inner ? resolveReceiverType(inner) : undefined;
      }
      default:
        return undefined;
    }
  }

  /** Best-effort inference for the right-hand side of a variable_declarator
   *  when no type_annotation is present. Handles new_expression — the most
   *  common JS/TS pattern that gives us a known type. Other shapes need
   *  return-type tracking which is out of v1 scope. */
  function inferExpressionType(expr: TsNode): string | null {
    switch (expr.type) {
      case "new_expression": {
        const ctor = expr.childForFieldName("constructor");
        if (!ctor) return null;
        if (ctor.type === "identifier") return ctor.text;
        if (ctor.type === "nested_identifier") {
          const parts = ctor.text.split(".");
          return parts[parts.length - 1] ?? null;
        }
        return null;
      }
      case "as_expression": {
        // x as Foo → Foo
        const typeNode = expr.namedChildren[1];
        if (!typeNode) return null;
        return extractTsTypeName(typeNode);
      }
      default:
        return null;
    }
  }

  /** Process all method/constructor parameters into a map for the method's
   *  local scope. Constructor parameters with accessibility/readonly
   *  modifiers ALSO get added to the surrounding class's field map. */
  function collectMethodParams(methodNode: TsNode): Map<string, string> {
    const out = new Map<string, string>();
    const params = methodNode.childForFieldName("parameters");
    if (!params) return out;
    for (const p of params.namedChildren) {
      const info = extractParamNameAndType(p);
      if (info && info.type) out.set(info.name, info.type);
    }
    return out;
  }

  function visit(node: TsNode) {
    switch (node.type) {
      case "import_statement":
      case "export_statement": {
        // Find the source string. import_statement has a `source` field;
        // export_statement also has a `source` field for re-exports.
        const sourceNode = node.childForFieldName("source");
        if (!sourceNode) {
          // Not a re-export with a source — could be a type-only export
          // statement etc. Walk children for any nested calls (rare).
          for (const child of node.namedChildren) visit(child);
          return;
        }
        // sourceNode is a string node; the inner string_fragment has the
        // raw text we want.
        let spec: string | null = null;
        for (const child of sourceNode.namedChildren) {
          if (child.type === "string_fragment") {
            spec = child.text;
            break;
          }
        }
        if (spec && !seenImportSpecs.has(spec)) {
          seenImportSpecs.add(spec);
          imports.push({
            rawSpec: spec,
            resolvedPath: resolveJsImport(spec, file.rel, ix),
          });
        }
        return;
      }

      case "call_expression": {
        const fnNode = node.childForFieldName("function");
        if (fnNode) {
          // Detect require("x") / import("x") for CommonJS + dynamic imports.
          if (
            (fnNode.type === "identifier" && fnNode.text === "require") ||
            fnNode.type === "import"
          ) {
            const args = node.childForFieldName("arguments");
            if (args) {
              for (const arg of args.namedChildren) {
                if (arg.type !== "string") continue;
                let spec: string | null = null;
                for (const sub of arg.namedChildren) {
                  if (sub.type === "string_fragment") {
                    spec = sub.text;
                    break;
                  }
                }
                if (spec && !seenImportSpecs.has(spec)) {
                  seenImportSpecs.add(spec);
                  imports.push({
                    rawSpec: spec,
                    resolvedPath: resolveJsImport(spec, file.rel, ix),
                  });
                }
              }
            }
          }

          // Emit the call edge
          let calleeName: string | null = null;
          let calleeType: string | undefined;
          if (fnNode.type === "identifier") {
            calleeName = fnNode.text;
            // JS does NOT have implicit-this — bare calls inside methods
            // are global / closure refs, not class methods. Leave
            // calleeType undefined.
          } else if (fnNode.type === "member_expression") {
            const propNode = fnNode.childForFieldName("property");
            const objNode = fnNode.childForFieldName("object");
            if (propNode?.type === "property_identifier") {
              calleeName = propNode.text;
            }
            if (objNode) {
              calleeType = resolveReceiverType(objNode);
            }
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

      case "new_expression": {
        // `new Foo()` is a constructor call — calleeName = the class.
        const ctor = node.childForFieldName("constructor");
        if (ctor) {
          let className: string | null = null;
          if (ctor.type === "identifier") className = ctor.text;
          else if (ctor.type === "nested_identifier") {
            const parts = ctor.text.split(".");
            className = parts[parts.length - 1] ?? null;
          }
          if (className) {
            calls.push({
              calleeName: className,
              inFunction: currentMethod()?.name ?? null,
              calleeType: className,
            });
          }
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "class_declaration":
      case "abstract_class_declaration":
      case "class": {
        // The `name` field is missing for anonymous classes (`class { ... }`)
        const nameNode = node.childForFieldName("name");
        const className = nameNode?.text ?? "<anonymous>";
        const bodyNode = node.childForFieldName("body");
        const fields = bodyNode
          ? collectClassFields(bodyNode)
          : new Map<string, string>();

        // Detect constructor parameter properties — they implicitly become
        // class fields too.
        if (bodyNode) {
          for (const member of bodyNode.namedChildren) {
            if (member.type !== "method_definition") continue;
            const memberName =
              member.childForFieldName("name")?.text ?? "";
            if (memberName === "constructor") {
              const paramProps = collectConstructorParamProperties(member);
              for (const [k, v] of paramProps) fields.set(k, v);
            }
          }
        }

        classStack.push({ name: className, fields });
        if (bodyNode) {
          for (const child of bodyNode.namedChildren) visit(child);
        }
        classStack.pop();
        return;
      }

      case "method_definition": {
        const nameNode = node.childForFieldName("name");
        const fnName = nameNode?.text ?? "<anon>";
        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const locals = collectMethodParams(node);
        methodStack.push({ name: fnName, locals, decisionPoints: 0 });
        const body = node.childForFieldName("body");
        if (body) for (const child of body.namedChildren) visit(child);
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

      case "function_declaration":
      case "generator_function_declaration":
      case "function_expression":
      case "generator_function": {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) {
          // Anonymous function/expression. Walk body for nested decisions
          // but don't emit ParsedFunction (no name to record).
          const body = node.childForFieldName("body");
          if (body) for (const child of body.namedChildren) visit(child);
          return;
        }
        const fnName = nameNode.text;
        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const locals = collectMethodParams(node);
        methodStack.push({ name: fnName, locals, decisionPoints: 0 });
        const body = node.childForFieldName("body");
        if (body) for (const child of body.namedChildren) visit(child);
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

      case "variable_declarator": {
        // const/let with explicit type? With an arrow function value?
        const nameNode = node.childForFieldName("name");
        const typeNode = node.childForFieldName("type"); // type_annotation
        const valueNode = node.childForFieldName("value");

        // 1. Track type if name is a plain identifier and we have either an
        //    annotation or an inferable rhs.
        if (nameNode?.type === "identifier") {
          let typeName: string | null = null;
          if (typeNode) {
            typeName = extractTypeFromAnnotation(typeNode);
          } else if (valueNode) {
            typeName = inferExpressionType(valueNode);
          }
          if (typeName) {
            const m = currentMethod();
            if (m) m.locals.set(nameNode.text, typeName);
          }
        }

        // 2. Arrow-function or function-expression assigned to a name?
        //    Emit it as a ParsedFunction with the variable's name.
        if (
          nameNode?.type === "identifier" &&
          valueNode &&
          (valueNode.type === "arrow_function" ||
            valueNode.type === "function_expression")
        ) {
          const fnName = nameNode.text;
          const startRow = nameNode.startPosition.row;
          const endRow = valueNode.endPosition.row;
          const params = valueNode.childForFieldName("parameters");
          const locals = new Map<string, string>();
          if (params) {
            for (const p of params.namedChildren) {
              const info = extractParamNameAndType(p);
              if (info && info.type) locals.set(info.name, info.type);
            }
          }
          methodStack.push({ name: fnName, locals, decisionPoints: 0 });
          const body = valueNode.childForFieldName("body");
          if (body) {
            // body could be a statement_block or an expression (for arrow
            // functions like `() => 1`). Walk either way.
            if (body.type === "statement_block") {
              for (const child of body.namedChildren) visit(child);
            } else {
              visit(body);
            }
          }
          const ms = methodStack.pop()!;
          functions.push({
            name: fnName,
            startRow,
            endRow,
            complexity: 1 + ms.decisionPoints,
            containerType: currentClass()?.name,
          });
          return; // already visited the body above
        }

        // 3. Otherwise just walk children for nested calls/decisions
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "if_statement":
      case "while_statement":
      case "for_statement":
      case "for_in_statement":
      case "do_statement":
      case "switch_case":
      case "ternary_expression":
      case "catch_clause":
        countDecisionPoint();
        for (const child of node.namedChildren) visit(child);
        return;

      case "binary_expression": {
        const op = node.childForFieldName("operator")?.text;
        if (op === "&&" || op === "||" || op === "??") countDecisionPoint();
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

export const javascriptPlugin = {
  name: PLUGIN_NAME,
  extensions: EXTENSIONS,

  async load() {
    if (langs.javascript && langs.typescript && langs.tsx) return;
    const [js, ts, tsx] = await Promise.all([
      loadBuiltinGrammar("tree-sitter-javascript"),
      loadBuiltinGrammar("tree-sitter-typescript"),
      loadBuiltinGrammar("tree-sitter-tsx"),
    ]);
    langs.javascript = js;
    langs.typescript = ts;
    langs.tsx = tsx;
  },

  async prepareForRepo(root, ix) {
    // Load both in parallel — neither blocks the other and both are
    // small fs ops next to the parse pipeline that follows.
    const [tsPathMappings, workspaces] = await Promise.all([
      loadTsconfigPaths(root),
      loadWorkspacePackages(root),
    ]);
    const ctx: JsResolverContext = {};
    if (tsPathMappings) ctx.tsPathMappings = tsPathMappings;
    if (workspaces.size > 0) ctx.workspaces = workspaces;
    if (ctx.tsPathMappings || ctx.workspaces) {
      ix.extras.set(PLUGIN_NAME, ctx);
    }
  },

  languageFor(ext) {
    const lang = langs[slotFor(ext)];
    if (!lang) {
      throw new Error(
        `javascript plugin not loaded — call plugin.load() before languageFor()`
      );
    }
    return lang;
  },

  queriesFor(_ext): PluginQueries {
    // All extensions share the same queries — node names are consistent
    // across the JS / TS / TSX grammar family. Kept defined for any caller
    // that prefers the standard pipeline; the orchestrator routes through
    // parseDirect since v0.17.
    return QUERIES;
  },

  parseDirect: parseJsDirect,

  resolveImport: resolveJsImport,
} satisfies CodeAnalysisPlugin;
