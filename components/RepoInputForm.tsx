"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TOK } from "@/lib/theme";

// Stage labels + rough durations (ms) used to drive the indeterminate loading UI.
// Real server progress isn't streamed (yet) — we cycle through these as a UX
// scaffold so users don't stare at a blank button for 30 seconds.
const STAGES = [
  { label: "Henter repo-metadata", weight: 2 },
  { label: "Henter commits og contributors", weight: 4 },
  { label: "Analyserer filændringer", weight: 6 },
  { label: "Bygger dependency-graf", weight: 10 },
  { label: "Gemmer session", weight: 2 },
];
const TOTAL_WEIGHT = STAGES.reduce((a, s) => a + s.weight, 0);
const ESTIMATED_MS = 22_000;

/** Demo-row entry. The language label shows up muted next to the repo path
 *  so users can see at a glance which plugin (JS/TS, Go, Python, Java, …)
 *  the row exercises. Plain string entries are still accepted for callers
 *  that don't care about the label. */
export type DemoRepo = string | { repo: string; lang: string };

export function RepoInputForm({ demoRepos = [] }: { demoRepos?: DemoRepo[] }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [stageIdx, setStageIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const router = useRouter();
  const startTime = useRef<number | null>(null);

  useEffect(() => {
    if (!pending) {
      startTime.current = null;
      setStageIdx(0);
      setProgress(0);
      return;
    }
    startTime.current = performance.now();
    const tick = () => {
      if (!startTime.current) return;
      const elapsed = performance.now() - startTime.current;
      const ratio = Math.min(0.92, elapsed / ESTIMATED_MS);
      setProgress(ratio);

      let cumul = 0;
      let idx = 0;
      const target = ratio * TOTAL_WEIGHT;
      for (let i = 0; i < STAGES.length; i++) {
        cumul += STAGES[i].weight;
        if (target <= cumul) {
          idx = i;
          break;
        }
        idx = i;
      }
      setStageIdx(idx);
    };
    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [pending]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!value.trim()) return;

    startTransition(async () => {
      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoUrl: value.trim() }),
        });
        // Railway returns its own JSON shape for upstream-timeout errors —
        // {"status":"error","code":502,"message":"Application failed to respond"}.
        // Try to parse JSON, but fall back to the raw text if the response
        // isn't JSON (rare — Railway's 502 page is JSON).
        let data: { error?: string; message?: string; session?: { id: string } } | null = null;
        try {
          data = await res.json();
        } catch {
          // Response wasn't JSON. Surface a generic shape.
        }
        if (!res.ok) {
          setError(explainServerError(res.status, data));
          return;
        }
        if (!data?.session) {
          setError("Server returned no session — try again or pick another repo.");
          return;
        }
        setProgress(1);
        router.push(`/session/${data.session.id}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    });
  }

  /** Translate raw server / proxy errors into something a human can act on.
   *  Railway returns 502 + "Application failed to respond" when our backend
   *  exceeds its request timeout — common for very large repos. */
  function explainServerError(
    status: number,
    data: { error?: string; message?: string } | null
  ): string {
    const raw = data?.error || data?.message || "";
    if (
      status === 502 ||
      status === 504 ||
      /failed to respond|timed out|gateway/i.test(raw)
    ) {
      return `Server timed out (HTTP ${status}). This usually means the repo is too large for the current pipeline. Try a smaller repo or a specific subdirectory. Server message: "${raw || "no detail"}"`;
    }
    if (raw) return `${raw} (HTTP ${status})`;
    return `Server error (HTTP ${status})`;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div
        className="flex items-center rounded-lg"
        style={{
          background: TOK.surface,
          border: `1px solid ${TOK.border}`,
        }}
      >
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="github.com/owner/repo"
          disabled={pending}
          className="flex-1 bg-transparent h-12 px-4 text-base focus:outline-none disabled:opacity-50"
          style={{ color: TOK.textPrimary }}
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="h-10 mr-1 px-4 rounded-md text-sm font-medium transition disabled:opacity-40"
          style={{
            background: TOK.accent,
            color: TOK.accentOn,
          }}
        >
          {pending ? "Analyzing…" : "Analyze →"}
        </button>
      </div>

      {!pending && demoRepos.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs" style={{ color: TOK.textMuted }}>
            Try with:
          </span>
          {demoRepos.map((entry) => {
            const item =
              typeof entry === "string" ? { repo: entry, lang: "" } : entry;
            return (
              <button
                key={item.repo}
                type="button"
                onClick={() => setValue(item.repo)}
                className="text-xs font-mono px-2 py-1 rounded-md transition hover:scale-[1.02] flex items-center gap-1.5"
                style={{
                  background: TOK.surface,
                  border: `1px solid ${TOK.border}`,
                  color: TOK.textSecondary,
                }}
                title={
                  item.lang ? `${item.repo} — ${item.lang}` : item.repo
                }
              >
                <span>{item.repo}</span>
                {item.lang && (
                  <span
                    className="text-[10px]"
                    style={{ color: TOK.textMuted }}
                  >
                    · {item.lang}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <p className="text-sm px-1" style={{ color: TOK.rose }}>
          {error}
        </p>
      )}

      {pending && (
        <div className="flex flex-col gap-2 mt-1 px-1">
          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="h-2 w-2 rounded-full animate-pulse shrink-0"
                style={{ background: TOK.accent }}
                aria-hidden
              />
              <span
                className="font-medium truncate"
                style={{ color: TOK.textPrimary }}
              >
                {STAGES[stageIdx].label}…
              </span>
            </div>
            <span
              className="tabular-nums shrink-0"
              style={{ color: TOK.textSecondary }}
            >
              {Math.round(progress * 100)}%
            </span>
          </div>
          <div
            className="h-1.5 w-full rounded-full overflow-hidden"
            style={{ background: TOK.surface }}
          >
            <div
              className="h-full transition-[width] duration-200 ease-linear"
              style={{
                width: `${progress * 100}%`,
                background: `linear-gradient(90deg, ${TOK.accent}, #34d399)`,
              }}
            />
          </div>
          <ol className="flex flex-wrap gap-1.5 text-[10px] font-mono">
            {STAGES.map((s, i) => {
              const done = i < stageIdx;
              const active = i === stageIdx;
              return (
                <li
                  key={s.label}
                  className="px-2 py-0.5 rounded-full border"
                  style={{
                    borderColor: done
                      ? `${TOK.accent}66`
                      : active
                      ? TOK.border
                      : "rgba(255,255,255,0.05)",
                    background: done
                      ? TOK.accentSoft
                      : active
                      ? TOK.surface
                      : "transparent",
                    color: done
                      ? TOK.accent
                      : active
                      ? TOK.textPrimary
                      : TOK.textMuted,
                  }}
                >
                  {done ? "✓" : active ? "●" : "○"} {s.label}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </form>
  );
}
