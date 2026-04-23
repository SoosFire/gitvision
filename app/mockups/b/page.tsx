// Variant B — Raycast-warm
// Richer dark. Soft glow. Command-palette energy. Rounded cards. Gradients.

import Link from "next/link";

const TOK = {
  bg: "#141419",
  surface: "#1E1E26",
  surfaceGlow:
    "radial-gradient(1200px 400px at 50% -100px, rgba(251,146,60,0.10), transparent 60%)",
  cardBg:
    "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
  border: "rgba(255,255,255,0.08)",
  borderWarm: "rgba(251,146,60,0.22)",
  textPrimary: "#F5F5F7",
  textSecondary: "#A0A0AE",
  textMuted: "#6E6E7C",
  accent: "#fb923c",
  accentAlt: "#10b981",
};

const DEMO_REPOS = [
  { name: "vercel/next.js", icon: "▲" },
  { name: "anthropics/claude-code", icon: "✳" },
  { name: "facebook/react", icon: "◈" },
  { name: "rust-lang/rust", icon: "⚙" },
];

const FAKE_SESSIONS = [
  {
    name: "vercel/next.js",
    sub: "Full-history · 2 snapshots",
    updated: "12m ago",
    commits: 7842,
    prs: 107,
    hot: true,
  },
  {
    name: "the-hidden-fish/advisor-ledger",
    sub: "Solo project · 1 snapshot",
    updated: "2h ago",
    commits: 439,
    prs: 0,
    hot: false,
  },
  {
    name: "anthropics/claude-code",
    sub: "Active · 3 snapshots",
    updated: "yesterday",
    commits: 1204,
    prs: 23,
    hot: true,
  },
];

