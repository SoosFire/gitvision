"use client";

// Dependency Canvas — renders a FileGraph as a layered, brick-stagger grid.
//
// Scale strategy for big repos: *filtering*, not aggregation.
//   - Hide isolated files (no incoming or outgoing edges) — default on for >100 files
//   - Text filter — paths not matching are hidden
//   - Minimap — default on for >100 files so you can navigate
//   - Click a file → neighbors highlighted, rest dimmed
//
// Layout: BFS depth layers, adaptive cols-per-row with brick stagger for
// an organic "pyramid" feel.

import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import type {
  FileGraph,
  FileGraphEdge,
  FileGraphEdgeKind,
} from "@/lib/types";

// ------------------- Visual tokens -------------------

const EXT_STYLE: Record<
  string,
  { bg: string; ring: string; text: string; lang: string }
> = {
  tsx: { bg: "#134e4a", ring: "#2dd4bf", text: "#5eead4", lang: "TSX" },
  ts: { bg: "#1e3a5f", ring: "#3b82f6", text: "#93c5fd", lang: "TS" },
  js: { bg: "#5a4a1a", ring: "#eab308", text: "#fde047", lang: "JS" },
  jsx: { bg: "#5a4a1a", ring: "#eab308", text: "#fde047", lang: "JSX" },
  mjs: { bg: "#5a4a1a", ring: "#eab308", text: "#fde047", lang: "MJS" },
  cjs: { bg: "#5a4a1a", ring: "#eab308", text: "#fde047", lang: "CJS" },
  py: { bg: "#1e3a5f", ring: "#60a5fa", text: "#93c5fd", lang: "Py" },
  go: { bg: "#164e63", ring: "#06b6d4", text: "#67e8f9", lang: "Go" },
  rs: { bg: "#5a2e1a", ring: "#f97316", text: "#fdba74", lang: "Rust" },
  java: { bg: "#5a1a1a", ring: "#ef4444", text: "#fca5a5", lang: "Java" },
  kt: { bg: "#3b1a5a", ring: "#a855f7", text: "#d8b4fe", lang: "Kotlin" },
  cs: { bg: "#134e4a", ring: "#22c55e", text: "#86efac", lang: "C#" },
  php: { bg: "#1e2a5f", ring: "#6366f1", text: "#a5b4fc", lang: "PHP" },
  rb: { bg: "#5a1a1a", ring: "#dc2626", text: "#fca5a5", lang: "Ruby" },
  html: { bg: "#5a2e1a", ring: "#ea580c", text: "#fdba74", lang: "HTML" },
  css: { bg: "#3b1a5a", ring: "#c026d3", text: "#e9d5ff", lang: "CSS" },
};
const FALLBACK = { bg: "#262628", ring: "#52525b", text: "#d4d4d8", lang: "?" };

const EDGE_COLOR: Record<
  FileGraphEdgeKind,
  { stroke: string; strokeDim: string; dash?: string }
> = {
  import: {
    stroke: "rgba(96, 165, 250, 0.9)",
    strokeDim: "rgba(96, 165, 250, 0.18)",
  },
  renders: {
    stroke: "rgba(134, 239, 172, 0.95)",
    strokeDim: "rgba(134, 239, 172, 0.5)",
    dash: "5 3",
  },
  extends: {
    stroke: "rgba(244, 114, 182, 0.95)",
    strokeDim: "rgba(244, 114, 182, 0.4)",
  },
  implements: {
    stroke: "rgba(244, 114, 182, 0.95)",
    strokeDim: "rgba(244, 114, 182, 0.4)",
    dash: "2 3",
  },
};

const KIND_LABEL: Record<FileGraphEdgeKind, string> = {
  import: "Imports",
  renders: "Renders",
  extends: "Extends",
  implements: "Implements",
};

// ------------------- File node -------------------

interface FileNodeData extends Record<string, unknown> {
  path: string;
  ext: string;
  inDegree: number;
  outDegree: number;
  isSelected: boolean;
  isDimmed: boolean;
  isEntry: boolean;
  onSelect: (p: string) => void;
}

const handleStyle = { opacity: 0, pointerEvents: "none" as const };

