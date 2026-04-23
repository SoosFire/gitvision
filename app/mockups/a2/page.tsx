// Variant A2 — Linear-lighter, split hero with product preview
// Same palette and structural feel as A, but the hero shows a visual
// preview of the canvas alongside the CTA. "Product-forward" energy.

import Link from "next/link";

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

const DEMO_REPOS = ["vercel/next.js", "anthropics/claude-code", "facebook/react"];

const FAKE_SESSIONS = [
  {
    name: "vercel/next.js",
    sub: "Full-history · 2 snapshots",
    updated: "12 minutes ago",
    pulse: 89,
    badge: "active",
  },
  {
    name: "the-hidden-fish/advisor-ledger",
    sub: "Solo project · 1 snapshot",
    updated: "2 hours ago",
    pulse: 34,
    badge: "solo",
  },
  {
    name: "anthropics/claude-code",
    sub: "Active · 3 snapshots",
    updated: "yesterday",
    pulse: 67,
    badge: "healthy",
  },
];

export default function MockupA2() {
  return (
    <div
      className="min-h-screen"
      style={{ background: TOK.bg, color: TOK.textPrimary }}
    >
      <MockupBar variant="A2" accent={TOK.accent} />

      <main className="max-w-6xl mx-auto px-8 pt-16 pb-20 flex flex-col gap-24">
        {/* Hero — split layout */}
        <section className="grid lg:grid-cols-[1.1fr_1fr] gap-16 items-center">
          <div className="flex flex-col gap-7">
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
              className="text-5xl font-semibold tracking-tight leading-[1.05]"
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
                  className="h-10 mr-1 px-4 rounded-md text-sm font-medium"
                  style={{ background: TOK.accent, color: "#0a1f16" }}
                >
                  Analyze →
                </button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs" style={{ color: TOK.textMuted }}>
                  Try:
                </span>
                {DEMO_REPOS.map((r) => (
                  <button
                    key={r}
                    className="text-xs font-mono px-2 py-1 rounded-md"
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
          </div>

          {/* Canvas preview */}
          <CanvasPreview />
        </section>

        {/* How it works */}
        <section className="flex flex-col gap-8">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">
              How it works
            </h2>
            <div className="text-xs" style={{ color: TOK.textMuted }}>
              ~20 seconds end-to-end
            </div>
          </div>

          <div
            className="grid grid-cols-3 gap-px overflow-hidden rounded-xl"
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
                d: "We clone history, parse imports, fetch PRs, compute signals.",
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

        {/* Sessions — bigger cards */}
        <section className="flex flex-col gap-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">
              Your sessions
            </h2>
            <div className="text-xs" style={{ color: TOK.textMuted }}>
              3 saved
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            {FAKE_SESSIONS.map((s) => (
              <div
                key={s.name}
                className="rounded-xl p-5 flex flex-col gap-4 cursor-pointer transition hover:translate-y-[-2px]"
                style={{
                  background: TOK.surface,
                  border: `1px solid ${TOK.border}`,
                }}
              >
                <div className="flex items-start justify-between">
                  <span
                    className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded"
                    style={{
                      background: TOK.accentSoft,
                      color: TOK.accent,
                    }}
                  >
                    {s.badge}
                  </span>
                  <span
                    className="text-[10px]"
                    style={{ color: TOK.textMuted }}
                  >
                    {s.updated}
                  </span>
                </div>
                <div>
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
                    {s.sub}
                  </div>
                </div>
                <PulseSparkline seed={s.pulse} color={TOK.accent} />
              </div>
            ))}
          </div>
        </section>

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
      <div className="max-w-6xl mx-auto px-8 h-10 flex items-center justify-between text-xs">
        <Link href="/mockups" style={{ color: "#9898A8" }}>
          ← All mockups
        </Link>
        <div className="flex items-center gap-2">
          <span className="font-mono" style={{ color: accent }}>
            Variant {variant}
          </span>
          <span style={{ color: "#6E6E7E" }}>· Linear, split hero</span>
        </div>
      </div>
    </div>
  );
}

// Stylized mini canvas — not functional, just shows the vibe
function CanvasPreview() {
  const cards = [
    { x: 20, y: 40, w: 140, label: "app-render.tsx", hue: 180 },
    { x: 180, y: 20, w: 140, label: "config-shared.ts", hue: 210 },
    { x: 40, y: 140, w: 140, label: "router/routes.ts", hue: 210 },
    { x: 180, y: 120, w: 140, label: "use-cache.ts", hue: 140 },
    { x: 320, y: 80, w: 120, label: "turbopack.rs", hue: 30 },
    { x: 60, y: 240, w: 140, label: "package.json", hue: 50 },
    { x: 240, y: 230, w: 150, label: "next-swc/mod.rs", hue: 30 },
  ];
  const edges = [
    [0, 1],
    [0, 3],
    [1, 3],
    [2, 0],
    [3, 4],
    [5, 6],
  ];
  const centerOf = (c: (typeof cards)[number]) => ({
    x: c.x + c.w / 2,
    y: c.y + 18,
  });

  return (
    <div
      className="relative rounded-xl overflow-hidden"
      style={{
        background: "#0B0B11",
        border: `1px solid ${TOK.border}`,
        aspectRatio: "4 / 3",
        minHeight: 360,
      }}
    >
      {/* Dots background */}
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Canvas controls overlay */}
      <div
        className="absolute top-3 left-3 rounded-md px-2.5 py-1.5 text-[11px] font-mono flex items-center gap-2 z-10"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${TOK.border}`,
          color: TOK.textSecondary,
          backdropFilter: "blur(4px)",
        }}
      >
        <span
          className="h-1 w-1 rounded-full"
          style={{ background: TOK.accent }}
        />
        <span>60 files · 20 links</span>
      </div>

      {/* Edges */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 480 360"
        preserveAspectRatio="none"
      >
        {edges.map(([a, b], i) => {
          const pa = centerOf(cards[a]);
          const pb = centerOf(cards[b]);
          return (
            <line
              key={i}
              x1={pa.x}
              y1={pa.y}
              x2={pb.x}
              y2={pb.y}
              stroke="rgba(255,255,255,0.15)"
              strokeWidth="1"
            />
          );
        })}
      </svg>

      {/* Cards */}
      {cards.map((c, i) => (
        <div
          key={i}
          className="absolute rounded-md text-[10px] font-mono px-2 py-1.5 flex flex-col gap-1"
          style={{
            left: c.x,
            top: c.y,
            width: c.w,
            background: `hsl(${c.hue} 40% 20%)`,
            border: `1px solid hsl(${c.hue} 50% 40%)`,
            color: `hsl(${c.hue} 60% 85%)`,
          }}
        >
          <div className="flex items-center gap-1.5">
            <span
              className="h-1 w-1 rounded-full shrink-0"
              style={{ background: `hsl(${c.hue} 70% 55%)` }}
            />
            <span className="truncate">{c.label}</span>
          </div>
          <div className="flex items-center gap-1">
            <span style={{ color: "rgba(255,255,255,0.4)" }}>3</span>
            <div
              className="flex-1 h-[3px] rounded-full"
              style={{ background: "rgba(255,255,255,0.1)" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  background: `hsl(${c.hue} 70% 55%)`,
                  width: `${40 + (i * 12) % 60}%`,
                }}
              />
            </div>
          </div>
        </div>
      ))}

      {/* Caption */}
      <div
        className="absolute bottom-3 left-3 rounded px-2 py-1 text-[10px] font-mono"
        style={{
          background: "rgba(0,0,0,0.4)",
          color: TOK.textMuted,
          backdropFilter: "blur(4px)",
        }}
      >
        live preview — this is what you get
      </div>
    </div>
  );
}

function PulseSparkline({ seed, color }: { seed: number; color: string }) {
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
