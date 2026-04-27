// Dev CLI — walks a local directory and dumps a JSON summary of what
// codeAnalysis extracted. Run as `npm run analyze <path>`. Used to eyeball
// query behavior on real repos before UI integration.
//
// Output shape (JSON on stdout): totals, top-complex, biggest-files,
// external imports, unresolved calls, sample imports, parse errors,
// plus the CodeGraph.byPlugin breakdown showing which plugin handled what.

import path from "node:path";
import { analyzeDirectory } from "./analyze";
import { csharpPlugin } from "./plugins/csharp";
import { goPlugin } from "./plugins/go";
import { javaPlugin } from "./plugins/java";
import { javascriptPlugin } from "./plugins/javascript";
import { phpPlugin } from "./plugins/php";
import { pythonPlugin } from "./plugins/python";
import { regexFallbackPlugin } from "./plugins/regexFallback";

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: npm run analyze -- <path-to-directory>");
    process.exit(1);
  }
  const abs = path.resolve(target);

  const result = await analyzeDirectory(abs, [
    javascriptPlugin,
    pythonPlugin,
    goPlugin,
    javaPlugin,
    csharpPlugin,
    phpPlugin,
    regexFallbackPlugin,
  ]);
  const { totals, elapsedMs, files, truncated, codeGraph } = result;

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
    byPlugin: codeGraph.byPlugin,
    filesByExt: codeGraph.filesByExt,
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
