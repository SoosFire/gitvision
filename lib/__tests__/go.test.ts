// Tests for the Go tree-sitter plugin. Covers:
//   1. Grammar boots, parses Go source without errors
//   2. Queries extract single + grouped imports, function + method defs,
//      bare + selector calls, decision points
//   3. Resolver: go.mod-based prefix match, suffix-match heuristic,
//      external imports return null
//   4. prepareForRepo reads a real go.mod from a temp dir

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Parser } from "web-tree-sitter";
import { goPlugin } from "../codeAnalysis/plugins/go";
import { parseFile } from "../codeAnalysis/parse";
import type { FileIndex, SourceFile } from "../codeAnalysis/types";

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

describe("goPlugin — basic contract", () => {
  beforeAll(async () => {
    await goPlugin.load();
  });

  it("advertises the .go extension only", () => {
    expect([...goPlugin.extensions]).toEqual(["go"]);
  });

  it("loads the tree-sitter-go grammar", () => {
    expect(goPlugin.languageFor("go")).toBeTruthy();
  });

  it("parses simple Go without error", () => {
    const lang = goPlugin.languageFor("go");
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(
      'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hi")\n}\n'
    );
    expect(tree).not.toBeNull();
    expect(tree!.rootNode.hasError).toBe(false);
    expect(tree!.rootNode.type).toBe("source_file");
    parser.delete();
    tree!.delete();
  });
});

describe("goPlugin.resolveImport with go.mod context", () => {
  const files: SourceFile[] = [
    { rel: "main.go", ext: "go", content: "" },
    { rel: "internal/foo/foo.go", ext: "go", content: "" },
    { rel: "internal/foo/bar.go", ext: "go", content: "" },
    { rel: "pkg/util/util.go", ext: "go", content: "" },
    { rel: "vendor/external/lib.go", ext: "go", content: "" },
  ];

  function withModule(modulePath: string): Map<string, unknown> {
    return new Map([["go", { modulePath }]]);
  }

  it("resolves a local-module import via prefix strip", () => {
    const ix = makeIndex(files, withModule("github.com/owner/repo"));
    expect(
      goPlugin.resolveImport(
        '"github.com/owner/repo/internal/foo"',
        "main.go",
        ix
      )
    ).toBe("internal/foo/bar.go");
    // bar.go alphabetically before foo.go — deterministic pick
  });

  it("resolves a sub-package via prefix strip", () => {
    const ix = makeIndex(files, withModule("github.com/owner/repo"));
    expect(
      goPlugin.resolveImport(
        '"github.com/owner/repo/pkg/util"',
        "main.go",
        ix
      )
    ).toBe("pkg/util/util.go");
  });

  it("returns null for an external (stdlib) import even with go.mod present", () => {
    const ix = makeIndex(files, withModule("github.com/owner/repo"));
    expect(goPlugin.resolveImport('"fmt"', "main.go", ix)).toBeNull();
    expect(goPlugin.resolveImport('"net/http"', "main.go", ix)).toBeNull();
  });

  it("strips both double quotes and backticks defensively", () => {
    const ix = makeIndex(files, withModule("github.com/owner/repo"));
    expect(
      goPlugin.resolveImport(
        "`github.com/owner/repo/pkg/util`",
        "main.go",
        ix
      )
    ).toBe("pkg/util/util.go");
  });

  it("falls back to suffix-match when go.mod prefix doesn't match", () => {
    // Even with go.mod set to one module, an import to a DIFFERENT local
    // path under the repo (sub-modules, vendored packages) can resolve via
    // the suffix heuristic.
    const ix = makeIndex(files, withModule("github.com/owner/repo"));
    expect(
      goPlugin.resolveImport('"some/external/foo"', "main.go", ix)
    ).toBe("internal/foo/bar.go"); // suffix "foo" matches internal/foo
  });
});

describe("goPlugin.resolveImport without go.mod context", () => {
  const files: SourceFile[] = [
    { rel: "main.go", ext: "go", content: "" },
    { rel: "pkg/util/u.go", ext: "go", content: "" },
  ];
  const ix = makeIndex(files); // no extras

  it("uses the suffix-match heuristic", () => {
    expect(goPlugin.resolveImport('"x/y/util"', "main.go", ix)).toBe(
      "pkg/util/u.go"
    );
  });

  it("returns null when no suffix matches any directory", () => {
    expect(
      goPlugin.resolveImport('"strings"', "main.go", ix)
    ).toBeNull();
  });
});

