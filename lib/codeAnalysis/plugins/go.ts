// Go plugin — second migration off the regex-fallback.
//
// Mirrors plugins/python.ts and plugins/javascript.ts:
//   - Tree-sitter queries with the canonical capture names
//   - prepareForRepo loads go.mod to discover the local module path,
//     stashes it in ix.extras for resolveImport
//   - resolveImport: if the spec starts with the local module path, strip
//     it and look up in FileIndex; otherwise fall back to a suffix-match
//     heuristic (matches how lib/graph.ts:parseGo resolved imports without
//     reading go.mod, useful for monorepos / vendored modules / repos
//     without a root go.mod)

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Language } from "web-tree-sitter";
import type { CodeAnalysisPlugin, FileIndex, PluginQueries } from "../types";
import { loadBuiltinGrammar } from "../runtime";

const PLUGIN_NAME = "go";
const EXTENSIONS = ["go"] as const;

let lang: Language | null = null;

interface GoResolverContext {
  /** The repo's local module path from go.mod, e.g. "github.com/owner/repo".
   *  null if go.mod is absent or doesn't declare a module. */
  modulePath: string | null;
}

// ------------------- Tree-sitter queries -------------------

/** Captures every import path string. tree-sitter-go represents both single
 *  and grouped (`import (...)`) imports as a list of import_spec nodes — so
 *  one pattern covers both forms. The captured node is the whole
 *  interpreted_string_literal including the quotes; resolveGoImport strips
 *  them. */
const IMPORTS_QUERY = `
(import_spec path: (interpreted_string_literal) @spec)
`;

/** Top-level functions and methods. Method receivers don't change the body
 *  shape, so one capture per kind is enough. */
const FUNCTION_DEFS_QUERY = `
(function_declaration name: (identifier) @name body: (block) @body)
(method_declaration name: (field_identifier) @name body: (block) @body)
`;

/** Bare-identifier calls and selector calls (pkg.Foo() or obj.Method()).
 *  Selector calls capture the rightmost field — same convention as the JS
 *  plugin's member_expression handling. */
const CALL_SITES_QUERY = `
(call_expression function: (identifier) @callee)
(call_expression function: (selector_expression field: (field_identifier) @callee))
`;

/** McCabe decision points for Go. Notes:
 *  - if_statement covers if + else if (else if is a nested if_statement
 *    inside an else clause)
 *  - for_statement covers C-style, while-style, range-style — all branches
 *  - expression_case / type_case / communication_case are the case-clause
 *    nodes for the three switch flavors
 *  - default_case intentionally NOT counted (matches the JS plugin's
 *    convention of counting case but not default)
 *  - binary_expression with && or ||
 */
const DECISION_POINTS_QUERY = `
(if_statement) @p
(for_statement) @p
(expression_case) @p
(type_case) @p
(communication_case) @p
(binary_expression operator: "&&") @p
(binary_expression operator: "||") @p
`;

const QUERIES: PluginQueries = {
  imports: IMPORTS_QUERY,
  functionDefs: FUNCTION_DEFS_QUERY,
  callSites: CALL_SITES_QUERY,
  decisionPoints: DECISION_POINTS_QUERY,
};

// ------------------- Import resolution -------------------

const STRING_QUOTES_RE = /^["`]|["`]$/g;

function resolveGoImport(
  spec: string,
  _fromPath: string,
  ix: FileIndex
): string | null {
  // Strip the surrounding quotes that tree-sitter captured along with the
  // interpreted_string_literal.
  const importPath = spec.replace(STRING_QUOTES_RE, "");
  if (!importPath) return null;

  const ctx = ix.extras.get(PLUGIN_NAME) as GoResolverContext | undefined;

  // 1. Local-module path match: strip the module prefix, look up the
  //    resulting directory's first .go file. This is the accurate path
  //    when go.mod is present and the import is internal.
  if (ctx?.modulePath) {
    const prefix = ctx.modulePath;
    if (importPath === prefix) {
      // Importing the module root — find any .go file at the repo root
      const root = findGoFileInDir("", ix);
      if (root) return root;
    } else if (importPath.startsWith(prefix + "/")) {
      const subpath = importPath.slice(prefix.length + 1);
      const hit = findGoFileInDir(subpath, ix);
      if (hit) return hit;
    }
  }

  // 2. Suffix-match heuristic (ported from lib/graph.ts:parseGo). Useful
  //    when go.mod isn't at the root, when importing a sub-module via a
  //    different path prefix, or when the module declaration is missing.
  const parts = importPath.split("/");
  for (let take = Math.min(parts.length, 4); take >= 1; take--) {
    const suffix = parts.slice(-take).join("/");
    const hit = findGoFileBySuffix(suffix, ix);
    if (hit) return hit;
  }

  return null;
}

/** Find the first .go file inside a given repo-rel directory. Returns the
 *  alphabetically-first match for determinism. Empty `dir` means the repo
 *  root. */
function findGoFileInDir(dir: string, ix: FileIndex): string | null {
  const candidates: string[] = [];
  const prefix = dir === "" ? "" : dir.replace(/\/$/, "") + "/";
  for (const key of ix.byPath.keys()) {
    if (!key.endsWith(".go")) continue;
    if (prefix === "") {
      // Root-level: file is at top of repo (no slash in path)
      if (!key.includes("/")) candidates.push(key);
    } else {
      // file is direct child of prefix (no further nesting)
      if (key.startsWith(prefix) && !key.slice(prefix.length).includes("/")) {
        candidates.push(key);
      }
    }
  }
  candidates.sort();
  return candidates[0] ?? null;
}

/** Find a .go file whose path matches a directory suffix. Used as the
 *  fallback resolution when go.mod doesn't tell us anything useful. */
function findGoFileBySuffix(suffix: string, ix: FileIndex): string | null {
  const candidates: string[] = [];
  for (const key of ix.byPath.keys()) {
    if (!key.endsWith(".go")) continue;
    if (
      key.startsWith(`${suffix}/`) ||
      key.includes(`/${suffix}/`) ||
      path.posix.dirname(key).endsWith(suffix)
    ) {
      candidates.push(key);
    }
  }
  candidates.sort();
  return candidates[0] ?? null;
}

// ------------------- Plugin -------------------

export const goPlugin = {
  name: PLUGIN_NAME,
  extensions: EXTENSIONS,

  async load() {
    if (lang) return;
    lang = await loadBuiltinGrammar("tree-sitter-go");
  },

  async prepareForRepo(root: string, ix: FileIndex) {
    // Read the root go.mod for the local module path. Repos without a
    // root-level go.mod (sub-module layouts, library-only repos, very old
    // GOPATH-era code) gracefully degrade to the suffix-match heuristic.
    let modulePath: string | null = null;
    try {
      const content = await fs.readFile(path.join(root, "go.mod"), "utf-8");
      const m = /^\s*module\s+(\S+)/m.exec(content);
      if (m) modulePath = m[1];
    } catch {
      // No go.mod — suffix-only resolution
    }
    const ctx: GoResolverContext = { modulePath };
    ix.extras.set(PLUGIN_NAME, ctx);
  },

  languageFor(_ext) {
    if (!lang) {
      throw new Error(
        `go plugin not loaded — call plugin.load() before languageFor()`
      );
    }
    return lang;
  },

  queriesFor(_ext): PluginQueries {
    return QUERIES;
  },

  resolveImport: resolveGoImport,
} satisfies CodeAnalysisPlugin;
