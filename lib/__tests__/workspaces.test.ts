// Tests for the workspace package loader. Like tsconfig.test.ts these run
// against real temp directories to exercise the full I/O path: package.json
// reading, fallback when no workspaces field is declared, source-entry
// candidate probing, and gracefully ignoring malformed packages.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadWorkspacePackages } from "../codeAnalysis/workspaces";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gitvision-ws-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

async function writeFile(rel: string, content: string): Promise<void> {
  const full = path.join(tmp, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf-8");
}

async function writeJson(
  rel: string,
  data: Record<string, unknown>
): Promise<void> {
  await writeFile(rel, JSON.stringify(data, null, 2));
}

describe("loadWorkspacePackages", () => {
  it("returns an empty map for a non-monorepo repo (no package.json)", async () => {
    const map = await loadWorkspacePackages(tmp);
    expect(map.size).toBe(0);
  });

  it("discovers Yarn-style workspaces (string array form)", async () => {
    await writeJson("package.json", {
      name: "root",
      workspaces: ["packages/*"],
    });
    await writeJson("packages/core/package.json", { name: "@acme/core" });
    await writeFile("packages/core/src/index.ts", "export {};");
    await writeJson("packages/ui/package.json", { name: "@acme/ui" });
    await writeFile("packages/ui/src/index.tsx", "export {};");

    const map = await loadWorkspacePackages(tmp);
    expect(map.size).toBe(2);
    expect(map.get("@acme/core")?.sourcePath).toBe(
      "packages/core/src/index.ts"
    );
    expect(map.get("@acme/ui")?.sourcePath).toBe(
      "packages/ui/src/index.tsx"
    );
  });

  it("discovers npm-style workspaces (object form with packages array)", async () => {
    await writeJson("package.json", {
      name: "root",
      workspaces: { packages: ["packages/*"] },
    });
    await writeJson("packages/foo/package.json", { name: "@x/foo" });
    await writeFile("packages/foo/index.ts", "export {};");
    const map = await loadWorkspacePackages(tmp);
    expect(map.get("@x/foo")?.sourcePath).toBe("packages/foo/index.ts");
  });

  it("falls back to packages/* and apps/* when no workspaces field declared", async () => {
    // Mimics a pnpm repo where pnpm-workspace.yaml carries the config and
    // package.json doesn't redeclare it.
    await writeJson("package.json", { name: "root" });
    await writeJson("packages/lib/package.json", { name: "@x/lib" });
    await writeFile("packages/lib/src/index.ts", "export {};");
    await writeJson("apps/web/package.json", { name: "@x/web" });
    await writeFile("apps/web/src/index.ts", "export {};");

    const map = await loadWorkspacePackages(tmp);
    expect(map.size).toBe(2);
    expect(map.get("@x/lib")).toBeDefined();
    expect(map.get("@x/web")).toBeDefined();
  });

  it("prefers src/index.* over root index.* when both exist", async () => {
    await writeJson("package.json", {
      name: "root",
      workspaces: ["packages/*"],
    });
    await writeJson("packages/p/package.json", { name: "@a/p" });
    await writeFile("packages/p/src/index.ts", "export {};");
    await writeFile("packages/p/index.ts", "export {};");
    const map = await loadWorkspacePackages(tmp);
    expect(map.get("@a/p")?.sourcePath).toBe("packages/p/src/index.ts");
  });

  it("honors an explicit `source` field over the candidate list", async () => {
    await writeJson("package.json", {
      name: "root",
      workspaces: ["packages/*"],
    });
    await writeJson("packages/p/package.json", {
      name: "@a/p",
      source: "./lib/main.ts",
    });
    await writeFile("packages/p/lib/main.ts", "export {};");
    await writeFile("packages/p/src/index.ts", "should not win"); // candidate exists too
    const map = await loadWorkspacePackages(tmp);
    expect(map.get("@a/p")?.sourcePath).toBe("packages/p/lib/main.ts");
  });

  it("skips packages with no name", async () => {
    await writeJson("package.json", {
      name: "root",
      workspaces: ["packages/*"],
    });
    await writeJson("packages/anon/package.json", { version: "1.0.0" }); // no name
    await writeFile("packages/anon/src/index.ts", "export {};");
    const map = await loadWorkspacePackages(tmp);
    expect(map.size).toBe(0);
  });

  it("skips packages with no findable source entry", async () => {
    await writeJson("package.json", {
      name: "root",
      workspaces: ["packages/*"],
    });
    await writeJson("packages/empty/package.json", { name: "@x/empty" });
    // no src/index.* file exists
    const map = await loadWorkspacePackages(tmp);
    expect(map.size).toBe(0);
  });

  it("tolerates malformed package.json without crashing", async () => {
    await writeJson("package.json", {
      name: "root",
      workspaces: ["packages/*"],
    });
    await writeFile("packages/bad/package.json", "{ this is not json");
    await writeFile("packages/bad/src/index.ts", "export {};");
    await writeJson("packages/good/package.json", { name: "@x/good" });
    await writeFile("packages/good/src/index.ts", "export {};");
    const map = await loadWorkspacePackages(tmp);
    expect(map.size).toBe(1);
    expect(map.get("@x/good")).toBeDefined();
  });
});
