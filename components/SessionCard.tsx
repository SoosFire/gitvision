import type { SessionSummary } from "@/lib/types";

function formatRelative(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const min = 60_000, hr = 60 * min, day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function SessionCard({ session }: { session: SessionSummary }) {
  return (
    <div className="group rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 hover:border-zinc-300 dark:hover:border-zinc-700 transition cursor-pointer">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium truncate">{session.name}</h3>
          <p className="text-xs text-zinc-500 font-mono truncate">
            {session.repoFullName}
          </p>
        </div>
        <span className="shrink-0 text-xs text-zinc-500 bg-zinc-100 dark:bg-zinc-800 rounded px-2 py-0.5">
          {session.snapshotCount} snap{session.snapshotCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
        <span>Updated {formatRelative(session.updatedAt)}</span>
      </div>
    </div>
  );
}
