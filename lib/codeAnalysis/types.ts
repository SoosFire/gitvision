// Shared types for the codeAnalysis plugin architecture.
//
// Each language implements CodeAnalysisPlugin. The orchestrator runs the same
// pipeline against every plugin whose extensions are present:
//   tarball → per-file: pick grammar → parse → run queries → collect symbols
//   → cross-file resolution (plugin-supplied) → call-graph + complexity.
//
// Adding a new language = one file in ./plugins/ implementing CodeAnalysisPlugin.
// The orchestrator must never contain language-specific branches.

import type { Language } from "web-tree-sitter";

/** Canonical capture names the orchestrator understands. Query strings must
 *  use exactly these names on the nodes the orchestrator will read from the
 *  match; anything else is ignored. Keeps the plugin-to-orchestrator contract
 *  data-driven instead of a callback for every capture kind. */
export type Capture = "spec" | "name" | "callee" | "body" | "params";

/** A source file with enough metadata to parse + locate it in the repo. */
export interface SourceFile {
  /** Path relative to repo root (posix-style), e.g. "src/api/foo.ts". */
  rel: string;
  /** Lowercase extension without the dot, e.g. "ts". */
  ext: string;
  content: string;
}

/** Lookup maps provided to plugins during cross-file resolution. */
export interface FileIndex {
  byPath: Map<string, SourceFile>;
  byExt: Map<string, SourceFile[]>;
  /** Per-plugin opaque storage keyed by plugin.name. Plugins that need
   *  per-repo config (tsconfig paths, go.mod module path, etc.) populate
   *  this in their `prepareForRepo` hook and read it in `resolveImport`.
   *  Other plugins ignore unrelated keys. Keeps language-specific data
   *  out of orchestrator code. */
  extras: Map<string, unknown>;
}

/** Tree-sitter query sources (S-expressions). The orchestrator compiles each
 *  non-null entry against the plugin's Language once per analysis run. Leave
 *  a category null to skip it for this plugin. */
export interface PluginQueries {
  imports?: string;
  functionDefs?: string;
  callSites?: string;
  decisionPoints?: string;
}

/** Contract every language plugin implements. */
export interface CodeAnalysisPlugin {
  /** Stable identifier, also used in CodeGraph.stats.byPlugin. */
  readonly name: string;
  /** Extensions this plugin handles (no dot, lowercase). */
  readonly extensions: readonly string[];

  /** Load and cache tree-sitter Language(s) for this plugin. Called once per
   *  analysis run. Idempotent — safe to call repeatedly. */
  load(): Promise<void>;

  /** Optional per-repo setup. Called once per `analyzeDirectory` run, after
   *  the FileIndex is built but before any parseFile call. Use this to read
   *  language-specific config files (tsconfig.json, jsconfig.json, go.mod,
   *  ...) and stash them on `ix.extras` keyed by the plugin's name. */
  prepareForRepo?(root: string, ix: FileIndex): Promise<void>;

  /** Pick the Language to use for a given extension. Must be called after load(). */
  languageFor(ext: string): Language;

  /** Return the query sources to compile for this extension. Plugins that use
   *  the same queries across all their extensions can return the same object. */
  queriesFor(ext: string): PluginQueries;

  /** Resolve an import-spec captured by the `imports` query to a repo-relative
   *  file path. Return null for external / unresolvable specs. Same role this
   *  function plays in lib/graph.ts today — just invoked post-AST instead of
   *  from a regex match. */
  resolveImport(spec: string, fromPath: string, ix: FileIndex): string | null;
}
