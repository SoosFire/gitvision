// Shared types for GitVision

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

export interface LanguageBreakdown {
  [language: string]: number; // bytes
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
