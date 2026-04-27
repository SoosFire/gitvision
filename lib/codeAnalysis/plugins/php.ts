// PHP plugin — fifth migration off the regex-fallback (v0.22).
//
// Same parseDirect + Phase 5 type-aware shape as Java/C#. PHP's namespace
// system is structurally identical to those (FQN = `Vendor\Package\Class`),
// it just uses backslash separators and richer per-call-site syntax (->, ::).
//
// PHP-specific shapes worth knowing about:
//
//   1. Multiple call AST nodes:
//      - `member_call_expression` — `$obj->method()`
//      - `scoped_call_expression` — `Foo::method()` / `self::method()` /
//        `parent::method()` / `static::method()`
//      - `function_call_expression` — bare `func()` (top-level functions)
//      - `object_creation_expression` — `new Foo()`
//      All emit ParsedCall edges with appropriate calleeType.
//
//   2. Variables are explicit ($foo). The `variable_name` AST node wraps a
//      `name` child holding the bare identifier (no $). We strip the $ when
//      storing names in the type-tracking maps so lookup keys are consistent.
//
//   3. Constructor parameter promotion (PHP 8+): `public Logger $logger` in
//      a __construct signature creates BOTH a parameter and an implicit
//      property. We extract these as fields when scanning the class body.
//
//   4. `optional_type` is PHP's `?Foo` (where C# / Java / TS use
//      `nullable_type` / `Foo?`). Recurses to the inner type.
//
//   5. Two function-defining shapes: `function_definition` (top-level) and
//      `method_declaration` (in class body). Both emit ParsedFunction;
//      method_declaration sets containerType to the enclosing class.
//
//   6. PHP 8 `match` expression: each `match_conditional_expression` arm is
//      a decision point. `match_default_expression` doesn't count, mirror
//      of how `case`/`default` are handled in switch statements.

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

const PLUGIN_NAME = "php";
const EXTENSIONS = ["php"] as const;

let lang: Language | null = null;

// ------------------- Module-level resolver context -------------------

interface PhpResolverContext {
  /** FQN ("App\Services\UserService") → repo-rel path. Note backslash
   *  separator — kept native to PHP's actual `use` syntax for direct lookup. */
  fqnToPath: Map<string, string>;
  /** Namespace ("App\Services") → repo-rel paths. PHP doesn't have
   *  wildcard `use` (each `use` brings in one specific symbol), but `use
   *  App\Services;` IS valid and aliases the namespace itself — for blast
   *  radius purposes we want SOME edge to a representative file. */
  namespaceMembers: Map<string, string[]>;
}

