// AI-generated repo summary via Claude.
// Returns null (feature disabled) when ANTHROPIC_API_KEY is not set, so the UI
// can hide the panel without special-casing.

import Anthropic from "@anthropic-ai/sdk";
import type { AnalysisSnapshot } from "./types";

export const SUMMARY_MODEL = "claude-opus-4-7";
const MAX_TOKENS = 1500;

const SYSTEM_PROMPT = `You are a senior software engineer writing a brief, honest profile of a GitHub repository for a developer who has never seen it before.

Write in 2-3 flowing paragraphs (180-220 words total) that cover:

1. What the project is and who it's for — the elevator pitch in one or two sentences.
2. How it's built — primary language, architecture pattern, notable dependencies, and any standout file-structure details you can infer from the hotspots and dependency graph.
3. Its current trajectory — which modules have been active lately, themes in recent commits, PR cycle signals, and bus-factor observations.

Guidelines:
- Write prose, not lists or markdown. No headings, no bullets.
- Be specific — name actual files, folders, and contributors from the data when they tell the story.
- Avoid corporate-speak: no "robust", "cutting-edge", "leverage", "seamless", "state-of-the-art". Plain technical English.
- If the data is sparse (one contributor, few commits, only metadata files in hotspots) say so honestly rather than inflating it.
- Do not invent features that aren't evident from the data.
- Do not start with the repo name in bold, or with "This repository…". Jump straight to the pitch.`;

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
    thinking: { type: "adaptive" },
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
