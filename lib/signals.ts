// Rule-based health signal extraction.
//
// Each detector takes the AnalysisSnapshot and returns 0 or more HealthSignal
// objects categorized into `working`, `needsWork`, or `questions`. Detectors
// are intentionally deterministic, explainable, and independent — you can add
// or remove one without rewriting the others.
//
// The AI narrative layer (lib/healthAnalysis.ts) consumes this output; humans
// see both the AI prose AND the raw signals in the UI via an evidence toggle.

import type {
  AnalysisSnapshot,
  HealthSignal,
  HealthSignals,
  FileHotspot,
  FileGraph,
} from "./types";

// ------------------- Bot detection -------------------
// PR cycle-time and throughput should reflect *human* workflow, not bot churn.
// Bots like dependabot auto-merge minutes after opening and skew the median.

const BOT_LOGIN_PATTERNS: RegExp[] = [
  /\[bot\]$/i,
  /-bot$/i,
  /^bot-/i,
  /^dependabot/i,
  /^renovate/i,
  /^github-actions/i,
  /^vercel-release/i,
  /^mergify/i,
  /^codecov/i,
  /^snyk-bot/i,
  /^greenkeeper/i,
  /^imgbot/i,
];

function isBotAuthor(login: string | null): boolean {
  if (!login) return false;
  return BOT_LOGIN_PATTERNS.some((re) => re.test(login));
}

// ------------------- File-classification helpers -------------------

const METADATA_BASENAMES = new Set<string>([
  "readme.md",
  "readme",
  "changelog.md",
  "changelog",
  "license",
  "license.md",
  "license.txt",
  "contributing.md",
  "code_of_conduct.md",
  "security.md",
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "cargo.toml",
  "cargo.lock",
  "go.mod",
  "go.sum",
  "gemfile",
  "gemfile.lock",
  "pipfile",
  "pipfile.lock",
  "requirements.txt",
  "poetry.lock",
  "pyproject.toml",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  "dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
]);
const METADATA_PATTERNS: RegExp[] = [
  /\.prettierrc($|\.)/i,
  /\.eslintrc($|\.)/i,
  /\.stylelintrc($|\.)/i,
  /tsconfig(\.[^.]+)?\.json$/i,
  /jsconfig\.json$/i,
  /\.config\.(js|cjs|mjs|ts)$/i,
  /^\.github\//i,
];

export function isMetadataFile(path: string): boolean {
  const base = (path.split("/").pop() ?? "").toLowerCase();
  if (METADATA_BASENAMES.has(base)) return true;
  return METADATA_PATTERNS.some((re) => re.test(path));
}

const TEST_PATTERNS = [
  /\.test\.[jt]sx?$/i,
  /\.spec\.[jt]sx?$/i,
  /_test\.go$/i,
  /_spec\.rb$/i,
  /^test_.*\.py$/i,
  /(^|\/)tests?\//i,
  /(^|\/)__tests__\//i,
  /tests?\.[a-z]+$/i,
];

function isTestFile(path: string): boolean {
  return TEST_PATTERNS.some((re) => re.test(path));
}

const CODE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "rb", "go", "rs", "java", "kt", "scala", "swift",
  "c", "cc", "cpp", "h", "hpp", "cs", "php",
  "vue", "svelte", "astro",
]);

// Folders that are typically generated / are output of some upstream source.
// When cross-boundary coupling includes one of these, the pair is expected
// (source writes to output), not a red flag for leaking boundaries.
//
// Note: we deliberately DON'T include "lib" — it's source code in most
// projects (our own repo, express, every Node lib). Publishable-npm repos
// that use lib/ as dist would need a dedicated heuristic.
const OUTPUT_LIKE_FOLDERS = new Set<string>([
  "docs",
  "dist",
  "build",
  "out",
  "output",
  "public",
  "static",
  "_site",
  "site",
  "generated",
  "gen",
  "compiled",
  "bin",
  "data",
  "snapshots",
  "coverage",
  "assets",
  "www",
]);

function isSourceOutputPair(f1: string, f2: string): boolean {
  const a = f1.toLowerCase();
  const b = f2.toLowerCase();
  return OUTPUT_LIKE_FOLDERS.has(a) || OUTPUT_LIKE_FOLDERS.has(b);
}

