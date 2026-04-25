// Regex-fallback plugin.
//
// Wraps the per-language regex parsers in lib/graph.ts so all 7 currently-
// supported non-JS languages (Java, Kotlin, C#, PHP, Ruby, Python, Go) feed
// into the codeAnalysis pipeline alongside the tree-sitter JS/TS plugin.
//
// What it produces:
//   - imports (with the original kind: import/extends/implements/renders)
// What it doesn't produce:
//   - functions, calls, complexity (regex parsers can't reliably extract
//     these — that's the point of moving to tree-sitter eventually)
//
// This plugin uses the parseDirect path. tree-sitter methods are intentionally
// unset; the orchestrator picks parseDirect when present.
//
// Migration story: as we add a tree-sitter plugin per language (one file
// each, same pattern as javascript.ts), the regex-fallback plugin's extension
// list shrinks. When the last language is migrated, this file goes away and
// lib/graph.ts can be deleted entirely.

import type {
  CodeAnalysisPlugin,
  FileIndex,
  ParsedFile,
  ParsedImport,
  SourceFile,
} from "../types";
import { extractImportsFromSourceFiles } from "../../graph";

const PLUGIN_NAME = "regex-fallback";

/** Languages still handled by the regex parsers in lib/graph.ts. Plus
 *  HTML/CSS as passive file types — we don't extract anything from them, but
 *  the JVM regex parser needs them in the FileIndex to resolve controller →
 *  template "renders" edges (Spring MVC convention).
 *
 *  Migrations: Python → tree-sitter in v0.12, Go → tree-sitter in v0.13.
 *  As more languages migrate this list will shrink, and when it's empty
 *  this whole file (plus lib/graph.ts's regex parsers) can be deleted. */
const EXTENSIONS = [
  "java",
  "kt",
  "cs",
  "php",
  "rb",
  "html",
  "css",
] as const;

interface RegexFallbackData {
  /** Per-file import edges precomputed at prepareForRepo time. The regex
   *  parsers need a global FileIndex (jvmFqnToPath etc.) to resolve cross-
   *  file references, so we can't run them lazily per-file. */
  importsByFile: Map<
    string,
    { to: string; kind: ParsedImport["kind"] }[]
  >;
}

export const regexFallbackPlugin = {
  name: PLUGIN_NAME,
  extensions: EXTENSIONS,

  async load() {
    // No tree-sitter grammars to load — pure regex parsers.
  },

  async prepareForRepo(_root: string, ix: FileIndex) {
    // Run all regex parsers once, against the same in-memory file set the
    // orchestrator already walked. Cache per-file edges for parseDirect.
    const sources: { rel: string; ext: string; content: string }[] = [];
    for (const f of ix.byPath.values()) {
      // Only feed extensions our regex parsers actually handle. HTML/CSS
      // get included via FileIndex but won't generate edges themselves;
      // they're targets, not sources.
      if (EXTENSIONS.includes(f.ext as (typeof EXTENSIONS)[number])) {
        sources.push(f);
      }
    }
    const importsByFile = extractImportsFromSourceFiles(sources);
    const data: RegexFallbackData = {
      importsByFile: new Map(
        [...importsByFile].map(([rel, edges]) => [
          rel,
          edges.map((e) => ({ to: e.to, kind: e.kind })),
        ])
      ),
    };
    ix.extras.set(PLUGIN_NAME, data);
  },

  parseDirect(file: SourceFile, ix: FileIndex): ParsedFile {
    const data = ix.extras.get(PLUGIN_NAME) as RegexFallbackData | undefined;
    const edges = data?.importsByFile.get(file.rel) ?? [];
    // Regex parsers already resolve targets to repo-rel paths during their
    // pass, so resolvedPath is non-null on every emitted edge. rawSpec
    // mirrors the resolved path because we don't preserve the original
    // source-text spec through graph.ts; not great, but the only consumer
    // for rawSpec on these edges is the externalImports counter, and
    // resolved edges are excluded from that anyway.
    const imports: ParsedImport[] = edges.map((e) => ({
      rawSpec: e.to,
      resolvedPath: e.to,
      kind: e.kind,
    }));
    return {
      rel: file.rel,
      imports,
      functions: [],
      calls: [],
      fileComplexity: 1,
      parseError: false,
    };
  },

  resolveImport(_spec: string, _fromPath: string, _ix: FileIndex): string | null {
    // Resolution happens inside the regex parsers themselves; nothing more
    // to do here. The orchestrator never invokes this directly for regex-
    // fallback files because parseDirect populates resolvedPath up front.
    return null;
  },
} satisfies CodeAnalysisPlugin;
