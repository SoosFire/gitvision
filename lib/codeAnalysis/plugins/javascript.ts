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
import type { Language } from "web-tree-sitter";
import type { CodeAnalysisPlugin, FileIndex, PluginQueries } from "../types";
import { loadBuiltinGrammar } from "../runtime";
import {
  applyPathMapping,
  loadTsconfigPaths,
  type TsPathMappings,
} from "../tsconfig";

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
  // 1. tsconfig path mapping — runs first so @/foo and ~/bar specs route
  //    through user-declared aliases before we treat them as external.
  const mappings = ix.extras.get(PLUGIN_NAME) as
    | TsPathMappings
    | undefined;
  if (mappings) {
    for (const candidate of applyPathMapping(spec, mappings)) {
      const resolved = resolveAgainstFiles(candidate, ix);
      if (resolved) return resolved;
    }
  }

  // 2. Relative / absolute paths in the repo. Anything else (bare specifiers
  //    not matched by tsconfig) is external.
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null;

  const fromDir = path.posix.dirname(fromPath);
  const base = path.posix.normalize(path.posix.join(fromDir, spec));
  return resolveAgainstFiles(base, ix);
}

/** Try a candidate path against the file index, including extension fallback,
 *  TS-ESM js→ts swap, and directory-with-index resolution. */
function resolveAgainstFiles(
  candidate: string,
  ix: FileIndex
): string | null {
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

// ------------------- Plugin -------------------

export const javascriptPlugin: CodeAnalysisPlugin = {
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
    const tsConfig = await loadTsconfigPaths(root);
    if (tsConfig) ix.extras.set(PLUGIN_NAME, tsConfig);
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
    // across the JS / TS / TSX grammar family.
    return QUERIES;
  },

  resolveImport: resolveJsImport,
};