function isCodeFile(path: string): boolean {
  if (isMetadataFile(path)) return false;
  if (isTestFile(path)) return false;
  const ext = path.match(/\.([^./]+)$/)?.[1]?.toLowerCase();
  return !!ext && CODE_EXTS.has(ext);
}

function fileBasename(path: string): string {
  return path.split("/").pop() ?? path;
}

function folderOf(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts[0] : "/";
}

// Three-layer test-coverage detection — most precise signal wins.
//
//   1. Sibling file: `foo.test.ts` next to `foo.ts`, `__tests__/foo.ts`, etc.
//   2. Import edge:  a test file that directly imports the hotspot
//   3. Name match:   a test file whose name contains the hotspot's basename
//
// Real-world test layouts (Next.js test/unit/..., React packages/*/src/__tests__/)
// don't fit sibling patterns, so we need broader signals to avoid false positives.
function hasTestCoverage(
  hotspot: FileHotspot,
  allKnownPaths: Set<string>,
  allTests: Set<string>,
  fileGraph: FileGraph | undefined
): boolean {
  // Layer 1: sibling patterns
  const base = fileBasename(hotspot.path);
  const nameNoExt = base.replace(/\.[^.]+$/, "");
  const ext = base.slice(nameNoExt.length);
  const dir = hotspot.path.slice(0, -base.length);

  const siblings = [
    `${dir}${nameNoExt}.test${ext}`,
    `${dir}${nameNoExt}.spec${ext}`,
    `${dir}__tests__/${base}`,
    `${dir}tests/${base}`,
    `${dir}test/${base}`,
    ext === ".go" ? `${dir}${nameNoExt}_test.go` : "",
    ext === ".py" ? `${dir}test_${nameNoExt}.py` : "",
  ].filter(Boolean);
  if (siblings.some((c) => allKnownPaths.has(c))) return true;

  // Layer 2: any test file directly imports this hotspot via fileGraph
  if (fileGraph) {
    for (const edge of fileGraph.edges) {
      if (edge.to === hotspot.path && isTestFile(edge.from)) return true;
    }
  }

  // Layer 3: a test file's basename contains the hotspot's basename.
  // Only useful when the name is distinctive (≥ 4 chars) to avoid matching
  // generic names like "index" or "utils" everywhere.
  const nameLower = nameNoExt.toLowerCase();
  if (nameLower.length >= 4 && nameLower !== "index" && nameLower !== "utils") {
    for (const test of allTests) {
      const testBase = (test.split("/").pop() ?? "").toLowerCase();
      if (testBase.includes(nameLower)) return true;
    }
  }

  return false;
}

// Median helper for cycle-time calculations.
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ------------------- Detectors -------------------

// 1. PR throughput — healthy merge vs. open ratio (working) OR backlog (needsWork).
// Excludes bot-authored PRs because they distort the "is review keeping up?" signal:
// dependabot can file 50 PRs in a day and auto-merge them all, making throughput
// look healthy even when human PRs pile up.
function detectPrThroughput(
  snap: AnalysisSnapshot
): { working: HealthSignal[]; needsWork: HealthSignal[] } {
  const working: HealthSignal[] = [];
  const needsWork: HealthSignal[] = [];
  if (!snap.pullRequests || snap.pullRequests.length === 0) {
    return { working, needsWork };
  }
  const humanPrs = snap.pullRequests.filter((p) => !isBotAuthor(p.authorLogin));
  const merged = humanPrs.filter((p) => p.merged).length;
  const open = humanPrs.filter((p) => p.state === "open").length;
  const total = merged + open;
  if (total < 5) return { working, needsWork };

  if (merged >= open && merged >= 5) {
    working.push({
      id: "healthy-pr-throughput",
      title: "Healthy review throughput",
      detail: `${merged} merged vs ${open} open among human-authored PRs — review keeps pace with intake.`,
      evidence: { numbers: { merged, open } },
    });
  } else if (open > merged * 1.5) {
    const ratio = merged > 0 ? (open / merged).toFixed(1) : "∞";
    needsWork.push({
      id: "pr-backlog",
      title: "PR backlog growing",
      detail: `${open} human-authored PRs open against ${merged} recently merged (${ratio}× intake) — review is the bottleneck.`,
      evidence: { numbers: { open, merged } },
      severity: open > merged * 3 ? "high" : "medium",
    });
  }
  return { working, needsWork };
}

