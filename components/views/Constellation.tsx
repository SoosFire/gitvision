"use client";

// Interactive file-canvas — cards laid out via circle-packing by folder hierarchy.
// Optimized for readability and smoothness: no blur filters, memoized nodes,
// deferred slider updates, edges on-demand.

import { memo, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
} from "@xyflow/react";
import * as d3 from "d3";
import type { AnalysisSnapshot, FileHotspot, CoChangeEdge } from "@/lib/types";
import { FileDetailsPanel } from "./FileDetailsPanel";

// ------------------- Visual helpers -------------------

// File-extension palette. Stable and friendly to dark bg.
const EXT_COLORS: Record<string, { bg: string; ring: string; text: string }> = {
  ts:    { bg: "#1e3a5f", ring: "#3b82f6", text: "#93c5fd" },
  tsx:   { bg: "#134e4a", ring: "#2dd4bf", text: "#5eead4" },
  js:    { bg: "#5a4a1a", ring: "#eab308", text: "#fde047" },
  jsx:   { bg: "#5a4a1a", ring: "#eab308", text: "#fde047" },
  py:    { bg: "#1e3a5f", ring: "#60a5fa", text: "#93c5fd" },
  rs:    { bg: "#5a2e1a", ring: "#f97316", text: "#fdba74" },
  go:    { bg: "#164e63", ring: "#06b6d4", text: "#67e8f9" },
  java:  { bg: "#5a1a1a", ring: "#ef4444", text: "#fca5a5" },
  kt:    { bg: "#3b1a5a", ring: "#a855f7", text: "#d8b4fe" },
  swift: { bg: "#5a2e1a", ring: "#f97316", text: "#fdba74" },
  html:  { bg: "#5a2e1a", ring: "#ea580c", text: "#fdba74" },
  css:   { bg: "#3b1a5a", ring: "#c026d3", text: "#e9d5ff" },
  scss:  { bg: "#3b1a5a", ring: "#c026d3", text: "#e9d5ff" },
  md:    { bg: "#27272a", ring: "#71717a", text: "#a1a1aa" },
  mdx:   { bg: "#27272a", ring: "#71717a", text: "#a1a1aa" },
  json:  { bg: "#3f3f1f", ring: "#facc15", text: "#fde68a" },
  yml:   { bg: "#3f3f1f", ring: "#facc15", text: "#fde68a" },
  yaml:  { bg: "#3f3f1f", ring: "#facc15", text: "#fde68a" },
  toml:  { bg: "#3f3f1f", ring: "#facc15", text: "#fde68a" },
  sh:    { bg: "#052e16", ring: "#22c55e", text: "#86efac" },
  sql:   { bg: "#3b0a4a", ring: "#d946ef", text: "#e9d5ff" },
  vue:   { bg: "#064e3b", ring: "#10b981", text: "#6ee7b7" },
  svelte:{ bg: "#5a1e0e", ring: "#f97316", text: "#fdba74" },
};
const DEFAULT_COLOR = { bg: "#262628", ring: "#52525b", text: "#d4d4d8" };

function fileExt(path: string): string {
  const m = path.match(/\.([^./]+)$/);
  return m ? m[1].toLowerCase() : "";
}

function colorFor(path: string) {
  return EXT_COLORS[fileExt(path)] ?? DEFAULT_COLOR;
}

function fileBasename(path: string): string {
  return path.split("/").pop() || path;
}

// Show "parent/basename" for files whose basename alone is ambiguous
// (e.g. package.json, README.md, index.ts — very common in monorepos).
const AMBIGUOUS_BASENAMES = new Set([
  "package.json",
  "package-lock.json",
  "readme.md",
  "changelog.md",
  "license",
  "license.md",
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
    // packages/next/package.json → next/package.json
    return `${parts[parts.length - 2]}/${base}`;
  }
  return base;
}

function folderOf(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts[0] : "/";
}

