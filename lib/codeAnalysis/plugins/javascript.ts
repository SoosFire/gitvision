// JavaScript / TypeScript plugin.
//
// Covers the JS family (.js, .jsx, .mjs, .cjs) plus TypeScript (.ts, .tsx).
// These share the same module system so they live in one plugin, but TS needs
// its own grammar for type annotations and .tsx needs the tsx grammar for JSX
// syntax inside a typed file. Three grammars, one plugin.
//
// Phase 1: skeleton — loads all three grammars and can parse source. Queries
// and import-resolution land in the next phase.

import type { Language } from "web-tree-sitter";
import type { CodeAnalysisPlugin, FileIndex, PluginQueries } from "../types";
import { loadBuiltinGrammar } from "../runtime";

const EXTENSIONS = ["js", "jsx", "mjs", "cjs", "ts", "tsx"] as const;

type GrammarSlot = "javascript" | "typescript" | "tsx";

const langs: Record<GrammarSlot, Language | null> = {
  javascript: null,
  typescript: null,
  tsx: null,
};

function slotFor(ext: string): GrammarSlot {
  if (ext === "ts") return "typescript";
  if (ext === "tsx") return "tsx";
  return "javascript"; // js, jsx, mjs, cjs
}

export const javascriptPlugin: CodeAnalysisPlugin = {
  name: "javascript",
  extensions: EXTENSIONS,

  async load() {
    if (langs.javascript && langs.typescript && langs.tsx) return;
    const [js, ts, tsx] = await Promise.all([
      loadBuiltinGrammar("tree-sitter-javascript"),
      loadBuiltinGrammar("tree-sitter-typescript"),
      loadBuiltinGrammar("tree-sitter-tsx"),
    ]);
    langs.javascript = js;
    langs.typescript = ts;
    langs.tsx = tsx;
  },

  languageFor(ext) {
    const lang = langs[slotFor(ext)];
    if (!lang) {
      throw new Error(
        `javascript plugin not loaded — call plugin.load() before languageFor()`
      );
    }
    return lang;
  },

  queriesFor(_ext): PluginQueries {
    // TODO Phase 2: imports, functionDefs, callSites, decisionPoints queries.
    return {};
  },

  resolveImport(_spec, _fromPath, _ix) {
    // TODO Phase 2: port relative-path + index.{ts,js,...} resolution from
    // lib/graph.ts (resolveJsImport).
    return null;
  },
};
