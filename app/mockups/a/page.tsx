// Variant A — Linear-lighter
// Clean minimalism. Structural. Quiet accents. Rectangular grid. Tight type.

import Link from "next/link";

// Design tokens for this mockup (scoped — not real theme yet)
const TOK = {
  bg: "#14141B",
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

const DEMO_REPOS = [
  "vercel/next.js",
  "anthropics/claude-code",
  "facebook/react",
  "rust-lang/rust",
];

const FAKE_SESSIONS = [
  {
    name: "vercel/next.js",
    sub: "Full-history · 2 snapshots",
    updated: "12 minutes ago",
    pulse: 89,
    snapshots: 2,
  },
  {
    name: "the-hidden-fish/advisor-ledger",
    sub: "Solo project · 1 snapshot",
    updated: "2 hours ago",
    pulse: 34,
    snapshots: 1,
  },
  {
    name: "anthropics/claude-code",
    sub: "Active · 3 snapshots",
    updated: "yesterday",
    pulse: 67,
    snapshots: 3,
  },
];

export default function MockupA() {
  return (
    <div
      className="min-h-screen"
      style={{ background: TOK.bg, color: TOK.textPrimary }}
    >
      {/* Mockup bar */}
      <MockupBar variant="A" accent={TOK.accent} />

      {/* Jump-to-session-view ribbon */}
      <div
        className="border-b"
        style={{
          background: TOK.accentSoft,
          borderColor: TOK.border,
        }}
      >
        <div className="max-w-5xl mx-auto px-8 h-9 flex items-center justify-between text-xs">
          <span style={{ color: TOK.accent }}>
            ✨ Want to see the session view too?
          </span>
          <Link
            href="/mockups/a/session"
            className="font-medium underline underline-offset-2"
            style={{ color: TOK.accent }}
          >
            See it →
          </Link>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-8 pt-16 pb-20 flex flex-col gap-24">
        {/* Hero */}
        <section className="flex flex-col gap-8">
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
            className="text-6xl font-semibold tracking-tight leading-[1.05]"
            style={{ letterSpacing: "-0.03em" }}
          >
            See any repo as{" "}
            <span style={{ color: TOK.accent }}>a living map</span>.
          </h1>

          <p
            className="text-lg max-w-xl leading-relaxed"
            style={{ color: TOK.textSecondary }}
          >
            Paste a GitHub URL. Get an explorable canvas, an honest health
            verdict, and an AI briefing — in under 20 seconds.
          </p>

          <div className="flex flex-col gap-3">
            <div
              className="flex items-center rounded-lg"
              style={{
                background: TOK.surface,
                border: `1px solid ${TOK.border}`,
              }}
            >
              <input
                placeholder="github.com/owner/repo"
                className="flex-1 bg-transparent h-12 px-4 text-base focus:outline-none"
                style={{ color: TOK.textPrimary }}
              />
              <button
                className="h-10 mr-1 px-4 rounded-md text-sm font-medium transition"
                style={{
                  background: TOK.accent,
                  color: "#0a1f16",
                }}
              >
                Analyze →
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs" style={{ color: TOK.textMuted }}>
                Try with:
              </span>
              {DEMO_REPOS.map((r) => (
                <button
                  key={r}
                  className="text-xs font-mono px-2 py-1 rounded-md transition hover:scale-[1.02]"
                  style={{
                    background: TOK.surface,
                    border: `1px solid ${TOK.border}`,
                    color: TOK.textSecondary,
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="flex flex-col gap-8">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">
              How it works
            </h2>
            <div
              className="text-xs"
              style={{ color: TOK.textMuted }}
            >
              ~20 seconds end-to-end
            </div>
          </div>

          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl"
            style={{ background: TOK.border }}
          >
            {[
              {
                n: "01",
                t: "Paste",
                d: "Any public GitHub URL. No auth needed for public repos.",
              },
              {
                n: "02",
                t: "Analyze",
                d: "We clone history with git log, parse imports, fetch PRs, compute signals.",
              },
              {
                n: "03",
                t: "Explore",
                d: "Canvas, dependency graph, PR flow, health check. Save as a session.",
              },
            ].map((s) => (
              <div
                key={s.n}
                className="p-6 flex flex-col gap-3"
                style={{ background: TOK.bg }}
              >
                <span
                  className="font-mono text-sm"
                  style={{ color: TOK.accent }}
                >
                  {s.n}
                </span>
                <h3 className="text-base font-semibold">{s.t}</h3>
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
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">
              Your sessions
            </h2>
            <div className="text-xs" style={{ color: TOK.textMuted }}>
              3 saved · auto-synced
            </div>
          </div>

          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: TOK.surface,
              border: `1px solid ${TOK.border}`,
            }}
          >
            {FAKE_SESSIONS.map((s, i) => (
              <div
                key={s.name}
                className="flex items-center gap-4 px-5 py-4 transition"
                style={{
                  borderBottom:
                    i === FAKE_SESSIONS.length - 1
                      ? "none"
                      : `1px solid ${TOK.border}`,
                }}
              >
                <div className="flex-1 min-w-0">
                  <div
                    className="font-mono text-sm"
                    style={{ color: TOK.textPrimary }}
                  >
                    {s.name}
                  </div>
                  <div
                    className="text-xs mt-0.5"
                    style={{ color: TOK.textMuted }}
                  >
                    {s.sub} · {s.updated}
                  </div>
                </div>
                <PulseSparkline seed={s.pulse} color={TOK.accent} />
                <div
                  className="text-xs font-mono px-2 py-0.5 rounded"
                  style={{
                    background: TOK.accentSoft,
                    color: TOK.accent,
                  }}
                >
                  {s.snapshots}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer
          className="pt-8 text-xs flex items-center justify-between border-t"
          style={{ borderColor: TOK.border, color: TOK.textMuted }}
        >
          <span>GitVision · made by SoosFire</span>
          <span>
            Set{" "}
            <code
              className="font-mono px-1 rounded"
              style={{ background: TOK.surface }}
            >
              GITHUB_TOKEN
            </code>{" "}
            for 5000 req/hr
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
        background: "rgba(10,10,15,0.8)",
        borderColor: "rgba(255,255,255,0.06)",
      }}
    >
      <div className="max-w-5xl mx-auto px-8 h-10 flex items-center justify-between text-xs">
        <Link href="/mockups" style={{ color: "#9898A8" }}>
          ← All mockups
        </Link>
        <div className="flex items-center gap-2">
          <span
            className="font-mono"
            style={{ color: accent }}
          >
            Variant {variant}
          </span>
          <span style={{ color: "#6E6E7E" }}>· Linear-lighter</span>
        </div>
      </div>
    </div>
  );
}

// Tiny static sparkline for session row visual interest
function PulseSparkline({
  seed,
  color,
}: {
  seed: number;
  color: string;
}) {
  // Deterministic fake data from seed
  const bars = Array.from({ length: 24 }, (_, i) => {
    const v = (Math.sin(seed + i * 0.9) + 1) / 2;
    return 3 + v * 14;
  });
  return (
    <div className="flex items-end gap-[1.5px] h-5">
      {bars.map((h, i) => (
        <div
          key={i}
          className="w-[2px] rounded-sm"
          style={{
            height: `${h}px`,
            background: i > 18 ? color : "rgba(255,255,255,0.18)",
            opacity: 0.6 + (i / bars.length) * 0.4,
          }}
        />
      ))}
    </div>
  );
}
