import type { AnalysisSnapshot } from "@/lib/types";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="group relative rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 overflow-hidden">
      {accent && (
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: accent }}
        />
      )}
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      {hint && (
        <div className="text-xs text-zinc-500 mt-0.5 truncate" title={hint}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function StatGrid({ snap }: { snap: AnalysisSnapshot }) {
  const ageYears = (Date.now() - new Date(snap.repo.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 365);
  const recentCommitRate =
    snap.commitActivity.length > 0
      ? snap.commitActivity.reduce((s, d) => s + d.count, 0) /
        Math.max(1, snap.commitActivity.length)
      : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Stat
        label="Stars"
        value={formatNumber(snap.repo.stars)}
        accent="linear-gradient(90deg, transparent, #fbbf24, transparent)"
      />
      <Stat
        label="Forks"
        value={formatNumber(snap.repo.forks)}
        accent="linear-gradient(90deg, transparent, #60a5fa, transparent)"
      />
      <Stat
        label="Open issues"
        value={formatNumber(snap.repo.openIssues)}
        accent="linear-gradient(90deg, transparent, #f87171, transparent)"
      />
      <Stat
        label="Contributors"
        value={snap.contributors.length}
        hint={`top ${snap.contributors.length >= 100 ? "100" : "all"} shown`}
        accent="linear-gradient(90deg, transparent, #10b981, transparent)"
      />
      <Stat
        label="Age"
        value={`${Math.floor(ageYears)}y ${Math.round((ageYears % 1) * 12)}m`}
        hint={`since ${new Date(snap.repo.createdAt).toLocaleDateString()}`}
      />
      <Stat
        label="Recent velocity"
        value={recentCommitRate.toFixed(1)}
        hint="commits/week (sampled)"
      />
      <Stat
        label="Primary language"
        value={snap.repo.language ?? "—"}
        hint={snap.repo.license ? `License: ${snap.repo.license}` : undefined}
      />
      <Stat
        label="Default branch"
        value={snap.repo.defaultBranch}
        hint={`${snap.recentCommits.length} commits sampled`}
      />
    </div>
  );
}
