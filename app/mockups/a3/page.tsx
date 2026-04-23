// Variant A3 — Linear-lighter, tool-forward with sidebar navigation
// Same palette as A, but framed as a workspace rather than a landing page.
// Persistent sidebar, sessions as a proper table, ⌘K-ready URL input.

import Link from "next/link";

const TOK = {
  bg: "#14141B",
  bgDeep: "#0E0E14",
  surface: "#1C1C26",
  surfaceElevated: "#23232E",
  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.14)",
  textPrimary: "#E8E8EE",
  textSecondary: "#9898A8",
  textMuted: "#6E6E7E",
  accent: "#10b981",
  accentSoft: "rgba(16,185,129,0.12)",
};

const SIDEBAR_SESSIONS = [
  { name: "vercel/next.js", active: true },
  { name: "advisor-ledger", active: false },
  { name: "anthropics/claude-code", active: false },
  { name: "SoosFire/improveapp", active: false },
];

const TABLE_ROWS = [
  {
    repo: "vercel/next.js",
    contribs: "100+",
    hotspots: 120,
    lang: "TS",
    updated: "12m",
    snaps: 2,
    status: "active",
  },
  {
    repo: "the-hidden-fish/advisor-ledger",
    contribs: "1",
    hotspots: 14,
    lang: "Python",
    updated: "2h",
    snaps: 1,
    status: "solo",
  },
  {
    repo: "anthropics/claude-code",
    contribs: "12",
    hotspots: 67,
    lang: "TS",
    updated: "yesterday",
    snaps: 3,
    status: "healthy",
  },
  {
    repo: "SoosFire/improveapp",
    contribs: "1",
    hotspots: 11,
    lang: "Swift",
    updated: "3d",
    snaps: 1,
    status: "solo",
  },
];

