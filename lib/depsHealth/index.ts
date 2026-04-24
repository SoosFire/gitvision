// Dependency-health orchestrator. Ecosystem-agnostic.
//
// Flow: fetch the repo's tree once, then for each registered plugin:
//   1. Filter tree → manifest paths this plugin handles
//   2. Fetch manifest content (parallel, concurrency-capped)
//   3. Let plugin parse manifests → declared (name, version, source) tuples
//   4. Dedupe on (name, version) so monorepos don't hit the registry N times
//   5. Fetch registry metadata for each unique pair (plugin's fetchMeta)
//   6. OSV.dev batch for CVEs (plugin's osvEcosystem string)
//   7. Categorize into outdated / vulnerable / deprecated with source paths
//
// Each plugin produces one DependencyHealth. Analysis returns the array.

import type { Octokit } from "octokit";
import type {
  DependencyHealth,
  OutdatedDep,
  VulnerableDep,
  DeprecatedDep,
} from "../types";
import { fetchRepoTree } from "./tree";
import { fetchOsvBatch } from "./osv";
import { mapWithConcurrency } from "./pool";
import type { EcosystemPlugin, DeclaredPackage } from "./types";

// Ecosystem plugins — add new ones here and nothing else changes.
import { npmPlugin } from "./ecosystems/npm";
import { cargoPlugin } from "./ecosystems/cargo";

const PLUGINS: EcosystemPlugin[] = [npmPlugin, cargoPlugin];

const MAX_MANIFEST_FILES = 50; // per ecosystem
const MAX_UNIQUE_PACKAGES = 300; // per ecosystem (registry + OSV budget)
const MAX_SOURCES_PER_PACKAGE = 5; // how many source paths we keep on each issue
const OUTDATED_THRESHOLD_MONTHS = 6;

/** Public entry point — scans the whole repo tree once and runs every plugin
 *  whose manifests are present. Returns one DependencyHealth per ecosystem. */
export async function analyzeDependencyHealth(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref = "HEAD"
): Promise<DependencyHealth[]> {
  const tree = await fetchRepoTree(octokit, owner, repo, ref);
  if (tree.length === 0) return [];

  const results: DependencyHealth[] = [];
  for (const plugin of PLUGINS) {
    const manifestPaths = tree.filter((p) => plugin.isManifest(p));
    if (manifestPaths.length === 0) continue;
    const capped = manifestPaths
      .sort((a, b) => a.split("/").length - b.split("/").length) // root-first
      .slice(0, MAX_MANIFEST_FILES);

    const result = await runPluginPipeline(plugin, capped, {
      octokit,
      owner,
      repo,
    });
    if (result) results.push(result);
  }
  return results;
}

// ------------------- Shared pipeline -------------------

interface RepoCtx {
  octokit: Octokit;
  owner: string;
  repo: string;
}

async function fetchFileContent(
  ctx: RepoCtx,
  path: string
): Promise<string | null> {
  try {
    const { data } = await ctx.octokit.rest.repos.getContent({
      owner: ctx.owner,
      repo: ctx.repo,
      path,
    });
    if (!("content" in data) || typeof data.content !== "string") return null;
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

async function runPluginPipeline(
  plugin: EcosystemPlugin,
  manifestPaths: string[],
  ctx: RepoCtx
): Promise<DependencyHealth | null> {
  // 1. Fetch all manifests for this ecosystem
  const manifestContents = await mapWithConcurrency(
    manifestPaths,
    5,
    async (path) => ({ path, content: await fetchFileContent(ctx, path) })
  );
  const validManifests = manifestContents.filter(
    (m): m is { path: string; content: string } => typeof m.content === "string"
  );
  if (validManifests.length === 0) return null;

  // 2. Parse each into declared packages
  const declared: DeclaredPackage[] = [];
  for (const m of validManifests) {
    declared.push(...plugin.parseManifest(m.path, m.content));
  }
  if (declared.length === 0) return null;

  // 3. Dedupe on (name, version) and track which manifests declared each
  const sourcesByKey = new Map<string, Set<string>>();
  const uniqueByKey = new Map<string, { name: string; declared: string }>();
  for (const d of declared) {
    const key = `${d.name}@${d.declared}`;
    if (!uniqueByKey.has(key)) {
      uniqueByKey.set(key, { name: d.name, declared: d.declared });
    }
    const set = sourcesByKey.get(key) ?? new Set<string>();
    set.add(d.sourcePath);
    sourcesByKey.set(key, set);
  }

  const entries = [...uniqueByKey.entries()];
  const capped = entries.slice(0, MAX_UNIQUE_PACKAGES);
  const truncated =
    entries.length > MAX_UNIQUE_PACKAGES
      ? `Analyzed first ${MAX_UNIQUE_PACKAGES} of ${entries.length} unique packages across ${validManifests.length} manifests`
      : undefined;

  // 4. Fetch registry meta (concurrency 10)
  const withMeta = await mapWithConcurrency(capped, 10, async ([key, d]) => {
    const current = plugin.normalizeVersion(d.declared);
    if (!current) return { key, ...d, current: null, meta: null };
    const meta = await plugin.fetchMeta(d.name, current);
    return { key, ...d, current, meta };
  });

  // 5. OSV batch for concrete versions only
  const osvReady = withMeta
    .filter(
      (d): d is typeof d & { current: string } => typeof d.current === "string"
    )
    .map((d) => ({
      key: d.key,
      name: d.name,
      version: d.current,
      ecosystem: plugin.osvEcosystem,
    }));
  const osvCves = await fetchOsvBatch(osvReady);
  const cvesByKey = new Map<string, string[]>();
  osvReady.forEach((q, i) => {
    if (osvCves[i]?.length) cvesByKey.set(q.key, osvCves[i]);
  });

  // 6. Categorize
  const outdated: OutdatedDep[] = [];
  const vulnerable: VulnerableDep[] = [];
  const deprecated: DeprecatedDep[] = [];

  function sourcesFor(key: string): string[] | undefined {
    const set = sourcesByKey.get(key);
    if (!set || set.size === 0) return undefined;
    return [...set].sort().slice(0, MAX_SOURCES_PER_PACKAGE);
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

    const cves = cvesByKey.get(d.key);
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

  const totalDeclarations = [...sourcesByKey.values()].reduce(
    (s, set) => s + set.size,
    0
  );

  return {
    ecosystem: plugin.name,
    total: totalDeclarations,
    uniquePackages: uniqueByKey.size,
    packageFiles: validManifests.length,
    outdated,
    vulnerable,
    deprecated,
    analyzedAt: new Date().toISOString(),
    note: truncated,
  };
}

/** Convenience helper for callers that want normalized access across old
 *  and new snapshot shapes. Old snapshots had `dependencyHealth` (singular);
 *  new ones have `dependencyHealths` (plural). */
export function getDependencyHealths(snap: {
  dependencyHealth?: DependencyHealth;
  dependencyHealths?: DependencyHealth[];
}): DependencyHealth[] {
  if (snap.dependencyHealths && snap.dependencyHealths.length > 0) {
    return snap.dependencyHealths;
  }
  if (snap.dependencyHealth) return [snap.dependencyHealth];
  return [];
}
