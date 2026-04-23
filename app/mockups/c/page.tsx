// Variant C — Editorial
// Analytical. Numbered sections. Data-forward. Display typography. Violet accent.

import Link from "next/link";

const TOK = {
  bg: "#0F1118",
  surface: "#171A24",
  surfaceAlt: "#1E2230",
  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(167,139,250,0.2)",
  textPrimary: "#EDEEF2",
  textSecondary: "#9CA0B0",
  textMuted: "#5E6372",
  accent: "#a78bfa",
  accentAlt: "#67e8f9",
  rule: "#252836",
};

const STATS = [
  { label: "Repos analyzed", value: "1,247" },
  { label: "Signals surfaced", value: "14" },
  { label: "Average report time", value: "19s" },
];

const FAKE_SESSIONS = [
  {
    owner: "vercel",
    repo: "next.js",
    snapshot: "snapshot 02 of 02",
    meta: ["139k stars", "107 open PRs", "13% Rust"],
    verdict: "Healthy throughput · review backlog building",
    updated: "12 min ago",
  },
  {
    owner: "the-hidden-fish",
    repo: "advisor-ledger",
    snapshot: "snapshot 01 of 01",
    meta: ["718 stars", "solo", "96% Python"],
    verdict: "Active · no LICENSE · bus factor 1",
    updated: "2h ago",
  },
  {
    owner: "anthropics",
    repo: "claude-code",
    snapshot: "snapshot 03 of 03",
    meta: ["active", "23 open PRs", "TS primary"],
    verdict: "Fast cycle · broad ownership",
    updated: "yesterday",
  },
];