describe("goPlugin.prepareForRepo", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gitvision-go-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it("reads the module path out of go.mod", async () => {
    await fs.writeFile(
      path.join(tmp, "go.mod"),
      "module github.com/owner/repo\n\ngo 1.21\n",
      "utf-8"
    );
    const ix = makeIndex([]);
    await goPlugin.prepareForRepo(tmp, ix);
    const ctx = ix.extras.get("go") as { modulePath: string | null };
    expect(ctx.modulePath).toBe("github.com/owner/repo");
  });

  it("stores null modulePath when go.mod is absent (graceful degrade)", async () => {
    const ix = makeIndex([]);
    await goPlugin.prepareForRepo(tmp, ix);
    const ctx = ix.extras.get("go") as { modulePath: string | null };
    expect(ctx.modulePath).toBeNull();
  });

  it("survives malformed go.mod without throwing", async () => {
    await fs.writeFile(
      path.join(tmp, "go.mod"),
      "this is not a valid go.mod\n",
      "utf-8"
    );
    const ix = makeIndex([]);
    await expect(goPlugin.prepareForRepo(tmp, ix)).resolves.toBeUndefined();
    const ctx = ix.extras.get("go") as { modulePath: string | null };
    expect(ctx.modulePath).toBeNull();
  });
});

describe("goPlugin — parseFile end-to-end", () => {
  beforeAll(async () => {
    await goPlugin.load();
  });

  it("captures both single and grouped import forms", () => {
    const content =
      'package main\n' +
      'import "fmt"\n' +
      'import (\n' +
      '\t"os"\n' +
      '\t"net/http"\n' +
      '\tlog "log/slog"\n' +
      '\t_ "side/effect/only"\n' +
      ')\n';
    const file: SourceFile = { rel: "main.go", ext: "go", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(goPlugin, file, ix);
    expect(parsed.parseError).toBe(false);
    const specs = parsed.imports.map((i) =>
      i.rawSpec.replace(/^["`]|["`]$/g, "")
    );
    expect(specs).toContain("fmt");
    expect(specs).toContain("os");
    expect(specs).toContain("net/http");
    expect(specs).toContain("log/slog");
    expect(specs).toContain("side/effect/only");
  });

  it("extracts function and method declarations", () => {
    const content =
      'package main\n' +
      'func TopLevel() int { return 1 }\n' +
      'type S struct{}\n' +
      'func (s *S) Method() int { return 2 }\n' +
      'func (s S) ByValue(x int) int { return x }\n';
    const file: SourceFile = { rel: "x.go", ext: "go", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(goPlugin, file, ix);
    const names = parsed.functions.map((f) => f.name).sort();
    expect(names).toEqual(["ByValue", "Method", "TopLevel"]);
  });

  it("computes complexity from Go decision points", () => {
    const content =
      'package main\n' +
      'func simple() int { return 1 }\n' +
      'func branchy(x int) int {\n' +
      '\tif x > 0 {\n' +
      '\t\tfor i := 0; i < x; i++ {\n' +
      '\t\t\tif i%2 == 0 && i > 2 {\n' +
      '\t\t\t\treturn i\n' +
      '\t\t\t}\n' +
      '\t\t}\n' +
      '\t} else if x < 0 {\n' +
      '\t\tswitch x {\n' +
      '\t\tcase -1:\n' +
      '\t\t\treturn -1\n' +
      '\t\tcase -2:\n' +
      '\t\t\treturn -2\n' +
      '\t\tdefault:\n' +
      '\t\t\treturn 0\n' +
      '\t\t}\n' +
      '\t}\n' +
      '\treturn 0\n' +
      '}\n';
    const file: SourceFile = { rel: "b.go", ext: "go", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(goPlugin, file, ix);
    const simple = parsed.functions.find((f) => f.name === "simple");
    const branchy = parsed.functions.find((f) => f.name === "branchy");
    expect(simple?.complexity).toBe(1);
    // branchy: 1 base + outer if + for + inner if + && + else-if (a nested
    // if_statement) + switch case -1 + switch case -2 = 8
    // (default_case intentionally not counted, matching JS plugin)
    expect(branchy?.complexity).toBe(8);
  });

  it("captures bare and selector calls, attributing to enclosing function", () => {
    const content =
      'package main\n' +
      'func outer() {\n' +
      '\thelper()\n' +
      '\tfmt.Println("hi")\n' +
      '}\n' +
      'func helper() {}\n' +
      'topLevel()\n'; // intentionally outside a fn — Go would syntax-error,
    // but tree-sitter is error-tolerant so let's keep the test focused on
    // the resolved happy path
    const file: SourceFile = { rel: "c.go", ext: "go", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(goPlugin, file, ix);
    const outerCalls = parsed.calls
      .filter((c) => c.inFunction === "outer")
      .map((c) => c.calleeName)
      .sort();
    expect(outerCalls).toContain("helper");
    expect(outerCalls).toContain("Println"); // selector call captured by name
  });
});