function ageDays(iso: string): number {
  if (!iso) return 9999;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

// Metadata / noise files that tend to dominate hotspots on monorepos and
// release-heavy projects without telling you much about the *code*.
// Matched case-insensitively against the basename unless marked exact.
const METADATA_BASENAMES = new Set<string>([
  "readme.md",
  "readme",
  "changelog.md",
  "changelog",
  "license",
  "license.md",
  "license.txt",
  "contributing.md",
  "code_of_conduct.md",
  "security.md",
  "authors",
  "notice",
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "cargo.toml",
  "cargo.lock",
  "go.mod",
  "go.sum",
  "gemfile",
  "gemfile.lock",
  "pipfile",
  "pipfile.lock",
  "requirements.txt",
  "poetry.lock",
  "pyproject.toml",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".nvmrc",
  ".node-version",
  ".python-version",
  ".ruby-version",
  "dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
]);
const METADATA_PATTERNS: RegExp[] = [
  /\.prettierrc($|\.)/i,
  /\.eslintrc($|\.)/i,
  /\.stylelintrc($|\.)/i,
  /tsconfig(\.[^.]+)?\.json$/i,
  /jsconfig\.json$/i,
  /\.config\.(js|cjs|mjs|ts)$/i, // jest/webpack/vite/next/rollup/etc.
  /^\.github\//i, // workflows, issue templates, etc.
];

function isMetadataFile(path: string): boolean {
  const base = (path.split("/").pop() ?? "").toLowerCase();
  if (METADATA_BASENAMES.has(base)) return true;
  for (const re of METADATA_PATTERNS) {
    if (re.test(path)) return true;
  }
  return false;
}

// ------------------- Custom file node (card) -------------------

interface FileNodeData extends Record<string, unknown> {
  hotspot: FileHotspot;
  isHot: boolean;
  isSelected: boolean;
  isDimmed: boolean;
  authorTint?: { bg: string; ring: string; text: string; authorLogin: string };
  onSelect: (path: string) => void;
}

const FileNode = memo(function FileNode({ data }: NodeProps) {
  const { hotspot, isHot, isSelected, isDimmed, authorTint, onSelect } =
    data as FileNodeData;
  const c = authorTint ?? colorFor(hotspot.path);
  const name = fileDisplayName(hotspot.path);
  const recent = ageDays(hotspot.lastModified) < 7;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect(hotspot.path);
      }}
      className={`rounded-lg border px-2.5 py-1.5 cursor-pointer select-none transition-opacity ${
        isDimmed ? "opacity-25" : "opacity-100"
      }`}
      style={{
        background: c.bg,
        borderColor: isSelected ? "#ffffff" : c.ring,
        borderWidth: isSelected ? 2 : 1,
        width: 150, // exact match with layout's CARD_W — prevents overflow
        boxShadow: isSelected
          ? `0 0 0 3px rgba(255,255,255,0.15)`
          : isHot
          ? `0 0 0 1px ${c.ring}55`
          : "none",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: "none" }} />

      <div className="flex items-center gap-1.5">
        {/* small extension dot */}
        <span
          className="h-1.5 w-1.5 rounded-full shrink-0"
          style={{ background: c.ring }}
        />
        <span
          className="font-mono text-[11px] leading-tight truncate"
          style={{ color: c.text }}
          title={hotspot.path}
        >
          {name}
        </span>
        {recent && (
          <span
            className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0"
            title="changed in the last 7 days"
          />
        )}
      </div>

      {/* churn bar */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-[9px] font-mono text-white/50 tabular-nums w-4 text-right">
          {hotspot.churn}
        </span>
        <div
          className="flex-1 h-1 rounded-full overflow-hidden"
          style={{ background: "rgba(255,255,255,0.08)" }}
        >
          <div
            className="h-full rounded-full"
            style={{
              background: c.ring,
              width: `${Math.min(100, hotspot.churn * 10)}%`,
            }}
          />
        </div>
        {hotspot.authors > 1 && (
          <span
            className="text-[9px] font-mono text-white/70 tabular-nums"
            title={`${hotspot.authors} unique authors`}
          >
            {hotspot.authors}👥
          </span>
        )}
      </div>
    </div>
  );
});

// ------------------- Folder frame node -------------------

interface FolderNodeData extends Record<string, unknown> {
  folder: string;
  fileCount: number;
  width: number;
  height: number;
}

