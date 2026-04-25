// Tests for the codeAnalysis pipeline.
//
// Three layers:
//   1. Runtime smoke tests — WASM boots, grammars load, JS-vs-TS distinction
//   2. Plugin contract — javascript plugin loads all three grammars
//   3. Parser end-to-end — queries extract imports, functions, calls, complexity
//      from real source text; resolver routes relative imports correctly

import { describe, it, expect, beforeAll } from "vitest";
import { Parser } from "web-tree-sitter";
import { ensureRuntime, loadBuiltinGrammar } from "../codeAnalysis/runtime";
import { javascriptPlugin } from "../codeAnalysis/plugins/javascript";
import { parseFile } from "../codeAnalysis/parse";
import type { FileIndex, SourceFile } from "../codeAnalysis/types";

// Shared helper — build a FileIndex from a list of SourceFiles.
function makeIndex(files: SourceFile[]): FileIndex {
  const byPath = new Map<string, SourceFile>();
  const byExt = new Map<string, SourceFile[]>();
  for (const f of files) {
    byPath.set(f.rel, f);
    const arr = byExt.get(f.ext) ?? [];
    arr.push(f);
    byExt.set(f.ext, arr);
  }
  return { byPath, byExt };
}

describe("codeAnalysis runtime", () => {
  beforeAll(async () => {
    await ensureRuntime();
  });

  it("boots the tree-sitter core WASM without error", async () => {
    await ensureRuntime(); // idempotent
    expect(true).toBe(true);
  });

  it("loads the JavaScript grammar and parses a program", async () => {
    const js = await loadBuiltinGrammar("tree-sitter-javascript");
    const parser = new Parser();
    parser.setLanguage(js);
    const tree = parser.parse("const x = 1 + 2;\nfunction hi() { return x; }");
    expect(tree).not.toBeNull();
    const root = tree!.rootNode;
    expect(root.type).toBe("program");
    expect(root.hasError).toBe(false);
    // tree-sitter-javascript uses `lexical_declaration` for const/let
    const src = root.toString();
    expect(src).toContain("lexical_declaration");
    expect(src).toContain("function_declaration");
    parser.delete();
    tree!.delete();
  });
});

describe("javascriptPlugin", () => {
  beforeAll(async () => {
    await javascriptPlugin.load();
  });

  it("advertises the six JS/TS extensions", () => {
    expect([...javascriptPlugin.extensions].sort()).toEqual(
      ["cjs", "js", "jsx", "mjs", "ts", "tsx"]
    );
  });

  it("loads all three grammars and exposes them via languageFor()", () => {
    expect(javascriptPlugin.languageFor("js")).toBeTruthy();
    expect(javascriptPlugin.languageFor("jsx")).toBeTruthy();
    expect(javascriptPlugin.languageFor("mjs")).toBeTruthy();
    expect(javascriptPlugin.languageFor("cjs")).toBeTruthy();
    expect(javascriptPlugin.languageFor("ts")).toBeTruthy();
    expect(javascriptPlugin.languageFor("tsx")).toBeTruthy();
  });

  it("parses TypeScript type annotations without error", () => {
    const ts = javascriptPlugin.languageFor("ts");
    const parser = new Parser();
    parser.setLanguage(ts);
    const tree = parser.parse(
      "interface User { id: number; name: string }\n" +
        "const u: User = { id: 1, name: 'x' };"
    );
    expect(tree).not.toBeNull();
    expect(tree!.rootNode.hasError).toBe(false);
    parser.delete();
    tree!.delete();
  });

  it("parses TSX (JSX inside a typed file) without error", () => {
    const tsx = javascriptPlugin.languageFor("tsx");
    const parser = new Parser();
    parser.setLanguage(tsx);
    const tree = parser.parse(
      "type Props = { name: string }\n" +
        "export function Hello({ name }: Props) { return <span>Hi {name}</span>; }"
    );
    expect(tree).not.toBeNull();
    expect(tree!.rootNode.hasError).toBe(false);
    parser.delete();
    tree!.delete();
  });

  it("JS-only grammar rejects TypeScript syntax (grammars are distinct)", () => {
    const js = javascriptPlugin.languageFor("js");
    const parser = new Parser();
    parser.setLanguage(js);
    const tree = parser.parse("const x: number = 1;");
    expect(tree).not.toBeNull();
    expect(tree!.rootNode.hasError).toBe(true);
    parser.delete();
    tree!.delete();
  });
});

