// Dev CLI — walks a local directory and dumps a JSON summary of what
// codeAnalysis extracted. Run as `npm run analyze <path>`. Used to eyeball
// query behavior on real repos before UI integration.
//
// Output shape (JSON on stdout):
//   {
//     target,              -- absolute path analyzed
//     elapsedMs,           -- wall-clock time
//     truncated,           -- true if MAX_FILES hit
//     totals,              -- file / function / import / call counts
//     topComplex,          -- 10 highest cyclomatic complexity functions
//     biggestFiles,        -- 10 files with most code (by function count)
//     externalImports,     -- top 15 external modules imported
//     unresolvedCalls,     -- top 15 unresolved callee names (often externals)
//     sampleImports,       -- first 5 files with imports, trimmed per file
//     parseErrors,         -- list of files the parser refused
//   }

import path from "node:path";
import { analyzeDirectory } from "./analyze";
import { javascriptPlugin } from "./plugins/javascript";

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: npm run analyze -- <path-to-directory>");
    process.exit(1);
  }
  const abs = path.resolve(target);

  const result = await analyzeDirectory(abs, [javascriptPlugin]);
  const { totals, elapsedMs, files, truncated } = result;

  // Top 10 most complex functions
  const topComplex = files
    .flatMap((f) => f.functions.map((fn) => ({ file: f.rel, ...fn })))
    .sort((a, b) => b.complexity - a.complexity)
    .slice(0, 10);

  // Top 10 files by function count
  const biggestFiles = files
    .map((f) => ({
      file: f.rel,
      functions: f.functions.length,
      imports: f.imports.length,
      calls: f.calls.length,
      fileComplexity: f.fileComplexity,
    }))
    .sort((a, b) => b.functions - a.functions)
    .slice(0, 10);

  // External imports (unresolved specs that aren't relative paths)
  const externalCounts = new Map<string, number>();
  for (const f of files) {
    for (const i of f.imports) {
      if (i.resolvedPath !== null) continue;
      if (i.rawSpec.startsWith(".") || i.rawSpec.startsWith("/")) continue;
      externalCounts.set(i.rawSpec, (externalCounts.get(i.rawSpec) ?? 0) + 1);
    }
  }
  const externalImports = [...externalCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([spec, count]) => ({ spec, count }));

  // Unresolved callees (top names that didn't match any known function)
  const knownFunctions = new Set<string>();
  for (const f of files) for (const fn of f.functions) knownFunctions.add(fn.name);
  const unresolvedCallCounts = new Map<string, number>();
  for (const f of files) {
    for (const c of f.calls) {
      if (knownFunctions.has(c.calleeName)) continue;
      unresolvedCallCounts.set(
        c.calleeName,
        (unresolvedCallCounts.get(c.calleeName) ?? 0) + 1
      );
    }
  }
  const unresolvedCalls = [...unresolvedCallCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));

  // Sample imports from first few non-empty files — lets us eyeball resolution
  const sampleImports = files
    .filter((f) => f.imports.length > 0)
    .slice(0, 5)
    .map((f) => ({
      file: f.rel,
      imports: f.imports.slice(0, 8),
    }));

  const parseErrors = files.filter((f) => f.parseError).map((f) => f.rel);

  const summary = {
    target: abs,
    elapsedMs,
    truncated,
    totals,
    topComplex,
    biggestFiles,
    externalImports,
    unresolvedCalls,
    sampleImports,
    parseErrors,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
