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
    // across the JS / TS / TSX grammar family.
    return QUERIES;
  },

  resolveImport: resolveJsImport,
} satisfies CodeAnalysisPlugin;