const FolderNode = memo(function FolderNode({ data }: NodeProps) {
  const { folder, fileCount, width, height } = data as FolderNodeData;
  const label = folder === "/" ? "root" : folder;
  return (
    <div
      className="relative rounded-xl border pointer-events-none"
      style={{
        width,
        height,
        background: "rgba(255, 255, 255, 0.03)",
        borderColor: "rgba(255, 255, 255, 0.12)",
      }}
    >
      <div
        className="absolute flex items-center gap-1.5 font-mono pointer-events-none"
        style={{
          top: -22,
          left: 2,
          fontSize: 11,
          color: "rgba(255, 255, 255, 0.92)",
          textShadow: "0 1px 2px rgba(0,0,0,0.6)",
          letterSpacing: 0.2,
        }}
      >
        <span
          style={{
            height: 6,
            width: 6,
            borderRadius: 999,
            background: "rgba(255, 255, 255, 0.55)",
          }}
        />
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ color: "rgba(255, 255, 255, 0.45)" }}>·</span>
        <span
          className="tabular-nums"
          style={{ color: "rgba(255, 255, 255, 0.65)" }}
        >
          {fileCount} {fileCount === 1 ? "file" : "files"}
        </span>
      </div>
    </div>
  );
});

// Frozen at module scope so the reference is stable across renders AND HMR
// updates — React Flow warns otherwise. `Object.freeze` is a belt-and-braces
// hint that this object should never be mutated.
const NODE_TYPES = Object.freeze({ file: FileNode, folder: FolderNode });

// ------------------- Layout -------------------

interface PackedNode {
  path: string;
  x: number;
  y: number;
  r: number;
}

interface FolderBlock {
  folder: string;
  x: number; // top-left
  y: number;
  w: number;
  h: number;
  fileCount: number;
}

// Shelf-packing layout: each folder gets exactly the grid space it needs,
// then folder blocks are packed into rows with a shelf-fill algorithm.
// Guarantees zero overlap between cards or folders.
interface LayoutResult {
  positions: Map<string, PackedNode>;
  folders: FolderBlock[];
}

function packByFolder(
  hotspots: FileHotspot[],
  availableWidth: number
): LayoutResult {
  const CARD_W = 150;
  const CARD_H = 54;
  const CARD_GAP_X = 20;
  const CARD_GAP_Y = 16;
  const FOLDER_PAD = 20;
  const FOLDER_GAP = 56; // extra room for folder labels above blocks

  const byFolder = d3.group(hotspots, (h) => folderOf(h.path));

  // Compute the exact block dimensions each folder needs
  const blocks = [...byFolder.entries()].map(([folder, files]) => {
    const n = files.length;
    // Aim for a wider-than-tall aspect — reads more naturally
    const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt(n * 2.5))));
    const rows = Math.ceil(n / cols);
    const w = cols * CARD_W + (cols - 1) * CARD_GAP_X + FOLDER_PAD * 2;
    const h = rows * CARD_H + (rows - 1) * CARD_GAP_Y + FOLDER_PAD * 2;
    return { folder, files, cols, rows, w, h, n };
  });

  // Biggest blocks first — helps shelf packing use space well
  blocks.sort((a, b) => b.h - a.h || b.n - a.n);

  const positions = new Map<string, PackedNode>();
  const folders: FolderBlock[] = [];
  let x = 0;
  let y = 0;
  let shelfH = 0;

  for (const b of blocks) {
    if (x > 0 && x + b.w > availableWidth) {
      y += shelfH + FOLDER_GAP;
      x = 0;
      shelfH = 0;
    }

    folders.push({
      folder: b.folder,
      x,
      y,
      w: b.w,
      h: b.h,
      fileCount: b.n,
    });

    // Lay cards inside this folder block, sorted by churn desc (hot first)
    const sorted = [...b.files].sort((a, b) => b.churn - a.churn);
    sorted.forEach((f, i) => {
      const col = i % b.cols;
      const row = Math.floor(i / b.cols);
      const cx = x + FOLDER_PAD + col * (CARD_W + CARD_GAP_X) + CARD_W / 2;
      const cy = y + FOLDER_PAD + row * (CARD_H + CARD_GAP_Y) + CARD_H / 2;
      positions.set(f.path, { path: f.path, x: cx, y: cy, r: CARD_W / 2 });
    });

    x += b.w + FOLDER_GAP;
    shelfH = Math.max(shelfH, b.h);
  }

  return { positions, folders };
}

// ------------------- Constellation -------------------

interface Props {
  snapshot: AnalysisSnapshot;
}

