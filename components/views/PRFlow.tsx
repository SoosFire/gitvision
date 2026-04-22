"use client";

// PR cycle-time sankey: Opened → Outcome → Time-to-merge bucket.
// Computed client-side from snapshot.pullRequests.

import { useMemo, useState } from "react";
import { sankey, sankeyLinkHorizontal } from "d3-sankey";
import type { PullRequestSummary } from "@/lib/types";

interface Props {
  prs: PullRequestSummary[];
}

type DurationBucket =
  | "< 1 hour"
  | "< 1 day"
  | "< 1 week"
  | "< 1 month"
  | "> 1 month";

function bucketFor(ms: number): DurationBucket {
  const hour = 3600_000;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  if (ms < hour) return "< 1 hour";
  if (ms < day) return "< 1 day";
  if (ms < week) return "< 1 week";
  if (ms < month) return "< 1 month";
  return "> 1 month";
}

const BUCKET_ORDER: DurationBucket[] = [
  "< 1 hour",
  "< 1 day",
  "< 1 week",
  "< 1 month",
  "> 1 month",
];

const BUCKET_COLOR: Record<DurationBucket, string> = {
  "< 1 hour": "#10b981",
  "< 1 day": "#22c55e",
  "< 1 week": "#eab308",
  "< 1 month": "#f97316",
  "> 1 month": "#ef4444",
};

const NODE_COLOR: Record<string, string> = {
  Opened: "#3b82f6",
  Merged: "#8b5cf6",
  "Closed (unmerged)": "#64748b",
  "Still open": "#06b6d4",
};

