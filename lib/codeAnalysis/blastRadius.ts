// Blast-radius computation. Two granularities sharing the same BFS engine:
//
//   computeBlastRadius(cg, targetFile)              — file-level
//   computeFunctionBlastRadius(cg, file, fnName)    — function-level
//
// Direction semantics (same for both granularities):
//   - incoming: who depends on / calls into the target. These break first
//     when the target's API changes.
//   - outgoing: what the target depends on / calls into. Changing any of
//     these can break the target.
//
// File-level mixes import edges + call edges (any resolved call between two
// files implies a file-level dependency).
//
// Function-level uses CallEdge only, requires both endpoints to be functions
// (fromFunction != null && toFunction != null && toFile != null), and so is
// only useful for plugins that emit resolved call edges — JS/TS, Java, Go,
// Python via Phase 5. Module-scope calls are skipped because they have no
// source-side function id.
//
// Pure functions over CodeGraph — fast enough to recompute in the client on
// every selection change.

import type { CodeGraph } from "./types";

export interface BlastRadiusEntry {
  filePath: string;
  /** 1 = direct, 2 = transitive via 1 intermediate, etc. Always >= 1. */
  hop: number;
}

export interface BlastRadius {
  target: string;
  incoming: BlastRadiusEntry[];
  outgoing: BlastRadiusEntry[];
  /** Counts grouped by hop, useful for headline numbers in UI. */
  byHop: {
    incoming: Record<number, number>;
    outgoing: Record<number, number>;
  };
  /** Set when the BFS hit the per-direction node cap, indicating the listed
   *  set is incomplete. */
  truncated?: string;
}

export interface FunctionBlastEntry {
  /** File the function lives in. May equal the target's filePath when the
   *  caller/callee is in the same file. */
  filePath: string;
  /** Name of the function as captured by the plugin's parser. */
  name: string;
  hop: number;
}

export interface FunctionBlastRadius {
  target: { filePath: string; name: string };
  incoming: FunctionBlastEntry[];
  outgoing: FunctionBlastEntry[];
  byHop: {
    incoming: Record<number, number>;
    outgoing: Record<number, number>;
  };
  truncated?: string;
}

export interface BlastRadiusOptions {
  /** BFS depth cap. Default 3 — beyond that the radius usually loses
   *  practical meaning ("nearly the whole codebase rolls forward"). */
  maxHops?: number;
  /** Per-direction visited-node cap. Protects the UI from rendering 5,000
   *  entries on a hub file/function. */
  maxNodes?: number;
}

const DEFAULT_MAX_HOPS = 3;
const DEFAULT_MAX_NODES = 200;

export function computeBlastRadius(
  codeGraph: CodeGraph,
  targetFile: string,
  opts: BlastRadiusOptions = {}
): BlastRadius {
  const maxHops = opts.maxHops ?? DEFAULT_MAX_HOPS;
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;

  // Build adjacency from CodeGraph edges. Both imports and call edges
  // contribute — imports are file-level dependencies (any kind), calls are
  // function-level resolved targets (only the JS/TS plugin produces these
  // today, but the algorithm is uniform).
  const incomingAdj = new Map<string, Set<string>>(); // file → who points at me
  const outgoingAdj = new Map<string, Set<string>>(); // file → who I point at

  for (const e of codeGraph.imports) addEdge(outgoingAdj, incomingAdj, e.from, e.to);
  for (const c of codeGraph.calls) {
    if (c.toFile) addEdge(outgoingAdj, incomingAdj, c.fromFile, c.toFile);
  }

  const inc = bfs(targetFile, incomingAdj, maxHops, maxNodes);
  const out = bfs(targetFile, outgoingAdj, maxHops, maxNodes);

  return {
    target: targetFile,
    incoming: inc.entries,
    outgoing: out.entries,
    byHop: {
      incoming: tallyByHop(inc.entries),
      outgoing: tallyByHop(out.entries),
    },
    truncated: truncationMessage(inc.truncated || out.truncated, maxNodes, "files"),
  };
}

/** Function-level blast radius. Uses cg.calls only; an edge contributes when
 *  both endpoints are functions inside files we know about. Module-scope
 *  calls (fromFunction === null) are excluded because we'd have nothing
 *  meaningful to display on the source side. */
