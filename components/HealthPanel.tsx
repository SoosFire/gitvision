"use client";

// Three-column health verdict: what works, where to dig deeper, open questions.
// Rule-based signals (lib/signals.ts) drive the evidence; Claude writes the
// per-column prose (lib/healthAnalysis.ts). Stored on the snapshot — lazy
// generation via the "Generate" button.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AnalysisSnapshot, HealthSignal } from "@/lib/types";

interface Props {
  sessionId: string;
  snapshot: AnalysisSnapshot;
}

export function HealthPanel({ sessionId, snapshot }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const analysis = snapshot.healthAnalysis;

  function generate() {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/sessions/${sessionId}/health`, {
          method: "POST",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (res.status === 501) {
            setError(
              "ANTHROPIC_API_KEY is not set. Add it to .env.local (or Railway env) and redeploy."
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
      className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900 flex flex-col gap-4"
      aria-label="Repository health check"
    >
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-6 rounded-full bg-gradient-to-r from-emerald-500 via-amber-500 to-zinc-400"
            aria-hidden
          />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Health check
          </h2>
          {analysis && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500 font-mono">
              · {analysis.model} ·{" "}
              {new Date(analysis.generatedAt).toLocaleDateString(undefined, {
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
              Analyzing…
            </span>
          ) : analysis ? (
            "🔁 Regenerate"
          ) : (
            "🩺 Run health check"
          )}
        </button>
      </header>

      {!analysis && !pending && (
        <p className="text-sm text-zinc-500">
          Computes concrete signals — bus factor, PR backlog, test coverage,
          module coupling, freshness — and asks Claude to translate them into a
          plain-English verdict you can act on.
        </p>
      )}

      {analysis && (
        <div className="grid md:grid-cols-3 gap-3">
          <Column
            title="What works"
            accent="emerald"
            narrative={analysis.narrative.working}
            signals={analysis.signals.working}
          />
          <Column
            title="Where to dig deeper"
            accent="amber"
            narrative={analysis.narrative.needsWork}
            signals={analysis.signals.needsWork}
          />
          <Column
            title="Open questions"
            accent="zinc"
            narrative={analysis.narrative.questions}
            signals={analysis.signals.questions}
          />
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 rounded-md border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-3">
          {error}
        </div>
      )}
    </section>
  );
}

function Column({
  title,
  accent,
  narrative,
  signals,
}: {
  title: string;
  accent: "emerald" | "amber" | "zinc";
  narrative: string;
  signals: HealthSignal[];
}) {
  const palette = {
    emerald: {
      bar: "bg-emerald-500",
      ring: "border-emerald-200 dark:border-emerald-900/50",
      bg: "bg-emerald-50/60 dark:bg-emerald-950/20",
      text: "text-emerald-700 dark:text-emerald-300",
    },
    amber: {
      bar: "bg-amber-500",
      ring: "border-amber-200 dark:border-amber-900/50",
      bg: "bg-amber-50/60 dark:bg-amber-950/20",
      text: "text-amber-700 dark:text-amber-300",
    },
    zinc: {
      bar: "bg-zinc-500",
      ring: "border-zinc-200 dark:border-zinc-800",
      bg: "bg-zinc-50/60 dark:bg-zinc-900/30",
      text: "text-zinc-700 dark:text-zinc-300",
    },
  }[accent];

  return (
    <div
      className={`rounded-lg border p-4 flex flex-col gap-3 ${palette.ring} ${palette.bg}`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-1 w-6 rounded-full ${palette.bar}`} />
        <h3
          className={`text-[11px] font-semibold uppercase tracking-wider ${palette.text}`}
        >
          {title}
        </h3>
      </div>
      <p className="text-[14px] leading-relaxed text-zinc-700 dark:text-zinc-200">
        {narrative || "—"}
      </p>
      {signals.length > 0 && (
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 select-none">
            Evidence · {signals.length} signal{signals.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 flex flex-col gap-2 pl-3 border-l-2 border-zinc-200 dark:border-zinc-800">
            {signals.map((s) => (
              <li key={s.id}>
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {s.title}
                  </span>
                  {s.severity && (
                    <span
                      className={`text-[9px] uppercase tracking-wider px-1 py-px rounded ${
                        s.severity === "high"
                          ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                          : s.severity === "medium"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      }`}
                    >
                      {s.severity}
                    </span>
                  )}
                </div>
                <div className="text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {s.detail}
                </div>
                {s.evidence.paths && s.evidence.paths.length > 0 && (
                  <div className="font-mono text-[10px] mt-1 text-zinc-500 break-all">
                    {s.evidence.paths.slice(0, 4).join(" · ")}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
