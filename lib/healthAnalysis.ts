// Health-check narrative via Claude.
//
// Pipeline: signals.ts computes deterministic signals → this file sends them
// to Claude with an "explain in plain English" prompt → returns short prose
// for each category plus the underlying signals (so the UI can show evidence).
//
// Returns null when ANTHROPIC_API_KEY is not set so the UI can hide the panel
// without special-casing.

import Anthropic from "@anthropic-ai/sdk";
import { extractHealthSignals } from "./signals";
import type { AnalysisSnapshot, HealthAnalysis, HealthSignals } from "./types";

export const HEALTH_MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 800;

const SYSTEM_PROMPT = `You are a senior engineer writing a brief health check for a GitHub repository's maintainer.

You receive three categories of pre-computed signals from a deterministic analyzer:
- "working": positive signals (things going well)
- "needsWork": risks, backlogs, or debt signals (things to address)
- "questions": observations that need human judgment

For EACH category, write a short narrative paragraph that:
1. Opens with the strongest signal in that category (most severe for needsWork, most impactful for working)
2. Cites concrete evidence from the signals — file paths, numbers, names
3. Uses plain technical English. No corporate-speak, no hype, no alarm.

HARD RULES:
- Output VALID JSON ONLY matching this exact shape:
  {"working": "...", "needsWork": "...", "questions": "..."}
- Each value is 2-3 sentences, 30-60 words. Not longer.
- Do NOT invent signals not present in the input. Stick to what's given.
- If a category has zero signals, write a one-sentence honest placeholder:
  - working: "No standout strengths surfaced in the current data."
  - needsWork: "No pressing risks surfaced in the current data."
  - questions: "No open questions surfaced from the current data."
- No markdown. No bullets. No headings. No backticks. No preamble like "Here's the analysis".
- Output the JSON object and nothing else.`;

export async function generateHealthAnalysis(
  snap: AnalysisSnapshot
): Promise<HealthAnalysis | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const signals = extractHealthSignals(snap);
  const client = new Anthropic();

  const userContent =
    `Signals for ${snap.repo.fullName}:\n\n` +
    JSON.stringify(signals, null, 2);

  const response = await client.messages.create({
    model: HEALTH_MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  // Strip markdown code fences if the model added them despite instructions.
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  let narrative: { working: string; needsWork: string; questions: string };
  try {
    const parsed = JSON.parse(cleaned);
    narrative = {
      working: typeof parsed.working === "string" ? parsed.working : "",
      needsWork: typeof parsed.needsWork === "string" ? parsed.needsWork : "",
      questions: typeof parsed.questions === "string" ? parsed.questions : "",
    };
  } catch {
    // Fallback: use the raw text as-is in needsWork so we don't fail silently
    narrative = {
      working: "",
      needsWork: `Model returned non-JSON response. Raw: ${cleaned.slice(0, 500)}`,
      questions: "",
    };
  }

  return {
    signals,
    narrative,
    model: HEALTH_MODEL,
    generatedAt: new Date().toISOString(),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

// Re-export for testability / future use (e.g. computing signals without
// spending tokens on the narrative)
export { extractHealthSignals };
export type { HealthSignals };
