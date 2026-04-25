// Debug endpoint — runs the codeAnalysis pipeline on a public GitHub repo
// without touching the snapshot/session storage. Returns the same JSON
// summary as `npm run analyze`. Used to sanity-check tree-sitter behavior
// against real repos before UI integration.
//
// Usage:
//   GET  /api/debug/code-analysis?repo=owner/name
//   POST /api/debug/code-analysis  body: { repoUrl: "https://github.com/.../..." }
//
// Auth: uses the server's GITHUB_TOKEN env var if set (5000/hr), otherwise
// unauthenticated (60/hr). Same posture as the rest of GitVision's API.
//
// Note: this is intentionally NOT mounted as a stable feature. It exists for
// development feedback. In Phase 4 the same primitives will land on the
// snapshot pipeline and this route can be removed.

import { NextResponse } from "next/server";
import { Octokit } from "octokit";
import { z } from "zod";
import { parseRepoUrl, fetchRepoMeta } from "@/lib/github";
import { downloadAndExtract } from "@/lib/graph";
import { analyzeDirectory } from "@/lib/codeAnalysis/analyze";
import { javascriptPlugin } from "@/lib/codeAnalysis/plugins/javascript";
import type { ParsedFile } from "@/lib/codeAnalysis/parse";

const PostBody = z.object({
  repoUrl: z.string().min(1),
  ref: z.string().optional(),
});

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN || undefined,
  userAgent: "GitVision/0.1",
});

interface SuccessSummary {
  repo: { owner: string; name: string; ref: string };
  totals: ReturnType<typeof buildSummary>["totals"];
  topComplex: ReturnType<typeof buildSummary>["topComplex"];
  biggestFiles: ReturnType<typeof buildSummary>["biggestFiles"];
  externalImports: ReturnType<typeof buildSummary>["externalImports"];
  unresolvedCalls: ReturnType<typeof buildSummary>["unresolvedCalls"];
  sampleImports: ReturnType<typeof buildSummary>["sampleImports"];
  parseErrors: string[];
  elapsedMs: number;
  truncated: boolean;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const repo = url.searchParams.get("repo");
  if (!repo) {
    return NextResponse.json(
      { error: "Missing ?repo=owner/name" },
      { status: 400 }
    );
  }
  return runAnalysis(repo, url.searchParams.get("ref") ?? undefined);
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body must be { repoUrl: string, ref?: string }" },
      { status: 400 }
    );
  }
  return runAnalysis(parsed.data.repoUrl, parsed.data.ref);
}

async function runAnalysis(input: string, requestedRef?: string): Promise<Response> {
  const parsed = parseRepoUrl(input);
  if (!parsed) {
    return NextResponse.json(
      { error: "Could not parse GitHub URL or shorthand. Try owner/name or https://github.com/owner/name" },
      { status: 400 }
    );
  }

  const overallStart = Date.now();
  let cleanup: (() => Promise<void>) | null = null;

  try {
    // Resolve the ref to use for the tarball. Default branch unless overridden.
    const ref = requestedRef ?? (await fetchRepoMeta(parsed.owner, parsed.repo)).defaultBranch;

    const tarballStart = Date.now();
    const extracted = await downloadAndExtract(octokit, parsed.owner, parsed.repo, ref);
    cleanup = extracted.cleanup;
    const tarballMs = Date.now() - tarballStart;

    const result = await analyzeDirectory(extracted.extractDir, [javascriptPlugin]);
    const summary = buildSummary(result.files);

    const payload: SuccessSummary = {
      repo: { owner: parsed.owner, name: parsed.repo, ref },
      totals: summary.totals,
      topComplex: summary.topComplex,
      biggestFiles: summary.biggestFiles,
      externalImports: summary.externalImports,
      unresolvedCalls: summary.unresolvedCalls,
      sampleImports: summary.sampleImports,
      parseErrors: result.files.filter((f) => f.parseError).map((f) => f.rel),
      elapsedMs: Date.now() - overallStart,
      truncated: result.truncated,
    };

    return NextResponse.json({
      ...payload,
      timings: {
        totalMs: Date.now() - overallStart,
        tarballMs,
        analyzeMs: result.elapsedMs,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Analysis failed: ${message}` },
      { status: 502 }
    );
  } finally {
    if (cleanup) await cleanup();
  }
}

// ------------------- Summary shaping -------------------
//
// Same shape as the dev CLI (lib/codeAnalysis/cli.ts) so feedback transfers
// directly between local and deployed analyses.

function buildSummary(files: ParsedFile[]) {
  // Totals (excluding the file-level scan counts which the route reports
  // separately from analyzeDirectory.totals)
  let functions = 0;
  let imports = 0;
  let resolvedImports = 0;
  let calls = 0;
  let resolvedCalls = 0;

  const knownFunctions = new Set<string>();
  for (const f of files) for (const fn of f.functions) knownFunctions.add(fn.name);

  for (const f of files) {
    functions += f.functions.length;
    imports += f.imports.length;
    resolvedImports += f.imports.filter((i) => i.resolvedPath).length;
    calls += f.calls.length;
    for (const c of f.calls) if (knownFunctions.has(c.calleeName)) resolvedCalls++;
  }

  const totals = {
    filesParsed: files.filter((f) => !f.parseError).length,
    parseErrors: files.filter((f) => f.parseError).length,
    functions,
    imports,
    resolvedImports,
    calls,
    resolvedCalls,
  };

  const topComplex = files
    .flatMap((f) => f.functions.map((fn) => ({ file: f.rel, ...fn })))
    .sort((a, b) => b.complexity - a.complexity)
    .slice(0, 15);

  const biggestFiles = files
    .map((f) => ({
      file: f.rel,
      functions: f.functions.length,
      imports: f.imports.length,
      calls: f.calls.length,
      fileComplexity: f.fileComplexity,
    }))
    .sort((a, b) => b.functions - a.functions)
    .slice(0, 15);

  const externalCounts = new Map<string, number>();
  for (const f of files) {
    for (const i of f.imports) {
      if (i.resolvedPath !== null) continue;
      if (i.rawSpec.startsWith(".") || i.rawSpec.startsWith("/")) continue;
      externalCounts.set(i.rawSpec, (externalCounts.get(i.rawSpec) ?? 0) + 1);
    }
  }
  const externalImports = [...externalCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([spec, count]) => ({ spec, count }));

  const unresolvedCallCounts = new Map<string, number>();
  for (const f of files) {
    for (const c of f.calls) {
      if (knownFunctions.has(c.calleeName)) continue;
      unresolvedCallCounts.set(
        c.calleeName,
        (unresolvedCallCounts.get(c.calleeName) ?? 0) + 1
      );
    }
  }
  const unresolvedCalls = [...unresolvedCallCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, count]) => ({ name, count }));

  const sampleImports = files
    .filter((f) => f.imports.length > 0)
    .slice(0, 5)
    .map((f) => ({ file: f.rel, imports: f.imports.slice(0, 8) }));

  return {
    totals,
    topComplex,
    biggestFiles,
    externalImports,
    unresolvedCalls,
    sampleImports,
  };
}