// 2. PR cycle time — fast merges (working) vs. slow reviews (needsWork).
// Bot-authored PRs (dependabot, renovate, release-bot) typically merge in
// minutes and drag the median artificially low. Filter them out to get a
// cycle-time signal that reflects human review workflow.
function detectPrCycleTime(
  snap: AnalysisSnapshot
): { working: HealthSignal[]; needsWork: HealthSignal[] } {
  const working: HealthSignal[] = [];
  const needsWork: HealthSignal[] = [];
  const mergedPRs = (snap.pullRequests ?? []).filter(
    (p) =>
      p.merged &&
      p.createdAt &&
      p.mergedAt &&
      !isBotAuthor(p.authorLogin)
  );
  if (mergedPRs.length < 5) return { working, needsWork };

  const durationsMs = mergedPRs.map(
    (p) =>
      new Date(p.mergedAt as string).getTime() -
      new Date(p.createdAt).getTime()
  );
  const medianDays = median(durationsMs) / (1000 * 60 * 60 * 24);

  if (medianDays <= 3) {
    working.push({
      id: "fast-pr-cycle",
      title: "Fast PR cycle",
      detail: `Median time-to-merge is ${medianDays.toFixed(1)} days across ${mergedPRs.length} recent human-authored merges — team ships quickly.`,
      evidence: { numbers: { medianDays: +medianDays.toFixed(1), sampled: mergedPRs.length } },
    });
  } else if (medianDays >= 14) {
    needsWork.push({
      id: "slow-pr-cycle",
      title: "Slow PR reviews",
      detail: `Human-authored PRs take a median of ${medianDays.toFixed(0)} days to merge — review friction is real.`,
      evidence: { numbers: { medianDays: +medianDays.toFixed(1), sampled: mergedPRs.length } },
      severity: medianDays > 30 ? "high" : "medium",
    });
  }
  return { working, needsWork };
}

// 3. Knowledge distribution — broad diversity (working) vs. concentration (needsWork).
// Accepts `isSoloProject` so we don't double-dip: on a solo repo the whole repo
// is single-owner by definition, and the solo-project question already covers it.
function detectKnowledgeDistribution(
  snap: AnalysisSnapshot,
  isSoloProject: boolean
): { working: HealthSignal[]; needsWork: HealthSignal[] } {
  const working: HealthSignal[] = [];
  const needsWork: HealthSignal[] = [];

  const byFolder = new Map<string, Set<string>>();
  const churnByFolder = new Map<string, number>();
  for (const h of snap.hotspots) {
    const folder = folderOf(h.path);
    const authors = byFolder.get(folder) ?? new Set<string>();
    (h.authorLogins ?? []).forEach((a) => authors.add(a));
    byFolder.set(folder, authors);
    churnByFolder.set(folder, (churnByFolder.get(folder) ?? 0) + h.churn);
  }
  if (byFolder.size < 2) return { working, needsWork };

  // Only flag folders with meaningful activity (≥ 5 churn).
  const active = [...byFolder.entries()]
    .filter(([f]) => (churnByFolder.get(f) ?? 0) >= 5)
    .filter(([f]) => f !== "/"); // root-level files are usually config/docs

  const singleOwner = active
    .filter(([, a]) => a.size === 1)
    .map(([f]) => f);
  const diverseOwned = active.filter(([, a]) => a.size >= 3).map(([f]) => f);

  // Suppress concentration signal on solo projects — it's just restating
  // solo-project status. Solo-project detector in questions covers it.
  if (singleOwner.length >= 1 && !isSoloProject) {
    needsWork.push({
      id: "bus-factor-risk",
      title: "Knowledge concentration",
      detail: `${singleOwner.length} active folder${singleOwner.length === 1 ? "" : "s"} maintained by a single contributor — high bus factor risk.`,
      evidence: { paths: singleOwner.slice(0, 4) },
      severity: singleOwner.length >= 3 ? "high" : "medium",
    });
  }
  if (diverseOwned.length >= 3) {
    working.push({
      id: "broad-ownership",
      title: "Broad ownership",
      detail: `${diverseOwned.length} folders have 3+ recent contributors — resilient against any one person leaving.`,
      evidence: { paths: diverseOwned.slice(0, 4) },
    });
  }
  return { working, needsWork };
}