export function PRFlow({ prs }: Props) {
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);

  const { nodes, links, summary } = useMemo(() => {
    // Build nodes + links for sankey
    // Level 0: Opened (single node)
    // Level 1: Outcome — Merged / Closed (unmerged) / Still open
    // Level 2: Time-to-close bucket (only for merged/closed PRs)
    const nodeNames: string[] = ["Opened"];
    const nameToIdx = new Map<string, number>();
    const addNode = (name: string) => {
      if (!nameToIdx.has(name)) {
        nameToIdx.set(name, nodeNames.length);
        nodeNames.push(name);
      }
      return nameToIdx.get(name)!;
    };
    addNode("Opened");

    type RawLink = { source: number; target: number; value: number; key: string };
    const linkMap = new Map<string, RawLink>();
    const incLink = (fromName: string, toName: string) => {
      const source = addNode(fromName);
      const target = addNode(toName);
      const key = `${fromName}|${toName}`;
      const ex = linkMap.get(key);
      if (ex) ex.value += 1;
      else linkMap.set(key, { source, target, value: 1, key });
    };

    let merged = 0;
    let closedUnmerged = 0;
    let stillOpen = 0;
    const timeToMerge: number[] = [];

    for (const pr of prs) {
      const created = new Date(pr.createdAt).getTime();
      if (pr.merged && pr.mergedAt) {
        merged += 1;
        const duration = new Date(pr.mergedAt).getTime() - created;
        timeToMerge.push(duration);
        const bucket = bucketFor(duration);
        incLink("Opened", "Merged");
        incLink("Merged", bucket);
      } else if (pr.state === "closed" && pr.closedAt) {
        closedUnmerged += 1;
        incLink("Opened", "Closed (unmerged)");
      } else {
        stillOpen += 1;
        incLink("Opened", "Still open");
      }
    }

    const sankeyNodes = nodeNames.map((name) => ({ name }));
    const sankeyLinks = [...linkMap.values()];

    // Sort buckets so they appear in consistent order even when nodeNames was
    // appended in observed order.
    const bucketIndex = new Map(
      BUCKET_ORDER.map((b, i) => [b, i] as const)
    );
    sankeyLinks.sort((a, b) => {
      const aBucket = bucketIndex.get(nodeNames[a.target] as DurationBucket);
      const bBucket = bucketIndex.get(nodeNames[b.target] as DurationBucket);
      if (aBucket !== undefined && bBucket !== undefined) {
        return aBucket - bBucket;
      }
      return 0;
    });

    const median =
      timeToMerge.length === 0
        ? 0
        : timeToMerge.slice().sort((a, b) => a - b)[
            Math.floor(timeToMerge.length / 2)
          ];

    return {
      nodes: sankeyNodes,
      links: sankeyLinks,
      summary: {
        total: prs.length,
        merged,
        closedUnmerged,
        stillOpen,
        medianTimeToMerge: median,
      },
    };
  }, [prs]);

  if (prs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">
        No PR data in this snapshot — the repo may have no PRs yet, or the
        analysis hasn&apos;t fetched them. Click <strong>Refresh</strong> if
        you expect PRs.
      </div>
    );
  }

  const width = 1000;
  const height = 460;
  const marginLeft = 8;
  const marginRight = 140; // room for long node labels
  const marginTop = 24;
  const marginBottom = 24;

  // d3-sankey mutates node objects — cast to any for mutation
  const sankeyGen = sankey<{ name: string }, { value: number; key: string }>()
    .nodeWidth(18)
    .nodePadding(22)
    .extent([
      [marginLeft, marginTop],
      [width - marginRight, height - marginBottom],
    ]);

  const graph = sankeyGen({
    nodes: nodes.map((n) => ({ ...n })),
    links: links.map((l) => ({ ...l })),
  });

  function nodeColor(name: string) {
    return NODE_COLOR[name] ?? BUCKET_COLOR[name as DurationBucket] ?? "#64748b";
  }

  function fmtDuration(ms: number): string {
    const day = 24 * 3600_000;
    if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
    if (ms < day) return `${(ms / 3600_000).toFixed(1)}h`;
    return `${(ms / day).toFixed(1)}d`;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total PRs" value={String(summary.total)} />
        <Stat
          label="Merged"
          value={String(summary.merged)}
          note={
            summary.total > 0
              ? `${Math.round((summary.merged / summary.total) * 100)}%`
              : undefined
          }
        />
        <Stat
          label="Still open"
          value={String(summary.stillOpen)}
        />
        <Stat
          label="Median time to merge"
          value={
            summary.medianTimeToMerge > 0
              ? fmtDuration(summary.medianTimeToMerge)
              : "—"
          }
        />
      </div>

      <div
        className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden"
        style={{ background: "#0a0a0c" }}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: "100%", height: "auto", display: "block" }}
        >
          <g>
            {graph.links.map((l, i) => {
              const p = sankeyLinkHorizontal()(l) as string;
              const src = (l.source as { name: string }).name;
              const tgt = (l.target as { name: string }).name;
              const key = `${src}|${tgt}`;
              const isHover = hoveredLink === key;
              const color = nodeColor(tgt);
              return (
                <path
                  key={i}
                  d={p}
                  fill="none"
                  stroke={color}
                  strokeOpacity={isHover ? 0.65 : 0.32}
                  strokeWidth={Math.max(1, l.width ?? 1)}
                  onMouseEnter={() => setHoveredLink(key)}
                  onMouseLeave={() => setHoveredLink(null)}
                  style={{ transition: "stroke-opacity 0.15s" }}
                >
                  <title>
                    {src} → {tgt}: {l.value}
                  </title>
                </path>
              );
            })}
          </g>
          <g>
            {graph.nodes.map((n, i) => (
              <g key={i}>
                <rect
                  x={n.x0}
                  y={n.y0}
                  width={(n.x1 ?? 0) - (n.x0 ?? 0)}
                  height={(n.y1 ?? 0) - (n.y0 ?? 0)}
                  fill={nodeColor((n as { name: string }).name)}
                  rx={2}
                />
                <text
                  x={(n.x1 ?? 0) + 8}
                  y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2}
                  dy="0.35em"
                  fontSize={12}
                  fill="rgba(255,255,255,0.85)"
                  fontFamily="ui-monospace, monospace"
                >
                  {(n as { name: string }).name}
                  <tspan fill="rgba(255,255,255,0.5)">
                    {" "}
                    {Math.round(n.value ?? 0)}
                  </tspan>
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>

      <p className="text-xs text-zinc-500">
        Hover en pile-strøm for at se antal PRs. Opened → Merged / Closed (uden
        merge) / Still open; merged PRs fordeles efter tid-til-merge. Baseret på
        op til 200 seneste PRs.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900">
      <div className="text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {note && <div className="text-xs text-zinc-500 mt-0.5">{note}</div>}
    </div>
  );
}
