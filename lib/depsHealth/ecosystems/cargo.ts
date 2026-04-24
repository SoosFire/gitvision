// Cargo (Rust) ecosystem plugin.
// Manifests: Cargo.toml files anywhere in the repo (workspaces supported).
// Registry:  https://crates.io
// OSV:       "crates.io"
//
// Cargo dependency declarations are diverse — we handle the three common shapes:
//   [dependencies]
//   foo = "1.2.3"                       ← simple string version
//   bar = { version = "2.0", ... }      ← inline table with version
//   baz = { git = "...", branch = "..." }  ← git source, version == null (skip)
//   qux = { path = "../qux" }           ← local path, skip
//
// Version syntax is semver-like but with Cargo's own range operators. Most
// common prefixes (^, ~, >=, <) align with our npm normalizer, so we reuse
// the logic with small adaptations.

import TOML from "@iarna/toml";
import type { DeclaredPackage, EcosystemPlugin, PackageMeta } from "../types";

// Cargo.toml table sections that list dependencies. We scan all of them.
const DEP_TABLES = [
  "dependencies",
  "dev-dependencies",
  "build-dependencies",
] as const;

type DepValue =
  | string
  | {
      version?: string;
      git?: string;
      path?: string;
      workspace?: boolean;
      package?: string; // renamed crate: `foo = { package = "real-name", version = "..." }`
    };

interface CargoToml {
  package?: { name?: string; version?: string };
  workspace?: {
    members?: string[];
    dependencies?: Record<string, DepValue>;
  };
  dependencies?: Record<string, DepValue>;
  "dev-dependencies"?: Record<string, DepValue>;
  "build-dependencies"?: Record<string, DepValue>;
  // Cargo also supports [target."cfg(...)".dependencies] — rare enough to skip for v1.
}

/** Normalize a Cargo version spec to a concrete baseline version.
 *  Returns null for git/path/workspace sources or non-semver specs. */
export function normalizeCargoVersion(raw: string): string | null {
  const cleaned = raw.trim().replace(/^[\^~>=<\s]+/, "");
  if (!cleaned || !/^\d/.test(cleaned)) return null;
  const first = cleaned.split(/[\s|,]+/)[0];
  if (!/^\d+/.test(first)) return null;
  return first;
}

function extractVersion(value: DepValue): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    // Skip git sources, local paths, workspace-inherited (we don't resolve the parent).
    if (value.git || value.path || value.workspace) return null;
    if (typeof value.version === "string") return value.version;
  }
  return null;
}

/** If the dep was renamed with `package = "..."`, the registry name is that
 *  instead of the TOML key. */
function resolveRegistryName(key: string, value: DepValue): string {
  if (typeof value === "object" && value !== null && typeof value.package === "string") {
    return value.package;
  }
  return key;
}

async function fetchCargoMeta(
  name: string,
  current: string
): Promise<PackageMeta | null> {
  try {
    const res = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`, {
      headers: {
        // crates.io requires a descriptive User-Agent
        "User-Agent": "GitVision (https://github.com/SoosFire/gitvision)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();

    const crate = data.crate ?? {};
    const latest: string | null = crate.max_stable_version ?? crate.newest_version ?? null;
    // versions array has created_at, num (version string), yanked flag
    const versions: { num: string; created_at: string; yanked: boolean }[] =
      data.versions ?? [];

    const currentEntry = versions.find((v) => v.num === current);
    const latestEntry = latest ? versions.find((v) => v.num === latest) : null;

    // crates.io doesn't have a first-class "deprecated" flag; yanked is the
    // closest equivalent. Surface it as deprecated with an explanation so the
    // UI can treat it uniformly.
    const deprecated =
      currentEntry?.yanked === true
        ? `Version ${current} was yanked from crates.io`
        : null;

    return {
      latest,
      timeOfCurrent: currentEntry?.created_at ?? null,
      timeOfLatest: latestEntry?.created_at ?? null,
      deprecated,
    };
  } catch {
    return null;
  }
}

export const cargoPlugin: EcosystemPlugin = {
  name: "cargo",
  displayName: "Cargo",
  osvEcosystem: "crates.io",

  isManifest(path) {
    return path === "Cargo.toml" || path.endsWith("/Cargo.toml");
  },

  parseManifest(path, content) {
    let toml: CargoToml;
    try {
      toml = TOML.parse(content) as CargoToml;
    } catch {
      return [];
    }

    const declared: DeclaredPackage[] = [];

    // Top-level dep tables
    for (const table of DEP_TABLES) {
      const deps = toml[table];
      if (!deps) continue;
      for (const [key, value] of Object.entries(deps)) {
        const version = extractVersion(value);
        if (!version) continue;
        const name = resolveRegistryName(key, value);
        declared.push({ name, declared: version, sourcePath: path });
      }
    }

    // Workspace dependencies (monorepo root) — treated like regular deps
    const wsDeps = toml.workspace?.dependencies;
    if (wsDeps) {
      for (const [key, value] of Object.entries(wsDeps)) {
        const version = extractVersion(value);
        if (!version) continue;
        const name = resolveRegistryName(key, value);
        declared.push({ name, declared: version, sourcePath: path });
      }
    }

    return declared;
  },

  normalizeVersion: normalizeCargoVersion,

  fetchMeta: fetchCargoMeta,
};
