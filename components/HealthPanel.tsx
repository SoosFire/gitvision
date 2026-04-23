"use client";

// Three-column health verdict: what works, where to dig deeper, open questions.
// Evidence is visible by default (no more hidden <details>) — each column
// shows the narrative prose on top and a signal bullet list below it.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw, Stethoscope } from "lucide-react";
import type { AnalysisSnapshot, HealthSignal } from "@/lib/types";
import { TOK } from "@/lib/theme";

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
      className="flex flex-col gap-3"
      aria-label="Repository health check"
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">
            Health check
          </h2>
          {analysis && (
            <span
              className="text-[10px] font-mono"
              style={{ color: TOK.textMuted }}
            >
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
          className="text-xs transition disabled:opacity-40 flex items-center gap-1.5"
          style={{ color: analysis ? TOK.textSecondary : TOK.accent }}
        >
          {pending ? (
            <>
              <span
                className="h-1.5 w-1.5 rounded-full animate-pulse"
                style={{ background: TOK.accent }}
              />
              <span>Analyzing…</span>
            </>
          ) : analysis ? (
            <>
              <RotateCw size={12} />
              <span>Regenerate</span>
            </>
          ) : (
            <>
              <Stethoscope size={12} />
              <span>Run health check</span>
            </>
          )}
        </button>
      </div>

      {!analysis && !pending && (
        <div
          className="rounded-xl p-5 text-sm"
          style={{
            background: TOK.surface,
            border: `1px solid ${TOK.border}`,
            color: TOK.textSecondary,
          }}
        >
          Computes concrete signals — bus factor, PR backlog, test coverage,
          module coupling, freshness — and asks Claude to translate them into
          a plain-English verdict you can act on.
        </div>
      )}

      {analysis && (
        <div className="grid md:grid-cols-3 gap-3">
          <HealthColumn
            label="What works"
            accent={TOK.accent}
            narrative={analysis.narrative.working}
            signals={analysis.signals.working}
          />
          <HealthColumn
            label="Where to dig deeper"
            accent={TOK.amber}
            narrative={analysis.narrative.needsWork}
            signals={analysis.signals.needsWork}
          />
          <HealthColumn
            label="Open questions"
            accent={TOK.textSecondary}
            narrative={analysis.narrative.questions}
            signals={analysis.signals.questions}
          />
        </div>
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

function HealthColumn({
  label,
  accent,
  narrative,
  signals,
}: {
  label: string;
  accent: string;
  narrative: string;
  signals: HealthSignal[];
}) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-1 w-5 rounded-full"
          style={{ background: accent }}
        />
        <h3
          className="text-[11px] font-semibold uppercase tracking-[0.15em]"
          style={{ color: accent }}
        >
          {label}
        </h3>
      </div>

      <p
        className="text-[13px] leading-relaxed"
        style={{ color: TOK.textPrimary }}
      >
        {narrative || "—"}
      </p>

      {signals.length > 0 && (
        <div
          className="flex flex-col gap-1.5 pt-3 border-t"
          style={{ borderColor: TOK.border }}
        >
          {signals.map((s) => (
            <div key={s.id} className="flex items-start gap-2">
              <span
                className="h-1 w-1 rounded-full shrink-0 mt-1.5"
                style={{ background: accent }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className="text-xs font-medium"
                    style={{ color: TOK.textPrimary }}
                  >
                    {s.title}
                  </span>
                  {s.severity && (
                    <span
                      className="text-[9px] uppercase tracking-wider px-1 py-px rounded"
                      style={{
                        background:
                          s.severity === "high" ? TOK.roseSoft : TOK.amberSoft,
                        color: s.severity === "high" ? TOK.rose : TOK.amber,
                      }}
                    >
                      {s.severity}
                    </span>
                  )}
                </div>
                <div
                  className="text-[11px] mt-0.5"
                  style={{ color: TOK.textMuted }}
                >
                  {s.detail}
                </div>
                {s.evidence.paths && s.evidence.paths.length > 0 && (
                  <div
                    className="font-mono text-[10px] mt-1 break-all"
                    style={{ color: TOK.textMuted }}
                  >
                    {s.evidence.paths.slice(0, 3).join(" · ")}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
