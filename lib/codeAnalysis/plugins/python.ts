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
import type { Language } from "web-tree-sitter";
import type { CodeAnalysisPlugin, FileIndex, PluginQueries } from "../types";
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
    return QUERIES;
  },

  resolveImport: resolvePythonImport,
} satisfies CodeAnalysisPlugin;
