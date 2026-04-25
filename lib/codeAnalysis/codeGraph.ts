// Cross-file aggregator. Takes per-file ParsedFile records (already produced
// by parseFile + plugin pipeline) and builds the unified CodeGraph that lives
// on AnalysisSnapshot.codeGraph.
//
// Two pieces of cross-file resolution happen here:
//   1. Call → callee disambiguation (which function, in which file, does
//      `foo()` refer to?). Uses file-level import knowledge to disambiguate
//      between same-named functions in different files.
//   2. Per-plugin stats roll-up — useful for the debug API to surface which
//      plugin produced what.

import type {
  CallEdge,
  CodeGraph,
  FunctionDef,
  ImportEdge,
  ParsedFile,
  PluginStats,
} from "./types";

export interface BuildCodeGraphInput {
  parsedFiles: ParsedFile[];
  /** Repo-rel path → plugin name that parsed it. Drives byPlugin stats. */
  pluginByFile: Map<string, string>;
  /** Truncation reason if any cap was hit. */
  truncated?: string;
}

export function buildCodeGraph(input: BuildCodeGraphInput): CodeGraph {
  const { parsedFiles, pluginByFile, truncated } = input;

  // 1. Global function index for call resolution. Same-named functions in
  //    different files are common, so we keep the full list per name and
  //    resolve disambiguation later via import context.
  const funcsByName = new Map<string, FunctionDef[]>();
  const functions: FunctionDef[] = [];
  for (const f of parsedFiles) {
    for (const fn of f.functions) {
      const def: FunctionDef = {
        filePath: f.rel,
        name: fn.name,
        startRow: fn.startRow,
        endRow: fn.endRow,
        complexity: fn.complexity,
      };
      functions.push(def);
      const arr = funcsByName.get(fn.name) ?? [];
      arr.push(def);
      funcsByName.set(fn.name, arr);
    }
  }

  // 2. Per-file resolved-import lookup, used for call disambiguation. Set of
  //    target-file paths the calling file imports (any kind: import / extends
  //    / implements / renders).
  const importsByFile = new Map<string, Set<string>>();
  for (const f of parsedFiles) {
    const set = new Set<string>();
    for (const i of f.imports) {
      if (i.resolvedPath) set.add(i.resolvedPath);
    }
    importsByFile.set(f.rel, set);
  }

  // 3. Resolve each call, producing a CallEdge whose toFile/toFunction is
  //    populated when we can determine the target unambiguously.
  const calls: CallEdge[] = [];
  for (const f of parsedFiles) {
    for (const c of f.calls) {
      const candidates = funcsByName.get(c.calleeName) ?? [];
      const target = pickCallTarget(f.rel, candidates, importsByFile);
      calls.push({
        fromFile: f.rel,
        fromFunction: c.inFunction,
        calleeName: c.calleeName,
        toFile: target?.filePath ?? null,
        toFunction: target?.name ?? null,
      });
    }
  }

  // 4. Imports: deduplicated, resolved edges only. Self-imports are dropped
  //    (defensive — should not happen in normal source).
  const imports: ImportEdge[] = [];
  const importKey = new Set<string>();
  for (const f of parsedFiles) {
    for (const i of f.imports) {
      if (!i.resolvedPath || i.resolvedPath === f.rel) continue;
      const kind = i.kind ?? "import";
      const k = `${kind}|${f.rel}|${i.resolvedPath}`;
      if (importKey.has(k)) continue;
      importKey.add(k);
      imports.push({ from: f.rel, to: i.resolvedPath, kind });
    }
  }

  // 5. Per-file complexity + filesByExt for quick UI summaries
  const fileComplexity: Record<string, number> = {};
  const filesByExt: Record<string, number> = {};
  for (const f of parsedFiles) {
    fileComplexity[f.rel] = f.fileComplexity;
    const ext = f.rel.includes(".")
      ? f.rel.slice(f.rel.lastIndexOf(".") + 1)
      : "";
    filesByExt[ext] = (filesByExt[ext] ?? 0) + 1;
  }

  // 6. Per-plugin stats
  const byPlugin: Record<string, PluginStats> = {};
  for (const f of parsedFiles) {
    const pluginName = pluginByFile.get(f.rel) ?? "unknown";
    const stats = byPlugin[pluginName] ?? {
      files: 0,
      functions: 0,
      calls: 0,
      imports: 0,
    };
    stats.files++;
    stats.functions += f.functions.length;
    stats.calls += f.calls.length;
    stats.imports += f.imports.filter((i) => i.resolvedPath).length;
    byPlugin[pluginName] = stats;
  }

  return {
    functions,
    calls,
    imports,
    fileComplexity,
    filesByExt,
    byPlugin,
    truncated,
    generatedAt: new Date().toISOString(),
  };
}

/** Pick the best target for a call given the candidate function definitions
 *  with that name. Strategy:
 *    1. If there's exactly one candidate, take it.
 *    2. If multiple, prefer one in the same file as the caller.
 *    3. If multiple, prefer one in a file imported by the caller.
 *    4. Otherwise leave unresolved — better than guessing wrong. */
function pickCallTarget(
  fromFile: string,
  candidates: FunctionDef[],
  importsByFile: Map<string, Set<string>>
): FunctionDef | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const sameFile = candidates.find((c) => c.filePath === fromFile);
  if (sameFile) return sameFile;

  const importedFiles = importsByFile.get(fromFile);
  if (importedFiles) {
    const imported = candidates.find((c) => importedFiles.has(c.filePath));
    if (imported) return imported;
  }

  return null;
}
