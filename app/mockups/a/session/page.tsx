// Variant A — Session/analysis page mockup
// Same Linear-lighter palette as /mockups/a landing. Shows the page layout
// AFTER a repo has been analyzed: topbar, hero, AI summary, health, tabs, canvas.

import Link from "next/link";

const TOK = {
  bg: "#14141B",
  surface: "#1C1C26",
  surfaceElevated: "#23232E",
  panelBg: "#1A1A23",
  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.14)",
  textPrimary: "#E8E8EE",
  textSecondary: "#9898A8",
  textMuted: "#6E6E7E",
  accent: "#10b981",
  accentSoft: "rgba(16,185,129,0.12)",
  amber: "#f59e0b",
  amberSoft: "rgba(245,158,11,0.12)",
  rose: "#f87171",
};

export default function MockupASession() {
  return (
    <div
      className="min-h-screen"
      style={{ background: TOK.bg, color: TOK.textPrimary }}
    >
      {/* Mockup bar */}
      <div
        className="sticky top-0 z-50 backdrop-blur border-b"
        style={{
          background: "rgba(10,10,15,0.8)",
          borderColor: "rgba(255,255,255,0.06)",
        }}
      >
        <div className="max-w-6xl mx-auto px-8 h-10 flex items-center justify-between text-xs">
          <Link href="/mockups/a" style={{ color: TOK.textSecondary }}>
            ← Back to A landing
          </Link>
          <div className="flex items-center gap-2">
            <span className="font-mono" style={{ color: TOK.accent }}>
              Variant A
            </span>
            <span style={{ color: TOK.textMuted }}>· Session view</span>
          </div>
        </div>
      </div>

      {/* App top nav */}
      <div
        className="border-b"
        style={{ borderColor: TOK.border }}
      >
        <div className="max-w-6xl mx-auto px-8 h-14 flex items-center gap-6">
          <Link
            href="/mockups/a"
            className="flex items-center gap-2 text-sm"
            style={{ color: TOK.textSecondary }}
          >
            <span>←</span>
            <span>All sessions</span>
          </Link>
          <div className="h-5 w-px" style={{ background: TOK.border }} />
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span
              className="font-mono text-sm truncate"
              style={{ color: TOK.textPrimary }}
            >
              vercel/next.js
            </span>
            <span
              className="text-xs shrink-0 px-1.5 py-0.5 rounded font-mono"
              style={{
                background: TOK.accentSoft,
                color: TOK.accent,
              }}
            >
              active
            </span>
            <span
              className="text-xs shrink-0"
              style={{ color: TOK.textMuted }}
            >
              · updated 12m ago · snapshot 2 of 2
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              className="h-8 px-3 rounded-md text-xs transition flex items-center gap-1.5"
              style={{
                background: TOK.surface,
                border: `1px solid ${TOK.border}`,
                color: TOK.textSecondary,
              }}
            >
              <span>📸</span>
              <span>Share</span>
              <span style={{ color: TOK.textMuted }}>▾</span>
            </button>
            <button
              className="h-8 px-3 rounded-md text-xs font-medium transition flex items-center gap-1.5"
              style={{
                background: TOK.accent,
                color: "#0a1f16",
              }}
            >
              <span>↻</span>
              <span>Refresh</span>
            </button>
            <button
              className="h-8 w-8 rounded-md text-xs transition flex items-center justify-center"
              style={{
                background: TOK.surface,
                border: `1px solid ${TOK.border}`,
                color: TOK.textMuted,
              }}
            >
              ⋯
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-8 py-10 flex flex-col gap-10">
        {/* Hero */}
        <section className="flex flex-col gap-4">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1
              className="text-3xl font-semibold tracking-tight"
              style={{ letterSpacing: "-0.02em" }}
            >
              vercel/next.js
            </h1>
            <a
              href="https://github.com/vercel/next.js"
              className="text-xs font-mono"
              style={{ color: TOK.textMuted }}
            >
              github.com/vercel/next.js ↗
            </a>
          </div>
          <p
            className="text-base max-w-3xl leading-relaxed"
            style={{ color: TOK.textSecondary }}
          >
            The React Framework for the Web. Used by some of the world&apos;s
            largest companies, Next.js enables you to create full-stack web
            applications by extending the latest React features.
          </p>

          {/* Meta row */}
          <div
            className="flex items-center gap-6 text-xs pt-2"
            style={{ color: TOK.textSecondary }}
          >
            <MetaPill label="★" value="139k" />
            <MetaPill label="Forks" value="23.2k" />
            <MetaPill label="License" value="MIT" />
            <MetaPill label="Primary" value="TypeScript" />
            <MetaPill label="Age" value="9y 6m" />
            <MetaPill label="Contributors" value="100+" />
          </div>

          {/* Topics */}
          <div className="flex flex-wrap gap-1.5 mt-1">
            {[
              "react",
              "nextjs",
              "vercel",
              "framework",
              "static",
              "ssr",
              "server-rendering",
              "blog",
              "static-site-generator",
            ].map((t) => (
              <span
                key={t}
                className="text-xs px-2 py-0.5 rounded"
                style={{
                  background: TOK.surface,
                  color: TOK.textMuted,
                  border: `1px solid ${TOK.border}`,
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </section>

        {/* Since last visit banner */}
        <section
          className="rounded-lg p-4 flex items-center gap-4"
          style={{
            background: `linear-gradient(90deg, ${TOK.accentSoft} 0%, transparent 60%)`,
            border: `1px solid ${TOK.border}`,
          }}
        >
          <div
            className="h-8 w-8 rounded-lg flex items-center justify-center text-sm shrink-0"
            style={{
              background: TOK.accentSoft,
              color: TOK.accent,
              border: `1px solid ${TOK.accent}44`,
            }}
          >
            ⟳
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Since your last visit</div>
            <div
              className="text-xs mt-0.5"
              style={{ color: TOK.textSecondary }}
            >
              <span style={{ color: TOK.accent }}>+47 commits</span>
              {" · "}
              <span style={{ color: TOK.accent }}>+128 stars</span>
              {" · "}
              3 new contributors
              {" · "}
              2 new hotspots: <span className="font-mono">use-cache-wrapper.ts</span>,{" "}
              <span className="font-mono">turbo-tasks-backend/mod.rs</span>
            </div>
          </div>
          <div
            className="text-xs font-mono shrink-0"
            style={{ color: TOK.textMuted }}
          >
            2h 14m ago
          </div>
        </section>

        {/* AI Summary — prominent, not buried */}
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">
                AI briefing
              </h2>
              <span
                className="text-[10px] font-mono"
                style={{ color: TOK.textMuted }}
              >
                · claude-sonnet-4-5 · 23 apr 2026
              </span>
            </div>
            <button
              className="text-xs"
              style={{ color: TOK.textMuted }}
            >
              🔁 Regenerate
            </button>
          </div>
          <div
            className="rounded-xl p-6"
            style={{
              background: TOK.surface,
              border: `1px solid ${TOK.border}`,
            }}
          >
            <p
              className="text-[15px] leading-relaxed"
              style={{ color: TOK.textPrimary }}
            >
              Next.js is the React framework that convinced the industry
              server-side rendering could scale. The real story is the
              architecture bet: a JavaScript/TypeScript router and dev
              server backed by a Rust compiler that does the heavy lifting.
            </p>
            <p
              className="text-[15px] leading-relaxed mt-3"
              style={{ color: TOK.textPrimary }}
            >
              The codebase is 55% JavaScript, 31% TypeScript, 13% Rust.
              Recent hotspots cluster in{" "}
              <span className="font-mono text-[13px]">use-cache-wrapper.ts</span>{" "}
              and{" "}
              <span className="font-mono text-[13px]">turbo-tasks-backend</span>
              — active work on caching primitives and the Rust build system.
              ijjk and timneutkens lead, with sokra driving Turbopack.
            </p>
            <p
              className="text-[15px] leading-relaxed mt-3"
              style={{ color: TOK.textPrimary }}
            >
              The PR backlog is worrying. 107 open against 55 merged means
              review bandwidth is the bottleneck, not authorship.
            </p>
            <div
              className="mt-4 pt-4 border-t flex items-center justify-between text-[11px] font-mono"
              style={{ borderColor: TOK.border, color: TOK.textMuted }}
            >
              <span>2,048 tokens in · 389 out</span>
              <span>~$0.02</span>
            </div>
          </div>
        </section>

        {/* Health Check — 3 columns with evidence visible by default */}
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">
              Health check
            </h2>
            <button
              className="text-xs"
              style={{ color: TOK.textMuted }}
            >
              🔁 Regenerate
            </button>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <HealthColumn
              label="What works"
              accent={TOK.accent}
              narrative="The team ships PRs in a median of 0.2 days across 55 recent human merges, and commits landed in 89 of 89 sampled weeks. Ownership spans 100+ contributors with top-5 accounting for 43%."
              signals={[
                { id: "fast-pr", title: "Fast PR cycle", detail: "0.2d median · 55 human merges" },
                { id: "broad", title: "Broad ownership", detail: "4 active folders · 3+ authors each" },
                { id: "active", title: "Actively developed", detail: "2 days since last commit" },
                { id: "cadence", title: "Consistent cadence", detail: "89 of 89 sampled weeks active" },
              ]}
            />
            <HealthColumn
              label="Where to dig deeper"
              accent={TOK.amber}
              narrative="21 file pairs across top-level folders change together often, notably crates/next-core/src/next_config.rs with packages/next/src/server/config-shared.ts — module boundaries may be leaking. PR backlog is 1.9× intake rate."
              signals={[
                {
                  id: "coupling",
                  title: "Cross-boundary coupling",
                  detail: "21 pairs · crates ↔ packages config",
                  severity: "medium",
                },
                {
                  id: "backlog",
                  title: "PR backlog growing",
                  detail: "107 open · 55 merged · 1.9× intake",
                  severity: "medium",
                },
              ]}
            />
            <HealthColumn
              label="Open questions"
              accent={TOK.textSecondary}
              narrative="73% of the top 15 churn files are lockfiles, configs, and release artifacts. Worth checking whether core feature development is concentrated in lower-churn areas or has shifted to maintenance."
              signals={[
                {
                  id: "meta",
                  title: "Metadata-dominated churn",
                  detail: "73% of top hotspots · release bot activity",
                },
              ]}
            />
          </div>
        </section>

        {/* Tabs */}
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between border-b"
            style={{ borderColor: TOK.border }}
          >
            <div className="flex items-center gap-0">
              <Tab label="Canvas" active accent={TOK.accent} />
              <Tab label="Dependencies" count={1203} />
              <Tab label="PRs" count={107} />
              <Tab label="Overview" />
            </div>
            <div className="flex items-center gap-2 text-xs pb-3">
              <div
                className="flex items-center rounded-md"
                style={{
                  background: TOK.surface,
                  border: `1px solid ${TOK.border}`,
                }}
              >
                <span className="px-2" style={{ color: TOK.textMuted }}>
                  🔍
                </span>
                <input
                  placeholder="Filter path…"
                  className="bg-transparent h-6 text-xs focus:outline-none w-40"
                  style={{ color: TOK.textPrimary }}
                />
              </div>
              <button
                className="text-xs flex items-center gap-1.5"
                style={{ color: TOK.textSecondary }}
              >
                <span>Color:</span>
                <span
                  className="px-2 h-6 rounded flex items-center"
                  style={{
                    background: TOK.surface,
                    border: `1px solid ${TOK.border}`,
                  }}
                >
                  by type ▾
                </span>
              </button>
            </div>
          </div>

          {/* Mock canvas */}
          <FullCanvasPreview />
        </section>

        <footer
          className="pt-6 text-xs flex items-center justify-between border-t"
          style={{ borderColor: TOK.border, color: TOK.textMuted }}
        >
          <span>GitVision · vercel/next.js</span>
          <span>Rate limit: 4,997/5,000 · resets in 41 min</span>
        </footer>
      </main>
    </div>
  );
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span style={{ color: TOK.textMuted }}>{label}</span>
      <span style={{ color: TOK.textPrimary, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function Tab({
  label,
  count,
  active,
  accent,
}: {
  label: string;
  count?: number;
  active?: boolean;
  accent?: string;
}) {
  return (
    <button
      className="h-10 px-3 text-sm font-medium flex items-center gap-1.5 transition"
      style={{
        color: active ? TOK.textPrimary : TOK.textSecondary,
        borderBottom: active
          ? `2px solid ${accent ?? TOK.accent}`
          : "2px solid transparent",
        marginBottom: -1,
      }}
    >
      {label}
      {count !== undefined && (
        <span
          className="text-[10px] font-mono px-1 rounded"
          style={{
            background: TOK.surface,
            color: TOK.textMuted,
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

interface Signal {
  id: string;
  title: string;
  detail: string;
  severity?: "low" | "medium" | "high";
}
function HealthColumn({
  label,
  accent,
  narrative,
  signals,
}: {
  label: string;
  accent: string;
  narrative: string;
  signals: Signal[];
}) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-1 w-5 rounded-full"
          style={{ background: accent }}
        />
        <h3
          className="text-[11px] font-semibold uppercase tracking-[0.15em]"
          style={{ color: accent }}
        >
          {label}
        </h3>
      </div>
      <p
        className="text-[13px] leading-relaxed"
        style={{ color: TOK.textPrimary }}
      >
        {narrative}
      </p>
      <div
        className="flex flex-col gap-1.5 pt-3 border-t"
        style={{ borderColor: TOK.border }}
      >
        {signals.map((s) => (
          <div key={s.id} className="flex items-start gap-2">
            <span
              className="h-1 w-1 rounded-full shrink-0 mt-1.5"
              style={{ background: accent }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className="text-xs font-medium"
                  style={{ color: TOK.textPrimary }}
                >
                  {s.title}
                </span>
                {s.severity && (
                  <span
                    className="text-[9px] uppercase tracking-wider px-1 py-px rounded"
                    style={{
                      background:
                        s.severity === "high"
                          ? "rgba(244,63,94,0.15)"
                          : "rgba(245,158,11,0.15)",
                      color: s.severity === "high" ? TOK.rose : TOK.amber,
                    }}
                  >
                    {s.severity}
                  </span>
                )}
              </div>
              <div
                className="text-[11px] font-mono mt-0.5"
                style={{ color: TOK.textMuted }}
              >
                {s.detail}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Bigger canvas preview with folder frames
function FullCanvasPreview() {
  return (
    <div
      className="relative rounded-xl overflow-hidden"
      style={{
        background: "#0A0A10",
        border: `1px solid ${TOK.border}`,
        height: 520,
      }}
    >
      {/* Dots bg */}
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Controls overlay top-left */}
      <div
        className="absolute top-3 left-3 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-mono z-10"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${TOK.border}`,
          color: TOK.textSecondary,
          backdropFilter: "blur(4px)",
        }}
      >
        <span className="h-1 w-1 rounded-full" style={{ background: TOK.accent }} />
        <span>60 files · 21 links</span>
      </div>

      {/* Legend bottom-left */}
      <div
        className="absolute bottom-3 left-3 rounded px-2.5 py-1.5 text-[10px] z-10"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${TOK.border}`,
          color: TOK.textSecondary,
          backdropFilter: "blur(4px)",
        }}
      >
        Color = file type · Bar = churn · Green dot = recent
      </div>

      {/* Folder frames with cards */}
      <div className="absolute inset-0 p-16">
        {/* packages frame */}
        <FolderFrame
          x={0}
          y={40}
          w={420}
          h={240}
          label="packages · 24 files"
          cards={[
            { label: "app-render.tsx", hue: 180, churn: 4 },
            { label: "config-shared.ts", hue: 210, churn: 3 },
            { label: "use-cache.ts", hue: 210, churn: 3 },
            { label: "router.ts", hue: 210, churn: 2 },
            { label: "manifest.ts", hue: 210, churn: 2 },
            { label: "env.ts", hue: 210, churn: 2 },
          ]}
        />
        {/* turbopack frame */}
        <FolderFrame
          x={460}
          y={0}
          w={340}
          h={200}
          label="turbopack · 8 files"
          cards={[
            { label: "backend/mod.rs", hue: 30, churn: 5 },
            { label: "graph.rs", hue: 30, churn: 3 },
            { label: "imports.rs", hue: 30, churn: 2 },
            { label: "turbo-tasks.rs", hue: 30, churn: 2 },
          ]}
        />
        {/* test frame */}
        <FolderFrame
          x={460}
          y={220}
          w={200}
          h={140}
          label="test · 6 files"
          cards={[
            { label: "app-dir.test.ts", hue: 160, churn: 2 },
            { label: "cache.test.ts", hue: 160, churn: 1 },
          ]}
        />
        {/* root frame */}
        <FolderFrame
          x={680}
          y={220}
          w={120}
          h={140}
          label="root · 2"
          cards={[
            { label: "package.json", hue: 50, churn: 7 },
            { label: "pnpm-lock", hue: 50, churn: 8 },
          ]}
        />
      </div>
    </div>
  );
}

function FolderFrame({
  x,
  y,
  w,
  h,
  label,
  cards,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  cards: { label: string; hue: number; churn: number }[];
}) {
  return (
    <div
      className="absolute rounded-xl"
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        background: "rgba(255,255,255,0.025)",
        border: `1px solid rgba(255,255,255,0.08)`,
      }}
    >
      {/* Label above frame */}
      <div
        className="absolute -top-6 left-1 text-[11px] font-mono flex items-center gap-1.5"
        style={{
          color: "rgba(255,255,255,0.7)",
          textShadow: "0 1px 2px rgba(0,0,0,0.6)",
        }}
      >
        <span
          className="h-1 w-1 rounded-full"
          style={{ background: "rgba(255,255,255,0.6)" }}
        />
        <span className="font-medium">{label}</span>
      </div>
      {/* Cards in loose grid */}
      <div className="p-4 grid grid-cols-3 gap-3">
        {cards.map((c, i) => (
          <div
            key={i}
            className="rounded-md px-2 py-1.5 flex flex-col gap-1 text-[10px] font-mono"
            style={{
              background: `hsl(${c.hue} 40% 20%)`,
              border: `1px solid hsl(${c.hue} 50% 38%)`,
              color: `hsl(${c.hue} 60% 88%)`,
              minWidth: 0,
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
              <span style={{ color: "rgba(255,255,255,0.5)" }}>
                {c.churn}
              </span>
              <div
                className="flex-1 h-[2px] rounded-full"
                style={{ background: "rgba(255,255,255,0.1)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    background: `hsl(${c.hue} 70% 55%)`,
                    width: `${Math.min(100, c.churn * 15)}%`,
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
