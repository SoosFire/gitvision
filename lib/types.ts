// Shared types for GitVision

import type { CodeGraph } from "./codeAnalysis/types";

export interface RepoMeta {
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
  pushedAt: string;
  language: string | null;
  license: string | null;
  homepage: string | null;
  topics: string[];
}

export interface Contributor {
  login: string;
  avatarUrl: string;
  htmlUrl: string;
  contributions: number;
}

export interface CommitSummary {
  sha: string;
  message: string;
  authorLogin: string | null;
  authorName: string;
  authorEmail: string;
  date: string; // ISO
  // Files touched — only available when fetching a single commit
  filesChanged?: number;
  additions?: number;
  deletions?: number;
}

export interface FileHotspot {
  path: string;
  churn: number; // number of commits touching this file
  authors: number; // unique authors
  authorLogins: string[]; // unique contributors who touched it
  lastModified: string;
  score: number; // composite hotspot score
  commits: string[]; // SHAs that touched this file (from sample)
}

export interface CoChangeEdge {
  from: string; // file path
  to: string; // file path
  count: number; // number of commits that touched both
}

export interface PullRequestSummary {
  number: number;
  title: string;
  state: "open" | "closed";
  merged: boolean;
  authorLogin: string | null;
  createdAt: string;
  closedAt: string | null;
  mergedAt: string | null;
}

export interface LanguageBreakdown {
  [language: string]: number; // bytes
}

// Re-export CodeGraph so callers can access it from this single types.ts
// entry point alongside the other snapshot field types.
export type { CodeGraph } from "./codeAnalysis/types";

// File-dependency graph (imports + framework-specific edges).
// Computed from the repo tarball — see lib/graph.ts.
export interface FileGraphNode {
  path: string;
  ext: string; // lowercase extension without dot
  layer: number; // BFS depth from roots (nodes with no incoming edges)
  inDegree: number;
  outDegree: number;
  x: number; // pre-computed layout position
  y: number;
}

export type FileGraphEdgeKind =
  | "import" // language-level import
  | "renders" // controller → template (Spring MVC, etc.)
  | "extends" // class extends another
  | "implements"; // class implements interface

export interface FileGraphEdge {
  from: string;
  to: string;
  kind: FileGraphEdgeKind;
}

export interface FileGraph {
  nodes: FileGraphNode[];
  edges: FileGraphEdge[];
  stats: {
    totalFiles: number;
    filesByLanguage: Record<string, number>;
    edgesByKind: Record<string, number>;
    skipped: number; // files we couldn't parse or weren't code
  };
  // If non-null, graph construction was truncated — either too large
  // or a tarball fetch error. The partial graph may still be useful.
  truncated?: string;
}

// Compact sha → commit metadata. Populated when we have full history (via
// lib/gitLog.ts) so the time-scrubber can resolve dates for SHAs that aren't
// in the trimmed `recentCommits` list, and per-contributor stats can resolve
// authors even when no GitHub login is available.
export interface CommitIndexEntry {
  d: string; // ISO date
  a: string | null; // authorLogin (from noreply email, if any)
  n: string; // authorName (always present, may be used as a grouping fallback)
}

// Dependency-health analysis for the npm ecosystem. Populated from
// lib/depsHealth.ts at analyze time. Absent when the repo has no root
// package.json or the analysis was skipped.
export interface OutdatedDep {
  name: string;
  current: string; // exact string from package.json (may include ^ or ~)
  latest: string;
  ageMonths: number; // months between current release and latest release
  lastPublished: string; // ISO date
  sources?: string[]; // package.json paths that declare this dep
}
export interface VulnerableDep {
  name: string;
  current: string;
  cves: string[]; // OSV / GHSA IDs
  sources?: string[];
}
export interface DeprecatedDep {
  name: string;
  current: string;
  message: string;
  sources?: string[];
}
/** Ecosystem identifier. Loose union — new plugins can add values without
 *  touching this file. Existing consumers should treat unknown values as
 *  opaque strings (useful in UI fallbacks). */
export type Ecosystem = "npm" | "cargo" | "pypi" | (string & {});

export interface DependencyHealth {
  ecosystem: Ecosystem;
  total: number; // total declarations across all manifest files
  uniquePackages?: number; // distinct (name, version) pairs analyzed
  packageFiles?: number; // number of manifest files read (monorepo-aware)
  outdated: OutdatedDep[];
  vulnerable: VulnerableDep[];
  deprecated: DeprecatedDep[];
  analyzedAt: string;
  note?: string; // truncation or partial-success reason
}

