// Tree-sitter WASM bootstrap.
//
// We use web-tree-sitter (WASM) rather than native tree-sitter bindings so the
// same code runs on Railway (Linux), local dev (Mac/Windows), and a future
// Tauri build without platform-specific compilation. ~2× slower parse than
// native, irrelevant next to the ~2-5s of network I/O per analyzed repo.

import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Parser, Language } from "web-tree-sitter";

const req = createRequire(import.meta.url);

let initPromise: Promise<void> | null = null;

/** Boot the core runtime. Safe to call multiple times — the work happens once.
 *  Must be awaited before constructing a Parser or loading a Language. */
export function ensureRuntime(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      // Core WASM ships with web-tree-sitter. Read it explicitly and hand it
      // to Emscripten as wasmBinary so it doesn't try to fetch over HTTP.
      const corePath = req.resolve("web-tree-sitter/web-tree-sitter.wasm");
      const buf = await fs.readFile(corePath);
      await Parser.init({ wasmBinary: new Uint8Array(buf) });
    })();
  }
  return initPromise;
}

/** Absolute path to a grammar WASM in @vscode/tree-sitter-wasm.
 *  @param name File name without the .wasm suffix, e.g. "tree-sitter-javascript". */
export function grammarPath(name: string): string {
  // The package's "main" is wasm/tree-sitter.js — resolve it, then look next
  // door for the grammar file.
  const mainPath = req.resolve("@vscode/tree-sitter-wasm");
  return path.join(path.dirname(mainPath), `${name}.wasm`);
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