const FileNode = memo(function FileNode({ data }: NodeProps) {
  const {
    path,
    ext,
    inDegree,
    outDegree,
    isSelected,
    isDimmed,
    isEntry,
    onSelect,
  } = data as FileNodeData;
  const c = EXT_STYLE[ext] ?? FALLBACK;
  const name = path.split("/").pop() || path;
  const parts = path.split("/");
  const dir = parts.length > 1 ? parts.slice(-3, -1).join("/") : "";

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect(path);
      }}
      className={`rounded-lg border cursor-pointer select-none transition-opacity ${
        isDimmed ? "opacity-15" : "opacity-100"
      }`}
      style={{
        background: c.bg,
        borderColor: isSelected ? "#ffffff" : c.ring,
        borderWidth: isSelected ? 2 : 1,
        width: 220,
        padding: "7px 10px",
        boxShadow: isSelected
          ? "0 0 0 3px rgba(255,255,255,0.15)"
          : isEntry
          ? `0 0 0 1px ${c.ring}66`
          : "none",
      }}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <Handle type="source" position={Position.Bottom} style={handleStyle} />

      <div className="flex items-center gap-1.5">
        <span
          className="h-1.5 w-1.5 rounded-full shrink-0"
          style={{ background: c.ring }}
        />
        <span
          className="font-mono text-[11px] leading-tight truncate"
          style={{ color: c.text }}
          title={path}
        >
          {name}
        </span>
        <span
          className="ml-auto text-[9px] font-mono uppercase tracking-wider shrink-0"
          style={{ color: "rgba(255,255,255,0.5)" }}
        >
          {c.lang}
        </span>
      </div>
      {dir && (
        <div
          className="text-[9px] font-mono mt-0.5 truncate"
          style={{ color: "rgba(255,255,255,0.4)" }}
          title={parts.slice(0, -1).join("/")}
        >
          …/{dir}
        </div>
      )}
      <div
        className="mt-1 flex items-center gap-3 text-[9px] font-mono"
        style={{ color: "rgba(255,255,255,0.6)" }}
      >
        <span title="files this imports">↓ {outDegree}</span>
        <span title="files that import this">↑ {inDegree}</span>
        {isEntry && (
          <span
            className="ml-auto px-1.5 rounded"
            style={{
              background: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.8)",
            }}
          >
            entry
          </span>
        )}
      </div>
    </div>
  );
});

const NODE_TYPES = Object.freeze({ file: FileNode });

// ------------------- Layout -------------------

const NODE_W = 220;
const NODE_GAP_X = 40;
const ROW_H = 96;
const LAYER_GAP = 120;
const MAX_PER_ROW_CAP = 26;

function layeredPositions(
  ids: string[],
  edges: Array<{ from: string; to: string }>
): Map<string, { x: number; y: number; layer: number }> {
  const incoming = new Map<string, Set<string>>();
  for (const id of ids) incoming.set(id, new Set());
  for (const e of edges) {
    if (!incoming.has(e.to) || !incoming.has(e.from)) continue;
    incoming.get(e.to)!.add(e.from);
  }

  const layer = new Map<string, number>();
  function compute(id: string, visiting: Set<string>): number {
    const cached = layer.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let l = 0;
    for (const src of incoming.get(id) ?? []) {
      l = Math.max(l, compute(src, visiting) + 1);
    }
    visiting.delete(id);
    layer.set(id, l);
    return l;
  }
  for (const id of ids) compute(id, new Set());

  const byLayer = new Map<number, string[]>();
  for (const id of ids) {
    const l = layer.get(id) ?? 0;
    const arr = byLayer.get(l) ?? [];
    arr.push(id);
    byLayer.set(l, arr);
  }
  for (const [, arr] of byLayer) arr.sort();

  const widest = Math.max(0, ...[...byLayer.values()].map((a) => a.length));
  const maxPerRow = Math.max(
    6,
    Math.min(MAX_PER_ROW_CAP, Math.ceil(Math.sqrt(widest * 3)))
  );

  const step = NODE_W + NODE_GAP_X;
  const out = new Map<string, { x: number; y: number; layer: number }>();
  const maxLayer = Math.max(0, ...byLayer.keys());
  let yCursor = 0;
  for (let l = 0; l <= maxLayer; l++) {
    const arr = byLayer.get(l) ?? [];
    const rows = Math.max(1, Math.ceil(arr.length / maxPerRow));
    for (let r = 0; r < rows; r++) {
      const start = r * maxPerRow;
      const end = Math.min(start + maxPerRow, arr.length);
      const count = end - start;
      const totalW = count * NODE_W + (count - 1) * NODE_GAP_X;
      const stagger = r % 2 === 1 ? step / 2 : 0;
      const startX = -totalW / 2 + stagger;
      for (let i = 0; i < count; i++) {
        out.set(arr[start + i], {
          x: startX + i * step,
          y: yCursor + r * ROW_H,
          layer: l,
        });
      }
    }
    yCursor += rows * ROW_H + LAYER_GAP;
  }
  return out;
}

