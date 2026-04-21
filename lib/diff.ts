// "Since last visit" — compute the delta between two snapshots for a given session.

import type { AnalysisSnapshot } from "./types";

export interface SnapshotDiff {
  from: string; // ISO fetchedAt of previous snapshot
  to: string; // ISO fetchedAt of current snapshot
  newCommits: number;
  starsDelta: number;
  forksDelta: number;
  openIssuesDelta: number;
  newContributors: string[]; // logins
  newHotspots: string[]; // file paths that are new in top 20
  risingHotspots: { path: string; fromScore: number; toScore: number }[];
}

export function diffSnapshots(prev: AnalysisSnapshot, curr: AnalysisSnapshot): SnapshotDiff {
  const prevShas = new Set(prev.recentCommits.map((c) => c.sha));
  const newCommits = curr.recentCommits.filter((c) => !prevShas.has(c.sha)).length;

  const prevContribLogins = new Set(prev.contributors.map((c) => c.login));
  const newContributors = curr.contributors
    .filter((c) => !prevContribLogins.has(c.login))
    .map((c) => c.login);

  const prevTop = new Map(prev.hotspots.slice(0, 20).map((h) => [h.path, h.score]));
  const currTop = curr.hotspots.slice(0, 20);
  const newHotspots = currTop.filter((h) => !prevTop.has(h.path)).map((h) => h.path);
  const risingHotspots = currTop
    .filter((h) => prevTop.has(h.path) && h.score > prevTop.get(h.path)!)
    .map((h) => ({ path: h.path, fromScore: prevTop.get(h.path)!, toScore: h.score }));

  return {
    from: prev.fetchedAt,
    to: curr.fetchedAt,
    newCommits,
    starsDelta: curr.repo.stars - prev.repo.stars,
    forksDelta: curr.repo.forks - prev.repo.forks,
    openIssuesDelta: curr.repo.openIssues - prev.repo.openIssues,
    newContributors,
    newHotspots,
    risingHotspots,
  };
}
