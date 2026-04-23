"use client";

// Visual hotspot map: squarified treemap where size = churn and color = author diversity.
// No external charting lib — we use D3's treemap layout + plain SVG.

import { useMemo } from "react";
import * as d3 from "d3";
import type { FileHotspot } from "@/lib/types";
import { TOK } from "@/lib/theme";

// Same ambiguous-basename list as the canvas — these appear all over
// monorepos with identical names, so we prefix the parent folder to
// disambiguate (packages/next/package.json → next/package.json).
const AMBIGUOUS_BASENAMES = new Set([
  "package.json",
  "package-lock.json",
  "readme.md",
  "changelog.md",
  "license",
  "index.ts",
  "index.tsx",
  "index.js",
  "index.jsx",
  "index.html",
  "index.md",
  "index.mjs",
  "cargo.toml",
  "go.mod",
  "__init__.py",
  "mod.rs",
  "lib.rs",
  "tsconfig.json",
  "tsconfig.build.json",
  "jest.config.js",
  "jest.config.ts",
  "webpack.config.js",
  ".gitignore",
  "dockerfile",
]);

function fileDisplayName(path: string): string {
  const parts = path.split("/");
  const base = parts[parts.length - 1];
  if (parts.length > 1 && AMBIGUOUS_BASENAMES.has(base.toLowerCase())) {
    return `${parts[parts.length - 2]}/${base}`;
  }
  return base;
}

export function HotspotTreemap({
  hotspots,
  width = 800,
  height = 360,
}: {
  hotspots: FileHotspot[];
  width?: number;
  height?: number;
}) {
  const layout = useMemo(() => {
    if (hotspots.length === 0) return null;
    // Build a flat hierarchy — grouping by top-level folder keeps related files near each other.
    const groups = d3.group(hotspots, (h) => h.path.split("/")[0]);
    const root = {
      name: "root",
      children: [...groups.entries()].map(([folder, files]) => ({
        name: folder,
        children: files.map((f) => ({ name: f.path, value: f.churn, data: f })),
      })),
    };
    const hier = d3
      .hierarchy(root as unknown as d3.HierarchyNode<unknown>)
      .sum((d) => ((d as { value?: number }).value ?? 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    d3.treemap().size([width, height]).paddingInner(2).paddingOuter(3).round(true)(
      hier as d3.HierarchyNode<unknown>
    );
    return hier as d3.HierarchyRectangularNode<unknown>;
  }, [hotspots, width, height]);

  if (!layout) {
    return (
      <div
        className="text-sm p-8 text-center rounded-xl border"
        style={{
          color: TOK.textMuted,
          background: TOK.surface,
          borderColor: TOK.border,
        }}
      >
        No commit-file data available. Try re-running on a more active repo.
      </div>
    );
  }

  // Author-diversity color scale — more unique authors = hotter.
  // Muted palette that reads well on dark: teal → emerald → amber → rose
  const maxAuthors = Math.max(1, ...hotspots.map((h) => h.authors));
  const color = d3
    .scaleLinear<string>()
    .domain([0, maxAuthors * 0.33, maxAuthors * 0.66, maxAuthors])
    .range(["#134e4a", "#065f46", "#b45309", "#991b1b"])
    .clamp(true);

  const leaves = layout.leaves() as d3.HierarchyRectangularNode<{
    name: string;
    data: FileHotspot;
  }>[];

  return (
    <div
      className="rounded-xl p-4 overflow-hidden flex flex-col gap-3"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <h3
        className="text-[11px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: TOK.textSecondary }}
      >
        Hotspots
      </h3>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto"
      >
        {leaves.map((node, i) => {
          const w = node.x1 - node.x0;
          const h = node.y1 - node.y0;
          const file = node.data as unknown as { name: string; data: FileHotspot };
          const fill = color(file.data.authors);
          const displayName = fileDisplayName(file.data.path);
          // Max chars we can fit at ~7.5 px per mono char, leaving 10px padding
          const maxChars = Math.max(0, Math.floor((w - 10) / 7.5));
          const label =
            maxChars >= 3
              ? displayName.length > maxChars
                ? displayName.slice(0, maxChars - 1) + "…"
                : displayName
              : "";
          return (
            <g key={i} transform={`translate(${node.x0},${node.y0})`}>
              <title>{`${file.data.path}\nChurn: ${file.data.churn} commits\nAuthors: ${file.data.authors}\nScore: ${file.data.score.toFixed(2)}`}</title>
              <rect width={w} height={h} fill={fill} rx={3} />
              {/* Only render label if tile is roomy enough — skip the
                  "truncated-to-two-letters" look on tiny tiles. */}
              {w >= 50 && h >= 20 && label && (
                <text
                  x={5}
                  y={14}
                  fontSize={11}
                  fontFamily="var(--font-geist-mono)"
                  fill="rgba(255,255,255,0.9)"
                  style={{ pointerEvents: "none" }}
                >
                  {label}
                </text>
              )}
              {w >= 70 && h >= 36 && (
                <text
                  x={5}
                  y={28}
                  fontSize={10}
                  fill="rgba(255,255,255,0.55)"
                  style={{ pointerEvents: "none" }}
                >
                  {file.data.churn}× · {file.data.authors} auth
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div
        className="flex items-center justify-between text-xs px-2 py-1"
        style={{ color: TOK.textMuted }}
      >
        <span>Size = churn · Color = unique authors</span>
        <div className="flex items-center gap-2">
          <span>less diverse</span>
          <div
            className="h-2 w-24 rounded"
            style={{
              background: `linear-gradient(to right, ${color(0)}, ${color(maxAuthors)})`,
            }}
          />
          <span>more diverse</span>
        </div>
      </div>
    </div>
  );
}
