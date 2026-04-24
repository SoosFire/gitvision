// npm ecosystem plugin.
// Manifests: package.json files anywhere in the repo (monorepo-aware).
// Registry:  https://registry.npmjs.org
// OSV:       "npm"

import type { DeclaredPackage, EcosystemPlugin, PackageMeta } from "../types";

interface PackageJsonContent {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** Strip semver range prefixes (^, ~, >=, etc.) and pick the first version
 *  in a multi-range string. Returns null if not a concrete version. */
export function normalizeNpmVersion(v: string): string | null {
  const cleaned = v.trim().replace(/^[\^~>=<\s]+/, "");
  if (!cleaned) return null;
  if (!/^\d/.test(cleaned)) return null;
  // ">=1.2.3 <2.0.0" or "1.2.3 || 2.0.0" — take first
  const first = cleaned.split(/[\s|,]+/)[0];
  if (!/^\d+\.\d+/.test(first)) return null;
  return first;
}

async function fetchNpmMeta(
  name: string,
  current: string
): Promise<PackageMeta | null> {
  try {
    const res = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}`,
      {
        headers: { Accept: "application/vnd.npm.install-v1+json" },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();

    const latest = data["dist-tags"]?.latest ?? null;
    const time = data.time ?? {};
    const versions = data.versions ?? {};

    const currentInfo = versions[current];
    const deprecated =
      typeof currentInfo?.deprecated === "string"
        ? currentInfo.deprecated
        : currentInfo?.deprecated === true
        ? "deprecated"
        : null;

    return {
      latest,
      timeOfCurrent: time[current] ?? null,
      timeOfLatest: latest ? time[latest] ?? null : null,
      deprecated,
    };
  } catch {
    return null;
  }
}

export const npmPlugin: EcosystemPlugin = {
  name: "npm",
  displayName: "npm",
  osvEcosystem: "npm",

  isManifest(path) {
    // Top-level or any sub-path's package.json
    return path === "package.json" || path.endsWith("/package.json");
  },

  parseManifest(path, content) {
    let pkg: PackageJsonContent;
    try {
      pkg = JSON.parse(content);
    } catch {
      return [];
    }
    const declared: DeclaredPackage[] = [];
    for (const group of [
      pkg.dependencies,
      pkg.devDependencies,
      pkg.peerDependencies,
    ]) {
      if (!group) continue;
      for (const [name, version] of Object.entries(group)) {
        if (typeof version !== "string") continue;
        declared.push({ name, declared: version, sourcePath: path });
      }
    }
    return declared;
  },

  normalizeVersion: normalizeNpmVersion,

  fetchMeta: fetchNpmMeta,
};
