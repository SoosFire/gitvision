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
 *  in a multi-range string. Returns null if not a concrete version. */
function normalizeVersion(v: string): string | null {
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

async function fetchRootPackageJson(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> } | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: "package.json",
    });
    // Single-file response has `content` base64-encoded
    if (!("content" in data) || typeof data.content !== "string") return null;
    const decoded = Buffer.from(data.content, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    return null; // no package.json, can't parse, or access denied
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
  repo: string
): Promise<DependencyHealth | null> {
  const pkg = await fetchRootPackageJson(octokit, owner, repo);
  if (!pkg) return null;

  const allDeps: { name: string; declared: string }[] = [];
  for (const group of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
    if (!group) continue;
    for (const [name, version] of Object.entries(group)) {
      allDeps.push({ name, declared: version });
    }
  }
  if (allDeps.length === 0) return null;

  const capped = allDeps.slice(0, MAX_PACKAGES);
  const truncated =
    allDeps.length > MAX_PACKAGES
      ? `Analyzed first ${MAX_PACKAGES} of ${allDeps.length} packages`
      : undefined;

  // Fetch npm metadata for each (concurrency 10)
  const withMeta = await mapWithConcurrency(capped, 10, async (d) => {
    const current = normalizeVersion(d.declared);
    if (!current) return { ...d, current: null, meta: null };
    const meta = await fetchNpmMeta(d.name, current);
    return { ...d, current, meta };
  });

  // OSV batch — only for deps we could resolve to a concrete version
  const osvQueries = withMeta
    .filter((d) => d.current !== null)
    .map((d) => ({ name: d.name, version: d.current as string }));
  const osvResults = await fetchOsvBatch(osvQueries);

  // Build a lookup so we can match OSV results back to the full list
  const osvByName = new Map<string, string[]>();
  osvQueries.forEach((q, i) => {
    const ids = (osvResults[i]?.vulns ?? []).map((v) => v.id);
    if (ids.length > 0) osvByName.set(q.name, ids);
  });

  // Categorize
  const outdated: OutdatedDep[] = [];
  const vulnerable: VulnerableDep[] = [];
  const deprecated: DeprecatedDep[] = [];
  const OUTDATED_THRESHOLD_MONTHS = 6;

  for (const d of withMeta) {
    if (d.meta?.deprecated) {
      deprecated.push({
        name: d.name,
        current: d.declared,
        message: d.meta.deprecated,
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
          });
        }
      }
    }

    const cves = osvByName.get(d.name);
    if (cves && cves.length > 0) {
      vulnerable.push({
        name: d.name,
        current: d.declared,
        cves: cves.slice(0, 5), // cap per package so UI doesn't explode
      });
    }
  }

  outdated.sort((a, b) => b.ageMonths - a.ageMonths);
  vulnerable.sort((a, b) => b.cves.length - a.cves.length);

  return {
    ecosystem: "npm",
    total: allDeps.length,
    outdated,
    vulnerable,
    deprecated,
    analyzedAt: new Date().toISOString(),
    note: truncated,
  };
}