export default function MockupC() {
  return (
    <div
      className="min-h-screen"
      style={{ background: TOK.bg, color: TOK.textPrimary }}
    >
      <MockupBar variant="C" accent={TOK.accent} />

      <main className="max-w-4xl mx-auto px-8 pt-16 pb-24 flex flex-col gap-20">
        {/* Masthead */}
        <header className="flex flex-col gap-6">
          <div
            className="flex items-center gap-3 text-[11px] uppercase tracking-[0.25em] font-semibold"
            style={{ color: TOK.accent }}
          >
            <span>Issue 06</span>
            <span style={{ color: TOK.textMuted }}>—</span>
            <span style={{ color: TOK.textSecondary }}>April 2026</span>
          </div>

          <h1
            className="text-7xl font-semibold leading-[0.95] tracking-tighter"
            style={{
              letterSpacing: "-0.04em",
              fontFeatureSettings: '"ss01", "ss02"',
            }}
          >
            The briefing<br />
            on{" "}
            <span
              style={{
                fontStyle: "italic",
                fontWeight: 400,
                color: TOK.accent,
              }}
            >
              your codebase
            </span>.
          </h1>

          <p
            className="text-lg max-w-xl leading-relaxed"
            style={{ color: TOK.textSecondary }}
          >
            GitVision reads the history, the imports, and the review flow of
            any GitHub repository. Twenty seconds later, you have a map, a
            verdict, and a clear list of what to look at next.
          </p>

          {/* URL input */}
          <div
            className="flex items-center rounded-md mt-2 overflow-hidden"
            style={{
              background: TOK.surface,
              border: `1px solid ${TOK.border}`,
            }}
          >
            <span
              className="pl-4 pr-2 font-mono text-sm"
              style={{ color: TOK.textMuted }}
            >
              ❯
            </span>
            <input
              placeholder="github.com/owner/repo"
              className="flex-1 bg-transparent h-12 text-base focus:outline-none font-mono"
              style={{ color: TOK.textPrimary }}
            />
            <button
              className="h-10 mr-1 px-5 text-sm font-semibold rounded tracking-wide"
              style={{
                background: TOK.accent,
                color: "#1B0F3A",
              }}
            >
              Run analysis
            </button>
          </div>

          {/* Social proof / stats row */}
          <div
            className="flex items-center gap-8 pt-6 border-t mt-2"
            style={{ borderColor: TOK.rule }}
          >
            {STATS.map((s) => (
              <div key={s.label} className="flex flex-col">
                <span
                  className="text-2xl font-semibold tabular-nums"
                  style={{ color: TOK.textPrimary }}
                >
                  {s.value}
                </span>
                <span
                  className="text-[10px] uppercase tracking-[0.18em] mt-0.5"
                  style={{ color: TOK.textMuted }}
                >
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </header>

        {/* Section — What's in a report */}
        <section className="flex flex-col gap-8">
          <SectionHeader number="01" label="What's in a report" accent={TOK.accent} />

          <div className="grid grid-cols-2 gap-x-10 gap-y-6">
            {[
              {
                t: "Living canvas",
                d: "Every file, every folder, every co-change line. Zoom in, drag around, click to inspect.",
              },
              {
                t: "Dependency graph",
                d: "File-to-file imports across 15+ languages. Brick-staggered layers from entry to leaf.",
              },
              {
                t: "PR cycle flow",
                d: "Opened → reviewed → merged, bucketed by duration. Instant sense of review bandwidth.",
              },
              {
                t: "Full-history scrubber",
                d: "Watch hotspots move across months or years. No sampling — we clone with git log.",
              },
              {
                t: "Health check",
                d: "13 deterministic signals — bus factor, coupling, stale deps — plus an AI verdict.",
              },
              {
                t: "AI briefing",
                d: "A 180-word field report, written by Claude, grounded in the data not general knowledge.",
              },
            ].map((f) => (
              <div key={f.t} className="flex flex-col gap-1.5">
                <h3 className="text-base font-semibold">{f.t}</h3>
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: TOK.textSecondary }}
                >
                  {f.d}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Section — Your archive */}
        <section className="flex flex-col gap-6">
          <SectionHeader
            number="02"
            label="Your archive"
            accent={TOK.accent}
            right={
              <button
                className="text-xs font-medium"
                style={{ color: TOK.accent }}
              >
                View all (3) →
              </button>
            }
          />

          <div className="flex flex-col">
            {FAKE_SESSIONS.map((s, i) => (
              <article
                key={s.repo}
                className="group py-5 cursor-pointer transition"
                style={{
                  borderTop: i === 0 ? `1px solid ${TOK.rule}` : "none",
                  borderBottom: `1px solid ${TOK.rule}`,
                }}
              >
                <div className="flex items-start justify-between gap-6">
                  <div className="flex-1">
                    <div
                      className="text-[10px] uppercase tracking-[0.2em] font-mono"
                      style={{ color: TOK.textMuted }}
                    >
                      {s.owner} · {s.snapshot}
                    </div>
                    <h3 className="text-2xl font-semibold mt-1 group-hover:underline underline-offset-4">
                      {s.repo}
                    </h3>
                    <p
                      className="text-sm mt-2 italic"
                      style={{ color: TOK.textSecondary }}
                    >
                      &ldquo;{s.verdict}&rdquo;
                    </p>
                    <div className="flex items-center gap-3 mt-3">
                      {s.meta.map((m) => (
                        <span
                          key={m}
                          className="text-[11px] font-mono"
                          style={{ color: TOK.textMuted }}
                        >
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span
                      className="text-[11px]"
                      style={{ color: TOK.textMuted }}
                    >
                      {s.updated}
                    </span>
                    <span
                      className="text-xl transition group-hover:translate-x-1"
                      style={{ color: TOK.accent }}
                    >
                      →
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Section — Method */}
        <section className="flex flex-col gap-6">
          <SectionHeader number="03" label="Method" accent={TOK.accent} />

          <div
            className="rounded-md p-6 grid grid-cols-3 gap-6 relative"
            style={{
              background: TOK.surface,
              border: `1px solid ${TOK.border}`,
            }}
          >
            {[
              {
                t: "Fetch",
                d: "REST API for metadata + contributors. Cloned git history for file-change truth.",
              },
              {
                t: "Compute",
                d: "Hotspots (churn × log authors), co-change, dep graph from tarball, PR cycle data.",
              },
              {
                t: "Narrate",
                d: "Claude Sonnet 4.5 turns computed signals into plain English. Grounded in data only.",
              },
            ].map((m) => (
              <div key={m.t} className="flex flex-col gap-2">
                <h3
                  className="text-xs font-semibold uppercase tracking-[0.2em]"
                  style={{ color: TOK.accent }}
                >
                  {m.t}
                </h3>
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: TOK.textSecondary }}
                >
                  {m.d}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer
          className="pt-10 flex items-center justify-between border-t text-xs"
          style={{ borderColor: TOK.rule, color: TOK.textMuted }}
        >
          <div className="flex flex-col gap-0.5">
            <span style={{ color: TOK.textSecondary }}>GitVision</span>
            <span>A field tool for reading codebases · v0.6</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="#" style={{ color: TOK.textSecondary }}>
              GitHub
            </Link>
            <Link href="#" style={{ color: TOK.textSecondary }}>
              Docs
            </Link>
            <Link href="#" style={{ color: TOK.textSecondary }}>
              @SoosFire
            </Link>
          </div>
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
        background: "rgba(15,17,24,0.85)",
        borderColor: "rgba(255,255,255,0.06)",
      }}
    >
      <div className="max-w-4xl mx-auto px-8 h-10 flex items-center justify-between text-xs">
        <Link href="/mockups" style={{ color: "#9CA0B0" }}>
          ← All mockups
        </Link>
        <div className="flex items-center gap-2">
          <span className="font-mono" style={{ color: accent }}>
            Variant {variant}
          </span>
          <span style={{ color: "#5E6372" }}>· Editorial</span>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  number,
  label,
  accent,
  right,
}: {
  number: string;
  label: string;
  accent: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b pb-2" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
      <div className="flex items-baseline gap-4">
        <span
          className="font-mono text-xs tabular-nums"
          style={{ color: accent }}
        >
          {number}
        </span>
        <h2 className="text-lg font-semibold tracking-tight">{label}</h2>
      </div>
      {right}
    </div>
  );
}