// 4. Untested hotspots — only fires when test presence is genuinely thin.
// Global gate: if the repo has many tests globally (≥ 30, or ≥ 25% of code
// files), the test layout just isn't sibling/import-discoverable and we'd
// rather stay silent than cry wolf.
function detectUntestedHotspots(snap: AnalysisSnapshot): HealthSignal[] {
  const { allPaths, allTests, codeFileCount } = collectPathIndices(snap);

  const codeHotspots = snap.hotspots
    .slice(0, 25)
    .filter((h) => isCodeFile(h.path));
  if (codeHotspots.length < 5) return [];

  // Global sanity gate — plenty of tests exist, we just can't connect them.
  if (allTests.size >= 30) return [];
  if (codeFileCount > 0 && allTests.size / codeFileCount >= 0.25) return [];

  const untested = codeHotspots.filter(
    (h) => !hasTestCoverage(h, allPaths, allTests, snap.fileGraph)
  );
  const pct = Math.round((untested.length / codeHotspots.length) * 100);
  if (pct < 50) return [];

  return [
    {
      id: "untested-hotspots",
      title: "Hot files lack visible tests",
      detail: `${pct}% of the top-churn code files have no discoverable test — regressions in these areas are easy to miss.`,
      evidence: {
        paths: untested.slice(0, 3).map((h) => h.path),
        numbers: { pctUntested: pct, sampled: codeHotspots.length },
      },
      severity: pct > 80 ? "high" : "medium",
    },
  ];
}

// Helper — build path indices once so detectors don't redo the work.
function collectPathIndices(snap: AnalysisSnapshot): {
  allPaths: Set<string>;
  allTests: Set<string>;
  codeFileCount: number;
} {
  const allPaths = new Set<string>();
  snap.hotspots.forEach((h) => allPaths.add(h.path));
  snap.fileGraph?.nodes.forEach((n) => allPaths.add(n.path));
  const allTests = new Set<string>();
  let codeFileCount = 0;
  for (const p of allPaths) {
    if (isTestFile(p)) allTests.add(p);
    else if (isCodeFile(p)) codeFileCount++;
  }
  return { allPaths, allTests, codeFileCount };
}

// 5. Cross-boundary coupling — files from different top-level folders that
// change together frequently. Signal for leaky module boundaries.
//
// Domain-aware: pairs involving a typical output/artifact folder (docs/,
// dist/, public/, data/, etc.) are EXPECTED to co-change with their source,
// so we exclude them from the flag. A scraper writing to docs/ isn't a
// coupling problem — it's the whole point.
function detectCrossBoundaryCoupling(snap: AnalysisSnapshot): HealthSignal[] {
  const allCross = (snap.coChange ?? []).filter((e) => {
    const f1 = folderOf(e.from);
    const f2 = folderOf(e.to);
    return f1 !== f2 && f1 !== "/" && f2 !== "/" && e.count >= 3;
  });

  // Split into "real" coupling vs. source-output pairs (expected behavior).
  const real = allCross.filter(
    (e) => !isSourceOutputPair(folderOf(e.from), folderOf(e.to))
  );

  if (real.length < 3) return [];
  const top = real.slice(0, 2);
  return [
    {
      id: "cross-boundary-coupling",
      title: "Tightly-coupled modules",
      detail: `${real.length} file pairs across different top-level folders change together frequently — module boundaries may be leaking.`,
      evidence: {
        paths: top.flatMap((e) => [e.from, e.to]),
        numbers: { pairs: real.length },
      },
      severity: real.length >= 10 ? "high" : "medium",
    },
  ];
}

// 6. Metadata dominance — is most of the visible "activity" just releases?
function detectMetadataDominance(snap: AnalysisSnapshot): HealthSignal[] {
  const top = snap.hotspots.slice(0, 15);
  if (top.length < 10) return [];
  const metaCount = top.filter((h) => isMetadataFile(h.path)).length;
  const pct = Math.round((metaCount / top.length) * 100);
  if (pct < 60) return [];
  return [
    {
      id: "metadata-dominance",
      title: "Mostly metadata churn",
      detail: `${pct}% of the top churn is in lockfiles, configs, and release artifacts. Real feature development may be happening elsewhere — or the project may be in maintenance mode.`,
      evidence: {
        numbers: { metadataPct: pct, sampled: top.length },
      },
    },
  ];
}

