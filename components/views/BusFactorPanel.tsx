// Approximate bus factor per top-level folder based on unique-authors in the
// hotspot sample. This is an approximation from recent commits — not full git
// blame. The "approx" pill in the header sets the expectation.

import type { FileHotspot } from "@/lib/types";
import { TOK } from "@/lib/theme";

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
    <div
      className="rounded-xl p-4"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3
            className="text-[11px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: TOK.textSecondary }}
          >
            Knowledge concentration
          </h3>
          <p className="text-xs mt-0.5" style={{ color: TOK.textMuted }}>
            Folders with fewer authors = higher bus-factor risk
          </p>
        </div>
        <span
          className="text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5"
          style={{
            background: "rgba(255,255,255,0.04)",
            color: TOK.textMuted,
            border: `1px solid ${TOK.border}`,
          }}
        >
          approx
        </span>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {rows.length === 0 && (
          <li className="text-sm py-2" style={{ color: TOK.textMuted }}>
            Not enough data yet.
          </li>
        )}
        {rows.map((r) => {
          const risk = r.authors <= 1 ? "high" : r.authors <= 2 ? "medium" : "low";
          const riskStyles =
            risk === "high"
              ? { color: TOK.rose, bg: TOK.roseSoft }
              : risk === "medium"
              ? { color: TOK.amber, bg: TOK.amberSoft }
              : { color: TOK.accent, bg: TOK.accentSoft };
          return (
            <li key={r.folder} className="flex items-center gap-3">
              <span
                className="font-mono text-sm truncate flex-1"
                style={{ color: TOK.textPrimary }}
              >
                {r.folder}/
              </span>
              <span
                className="text-xs tabular-nums"
                style={{ color: TOK.textMuted }}
              >
                {r.churn} changes
              </span>
              <span
                className="text-[11px] rounded px-1.5 py-0.5 font-medium"
                style={{
                  color: riskStyles.color,
                  background: riskStyles.bg,
                }}
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
