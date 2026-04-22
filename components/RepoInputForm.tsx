"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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
const ESTIMATED_MS = 22_000; // total estimate; progress bar stalls at 92% after this

export function RepoInputForm() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [stageIdx, setStageIdx] = useState(0);
  const [progress, setProgress] = useState(0); // 0..1
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
      // Progress ramps to 92%; real response takes it to 100%
      const ratio = Math.min(0.92, elapsed / ESTIMATED_MS);
      setProgress(ratio);

      // Pick the stage whose cumulative weight covers the elapsed fraction
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
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Something went wrong");
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

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://github.com/owner/repo"
          disabled={pending}
          className="w-full h-14 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 pr-32 text-base placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="absolute right-2 top-2 bottom-2 px-5 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-medium text-sm hover:opacity-90 transition disabled:opacity-40"
        >
          {pending ? "Analyzing…" : "Analyze"}
        </button>
      </div>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 px-2">{error}</p>
      )}
      {pending && (
        <div className="flex flex-col gap-2 mt-1 px-1">
          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0"
                aria-hidden
              />
              <span className="text-zinc-700 dark:text-zinc-300 font-medium truncate">
                {STAGES[stageIdx].label}…
              </span>
            </div>
            <span className="text-zinc-500 tabular-nums shrink-0">
              {Math.round(progress * 100)}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-sky-500 to-violet-500 transition-[width] duration-200 ease-linear"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <ol className="flex flex-wrap gap-1.5 text-[10px] text-zinc-400 font-mono">
            {STAGES.map((s, i) => (
              <li
                key={s.label}
                className={`px-2 py-0.5 rounded-full border ${
                  i < stageIdx
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : i === stageIdx
                    ? "border-zinc-400 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                {i < stageIdx ? "✓" : i === stageIdx ? "●" : "○"} {s.label}
              </li>
            ))}
          </ol>
        </div>
      )}
    </form>
  );
}
