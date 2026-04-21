// Approximate bus factor per top-level folder based on unique-authors in the hotspot sample.
// NOTE: This is an approximation based on the last ~50 commits — not full git blame.
// We flag it in the UI so users know its scope.

import type { FileHotspot } from "@/lib/types";

export function BusFactorPanel({ hotspots }: { hotspots: FileHotspot[] }) {
  const byFolder = new Map<string, { churn: number; authors: number }>();
  for (const h of hotspots) {
    const folder = h.path.split("/")[0];
    const entry = byFolder.get(folder) ?? { churn: 0, authors: 0 };
    entry.churn += h.churn;
    // Approximation: use max authors seen per folder as a proxy.
    entry.authors = Math.max(entry.authors, h.authors);
    byFolder.set(folder, entry);
  }

  const rows = [...byFolder.entries()]
    .map(([folder, v]) => ({ folder, ...v }))
    .sort((a, b) => b.churn - a.churn)
    .slice(0, 10);

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Knowledge concentration</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Folders with fewer authors = higher bus-factor risk
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded px-1.5 py-0.5">
          approx
        </span>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {rows.length === 0 && (
          <li className="text-sm text-zinc-500 py-2">Not enough data yet.</li>
        )}
        {rows.map((r) => {
          const risk = r.authors <= 1 ? "high" : r.authors <= 2 ? "medium" : "low";
          const riskColor =
            risk === "high"
              ? "text-red-600 bg-red-50 dark:bg-red-950/40"
              : risk === "medium"
              ? "text-amber-600 bg-amber-50 dark:bg-amber-950/40"
              : "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40";
          return (
            <li key={r.folder} className="flex items-center gap-3">
              <span className="font-mono text-sm truncate flex-1">{r.folder}/</span>
              <span className="text-xs text-zinc-500 tabular-nums">
                {r.churn} changes
              </span>
              <span
                className={`text-[11px] rounded px-1.5 py-0.5 font-medium ${riskColor}`}
              >
                {r.authors} author{r.authors === 1 ? "" : "s"} · {risk}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
