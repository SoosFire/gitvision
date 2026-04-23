import type { AnalysisSnapshot } from "@/lib/types";
import { TOK } from "@/lib/theme";

export function CommitActivity({ snap }: { snap: AnalysisSnapshot }) {
  const data = snap.commitActivity;
  if (data.length === 0) {
    return null;
  }
  const max = Math.max(...data.map((d) => d.count));

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <h3
        className="text-[11px] font-semibold uppercase tracking-[0.18em] mb-3 flex items-baseline gap-2"
        style={{ color: TOK.textSecondary }}
      >
        Weekly commit activity
        <span
          className="text-[10px] normal-case tracking-normal font-normal"
          style={{ color: TOK.textMuted }}
        >
          · from sampled commits
        </span>
      </h3>
      <div className="flex items-end gap-0.5 h-24">
        {data.map((d) => (
          <div
            key={d.week}
            title={`${d.week}: ${d.count} commits`}
            className="flex-1 min-w-[4px] rounded-sm transition-colors"
            style={{
              height: `${Math.max(2, (d.count / max) * 100)}%`,
              background:
                d.count === 0
                  ? "rgba(255,255,255,0.04)"
                  : TOK.accent,
              opacity: d.count === 0 ? 1 : 0.75,
            }}
          />
        ))}
      </div>
      <div
        className="mt-2 flex justify-between text-[10px] font-mono"
        style={{ color: TOK.textMuted }}
      >
        <span>{data[0].week}</span>
        <span>{data[data.length - 1].week}</span>
      </div>
    </div>
  );
}
