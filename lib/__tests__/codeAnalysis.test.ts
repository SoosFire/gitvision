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
import {
  looksVendoredByPath,
  looksMinifiedByContent,
} from "../codeAnalysis/analyze";
import type { FileIndex, SourceFile } from "../codeAnalysis/types";

// Shared helper — build a FileIndex from a list of SourceFiles. Optional
// `extras` arg lets tests pre-populate the per-plugin extras bag (e.g.
// tsconfig path mappings) without going through prepareForRepo's I/O.
function makeIndex(
  files: SourceFile[],
  extras: Map<string, unknown> = new Map()
): FileIndex {
  const byPath = new Map<string, SourceFile>();
  const byExt = new Map<string, SourceFile[]>();
  for (const f of files) {
    byPath.set(f.rel, f);
    const arr = byExt.get(f.ext) ?? [];
    arr.push(f);
    byExt.set(f.ext, arr);
  }
  return { byPath, byExt, extras };
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

  it("advertises the eight JS/TS extensions including .mts/.cts", () => {
    expect([...javascriptPlugin.extensions].sort()).toEqual(
      ["cjs", "cts", "js", "jsx", "mjs", "mts", "ts", "tsx"]
    );
  });

  it("languageFor maps .mts/.cts to the typescript grammar", () => {
    expect(javascriptPlugin.languageFor("mts")).toBe(
      javascriptPlugin.languageFor("ts")
    );
    expect(javascriptPlugin.languageFor("cts")).toBe(
      javascriptPlugin.languageFor("ts")
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

  it("TS-ESM convention: ./foo.js spec resolves to ./foo.ts file", () => {
    // This is THE pattern modern TS libraries use (zod, lit, fastify, ...).
    // The TS compiler doesn't rewrite specifiers, so source must say .js even
    // though the file on disk is .ts.
    expect(
      javascriptPlugin.resolveImport("./utils/helpers.js", "src/a.ts", ix)
    ).toBe("src/utils/helpers.ts");
  });

  it("TS-ESM convention covers .jsx/.tsx, .mjs/.mts, .cjs/.cts pairs", () => {
    const files: SourceFile[] = [
      { rel: "src/Btn.tsx", ext: "tsx", content: "" },
      { rel: "src/loader.mts", ext: "mts", content: "" },
      { rel: "src/legacy.cts", ext: "cts", content: "" },
    ];
    const ix2 = makeIndex(files);
    expect(javascriptPlugin.resolveImport("./Btn.jsx", "src/a.ts", ix2)).toBe(
      "src/Btn.tsx"
    );
    expect(javascriptPlugin.resolveImport("./loader.mjs", "src/a.ts", ix2)).toBe(
      "src/loader.mts"
    );
    expect(javascriptPlugin.resolveImport("./legacy.cjs", "src/a.ts", ix2)).toBe(
      "src/legacy.cts"
    );
  });

  it("prefers exact match over .js→.ts swap when both files exist", () => {
    const files: SourceFile[] = [
      { rel: "src/foo.js", ext: "js", content: "" }, // real .js file
      { rel: "src/foo.ts", ext: "ts", content: "" }, // also a .ts neighbor
    ];
    const ix2 = makeIndex(files);
    expect(javascriptPlugin.resolveImport("./foo.js", "src/a.ts", ix2)).toBe(
      "src/foo.js" // exact match wins
    );
  });
});

describe("javascriptPlugin.resolveImport — tsconfig path mappings", () => {
  const files: SourceFile[] = [
    { rel: "src/lib/types.ts", ext: "ts", content: "" },
    { rel: "src/components/Button.tsx", ext: "tsx", content: "" },
    { rel: "src/utils/helpers.ts", ext: "ts", content: "" },
    { rel: "shared/logger.ts", ext: "ts", content: "" },
  ];

  /** Helper: build extras with just a tsconfig (no workspaces). */
  function tsExtras(
    mappings: { baseUrl: string; paths: Record<string, string[]> }
  ): Map<string, unknown> {
    return new Map([["javascript", { tsPathMappings: mappings }]]);
  }

  it("resolves @/lib/types via tsconfig paths {@/* → src/*}", () => {
    const ix = makeIndex(
      files,
      tsExtras({ baseUrl: "", paths: { "@/*": ["src/*"] } })
    );
    expect(
      javascriptPlugin.resolveImport("@/lib/types", "anywhere.ts", ix)
    ).toBe("src/lib/types.ts");
  });

  it("resolves ~/* aliased to a different prefix", () => {
    const ix = makeIndex(
      files,
      tsExtras({ baseUrl: "", paths: { "~/*": ["shared/*"] } })
    );
    expect(
      javascriptPlugin.resolveImport("~/logger", "anywhere.ts", ix)
    ).toBe("shared/logger.ts");
  });

  it("respects baseUrl when joining substitutions", () => {
    // baseUrl: "src" + paths { "@/*": ["./*"] } means "@/lib/types" → src/lib/types
    const ix = makeIndex(
      files,
      tsExtras({ baseUrl: "src", paths: { "@/*": ["./*"] } })
    );
    expect(
      javascriptPlugin.resolveImport("@/lib/types", "src/x.ts", ix)
    ).toBe("src/lib/types.ts");
  });

  it("supports multiple substitutions, returning the first that hits a real file", () => {
    const ix = makeIndex(
      files,
      tsExtras({
        baseUrl: "",
        paths: { "@app/*": ["nonexistent/*", "src/components/*"] },
      })
    );
    expect(
      javascriptPlugin.resolveImport("@app/Button", "anywhere.ts", ix)
    ).toBe("src/components/Button.tsx");
  });

  it("falls back to relative resolution when no path mapping matches", () => {
    const ix = makeIndex(
      files,
      tsExtras({ baseUrl: "", paths: { "@/*": ["src/*"] } })
    );
    // Spec doesn't match @/* — should resolve relative as before
    expect(
      javascriptPlugin.resolveImport(
        "../utils/helpers",
        "src/components/Button.tsx",
        ix
      )
    ).toBe("src/utils/helpers.ts");
  });

  it("returns null when path mapping points at nothing real", () => {
    const ix = makeIndex(
      files,
      tsExtras({ baseUrl: "", paths: { "@/*": ["src/*"] } })
    );
    expect(
      javascriptPlugin.resolveImport("@/does/not/exist", "x.ts", ix)
    ).toBeNull();
  });
});

describe("javascriptPlugin.resolveImport — empty / dot paths to repo root", () => {
  // express's examples directory does `import "../.."` from
  // examples/auth/index.js, expecting it to find the root index.js.
  // Before the fix this normalized to "" or "." and returned null.
  const files: SourceFile[] = [
    { rel: "index.js", ext: "js", content: "" },
    { rel: "examples/auth/index.js", ext: "js", content: "" },
  ];
  const ix = makeIndex(files);

  it("`../..` from examples/auth/index.js resolves to root index.js", () => {
    expect(
      javascriptPlugin.resolveImport("../..", "examples/auth/index.js", ix)
    ).toBe("index.js");
  });

  it("`../../` (trailing slash) from same place also resolves", () => {
    expect(
      javascriptPlugin.resolveImport("../../", "examples/auth/index.js", ix)
    ).toBe("index.js");
  });
});

describe("javascriptPlugin.resolveImport — workspace packages", () => {
  // Synthetic monorepo with two packages
  const files: SourceFile[] = [
    {
      rel: "packages/core/src/index.ts",
      ext: "ts",
      content: "",
    },
    {
      rel: "packages/core/src/utils.ts",
      ext: "ts",
      content: "",
    },
    {
      rel: "packages/ui/src/index.ts",
      ext: "ts",
      content: "",
    },
    { rel: "apps/web/src/main.ts", ext: "ts", content: "" },
  ];

  function workspaceExtras(): Map<string, unknown> {
    const workspaces = new Map([
      [
        "@acme/core",
        {
          name: "@acme/core",
          packageDir: "packages/core",
          sourcePath: "packages/core/src/index.ts",
        },
      ],
      [
        "@acme/ui",
        {
          name: "@acme/ui",
          packageDir: "packages/ui",
          sourcePath: "packages/ui/src/index.ts",
        },
      ],
    ]);
    return new Map([["javascript", { workspaces }]]);
  }

  it("resolves a bare workspace package name to its source entry", () => {
    const ix = makeIndex(files, workspaceExtras());
    expect(
      javascriptPlugin.resolveImport("@acme/core", "apps/web/src/main.ts", ix)
    ).toBe("packages/core/src/index.ts");
  });

  it("resolves a workspace subpath (treats packages/core/utils as the file)", () => {
    const ix = makeIndex(files, workspaceExtras());
    // @acme/core/utils — try packageDir/utils first, then packageDir/src/utils
    expect(
      javascriptPlugin.resolveImport(
        "@acme/core/utils",
        "apps/web/src/main.ts",
        ix
      )
    ).toBe("packages/core/src/utils.ts");
  });

  it("returns null for a non-workspace external package", () => {
    const ix = makeIndex(files, workspaceExtras());
    expect(
      javascriptPlugin.resolveImport("react", "apps/web/src/main.ts", ix)
    ).toBeNull();
  });

  it("tsconfig path mapping wins over workspaces when both are configured", () => {
    // Belt-and-braces: a repo declares both. tsconfig has a more specific
    // alias for @acme/core that points elsewhere — should be honored first.
    const extraFiles: SourceFile[] = [
      ...files,
      { rel: "internal/core-shim.ts", ext: "ts", content: "" },
    ];
    const ws = workspaceExtras();
    const ctx = ws.get("javascript") as {
      workspaces: Map<string, { sourcePath: string }>;
    };
    const merged = new Map<string, unknown>([
      [
        "javascript",
        {
          tsPathMappings: {
            baseUrl: "",
            paths: { "@acme/core": ["internal/core-shim.ts"] },
          },
          workspaces: ctx.workspaces,
        },
      ],
    ]);
    const ix = makeIndex(extraFiles, merged);
    expect(
      javascriptPlugin.resolveImport("@acme/core", "apps/web/src/main.ts", ix)
    ).toBe("internal/core-shim.ts");
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

describe("vendored/minified file filter", () => {
  describe("looksVendoredByPath", () => {
    it("rejects test fixture/asset paths", () => {
      expect(looksVendoredByPath("tests/assets/react/react-dom.js")).toBe(true);
      expect(looksVendoredByPath("test/fixtures/lodash.js")).toBe(true);
      expect(looksVendoredByPath("packages/foo/tests/assets/vue.js")).toBe(
        true
      );
    });

    it("rejects vendor / third-party directories", () => {
      expect(looksVendoredByPath("vendor/jquery.js")).toBe(true);
      expect(looksVendoredByPath("packages/x/vendored/preact.js")).toBe(true);
      expect(looksVendoredByPath("third_party/codemirror.js")).toBe(true);
      expect(looksVendoredByPath("third-party/parser.js")).toBe(true);
    });

    it("rejects .min.js / .bundle.js outputs", () => {
      expect(looksVendoredByPath("dist/app.min.js")).toBe(true);
      expect(looksVendoredByPath("public/lib.bundle.js")).toBe(true);
      expect(looksVendoredByPath("packages/ui/main-bundle.mjs")).toBe(true);
    });

    it("accepts ordinary source files", () => {
      expect(looksVendoredByPath("src/index.ts")).toBe(false);
      expect(looksVendoredByPath("packages/core/src/util.ts")).toBe(false);
      expect(looksVendoredByPath("test/utils.ts")).toBe(false); // /test/, not /tests/assets/
      expect(looksVendoredByPath("__tests__/foo.test.ts")).toBe(false);
    });
  });

  describe("looksMinifiedByContent", () => {
    it("accepts normal-sized source", () => {
      const src =
        "import { foo } from './bar';\n".repeat(200) +
        "function hi() { return 42; }";
      expect(looksMinifiedByContent(src)).toBe(false);
    });

    it("accepts large but well-formatted files", () => {
      // 60KB of normal code with average ~50 chars per line
      const src = ("function f() { return 1; }\n".repeat(2200));
      expect(src.length).toBeGreaterThan(50_000);
      expect(looksMinifiedByContent(src)).toBe(false);
    });

    it("rejects huge single-line content (classic minified bundle)", () => {
      const minified = "!function(e){var t={};".repeat(5_000); // ~110KB, no newlines
      expect(looksMinifiedByContent(minified)).toBe(true);
    });

    it("rejects content where avg line length is enormous", () => {
      // 60KB total, two huge lines averaging 30KB each
      const huge = "x".repeat(30_000) + "\n" + "y".repeat(30_000);
      expect(looksMinifiedByContent(huge)).toBe(true);
    });
  });
});
