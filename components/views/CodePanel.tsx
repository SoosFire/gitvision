"use client";

// Code tab — surfaces the v0.10 codeAnalysis pipeline output.
//
// Hero view is blast radius. Two modes share the same hero slot:
//   - File mode (default): which files break if THIS file changes (incoming),
//     which files this file depends on (outgoing).
//   - Function mode (after clicking a function chip or a top-functions item):
//     which functions call THIS function (callers), which functions THIS
//     function calls (callees). Click "Back to file" to return.
//
// Function mode requires resolved call edges from a Phase 5+ plugin (JS/TS,
// Java, Go, Python). For files only covered by the regex-fallback plugin,
// the function chips simply won't have call edges — the function view will
// show empty lists, which is the honest outcome.
//
// Coverage chip at top makes our limits explicit: JS/TS gets full call-graph
// + complexity, the other 7 languages contribute imports only via the
// regex-fallback plugin. Honest accounting beats over-promised UI.

import { useDeferredValue, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  Code as CodeIcon,
  FileCode,
  PhoneIncoming,
  PhoneOutgoing,
  Search,
  Sparkles,
  Target,
} from "lucide-react";
import type { AnalysisSnapshot, CodeGraph } from "@/lib/types";
import { TOK } from "@/lib/theme";
import {
  computeBlastRadius,
  computeFunctionBlastRadius,
  type BlastRadius,
  type FunctionBlastRadius,
} from "@/lib/codeAnalysis/blastRadius";

const INITIAL_LIST_SIZE = 10;
const EXPANDED_LIST_SIZE = 60;

export function CodePanel({ snapshot }: { snapshot: AnalysisSnapshot }) {
  const cg = snapshot.codeGraph;
  if (!cg) return <EmptyState reason={snapshot.codeGraphSkipReason} />;
  return <CodePanelInner cg={cg} />;
}

// ------------------- Inner panel -------------------

