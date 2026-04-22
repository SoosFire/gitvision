// AI-generated repo summary via Claude.
// Returns null (feature disabled) when ANTHROPIC_API_KEY is not set, so the UI
// can hide the panel without special-casing.

import Anthropic from "@anthropic-ai/sdk";
import type { AnalysisSnapshot } from "./types";

// Sonnet 4.5 is ~5x cheaper than Opus 4.7 and delivers ~90-95% of the quality
// for this task (prose briefing, not deep reasoning). Upgrade to Opus later
// only if we ship a feature that genuinely needs the extra reasoning depth
// (e.g. the "what works / what needs work" health panel).
export const SUMMARY_MODEL = "claude-sonnet-4-5";
// Output budget — thinking tokens are separate, so this strictly caps prose.
// 600 is ~450 words of output text: plenty of slack above the 200-word target
// without enabling the 340-word walls we saw on v1 of the prompt.
const MAX_TOKENS = 600;

const SYSTEM_PROMPT = `You are a senior software engineer writing a short, honest profile of a GitHub repository for a developer who has never seen it before.

HARD RULES (non-negotiable — break one and the summary is unusable):
1. Exactly 2 or 3 paragraphs, separated by blank lines. Never one wall of text.
2. Total length: 150-200 words. Count before you finish.
3. Lead with what makes the project distinctive. Never start with "This repository…" or "The X framework maintained by Y". Hook first.
4. Vary sentence length. Include at least one short (≤ 12 words) sentence per paragraph.
5. Maximum 3 proper nouns (people, packages, file names) in any single sentence.
6. Maximum 3 em-dashes in the entire response. Prefer periods.
7. No corporate-speak. Banned words: "robust", "cutting-edge", "leverage", "seamless", "state-of-the-art", "best-in-class", "production-ready", "enterprise-grade".
8. No markdown. No headings, no lists, no bold, no backticks around file paths in the body (use them only when quoting an exact identifier).
9. Output the summary text only. No preamble, no sign-off, no "Here's the summary:".

WHAT TO COVER — pick the most revealing, don't force all four:
- Elevator pitch: what it is, who uses it, what makes it interesting.
- Build: primary stack, architecture pattern, any notable split (e.g. JS/TS core + Rust compiler).
- Recent trajectory: which modules are hot, themes across recent commits, who's driving it.
- One concrete signal: PR backlog, bus factor concentration, an anomaly in the data.

EVIDENCE DISCIPLINE:
- Every specific claim must come from the data provided. Name real files, folders, contributors. Don't invent features.
- If the data is sparse (one contributor, few commits, only metadata files in hotspots), say so plainly. Don't pad.

---

EXAMPLE of the desired tone and rhythm (different repo — match the STYLE, not the content):

tailwindcss is the utility-first CSS framework that unseated CSS-in-JS for most React shops. The interesting engineering isn't the generated classes though — it's the JIT compiler and the Rust content scanner that make them fast.

The code is a TypeScript monorepo with two heavy hitters: the core engine in packages/tailwindcss and the Rust rewrite in packages/oxide. Recent hotspots cluster in Oxide crates and the v4 utility rewrite, reflecting the ongoing migration away from PostCSS. adamwathan and thecrypticace drive most commits. The Oxide work sits almost entirely on philipp-spiess.

Review velocity looks healthy. 22 open PRs against 41 recently merged says the team ships faster than issues arrive. One quirky pattern: every new color utility ships as a single commit touching 60+ files, so churn on utility files is inflated relative to actual design change.

---

Now write the summary for the repo data below.`;

export interface SummaryResult {
  text: string;
  model: string;
  generatedAt: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

function compactSnapshot(snap: AnalysisSnapshot) {
  const langBytes = Object.entries(snap.languages)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);
  const totalLangBytes = langBytes.reduce((a, [, b]) => a + b, 0) || 1;
  return {
    repo: {
      fullName: snap.repo.fullName,
      description: snap.repo.description,
      primaryLanguage: snap.repo.language,
      topics: snap.repo.topics,
      stars: snap.repo.stars,
      forks: snap.repo.forks,
      createdAt: snap.repo.createdAt,
      pushedAt: snap.repo.pushedAt,
      license: snap.repo.license,
    },
    languages: langBytes.map(([name, bytes]) => ({
      name,
      pct: Math.round((bytes / totalLangBytes) * 100),
    })),
    contributors: {
      total: snap.contributors.length,
      top: snap.contributors.slice(0, 6).map((c) => ({
        login: c.login,
        contributions: c.contributions,
      })),
    },
    topHotspots: snap.hotspots.slice(0, 12).map((h) => ({
      path: h.path,
      churn: h.churn,
      uniqueAuthors: h.authors,
    })),
    coChangePairs: snap.coChange.slice(0, 6).map((e) => ({
      a: e.from,
      b: e.to,
      together: e.count,
    })),
    recentCommitMessages: snap.recentCommits.slice(0, 18).map((c) => c.message),
    activity: {
      sampledCommits: snap.recentCommits.length,
      weeksWithActivity: snap.commitActivity.length,
      historySource: snap.historySource?.kind ?? "unknown",
    },
    pullRequests: snap.pullRequests
      ? {
          total: snap.pullRequests.length,
          merged: snap.pullRequests.filter((p) => p.merged).length,
          open: snap.pullRequests.filter((p) => p.state === "open").length,
        }
      : null,
    dependencyGraph: snap.fileGraph
      ? {
          files: snap.fileGraph.stats.totalFiles,
          filesByLanguage: snap.fileGraph.stats.filesByLanguage,
          edgesByKind: snap.fileGraph.stats.edgesByKind,
          truncated: snap.fileGraph.truncated,
        }
      : null,
  };
}

export async function generateRepoSummary(
  snap: AnalysisSnapshot
): Promise<SummaryResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();
  const payload = compactSnapshot(snap);

  const response = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: MAX_TOKENS,
    // Thinking disabled — was adaptive (Opus-only). Summary is a prose task,
    // not deep reasoning, so we don't need extended thinking on Sonnet.
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Summarize this GitHub repository based on its metadata, hotspots, contributors, and recent activity.\n\nData:\n\n${JSON.stringify(
          payload,
          null,
          2
        )}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();

  return {
    text,
    model: SUMMARY_MODEL,
    generatedAt: new Date().toISOString(),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
