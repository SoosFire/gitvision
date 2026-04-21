// GitHub API client using Octokit.
// Uses GITHUB_TOKEN from env if provided (5000 req/hr), otherwise unauthenticated (60 req/hr).

import { Octokit } from "octokit";
import type {
  RepoMeta,
  Contributor,
  CommitSummary,
  LanguageBreakdown,
  AnalysisSnapshot,
  FileHotspot,
  CoChangeEdge,
} from "./types";

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN || undefined,
  userAgent: "GitVision/0.1",
});

/**
 * Parse a GitHub repo URL/shorthand into { owner, repo }.
 * Accepts:
 *  - https://github.com/owner/repo
 *  - https://github.com/owner/repo.git
 *  - github.com/owner/repo
 *  - owner/repo
 */
export function parseRepoUrl(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const patterns = [
    /^https?:\/\/github\.com\/([^\/\s]+)\/([^\/\s]+)/,
    /^github\.com\/([^\/\s]+)\/([^\/\s]+)/,
    /^([^\/\s]+)\/([^\/\s]+)$/,
  ];
  for (const p of patterns) {
    const m = trimmed.match(p);
    if (m) return { owner: m[1], repo: m[2] };
  }
  return null;
}

export async function fetchRepoMeta(owner: string, repo: string): Promise<RepoMeta> {
  const { data } = await octokit.rest.repos.get({ owner, repo });
  return {
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    description: data.description,
    stars: data.stargazers_count,
    forks: data.forks_count,
    watchers: data.subscribers_count,
    openIssues: data.open_issues_count,
    defaultBranch: data.default_branch,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    pushedAt: data.pushed_at,
    language: data.language,
    license: data.license?.spdx_id ?? null,
    homepage: data.homepage,
    topics: data.topics ?? [],
  };
}

export async function fetchContributors(owner: string, repo: string): Promise<Contributor[]> {
  // GitHub caps contributors endpoint at 500 by default; that's plenty for MVP.
  const { data } = await octokit.rest.repos.listContributors({
    owner,
    repo,
    per_page: 100,
  });
  return data
    .filter((c): c is typeof c & { login: string } => !!c.login)
    .map((c) => ({
      login: c.login,
      avatarUrl: c.avatar_url ?? "",
      htmlUrl: c.html_url ?? `https://github.com/${c.login}`,
      contributions: c.contributions,
    }));
}

export async function fetchLanguages(
  owner: string,
  repo: string
): Promise<LanguageBreakdown> {
  const { data } = await octokit.rest.repos.listLanguages({ owner, repo });
  return data as LanguageBreakdown;
}

/**
 * Fetch recent commits. We cap at `maxPages * 100` to avoid burning the rate limit on huge repos.
 * For MVP we sample the most recent 300 commits — enough for hotspot signal without pain.
 */
export async function fetchRecentCommits(
  owner: string,
  repo: string,
  maxPages = 3
): Promise<CommitSummary[]> {
  const commits: CommitSummary[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const { data } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      per_page: 100,
      page,
    });
    if (data.length === 0) break;
    for (const c of data) {
      commits.push({
        sha: c.sha,
        message: c.commit.message.split("\n")[0].slice(0, 200),
        authorLogin: c.author?.login ?? null,
        authorName: c.commit.author?.name ?? "unknown",
        authorEmail: c.commit.author?.email ?? "",
        date: c.commit.author?.date ?? c.commit.committer?.date ?? new Date().toISOString(),
      });
    }
    if (data.length < 100) break;
  }
  return commits;
}

/**
 * For a sample of recent commits, fetch their file-change details to compute hotspots.
 * Very expensive API-wise — we only look at the latest N commits.
 */
export async function fetchCommitFileChanges(
  owner: string,
  repo: string,
  commitShas: string[]
): Promise<Map<string, { files: string[]; authorLogin: string | null; date: string }>> {
  const result = new Map<string, { files: string[]; authorLogin: string | null; date: string }>();
  // Sequential to respect rate-limit; could parallelize with a concurrency cap later.
  for (const sha of commitShas) {
    try {
      const { data } = await octokit.rest.repos.getCommit({ owner, repo, ref: sha });
      result.set(sha, {
        files: (data.files ?? []).map((f) => f.filename),
        authorLogin: data.author?.login ?? null,
        date: data.commit.author?.date ?? "",
      });
    } catch {
      // skip individual failures, continue
    }
  }
  return result;
}

/**
 * Compute file hotspots from a set of commit-file changes.
 * Score = churn * log(authors+1) — favors files touched often by multiple people.
 */
