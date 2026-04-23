// UI/UX mockup index — Linear-lighter family (decided direction) + archived.
// Pure visuals, no real data or behavior. Delete route once we pick a winner.

import Link from "next/link";

const LINEAR_FAMILY = [
  {
    slug: "a",
    name: "A — Baseline",
    tagline: "Centered vertical hero, hairline grid, compact session list.",
    swatch: "#10b981",
  },
  {
    slug: "a2",
    name: "A2 — Product-forward",
    tagline:
      "Split hero with a live canvas preview on the right. Bigger session cards.",
    swatch: "#10b981",
  },
  {
    slug: "a3",
    name: "A3 — Tool-forward",
    tagline:
      "Sidebar navigation, sessions as a real table, ⌘K search. Feels like a workspace.",
    swatch: "#10b981",
  },
];

const ARCHIVED = [
  { slug: "b", name: "B — Raycast-warm", swatch: "#fb923c" },
  { slug: "c", name: "C — Editorial", swatch: "#a78bfa" },
];

export default function MockupsIndex() {
  return (
    <main
      className="min-h-screen flex flex-col items-center p-8"
      style={{ background: "#0E0E14", color: "#E8E8EE" }}
    >
      <div className="max-w-3xl w-full flex flex-col gap-10 py-12">
        <header className="flex flex-col gap-2">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
            GitVision · UI exploration
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Linear-lighter family
          </h1>
          <p className="text-zinc-400 max-w-xl">
            Chosen direction. Three variations on the same palette and
            structural language — different takes on layout and density.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          {LINEAR_FAMILY.map((v) => (
            <Link
              key={v.slug}
              href={`/mockups/${v.slug}`}
              className="group block rounded-xl border p-5 transition hover:scale-[1.005]"
              style={{
                background: "#14141B",
                borderColor: "rgba(255,255,255,0.08)",
              }}
            >
              <div className="flex items-start gap-4">
                <div
                  className="h-10 w-10 rounded-lg flex items-center justify-center font-mono font-semibold text-sm"
                  style={{
                    background: `${v.swatch}22`,
                    color: v.swatch,
                    border: `1px solid ${v.swatch}44`,
                  }}
                >
                  {v.slug.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-zinc-100">{v.name}</h3>
                  <p className="text-sm text-zinc-400 mt-0.5">{v.tagline}</p>
                </div>
                <span className="text-zinc-500 group-hover:text-zinc-300 transition">
                  →
                </span>
              </div>
            </Link>
          ))}
        </section>

        <section className="flex flex-col gap-3 opacity-50 pt-4">
          <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
            Archived — not in the running
          </div>
          <div className="flex flex-col gap-2">
            {ARCHIVED.map((v) => (
              <Link
                key={v.slug}
                href={`/mockups/${v.slug}`}
                className="flex items-center gap-3 py-2 px-3 rounded-lg transition hover:opacity-100"
                style={{ background: "rgba(255,255,255,0.02)" }}
              >
                <div
                  className="h-6 w-6 rounded flex items-center justify-center font-mono text-xs"
                  style={{
                    background: `${v.swatch}22`,
                    color: v.swatch,
                  }}
                >
                  {v.slug.toUpperCase()}
                </div>
                <span className="text-sm text-zinc-400">{v.name}</span>
                <span className="ml-auto text-xs text-zinc-600">preview →</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
