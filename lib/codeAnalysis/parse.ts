// Per-file parser. Takes a SourceFile, runs the plugin's queries against its
// AST, and returns the extracted symbols. Queries are compiled once per
// (plugin, ext) and cached for the life of the process.

import { Parser, Query, type Language } from "web-tree-sitter";
import type {
  CodeAnalysisPlugin,
  FileIndex,
  PluginQueries,
  SourceFile,
} from "./types";

export interface ParsedImport {
  rawSpec: string;
  resolvedPath: string | null;
}

export interface ParsedFunction {
  name: string;
  startRow: number;
  endRow: number;
  complexity: number;
}

export interface ParsedCall {
  calleeName: string;
  /** Name of the enclosing function/method. null for module-scope calls. */
  inFunction: string | null;
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

/** Parse one file and extract imports, functions, calls, complexity. */
export function parseFile(
  plugin: CodeAnalysisPlugin,
  file: SourceFile,
  fileIndex: FileIndex
): ParsedFile {
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
