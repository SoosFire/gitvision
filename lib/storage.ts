// File-based session storage.
// Sessions live in `.gitvision/sessions/<id>.json` relative to project root.
// Simple, portable, inspectable. Good enough for MVP and single-user usage.

import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Session, SessionSummary, AnalysisSnapshot } from "./types";

const STORE_DIR = path.join(process.cwd(), ".gitvision", "sessions");

async function ensureDir() {
  await fs.mkdir(STORE_DIR, { recursive: true });
}

function sessionPath(id: string) {
  return path.join(STORE_DIR, `${id}.json`);
}

export async function createSession(params: {
  repoUrl: string;
  name: string;
  initialSnapshot: AnalysisSnapshot;
}): Promise<Session> {
  await ensureDir();
  const now = new Date().toISOString();
  const session: Session = {
    id: nanoid(10),
    name: params.name,
    repoUrl: params.repoUrl,
    createdAt: now,
    updatedAt: now,
    snapshots: [params.initialSnapshot],
  };
  await fs.writeFile(sessionPath(session.id), JSON.stringify(session, null, 2), "utf-8");
  return session;
}

export async function getSession(id: string): Promise<Session | null> {
  try {
    const raw = await fs.readFile(sessionPath(id), "utf-8");
    return JSON.parse(raw) as Session;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function listSessions(): Promise<SessionSummary[]> {
  try {
    await ensureDir();
    const files = await fs.readdir(STORE_DIR);
    const summaries: SessionSummary[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(STORE_DIR, file), "utf-8");
        const session = JSON.parse(raw) as Session;
        const latest = session.snapshots[session.snapshots.length - 1];
        summaries.push({
          id: session.id,
          name: session.name,
          repoUrl: session.repoUrl,
          repoFullName: latest?.repo.fullName ?? session.repoUrl,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          snapshotCount: session.snapshots.length,
        });
      } catch {
        // skip corrupted session file
      }
    }
    summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return summaries;
  } catch {
    return [];
  }
}

export async function appendSnapshot(
  id: string,
  snapshot: AnalysisSnapshot
): Promise<Session | null> {
  const session = await getSession(id);
  if (!session) return null;
  session.snapshots.push(snapshot);
  session.updatedAt = new Date().toISOString();
  await fs.writeFile(sessionPath(id), JSON.stringify(session, null, 2), "utf-8");
  return session;
}

export async function renameSession(id: string, name: string): Promise<Session | null> {
  const session = await getSession(id);
  if (!session) return null;
  session.name = name;
  session.updatedAt = new Date().toISOString();
  await fs.writeFile(sessionPath(id), JSON.stringify(session, null, 2), "utf-8");
  return session;
}

export async function deleteSession(id: string): Promise<boolean> {
  try {
    await fs.unlink(sessionPath(id));
    return true;
  } catch {
    return false;
  }
}
