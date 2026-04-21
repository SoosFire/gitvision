import type { LanguageBreakdown } from "@/lib/types";

// Deterministic color per language name
function colorFor(lang: string): string {
  let hash = 0;
  for (let i = 0; i < lang.length; i++) hash = (hash * 31 + lang.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 65% 55%)`;
}

export function LanguageBar({ languages }: { languages: LanguageBreakdown }) {
  const entries = Object.entries(languages).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-sm text-zinc-500">
        No language data available.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <h3 className="text-sm font-semibold mb-3">Language mix</h3>
      <div className="flex h-3 rounded-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
        {entries.map(([lang, bytes]) => (
          <div
            key={lang}
            style={{
              width: `${(bytes / total) * 100}%`,
              background: colorFor(lang),
            }}
            title={`${lang}: ${((bytes / total) * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
        {entries.slice(0, 8).map(([lang, bytes]) => (
          <li key={lang} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: colorFor(lang) }}
            />
            <span className="truncate">{lang}</span>
            <span className="text-zinc-500 ml-auto tabular-nums">
              {((bytes / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
