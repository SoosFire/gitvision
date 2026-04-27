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
import { csharpPlugin } from "@/lib/codeAnalysis/plugins/csharp";
import { goPlugin } from "@/lib/codeAnalysis/plugins/go";
import { javaPlugin } from "@/lib/codeAnalysis/plugins/java";
import { javascriptPlugin } from "@/lib/codeAnalysis/plugins/javascript";
import { phpPlugin } from "@/lib/codeAnalysis/plugins/php";
import { pythonPlugin } from "@/lib/codeAnalysis/plugins/python";
import { regexFallbackPlugin } from "@/lib/codeAnalysis/plugins/regexFallback";
import type { CodeGraph, ParsedFile } from "@/lib/codeAnalysis/types";

const PostBody = z.object({
  repoUrl: z.string().min(1),
  ref: z.string().optional(),
});

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN || undefined,
  userAgent: "GitVision/0.1",
});

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

    const result = await analyzeDirectory(extracted.extractDir, [
      javascriptPlugin,
      pythonPlugin,
      goPlugin,
      javaPlugin,
      csharpPlugin,
      phpPlugin,
      regexFallbackPlugin,
    ]);
    const summary = buildSummary(result.files, result.codeGraph);

    return NextResponse.json({
      repo: { owner: parsed.owner, name: parsed.repo, ref },
      totals: summary.totals,
      byPlugin: result.codeGraph.byPlugin,
      filesByExt: result.codeGraph.filesByExt,
      topComplex: summary.topComplex,
      biggestFiles: summary.biggestFiles,
      externalImports: summary.externalImports,
      unresolvedCalls: summary.unresolvedCalls,
      sampleImports: summary.sampleImports,
      parseErrors: result.files.filter((f) => f.parseError).map((f) => f.rel),
      elapsedMs: Date.now() - overallStart,
      truncated: result.truncated,
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

function buildSummary(files: ParsedFile[], codeGraph: CodeGraph) {
  // Totals are derived directly from the CodeGraph aggregator so the API
  // surface and the snapshot field stay in sync.
  const totals = {
    filesParsed: files.filter((f) => !f.parseError).length,
    parseErrors: files.filter((f) => f.parseError).length,
    functions: codeGraph.functions.length,
    imports: files.reduce((s, f) => s + f.imports.length, 0),
    resolvedImports: codeGraph.imports.length,
    calls: codeGraph.calls.length,
    resolvedCalls: codeGraph.calls.filter((c) => c.toFile !== null).length,
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

  // Use the CodeGraph's resolved call list to identify unresolved names —
  // CodeGraph.calls have toFile = null when resolution failed (or there were
  // ambiguous candidates). This is more accurate than the old "name not in
  // knownFunctions set" heuristic, which counted any same-name match.
  const unresolvedCallCounts = new Map<string, number>();
  for (const c of codeGraph.calls) {
    if (c.toFile !== null) continue;
    unresolvedCallCounts.set(
      c.calleeName,
      (unresolvedCallCounts.get(c.calleeName) ?? 0) + 1
    );
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
