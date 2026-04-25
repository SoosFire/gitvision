// Tree-sitter WASM bootstrap.
//
// We use web-tree-sitter (WASM) rather than native tree-sitter bindings so the
// same code runs on Railway (Linux), local dev (Mac/Windows), and a future
// Tauri build without platform-specific compilation. ~2× slower parse than
// native, irrelevant next to the ~2-5s of network I/O per analyzed repo.
//
// Path resolution policy:
//   We resolve WASM paths from `process.cwd()` rather than via createRequire.
//   The reason is bundler-agnostic correctness: webpack with serverExternalPackages
//   gives us the real node_modules path, but Turbopack's dev externalization
//   replaces the resolved string with a synthetic "[externals]/…" marker. By
//   skipping the bundler's resolver entirely, dev (Turbopack) and build
//   (Webpack) and Railway runtime all behave identically. Assumes flat
//   node_modules at the project root, which is GitVision's convention.

import { promises as fs } from "node:fs";
import path from "node:path";
import { Parser, Language } from "web-tree-sitter";

const NODE_MODULES = path.join(process.cwd(), "node_modules");
const WTS_DIR = path.join(NODE_MODULES, "web-tree-sitter");
const VSCODE_GRAMMAR_DIR = path.join(
  NODE_MODULES,
  "@vscode",
  "tree-sitter-wasm",
  "wasm"
);

let initPromise: Promise<void> | null = null;

/** Boot the core runtime. Safe to call multiple times — the work happens once.
 *  Must be awaited before constructing a Parser or loading a Language. */
export function ensureRuntime(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const corePath = path.join(WTS_DIR, "web-tree-sitter.wasm");
      const buf = await fs.readFile(corePath);
      await Parser.init({ wasmBinary: new Uint8Array(buf) });
    })();
  }
  return initPromise;
}

/** Absolute path to a grammar WASM in @vscode/tree-sitter-wasm.
 *  @param name File name without the .wasm suffix, e.g. "tree-sitter-javascript". */
export function grammarPath(name: string): string {
  return path.join(VSCODE_GRAMMAR_DIR, `${name}.wasm`);
}

const langCache = new Map<string, Language>();

/** Load a grammar WASM into a Language. Cached per process. */
export async function loadGrammar(wasmPath: string): Promise<Language> {
  await ensureRuntime();
  const cached = langCache.get(wasmPath);
  if (cached) return cached;
  const bytes = await fs.readFile(wasmPath);
  const lang = await Language.load(new Uint8Array(bytes));
  langCache.set(wasmPath, lang);
  return lang;
}

/** Convenience: load a grammar from @vscode/tree-sitter-wasm by short name. */
export function loadBuiltinGrammar(grammarName: string): Promise<Language> {
  return loadGrammar(grammarPath(grammarName));
}