export function computeHotspots(
  perCommitFiles: Map<string, { files: string[]; authorLogin: string | null; date: string }>
): FileHotspot[] {
  const byFile = new Map<
    string,
    { churn: number; authors: Set<string>; lastModified: string; commits: string[] }
  >();

  for (const [sha, info] of perCommitFiles) {
    for (const file of info.files) {
      const entry = byFile.get(file) ?? {
        churn: 0,
        authors: new Set<string>(),
        lastModified: "",
        commits: [] as string[],
      };
      entry.churn += 1;
      if (info.authorLogin) entry.authors.add(info.authorLogin);
      if (info.date && info.date > entry.lastModified) entry.lastModified = info.date;
      entry.commits.push(sha);
      byFile.set(file, entry);
    }
  }

  const hotspots: FileHotspot[] = [];
  for (const [path, data] of byFile) {
    const authorLogins = [...data.authors];
    const score = data.churn * Math.log(authorLogins.length + 1);
    hotspots.push({
      path,
      churn: data.churn,
      authors: authorLogins.length,
      authorLogins,
      lastModified: data.lastModified,
      score,
      commits: data.commits,
    });
  }
  hotspots.sort((a, b) => b.score - a.score);
  return hotspots;
}

/**
 * Compute co-change edges: file pairs that frequently change together.
 * Skips mega-commits (>15 files) which are usually renames/refactors and would dominate.
 */
export function computeCoChange(
  perCommitFiles: Map<string, { files: string[]; authorLogin: string | null; date: string }>,
  allowedFiles: Set<string>,
  opts: { maxEdges?: number; minCount?: number } = {}
): CoChangeEdge[] {
  const maxEdges = opts.maxEdges ?? 150;
  const minCount = opts.minCount ?? 2;
  const pairs = new Map<string, number>();

  for (const [, info] of perCommitFiles) {
    const files = info.files.filter((f) => allowedFiles.has(f));
    if (files.length < 2 || files.length > 15) continue;
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const [a, b] = files[i] < files[j] ? [files[i], files[j]] : [files[j], files[i]];
        const key = `${a}|${b}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }

  const edges: CoChangeEdge[] = [];
  for (const [key, count] of pairs) {
    if (count < minCount) continue;
    const [from, to] = key.split("|");
    edges.push({ from, to, count });
  }
  edges.sort((a, b) => b.count - a.count);
  return edges.slice(0, maxEdges);
}

export function computeCommitActivity(commits: CommitSummary[]): { week: string; count: number }[] {
  const buckets = new Map<string, number>();
  for (const c of commits) {
    // ISO week start (Monday) as key
    const d = new Date(c.date);
    if (isNaN(d.getTime())) continue;
    const day = d.getUTCDay();
    const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
    const key = monday.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

/**
 * High-level: produce a complete analysis snapshot.
 */
export async function analyzeRepo(
  owner: string,
  repo: string
): Promise<AnalysisSnapshot> {
  const [repoMeta, contributors, languages, recentCommits] = await Promise.all([
    fetchRepoMeta(owner, repo),
    fetchContributors(owner, repo),
    fetchLanguages(owner, repo),
    fetchRecentCommits(owner, repo, 3),
  ]);

  // For hotspots, sample the most recent 80 commits (balance of cost vs signal).
  const hotspotShas = recentCommits.slice(0, 80).map((c) => c.sha);
  const perCommitFiles = await fetchCommitFileChanges(owner, repo, hotspotShas);
  const allHotspots = computeHotspots(perCommitFiles);
  const hotspots = allHotspots.slice(0, 120); // top 120 files is plenty for visuals
  const allowedFiles = new Set(hotspots.map((h) => h.path));
  const coChange = computeCoChange(perCommitFiles, allowedFiles);

  const commitActivity = computeCommitActivity(recentCommits);

  // Rate limit snapshot (useful for UI)
  let rateLimitInfo: AnalysisSnapshot["rateLimitInfo"];
  try {
    const { data } = await octokit.rest.rateLimit.get();
    rateLimitInfo = {
      limit: data.resources.core.limit,
      remaining: data.resources.core.remaining,
      reset: new Date(data.resources.core.reset * 1000).toISOString(),
    };
  } catch {
    /* ignore */
  }

  return {
    fetchedAt: new Date().toISOString(),
    repo: repoMeta,
    contributors,
    languages,
    recentCommits,
    hotspots,
    coChange,
    commitActivity,
    rateLimitInfo,
  };
}