// Deterministic rule-based signal about the health of a repo. Each signal has
// a stable id so we can add/remove detectors without breaking stored analyses.
export interface HealthSignal {
  id: string;
  title: string; // short headline
  detail: string; // one-sentence explanation
  evidence: {
    paths?: string[];
    numbers?: Record<string, number>;
    note?: string;
  };
  severity?: "low" | "medium" | "high"; // only meaningful on "needsWork"
}

export interface HealthSignals {
  working: HealthSignal[]; // positive signals — things that are going well
  needsWork: HealthSignal[]; // risks, backlogs, debt signals
  questions: HealthSignal[]; // observations that need a human to interpret
}

// Combined rule-based signals + AI narrative for a snapshot. Cached like
// aiSummary so regeneration is explicit.
export interface HealthAnalysis {
  signals: HealthSignals;
  narrative: {
    working: string;
    needsWork: string;
    questions: string;
  };
  model: string;
  generatedAt: string;
  usage?: { inputTokens: number; outputTokens: number };
}

// A single snapshot of analyzed data for a repo at a point in time.
export interface AnalysisSnapshot {
  fetchedAt: string;
  repo: RepoMeta;
  contributors: Contributor[];
  languages: LanguageBreakdown;
  // Recent commits sampled (cap to avoid rate-limit pain)
  recentCommits: CommitSummary[];
  // Derived / computed insights
  hotspots: FileHotspot[];
  coChange: CoChangeEdge[]; // file-pair co-change relationships
  commitActivity: { week: string; count: number }[]; // weekly buckets
  // Optional — may be absent on older snapshots or if graph build failed
  fileGraph?: FileGraph;
  pullRequests?: PullRequestSummary[]; // recent PRs (best-effort)
  // Present when analysis used full `git log` history (lib/gitLog.ts). Covers
  // every sha referenced by hotspots.commits so time-scrubber spans all years.
  commitIndex?: Record<string, CommitIndexEntry>;
  // Set when the user generates a Claude-written repo summary (lib/aiSummary.ts).
  // Only populated on demand; the field is absent if the feature is off or not used.
  aiSummary?: {
    text: string;
    model: string;
    generatedAt: string;
    usage?: { inputTokens: number; outputTokens: number };
  };
  // Rule-based + AI health check. Lazy-populated — generated on button click.
  healthAnalysis?: HealthAnalysis;
  // Summary of what source drove the history (useful for UI + debugging)
  historySource?: {
    kind: "git-log" | "rest-sample";
    commitCount: number;
    earliest?: string;
    latest?: string;
    elapsedMs?: number;
    truncated?: string;
  };
  // Definitive README presence — from GitHub's /readme endpoint, not a path
  // heuristic. Absent on pre-v0.6 snapshots.
  hasReadme?: boolean;
  // Dependency-health analysis across all detected ecosystems (npm, cargo,
  // pypi, ...). Empty array if no manifests found. One entry per ecosystem
  // that had at least one manifest in the repo.
  dependencyHealths?: DependencyHealth[];
  // DEPRECATED: pre-v0.9 snapshots stored a single npm-only DependencyHealth
  // here. Read-side helpers (getDependencyHealths) normalize both shapes.
  dependencyHealth?: DependencyHealth;
  // AST-based code analysis (v0.10). JS/TS via tree-sitter, other 7 languages
  // via the regex-fallback wrapper. Functions, calls, complexity are JS/TS-
  // only as of v0.10; imports cover all 8 languages. Optional — pre-v0.10
  // snapshots simply omit this field. The Imports tab continues to read
  // `fileGraph` as before, so old sessions render unchanged.
  codeGraph?: CodeGraph;
  /** Set when codeGraph generation was skipped during analysis — typically
   *  because the analyze pipeline exceeded its time budget on a very large
   *  repo (golang/go, kubernetes/kubernetes scale). Lets the Code tab show
   *  a specific message ("skipped: timeout") rather than the generic
   *  "old snapshot, click Refresh" empty state. v0.19+. */
  codeGraphSkipReason?: string;
  rateLimitInfo?: {
    limit: number;
    remaining: number;
    reset: string;
  };
}

export interface Session {
  id: string;
  name: string; // user-editable display name
  repoUrl: string;
  createdAt: string;
  updatedAt: string;
  // All snapshots kept for "since last visit" diffs. Latest = current view.
  snapshots: AnalysisSnapshot[];
}

export interface SessionSummary {
  id: string;
  name: string;
  repoUrl: string;
  repoFullName: string;
  createdAt: string;
  updatedAt: string;
  snapshotCount: number;
}
