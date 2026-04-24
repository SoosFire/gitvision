// Smoke tests for the tree-sitter runtime. These exist primarily to verify
// WASM loading works in our Node environment before we build the orchestrator
// on top of it. If these pass, Phase 1 scaffolding is good.

import { describe, it, expect, beforeAll } from "vitest";
import { Parser } from "web-tree-sitter";
import { ensureRuntime, loadBuiltinGrammar } from "../codeAnalysis/runtime";
import { javascriptPlugin } from "../codeAnalysis/plugins/javascript";

describe("codeAnalysis runtime", () => {
  beforeAll(async () => {
    await ensureRuntime();
  });

  it("boots the tree-sitter core WASM without error", async () => {
    // If ensureRuntime() threw in beforeAll, this test wouldn't run at all.
    await ensureRuntime(); // idempotent — second call should be instant
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
    // Check the structure reaches into the code. tree-sitter-javascript uses
    // `lexical_declaration` for const/let and `function_declaration` for fn decls.
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

  it("uses the javascript grammar for plain JS (no TS-only syntax should parse as JS with types)", () => {
    const js = javascriptPlugin.languageFor("js");
    const parser = new Parser();
    parser.setLanguage(js);
    // Type annotations SHOULD fail in the JS grammar — confirms we got distinct grammars.
    const tree = parser.parse("const x: number = 1;");
    expect(tree).not.toBeNull();
    expect(tree!.rootNode.hasError).toBe(true);
    parser.delete();
    tree!.delete();
  });
});
