// Tests for the cross-file aggregator. Pure logic — uses hand-built
// ParsedFile fixtures so we exercise the disambiguation rules and the
// per-plugin stats roll-up without hitting tree-sitter.

import { describe, it, expect } from "vitest";
import { buildCodeGraph } from "../codeAnalysis/codeGraph";
import type { ParsedFile } from "../codeAnalysis/types";

function pf(over: Partial<ParsedFile> & { rel: string }): ParsedFile {
  return {
    rel: over.rel,
    imports: over.imports ?? [],
    functions: over.functions ?? [],
    calls: over.calls ?? [],
    fileComplexity: over.fileComplexity ?? 1,
    parseError: over.parseError ?? false,
  };
}

describe("buildCodeGraph", () => {
  it("returns an empty graph for an empty input", () => {
    const g = buildCodeGraph({
      parsedFiles: [],
      pluginByFile: new Map(),
    });
    expect(g.functions).toEqual([]);
    expect(g.calls).toEqual([]);
    expect(g.imports).toEqual([]);
    expect(g.byPlugin).toEqual({});
    expect(g.fileComplexity).toEqual({});
  });

  it("collects functions across files with their owning file path", () => {
    const files = [
      pf({
        rel: "src/a.ts",
        functions: [
          { name: "foo", startRow: 10, endRow: 20, complexity: 3 },
          { name: "bar", startRow: 25, endRow: 30, complexity: 1 },
        ],
      }),
      pf({
        rel: "src/b.ts",
        functions: [
          { name: "baz", startRow: 5, endRow: 15, complexity: 2 },
        ],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map([
        ["src/a.ts", "javascript"],
        ["src/b.ts", "javascript"],
      ]),
    });
    expect(g.functions).toHaveLength(3);
    expect(g.functions.find((f) => f.name === "foo")?.filePath).toBe(
      "src/a.ts"
    );
    expect(g.functions.find((f) => f.name === "baz")?.complexity).toBe(2);
  });

  it("resolves calls to the unique same-named function when there's only one", () => {
    const files = [
      pf({
        rel: "src/api.ts",
        functions: [{ name: "fetchUser", startRow: 1, endRow: 10, complexity: 1 }],
      }),
      pf({
        rel: "src/page.ts",
        calls: [{ calleeName: "fetchUser", inFunction: "render" }],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    const edge = g.calls.find((c) => c.calleeName === "fetchUser");
    expect(edge?.toFile).toBe("src/api.ts");
    expect(edge?.toFunction).toBe("fetchUser");
    expect(edge?.fromFunction).toBe("render");
  });

  it("disambiguates same-named functions: prefers same-file definition", () => {
    const files = [
      pf({
        rel: "src/local.ts",
        functions: [{ name: "helper", startRow: 1, endRow: 5, complexity: 1 }],
        calls: [{ calleeName: "helper", inFunction: "main" }],
      }),
      pf({
        rel: "src/other.ts",
        functions: [{ name: "helper", startRow: 1, endRow: 5, complexity: 1 }],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    const edge = g.calls[0];
    expect(edge.toFile).toBe("src/local.ts");
  });

  it("disambiguates via imports when no same-file definition", () => {
    const files = [
      pf({
        rel: "src/a.ts",
        functions: [{ name: "helper", startRow: 1, endRow: 5, complexity: 1 }],
      }),
      pf({
        rel: "src/b.ts",
        functions: [{ name: "helper", startRow: 1, endRow: 5, complexity: 1 }],
      }),
      pf({
        rel: "src/page.ts",
        imports: [{ rawSpec: "./b", resolvedPath: "src/b.ts" }],
        calls: [{ calleeName: "helper", inFunction: null }],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    const edge = g.calls[0];
    // src/b.ts is imported by src/page.ts, src/a.ts isn't — so b wins
    expect(edge.toFile).toBe("src/b.ts");
  });

  it("leaves ambiguous calls unresolved (multiple candidates, no import hint)", () => {
    const files = [
      pf({
        rel: "src/a.ts",
        functions: [{ name: "shared", startRow: 1, endRow: 5, complexity: 1 }],
      }),
      pf({
        rel: "src/b.ts",
        functions: [{ name: "shared", startRow: 1, endRow: 5, complexity: 1 }],
      }),
      pf({
        rel: "src/page.ts",
        calls: [{ calleeName: "shared", inFunction: null }],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    const edge = g.calls[0];
    expect(edge.toFile).toBeNull(); // ambiguous
    expect(edge.toFunction).toBeNull();
    expect(edge.calleeName).toBe("shared");
  });

  it("type-aware: matches calleeType against containerType before name fallback (v0.15)", () => {
    // The Java validator scenario: 7 ValidateXxx classes each with a
    // validate() method. Without type-aware resolution, a `vp.validate()`
    // call would pick whichever validator file was iterated first. With
    // calleeType + containerType the match is deterministic.
    const files = [
      pf({
        rel: "ValidatePassword.java",
        functions: [
          {
            name: "validate",
            startRow: 1,
            endRow: 10,
            complexity: 5,
            containerType: "ValidatePassword",
          },
        ],
      }),
      pf({
        rel: "ValidateEmail.java",
        functions: [
          {
            name: "validate",
            startRow: 1,
            endRow: 10,
            complexity: 4,
            containerType: "ValidateEmail",
          },
        ],
      }),
      pf({
        rel: "ValidateUserName.java",
        functions: [
          {
            name: "validate",
            startRow: 1,
            endRow: 10,
            complexity: 3,
            containerType: "ValidateUserName",
          },
        ],
      }),
      pf({
        rel: "Service.java",
        // Two calls to "validate" with DIFFERENT calleeTypes — both should
        // resolve correctly (no first-wins collapse).
        calls: [
          {
            calleeName: "validate",
            inFunction: "run",
            calleeType: "ValidateEmail",
          },
          {
            calleeName: "validate",
            inFunction: "run",
            calleeType: "ValidateUserName",
          },
        ],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    expect(g.calls).toHaveLength(2);
    const resolutions = g.calls.map((c) => c.toFile).sort();
    expect(resolutions).toEqual([
      "ValidateEmail.java",
      "ValidateUserName.java",
    ]);
  });

  it("type-aware match overrides same-file fallback when calleeType is set", () => {
    // Edge case: a same-file shadow plus an external typed candidate. The
    // typed match wins because it's a stronger signal than file proximity.
    const files = [
      pf({
        rel: "External.java",
        functions: [
          {
            name: "doIt",
            startRow: 1,
            endRow: 3,
            complexity: 1,
            containerType: "External",
          },
        ],
      }),
      pf({
        rel: "Local.java",
        functions: [
          {
            name: "doIt",
            startRow: 5,
            endRow: 7,
            complexity: 1,
            containerType: "Local",
          },
        ],
        calls: [
          {
            calleeName: "doIt",
            inFunction: "caller",
            calleeType: "External",
          },
        ],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    expect(g.calls[0].toFile).toBe("External.java");
    expect(g.calls[0].toFunction).toBe("doIt");
  });

  it("emits import edges only for resolved targets and dedupes by (kind, from, to)", () => {
    const files = [
      pf({
        rel: "src/page.ts",
        imports: [
          { rawSpec: "react", resolvedPath: null },
          { rawSpec: "./util", resolvedPath: "src/util.ts" },
          { rawSpec: "./util.js", resolvedPath: "src/util.ts" }, // same target, dup
          { rawSpec: "./Btn", resolvedPath: "src/Btn.tsx", kind: "extends" },
        ],
      }),
      pf({ rel: "src/util.ts" }),
      pf({ rel: "src/Btn.tsx" }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    expect(g.imports).toHaveLength(2); // util import + Btn extends; "react" excluded; dup collapsed
    expect(
      g.imports.find((e) => e.to === "src/Btn.tsx")?.kind
    ).toBe("extends");
    expect(g.imports.find((e) => e.to === "src/util.ts")?.kind).toBe("import");
  });

  it("collects byPlugin stats keyed by which plugin parsed each file", () => {
    const files = [
      pf({
        rel: "src/a.ts",
        functions: [{ name: "f", startRow: 1, endRow: 5, complexity: 1 }],
        calls: [{ calleeName: "g", inFunction: "f" }],
        imports: [{ rawSpec: "./b", resolvedPath: "src/b.ts" }],
      }),
      pf({
        rel: "Main.java",
        imports: [{ rawSpec: "../u", resolvedPath: "u.java", kind: "extends" }],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map([
        ["src/a.ts", "javascript"],
        ["Main.java", "regex-fallback"],
      ]),
    });
    expect(g.byPlugin.javascript).toEqual({
      files: 1,
      functions: 1,
      calls: 1,
      imports: 1,
    });
    expect(g.byPlugin["regex-fallback"]).toEqual({
      files: 1,
      functions: 0,
      calls: 0,
      imports: 1,
    });
  });

  it("rolls fileComplexity per file and counts files-by-extension", () => {
    const files = [
      pf({ rel: "src/a.ts", fileComplexity: 12 }),
      pf({ rel: "src/b.ts", fileComplexity: 5 }),
      pf({ rel: "src/c.tsx", fileComplexity: 8 }),
      pf({ rel: "Main.java", fileComplexity: 1 }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    expect(g.fileComplexity["src/a.ts"]).toBe(12);
    expect(g.filesByExt).toEqual({ ts: 2, tsx: 1, java: 1 });
  });

  it("propagates the truncated reason when supplied", () => {
    const g = buildCodeGraph({
      parsedFiles: [],
      pluginByFile: new Map(),
      truncated: "MAX_FILES capped",
    });
    expect(g.truncated).toBe("MAX_FILES capped");
    expect(g.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