export function computeFunctionBlastRadius(
  codeGraph: CodeGraph,
  targetFile: string,
  targetFunction: string,
  opts: BlastRadiusOptions = {}
): FunctionBlastRadius {
  const maxHops = opts.maxHops ?? DEFAULT_MAX_HOPS;
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;

  const incomingAdj = new Map<string, Set<string>>();
  const outgoingAdj = new Map<string, Set<string>>();

  for (const c of codeGraph.calls) {
    if (c.fromFunction === null) continue; // module-scope; no source-side fn id
    if (c.toFile === null || c.toFunction === null) continue; // unresolved
    const fromId = encodeFn(c.fromFile, c.fromFunction);
    const toId = encodeFn(c.toFile, c.toFunction);
    addEdge(outgoingAdj, incomingAdj, fromId, toId);
  }

  const targetId = encodeFn(targetFile, targetFunction);
  const inc = bfs(targetId, incomingAdj, maxHops, maxNodes);
  const out = bfs(targetId, outgoingAdj, maxHops, maxNodes);

  return {
    target: { filePath: targetFile, name: targetFunction },
    incoming: inc.entries.map((e) => ({ ...decodeFn(e.filePath), hop: e.hop })),
    outgoing: out.entries.map((e) => ({ ...decodeFn(e.filePath), hop: e.hop })),
    byHop: {
      incoming: tallyByHop(inc.entries),
      outgoing: tallyByHop(out.entries),
    },
    truncated: truncationMessage(
      inc.truncated || out.truncated,
      maxNodes,
      "functions"
    ),
  };
}

// ---------------- internals ----------------

/** Encode a (file, fnName) pair as a single string id for the BFS engine.
 *  The separator "::" doesn't collide with valid path or identifier chars in
 *  any of our supported languages. */
function encodeFn(filePath: string, name: string): string {
  return `${filePath}::${name}`;
}

function decodeFn(id: string): { filePath: string; name: string } {
  const idx = id.lastIndexOf("::");
  if (idx < 0) return { filePath: id, name: "" };
  return { filePath: id.slice(0, idx), name: id.slice(idx + 2) };
}

function truncationMessage(
  truncated: boolean,
  maxNodes: number,
  unit: "files" | "functions"
): string | undefined {
  return truncated ? `Capped at ${maxNodes} ${unit} per direction` : undefined;
}

function addEdge(
  outgoingAdj: Map<string, Set<string>>,
  incomingAdj: Map<string, Set<string>>,
  from: string,
  to: string
): void {
  if (from === to) return; // self-edges aren't blast-radius signal
  let outs = outgoingAdj.get(from);
  if (!outs) {
    outs = new Set();
    outgoingAdj.set(from, outs);
  }
  outs.add(to);
  let ins = incomingAdj.get(to);
  if (!ins) {
    ins = new Set();
    incomingAdj.set(to, ins);
  }
  ins.add(from);
}

interface BfsResult {
  entries: BlastRadiusEntry[];
  truncated: boolean;
}

function bfs(
  start: string,
  adj: Map<string, Set<string>>,
  maxHops: number,
  maxNodes: number
): BfsResult {
  const hopOf = new Map<string, number>();
  hopOf.set(start, 0);
  const queue: string[] = [start];
  // Tracks result entries only — start is excluded so the cap reflects what
  // the UI actually displays. Without this you'd see "Capped at 200" with
  // 199 entries because the visited Map includes the target.
  let entryCount = 0;
  let truncated = false;

  while (queue.length > 0) {
    const file = queue.shift()!;
    const hop = hopOf.get(file)!;
    if (hop >= maxHops) continue;
    const neighbors = adj.get(file);
    if (!neighbors) continue;
    for (const n of neighbors) {
      if (hopOf.has(n)) continue;
      if (entryCount >= maxNodes) {
        truncated = true;
        break;
      }
      hopOf.set(n, hop + 1);
      queue.push(n);
      entryCount++;
    }
    if (truncated) break;
  }

  const entries: BlastRadiusEntry[] = [];
  for (const [file, hop] of hopOf) {
    if (file === start) continue;
    entries.push({ filePath: file, hop });
  }
  entries.sort((a, b) => a.hop - b.hop || a.filePath.localeCompare(b.filePath));
  return { entries, truncated };
}

function tallyByHop(entries: BlastRadiusEntry[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const e of entries) out[e.hop] = (out[e.hop] ?? 0) + 1;
  return out;
}
