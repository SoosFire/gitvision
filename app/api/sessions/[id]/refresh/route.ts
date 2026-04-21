// POST /api/sessions/[id]/refresh  — re-fetch data and append a new snapshot.
// Returns the updated session plus a diff vs. previous snapshot.

import { NextResponse } from "next/server";
import { parseRepoUrl, analyzeRepo } from "@/lib/github";
import { getSession, appendSnapshot } from "@/lib/storage";
import { diffSnapshots } from "@/lib/diff";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = parseRepoUrl(session.repoUrl);
  if (!parsed) {
    return NextResponse.json({ error: "Stored repoUrl is invalid" }, { status: 400 });
  }

  try {
    const snapshot = await analyzeRepo(parsed.owner, parsed.repo);
    const prev = session.snapshots[session.snapshots.length - 1];
    const updated = await appendSnapshot(id, snapshot);
    const diff = prev ? diffSnapshots(prev, snapshot) : null;
    return NextResponse.json({ session: updated, diff });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Refresh failed: ${message}` }, { status: 502 });
  }
}