// 7. Recent activity — very active (working) vs. stale (needsWork)
function detectActivityRecency(
  snap: AnalysisSnapshot
): { working: HealthSignal[]; needsWork: HealthSignal[] } {
  const working: HealthSignal[] = [];
  const needsWork: HealthSignal[] = [];
  const latestIso =
    snap.historySource?.latest ??
    snap.recentCommits[0]?.date ??
    snap.repo.pushedAt;
  if (!latestIso) return { working, needsWork };
  const days = (Date.now() - new Date(latestIso).getTime()) / (1000 * 60 * 60 * 24);
  if (days < 0) return { working, needsWork };

  if (days < 7) {
    working.push({
      id: "very-active",
      title: "Actively developed",
      detail: `Last commit was ${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"} ago.`,
      evidence: { numbers: { daysSinceLastCommit: Math.round(days) } },
    });
  } else if (days > 90) {
    needsWork.push({
      id: "stale",
      title: "Not recently active",
      detail: `Last commit was ${Math.round(days)} days ago — the project may be paused, finished, or abandoned.`,
      evidence: { numbers: { daysSinceLastCommit: Math.round(days) } },
      severity: days > 365 ? "high" : "medium",
    });
  }
  return { working, needsWork };
}

// 8. Solo contributor check (question — not intrinsically bad)
function detectSoloProject(snap: AnalysisSnapshot): HealthSignal[] {
  const authors = new Set<string>();
  snap.hotspots.forEach((h) =>
    (h.authorLogins ?? []).forEach((a) => authors.add(a))
  );
  if (authors.size !== 1) return [];
  if (snap.recentCommits.length < 5) return [];
  const [onlyAuthor] = [...authors];
  return [
    {
      id: "solo-project",
      title: "Solo project",
      detail: `All visible activity is by @${onlyAuthor}. If this is an intentional personal project, great — otherwise the bus factor is one.`,
      evidence: { note: onlyAuthor },
    },
  ];
}

// 9. Missing open-source hygiene (license/README) — question.
// README check uses the snapshot's `hasReadme` flag, populated from GitHub's
// dedicated /readme endpoint during analysis. Path-scanning was unreliable
// because README files often don't appear in hotspots or the file-graph.
// On pre-v0.6 snapshots without the flag, skip the README check entirely
// rather than falsely accuse mature repos.
function detectMissingHygiene(snap: AnalysisSnapshot): HealthSignal[] {
  const missing: string[] = [];
  if (!snap.repo.license) missing.push("LICENSE");
  if (snap.hasReadme === false) missing.push("README");
  if (missing.length === 0) return [];
  return [
    {
      id: "missing-hygiene",
      title: "Missing basic documentation",
      detail: `No ${missing.join(" or ")} detected. If others are meant to use or evaluate this code, these set expectations fast.`,
      evidence: { note: missing.join(", ") },
    },
  ];
}

// 10. Commit cadence — steady rhythm across weeks is a positive signal even
// for solo projects. Looks for activity spread, not just volume.
function detectCommitCadence(snap: AnalysisSnapshot): HealthSignal[] {
  const weeks = snap.commitActivity ?? [];
  if (weeks.length < 6) return [];
  const activeWeeks = weeks.filter((w) => w.count > 0).length;
  const activeRatio = activeWeeks / weeks.length;
  if (activeRatio < 0.6) return [];
  return [
    {
      id: "consistent-cadence",
      title: "Consistent commit cadence",
      detail: `${activeWeeks} of the last ${weeks.length} sampled weeks had activity — steady development rhythm.`,
      evidence: {
        numbers: { activeWeeks, totalWeeks: weeks.length },
      },
    },
  ];
}

// 11. Positive test coverage — flip of detectUntestedHotspots. If the majority
// of hot code files have a discoverable test (sibling / import / name match),
// that's worth celebrating.
function detectGoodTestPresence(snap: AnalysisSnapshot): HealthSignal[] {
  const { allPaths, allTests } = collectPathIndices(snap);

  const codeHotspots = snap.hotspots
    .slice(0, 25)
    .filter((h) => isCodeFile(h.path));
  if (codeHotspots.length < 5) return [];
  const tested = codeHotspots.filter((h) =>
    hasTestCoverage(h, allPaths, allTests, snap.fileGraph)
  );
  const pct = Math.round((tested.length / codeHotspots.length) * 100);
  if (pct < 60) return [];
  return [
    {
      id: "good-test-presence",
      title: "Tests alongside hot code",
      detail: `${pct}% of the top-churn code files have a discoverable test — regressions should be caught early.`,
      evidence: {
        numbers: { pctTested: pct, sampled: codeHotspots.length },
      },
    },
  ];
}

