// Tests for the blast-radius computation. Pure data — uses minimal CodeGraph
// fixtures so we exercise BFS, hop sorting, cycle handling, and the caps.

import { describe, it, expect } from "vitest";
import { computeBlastRadius } from "../codeAnalysis/blastRadius";
import type { CodeGraph } from "../codeAnalysis/types";

function emptyCodeGraph(): CodeGraph {
  return {
    functions: [],
    calls: [],
    imports: [],
    fileComplexity: {},
    filesByExt: {},
    byPlugin: {},
    generatedAt: "2026-04-25T00:00:00.000Z",
  };
}

describe("computeBlastRadius", () => {
  it("returns empty incoming / outgoing for an isolated file", () => {
    const cg = emptyCodeGraph();
    const b = computeBlastRadius(cg, "src/lonely.ts");
    expect(b.incoming).toEqual([]);
    expect(b.outgoing).toEqual([]);
    expect(b.target).toBe("src/lonely.ts");
  });

  it("captures direct incoming dependencies (1 hop)", () => {
    const cg = emptyCodeGraph();
    cg.imports = [
      { from: "a.ts", to: "target.ts", kind: "import" },
      { from: "b.ts", to: "target.ts", kind: "import" },
    ];
    const b = computeBlastRadius(cg, "target.ts");
    expect(b.incoming.map((e) => e.filePath).sort()).toEqual(["a.ts", "b.ts"]);
    expect(b.incoming.every((e) => e.hop === 1)).toBe(true);
    expect(b.byHop.incoming).toEqual({ 1: 2 });
  });

  it("traverses transitively across multiple hops", () => {
    const cg = emptyCodeGraph();
    cg.imports = [
      { from: "page.ts", to: "comp.ts", kind: "import" },
      { from: "comp.ts", to: "lib.ts", kind: "import" },
      { from: "lib.ts", to: "util.ts", kind: "import" },
    ];
    const b = computeBlastRadius(cg, "util.ts");
    // Incoming chain: lib.ts (hop 1) ← comp.ts (hop 2) ← page.ts (hop 3)
    expect(b.incoming).toEqual([
      { filePath: "lib.ts", hop: 1 },
      { filePath: "comp.ts", hop: 2 },
      { filePath: "page.ts", hop: 3 },
    ]);
    expect(b.byHop.incoming).toEqual({ 1: 1, 2: 1, 3: 1 });
  });

  it("captures outgoing dependencies (what target depends on)", () => {
    const cg = emptyCodeGraph();
    cg.imports = [
      { from: "target.ts", to: "dep1.ts", kind: "import" },
      { from: "target.ts", to: "dep2.ts", kind: "import" },
      { from: "dep1.ts", to: "deep.ts", kind: "import" },
    ];
    const b = computeBlastRadius(cg, "target.ts");
    expect(b.outgoing.map((e) => e.filePath).sort()).toEqual([
      "deep.ts",
      "dep1.ts",
      "dep2.ts",
    ]);
    const byHop = b.byHop.outgoing;
    expect(byHop[1]).toBe(2); // dep1, dep2
    expect(byHop[2]).toBe(1); // deep via dep1
  });

  it("respects maxHops cap", () => {
    const cg = emptyCodeGraph();
    cg.imports = [
      { from: "a.ts", to: "target.ts", kind: "import" },
      { from: "b.ts", to: "a.ts", kind: "import" },
      { from: "c.ts", to: "b.ts", kind: "import" },
      { from: "d.ts", to: "c.ts", kind: "import" },
    ];
    const b = computeBlastRadius(cg, "target.ts", { maxHops: 2 });
    // Only hop 1 (a.ts) and hop 2 (b.ts) — c.ts and d.ts cut off
    expect(b.incoming.map((e) => e.filePath)).toEqual(["a.ts", "b.ts"]);
  });

  it("uses call edges when toFile is resolved", () => {
    const cg = emptyCodeGraph();
    cg.calls = [
      {
        fromFile: "caller.ts",
        fromFunction: "main",
        calleeName: "doStuff",
        toFile: "target.ts",
        toFunction: "doStuff",
      },
      // Unresolved call (toFile null) doesn't contribute
      {
        fromFile: "ghost.ts",
        fromFunction: null,
        calleeName: "external",
        toFile: null,
        toFunction: null,
      },
    ];
    const b = computeBlastRadius(cg, "target.ts");
    expect(b.incoming.map((e) => e.filePath)).toEqual(["caller.ts"]);
  });

  it("merges import + call edges without double-counting", () => {
    const cg = emptyCodeGraph();
    cg.imports = [{ from: "a.ts", to: "target.ts", kind: "import" }];
    cg.calls = [
      {
        fromFile: "a.ts",
        fromFunction: "x",
        calleeName: "y",
        toFile: "target.ts",
        toFunction: "y",
      },
    ];
    const b = computeBlastRadius(cg, "target.ts");
    expect(b.incoming).toEqual([{ filePath: "a.ts", hop: 1 }]);
  });

  it("ignores self-edges defensively", () => {
    const cg = emptyCodeGraph();
    cg.imports = [{ from: "target.ts", to: "target.ts", kind: "import" }];
    const b = computeBlastRadius(cg, "target.ts");
    expect(b.incoming).toEqual([]);
    expect(b.outgoing).toEqual([]);
  });

  it("handles cycles without infinite looping", () => {
    const cg = emptyCodeGraph();
    cg.imports = [
      { from: "a.ts", to: "b.ts", kind: "import" },
      { from: "b.ts", to: "c.ts", kind: "import" },
      { from: "c.ts", to: "a.ts", kind: "import" }, // closes the cycle
    ];
    const b = computeBlastRadius(cg, "a.ts");
    // Outgoing from a.ts: b.ts (1), c.ts (2). Doesn't revisit a.ts.
    expect(b.outgoing.map((e) => `${e.filePath}@${e.hop}`)).toEqual([
      "b.ts@1",
      "c.ts@2",
    ]);
  });

  it("flags truncated when the per-direction node cap is hit", () => {
    const cg = emptyCodeGraph();
    // 50 fan-in files all pointing at target
    for (let i = 0; i < 50; i++) {
      cg.imports.push({
        from: `caller${i}.ts`,
        to: "target.ts",
        kind: "import",
      });
    }
    const b = computeBlastRadius(cg, "target.ts", { maxNodes: 10 });
    expect(b.incoming.length).toBeLessThan(50);
    expect(b.truncated).toMatch(/Capped at 10/);
  });

  it("sorts entries by hop ascending then file alphabetically", () => {
    const cg = emptyCodeGraph();
    cg.imports = [
      { from: "z.ts", to: "target.ts", kind: "import" }, // hop 1
      { from: "a.ts", to: "target.ts", kind: "import" }, // hop 1
      { from: "m.ts", to: "z.ts", kind: "import" }, // hop 2 via z
    ];
    const b = computeBlastRadius(cg, "target.ts");
    expect(b.incoming).toEqual([
      { filePath: "a.ts", hop: 1 },
      { filePath: "z.ts", hop: 1 },
      { filePath: "m.ts", hop: 2 },
    ]);
  });
});
