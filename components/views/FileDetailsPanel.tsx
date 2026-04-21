// Side-panel shown when the user clicks a node in the Constellation.

import type { FileHotspot, CoChangeEdge, CommitSummary, RepoMeta } from "@/lib/types";

interface Props {
  hotspot: FileHotspot;
  coChange: CoChangeEdge[];
  recentCommits: CommitSummary[];
  repo: RepoMeta;
  onClose: () => void;
}

export function FileDetailsPanel({
  hotspot,
  coChange,
  recentCommits,
  repo,
  onClose,
}: Props) {
  const partners = coChange
    .filter((e) => e.from === hotspot.path || e.to === hotspot.path)
    .map((e) => ({
      path: e.from === hotspot.path ? e.to : e.from,
      count: e.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const commitsForFile = recentCommits
    .filter((c) => hotspot.commits.includes(c.sha))
    .slice(0, 8);

  const ghUrl = `https://github.com/${repo.fullName}/blob/${repo.defaultBranch}/${hotspot.path}`;

  return (
    <aside className="absolute z-20 top-0 right-0 h-full w-[360px] bg-zinc-900/95 backdrop-blur border-l border-white/10 text-zinc-100 overflow-y-auto">
      <div className="sticky top-0 bg-zinc-900/95 backdrop-blur border-b border-white/10 px-4 py-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-white/50">
            File
          </div>
          <a
            href={ghUrl}
            target="_blank"
            rel="noopener"
            className="font-mono text-sm break-all hover:underline"
          >
            {hotspot.path}
          </a>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 h-7 w-7 rounded-full hover:bg-white/10 transition flex items-center justify-center text-white/60 hover:text-white"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="p-4 space-y-5">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Churn" value={hotspot.churn.toString()} sub="commits" />
          <Stat label="Authors" value={hotspot.authors.toString()} sub="unique" />
          <Stat
            label="Score"
            value={hotspot.score.toFixed(1)}
            sub="risk"
          />
        </div>

        {hotspot.authorLogins.length > 0 && (
          <section>
            <SectionTitle>Authors</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              {hotspot.authorLogins.map((login) => (
                <a
                  key={login}
                  href={`https://github.com/${login}`}
                  target="_blank"
                  rel="noopener"
                  className="text-xs px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10"
                >
                  @{login}
                </a>
              ))}
            </div>
          </section>
        )}

        {partners.length > 0 && (
          <section>
            <SectionTitle>Co-changes with</SectionTitle>
            <ul className="space-y-1">
              {partners.map((p) => (
                <li
                  key={p.path}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="font-mono truncate flex-1" title={p.path}>
                    {p.path}
                  </span>
                  <span className="text-white/50 tabular-nums shrink-0">
                    ×{p.count}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {commitsForFile.length > 0 && (
          <section>
            <SectionTitle>Recent commits</SectionTitle>
            <ul className="space-y-2">
              {commitsForFile.map((c) => (
                <li key={c.sha} className="text-xs">
                  <a
                    href={`https://github.com/${repo.fullName}/commit/${c.sha}`}
                    target="_blank"
                    rel="noopener"
                    className="block hover:bg-white/5 rounded px-2 py-1.5 -mx-2"
                  >
                    <div className="truncate text-white/90">{c.message}</div>
                    <div className="text-white/40 mt-0.5 flex items-center gap-2">
                      <span>{c.authorLogin ?? c.authorName}</span>
                      <span>·</span>
                      <span>{new Date(c.date).toLocaleDateString()}</span>
                      <span>·</span>
                      <span className="font-mono">{c.sha.slice(0, 7)}</span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[10px] uppercase tracking-wider text-white/50 mb-2 font-medium">
      {children}
    </h4>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-white/5 border border-white/10 p-2">
      <div className="text-[10px] uppercase tracking-wider text-white/50">{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-white/40">{sub}</div>}
    </div>
  );
}
