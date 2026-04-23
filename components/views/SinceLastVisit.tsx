// Slim ribbon summarizing what changed since the previous snapshot.
// Replaces the large card version — same data, much less vertical real estate.

import type { SnapshotDiff } from "@/lib/diff";
import { TOK } from "@/lib/theme";

function formatRel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = 60_000,
    hr = 60 * min,
    day = 24 * hr;
  if (diff < hr) return `${Math.floor(diff / min)}m`;
  if (diff < day) return `${Math.floor(diff / hr)}h ${Math.floor((diff % hr) / min)}m`;
  const days = Math.floor(diff / day);
  return days < 30 ? `${days}d` : new Date(iso).toLocaleDateString();
}

function Delta({ value, label }: { value: number; label: string }) {
  if (value === 0) return null;
  const positive = value > 0;
  return (
    <span className="inline-flex items-center gap-0.5">
      <span
        style={{
          color: positive ? TOK.accent : TOK.rose,
          fontWeight: 600,
        }}
      >
        {positive ? "+" : ""}
        {value}
      </span>
      <span style={{ color: TOK.textSecondary }}>{label}</span>
    </span>
  );
}

export function SinceLastVisit({ diff }: { diff: SnapshotDiff }) {
  const hasAnyChange =
    diff.newCommits !== 0 ||
    diff.starsDelta !== 0 ||
    diff.forksDelta !== 0 ||
    diff.openIssuesDelta !== 0 ||
    diff.newContributors.length > 0 ||
    diff.newHotspots.length > 0 ||
    diff.risingHotspots.length > 0;

  if (!hasAnyChange) {
    return (
      <div
        className="rounded-lg px-4 py-3 flex items-center gap-3 text-sm"
        style={{
          background: TOK.surface,
          border: `1px solid ${TOK.border}`,
          color: TOK.textSecondary,
        }}
      >
        <span
          className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${TOK.border}`,
            color: TOK.textMuted,
          }}
        >
          ⟳
        </span>
        <span>Nothing new since your last visit.</span>
        <span className="ml-auto text-xs" style={{ color: TOK.textMuted }}>
          {formatRel(diff.from)} ago
        </span>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg p-4 flex items-center gap-4"
      style={{
        background: `linear-gradient(90deg, ${TOK.accentSoft} 0%, transparent 60%)`,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <div
        className="h-8 w-8 rounded-lg flex items-center justify-center text-sm shrink-0"
        style={{
          background: TOK.accentSoft,
          color: TOK.accent,
          border: `1px solid ${TOK.accent}44`,
        }}
      >
        ⟳
      </div>
      <div className="flex-1 min-w-0">
        <div
          className="text-sm font-medium"
          style={{ color: TOK.textPrimary }}
        >
          Since your last visit
        </div>
        <div
          className="text-xs mt-0.5 flex items-center flex-wrap gap-x-3 gap-y-1"
          style={{ color: TOK.textSecondary }}
        >
          <Delta value={diff.newCommits} label="commits" />
          <Delta value={diff.starsDelta} label="stars" />
          <Delta value={diff.forksDelta} label="forks" />
          <Delta value={diff.openIssuesDelta} label="open issues" />
          {diff.newContributors.length > 0 && (
            <span>
              <span style={{ color: TOK.accent, fontWeight: 600 }}>
                {diff.newContributors.length} new
              </span>{" "}
              contributor{diff.newContributors.length === 1 ? "" : "s"}
            </span>
          )}
          {diff.newHotspots.length > 0 && (
            <span>
              <span style={{ color: TOK.accent, fontWeight: 600 }}>
                {diff.newHotspots.length} new
              </span>{" "}
              hotspot{diff.newHotspots.length === 1 ? "" : "s"}:{" "}
              <span className="font-mono">
                {diff.newHotspots
                  .slice(0, 2)
                  .map((p) => p.split("/").pop())
                  .join(", ")}
              </span>
            </span>
          )}
        </div>
      </div>
      <div
        className="text-xs font-mono shrink-0"
        style={{ color: TOK.textMuted }}
      >
        {formatRel(diff.from)} ago
      </div>
    </div>
  );
}