// 12. Real code activity — flip of detectMetadataDominance. If the top churn
// is MOSTLY real code (not lockfiles / config), that's a healthy sign.
function detectRealCodeActivity(snap: AnalysisSnapshot): HealthSignal[] {
  const top = snap.hotspots.slice(0, 15);
  if (top.length < 10) return [];
  const metaCount = top.filter((h) => isMetadataFile(h.path)).length;
  const pct = Math.round((metaCount / top.length) * 100);
  if (pct > 20) return [];
  return [
    {
      id: "real-code-activity",
      title: "Active code development",
      detail: `Only ${pct}% of recent churn is metadata/config — the rest is genuine code work.`,
      evidence: {
        numbers: { metadataPct: pct, sampled: top.length },
      },
    },
  ];
}

// 13. Vulnerable dependencies — high severity flag (CVE data from OSV.dev)
function detectVulnerableDeps(snap: AnalysisSnapshot): HealthSignal[] {
  const h = snap.dependencyHealth;
  if (!h || h.vulnerable.length === 0) return [];
  const totalCves = h.vulnerable.reduce((s, d) => s + d.cves.length, 0);
  const topPackages = h.vulnerable
    .slice(0, 3)
    .map((d) => `${d.name}@${d.current}`);
  return [
    {
      id: "vulnerable-deps",
      title: `${h.vulnerable.length} vulnerable dependenc${h.vulnerable.length === 1 ? "y" : "ies"}`,
      detail: `${totalCves} known CVE${totalCves === 1 ? "" : "s"} across the dependency tree — ${topPackages.join(", ")}${h.vulnerable.length > 3 ? ` +${h.vulnerable.length - 3} more` : ""}.`,
      evidence: {
        paths: h.vulnerable
          .slice(0, 5)
          .map((d) => `${d.name}@${d.current} · ${d.cves.slice(0, 2).join(", ")}`),
        numbers: { packages: h.vulnerable.length, cves: totalCves },
      },
      severity: "high",
    },
  ];
}

// 14. Outdated dependencies — >=1 year behind latest across N+ packages
function detectOutdatedDeps(snap: AnalysisSnapshot): HealthSignal[] {
  const h = snap.dependencyHealth;
  if (!h) return [];
  const stale = h.outdated.filter((d) => d.ageMonths >= 12);
  if (stale.length < 3) return [];
  const topThree = stale.slice(0, 3);
  return [
    {
      id: "outdated-deps",
      title: `${stale.length} packages ≥ 1 year behind`,
      detail: `Stalest: ${topThree
        .map((d) => `${d.name} (${d.ageMonths}m behind)`)
        .join(", ")}. Upgrade candidates for a debt-reduction sprint.`,
      evidence: {
        paths: stale.slice(0, 5).map((d) => `${d.name}: ${d.current} → ${d.latest}`),
        numbers: {
          behind: stale.length,
          totalDeps: h.total,
          outdatedTotal: h.outdated.length,
        },
      },
      severity: stale.length > 10 ? "high" : "medium",
    },
  ];
}

// 15. Deprecated dependencies — package explicitly deprecated on npm
function detectDeprecatedDeps(snap: AnalysisSnapshot): HealthSignal[] {
  const h = snap.dependencyHealth;
  if (!h || h.deprecated.length === 0) return [];
  return [
    {
      id: "deprecated-deps",
      title: `${h.deprecated.length} deprecated dependenc${h.deprecated.length === 1 ? "y" : "ies"}`,
      detail: `Explicitly deprecated: ${h.deprecated
        .slice(0, 3)
        .map((d) => d.name)
        .join(", ")}${h.deprecated.length > 3 ? ` +${h.deprecated.length - 3}` : ""}. Find maintained alternatives.`,
      evidence: {
        paths: h.deprecated
          .slice(0, 5)
          .map((d) => `${d.name}@${d.current}: ${d.message.slice(0, 80)}`),
        numbers: { count: h.deprecated.length },
      },
      severity: "medium",
    },
  ];
}

