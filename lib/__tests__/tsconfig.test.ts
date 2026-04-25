// Tests for the tsconfig path-mapping reader. Uses temp directories so the
// loader hits real files (the parsing path includes JSONC tolerance and
// fs.readFile error handling — both worth exercising end-to-end).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadTsconfigPaths,
  applyPathMapping,
  type TsPathMappings,
} from "../codeAnalysis/tsconfig";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gitvision-tsconfig-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

async function writeJson(name: string, content: string): Promise<void> {
  await fs.writeFile(path.join(tmp, name), content, "utf-8");
}

describe("loadTsconfigPaths", () => {
  it("returns null when neither tsconfig.json nor jsconfig.json exists", async () => {
    expect(await loadTsconfigPaths(tmp)).toBeNull();
  });

  it("parses a typical tsconfig with baseUrl + paths", async () => {
    await writeJson(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["./*"], "~/*": ["src/*"] },
        },
      })
    );
    const out = await loadTsconfigPaths(tmp);
    expect(out).not.toBeNull();
    expect(out!.baseUrl).toBe(""); // "." normalizes to "" (repo root)
    expect(out!.paths).toEqual({ "@/*": ["./*"], "~/*": ["src/*"] });
  });

  it("normalizes baseUrl 'src' → 'src' (relative to repo root)", async () => {
    await writeJson(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { baseUrl: "src", paths: { "@/*": ["./*"] } },
      })
    );
    const out = await loadTsconfigPaths(tmp);
    expect(out!.baseUrl).toBe("src");
  });

  it("tolerates JSONC (line + block comments)", async () => {
    await writeJson(
      "tsconfig.json",
      `{
        // top-level comment
        "compilerOptions": {
          /* baseUrl is the repo root */
          "baseUrl": ".",
          "paths": {
            "@/*": ["./*"]
          }
        }
      }`
    );
    const out = await loadTsconfigPaths(tmp);
    expect(out).not.toBeNull();
    expect(out!.paths["@/*"]).toEqual(["./*"]);
  });

  it("falls back to jsconfig.json when tsconfig.json is absent", async () => {
    await writeJson(
      "jsconfig.json",
      JSON.stringify({
        compilerOptions: { paths: { "@/*": ["src/*"] } },
      })
    );
    const out = await loadTsconfigPaths(tmp);
    expect(out!.paths).toEqual({ "@/*": ["src/*"] });
  });

  it("returns null when the file has no compilerOptions", async () => {
    await writeJson("tsconfig.json", JSON.stringify({ extends: "./other" }));
    expect(await loadTsconfigPaths(tmp)).toBeNull();
  });

  it("returns null on malformed JSON that even comment-stripping can't save", async () => {
    await writeJson("tsconfig.json", "{ this is not json at all ::");
    expect(await loadTsconfigPaths(tmp)).toBeNull();
  });
});

describe("applyPathMapping", () => {
  it("substitutes the wildcard capture into a single substitution", () => {
    const m: TsPathMappings = {
      baseUrl: "",
      paths: { "@/*": ["src/*"] },
    };
    expect(applyPathMapping("@/lib/types", m)).toEqual(["src/lib/types"]);
  });

  it("handles exact (no-wildcard) patterns", () => {
    const m: TsPathMappings = {
      baseUrl: "",
      paths: { utils: ["src/lib/utils"] },
    };
    expect(applyPathMapping("utils", m)).toEqual(["src/lib/utils"]);
    expect(applyPathMapping("utils/extra", m)).toEqual([]);
  });

  it("returns multiple candidates when paths declares multiple subs", () => {
    const m: TsPathMappings = {
      baseUrl: "",
      paths: { "@app/*": ["src/app/*", "vendor/app/*"] },
    };
    expect(applyPathMapping("@app/foo", m)).toEqual([
      "src/app/foo",
      "vendor/app/foo",
    ]);
  });

  it("respects baseUrl when joining", () => {
    const m: TsPathMappings = {
      baseUrl: "src",
      paths: { "@/*": ["./*"] },
    };
    expect(applyPathMapping("@/lib/types", m)).toEqual(["src/lib/types"]);
  });

  it("returns no candidates when no pattern matches", () => {
    const m: TsPathMappings = {
      baseUrl: "",
      paths: { "@/*": ["src/*"] },
    };
    expect(applyPathMapping("react", m)).toEqual([]);
    expect(applyPathMapping("./relative", m)).toEqual([]);
  });
});
