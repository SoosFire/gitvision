// POST /api/sessions  — create a new session from a GitHub URL
// GET  /api/sessions  — list all sessions

import { NextResponse } from "next/server";
import { z } from "zod";
import { parseRepoUrl, analyzeRepo } from "@/lib/github";
import { createSession, listSessions } from "@/lib/storage";

const CreateSchema = z.object({
  repoUrl: z.string().min(1),
  name: z.string().optional(),
});

export async function GET() {
  const sessions = await listSessions();
  return NextResponse.json({ sessions });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const parsedRepo = parseRepoUrl(parsed.data.repoUrl);
  if (!parsedRepo) {
    return NextResponse.json(
      { error: "Could not parse GitHub URL. Expected e.g. https://github.com/owner/repo" },
      { status: 400 }
    );
  }

  try {
    const snapshot = await analyzeRepo(parsedRepo.owner, parsedRepo.repo);
    const session = await createSession({
      repoUrl: parsed.data.repoUrl,
      name: parsed.data.name || snapshot.repo.fullName,
      initialSnapshot: snapshot,
    });
    return NextResponse.json({ session });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to analyze repo: ${message}` },
      { status: 502 }
    );
  }
}