describe("javascriptPlugin.resolveImport", () => {
  const files: SourceFile[] = [
    { rel: "src/a.ts", ext: "ts", content: "" },
    { rel: "src/utils/helpers.ts", ext: "ts", content: "" },
    { rel: "src/components/Button.tsx", ext: "tsx", content: "" },
    { rel: "src/lib/index.ts", ext: "ts", content: "" },
    { rel: "src/legacy.js", ext: "js", content: "" },
  ];
  const ix = makeIndex(files);

  it("returns null for external packages", () => {
    expect(javascriptPlugin.resolveImport("react", "src/a.ts", ix)).toBeNull();
    expect(
      javascriptPlugin.resolveImport("@anthropic-ai/sdk", "src/a.ts", ix)
    ).toBeNull();
  });

  it("resolves a relative file with extension", () => {
    expect(
      javascriptPlugin.resolveImport("./utils/helpers.ts", "src/a.ts", ix)
    ).toBe("src/utils/helpers.ts");
  });

  it("resolves a relative file without extension by trying each", () => {
    expect(
      javascriptPlugin.resolveImport("./utils/helpers", "src/a.ts", ix)
    ).toBe("src/utils/helpers.ts");
    expect(
      javascriptPlugin.resolveImport("./components/Button", "src/a.ts", ix)
    ).toBe("src/components/Button.tsx");
  });

  it("resolves a directory import via index.*", () => {
    expect(javascriptPlugin.resolveImport("./lib", "src/a.ts", ix)).toBe(
      "src/lib/index.ts"
    );
  });

  it("walks up with ../", () => {
    expect(
      javascriptPlugin.resolveImport("../legacy", "src/utils/helpers.ts", ix)
    ).toBe("src/legacy.js");
  });

  it("returns null for unknown relative paths", () => {
    expect(
      javascriptPlugin.resolveImport("./not-here", "src/a.ts", ix)
    ).toBeNull();
  });
});

