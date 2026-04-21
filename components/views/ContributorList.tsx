import Image from "next/image";
import type { Contributor } from "@/lib/types";

export function ContributorList({ contributors }: { contributors: Contributor[] }) {
  const top = contributors.slice(0, 12);
  const total = contributors.reduce((s, c) => s + c.contributions, 0) || 1;
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <h3 className="text-sm font-semibold mb-3">Top contributors</h3>
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
                className="rounded-full border border-zinc-200 dark:border-zinc-800"
                unoptimized
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={c.htmlUrl}
                    target="_blank"
                    rel="noopener"
                    className="text-sm font-medium truncate hover:underline"
                  >
                    {c.login}
                  </a>
                  <span className="text-xs text-zinc-500 tabular-nums">
                    {c.contributions}
                  </span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {contributors.length > top.length && (
        <p className="text-xs text-zinc-500 mt-3">
          +{contributors.length - top.length} more
        </p>
      )}
    </div>
  );
}
