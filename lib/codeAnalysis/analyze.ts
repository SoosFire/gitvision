// Directory-level analysis. Walks a local path, loads all plugin grammars,
// parses every file matching a plugin's extensions, and returns aggregated
// results. Used by the dev CLI today; the production orchestrator (Phase 3)
// will use the same primitives on top of a tarball-extracted directory.

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  CodeAnalysisPlugin,
  FileIndex,
  SourceFile,
} from "./types";
import { parseFile, type ParsedFile } from "./parse";

const SKIP_DIRS = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "target",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  ".cache",
  "out",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".idea",
  ".vscode",
]);

const MAX_FILE_BYTES = 1_000_000;
const DEFAULT_MAX_FILES = 5000;

export interface AnalysisTotals {
  filesScanned: number;
  filesParsed: number;
  parseErrors: number;
  functions: number;
  imports: number;
  resolvedImports: number;
  calls: number;
  /** Calls whose `calleeName` matches a known function name in the project. */
  resolvedCalls: number;
}

export interface AnalysisResult {
  root: string;
  files: ParsedFile[];
  totals: AnalysisTotals;
  elapsedMs: number;
  truncated: boolean;
}

export interface AnalyzeOptions {
  maxFiles?: number;
}

/** Walk + parse a local directory. Loads all plugins' grammars up-front. */
export async function analyzeDirectory(
  root: string,
  plugins: CodeAnalysisPlugin[],
  opts: AnalyzeOptions = {}
): Promise<AnalysisResult> {
  const start = Date.now();
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;

  await Promise.all(plugins.map((p) => p.load()));

  const pluginByExt = new Map<string, CodeAnalysisPlugin>();
  for (const p of plugins) {
    for (const ext of p.extensions) pluginByExt.set(ext, p);
  }

  const { files: sourceFiles, truncated } = await walkAndRead(
    root,
    pluginByExt,
    maxFiles
  );

  const byPath = new Map<string, SourceFile>();
  const byExt = new Map<string, SourceFile[]>();
  for (const f of sourceFiles) {
    byPath.set(f.rel, f);
    const arr = byExt.get(f.ext) ?? [];
    arr.push(f);
    byExt.set(f.ext, arr);
  }
  const fileIndex: FileIndex = { byPath, byExt, extras: new Map() };

  // Per-repo plugin setup (e.g. tsconfig paths). Plugins that don't need
  // anything skip this hook; the orchestrator stays language-agnostic.
  for (const p of plugins) {
    if (p.prepareForRepo) {
      try {
        await p.prepareForRepo(root, fileIndex);
      } catch (err) {
        console.error(
          `prepareForRepo failed for ${p.name}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }

  const parsed: ParsedFile[] = [];
  for (const f of sourceFiles) {
    const plugin = pluginByExt.get(f.ext);
    if (!plugin) continue;
    try {
      parsed.push(parseFile(plugin, f, fileIndex));
    } catch (err) {
      parsed.push({
        rel: f.rel,
        imports: [],
        functions: [],
        calls: [],
        fileComplexity: 1,
        parseError: true,
      });
      // Don't let one bad file kill the run — but surface it
      console.error(
        `parse failed for ${f.rel}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  const knownFunctions = new Set<string>();
  for (const pf of parsed) for (const fn of pf.functions) knownFunctions.add(fn.name);

  const totals: AnalysisTotals = {
    filesScanned: sourceFiles.length,
    filesParsed: parsed.filter((p) => !p.parseError).length,
    parseErrors: parsed.filter((p) => p.parseError).length,
    functions: 0,
    imports: 0,
    resolvedImports: 0,
    calls: 0,
    resolvedCalls: 0,
  };
  for (const pf of parsed) {
    totals.functions += pf.functions.length;
    totals.imports += pf.imports.length;
    totals.resolvedImports += pf.imports.filter((i) => i.resolvedPath).length;
    totals.calls += pf.calls.length;
    for (const c of pf.calls) {
      if (knownFunctions.has(c.calleeName)) totals.resolvedCalls++;
    }
  }

  return {
    root,
    files: parsed,
    totals,
    elapsedMs: Date.now() - start,
    truncated,
  };
}

async function walkAndRead(
  root: string,
  pluginByExt: Map<string, CodeAnalysisPlugin>,
  maxFiles: number
): Promise<{ files: SourceFile[]; truncated: boolean }> {
  const out: SourceFile[] = [];
  let truncated = false;

  async function visit(dir: string): Promise<void> {
    if (out.length >= maxFiles) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= maxFiles) {
        truncated = true;
        return;
      }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        await visit(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).slice(1).toLowerCase();
        if (!pluginByExt.has(ext)) continue;
        const rel = path.relative(root, full).split(path.sep).join("/");
        // Path-based pre-filter: cheap, skips before we even open the file
        if (looksVendoredByPath(rel)) continue;
        try {
          const st = await fs.stat(full);
          if (st.size > MAX_FILE_BYTES) continue;
          const content = await fs.readFile(full, "utf-8");
          // Content-based filter: catches minified bundles that don't have
          // a giveaway path. Real source code virtually never has the
          // average-line-length signatures we look for.
          if (looksMinifiedByContent(content)) continue;
          out.push({ rel, ext, content });
        } catch {
          continue;
        }
      }
    }
  }

  await visit(root);
  return { files: out, truncated };
}

/** Recognize files by path that virtually never represent real first-party
 *  source: vendored library copies under tests/assets, fixtures, vendor
 *  directories; explicitly-named .min.js / .bundle.js outputs.
 *  Exported for unit-testing the heuristic — production callers should
 *  rely on walkAndRead applying it automatically. */
export function looksVendoredByPath(rel: string): boolean {
  if (/(^|\/)tests?\/(assets|fixtures)\//i.test(rel)) return true;
  if (/(^|\/)(vendor|vendored|third[_-]?party)\//i.test(rel)) return true;
  if (/\.min\.(js|mjs|cjs)$/i.test(rel)) return true;
  if (/[-.]bundle\.(js|mjs|cjs)$/i.test(rel)) return true;
  return false;
}

/** Heuristic for minified/bundled content. Real source files have lots of
 *  newlines; minified bundles cram code into one or two enormous lines.
 *  We sample only the first 10KB so this stays cheap on big files.
 *  Exported for unit-testing the heuristic. */
export function looksMinifiedByContent(content: string): boolean {
  if (content.length < 50_000) return false;
  const head = content.slice(0, 10_000);
  const newlines = (head.match(/\n/g) ?? []).length;
  if (newlines === 0) return true;
  const avgLineLen = head.length / (newlines + 1);
  return avgLineLen > 500;
}