export default function MockupB() {
  return (
    <div
      className="min-h-screen relative"
      style={{ background: TOK.bg, color: TOK.textPrimary }}
    >
      {/* Top glow */}
      <div
        className="absolute inset-x-0 top-0 h-[500px] pointer-events-none"
        style={{ background: TOK.surfaceGlow }}
      />

      <MockupBar variant="B" accent={TOK.accent} />

      <main className="max-w-5xl mx-auto px-8 pt-20 pb-20 flex flex-col gap-20 relative">
        {/* Hero */}
        <section className="flex flex-col gap-8 items-center text-center">
          <div
            className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium backdrop-blur"
            style={{
              background: "rgba(251,146,60,0.1)",
              border: `1px solid ${TOK.borderWarm}`,
              color: TOK.accent,
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full animate-pulse"
              style={{ background: TOK.accent }}
            />
            <span>v0.6 — AI health check is live</span>
          </div>

          <h1
            className="text-6xl font-semibold tracking-tight leading-[1.05] max-w-3xl"
            style={{ letterSpacing: "-0.03em" }}
          >
            The{" "}
            <span
              style={{
                background: `linear-gradient(135deg, ${TOK.accent} 0%, ${TOK.accentAlt} 100%)`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              briefing room
            </span>{" "}
            for any GitHub repo.
          </h1>

          <p
            className="text-lg max-w-xl leading-relaxed"
            style={{ color: TOK.textSecondary }}
          >
            Paste a URL. Get a canvas, a health verdict, and an AI-written
            field report — in under 20 seconds.
          </p>

          {/* Command-palette-style input */}
          <div
            className="w-full max-w-2xl rounded-2xl p-1 relative overflow-hidden"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${TOK.border}`,
              boxShadow:
                "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
            }}
          >
            <div
              className="absolute inset-0 opacity-50 pointer-events-none"
              style={{
                background: `linear-gradient(90deg, transparent, ${TOK.accent}22, transparent)`,
              }}
            />
            <div className="flex items-center gap-2 px-3 py-2 relative">
              <kbd
                className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  color: TOK.textSecondary,
                  border: `1px solid ${TOK.border}`,
                }}
              >
                ⌘K
              </kbd>
              <input
                placeholder="Paste GitHub URL or owner/repo..."
                className="flex-1 bg-transparent h-10 text-base focus:outline-none"
                style={{ color: TOK.textPrimary }}
              />
              <button
                className="h-9 px-4 rounded-lg text-sm font-medium transition"
                style={{
                  background: `linear-gradient(135deg, ${TOK.accent}, #ea580c)`,
                  color: "#1A0E02",
                  boxShadow: `0 0 20px ${TOK.accent}44`,
                }}
              >
                Analyze ⚡
              </button>
            </div>
          </div>

          {/* Demo chips */}
          <div className="flex flex-wrap gap-2 justify-center">
            <span
              className="text-xs self-center"
              style={{ color: TOK.textMuted }}
            >
              or try with
            </span>
            {DEMO_REPOS.map((r) => (
              <button
                key={r.name}
                className="text-xs font-mono px-2.5 py-1 rounded-lg transition hover:scale-105"
                style={{
                  background: TOK.cardBg,
                  border: `1px solid ${TOK.border}`,
                  color: TOK.textSecondary,
                }}
              >
                <span style={{ color: TOK.accent }}>{r.icon}</span>{" "}
                {r.name}
              </button>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="flex flex-col gap-6">
          <div className="flex items-end justify-between">
            <div>
              <div
                className="text-xs uppercase tracking-[0.2em] font-semibold"
                style={{ color: TOK.accent }}
              >
                The flow
              </div>
              <h2 className="text-2xl font-semibold mt-1">
                From URL to insight, in three moves.
              </h2>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {[
              {
                n: "1",
                t: "Paste",
                d: "Any public GitHub URL. OAuth later for private.",
                emoji: "📋",
              },
              {
                n: "2",
                t: "Analyze",
                d: "We clone history, parse imports, fetch PRs, run AI briefing.",
                emoji: "⚡",
              },
              {
                n: "3",
                t: "Explore",
                d: "Canvas, dep graph, PR flow, health verdict. Save, share, return.",
                emoji: "🗺️",
              },
            ].map((s) => (
              <div
                key={s.n}
                className="rounded-2xl p-5 flex flex-col gap-3 transition hover:translate-y-[-2px]"
                style={{
                  background: TOK.cardBg,
                  border: `1px solid ${TOK.border}`,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                }}
              >
                <div className="flex items-center justify-between">
                  <div
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-base"
                    style={{
                      background: `${TOK.accent}18`,
                      border: `1px solid ${TOK.borderWarm}`,
                    }}
                  >
                    {s.emoji}
                  </div>
                  <span
                    className="font-mono text-xs"
                    style={{ color: TOK.textMuted }}
                  >
                    step {s.n}
                  </span>
                </div>
                <h3 className="text-lg font-semibold">{s.t}</h3>
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: TOK.textSecondary }}
                >
                  {s.d}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Your sessions */}
        <section className="flex flex-col gap-5">
          <div className="flex items-end justify-between">
            <div>
              <div
                className="text-xs uppercase tracking-[0.2em] font-semibold"
                style={{ color: TOK.accent }}
              >
                Your library
              </div>
              <h2 className="text-2xl font-semibold mt-1">Recent sessions</h2>
            </div>
            <button
              className="text-xs font-medium px-3 h-8 rounded-lg transition"
              style={{
                background: TOK.cardBg,
                border: `1px solid ${TOK.border}`,
                color: TOK.textSecondary,
              }}
            >
              View all →
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {FAKE_SESSIONS.map((s) => (
              <div
                key={s.name}
                className="rounded-2xl p-5 flex flex-col gap-3 transition hover:translate-y-[-2px] cursor-pointer relative overflow-hidden"
                style={{
                  background: TOK.cardBg,
                  border: `1px solid ${TOK.border}`,
                }}
              >
                {s.hot && (
                  <div
                    className="absolute top-0 right-0 text-[10px] font-mono px-2 py-0.5 rounded-bl-lg"
                    style={{
                      background: `${TOK.accent}22`,
                      color: TOK.accent,
                    }}
                  >
                    🔥 active
                  </div>
                )}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate">{s.name}</h3>
                    <p
                      className="text-xs mt-0.5"
                      style={{ color: TOK.textMuted }}
                    >
                      {s.sub}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-1">
                  <Stat
                    label="commits"
                    value={s.commits.toLocaleString()}
                    color={TOK.textPrimary}
                  />
                  <Stat
                    label="PRs"
                    value={s.prs.toString()}
                    color={TOK.textPrimary}
                  />
                  <div
                    className="text-[11px] ml-auto"
                    style={{ color: TOK.textMuted }}
                  >
                    {s.updated}
                  </div>
                </div>
              </div>
            ))}
            {/* New session slot */}
            <button
              className="rounded-2xl p-5 flex items-center justify-center gap-2 transition hover:translate-y-[-2px] col-span-2"
              style={{
                background: "transparent",
                border: `1px dashed ${TOK.border}`,
                color: TOK.textSecondary,
                minHeight: 80,
              }}
            >
              <span className="text-lg">+</span>
              <span className="text-sm">Analyze a new repo</span>
            </button>
          </div>
        </section>

        <footer
          className="pt-8 text-xs flex items-center justify-between border-t"
          style={{ borderColor: TOK.border, color: TOK.textMuted }}
        >
          <span>GitVision · crafted by SoosFire</span>
          <span className="flex items-center gap-1">
            <kbd
              className="font-mono px-1 rounded"
              style={{ background: "rgba(255,255,255,0.06)" }}
            >
              ⌘K
            </kbd>
            to focus URL input
          </span>
        </footer>
      </main>
    </div>
  );
}

function MockupBar({ variant, accent }: { variant: string; accent: string }) {
  return (
    <div
      className="sticky top-0 z-50 backdrop-blur border-b"
      style={{
        background: "rgba(20,20,25,0.8)",
        borderColor: "rgba(255,255,255,0.06)",
      }}
    >
      <div className="max-w-5xl mx-auto px-8 h-10 flex items-center justify-between text-xs">
        <Link href="/mockups" style={{ color: "#A0A0AE" }}>
          ← All mockups
        </Link>
        <div className="flex items-center gap-2">
          <span className="font-mono" style={{ color: accent }}>
            Variant {variant}
          </span>
          <span style={{ color: "#6E6E7C" }}>· Raycast-warm</span>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-sm font-semibold tabular-nums" style={{ color }}>
        {value}
      </span>
      <span
        className="text-[10px] uppercase tracking-wider"
        style={{ color: "#6E6E7C" }}
      >
        {label}
      </span>
    </div>
  );
}
