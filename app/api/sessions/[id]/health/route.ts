// POST /api/sessions/[id]/health — generate (or regenerate) the health analysis
// for the latest snapshot. Result is stored on the snapshot so subsequent loads
// don't re-hit the Anthropic API.

import { NextResponse } from "next/server";
import { getSession, patchLatestSnapshot } from "@/lib/storage";
import { generateHealthAnalysis } from "@/lib/healthAnalysis";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set" },
      { status: 501 }
    );
  }

  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const snap = session.snapshots[session.snapshots.length - 1];
  if (!snap) {
    return NextResponse.json(
      { error: "Session has no snapshots" },
      { status: 400 }
    );
  }

  try {
    const result = await generateHealthAnalysis(snap);
    if (!result) {
      return NextResponse.json(
        { error: "Health analysis returned no content" },
        { status: 502 }
      );
    }
    const updated = await patchLatestSnapshot(id, { healthAnalysis: result });
    return NextResponse.json({ session: updated, analysis: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Health analysis failed: ${message}` },
      { status: 502 }
    );
  }
}