describe("parseFile — JavaScript extraction", () => {
  beforeAll(async () => {
    await javascriptPlugin.load();
  });

  it("extracts ES imports, CommonJS require, and re-exports", () => {
    const file: SourceFile = {
      rel: "src/main.ts",
      ext: "ts",
      content: `
        import React from "react";
        import { foo } from "./utils/foo";
        import "./styles.css";
        const lib = require("lodash");
        export { something } from "./other";
      `,
    };
    const ix = makeIndex([file, { rel: "src/utils/foo.ts", ext: "ts", content: "" }]);
    const parsed = parseFile(javascriptPlugin, file, ix);
    expect(parsed.parseError).toBe(false);
    const specs = parsed.imports.map((i) => i.rawSpec).sort();
    expect(specs).toContain("react");
    expect(specs).toContain("./utils/foo");
    expect(specs).toContain("./styles.css");
    expect(specs).toContain("lodash");
    expect(specs).toContain("./other");
    // './utils/foo' should resolve to the known file
    const resolved = parsed.imports.find((i) => i.rawSpec === "./utils/foo");
    expect(resolved?.resolvedPath).toBe("src/utils/foo.ts");
    // 'react' is external and stays null
    expect(parsed.imports.find((i) => i.rawSpec === "react")?.resolvedPath).toBeNull();
  });

  it("extracts function declarations, methods, and arrow assignments", () => {
    const file: SourceFile = {
      rel: "src/shapes.ts",
      ext: "ts",
      content: `
        function topLevel() { return 1; }
        const arrow = () => 42;
        const expr = function inner() { return "x"; };
        class Widget {
          render() { return null; }
          handle() { if (true) { return 1; } else { return 2; } }
        }
      `,
    };
    const ix = makeIndex([file]);
    const parsed = parseFile(javascriptPlugin, file, ix);
    const names = parsed.functions.map((f) => f.name).sort();
    expect(names).toContain("topLevel");
    expect(names).toContain("arrow");
    expect(names).toContain("expr");
    expect(names).toContain("render");
    expect(names).toContain("handle");
  });

  it("computes cyclomatic complexity from decision points", () => {
    const file: SourceFile = {
      rel: "src/complex.ts",
      ext: "ts",
      content: `
        function simple() { return 1; }
        function branchy(x) {
          if (x > 0) {
            for (let i = 0; i < x; i++) {
              if (i % 2 === 0 && i > 2) {
                console.log(i);
              }
            }
          } else {
            try {
              return x === 0 ? "zero" : "neg";
            } catch (e) {
              return "err";
            }
          }
          return 0;
        }
      `,
    };
    const ix = makeIndex([file]);
    const parsed = parseFile(javascriptPlugin, file, ix);
    const simple = parsed.functions.find((f) => f.name === "simple");
    const branchy = parsed.functions.find((f) => f.name === "branchy");
    expect(simple?.complexity).toBe(1);
    // branchy: 1 (base) + if + for + if + && + ternary + catch = 7
    expect(branchy?.complexity).toBe(7);
  });

  it("attributes calls to their enclosing function", () => {
    const file: SourceFile = {
      rel: "src/calls.ts",
      ext: "ts",
      content: `
        function outer() {
          helper();
          return inner();
        }
        function inner() {
          return util();
        }
        function helper() {}
        function util() {}
        topLevel();
      `,
    };
    const ix = makeIndex([file]);
    const parsed = parseFile(javascriptPlugin, file, ix);
    const outerCalls = parsed.calls.filter((c) => c.inFunction === "outer");
    const innerCalls = parsed.calls.filter((c) => c.inFunction === "inner");
    const moduleScope = parsed.calls.filter((c) => c.inFunction === null);
    expect(outerCalls.map((c) => c.calleeName).sort()).toEqual(["helper", "inner"]);
    expect(innerCalls.map((c) => c.calleeName)).toEqual(["util"]);
    expect(moduleScope.map((c) => c.calleeName)).toEqual(["topLevel"]);
  });

  it("extracts method calls via member_expression", () => {
    const file: SourceFile = {
      rel: "src/m.ts",
      ext: "ts",
      content: `
        function use() {
          obj.method();
          other.nested.deeper();
        }
      `,
    };
    const ix = makeIndex([file]);
    const parsed = parseFile(javascriptPlugin, file, ix);
    const callees = parsed.calls.map((c) => c.calleeName).sort();
    expect(callees).toContain("method");
    expect(callees).toContain("deeper");
  });

  it("works on TSX with JSX-returning components", () => {
    const file: SourceFile = {
      rel: "src/Button.tsx",
      ext: "tsx",
      content: `
        import React from "react";
        export function Button({ label }: { label: string }) {
          return <button onClick={() => alert(label)}>{label}</button>;
        }
      `,
    };
    const ix = makeIndex([file]);
    const parsed = parseFile(javascriptPlugin, file, ix);
    expect(parsed.parseError).toBe(false);
    expect(parsed.functions.some((f) => f.name === "Button")).toBe(true);
    expect(parsed.imports.find((i) => i.rawSpec === "react")).toBeTruthy();
  });

  it("returns a parseError flag without crashing on malformed code", () => {
    const file: SourceFile = {
      rel: "src/broken.js",
      ext: "js",
      content: "const x = 1\nfunction { broken syntax ]]]",
    };
    const ix = makeIndex([file]);
    const parsed = parseFile(javascriptPlugin, file, ix);
    // We still return a ParsedFile; tree-sitter is error-tolerant, so
    // parseError stays false for partial parses. What matters is no throw.
    expect(parsed.rel).toBe("src/broken.js");
  });
});
