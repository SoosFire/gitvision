"use client";

// Claude-generated repo summary. Lazy — nothing happens until the user clicks
// "Generate". The server stores the result on the latest snapshot so next load
// renders it immediately (no re-spend).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AnalysisSnapshot } from "@/lib/types";

interface Props {
  sessionId: string;
  snapshot: AnalysisSnapshot;
}

export function AiSummaryPanel({ sessionId, snapshot }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const summary = snapshot.aiSummary;

  function generate() {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/sessions/${sessionId}/summary`, {
          method: "POST",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (res.status === 501) {
            setError(
              "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server."
            );
          } else {
            setError(body.error ?? `Request failed (${res.status})`);
          }
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    });
  }

  return (
    <section
      className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900 flex flex-col gap-3"
      aria-label="AI repository summary"
    >
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-violet-500"
            aria-hidden
          />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            AI summary
          </h2>
          {summary && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500 font-mono">
              · {summary.model} ·{" "}
              {new Date(summary.generatedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          )}
        </div>
        <button
          onClick={generate}
          disabled={pending}
          className="h-8 px-3 rounded-md text-xs font-medium border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition disabled:opacity-40"
        >
          {pending ? (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Thinking…
            </span>
          ) : summary ? (
            "🔁 Regenerate"
          ) : (
            "✨ Generate summary"
          )}
        </button>
      </header>

      {summary ? (
        <div className="flex flex-col gap-3">
          <div className="text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap">
            {summary.text}
          </div>
          {summary.usage && (
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
              {summary.usage.inputTokens.toLocaleString()} in ·{" "}
              {summary.usage.outputTokens.toLocaleString()} out
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          Claude can read this snapshot and write a short profile — what the
          project does, how it&apos;s built, and what&apos;s happening lately.
          Stored on the snapshot, so it&apos;s only generated once per
          refresh.
        </p>
      )}

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 rounded-md border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-3">
          {error}
        </div>
      )}
    </section>
  );
}