// First namespace declaration. Both block (`namespace X\Y { ... }`) and
// file-scoped (`namespace X\Y;`) forms terminate with `;` or `{`. PHP
// allows multiple namespaces per file via the block form — we take the
// first one. Multi-namespace files lose precision; rare in practice.
const NAMESPACE_RE = /^\s*namespace\s+([A-Za-z_][A-Za-z0-9_\\]*)\s*[;{]/m;

// Top-level class/interface/trait names. PHP's enum (PHP 8.1+) is a fourth
// container kind we also index.
const TYPE_DECL_RE =
  /(?:^|\n)\s*(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+([A-Z][A-Za-z0-9_]*)/g;

// ------------------- Index construction -------------------

function buildPhpContext(ix: FileIndex): PhpResolverContext {
  const fqnToPath = new Map<string, string>();
  const namespaceMembers = new Map<string, string[]>();

  for (const f of ix.byPath.values()) {
    if (f.ext !== "php") continue;
    const head = f.content.slice(0, 8192);
    const nsMatch = NAMESPACE_RE.exec(head);
    const ns = nsMatch?.[1] ?? null;
    TYPE_DECL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TYPE_DECL_RE.exec(f.content)) !== null) {
      const typeName = m[1];
      const fqn = ns ? `${ns}\\${typeName}` : typeName;
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
    // Defensive: file with namespace but no detectable type still ties to
    // the namespace (matches the C# plugin's pattern).
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

function resolvePhpImport(
  spec: string,
  _fromPath: string,
  ix: FileIndex
): string | null {
  const ctx = ix.extras.get(PLUGIN_NAME) as PhpResolverContext | undefined;
  if (!ctx) return null;
  // `use App\Models\User;` direct match
  const direct = ctx.fqnToPath.get(spec);
  if (direct) return direct;
  // `use App\Models;` — namespace-only match (alphabetically first member)
  const members = ctx.namespaceMembers.get(spec);
  if (members && members.length > 0) return members[0];
  return null;
}

// ------------------- Tree-sitter queries (kept for reference) -------------------

const QUERIES: PluginQueries = {
  imports: `(namespace_use_clause (qualified_name) @spec)`,
  functionDefs: `
    (method_declaration name: (name) @name body: (compound_statement) @body)
    (function_definition name: (name) @name body: (compound_statement) @body)
  `,
  callSites: `
    (function_call_expression (name) @callee)
    (member_call_expression name: (name) @callee)
    (scoped_call_expression name: (name) @callee)
    (object_creation_expression (name) @callee)
  `,
  decisionPoints: `
    (if_statement) @p
    (while_statement) @p
    (for_statement) @p
    (foreach_statement) @p
    (do_statement) @p
    (catch_clause) @p
    (case_statement) @p
    (match_conditional_expression) @p
    (binary_expression operator: "&&") @p
    (binary_expression operator: "||") @p
    (conditional_expression) @p
    (else_if_clause) @p
  `,
};

// ------------------- Type extraction -------------------

/** Extract a type name (bare class name) from a PHP type AST node. Returns
 *  null for primitives, union/intersection types, and shapes we can't
 *  statically resolve. */
function extractTypeName(node: TsNode): string | null {
  switch (node.type) {
    case "named_type": {
      // named_type wraps a `name` or `qualified_name` child
      for (const child of node.namedChildren) {
        if (child.type === "name") return child.text;
        if (child.type === "qualified_name") {
          const parts = child.text.split("\\");
          return parts[parts.length - 1] ?? null;
        }
      }
      return null;
    }
    case "qualified_name": {
      const parts = node.text.split("\\");
      return parts[parts.length - 1] ?? null;
    }
    case "name":
      return node.text;
    case "primitive_type":
      // string, int, bool, void, null, never, mixed, ... — no class to look up
      return null;
    case "optional_type": {
      // ?Foo — recurse on the inner non-? type
      for (const child of node.namedChildren) {
        const inner = extractTypeName(child);
        if (inner) return inner;
      }
      return null;
    }
    // union_type, intersection_type, disjunctive_normal_form_type — too
    // ambiguous to pick a single class. Skip in v1.
    default:
      return null;
  }
}

/** PHP variable_name's text includes the `$`. Strip it for consistent
 *  storage in our type maps. */
function bareVariableName(varNode: TsNode): string | null {
  if (varNode.type !== "variable_name") return null;
  // First named child should be a `name` node holding the bare identifier
  for (const child of varNode.namedChildren) {
    if (child.type === "name") return child.text;
  }
  // Fallback: strip $ from text
  return varNode.text.startsWith("$") ? varNode.text.slice(1) : varNode.text;
}

/** Walk a class/trait body for property declarations + constructor-promoted
 *  parameters, return name→type map. */
function collectMemberTypes(classBody: TsNode): Map<string, string> {
  const out = new Map<string, string>();

  for (const child of classBody.namedChildren) {
    if (child.type === "property_declaration") {
      const typeNode = child.childForFieldName("type");
      if (!typeNode) continue;
      const typeName = extractTypeName(typeNode);
      if (!typeName) continue;
      // property_declaration may have multiple property_element children:
      // `private Foo $a, $b, $c;`
      for (const sub of child.namedChildren) {
        if (sub.type !== "property_element") continue;
        for (const inner of sub.namedChildren) {
          if (inner.type === "variable_name") {
            const propName = bareVariableName(inner);
            if (propName) out.set(propName, typeName);
            break;
          }
        }
      }
    } else if (child.type === "method_declaration") {
      // Constructor parameter promotion (PHP 8): `public Logger $logger` in
      // __construct creates an implicit property. Pull these out from the
      // formal_parameters, skip non-promoted params (they're just locals).
      const nameNode = child.childForFieldName("name");
      if (nameNode?.text !== "__construct") continue;
      const params = child.childForFieldName("parameters");
      if (!params) continue;
      for (const p of params.namedChildren) {
        if (p.type !== "property_promotion_parameter") continue;
        const typeNode = p.childForFieldName("type");
        const nameNode = p.childForFieldName("name");
        if (!typeNode || !nameNode) continue;
        const typeName = extractTypeName(typeNode);
        if (!typeName) continue;
        const propName = bareVariableName(nameNode);
        if (propName) out.set(propName, typeName);
      }
    }
  }

  return out;
}

/** Walk a method/function's formal_parameters, return name→type map.
 *  Includes both simple_parameter and property_promotion_parameter (the
 *  latter is also visible as a local inside the method body). */
function collectParamTypes(methodNode: TsNode): Map<string, string> {
  const out = new Map<string, string>();
  const params = methodNode.childForFieldName("parameters");
  if (!params) return out;
  for (const p of params.namedChildren) {
    if (
      p.type !== "simple_parameter" &&
      p.type !== "property_promotion_parameter" &&
      p.type !== "variadic_parameter"
    ) {
      continue;
    }
    const typeNode = p.childForFieldName("type");
    const nameNode = p.childForFieldName("name");
    if (!typeNode || !nameNode) continue;
    const typeName = extractTypeName(typeNode);
    if (!typeName) continue;
    const paramName = bareVariableName(nameNode);
    if (paramName) out.set(paramName, typeName);
  }
  return out;
}

/** Try to infer the type of an `$x = new Foo()` initializer assignment. */
function inferInitializerType(initNode: TsNode | null): string | null {
  if (!initNode) return null;
  if (initNode.type !== "object_creation_expression") return null;
  // First named child is the class name (or qualified_name)
  for (const child of initNode.namedChildren) {
    if (child.type === "name" || child.type === "qualified_name") {
      return extractTypeName(child);
    }
  }
  return null;
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

function parsePhpDirect(file: SourceFile, _ix: FileIndex): ParsedFile {
  if (!lang) {
    throw new Error("php plugin not loaded — call plugin.load() first");
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

  /** Resolve the calleeType from a member_call_expression's `object` field. */
  function resolveMemberCallType(receiver: TsNode | null): string | undefined {
    const cls = currentClass();
    if (!receiver) return undefined;
    switch (receiver.type) {
      case "variable_name": {
        const bare = bareVariableName(receiver);
        if (!bare) return undefined;
        if (bare === "this") return cls?.name ?? undefined;
        const t = lookupVariableType(bare);
        return t ?? undefined;
      }
      case "member_access_expression": {
        // `$this->field->method()` — field on current class
        const obj = receiver.childForFieldName("object");
        const memberName = receiver.childForFieldName("name")?.text;
        if (!memberName) return undefined;
        if (obj?.type === "variable_name" && bareVariableName(obj) === "this") {
          return cls?.fields.get(memberName);
        }
        return undefined;
      }
      // member_call_expression (chained), etc. — would need return-type
      // tracking. Skip in v1.
      default:
        return undefined;
    }
  }

  /** Resolve the calleeType from a scoped_call_expression's `scope` field. */
  function resolveScopedCallType(scope: TsNode | null): string | undefined {
    const cls = currentClass();
    if (!scope) return undefined;
    switch (scope.type) {
      case "relative_scope": {
        // self / static / parent
        if (scope.text === "self" || scope.text === "static") {
          return cls?.name ?? undefined;
        }
        // parent — would need inheritance tracking
        return undefined;
      }
      case "name":
        // `Foo::method()` — explicit class
        return scope.text;
      case "qualified_name": {
        // `App\Services\Foo::method()` — last segment is the bare class
        const parts = scope.text.split("\\");
        return parts[parts.length - 1] ?? undefined;
      }
      default:
        return undefined;
    }
  }

  function visit(node: TsNode) {
    switch (node.type) {
      case "namespace_use_declaration": {
        // Each child is a namespace_use_clause containing a qualified_name
        // (or just `name` for single-segment imports).
        for (const clause of node.namedChildren) {
          if (clause.type !== "namespace_use_clause") continue;
          let spec: string | null = null;
          for (const child of clause.namedChildren) {
            if (child.type === "qualified_name" || child.type === "name") {
              spec = child.text;
              break;
            }
          }
          if (spec && !seenImportSpecs.has(spec)) {
            seenImportSpecs.add(spec);
            imports.push({
              rawSpec: spec,
              resolvedPath: resolvePhpImport(spec, file.rel, _ix),
            });
          }
        }
        return;
      }

      case "class_declaration":
      case "interface_declaration":
      case "trait_declaration":
      case "enum_declaration": {
        const nameNode = node.childForFieldName("name");
        const className = nameNode?.text ?? "<anon>";
        const bodyNode = node.childForFieldName("body");
        const fields = bodyNode
          ? collectMemberTypes(bodyNode)
          : new Map<string, string>();
        classStack.push({ name: className, fields });

        // Also emit `extends` and `implements` edges so the Imports tab
        // shows them (parity with regex-fallback behavior). The base_clause
        // and class_interface_clause hold one or more name children.
        for (const child of node.namedChildren) {
          if (child.type === "base_clause") {
            for (const c of child.namedChildren) {
              if (c.type === "name" || c.type === "qualified_name") {
                imports.push({
                  rawSpec: c.text,
                  resolvedPath: resolvePhpImport(c.text, file.rel, _ix),
                  kind: "extends",
                });
              }
            }
          } else if (child.type === "class_interface_clause") {
            for (const c of child.namedChildren) {
              if (c.type === "name" || c.type === "qualified_name") {
                imports.push({
                  rawSpec: c.text,
                  resolvedPath: resolvePhpImport(c.text, file.rel, _ix),
                  kind: "implements",
                });
              }
            }
          }
        }

        if (bodyNode) {
          for (const child of bodyNode.namedChildren) visit(child);
        }
        classStack.pop();
        return;
      }

      case "method_declaration":
      case "function_definition": {
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

      case "assignment_expression": {
        // `$x = new Foo()` — track $x as type Foo when initializer is an
        // object_creation_expression. Variable on the left, expression on
        // the right (left/right field names per the PHP grammar).
        const left = node.childForFieldName("left");
        const right = node.childForFieldName("right");
        if (left?.type === "variable_name") {
          const varName = bareVariableName(left);
          if (varName && right) {
            const inferred = inferInitializerType(right);
            if (inferred) {
              const m = currentMethod();
              if (m) m.locals.set(varName, inferred);
            }
          }
        }
        // Continue visiting — initializers may have nested calls/decisions
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "member_call_expression": {
        // `$obj->method(args)`
        const calleeName = node.childForFieldName("name")?.text;
        const receiver = node.childForFieldName("object");
        if (calleeName) {
          calls.push({
            calleeName,
            inFunction: currentMethod()?.name ?? null,
            calleeType: resolveMemberCallType(receiver),
          });
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "scoped_call_expression": {
        // `Foo::method()` / `self::method()`
        const calleeName = node.childForFieldName("name")?.text;
        const scope = node.childForFieldName("scope");
        if (calleeName) {
          calls.push({
            calleeName,
            inFunction: currentMethod()?.name ?? null,
            calleeType: resolveScopedCallType(scope),
          });
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "function_call_expression": {
        // Bare `func()` — top-level function call. The function name is
        // either `name` (simple) or `qualified_name` (namespaced) as a
        // named child (no field).
        let calleeName: string | null = null;
        for (const child of node.namedChildren) {
          if (child.type === "name") {
            calleeName = child.text;
            break;
          }
          if (child.type === "qualified_name") {
            const parts = child.text.split("\\");
            calleeName = parts[parts.length - 1] ?? null;
            break;
          }
        }
        if (calleeName) {
          calls.push({
            calleeName,
            inFunction: currentMethod()?.name ?? null,
            // No receiver — leave calleeType undefined unless we wanted
            // to pretend it's the current class. PHP allows free
            // functions and inside-class function calls without
            // explicit receiver, so untyped is honest.
          });
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "object_creation_expression": {
        // `new Foo(args)` — calleeName = the class itself
        let typeName: string | null = null;
        for (const child of node.namedChildren) {
          if (child.type === "name" || child.type === "qualified_name") {
            typeName = extractTypeName(child);
            break;
          }
        }
        if (typeName) {
          calls.push({
            calleeName: typeName,
            inFunction: currentMethod()?.name ?? null,
            calleeType: typeName,
          });
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "if_statement":
      case "while_statement":
      case "for_statement":
      case "foreach_statement":
      case "do_statement":
      case "catch_clause":
      case "case_statement":
      case "match_conditional_expression":
      case "conditional_expression":
      case "else_if_clause":
        // PHP-specific: `elseif (cond) { ... }` parses as its own node, a
        // child of the parent if_statement (alongside else_clause). Each
        // elseif is a separate branch and counts as a McCabe decision
        // point. (The two-word form `else if` parses as if_statement nested
        // inside else_clause, so it's already counted by the if_statement
        // case above — both syntactic forms are equivalent.)
        countDecisionPoint();
        for (const child of node.namedChildren) visit(child);
        return;

      case "binary_expression": {
        const op = node.childForFieldName("operator")?.text;
        if (op === "&&" || op === "||" || op === "and" || op === "or") {
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

export const phpPlugin = {
  name: PLUGIN_NAME,
  extensions: EXTENSIONS,

  async load() {
    if (lang) return;
    lang = await loadBuiltinGrammar("tree-sitter-php");
  },

  async prepareForRepo(_root: string, ix: FileIndex) {
    ix.extras.set(PLUGIN_NAME, buildPhpContext(ix));
  },

  languageFor(_ext) {
    if (!lang) {
      throw new Error(
        `php plugin not loaded — call plugin.load() before languageFor()`
      );
    }
    return lang;
  },

  queriesFor(_ext): PluginQueries {
    return QUERIES;
  },

  parseDirect: parsePhpDirect,

  resolveImport: resolvePhpImport,
} satisfies CodeAnalysisPlugin;
