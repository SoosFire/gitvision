// Per-file parser. Two execution paths:
//
//   1. Tree-sitter (default): plugin provides languageFor + queriesFor; we
//      compile queries once per (plugin, ext) and walk match captures by the
//      canonical capture names from types.ts.
//
//   2. parseDirect (alternative): plugin returns a ParsedFile itself, used by
//      the regex-fallback plugin that wraps lib/graph.ts's existing parsers.
//      The orchestrator picks the right path based on which methods the plugin
//      defines — same outer call shape regardless.

import { Parser, Query, type Language } from "web-tree-sitter";
import type {
  CodeAnalysisPlugin,
  FileIndex,
  ParsedCall,
  ParsedFile,
  ParsedFunction,
  ParsedImport,
  PluginQueries,
  SourceFile,
} from "./types";

interface CompiledQueries {
  imports: Query | null;
  functionDefs: Query | null;
  callSites: Query | null;
  decisionPoints: Query | null;
}

const compiledQueryCache = new Map<string, CompiledQueries>();

function compileQueries(
  lang: Language,
  sources: PluginQueries,
  cacheKey: string
): CompiledQueries {
  const cached = compiledQueryCache.get(cacheKey);
  if (cached) return cached;
  const compiled: CompiledQueries = {
    imports: sources.imports ? new Query(lang, sources.imports) : null,
    functionDefs: sources.functionDefs
      ? new Query(lang, sources.functionDefs)
      : null,
    callSites: sources.callSites ? new Query(lang, sources.callSites) : null,
    decisionPoints: sources.decisionPoints
      ? new Query(lang, sources.decisionPoints)
      : null,
  };
  compiledQueryCache.set(cacheKey, compiled);
  return compiled;
}

/** Parse one file. Dispatches to the plugin's parseDirect when defined,
 *  otherwise runs the tree-sitter pipeline. */
export function parseFile(
  plugin: CodeAnalysisPlugin,
  file: SourceFile,
  fileIndex: FileIndex
): ParsedFile {
  if (plugin.parseDirect) {
    return plugin.parseDirect(file, fileIndex);
  }
  return parseFileWithTreeSitter(plugin, file, fileIndex);
}

function parseFileWithTreeSitter(
  plugin: CodeAnalysisPlugin,
  file: SourceFile,
  fileIndex: FileIndex
): ParsedFile {
  if (!plugin.languageFor || !plugin.queriesFor) {
    throw new Error(
      `Plugin ${plugin.name} has neither parseDirect nor languageFor+queriesFor — cannot parse ${file.rel}`
    );
  }
  const lang = plugin.languageFor(file.ext);
  const sources = plugin.queriesFor(file.ext);
  const cacheKey = `${plugin.name}:${file.ext}`;
  const queries = compileQueries(lang, sources, cacheKey);

  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(file.content);
  if (!tree) {
    parser.delete();
    return {
      rel: file.rel,
      imports: [],
      functions: [],
      calls: [],
      fileComplexity: 1,
      parseError: true,
    };
  }
  const root = tree.rootNode;

  // Imports
  const imports: ParsedImport[] = [];
  const seenImportSpecs = new Set<string>();
  if (queries.imports) {
    for (const match of queries.imports.matches(root)) {
      const spec = match.captures.find((c) => c.name === "spec")?.node.text;
      if (!spec || seenImportSpecs.has(spec)) continue;
      seenImportSpecs.add(spec);
      imports.push({
        rawSpec: spec,
        resolvedPath: plugin.resolveImport(spec, file.rel, fileIndex),
      });
    }
  }

  // Functions + per-function complexity (count decision points in the body)
  const functions: ParsedFunction[] = [];
  const functionRanges: { start: number; end: number; name: string }[] = [];
  if (queries.functionDefs) {
    for (const match of queries.functionDefs.matches(root)) {
      const nameCap = match.captures.find((c) => c.name === "name");
      const bodyCap = match.captures.find((c) => c.name === "body");
      if (!nameCap) continue;
      const complexity =
        bodyCap && queries.decisionPoints
          ? 1 + queries.decisionPoints.matches(bodyCap.node).length
          : 1;
      functions.push({
        name: nameCap.node.text,
        startRow: nameCap.node.startPosition.row,
        endRow:
          bodyCap?.node.endPosition.row ?? nameCap.node.endPosition.row,
        complexity,
      });
      if (bodyCap) {
        functionRanges.push({
          start: bodyCap.node.startIndex,
          end: bodyCap.node.endIndex,
          name: nameCap.node.text,
        });
      }
    }
  }

  // Calls — determine the innermost enclosing function for attribution
  const calls: ParsedCall[] = [];
  if (queries.callSites) {
    for (const match of queries.callSites.matches(root)) {
      const calleeCap = match.captures.find((c) => c.name === "callee");
      if (!calleeCap) continue;
      calls.push({
        calleeName: calleeCap.node.text,
        inFunction: findEnclosingFunction(
          calleeCap.node.startIndex,
          functionRanges
        ),
      });
    }
  }

  const fileComplexity = queries.decisionPoints
    ? 1 + queries.decisionPoints.matches(root).length
    : 1;

  tree.delete();
  parser.delete();

  return {
    rel: file.rel,
    imports,
    functions,
    calls,
    fileComplexity,
    parseError: false,
  };
}

/** Find the smallest-byte-range function whose body contains the given byte
 *  index. Returns that function's name, or null if no match (module scope). */
function findEnclosingFunction(
  byteIndex: number,
  ranges: { start: number; end: number; name: string }[]
): string | null {
  let innermost: { start: number; end: number; name: string } | null = null;
  for (const r of ranges) {
    if (byteIndex < r.start || byteIndex > r.end) continue;
    if (!innermost || r.end - r.start < innermost.end - innermost.start) {
      innermost = r;
    }
  }
  return innermost?.name ?? null;
}

/** Expose for tests only. Lets us reset the query cache between runs that
 *  re-load grammars. Production callers should not need this. */
export function __resetQueryCache() {
  compiledQueryCache.clear();
}

// Re-export the per-file types from types.ts so existing callers that import
// from "./parse" keep working. New callers should import from "./types".
export type {
  ParsedCall,
  ParsedFile,
  ParsedFunction,
  ParsedImport,
} from "./types";
