// Blast-radius computation. Given a target file and a CodeGraph, produces
// the set of files that ripple INTO or OUT OF the target via imports + calls.
//
// Direction semantics:
//   - incoming: files that import or call into the target. These break first
//     when the target's API changes.
//   - outgoing: files the target imports / calls into. Changing one of these
//     can break the target.
//
// Pure function over CodeGraph — runs fast enough on the client (BFS over a
// few hundred to a few thousand nodes) so the UI can recompute on every
// selection change without a server round-trip.

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

export interface BlastRadiusOptions {
  /** BFS depth cap. Default 3 — beyond that the radius usually loses
   *  practical meaning ("nearly the whole codebase rolls forward"). */
  maxHops?: number;
  /** Per-direction visited-node cap. Protects the UI from rendering 5,000
   *  entries on a hub file. */
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
    truncated:
      inc.truncated || out.truncated
        ? `Capped at ${maxNodes} files per direction`
        : undefined,
  };
}

// ---------------- internals ----------------

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