// ------------------- Component -------------------

interface Props {
  graph: FileGraph;
}

function DependencyCanvasInner({ graph }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [filterInput, setFilterInput] = useState("");
  const filter = useDeferredValue(filterInput.trim().toLowerCase());
  const bigRepo = graph.nodes.length > 100;
  const [hideIsolated, setHideIsolated] = useState(bigRepo);
  const [showMinimap, setShowMinimap] = useState(bigRepo);
  const { fitView } = useReactFlow();

  const presentKinds = useMemo(() => {
    const s = new Set<FileGraphEdgeKind>();
    for (const e of graph.edges) s.add(e.kind);
    return s;
  }, [graph.edges]);

  const [enabledKinds, setEnabledKinds] = useState<
    Record<FileGraphEdgeKind, boolean>
  >({
    import: true,
    renders: true,
    extends: true,
    implements: true,
  });

  // Files that survive the filters (isolated + text filter)
  const visibleIds = useMemo(() => {
    const set = new Set<string>();
    for (const n of graph.nodes) {
      if (hideIsolated && n.inDegree === 0 && n.outDegree === 0) continue;
      if (filter && !n.path.toLowerCase().includes(filter)) continue;
      set.add(n.path);
    }
    return set;
  }, [graph.nodes, hideIsolated, filter]);

  const visibleEdges = useMemo(
    () =>
      graph.edges.filter(
        (e) => visibleIds.has(e.from) && visibleIds.has(e.to)
      ),
    [graph.edges, visibleIds]
  );

  // Re-layout whenever the visible set changes
  const positions = useMemo(() => {
    return layeredPositions([...visibleIds], visibleEdges);
  }, [visibleIds, visibleEdges]);

  // Refit after positions change
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      fitView({ padding: 0.08, duration: 300 })
    );
    return () => cancelAnimationFrame(id);
  }, [positions, fitView]);

  const neighbors = useMemo(() => {
    if (!selected) return null;
    const set = new Set<string>([selected]);
    for (const e of graph.edges) {
      if (e.from === selected) set.add(e.to);
      if (e.to === selected) set.add(e.from);
    }
    return set;
  }, [selected, graph.edges]);

  const nodes: Node[] = useMemo(
    () =>
      graph.nodes
        .filter((n) => visibleIds.has(n.path))
        .map((n) => {
          const pos = positions.get(n.path) ?? { x: 0, y: 0 };
          const isDimmed = !!neighbors && !neighbors.has(n.path);
          return {
            id: n.path,
            type: "file",
            position: { x: pos.x, y: pos.y },
            data: {
              path: n.path,
              ext: n.ext,
              inDegree: n.inDegree,
              outDegree: n.outDegree,
              isSelected: selected === n.path,
              isDimmed,
              isEntry: n.inDegree === 0,
              onSelect: setSelected,
            } as FileNodeData,
            draggable: true,
            selectable: false,
          };
        }),
    [graph.nodes, visibleIds, positions, neighbors, selected]
  );

  const edges: Edge[] = useMemo(
    () =>
      visibleEdges
        .filter((e) => enabledKinds[e.kind])
        .map((e) => {
          const isActive =
            !!selected && (e.from === selected || e.to === selected);
          const color = EDGE_COLOR[e.kind];
          return {
            id: `${e.kind}-${e.from}-${e.to}`,
            source: e.from,
            target: e.to,
            type: "smoothstep",
            animated: isActive,
            style: {
              stroke: isActive ? color.stroke : color.strokeDim,
              strokeWidth: isActive ? 2 : 1,
              ...(color.dash ? { strokeDasharray: color.dash } : {}),
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: isActive ? color.stroke : color.strokeDim,
              width: 12,
              height: 12,
            },
          };
        }),
    [visibleEdges, enabledKinds, selected]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of graph.edges) c[e.kind] = (c[e.kind] ?? 0) + 1;
    return c;
  }, [graph.edges]);

  const isolatedCount = useMemo(
    () =>
      graph.nodes.filter((n) => n.inDegree === 0 && n.outDegree === 0).length,
    [graph.nodes]
  );

  if (graph.nodes.length === 0) {
    return (
      <div
        className="rounded-xl p-8 text-center"
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        <p className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
          {graph.truncated
            ? `Dependency graph unavailable: ${graph.truncated}`
            : "No dependency data in this snapshot. Refresh to rebuild."}
        </p>
      </div>
    );
  }

  return (
    <div
      className="relative rounded-xl overflow-hidden"
      style={{
        width: "100%",
        height: 720,
        background: "#0a0a0c",
        border: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <div
        className="absolute z-10 top-3 left-3 flex items-center gap-3 backdrop-blur rounded-lg px-3 py-2 text-xs text-white border border-white/10 shadow-lg max-w-[calc(100%-24px)] flex-wrap"
        style={{ background: "rgba(10, 10, 12, 0.92)" }}
      >
        <input
          type="text"
          value={filterInput}
          onChange={(e) => setFilterInput(e.target.value)}
          placeholder="filter path…"
          className="bg-white/5 text-white placeholder:text-white/40 rounded px-2 py-0.5 border border-white/10 text-xs outline-none w-40 focus:border-white/30"
        />

        {isolatedCount > 0 && (
          <label
            className="flex items-center gap-1.5 cursor-pointer"
            title={`${isolatedCount} files have no imports in either direction`}
          >
            <input
              type="checkbox"
              checked={hideIsolated}
              onChange={(e) => setHideIsolated(e.target.checked)}
            />
            <span className="text-white/75">
              Skjul isolerede ({isolatedCount})
            </span>
          </label>
        )}

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showMinimap}
            onChange={(e) => setShowMinimap(e.target.checked)}
          />
          <span className="text-white/75">Minimap</span>
        </label>

        <div className="h-4 w-px bg-white/15" />

        {(Object.keys(enabledKinds) as FileGraphEdgeKind[])
          .filter((k) => presentKinds.has(k))
          .map((k) => {
            const col = EDGE_COLOR[k].stroke;
            return (
              <label
                key={k}
                className="flex items-center gap-1.5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={enabledKinds[k]}
                  onChange={(e) =>
                    setEnabledKinds((prev) => ({
                      ...prev,
                      [k]: e.target.checked,
                    }))
                  }
                />
                <span style={{ color: col }}>
                  {KIND_LABEL[k]} ({counts[k] ?? 0})
                </span>
              </label>
            );
          })}

        <div className="h-4 w-px bg-white/15" />
        <span className="text-white/50 tabular-nums">
          {visibleIds.size}/{graph.nodes.length} filer
          {selected ? ` · valgt: ${selected.split("/").pop()}` : ""}
        </span>
      </div>

      <div
        className="absolute z-10 bottom-3 left-3 backdrop-blur rounded-lg px-3 py-2 text-[11px] text-white/70 border border-white/10 shadow-lg"
        style={{ background: "rgba(10, 10, 12, 0.92)" }}
      >
        Klik en fil for at isolere dens naboer · Pil = A → B betyder A bruger B
        · Entry-badge = intet andet peger på den
      </div>

      {graph.truncated && (
        <div
          className="absolute z-10 top-3 right-3 backdrop-blur rounded-lg px-3 py-2 text-[11px] border shadow-lg"
          style={{
            background: "rgba(120, 70, 10, 0.85)",
            color: "rgba(253, 224, 171, 0.95)",
            borderColor: "rgba(253, 186, 116, 0.25)",
          }}
        >
          ⚠ {graph.truncated}
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.08}
        maxZoom={2.5}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        onPaneClick={() => setSelected(null)}
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
              return (EXT_STYLE[d.ext] ?? FALLBACK).ring;
            }}
            style={{ background: "rgba(0,0,0,0.6)" }}
          />
        )}
      </ReactFlow>
    </div>
  );
}

export function DependencyCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <DependencyCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

void (null as unknown as FileGraphEdge);
