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
  //    resolve disambiguation later via import context + containerType.
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
        containerType: fn.containerType,
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
  //    populated when we can determine the target unambiguously. When the
  //    plugin gave us a calleeType (Java's type-aware extractor in v0.15),
  //    we prefer candidates whose containerType matches — that's the
  //    deterministic answer when receiver type is known.
  const calls: CallEdge[] = [];
  for (const f of parsedFiles) {
    for (const c of f.calls) {
      const candidates = funcsByName.get(c.calleeName) ?? [];
      const target = pickCallTarget(
        f.rel,
        c.calleeType,
        c.hasReceiver ?? false,
        candidates,
        importsByFile
      );
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
 *  with that name. Strategy (highest-precedence first):
 *    1. Type-aware: when the plugin supplied calleeType, prefer the
 *       candidate whose containerType matches. This is the deterministic
 *       answer for typed languages — `validatePassword.validate()` resolves
 *       to ValidatePassword.validate even when 6 other classes also have
 *       a `validate()` method. **If calleeType is set but no candidate
 *       matches, return null without falling through to proximity
 *       heuristics.** A typed receiver that isn't in our index is almost
 *       always external (System.IO.TextWriter, etc.) — silently picking a
 *       random internal method by name leads to bogus edges (observed in
 *       v0.21 serilog validation).
 *    2. Receiver-but-no-type: when the call had a receiver but the type
 *       couldn't be inferred (dynamic languages, chained calls, untyped
 *       params), DON'T single-candidate-match — that's a near-pure-luck
 *       resolution and produced 76 spurious lib->spec edges in rspec-core
 *       (v0.23). Try same-file / imported-file proximity heuristics
 *       directly; otherwise leave unresolved.
 *    3. Bare-call (no receiver, no type): single-candidate-match is
 *       reasonable. Bare calls go to top-level / module-scope functions
 *       which usually have unique names.
 *    4. Same-file fallback for ambiguous bare-or-unknown calls.
 *    5. Imported-file fallback.
 *    6. Otherwise leave unresolved. */
function pickCallTarget(
  fromFile: string,
  calleeType: string | undefined,
  hasReceiver: boolean,
  candidates: FunctionDef[],
  importsByFile: Map<string, Set<string>>
): FunctionDef | null {
  if (candidates.length === 0) return null;

  // 1. Strict type-aware match.
  if (calleeType) {
    const typed = candidates.find((c) => c.containerType === calleeType);
    return typed ?? null;
  }

  // Common proximity helpers (used by both 2 and 3+ branches below).
  function pickByProximity(): FunctionDef | null {
    const sameFile = candidates.find((c) => c.filePath === fromFile);
    if (sameFile) return sameFile;
    const importedFiles = importsByFile.get(fromFile);
    if (importedFiles) {
      const imported = candidates.find((c) =>
        importedFiles.has(c.filePath)
      );
      if (imported) return imported;
    }
    return null;
  }

  // 2. Receiver was present but type unknown — refuse single-candidate
  //    match. The call goes through SOMETHING; resolving by name alone is
  //    near-random when there's only one match and that match might be
  //    in unrelated code (e.g., test fixtures).
  if (hasReceiver) {
    return pickByProximity();
  }

  // 3-5. Bare call — single-candidate is the best signal we have.
  if (candidates.length === 1) return candidates[0];
  return pickByProximity();
}
