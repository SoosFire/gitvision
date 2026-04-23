// Tests for pure functions in lib/github.ts
// These are the "compute" functions that drive hotspot + co-change signals.
// They take simple data, produce simple data — perfect for unit tests.

import { describe, it, expect } from "vitest";
import {
  parseRepoUrl,
  computeHotspots,
  computeCoChange,
  computeCommitActivity,
} from "../github";

describe("parseRepoUrl", () => {
  it("parses full HTTPS GitHub URL", () => {
    expect(parseRepoUrl("https://github.com/vercel/next.js")).toEqual({
      owner: "vercel",
      repo: "next.js",
    });
  });

  it("strips .git suffix", () => {
    expect(parseRepoUrl("https://github.com/vercel/next.js.git")).toEqual({
      owner: "vercel",
      repo: "next.js",
    });
  });

  it("strips trailing slash", () => {
    expect(parseRepoUrl("https://github.com/vercel/next.js/")).toEqual({
      owner: "vercel",
      repo: "next.js",
    });
  });

  it("accepts protocol-less URL", () => {
    expect(parseRepoUrl("github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("accepts owner/repo shorthand", () => {
    expect(parseRepoUrl("SoosFire/gitvision")).toEqual({
      owner: "SoosFire",
      repo: "gitvision",
    });
  });

  it("returns null for invalid input", () => {
    expect(parseRepoUrl("")).toBeNull();
    expect(parseRepoUrl("not a url")).toBeNull();
    expect(parseRepoUrl("just-one-segment")).toBeNull();
  });
});

describe("computeHotspots", () => {
  function commit(
    sha: string,
    files: string[],
    author: string | null,
    date = "2026-01-01T00:00:00Z"
  ) {
    return [sha, { files, authorLogin: author, date }] as const;
  }

  it("produces empty array for empty input", () => {
    const result = computeHotspots(new Map());
    expect(result).toEqual([]);
  });

  it("counts churn correctly across commits", () => {
    const map = new Map([
      commit("a", ["src/foo.ts"], "alice"),
      commit("b", ["src/foo.ts"], "bob"),
      commit("c", ["src/foo.ts"], "alice"),
      commit("d", ["src/bar.ts"], "alice"),
    ]);
    const result = computeHotspots(map);

    const foo = result.find((h) => h.path === "src/foo.ts");
    expect(foo?.churn).toBe(3);
    expect(foo?.authors).toBe(2); // alice + bob

    const bar = result.find((h) => h.path === "src/bar.ts");
    expect(bar?.churn).toBe(1);
    expect(bar?.authors).toBe(1);
  });

  it("sorts by score descending (churn × log(authors+1))", () => {
    const map = new Map([
      // foo: 2 commits, 2 authors → score 2 * log(3)
      commit("a", ["foo.ts"], "alice"),
      commit("b", ["foo.ts"], "bob"),
      // bar: 5 commits, 1 author → score 5 * log(2)
      ...Array.from({ length: 5 }, (_, i) =>
        commit(`c${i}`, ["bar.ts"], "alice")
      ),
    ]);
    const result = computeHotspots(map);
    // bar should be first — 5 * log(2) ≈ 3.47 vs foo 2 * log(3) ≈ 2.2
    expect(result[0].path).toBe("bar.ts");
  });

  it("tracks unique author logins per file", () => {
    const map = new Map([
      commit("a", ["x.ts"], "alice"),
      commit("b", ["x.ts"], "alice"), // same author twice
      commit("c", ["x.ts"], "bob"),
    ]);
    const result = computeHotspots(map);
    expect(result[0].authors).toBe(2);
    expect(result[0].authorLogins.sort()).toEqual(["alice", "bob"]);
  });

  it("handles commits with null author", () => {
    const map = new Map([commit("a", ["foo.ts"], null)]);
    const result = computeHotspots(map);
    expect(result[0].churn).toBe(1);
    expect(result[0].authors).toBe(0);
  });
});

describe("computeCoChange", () => {
  function commit(
    sha: string,
    files: string[],
    author: string | null = "a"
  ) {
    return [sha, { files, authorLogin: author, date: "2026-01-01" }] as const;
  }

  it("returns empty for single-file commits", () => {
    const map = new Map([
      commit("a", ["foo.ts"]),
      commit("b", ["bar.ts"]),
    ]);
    const edges = computeCoChange(map, new Set(["foo.ts", "bar.ts"]));
    expect(edges).toEqual([]);
  });

  it("counts pair co-changes", () => {
    const map = new Map([
      commit("a", ["foo.ts", "bar.ts"]),
      commit("b", ["foo.ts", "bar.ts"]),
      commit("c", ["foo.ts", "bar.ts"]),
    ]);
    const edges = computeCoChange(map, new Set(["foo.ts", "bar.ts"]));
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ count: 3 });
    expect([edges[0].from, edges[0].to].sort()).toEqual(["bar.ts", "foo.ts"]);
  });

  it("respects minCount threshold", () => {
    const map = new Map([
      // pair A-B: 1 commit (below default minCount of 2)
      commit("a", ["A.ts", "B.ts"]),
      // pair C-D: 3 commits
      commit("b", ["C.ts", "D.ts"]),
      commit("c", ["C.ts", "D.ts"]),
      commit("d", ["C.ts", "D.ts"]),
    ]);
    const edges = computeCoChange(
      map,
      new Set(["A.ts", "B.ts", "C.ts", "D.ts"])
    );
    expect(edges.length).toBe(1);
    expect(edges[0].count).toBe(3);
  });

  it("skips mega-commits (> 15 files)", () => {
    // 20-file commit — treated as a refactor/rename, skipped
    const bigFiles = Array.from({ length: 20 }, (_, i) => `f${i}.ts`);
    const map = new Map([commit("a", bigFiles)]);
    const edges = computeCoChange(map, new Set(bigFiles));
    expect(edges).toEqual([]);
  });

  it("filters to allowedFiles set", () => {
    const map = new Map([
      commit("a", ["in1.ts", "in2.ts", "out.ts"]),
      commit("b", ["in1.ts", "in2.ts", "out.ts"]),
    ]);
    // "out.ts" not in allowed → shouldn't generate edges involving it
    const edges = computeCoChange(map, new Set(["in1.ts", "in2.ts"]));
    expect(edges).toHaveLength(1);
    expect([edges[0].from, edges[0].to].sort()).toEqual(["in1.ts", "in2.ts"]);
  });
});

describe("computeCommitActivity", () => {
  it("buckets commits by ISO week (Monday-starting)", () => {
    const commits = [
      // Week of Mon 2026-01-05
      { sha: "a", message: "", authorLogin: null, authorName: "x", authorEmail: "", date: "2026-01-05T12:00:00Z" },
      { sha: "b", message: "", authorLogin: null, authorName: "x", authorEmail: "", date: "2026-01-07T12:00:00Z" },
      // Week of Mon 2026-01-12
      { sha: "c", message: "", authorLogin: null, authorName: "x", authorEmail: "", date: "2026-01-14T12:00:00Z" },
    ];
    const result = computeCommitActivity(commits);
    expect(result).toEqual([
      { week: "2026-01-05", count: 2 },
      { week: "2026-01-12", count: 1 },
    ]);
  });

  it("handles empty input", () => {
    expect(computeCommitActivity([])).toEqual([]);
  });

  it("skips invalid dates silently", () => {
    const commits = [
      { sha: "a", message: "", authorLogin: null, authorName: "x", authorEmail: "", date: "not-a-date" },
      { sha: "b", message: "", authorLogin: null, authorName: "x", authorEmail: "", date: "2026-01-05" },
    ];
    const result = computeCommitActivity(commits);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(1);
  });
});
