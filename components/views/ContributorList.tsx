import Image from "next/image";
import type { Contributor } from "@/lib/types";
import { TOK } from "@/lib/theme";

export function ContributorList({ contributors }: { contributors: Contributor[] }) {
  const top = contributors.slice(0, 12);
  const total = contributors.reduce((s, c) => s + c.contributions, 0) || 1;
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <h3
        className="text-[11px] font-semibold uppercase tracking-[0.18em] mb-3"
        style={{ color: TOK.textSecondary }}
      >
        Top contributors
      </h3>
      <ul className="flex flex-col gap-2">
        {top.map((c) => {
          const pct = (c.contributions / total) * 100;
          return (
            <li key={c.login} className="flex items-center gap-3">
              <Image
                src={c.avatarUrl}
                alt={c.login}
                width={28}
                height={28}
                className="rounded-full"
                style={{ border: `1px solid ${TOK.border}` }}
                unoptimized
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={c.htmlUrl}
                    target="_blank"
                    rel="noopener"
                    className="text-sm font-medium truncate hover:underline"
                    style={{ color: TOK.textPrimary }}
                  >
                    {c.login}
                  </a>
                  <span
                    className="text-xs tabular-nums"
                    style={{ color: TOK.textMuted }}
                  >
                    {c.contributions}
                  </span>
                </div>
                <div
                  className="mt-1 h-1 rounded-full overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.06)" }}
                >
                  <div
                    className="h-full"
                    style={{
                      width: `${pct}%`,
                      background: TOK.accent,
                    }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {contributors.length > top.length && (
        <p className="text-xs mt-3" style={{ color: TOK.textMuted }}>
          +{contributors.length - top.length} more
        </p>
      )}
    </div>
  );
}
