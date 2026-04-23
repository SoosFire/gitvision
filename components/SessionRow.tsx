// Single row in the landing-page sessions list. Replaces the old SessionCard.
// Designed to sit inside a shared rounded container with hairline dividers.

import type { SessionSummary } from "@/lib/types";
import { TOK } from "@/lib/theme";

function formatRelative(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const min = 60_000,
    hr = 60 * min,
    day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function SessionRow({
  session,
  isLast,
}: {
  session: SessionSummary;
  isLast: boolean;
}) {
  return (
    <div
      className="flex items-center gap-4 px-5 py-4 transition hover:bg-white/[0.02]"
      style={{
        borderBottom: isLast ? "none" : `1px solid ${TOK.border}`,
      }}
    >
      <div className="flex-1 min-w-0">
        <div
          className="font-medium truncate"
          style={{ color: TOK.textPrimary }}
        >
          {session.name}
        </div>
        <div
          className="text-xs font-mono mt-0.5 truncate"
          style={{ color: TOK.textMuted }}
        >
          {session.repoFullName} · updated {formatRelative(session.updatedAt)}
        </div>
      </div>
      <div
        className="text-xs font-mono px-2 py-0.5 rounded shrink-0"
        style={{
          background: TOK.accentSoft,
          color: TOK.accent,
        }}
        title={`${session.snapshotCount} snapshot${
          session.snapshotCount === 1 ? "" : "s"
        }`}
      >
        {session.snapshotCount} snap{session.snapshotCount === 1 ? "" : "s"}
      </div>
      <span
        className="text-sm shrink-0"
        style={{ color: TOK.textMuted }}
        aria-hidden
      >
        →
      </span>
    </div>
  );
}
