// Dependency-health analysis for npm ecosystem.
//
// Pipeline:
//   1. Fetch root package.json from the repo via GitHub Contents API
//   2. Collect declared deps (dependencies + devDependencies + peerDependencies)
//   3. For each: query npm registry for latest version + deprecation status
//   4. Batch-query OSV.dev for known CVEs
//   5. Aggregate into DependencyHealth object
//
// Best-effort throughout — failures return partial data with a note.
// Returns null if the repo has no package.json (not an error, just N/A).

import { Octokit } from "octokit";
import type {
  DependencyHealth,
  OutdatedDep,
  VulnerableDep,
  DeprecatedDep,
} from "./types";

// ------------------- Version parsing -------------------

/** Strip semver range prefixes (^, ~, >=, etc.) and pick the first version
 *  in a multi-range string. Returns null if not a concrete version.
 *  Exported for unit tests. */
export function normalizeVersion(v: string): string | null {
  const cleaned = v.trim().replace(/^[\^~>=<\s]+/, "");
  // Skip things like "*", "latest", "next", URLs, file:, workspace:, github:
  if (!cleaned) return null;
  if (!/^\d/.test(cleaned)) return null;
  // "1.2.3 - 2.0.0" or ">=1.2.3 <2.0.0" — take the first version
  const first = cleaned.split(/[\s|,]+/)[0];
  // Sanity check: must look like a semver
  if (!/^\d+\.\d+/.test(first)) return null;
  return first;
}

// ------------------- Fetch root package.json -------------------

interface PackageJsonContent {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

// Paths under any of these segments are almost certainly not first-party and
// would drown meaningful monorepo-package deps in noise.
const SKIP_PACKAGE_JSON_PATTERNS: RegExp[] = [
  /(^|\/)node_modules\//,
  /(^|\/)\.git\//,
  /(^|\/)vendor\//,
  /(^|\/)bower_components\//,
  /(^|\/)\.next\//,
  /(^|\/)\.cache\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)coverage\//,
  /(^|\/)out\//,
];

const MAX_PACKAGE_FILES = 50; // cap to keep Contents-API churn sane

// Find every first-party package.json in the repo via the Trees API. Returns
// paths only (content fetched separately). Single API call regardless of size.
async function listPackageJsonPaths(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<string[]> {
  try {
    const { data } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: ref,
      recursive: "true",
    });
    const paths = (data.tree ?? [])
      .filter((n) => n.type === "blob" && n.path?.endsWith("package.json"))
      .map((n) => n.path as string)
      .filter((p) => !SKIP_PACKAGE_JSON_PATTERNS.some((re) => re.test(p)))
      // Sort root first, then by depth (shallower paths more likely to matter)
      .sort((a, b) => a.split("/").length - b.split("/").length);
    return paths.slice(0, MAX_PACKAGE_FILES);
  } catch {
    return [];
  }
}

