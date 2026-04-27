// Tests for the regex-fallback plugin and its underlying helper in
// lib/graph.ts. The plugin wraps existing per-language regex parsers, so
// the surface we want to lock down is:
//   1. extractImportsFromSourceFiles produces the expected edges given
//      typical multi-language input
//   2. regexFallbackPlugin's parseDirect returns those edges as ParsedImport
//      records (with resolvedPath populated, kind preserved)

import { describe, it, expect } from "vitest";
import { extractImportsFromSourceFiles } from "../graph";
import { regexFallbackPlugin } from "../codeAnalysis/plugins/regexFallback";
import type { FileIndex, SourceFile } from "../codeAnalysis/types";

function makeIndex(files: SourceFile[]): FileIndex {
  const byPath = new Map<string, SourceFile>();
  const byExt = new Map<string, SourceFile[]>();
  for (const f of files) {
    byPath.set(f.rel, f);
    const arr = byExt.get(f.ext) ?? [];
    arr.push(f);
    byExt.set(f.ext, arr);
  }
  return { byPath, byExt, extras: new Map() };
}

describe("extractImportsFromSourceFiles", () => {
  it("returns Java import edges resolving to in-repo files", () => {
    const files = [
      {
        rel: "src/com/x/A.java",
        ext: "java",
        content: "package com.x;\nimport com.x.B;\npublic class A {}",
      },
      {
        rel: "src/com/x/B.java",
        ext: "java",
        content: "package com.x;\npublic class B {}",
      },
    ];
    const map = extractImportsFromSourceFiles(files);
    const aEdges = map.get("src/com/x/A.java");
    expect(aEdges).toBeDefined();
    expect(aEdges?.find((e) => e.to === "src/com/x/B.java")).toBeDefined();
  });

  it("captures Python relative imports of a sibling module", () => {
    const files = [
      { rel: "pkg/__init__.py", ext: "py", content: "" },
      {
        rel: "pkg/main.py",
        ext: "py",
        content: "from .helper import work\nimport os",
      },
      { rel: "pkg/helper.py", ext: "py", content: "" },
    ];
    const map = extractImportsFromSourceFiles(files);
    const mainEdges = map.get("pkg/main.py") ?? [];
    // `from .helper import work` resolves to the sibling module, not __init__
    expect(mainEdges.find((e) => e.to === "pkg/helper.py")).toBeDefined();
  });

  it("preserves edge kinds (extends, implements, import)", () => {
    // Same package — graph.ts's resolver requires the package declaration to
    // resolve unqualified type names like "Base".
    const files = [
      {
        rel: "src/com/x/Base.java",
        ext: "java",
        content: "package com.x;\npublic class Base {}",
      },
      {
        rel: "src/com/x/Child.java",
        ext: "java",
        content: "package com.x;\npublic class Child extends Base {}",
      },
    ];
    const map = extractImportsFromSourceFiles(files);
    const childEdges = map.get("src/com/x/Child.java") ?? [];
    const extendsEdge = childEdges.find((e) => e.kind === "extends");
    expect(extendsEdge?.to).toBe("src/com/x/Base.java");
  });

  it("returns an empty map for unsupported extensions", () => {
    const files = [
      { rel: "doc.md", ext: "md", content: "# hello" },
      { rel: "config.toml", ext: "toml", content: "x = 1" },
    ];
    const map = extractImportsFromSourceFiles(files);
    expect(map.size).toBe(0);
  });

  it("isolates errors per file — one bad file doesn't stop others", () => {
    // Hard to actually crash a regex parser, but unsupported content shouldn't
    // emit edges. Just confirm the function survives garbage.
    const files = [
      { rel: "good.java", ext: "java", content: "package x;\npublic class A {}" },
      { rel: "garbage.java", ext: "java", content: "}}}{{{<<><><><" },
    ];
    expect(() => extractImportsFromSourceFiles(files)).not.toThrow();
  });
});

describe("regexFallbackPlugin", () => {
  it("advertises the three remaining non-AST languages plus html/css for resolution", () => {
    // Python migrated in v0.12, Go in v0.13, Java in v0.14, C# in v0.21 —
    // all have their own tree-sitter plugins. As more languages migrate this
    // list shrinks.
    expect([...regexFallbackPlugin.extensions].sort()).toEqual(
      ["css", "html", "kt", "php", "rb"]
    );
  });

  it("uses parseDirect, not tree-sitter (no languageFor / queriesFor)", () => {
    expect(regexFallbackPlugin.parseDirect).toBeTypeOf("function");
    // tree-sitter methods intentionally absent
    expect(regexFallbackPlugin).not.toHaveProperty("languageFor");
    expect(regexFallbackPlugin).not.toHaveProperty("queriesFor");
  });

  it("prepareForRepo + parseDirect produces import edges with resolvedPath populated", async () => {
    // Java migrated to its own tree-sitter plugin in v0.14, so we exercise
    // the regex-fallback path with PHP — it's still in the regex-fallback
    // extension list and graph.ts's PHP parser supports `extends`.
    const files: SourceFile[] = [
      {
        rel: "src/Base.php",
        ext: "php",
        content: "<?php\nnamespace App;\nclass Base {}\n",
      },
      {
        rel: "src/Child.php",
        ext: "php",
        content: "<?php\nnamespace App;\nclass Child extends Base {}\n",
      },
    ];
    const ix = makeIndex(files);
    await regexFallbackPlugin.prepareForRepo("/fake/root", ix);
    const parsed = regexFallbackPlugin.parseDirect(files[1], ix);
    expect(parsed.rel).toBe("src/Child.php");
    expect(parsed.functions).toHaveLength(0);
    expect(parsed.calls).toHaveLength(0);
    expect(parsed.imports.length).toBeGreaterThanOrEqual(1);
    const extendsEdge = parsed.imports.find((i) => i.kind === "extends");
    expect(extendsEdge?.resolvedPath).toBe("src/Base.php");
  });

  it("returns an empty ParsedFile for files no regex parser handles (html/css)", async () => {
    const files: SourceFile[] = [
      { rel: "view.html", ext: "html", content: "<h1>hi</h1>" },
      { rel: "style.css", ext: "css", content: "h1 { color: red }" },
    ];
    const ix = makeIndex(files);
    await regexFallbackPlugin.prepareForRepo("/fake/root", ix);
    const html = regexFallbackPlugin.parseDirect(files[0], ix);
    const css = regexFallbackPlugin.parseDirect(files[1], ix);
    expect(html.imports).toEqual([]);
    expect(css.imports).toEqual([]);
    expect(html.parseError).toBe(false);
    expect(css.parseError).toBe(false);
  });
});