// 16. Fresh dependencies — counterpart to outdated (positive signal)
function detectFreshDeps(snap: AnalysisSnapshot): HealthSignal[] {
  const h = snap.dependencyHealth;
  if (!h || h.total < 5) return [];
  // Don't celebrate fresh deps when there are CVEs or deprecated ones.
  if (h.vulnerable.length > 0 || h.deprecated.length > 0) return [];
  const staleCount = h.outdated.filter((d) => d.ageMonths >= 12).length;
  if (staleCount > 0) return [];
  const somewhatStale = h.outdated.filter((d) => d.ageMonths >= 6).length;
  // Must be genuinely fresh — less than 20% of deps even 6 months behind
  if (somewhatStale > h.total * 0.2) return [];
  return [
    {
      id: "fresh-deps",
      title: "Dependencies are fresh",
      detail: `${h.total} packages analyzed with no known CVEs, no deprecated entries, and nothing more than 12 months behind.`,
      evidence: {
        numbers: { total: h.total, somewhatStale },
      },
    },
  ];
}

// 17. Large contributor spread — many contributors = usually working
function detectContributorSpread(snap: AnalysisSnapshot): HealthSignal[] {
  if (snap.contributors.length >= 20) {
    const top = snap.contributors.slice(0, 5);
    const topContribs = top.reduce((s, c) => s + c.contributions, 0);
    const allContribs = snap.contributors.reduce((s, c) => s + c.contributions, 0);
    const topShare = Math.round((topContribs / Math.max(1, allContribs)) * 100);
    return [
      {
        id: "many-contributors",
        title: "Broad contributor base",
        detail: `${snap.contributors.length}+ people have contributed; top 5 account for ${topShare}% — healthy participation curve.`,
        evidence: {
          numbers: {
            totalContributors: snap.contributors.length,
            top5SharePct: topShare,
          },
        },
      },
    ];
  }
  return [];
}

// ------------------- Aggregator -------------------

export function extractHealthSignals(snap: AnalysisSnapshot): HealthSignals {
  const working: HealthSignal[] = [];
  const needsWork: HealthSignal[] = [];
  const questions: HealthSignal[] = [];

  // Run solo detector first — its result gates other detectors (namely, we
  // don't double-report bus-factor concerns on a repo that's solo by nature).
  const soloSignals = detectSoloProject(snap);
  const isSoloProject = soloSignals.length > 0;
  questions.push(...soloSignals);

  const prThroughput = detectPrThroughput(snap);
  working.push(...prThroughput.working);
  needsWork.push(...prThroughput.needsWork);

  const prCycle = detectPrCycleTime(snap);
  working.push(...prCycle.working);
  needsWork.push(...prCycle.needsWork);

  const knowledge = detectKnowledgeDistribution(snap, isSoloProject);
  working.push(...knowledge.working);
  needsWork.push(...knowledge.needsWork);

  needsWork.push(...detectUntestedHotspots(snap));
  needsWork.push(...detectCrossBoundaryCoupling(snap));
  questions.push(...detectMetadataDominance(snap));

  const activity = detectActivityRecency(snap);
  working.push(...activity.working);
  needsWork.push(...activity.needsWork);

  questions.push(...detectMissingHygiene(snap));

  // Dependency-health detectors (from lib/depsHealth.ts data)
  needsWork.push(...detectVulnerableDeps(snap));
  needsWork.push(...detectOutdatedDeps(snap));
  needsWork.push(...detectDeprecatedDeps(snap));

  // Solo-friendly positive detectors — these fire on team projects too, but
  // they're especially important for giving solo projects credit where due.
  working.push(...detectCommitCadence(snap));
  working.push(...detectGoodTestPresence(snap));
  working.push(...detectRealCodeActivity(snap));
  working.push(...detectFreshDeps(snap));
  working.push(...detectContributorSpread(snap));

  // Sort needsWork by severity (high → low) so AI prose leads with the worst
  const sevRank = { high: 3, medium: 2, low: 1 } as const;
  needsWork.sort(
    (a, b) =>
      (b.severity ? sevRank[b.severity] : 0) -
      (a.severity ? sevRank[a.severity] : 0)
  );

  return { working, needsWork, questions };
}
