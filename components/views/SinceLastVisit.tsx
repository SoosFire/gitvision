import type { SnapshotDiff } from "@/lib/diff";

function Delta({ value, label }: { value: number; label: string }) {
  const isPositive = value > 0;
  const isZero = value === 0;
  return (
    <div className="flex items-center gap-1 text-sm">
      <span
        className={
          isZero
            ? "text-zinc-500"
            : isPositive
            ? "text-emerald-600"
            : "text-red-600"
        }
      >
        {isZero ? "±0" : `${isPositive ? "+" : ""}${value}`}
      </span>
      <span className="text-zinc-500">{label}</span>
    </div>
  );
}

export function SinceLastVisit({ diff }: { diff: SnapshotDiff }) {
  const from = new Date(diff.from).toLocaleString();
  const to = new Date(diff.to).toLocaleString();
  return (
    <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          Since your last visit
        </h3>
        <span className="text-[11px] text-zinc-500 tabular-nums">
          {from} → {to}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <Delta value={diff.newCommits} label="new commits" />
        <Delta value={diff.starsDelta} label="stars" />
        <Delta value={diff.forksDelta} label="forks" />
        <Delta value={diff.openIssuesDelta} label="open issues" />
      </div>
      {diff.newContributors.length > 0 && (
        <p className="mt-2 text-sm">
          <span className="font-medium">New contributors:</span>{" "}
          <span className="text-zinc-600 dark:text-zinc-400">
            {diff.newContributors.slice(0, 5).join(", ")}
            {diff.newContributors.length > 5
              ? ` +${diff.newContributors.length - 5} more`
              : ""}
          </span>
        </p>
      )}
      {diff.newHotspots.length > 0 && (
        <p className="mt-1 text-sm">
          <span className="font-medium">New hotspots:</span>{" "}
          <span className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
            {diff.newHotspots.slice(0, 3).join(" · ")}
          </span>
        </p>
      )}
    </div>
  );
}