export default function MockupA3() {
  return (
    <div
      className="min-h-screen flex"
      style={{ background: TOK.bg, color: TOK.textPrimary }}
    >
      {/* Sidebar */}
      <aside
        className="w-[240px] shrink-0 flex flex-col border-r"
        style={{
          borderColor: TOK.border,
          background: TOK.bgDeep,
          minHeight: "100vh",
        }}
      >
        <div className="p-4 flex items-center gap-2">
          <div
            className="h-7 w-7 rounded-md flex items-center justify-center font-mono text-[11px] font-bold"
            style={{
              background: TOK.accent,
              color: "#0a1f16",
            }}
          >
            GV
          </div>
          <span className="font-semibold text-sm">GitVision</span>
          <span
            className="ml-auto text-[10px] font-mono"
            style={{ color: TOK.textMuted }}
          >
            v0.6
          </span>
        </div>

        <div className="px-3 pt-2">
          <button
            className="w-full flex items-center gap-2 px-3 h-8 rounded-md text-sm transition"
            style={{
              background: TOK.accent,
              color: "#0a1f16",
              fontWeight: 500,
            }}
          >
            <span>＋</span>
            <span>New analysis</span>
            <kbd
              className="ml-auto text-[10px] font-mono px-1 rounded"
              style={{
                background: "rgba(0,0,0,0.2)",
                color: "rgba(10,31,22,0.7)",
              }}
            >
              ⌘N
            </kbd>
          </button>
        </div>

        <nav className="px-3 mt-6 flex flex-col gap-0.5">
          <div
            className="text-[10px] uppercase tracking-[0.2em] font-semibold px-2 mb-1"
            style={{ color: TOK.textMuted }}
          >
            Recent
          </div>
          {SIDEBAR_SESSIONS.map((s) => (
            <button
              key={s.name}
              className="flex items-center gap-2 px-2 h-7 rounded text-sm text-left truncate transition"
              style={{
                background: s.active ? TOK.surface : "transparent",
                color: s.active ? TOK.textPrimary : TOK.textSecondary,
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full shrink-0"
                style={{
                  background: s.active ? TOK.accent : TOK.border,
                }}
              />
              <span className="truncate font-mono text-[12px]">
                {s.name}
              </span>
            </button>
          ))}
        </nav>

        <div className="mt-auto p-3 flex flex-col gap-1">
          <button
            className="flex items-center gap-2 px-2 h-7 rounded text-sm text-left"
            style={{ color: TOK.textSecondary }}
          >
            <span>⚙</span>
            <span>Settings</span>
          </button>
          <button
            className="flex items-center gap-2 px-2 h-7 rounded text-sm text-left"
            style={{ color: TOK.textSecondary }}
          >
            <span>?</span>
            <span>Help & docs</span>
          </button>
          <div
            className="flex items-center gap-2 px-2 h-7 rounded text-xs"
            style={{ color: TOK.textMuted }}
          >
            <div
              className="h-5 w-5 rounded-full shrink-0"
              style={{ background: "#8B4FE0" }}
            />
            <span className="truncate">SoosFire</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <div
          className="h-12 flex items-center justify-between px-6 border-b shrink-0"
          style={{ borderColor: TOK.border }}
        >
          <Link
            href="/mockups"
            className="text-xs"
            style={{ color: TOK.textMuted }}
          >
            ← All mockups
          </Link>
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-2 rounded-md px-2 h-7"
              style={{
                background: TOK.surface,
                border: `1px solid ${TOK.border}`,
              }}
            >
              <span
                className="text-xs"
                style={{ color: TOK.textMuted }}
              >
                🔍
              </span>
              <input
                placeholder="Search sessions or paste a repo URL…"
                className="bg-transparent text-xs focus:outline-none w-72"
                style={{ color: TOK.textPrimary }}
              />
              <kbd
                className="text-[10px] font-mono px-1 rounded"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  color: TOK.textMuted,
                }}
              >
                ⌘K
              </kbd>
            </div>
            <span
              className="text-xs font-mono"
              style={{ color: TOK.accent }}
            >
              Variant A3
            </span>
          </div>
        </div>

        <main className="flex-1 overflow-auto">
          <div className="max-w-5xl mx-auto px-8 py-12 flex flex-col gap-14">
            {/* Compact hero */}
            <section className="flex flex-col gap-5">
              <div className="flex items-center gap-2">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: TOK.accent }}
                />
                <span
                  className="text-xs uppercase tracking-[0.18em] font-medium"
                  style={{ color: TOK.textSecondary }}
                >
                  v0.6 · now with AI health checks
                </span>
              </div>
              <h1
                className="text-4xl font-semibold tracking-tight leading-[1.05] max-w-2xl"
                style={{ letterSpacing: "-0.02em" }}
              >
                See any repo as{" "}
                <span style={{ color: TOK.accent }}>a living map</span>.
              </h1>
              <p
                className="text-base max-w-xl"
                style={{ color: TOK.textSecondary }}
              >
                Paste a GitHub URL above or pick a session from the sidebar.
                Get an explorable canvas, an honest health verdict, and an
                AI briefing in under 20 seconds.
              </p>
            </section>

            {/* Sessions table */}
            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">
                  Your sessions
                </h2>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    className="px-2 h-6 rounded"
                    style={{
                      background: TOK.surface,
                      border: `1px solid ${TOK.border}`,
                      color: TOK.textSecondary,
                    }}
                  >
                    Sort: Recent ▾
                  </button>
                  <button
                    className="px-2 h-6 rounded"
                    style={{
                      background: TOK.surface,
                      border: `1px solid ${TOK.border}`,
                      color: TOK.textSecondary,
                    }}
                  >
                    Filter ▾
                  </button>
                </div>
              </div>

              <div
                className="rounded-xl overflow-hidden"
                style={{
                  background: TOK.surface,
                  border: `1px solid ${TOK.border}`,
                }}
              >
                {/* Table header */}
                <div
                  className="grid grid-cols-[2fr_0.6fr_0.7fr_0.6fr_0.8fr_0.5fr_0.7fr] gap-4 px-5 py-3 text-[10px] uppercase tracking-wider font-semibold border-b"
                  style={{
                    color: TOK.textMuted,
                    borderColor: TOK.border,
                  }}
                >
                  <div>Repo</div>
                  <div className="text-right">Authors</div>
                  <div className="text-right">Hotspots</div>
                  <div>Lang</div>
                  <div>Updated</div>
                  <div className="text-right">Snap</div>
                  <div>Status</div>
                </div>
                {TABLE_ROWS.map((r, i) => (
                  <div
                    key={r.repo}
                    className="grid grid-cols-[2fr_0.6fr_0.7fr_0.6fr_0.8fr_0.5fr_0.7fr] gap-4 px-5 py-3 items-center cursor-pointer transition"
                    style={{
                      borderBottom:
                        i === TABLE_ROWS.length - 1
                          ? "none"
                          : `1px solid ${TOK.border}`,
                    }}
                  >
                    <div
                      className="font-mono text-sm truncate"
                      style={{ color: TOK.textPrimary }}
                    >
                      {r.repo}
                    </div>
                    <div
                      className="text-right tabular-nums text-sm"
                      style={{ color: TOK.textSecondary }}
                    >
                      {r.contribs}
                    </div>
                    <div
                      className="text-right tabular-nums text-sm"
                      style={{ color: TOK.textSecondary }}
                    >
                      {r.hotspots}
                    </div>
                    <div
                      className="text-xs font-mono"
                      style={{ color: TOK.textSecondary }}
                    >
                      {r.lang}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: TOK.textMuted }}
                    >
                      {r.updated}
                    </div>
                    <div
                      className="text-right text-xs font-mono"
                      style={{ color: TOK.textMuted }}
                    >
                      {r.snaps}
                    </div>
                    <div>
                      <span
                        className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded"
                        style={{
                          background: TOK.accentSoft,
                          color: TOK.accent,
                        }}
                      >
                        {r.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Quick tips */}
            <section className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">
                Get the most out of it
              </h2>
              <div
                className="grid grid-cols-3 gap-px rounded-xl overflow-hidden"
                style={{ background: TOK.border }}
              >
                {[
                  {
                    k: "⌘K",
                    t: "Jump to any session",
                    d: "Fuzzy search across all your saved sessions or paste a new URL.",
                  },
                  {
                    k: "⌘N",
                    t: "New analysis",
                    d: "Skip the menu — start analyzing a new repo from anywhere.",
                  },
                  {
                    k: "⌘S",
                    t: "Share current view",
                    d: "Capture a branded share card of the current session.",
                  },
                ].map((tip) => (
                  <div
                    key={tip.k}
                    className="p-5 flex flex-col gap-2"
                    style={{ background: TOK.bg }}
                  >
                    <kbd
                      className="text-xs font-mono px-2 py-0.5 rounded w-fit"
                      style={{
                        background: TOK.surface,
                        border: `1px solid ${TOK.border}`,
                        color: TOK.accent,
                      }}
                    >
                      {tip.k}
                    </kbd>
                    <h3 className="text-sm font-semibold">{tip.t}</h3>
                    <p
                      className="text-xs leading-relaxed"
                      style={{ color: TOK.textSecondary }}
                    >
                      {tip.d}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <footer
              className="pt-8 text-xs flex items-center justify-between border-t"
              style={{ borderColor: TOK.border, color: TOK.textMuted }}
            >
              <span>GitVision · v0.6</span>
              <span>
                Rate limit: 4,997/5,000 · resets in 41 min
              </span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