async function fetchPackageJson(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string
): Promise<PackageJsonContent | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
    });
    if (!("content" in data) || typeof data.content !== "string") return null;
    const decoded = Buffer.from(data.content, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

// ------------------- npm registry -------------------

interface NpmMeta {
  latest: string | null;
  timeOfCurrent: string | null;
  timeOfLatest: string | null;
  deprecated: string | null;
}

async function fetchNpmMeta(name: string, current: string): Promise<NpmMeta | null> {
  try {
    // install-v1 is a slim format npm uses itself — smaller than the default
    const res = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}`,
      {
        headers: {
          Accept: "application/vnd.npm.install-v1+json",
        },
        // Don't cache — we want fresh data
      }
    );
    if (!res.ok) return null;
    const data = await res.json();

    const latest = data["dist-tags"]?.latest ?? null;
    const time = data.time ?? {};
    const versions = data.versions ?? {};

    // Look up deprecation from the CURRENT version's metadata
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

// ------------------- OSV.dev batch -------------------

interface OsvBatchResult {
  vulns?: { id: string }[];
}

async function fetchOsvBatch(
  packages: { name: string; version: string }[]
): Promise<OsvBatchResult[]> {
  if (packages.length === 0) return [];
  try {
    const res = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queries: packages.map((p) => ({
          package: { name: p.name, ecosystem: "npm" },
          version: p.version,
        })),
      }),
    });
    if (!res.ok) return packages.map(() => ({}));
    const data = (await res.json()) as { results?: OsvBatchResult[] };
    return data.results ?? packages.map(() => ({}));
  } catch {
    return packages.map(() => ({}));
  }
}

// ------------------- Concurrency pool -------------------

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ------------------- Main -------------------

const MAX_PACKAGES = 300; // safety cap — OSV batch and parallel npm fetches

export async function analyzeDependencyHealth(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref = "HEAD"
): Promise<DependencyHealth | null> {
  // 1. Find every first-party package.json in the repo
  const paths = await listPackageJsonPaths(octokit, owner, repo, ref);
  if (paths.length === 0) return null;

  // 2. Fetch each (concurrency 5, don't hammer the Contents API)
  const packageJsons = await mapWithConcurrency(paths, 5, async (path) => {
    const content = await fetchPackageJson(octokit, owner, repo, path);
    return { path, content };
  });
  const valid = packageJsons.filter((p) => p.content !== null);
  if (valid.length === 0) return null;

  // 3. Collect (name, version) pairs, tracking which package.json files
  //    declared each so users can attribute issues back to the right module.
  const sourcesByKey = new Map<string, Set<string>>();
  const uniqueDeps = new Map<string, { name: string; declared: string }>();
  for (const { path, content } of valid) {
    for (const group of [
      content!.dependencies,
      content!.devDependencies,
      content!.peerDependencies,
    ]) {
      if (!group) continue;
      for (const [name, version] of Object.entries(group)) {
        const key = `${name}@${version}`;
        if (!uniqueDeps.has(key)) {
          uniqueDeps.set(key, { name, declared: version as string });
        }
        const sources = sourcesByKey.get(key) ?? new Set<string>();
        sources.add(path);
        sourcesByKey.set(key, sources);
      }
    }
  }

  const totalDeclarations = [...sourcesByKey.values()].reduce(
    (s, set) => s + set.size,
    0
  );
  if (uniqueDeps.size === 0) return null;

  const entries = [...uniqueDeps.entries()];
  const capped = entries.slice(0, MAX_PACKAGES);
  const truncated =
    entries.length > MAX_PACKAGES
      ? `Analyzed first ${MAX_PACKAGES} of ${entries.length} unique packages across ${valid.length} package.json files`
      : undefined;

  // 4. Fetch npm metadata for each unique dep (concurrency 10)
  const withMeta = await mapWithConcurrency(capped, 10, async ([key, d]) => {
    const current = normalizeVersion(d.declared);
    if (!current) return { key, ...d, current: null, meta: null };
    const meta = await fetchNpmMeta(d.name, current);
    return { key, ...d, current, meta };
  });

  // 5. OSV batch — only for deps we could resolve to a concrete version
  const osvQueries = withMeta
    .filter((d) => d.current !== null)
    .map((d) => ({ key: d.key, name: d.name, version: d.current as string }));
  const osvResults = await fetchOsvBatch(
    osvQueries.map((q) => ({ name: q.name, version: q.version }))
  );
  const osvByKey = new Map<string, string[]>();
  osvQueries.forEach((q, i) => {
    const ids = (osvResults[i]?.vulns ?? []).map((v) => v.id);
    if (ids.length > 0) osvByKey.set(q.key, ids);
  });

  // 6. Categorize — attach sources so users can see which modules are affected
  const outdated: OutdatedDep[] = [];
  const vulnerable: VulnerableDep[] = [];
  const deprecated: DeprecatedDep[] = [];
  const OUTDATED_THRESHOLD_MONTHS = 6;

  const MAX_SOURCES = 5; // cap for UI digestibility
  function sourcesFor(key: string): string[] | undefined {
    const set = sourcesByKey.get(key);
    if (!set || set.size === 0) return undefined;
    const arr = [...set].sort();
    return arr.slice(0, MAX_SOURCES);
  }

  for (const d of withMeta) {
    if (d.meta?.deprecated) {
      deprecated.push({
        name: d.name,
        current: d.declared,
        message: d.meta.deprecated,
        sources: sourcesFor(d.key),
      });
    }

    if (d.current && d.meta?.latest && d.current !== d.meta.latest) {
      if (d.meta.timeOfCurrent && d.meta.timeOfLatest) {
        const ageMs =
          new Date(d.meta.timeOfLatest).getTime() -
          new Date(d.meta.timeOfCurrent).getTime();
        const ageMonths = Math.round(ageMs / (1000 * 60 * 60 * 24 * 30));
        if (ageMonths >= OUTDATED_THRESHOLD_MONTHS) {
          outdated.push({
            name: d.name,
            current: d.declared,
            latest: d.meta.latest,
            ageMonths,
            lastPublished: d.meta.timeOfLatest,
            sources: sourcesFor(d.key),
          });
        }
      }
    }

    const cves = osvByKey.get(d.key);
    if (cves && cves.length > 0) {
      vulnerable.push({
        name: d.name,
        current: d.declared,
        cves: cves.slice(0, 5),
        sources: sourcesFor(d.key),
      });
    }
  }

  outdated.sort((a, b) => b.ageMonths - a.ageMonths);
  vulnerable.sort((a, b) => b.cves.length - a.cves.length);

  return {
    ecosystem: "npm",
    total: totalDeclarations, // total declarations across all package.jsons
    uniquePackages: uniqueDeps.size,
    packageFiles: valid.length,
    outdated,
    vulnerable,
    deprecated,
    analyzedAt: new Date().toISOString(),
    note: truncated,
  };
}