function CodePanelInner({ cg }: { cg: CodeGraph }) {
  // Files sorted by fileComplexity desc — the "real heavy" filter.
  // We deliberately don't sort by function count because tests inflate that
  // (one it() = one function), which we saw on Vue: apiOptions.spec.ts has
  // 195 "functions" but file complexity 2.
  const heavyFiles = useMemo(() => {
    return Object.entries(cg.fileComplexity)
      .map(([file, complexity]) => ({ file, complexity }))
      .sort((a, b) => b.complexity - a.complexity);
  }, [cg.fileComplexity]);

  const allFiles = useMemo(
    () => Object.keys(cg.fileComplexity).sort(),
    [cg.fileComplexity]
  );

  const topFunctions = useMemo(() => {
    return [...cg.functions]
      .sort((a, b) => b.complexity - a.complexity)
      .slice(0, 30);
  }, [cg.functions]);

  // Default: heaviest file in the codebase. Empty state is boring; opening on
  // top-complex-file lands the user where the most interesting blast radius
  // lives.
  const [selected, setSelected] = useState<string | null>(
    heavyFiles[0]?.file ?? null
  );
  // Function-level zoom. null = file-level blast radius, set = function mode.
  // Tied to `selected` (the file): switching files clears the function. Names
  // are scoped to (file, name) pairs in the call graph.
  const [selectedFunction, setSelectedFunction] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    if (!deferredQuery) return [] as string[];
    const q = deferredQuery.toLowerCase();
    return allFiles.filter((f) => f.toLowerCase().includes(q)).slice(0, 25);
  }, [allFiles, deferredQuery]);

  const blast = useMemo(() => {
    if (!selected) return null;
    return computeBlastRadius(cg, selected, { maxHops: 3 });
  }, [cg, selected]);

  const fnBlast = useMemo(() => {
    if (!selected || !selectedFunction) return null;
    return computeFunctionBlastRadius(cg, selected, selectedFunction, {
      maxHops: 3,
    });
  }, [cg, selected, selectedFunction]);

  const selectedComplexity = selected
    ? cg.fileComplexity[selected] ?? 0
    : null;
  const selectedFunctions = selected
    ? cg.functions
        .filter((f) => f.filePath === selected)
        .sort((a, b) => b.complexity - a.complexity)
    : [];

  function pickFile(f: string) {
    setSelected(f);
    setSelectedFunction(null); // reset zoom — different file means different fns
    setQuery("");
  }

  function pickFunction(file: string, fnName: string) {
    setSelected(file);
    setSelectedFunction(fnName);
    setQuery("");
  }

  return (
    <div className="flex flex-col gap-4">
      <CoverageChip cg={cg} />

      {/* Hero: selected file + blast radius (file mode or function mode) */}
      <div
        className="rounded-xl p-5 flex flex-col gap-4"
        style={{
          background: TOK.surface,
          border: `1px solid ${TOK.border}`,
        }}
      >
        <SelectedFileHeader
          selected={selected}
          complexity={selectedComplexity}
          functions={selectedFunctions}
          activeFunction={selectedFunction}
          onSelectFunction={(name) =>
            selected && setSelectedFunction(name)
          }
          query={query}
          onQueryChange={setQuery}
          filtered={filtered}
          onPick={pickFile}
        />

        {selectedFunction && fnBlast ? (
          <FunctionBlastRadiusView
            blast={fnBlast}
            onBack={() => setSelectedFunction(null)}
          />
        ) : (
          blast && <BlastRadiusView blast={blast} />
        )}
      </div>

      {/* Twin lists: heavy files + top complex functions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HeavyFilesList
          files={heavyFiles}
          selected={selected}
          onPick={pickFile}
        />
        <TopFunctionsList
          functions={topFunctions}
          onPick={pickFunction}
        />
      </div>
    </div>
  );
}

// ------------------- Coverage chip -------------------

function CoverageChip({ cg }: { cg: CodeGraph }) {
  const jsStats = cg.byPlugin.javascript;
  const fbStats = cg.byPlugin["regex-fallback"];
  const jsFiles = jsStats?.files ?? 0;
  const fbFiles = fbStats?.files ?? 0;
  const totalCalls = jsStats?.calls ?? 0;
  const fnCount = cg.functions.length;

  return (
    <div
      className="flex flex-wrap items-center gap-2 text-xs px-3 py-2 rounded-lg"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
        color: TOK.textSecondary,
      }}
    >
      <Sparkles size={13} style={{ color: TOK.accent }} />
      <span>
        <strong style={{ color: TOK.textPrimary }}>{jsFiles}</strong> JS/TS
        files via tree-sitter
      </span>
      <span style={{ color: TOK.textMuted }}>·</span>
      <span>
        <strong style={{ color: TOK.textPrimary }}>{fnCount}</strong> functions
        with complexity
      </span>
      <span style={{ color: TOK.textMuted }}>·</span>
      <span>
        <strong style={{ color: TOK.textPrimary }}>
          {totalCalls.toLocaleString()}
        </strong>{" "}
        call-sites
      </span>
      {fbFiles > 0 && (
        <>
          <span style={{ color: TOK.textMuted }}>·</span>
          <span>
            <strong style={{ color: TOK.textPrimary }}>{fbFiles}</strong> other-
            language files (imports only)
          </span>
        </>
      )}
    </div>
  );
}

// ------------------- Selected-file header + picker -------------------

function SelectedFileHeader({
  selected,
  complexity,
  functions,
  activeFunction,
  onSelectFunction,
  query,
  onQueryChange,
  filtered,
  onPick,
}: {
  selected: string | null;
  complexity: number | null;
  functions: { name: string; complexity: number; startRow: number }[];
  /** When set, the matching chip lights up to indicate function mode is on. */
  activeFunction: string | null;
  onSelectFunction: (name: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
  filtered: string[];
  onPick: (f: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const showResults = pickerOpen && (query.length > 0 || filtered.length > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Target size={15} style={{ color: TOK.accent }} />
          <span
            className="text-xs uppercase tracking-wider"
            style={{ color: TOK.textMuted }}
          >
            Blast radius for
          </span>
        </div>
        {complexity !== null && (
          <span
            className="text-xs px-2 py-0.5 rounded font-mono tabular-nums"
            style={{
              background: TOK.surfaceElevated,
              color: TOK.textSecondary,
              border: `1px solid ${TOK.border}`,
            }}
          >
            file complexity {complexity}
          </span>
        )}
      </div>

      {/* Selected path */}
      {selected && (
        <div
          className="text-sm font-mono break-all"
          style={{ color: TOK.textPrimary }}
          title={selected}
        >
          {selected}
        </div>
      )}

      {/* Top functions in the selected file. Clickable: zooms blast radius
       *  in to function-level for the picked one. The active chip lights up
       *  with the accent so users can find their way back. */}
      {functions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {functions.slice(0, 6).map((fn) => {
            const active = fn.name === activeFunction;
            return (
              <button
                key={`${fn.name}@${fn.startRow}`}
                onClick={() => onSelectFunction(fn.name)}
                className="text-[11px] px-1.5 py-0.5 rounded font-mono transition cursor-pointer"
                style={{
                  background: active ? TOK.accentSoft : TOK.surfaceElevated,
                  color: active ? TOK.textPrimary : TOK.textSecondary,
                  border: `1px solid ${active ? TOK.accent : TOK.border}`,
                }}
                title={`Line ${fn.startRow + 1} · complexity ${fn.complexity}${
                  active ? "" : " — click to focus"
                }`}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.borderColor = TOK.borderStrong;
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.borderColor = TOK.border;
                }}
              >
                {fn.name}{" "}
                <span style={{ color: active ? TOK.accent : TOK.textMuted }}>
                  {fn.complexity}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* File picker */}
      <div className="relative">
        <div
          className="flex items-center gap-2 px-3 h-9 rounded-lg"
          style={{
            background: TOK.bg,
            border: `1px solid ${TOK.border}`,
          }}
        >
          <Search size={13} style={{ color: TOK.textMuted }} />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onFocus={() => setPickerOpen(true)}
            onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
            placeholder="Pick another file… (search by path)"
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: TOK.textPrimary }}
          />
        </div>
        {showResults && filtered.length > 0 && (
          <div
            className="absolute z-10 left-0 right-0 mt-1 rounded-lg overflow-hidden"
            style={{
              background: TOK.surfaceElevated,
              border: `1px solid ${TOK.borderStrong}`,
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            {filtered.map((f) => (
              <button
                key={f}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(f)}
                className="block w-full text-left px-3 py-1.5 text-xs font-mono transition"
                style={{ color: TOK.textSecondary }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = TOK.surface;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------- Blast radius views -------------------
//
// Two views, one shared section primitive. File mode shows just the path;
// function mode shows the function name with the path as a muted secondary
// line so users can tell which file the function lives in without crowding
// the header.

/** Unified shape for both file-level and function-level entries. The list
 *  primitive renders `primary` prominently and `secondary` (when set) muted
 *  underneath. */
interface BlastListEntry {
  primary: string;
  secondary?: string;
  hop: number;
}

function BlastRadiusView({ blast }: { blast: BlastRadius }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <BlastSection
        title="Incoming — what breaks if this changes"
        icon={<ArrowDownToLine size={14} />}
        accent={TOK.amber}
        unit="files"
        entries={blast.incoming.map((e) => ({ primary: e.filePath, hop: e.hop }))}
        byHop={blast.byHop.incoming}
      />
      <BlastSection
        title="Outgoing — what this depends on"
        icon={<ArrowUpFromLine size={14} />}
        accent={TOK.accent}
        unit="files"
        entries={blast.outgoing.map((e) => ({ primary: e.filePath, hop: e.hop }))}
        byHop={blast.byHop.outgoing}
      />
      {blast.truncated && (
        <div
          className="md:col-span-2 text-[11px] flex items-center gap-2 px-2"
          style={{ color: TOK.textMuted }}
        >
          {blast.truncated} — list above is partial.
        </div>
      )}
    </div>
  );
}

function FunctionBlastRadiusView({
  blast,
  onBack,
}: {
  blast: FunctionBlastRadius;
  onBack: () => void;
}) {
  const totalCalls = blast.incoming.length + blast.outgoing.length;
  const isEmpty = totalCalls === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onBack}
          className="text-[11px] flex items-center gap-1 px-2 py-1 rounded transition cursor-pointer"
          style={{
            background: TOK.surfaceElevated,
            color: TOK.textSecondary,
            border: `1px solid ${TOK.border}`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = TOK.borderStrong;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = TOK.border;
          }}
        >
          <ArrowLeft size={11} />
          Back to file blast radius
        </button>
        <span
          className="text-[11px] flex items-center gap-1"
          style={{ color: TOK.textMuted }}
        >
          <Target size={11} style={{ color: TOK.accent }} />
          Zoomed into <span
            className="font-mono"
            style={{ color: TOK.textPrimary }}
          >
            {blast.target.name}
          </span>
        </span>
      </div>

      {/* Call-edge availability hint when both directions are empty.
       *  Common reasons: file is parsed by regex-fallback (no resolved calls),
       *  function is leaf-level on both sides, or the call sites use
       *  expressions our resolver can't yet handle. */}
      {isEmpty && (
        <div
          className="text-[11px] px-3 py-2 rounded"
          style={{
            background: TOK.bg,
            border: `1px dashed ${TOK.border}`,
            color: TOK.textMuted,
          }}
        >
          No resolved call edges for this function. Either nothing calls it
          (and it calls nothing internal), or the file is parsed by the
          regex-fallback plugin which doesn&apos;t emit call edges.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <BlastSection
          title="Callers — functions that call this"
          icon={<PhoneIncoming size={14} />}
          accent={TOK.amber}
          unit="functions"
          entries={blast.incoming.map((e) => ({
            primary: e.name,
            secondary: e.filePath,
            hop: e.hop,
          }))}
          byHop={blast.byHop.incoming}
        />
        <BlastSection
          title="Callees — functions this calls"
          icon={<PhoneOutgoing size={14} />}
          accent={TOK.accent}
          unit="functions"
          entries={blast.outgoing.map((e) => ({
            primary: e.name,
            secondary: e.filePath,
            hop: e.hop,
          }))}
          byHop={blast.byHop.outgoing}
        />
        {blast.truncated && (
          <div
            className="md:col-span-2 text-[11px] flex items-center gap-2 px-2"
            style={{ color: TOK.textMuted }}
          >
            {blast.truncated} — list above is partial.
          </div>
        )}
      </div>
    </div>
  );
}

function BlastSection({
  title,
  icon,
  accent,
  unit,
  entries,
  byHop,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  unit: "files" | "functions";
  entries: BlastListEntry[];
  byHop: Record<number, number>;
}) {
  const [expanded, setExpanded] = useState(false);
  const limit = expanded ? EXPANDED_LIST_SIZE : INITIAL_LIST_SIZE;
  const shown = entries.slice(0, limit);
  const hidden = Math.max(0, entries.length - limit);

  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-2"
      style={{
        background: TOK.bg,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs" style={{ color: accent }}>
          {icon}
          <span style={{ color: TOK.textPrimary }}>{title}</span>
        </div>
        <span
          className="text-[11px] font-mono tabular-nums"
          style={{ color: TOK.textMuted }}
        >
          {entries.length} {unit}
        </span>
      </div>

      {/* Hop counters */}
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {Object.keys(byHop).length === 0 ? (
          <span style={{ color: TOK.textMuted }}>none</span>
        ) : (
          Object.entries(byHop)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([hop, count]) => (
              <span
                key={hop}
                className="px-1.5 py-0.5 rounded font-mono tabular-nums"
                style={{
                  background: TOK.surfaceElevated,
                  color: TOK.textSecondary,
                  border: `1px solid ${TOK.border}`,
                }}
              >
                hop {hop}: {count}
              </span>
            ))
        )}
      </div>

      {/* Entry list. Two-line layout when secondary is provided (function
       *  mode shows the file path as muted context under the function name). */}
      {shown.length > 0 && (
        <ul className="flex flex-col gap-0.5 mt-1">
          {shown.map((e, idx) => (
            <li
              key={`${e.primary}@${e.secondary ?? ""}@${idx}`}
              className="text-[11px] font-mono flex items-center gap-2 py-0.5"
              style={{ color: TOK.textSecondary }}
            >
              <span
                className="inline-flex items-center justify-center text-[9px] tabular-nums w-5 h-4 rounded shrink-0"
                style={{
                  background: TOK.surfaceElevated,
                  color: TOK.textMuted,
                  border: `1px solid ${TOK.border}`,
                }}
                title={`hop ${e.hop}`}
              >
                {e.hop}
              </span>
              <div className="flex-1 min-w-0 flex flex-col">
                <span className="truncate" title={e.primary}>
                  {e.primary}
                </span>
                {e.secondary && (
                  <span
                    className="truncate text-[10px]"
                    style={{ color: TOK.textMuted }}
                    title={e.secondary}
                  >
                    {e.secondary}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-[11px] flex items-center gap-1 transition self-start"
          style={{ color: TOK.textSecondary }}
        >
          <ChevronDown size={12} />
          Show {hidden} more
        </button>
      )}
      {expanded && entries.length > INITIAL_LIST_SIZE && (
        <button
          onClick={() => setExpanded(false)}
          className="text-[11px] flex items-center gap-1 transition self-start"
          style={{ color: TOK.textMuted }}
        >
          <ChevronRight size={12} />
          Collapse
        </button>
      )}
    </div>
  );
}

// ------------------- Heavy files list -------------------

function HeavyFilesList({
  files,
  selected,
  onPick,
}: {
  files: { file: string; complexity: number }[];
  selected: string | null;
  onPick: (f: string) => void;
}) {
  const top = files.slice(0, 15);

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider" style={{ color: TOK.textMuted }}>
        <FileCode size={13} />
        <span>Heaviest files</span>
        <span style={{ color: TOK.textMuted, textTransform: "none" }}>
          (by file complexity, not function count)
        </span>
      </div>

      <ul className="flex flex-col gap-0.5">
        {top.map(({ file, complexity }) => {
          const isSelected = file === selected;
          return (
            <li key={file}>
              <button
                onClick={() => onPick(file)}
                className="w-full flex items-center gap-3 py-1.5 px-2 rounded transition text-left"
                style={{
                  background: isSelected ? TOK.accentSoft : "transparent",
                  color: isSelected ? TOK.textPrimary : TOK.textSecondary,
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = TOK.surfaceElevated;
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = "transparent";
                }}
              >
                <span
                  className="text-[10px] font-mono tabular-nums w-10 text-right"
                  style={{ color: isSelected ? TOK.accent : TOK.textMuted }}
                >
                  {complexity}
                </span>
                <span className="text-[11px] font-mono truncate flex-1" title={file}>
                  {file}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ------------------- Top functions list -------------------

function TopFunctionsList({
  functions,
  onPick,
}: {
  functions: {
    filePath: string;
    name: string;
    complexity: number;
    startRow: number;
    /** Class/struct/etc. this function belongs to, when type-aware extraction
     *  caught it. v0.15+ for Java, v0.16+ for Go, v0.17+ for TS, v0.18+ for
     *  Python. Top-level functions stay undefined. */
    containerType?: string;
  }[];
  /** Receives both the file and the function name so the panel can zoom
   *  straight into function-level blast radius. */
  onPick: (file: string, fnName: string) => void;
}) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider" style={{ color: TOK.textMuted }}>
        <CodeIcon size={13} />
        <span>Most complex functions</span>
        <span style={{ color: TOK.textMuted, textTransform: "none" }}>
          (click to zoom into function blast radius)
        </span>
      </div>

      <ul className="flex flex-col gap-0.5">
        {functions.slice(0, 15).map((fn) => (
          <li key={`${fn.filePath}:${fn.name}@${fn.startRow}`}>
            <button
              onClick={() => onPick(fn.filePath, fn.name)}
              className="w-full flex items-center gap-3 py-1.5 px-2 rounded text-left transition"
              style={{ color: TOK.textSecondary }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = TOK.surfaceElevated;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <span
                className="text-[10px] font-mono tabular-nums w-10 text-right"
                style={{ color: complexityColor(fn.complexity) }}
              >
                {fn.complexity}
              </span>
              <div className="flex-1 min-w-0 flex flex-col">
                <span
                  className="text-xs font-mono truncate"
                  style={{ color: TOK.textPrimary }}
                  title={
                    fn.containerType
                      ? `${fn.containerType}.${fn.name}`
                      : fn.name
                  }
                >
                  {fn.containerType && (
                    <span style={{ color: TOK.textMuted }}>
                      {fn.containerType}.
                    </span>
                  )}
                  {fn.name}
                </span>
                <span
                  className="text-[10px] font-mono truncate"
                  style={{ color: TOK.textMuted }}
                  title={fn.filePath}
                >
                  {fn.filePath}:{fn.startRow + 1}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Color scale for complexity numbers — calmer than rose for everything,
 *  amber once it crosses "this should be split", rose past "actively scary". */
function complexityColor(c: number): string {
  if (c >= 50) return TOK.rose;
  if (c >= 20) return TOK.amber;
  if (c >= 10) return TOK.accent;
  return TOK.textMuted;
}

// ------------------- Empty state -------------------

function EmptyState({ reason }: { reason?: string }) {
  // Two distinct empty-state cases, surfaced explicitly:
  //   - Pre-v0.10 snapshot (no codeGraph, no skip reason) → "click Refresh"
  //   - v0.19+ snapshot where analysis was skipped (skip reason present) →
  //     show the actual reason so the user understands what happened
  const isSkipped = !!reason;
  return (
    <div
      className="rounded-xl border border-dashed p-10 text-center text-sm flex flex-col items-center gap-3"
      style={{
        borderColor: TOK.border,
        color: TOK.textMuted,
      }}
    >
      <CodeIcon size={20} style={{ color: TOK.textSecondary }} />
      {isSkipped ? (
        <>
          <p style={{ color: TOK.textSecondary }}>
            Code analysis was skipped for this snapshot.
          </p>
          <p
            className="max-w-2xl"
            style={{ color: TOK.textMuted }}
          >
            {reason}
          </p>
          <p
            className="text-xs"
            style={{ color: TOK.textMuted }}
          >
            The other tabs (Canvas / Imports / Packages / PRs / Overview) still
            reflect the latest snapshot — only the call-graph / complexity
            data is missing here.
          </p>
        </>
      ) : (
        <>
          <p style={{ color: TOK.textSecondary }}>
            This snapshot was created before the code-analysis pipeline shipped.
          </p>
          <p>
            Click <strong style={{ color: TOK.textPrimary }}>Refresh</strong>{" "}
            above to populate it. New snapshots include AST-based functions,
            call-graph and complexity for JS/TS, plus imports for the other 7
            languages.
          </p>
        </>
      )}
    </div>
  );
}
