// Shared types for the codeAnalysis plugin architecture.
//
// Each language implements CodeAnalysisPlugin. The orchestrator runs the same
// pipeline against every plugin whose extensions are present:
//   walk → per-file: pick parser (tree-sitter OR direct) → extract symbols
//   → cross-file resolution (plugin-supplied) → CodeGraph aggregation.
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

// ------------------- Per-file output (returned by parseFile) -------------------

/** A module-level edge originating from one file, kept loose so regex-based
 *  plugins (which already know the kind from their parser) and tree-sitter
 *  plugins (which always emit "import") use the same shape. */
export type ImportKind = "import" | "extends" | "implements" | "renders";

export interface ParsedImport {
  /** The literal spec as written in source. Useful for unresolvedImports stats
   *  and external-package counts. */
  rawSpec: string;
  /** Repo-rel path of the resolved target file, or null if external/unresolvable. */
  resolvedPath: string | null;
  /** Edge kind. Defaults to "import" for plugins that don't specify. */
  kind?: ImportKind;
}

export interface ParsedFunction {
  name: string;
  startRow: number;
  endRow: number;
  complexity: number;
  /** When the plugin can identify the class/struct/etc. this function
   *  belongs to. Java methods know their class; Go methods know their
   *  receiver type; Python methods know their class. Top-level / module-
   *  scope functions leave this undefined. Drives type-aware call
   *  resolution in buildCodeGraph (Phase 5+). */
  containerType?: string;
}

export interface ParsedCall {
  calleeName: string;
  /** Name of the enclosing function/method. null for module-scope calls. */
  inFunction: string | null;
  /** When the plugin can statically infer the type of the call's receiver.
   *  E.g. for `validatePassword.validate(...)`, this is "ValidatePassword"
   *  if `validatePassword` was declared as that type in scope. Drives
   *  type-aware disambiguation between same-named methods in different
   *  classes (Phase 5+). Undefined when not inferable (dynamic types,
   *  complex expressions, etc.). */
  calleeType?: string;
}

export interface ParsedFile {
  rel: string;
  imports: ParsedImport[];
  functions: ParsedFunction[];
  calls: ParsedCall[];
  /** Total decision points across the whole file + 1. */
  fileComplexity: number;
  parseError: boolean;
}

// ------------------- Plugin contract -------------------

/** Contract every language plugin implements. Tree-sitter plugins must define
 *  `languageFor` + `queriesFor`. Regex / non-AST plugins must define
 *  `parseDirect` instead. Setting both is supported (parseDirect wins). */
export interface CodeAnalysisPlugin {
  /** Stable identifier, also used in CodeGraph.stats.byPlugin. */
  readonly name: string;
  /** Extensions this plugin handles (no dot, lowercase). */
  readonly extensions: readonly string[];

  /** Load any per-process resources (e.g. tree-sitter grammars). Called once
   *  per analysis run. Idempotent — safe to call repeatedly. Plugins with no
   *  process-level setup return immediately. */
  load(): Promise<void>;

  /** Optional per-repo setup. Called once per `analyzeDirectory` run, after
   *  the FileIndex is built but before any parseFile call. Use this to read
   *  language-specific config files (tsconfig.json, package.json workspaces,
   *  go.mod, ...) and stash them on `ix.extras` keyed by the plugin's name. */
  prepareForRepo?(root: string, ix: FileIndex): Promise<void>;

  // ---- Tree-sitter path (one of these two paths must be implemented) ----

  /** Pick the Language to use for a given extension. Tree-sitter plugins only. */
  languageFor?(ext: string): Language;

  /** Return the query sources to compile for this extension. Tree-sitter
   *  plugins only. */
  queriesFor?(ext: string): PluginQueries;

  // ---- Direct path (alternative for regex / non-AST plugins) ----

  /** Parse a single file directly without going through tree-sitter. Used by
   *  the regex-fallback plugin (and any future non-AST plugins). When defined,
   *  the orchestrator calls this instead of running tree-sitter queries. */
  parseDirect?(file: SourceFile, ix: FileIndex): ParsedFile;

  // ---- Resolution (always required) ----

  /** Resolve an import-spec captured by the `imports` query (or by parseDirect)
   *  to a repo-relative file path. Return null for external / unresolvable
   *  specs. */
  resolveImport(spec: string, fromPath: string, ix: FileIndex): string | null;
}

// ------------------- CodeGraph (cross-file aggregate) -------------------
//
// Phase 4 will lift this onto AnalysisSnapshot.codeGraph as an optional field;
// for now it's the orchestrator's return value, consumed by the dev CLI and
// the debug API endpoint.

/** A function or method definition discovered in some file. */
export interface FunctionDef {
  filePath: string;
  name: string;
  startRow: number;
  endRow: number;
  complexity: number;
  /** Mirrors ParsedFunction.containerType. The class/struct/etc. this
   *  function belongs to, when known. Used for type-aware call resolution
   *  in pickCallTarget. */
  containerType?: string;
}

/** A call edge — function X in file A calls callable Y, possibly resolved to
 *  function Z in file B. Both endpoints are recorded for blast-radius queries
 *  in Phase 4. */
export interface CallEdge {
  fromFile: string;
  /** Enclosing function in fromFile. null for module-scope calls. */
  fromFunction: string | null;
  /** Simple name of the callable as captured. */
  calleeName: string;
  /** Repo-rel path of the file defining the callee, when resolvable. */
  toFile: string | null;
  /** Function name in toFile, when resolvable. */
  toFunction: string | null;
}

/** A module-level edge between files. */
export interface ImportEdge {
  from: string;
  to: string;
  kind: ImportKind;
}

/** Per-plugin contribution stats — useful for the debug API to show "regex
 *  fallback handled 287 Java/Python files", etc. */
export interface PluginStats {
  files: number;
  functions: number;
  calls: number;
  imports: number;
}

/** The full output of a code-analysis pass. Designed to live optionally on
 *  AnalysisSnapshot.codeGraph (Phase 4); old snapshots without this field
 *  continue to render normally. */
export interface CodeGraph {
  functions: FunctionDef[];
  /** Resolved + unresolved call edges. Filter on toFile != null for the
   *  resolved subset. */
  calls: CallEdge[];
  imports: ImportEdge[];
  /** Aggregate complexity per file (sum of decision points + 1). */
  fileComplexity: Record<string, number>;
  /** Files we parsed grouped by extension — helps debug coverage. */
  filesByExt: Record<string, number>;
  /** Per-plugin breakdown for stats and "fallback in use" indicators. */
  byPlugin: Record<string, PluginStats>;
  /** Truncation reason if any cap was hit. */
  truncated?: string;
  generatedAt: string;
}
