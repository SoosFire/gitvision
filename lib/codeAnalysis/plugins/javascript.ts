// JavaScript / TypeScript plugin.
//
// Covers the JS family (.js, .jsx, .mjs, .cjs) plus TypeScript (.ts, .tsx).
// They share the same module system so they live in one plugin, but TS needs
// its own grammar for type annotations and .tsx needs the tsx grammar for
// JSX syntax inside a typed file. Three grammars, one plugin.

import path from "node:path";
import type { Language } from "web-tree-sitter";
import type { CodeAnalysisPlugin, FileIndex, PluginQueries } from "../types";
import { loadBuiltinGrammar } from "../runtime";

const EXTENSIONS = ["js", "jsx", "mjs", "cjs", "ts", "tsx"] as const;

type GrammarSlot = "javascript" | "typescript" | "tsx";

const langs: Record<GrammarSlot, Language | null> = {
  javascript: null,
  typescript: null,
  tsx: null,
};

function slotFor(ext: string): GrammarSlot {
  if (ext === "ts") return "typescript";
  if (ext === "tsx") return "tsx";
  return "javascript"; // js, jsx, mjs, cjs
}

// ------------------- Tree-sitter queries -------------------
//
// Capture names must match the canonical set in types.ts:
//   @spec, @name, @callee, @body, @params
// Other captures (prefixed with a name starting with `_` or anything not in
// the canonical set) are used internally by query predicates and ignored by
// the orchestrator.

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

// Cyclomatic complexity: +1 for each decision point. Standard McCabe counting:
// if / each case / while / for / do / ternary / catch / short-circuit operators.
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
//
// Ported from lib/graph.ts:resolveJsImport. Same contract: only resolves
// relative/absolute paths within the repo. External packages (no leading . or
// /) return null — callers may still count them but won't draw edges.

const JS_EXTS = ["ts", "tsx", "js", "jsx", "mjs", "cjs"];

function resolveJsImport(
  spec: string,
  fromPath: string,
  ix: FileIndex
): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null;

  const fromDir = path.posix.dirname(fromPath);
  const base = path.posix.normalize(path.posix.join(fromDir, spec));

  // Exact path (spec includes extension)
  if (ix.byPath.has(base)) return base;

  // Try each known extension
  for (const ext of JS_EXTS) {
    const cand = `${base}.${ext}`;
    if (ix.byPath.has(cand)) return cand;
  }

  // Try as a directory with an index file
  for (const ext of JS_EXTS) {
    const cand = `${base}/index.${ext}`;
    if (ix.byPath.has(cand)) return cand;
  }

  return null;
}

// ------------------- Plugin -------------------

export const javascriptPlugin: CodeAnalysisPlugin = {
  name: "javascript",
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
    // All six extensions share the same queries — node names are consistent
    // across the JS / TS / TSX grammar family.
    return QUERIES;
  },

  resolveImport: resolveJsImport,
};
