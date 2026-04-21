import type { AnalysisSnapshot } from "@/lib/types";

export function CommitActivity({ snap }: { snap: AnalysisSnapshot }) {
  const data = snap.commitActivity;
  if (data.length === 0) {
    return null;
  }
  const max = Math.max(...data.map((d) => d.count));

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <h3 className="text-sm font-semibold mb-3">
        Weekly commit activity{" "}
        <span className="text-xs text-zinc-500 font-normal">
          · from sampled commits
        </span>
      </h3>
      <div className="flex items-end gap-0.5 h-24">
        {data.map((d) => (
          <div
            key={d.week}
            title={`${d.week}: ${d.count} commits`}
            className="flex-1 min-w-[4px] bg-emerald-500/70 hover:bg-emerald-500 rounded-sm"
            style={{ height: `${(d.count / max) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-zinc-500">
        <span>{data[0].week}</span>
        <span>{data[data.length - 1].week}</span>
      </div>
    </div>
  );
}
