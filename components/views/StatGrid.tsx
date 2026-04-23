// Compact inline stat pills — replaces the old 8-card grid.
// Prioritizes fast-scan readability over table-like exhaustiveness.

import type { AnalysisSnapshot } from "@/lib/types";
import { TOK } from "@/lib/theme";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function ageLabel(createdAt: string): string {
  const years = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24 * 365);
  if (years < 1) {
    const months = Math.max(1, Math.round(years * 12));
    return `${months}m`;
  }
  const y = Math.floor(years);
  const m = Math.round((years % 1) * 12);
  return m > 0 ? `${y}y ${m}m` : `${y}y`;
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span style={{ color: TOK.textMuted }}>{label}</span>
      <span style={{ color: TOK.textPrimary, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

export function StatGrid({ snap }: { snap: AnalysisSnapshot }) {
  const recentCommitRate =
    snap.commitActivity.length > 0
      ? snap.commitActivity.reduce((s, d) => s + d.count, 0) /
        Math.max(1, snap.commitActivity.length)
      : 0;

  return (
    <div
      className="flex items-center flex-wrap gap-x-6 gap-y-2 text-xs"
      style={{ color: TOK.textSecondary }}
    >
      <MetaPill label="★" value={formatNumber(snap.repo.stars)} />
      <MetaPill label="Forks" value={formatNumber(snap.repo.forks)} />
      <MetaPill label="Issues" value={formatNumber(snap.repo.openIssues)} />
      <MetaPill
        label="License"
        value={snap.repo.license ?? "none"}
      />
      <MetaPill
        label="Primary"
        value={snap.repo.language ?? "—"}
      />
      <MetaPill label="Age" value={ageLabel(snap.repo.createdAt)} />
      <MetaPill label="Contributors" value={snap.contributors.length.toString()} />
      <MetaPill
        label="Velocity"
        value={`${recentCommitRate.toFixed(1)}/wk`}
      />
      <MetaPill label="Branch" value={snap.repo.defaultBranch} />
    </div>
  );
}
