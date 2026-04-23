import type { LanguageBreakdown } from "@/lib/types";
import { TOK } from "@/lib/theme";

// Deterministic color per language name. Slightly muted saturation to match
// the dark theme; pure hue-only was too candy.
function colorFor(lang: string): string {
  let hash = 0;
  for (let i = 0; i < lang.length; i++) hash = (hash * 31 + lang.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 55% 55%)`;
}

export function LanguageBar({ languages }: { languages: LanguageBreakdown }) {
  const entries = Object.entries(languages).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;

  const containerStyle = {
    background: TOK.surface,
    border: `1px solid ${TOK.border}`,
  };

  if (entries.length === 0) {
    return (
      <div
        className="rounded-xl p-4 text-sm"
        style={{ ...containerStyle, color: TOK.textMuted }}
      >
        No language data available.
      </div>
    );
  }

  return (
    <div className="rounded-xl p-4" style={containerStyle}>
      <h3
        className="text-[11px] font-semibold uppercase tracking-[0.18em] mb-3"
        style={{ color: TOK.textSecondary }}
      >
        Language mix
      </h3>
      <div
        className="flex h-3 rounded-full overflow-hidden"
        style={{ background: "rgba(255,255,255,0.04)" }}
      >
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
            <span className="truncate" style={{ color: TOK.textPrimary }}>
              {lang}
            </span>
            <span
              className="ml-auto tabular-nums"
              style={{ color: TOK.textMuted }}
            >
              {((bytes / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
