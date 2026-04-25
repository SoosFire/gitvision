// Workspace package discovery for monorepos.
//
// In a pnpm/yarn/npm monorepo, packages reference each other by their
// declared `name` (e.g. `@tanstack/query-core`) rather than a relative
// path. Without this map, every cross-package import looks "external"
// and resolves to null — which inflates the unresolved-imports list and
// hides real internal coupling on the call-graph.
//
// What we look at:
//   - root package.json's `workspaces` field (Yarn/npm) — array form OR
//     { packages: [...] } object form
//   - if absent, falls back to common patterns (packages/*, apps/*) so
//     pnpm-workspace.yaml-only repos still work without YAML parsing
//
// What we don't look at (yet):
//   - pnpm-workspace.yaml (would need a YAML parser)
//   - lerna.json's `packages` field
//   - Nx-style `nx.json` workspace config
//
// Each declared package's source entry is found via candidate probing
// (src/index.ts, index.ts, ...) — we deliberately avoid the `main`/
// `module` fields in package.json because those usually point at
// dist/build outputs that don't exist in a fresh checkout.

import { promises as fs } from "node:fs";
import path from "node:path";

export interface WorkspacePackage {
  /** The package's declared `name` from its package.json. */
  name: string;
  /** Repo-rel posix path to the source entry file. */
  sourcePath: string;
  /** Repo-rel posix path to the package directory (where package.json sits). */
  packageDir: string;
}

export type WorkspaceMap = Map<string, WorkspacePackage>;

/** Source-entry filenames probed inside each workspace package directory.
 *  Ordered so source-tree files (src/) win over root entries; TypeScript
 *  variants are preferred since most modern monorepo packages are TS-first. */
const SOURCE_CANDIDATES: readonly string[] = [
  "src/index.ts",
  "src/index.tsx",
  "src/index.mts",
  "src/index.cts",
  "src/index.js",
  "src/index.jsx",
  "src/index.mjs",
  "src/index.cjs",
  "index.ts",
  "index.tsx",
  "index.mts",
  "index.cts",
  "index.js",
  "index.jsx",
  "index.mjs",
  "index.cjs",
];

/** Discover workspace packages for a repo. Returns an empty map for non-
 *  monorepo repos. Never throws — bad package.json files are silently
 *  skipped to keep the analysis pipeline tolerant. */
export async function loadWorkspacePackages(
  repoRoot: string
): Promise<WorkspaceMap> {
  const out: WorkspaceMap = new Map();

  // Read root package.json (best-effort)
  let rootPkg: Record<string, unknown> | null = null;
  try {
    const text = await fs.readFile(
      path.join(repoRoot, "package.json"),
      "utf-8"
    );
    rootPkg = JSON.parse(text);
  } catch {
    // No root package.json — still try fallback patterns below
  }

  // Workspace patterns from package.json's `workspaces` field
  let patterns: string[] = [];
  if (rootPkg) {
    const ws = rootPkg.workspaces;
    if (Array.isArray(ws)) {
      patterns = ws.filter((p): p is string => typeof p === "string");
    } else if (ws && typeof ws === "object") {
      const inner = (ws as Record<string, unknown>).packages;
      if (Array.isArray(inner)) {
        patterns = inner.filter((p): p is string => typeof p === "string");
      }
    }
  }

  // Fallback: pnpm-workspace.yaml and lerna repos that don't redeclare in
  // package.json. Conventional layout still works without parsing yaml.
  if (patterns.length === 0) {
    patterns = ["packages/*", "apps/*"];
  }

  const visited = new Set<string>();
  for (const pattern of patterns) {
    const dirs = await expandPattern(repoRoot, pattern);
    for (const dir of dirs) {
      if (visited.has(dir)) continue;
      visited.add(dir);
      await readPackage(repoRoot, dir, out);
    }
  }

  return out;
}

/** Expand a workspace pattern into a list of repo-rel directory paths.
 *  Only handles the common `prefix/*` form — anything else is treated as
 *  a literal directory path. */
async function expandPattern(
  repoRoot: string,
  pattern: string
): Promise<string[]> {
  if (!pattern.endsWith("/*")) {
    return [pattern.replace(/\\/g, "/").replace(/\/$/, "")];
  }
  const prefix = pattern.slice(0, -2).replace(/\\/g, "/");
  const baseDir = path.join(repoRoot, prefix);
  let entries;
  try {
    entries = await fs.readdir(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => path.posix.join(prefix, e.name));
}

/** Read <repoRoot>/<packageDir>/package.json and register a workspace package
 *  with its source entry file. Skips packages with no name or no findable
 *  source file. */
async function readPackage(
  repoRoot: string,
  packageDir: string,
  out: WorkspaceMap
): Promise<void> {
  const pkgJsonPath = path.join(repoRoot, packageDir, "package.json");
  let pkg: Record<string, unknown> | null = null;
  try {
    const text = await fs.readFile(pkgJsonPath, "utf-8");
    pkg = JSON.parse(text);
  } catch {
    return;
  }
  if (!pkg || typeof pkg.name !== "string" || !pkg.name) return;

  // Find source entry: explicit `source` field first, then candidates
  let sourcePath: string | null = null;
  if (typeof pkg.source === "string") {
    sourcePath = await tryCandidate(repoRoot, packageDir, pkg.source);
  }
  if (!sourcePath) {
    for (const c of SOURCE_CANDIDATES) {
      sourcePath = await tryCandidate(repoRoot, packageDir, c);
      if (sourcePath) break;
    }
  }
  if (!sourcePath) return;

  out.set(pkg.name, { name: pkg.name, sourcePath, packageDir });
}

async function tryCandidate(
  repoRoot: string,
  packageDir: string,
  rel: string
): Promise<string | null> {
  const cleaned = rel.replace(/\\/g, "/").replace(/^\.\//, "");
  const repoRel = path.posix.join(packageDir, cleaned);
  try {
    const st = await fs.stat(path.join(repoRoot, repoRel));
    if (st.isFile()) return repoRel;
  } catch {
    // missing — caller falls back to next candidate
  }
  return null;
}
