"use client";

// Claude-generated repo briefing. Lazy — nothing happens until the user clicks
// "Run". The server stores the result on the latest snapshot so subsequent
// loads render instantly (no re-spend).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw, Sparkles } from "lucide-react";
import type { AnalysisSnapshot } from "@/lib/types";
import { TOK } from "@/lib/theme";

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

  const usd = summary?.usage
    ? ((summary.usage.inputTokens * 3 + summary.usage.outputTokens * 15) / 1_000_000).toFixed(4)
    : null;

  return (
    <section
      className="flex flex-col gap-3"
      aria-label="AI repository briefing"
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">
            AI briefing
          </h2>
          {summary && (
            <span
              className="text-[10px] font-mono"
              style={{ color: TOK.textMuted }}
            >
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
          className="text-xs transition disabled:opacity-40 flex items-center gap-1.5"
          style={{ color: summary ? TOK.textSecondary : TOK.accent }}
        >
          {pending ? (
            <>
              <span
                className="h-1.5 w-1.5 rounded-full animate-pulse"
                style={{ background: TOK.accent }}
              />
              <span>Thinking…</span>
            </>
          ) : summary ? (
            <>
              <RotateCw size={12} />
              <span>Regenerate</span>
            </>
          ) : (
            <>
              <Sparkles size={12} />
              <span>Run briefing</span>
            </>
          )}
        </button>
      </div>

      {!summary && !pending && (
        <div
          className="rounded-xl p-5 text-sm"
          style={{
            background: TOK.surface,
            border: `1px solid ${TOK.border}`,
            color: TOK.textSecondary,
          }}
        >
          Claude reads this snapshot and writes a short profile — what the
          project is, how it&apos;s built, and what&apos;s happening lately.
          Cached on the snapshot, so it&apos;s only generated once per refresh.
        </div>
      )}

      {summary && (
        <article
          className="rounded-xl p-6 flex flex-col gap-3"
          style={{
            background: TOK.surface,
            border: `1px solid ${TOK.border}`,
          }}
        >
          <div
            className="text-[15px] leading-relaxed whitespace-pre-wrap"
            style={{ color: TOK.textPrimary }}
          >
            {summary.text}
          </div>
          {summary.usage && (
            <div
              className="mt-2 pt-3 border-t flex items-center justify-between text-[11px] font-mono"
              style={{ borderColor: TOK.border, color: TOK.textMuted }}
            >
              <span>
                {summary.usage.inputTokens.toLocaleString()} tokens in ·{" "}
                {summary.usage.outputTokens.toLocaleString()} out
              </span>
              {usd && <span>~${usd}</span>}
            </div>
          )}
        </article>
      )}

      {error && (
        <div
          className="text-sm rounded-md p-3"
          style={{
            color: TOK.rose,
            background: TOK.roseSoft,
            border: `1px solid ${TOK.rose}44`,
          }}
        >
          {error}
        </div>
      )}
    </section>
  );
}