// Author color palette — up to 10 distinct hues, rest fall back to neutral gray.
// Chosen for reasonable contrast on dark bg + rough colorblind-friendliness.
const AUTHOR_PALETTE: Array<{ bg: string; ring: string; text: string }> = [
  { bg: "#1e3a5f", ring: "#3b82f6", text: "#bfdbfe" },
  { bg: "#134e4a", ring: "#14b8a6", text: "#99f6e4" },
  { bg: "#5a2e1a", ring: "#f97316", text: "#fed7aa" },
  { bg: "#3b1a5a", ring: "#a855f7", text: "#e9d5ff" },
  { bg: "#5a1a1a", ring: "#ef4444", text: "#fecaca" },
  { bg: "#1a5a3b", ring: "#22c55e", text: "#bbf7d0" },
  { bg: "#5a4a1a", ring: "#eab308", text: "#fef08a" },
  { bg: "#4a1a5a", ring: "#d946ef", text: "#f5d0fe" },
  { bg: "#164e63", ring: "#06b6d4", text: "#a5f3fc" },
  { bg: "#5a1a3e", ring: "#ec4899", text: "#fbcfe8" },
];
const AUTHOR_OTHER = { bg: "#262628", ring: "#52525b", text: "#d4d4d8" };

function ConstellationInner({ snapshot }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [minChurnInput, setMinChurnInput] = useState(1);
  const minChurn = useDeferredValue(minChurnInput); // smooth slider
  const [showEdges, setShowEdges] = useState(false);
  const [showMinimap, setShowMinimap] = useState(false);
  const [hideMetadata, setHideMetadata] = useState(false);
  const [colorBy, setColorBy] = useState<"type" | "author">("type");
  const [searchInput, setSearchInput] = useState("");
  const search = useDeferredValue(searchInput.trim().toLowerCase());
  const [timeIndex, setTimeIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [granularity, setGranularity] = useState<"week" | "day" | "commit">(
    "week"
  );
  const { fitView } = useReactFlow();

  // Defensive: old snapshots may lack these fields
  const allCoChange = snapshot.coChange ?? [];
  const rawHotspots = useMemo(
    () =>
      (snapshot.hotspots ?? []).map((h) => ({
        ...h,
        authorLogins: h.authorLogins ?? [],
        commits: h.commits ?? [],
      })),
    [snapshot.hotspots]
  );

  // sha → date + authorLogin. Prefer `commitIndex` (full history) when present,
  // fall back to the trimmed `recentCommits` list otherwise.
  const shaMeta = useMemo(() => {
    const m = new Map<string, { date: string; authorLogin: string | null }>();
    if (snapshot.commitIndex) {
      for (const [sha, meta] of Object.entries(snapshot.commitIndex)) {
        m.set(sha, { date: meta.d, authorLogin: meta.a });
      }
    }
    // recentCommits still overrides — in case commitIndex was truncated
    for (const c of snapshot.recentCommits ?? []) {
      m.set(c.sha, { date: c.date, authorLogin: c.authorLogin });
    }
    return m;
  }, [snapshot.commitIndex, snapshot.recentCommits]);

  // Only commits that were deep-analyzed (i.e. have file data) drive hotspots.
  // When commitIndex is present we use it (full history); otherwise the scrubber
  // window collapses to whatever recentCommits covers.
  const hotspotCommits = useMemo(() => {
    const shas = new Set<string>();
    for (const h of rawHotspots) for (const sha of h.commits) shas.add(sha);
    const out: Array<{ sha: string; t: number }> = [];
    for (const sha of shas) {
      const meta = shaMeta.get(sha);
      if (!meta?.date) continue;
      const t = new Date(meta.date).getTime();
      if (Number.isNaN(t)) continue;
      out.push({ sha, t });
    }
    return out.sort((a, b) => a.t - b.t);
  }, [rawHotspots, shaMeta]);

  // Time buckets: each step = { label, cutoff } at the chosen granularity.
  // All three granularities span only the window with file data.
  const timeBuckets = useMemo<
    Array<{ label: string; cutoff: number }>
  >(() => {
    if (hotspotCommits.length === 0) return [];

    if (granularity === "commit") {
      return hotspotCommits.map((c) => ({
        label: new Date(c.t).toISOString().slice(0, 16).replace("T", " "),
        cutoff: c.t + 1,
      }));
    }

    const DAY = 24 * 60 * 60 * 1000;
    if (granularity === "day") {
      const first = Math.floor(hotspotCommits[0].t / DAY) * DAY;
      const last =
        Math.floor(hotspotCommits[hotspotCommits.length - 1].t / DAY) * DAY;
      const out: Array<{ label: string; cutoff: number }> = [];
      for (let t = first; t <= last; t += DAY) {
        out.push({
          label: new Date(t).toISOString().slice(0, 10),
          cutoff: t + DAY,
        });
      }
      return out;
    }

    // Week: derive Monday-keyed buckets from hotspotCommits only
    const weekMap = new Map<string, number>();
    for (const c of hotspotCommits) {
      const d = new Date(c.t);
      const dow = d.getUTCDay();
      const shift = dow === 0 ? -6 : 1 - dow;
      const monday = Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate() + shift
      );
      const key = new Date(monday).toISOString().slice(0, 10);
      weekMap.set(key, monday);
    }
    return [...weekMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, start]) => ({
        label,
        cutoff: start + 7 * DAY,
      }));
  }, [granularity, hotspotCommits]);

  // Reset the scrubber when granularity changes — the index range shifts
  useEffect(() => {
    setTimeIndex(null);
    setPlaying(false);
  }, [granularity]);

  // Apply time-scrubber: recompute churn/authors/score using only commits up to cutoff
  const allHotspots = useMemo(() => {
    if (timeIndex == null || timeBuckets.length === 0) return rawHotspots;
    const cutoff =
      timeBuckets[Math.min(timeIndex, timeBuckets.length - 1)].cutoff;

    return rawHotspots
      .map((h) => {
        const inWindow = h.commits.filter((sha) => {
          const d = shaMeta.get(sha)?.date;
          return d && new Date(d).getTime() <= cutoff;
        });
        const authors = new Set<string>();
        let lastModified = "";
        for (const sha of inWindow) {
          const meta = shaMeta.get(sha);
          if (meta?.authorLogin) authors.add(meta.authorLogin);
          if (meta?.date && meta.date > lastModified) lastModified = meta.date;
        }
        const churn = inWindow.length;
        const authorList = [...authors];
        return {
          ...h,
          commits: inWindow,
          churn,
          authors: authorList.length,
          authorLogins: authorList,
          lastModified: lastModified || h.lastModified,
          score: churn * Math.log(authorList.length + 1),
        };
      })
      .filter((h) => h.churn > 0);
  }, [rawHotspots, timeIndex, timeBuckets, shaMeta]);

  // Auto-play advances timeIndex. Faster step at finer granularity so the
  // animation feels the same duration regardless of step count.
  const playStepMs =
    granularity === "commit" ? 180 : granularity === "day" ? 380 : 900;
  useEffect(() => {
    if (!playing) return;
    if (timeIndex == null) {
      setTimeIndex(0);
      return;
    }
    if (timeBuckets.length === 0) return;
    const id = setTimeout(() => {
      setTimeIndex((prev) => {
        if (prev == null) return 0;
        if (prev >= timeBuckets.length - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, playStepMs);
    return () => clearTimeout(id);
  }, [playing, timeIndex, timeBuckets.length, playStepMs]);

  // Soft cap to keep canvas readable — users can reveal more via the slider.
  const MAX_VISIBLE = 60;
  const metadataCount = useMemo(
    () => allHotspots.filter((h) => isMetadataFile(h.path)).length,
    [allHotspots]
  );
  const visibleHotspots = useMemo(() => {
    const filtered = allHotspots.filter((h) => {
      if (h.churn < minChurn) return false;
      if (hideMetadata && isMetadataFile(h.path)) return false;
      if (search && !h.path.toLowerCase().includes(search)) return false;
      return true;
    });
    return filtered
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_VISIBLE);
  }, [allHotspots, minChurn, search, hideMetadata]);

  const visiblePaths = useMemo(
    () => new Set(visibleHotspots.map((h) => h.path)),
    [visibleHotspots]
  );
  const visibleEdges = useMemo<CoChangeEdge[]>(
    () =>
      allCoChange.filter(
        (e) => visiblePaths.has(e.from) && visiblePaths.has(e.to)
      ),
    [allCoChange, visiblePaths]
  );

  // Related files of the selected one — drives dimming
  const relatedPaths = useMemo(() => {
    if (!selected) return null;
    const related = new Set<string>([selected]);
    for (const e of allCoChange) {
      if (e.from === selected) related.add(e.to);
      if (e.to === selected) related.add(e.from);
    }
    return related;
  }, [selected, allCoChange]);

  // Layout — shelf-packed folder blocks, each containing a grid of file cards
  const layout = useMemo(() => {
    // Shelf width scales with file count so layout flows nicely at any size
    const targetWidth = Math.max(1200, Math.ceil(Math.sqrt(visibleHotspots.length) * 260));
    return packByFolder(visibleHotspots, targetWidth);
  }, [visibleHotspots]);
  const packedPositions = layout.positions;
  const folderBlocks = layout.folders;

  // Auto-fit whenever the set of visible nodes changes. requestAnimationFrame
  // gives React Flow a tick to apply the new positions before we fit.
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      fitView({ padding: 0.1, duration: 300 })
    );
    return () => cancelAnimationFrame(id);
  }, [layout, fitView]);

  // Dominant author per file: count commits per author from shaMeta (full
  // history when available, recentCommits otherwise).
  const { dominantAuthor, authorRank } = useMemo(() => {
    const shaToAuthor = new Map<string, string>();
    for (const [sha, meta] of shaMeta) {
      if (meta.authorLogin) shaToAuthor.set(sha, meta.authorLogin);
    }
    const dominant = new Map<string, string>();
    const globalCount = new Map<string, number>();
    for (const h of allHotspots) {
      const counts = new Map<string, number>();
      for (const sha of h.commits ?? []) {
        const a = shaToAuthor.get(sha);
        if (!a) continue;
        counts.set(a, (counts.get(a) ?? 0) + 1);
      }
      let best: string | null = null;
      let bestN = 0;
      for (const [a, n] of counts) {
        if (n > bestN) {
          best = a;
          bestN = n;
        }
      }
      if (!best && h.authorLogins.length > 0) best = h.authorLogins[0];
      if (best) {
        dominant.set(h.path, best);
        globalCount.set(best, (globalCount.get(best) ?? 0) + 1);
      }
    }
    const rank = [...globalCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([a], i) => [a, i] as const);
    return {
      dominantAuthor: dominant,
      authorRank: new Map<string, number>(rank),
    };
  }, [allHotspots, shaMeta]);

  const authorTintFor = (path: string) => {
    if (colorBy !== "author") return undefined;
    const login = dominantAuthor.get(path);
    if (!login) return { ...AUTHOR_OTHER, authorLogin: "unknown" };
    const idx = authorRank.get(login) ?? -1;
    const pal = idx >= 0 && idx < AUTHOR_PALETTE.length
      ? AUTHOR_PALETTE[idx]
      : AUTHOR_OTHER;
    return { ...pal, authorLogin: login };
  };

  // Top authors for the legend (max 10)
  const authorLegend = useMemo(() => {
    if (colorBy !== "author") return [];
    return [...authorRank.entries()]
      .filter(([, idx]) => idx < AUTHOR_PALETTE.length)
      .sort((a, b) => a[1] - b[1])
      .map(([login, idx]) => ({ login, color: AUTHOR_PALETTE[idx].ring }));
  }, [authorRank, colorBy]);

  // Threshold for "hot" (top 15%)
  const hotThreshold = useMemo(() => {
    if (visibleHotspots.length === 0) return Infinity;
    const scores = visibleHotspots.map((h) => h.score).sort(d3.ascending);
    return d3.quantile(scores, 0.85) ?? Infinity;
  }, [visibleHotspots]);

  const rfNodes: Node[] = useMemo(() => {
    // Folder frames first → they render behind file cards (first in array = bottom)
    const folderNodes: Node[] = folderBlocks.map((fb) => ({
      id: `folder:${fb.folder}`,
      type: "folder",
      position: { x: fb.x, y: fb.y },
      data: {
        folder: fb.folder,
        fileCount: fb.fileCount,
        width: fb.w,
        height: fb.h,
      } as FolderNodeData,
      draggable: false,
      selectable: false,
      zIndex: -1,
    }));

    const fileNodes: Node[] = visibleHotspots.map((h) => {
      const pos = packedPositions.get(h.path);
      const isSelected = selected === h.path;
      const isHot = h.score >= hotThreshold && h.authors > 1;
      const isDimmed = !!selected && !!relatedPaths && !relatedPaths.has(h.path);
      // Position from packedPositions is the card CENTER; React Flow expects top-left.
      const x = (pos?.x ?? 0) - 75; // 150 / 2
      const y = (pos?.y ?? 0) - 27; // 54 / 2
      return {
        id: h.path,
        type: "file",
        position: { x, y },
        data: {
          hotspot: h,
          isHot,
          isSelected,
          isDimmed,
          authorTint: authorTintFor(h.path),
          onSelect: setSelected,
        } as FileNodeData,
        draggable: true,
        selectable: false, // we handle selection ourselves
      };
    });

    return [...folderNodes, ...fileNodes];
  }, [
    visibleHotspots,
    packedPositions,
    folderBlocks,
    selected,
    hotThreshold,
    relatedPaths,
    colorBy,
    dominantAuthor,
    authorRank,
  ]);

  const rfEdges: Edge[] = useMemo(() => {
    // Edges always kept in memory; visibility toggled via React Flow prop below.
    const selectedEdges = selected
      ? visibleEdges.filter((e) => e.from === selected || e.to === selected)
      : [];
    const displayed = showEdges ? visibleEdges : selectedEdges;
    return displayed.map((e) => ({
      id: `${e.from}-${e.to}`,
      source: e.from,
      target: e.to,
      type: "straight",
      style: {
        stroke:
          selected && (e.from === selected || e.to === selected)
            ? "rgba(255,255,255,0.55)"
            : "rgba(255,255,255,0.12)",
        strokeWidth: Math.min(3, 0.8 + e.count * 0.4),
      },
    }));
  }, [visibleEdges, showEdges, selected]);

  const selectedHotspot = selected
    ? allHotspots.find((h) => h.path === selected) ?? null
    : null;

  const maxChurn = Math.max(1, ...allHotspots.map((h) => h.churn));

  return (
    <div
      className="relative rounded-xl overflow-hidden"
      style={{
        width: "100%",
        height: 680,
        background: "#0a0a0c",
        border: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      {/* Controls */}
      <div
        className="absolute z-10 top-3 left-3 flex items-center gap-3 backdrop-blur rounded-lg px-3 py-2 text-xs text-white border border-white/10 shadow-lg flex-wrap max-w-[calc(100%-24px)]"
        style={{ background: "rgba(10, 10, 12, 0.92)" }}
      >
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="filter path…"
          className="bg-white/5 text-white placeholder:text-white/40 rounded px-2 py-0.5 border border-white/10 text-xs outline-none w-36 focus:border-white/30"
        />
        <div className="h-4 w-px bg-white/15" />
        <div className="flex items-center gap-2">
          <label className="text-white/60">Min churn</label>
          <input
            type="range"
            min={1}
            max={Math.min(15, maxChurn)}
            value={minChurnInput}
            onChange={(e) => setMinChurnInput(Number(e.target.value))}
            className="w-20"
          />
          <span className="tabular-nums w-5 text-right">{minChurnInput}</span>
        </div>
        <div className="h-4 w-px bg-white/15" />
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showEdges}
            onChange={(e) => setShowEdges(e.target.checked)}
          />
          <span>All edges</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showMinimap}
            onChange={(e) => setShowMinimap(e.target.checked)}
          />
          <span>Minimap</span>
        </label>
        {metadataCount > 0 && (
          <label
            className="flex items-center gap-1.5 cursor-pointer"
            title="Hide README, package.json, CHANGELOG, lockfiles, etc."
          >
            <input
              type="checkbox"
              checked={hideMetadata}
              onChange={(e) => setHideMetadata(e.target.checked)}
            />
            <span>Hide metadata ({metadataCount})</span>
          </label>
        )}
        <div className="h-4 w-px bg-white/15" />
        <label className="flex items-center gap-1.5">
          <span className="text-white/60">Color</span>
          <select
            value={colorBy}
            onChange={(e) => setColorBy(e.target.value as "type" | "author")}
            className="bg-white/5 text-white rounded px-1.5 py-0.5 border border-white/10 text-xs outline-none cursor-pointer"
          >
            <option value="type">by type</option>
            <option value="author">by author</option>
          </select>
        </label>
        <div className="h-4 w-px bg-white/15" />
        <span className="text-white/40 tabular-nums">
          {visibleHotspots.length}
          {allHotspots.length > visibleHotspots.length
            ? ` / ${allHotspots.length}`
            : ""}{" "}
          files · {visibleEdges.length} links
        </span>
      </div>

      {/* Legend */}
      <div
        className="absolute z-10 bottom-3 left-3 backdrop-blur rounded-lg px-3 py-2 text-[11px] text-white/70 border border-white/10 shadow-lg max-w-[calc(100%-24px)]"
        style={{ background: "rgba(10, 10, 12, 0.92)" }}
      >
        {colorBy === "type" ? (
          <div>
            Color = file type · Bar = churn · Green dot = recent · 👥 =
            multi-author
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div>
              Color = dominant author (most commits touching the file in the
              sample)
            </div>
            {authorLegend.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {authorLegend.map((a) => (
                  <span
                    key={a.login}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-white/10"
                    style={{ background: "rgba(255,255,255,0.03)" }}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: a.color }}
                    />
                    <span className="font-mono">{a.login}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.15}
        maxZoom={2.5}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        onPaneClick={() => setSelected(null)}
        defaultEdgeOptions={{ type: "straight" }}
      >
        <Background color="#1a1a1d" gap={28} size={1} />
        <Controls
          showInteractive={false}
          style={{
            background: "rgba(0,0,0,0.6)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        />
        {showMinimap && (
          <MiniMap
            pannable
            zoomable
            maskColor="rgba(0,0,0,0.75)"
            nodeColor={(n) => {
              const d = n.data as FileNodeData;
              return colorFor(d.hotspot.path).ring;
            }}
            style={{ background: "rgba(0,0,0,0.6)" }}
          />
        )}
      </ReactFlow>

      {selectedHotspot && (
        <FileDetailsPanel
          hotspot={selectedHotspot}
          coChange={allCoChange}
          recentCommits={snapshot.recentCommits}
          repo={snapshot.repo}
          onClose={() => setSelected(null)}
        />
      )}

      {allHotspots.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-white/60 text-sm">
          No hotspot data yet — try Refresh to fetch fresh commits.
        </div>
      )}

      {timeBuckets.length > 1 && (
        <div
          className="absolute z-10 bottom-3 right-3 backdrop-blur rounded-lg px-3 py-2 text-[11px] text-white/80 border border-white/10 shadow-lg flex items-center gap-3"
          style={{
            background: "rgba(10, 10, 12, 0.92)",
            width: "min(560px, calc(100% - 260px))",
          }}
        >
          <button
            onClick={() => {
              if (timeIndex == null) setTimeIndex(0);
              setPlaying((p) => !p);
            }}
            className="h-7 w-7 rounded-md bg-white/10 hover:bg-white/20 transition flex items-center justify-center shrink-0"
            title={playing ? "Pause" : "Play timeline"}
          >
            {playing ? "⏸" : "▶"}
          </button>
          <select
            value={granularity}
            onChange={(e) =>
              setGranularity(e.target.value as "week" | "day" | "commit")
            }
            className="bg-white/5 text-white rounded px-1.5 py-0.5 border border-white/10 text-[11px] outline-none cursor-pointer shrink-0"
            title="Timeline granularity"
          >
            <option value="week">Week</option>
            <option value="day">Day</option>
            <option value="commit">Commit</option>
          </select>
          <input
            type="range"
            min={0}
            max={timeBuckets.length - 1}
            value={timeIndex ?? timeBuckets.length - 1}
            onChange={(e) => {
              setPlaying(false);
              setTimeIndex(Number(e.target.value));
            }}
            className="flex-1 min-w-0"
          />
          <span className="text-white/70 tabular-nums font-mono shrink-0">
            {timeIndex != null
              ? timeBuckets[Math.min(timeIndex, timeBuckets.length - 1)].label
              : "now"}
          </span>
          {timeIndex != null && (
            <button
              onClick={() => {
                setTimeIndex(null);
                setPlaying(false);
              }}
              className="text-white/60 hover:text-white transition text-[11px] shrink-0"
              title="Show full timeline"
            >
              reset
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function Constellation(props: Props) {
  return (
    <ReactFlowProvider>
      <ConstellationInner {...props} />
    </ReactFlowProvider>
  );
}
