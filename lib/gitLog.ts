// Full commit-history analysis via a local `git` clone.
//
// Why: GitHub REST getCommit costs 1 API call per commit — ~7500 calls for a
// 10-year repo. Cloning with `--filter=blob:none` lets us pull metadata only
// (no file contents) and run `git log --numstat` locally in seconds.
//
// The caller gets per-commit file-change data covering the full history,
// which we feed into the same hotspot / co-change / time-scrubber pipelines
// that previously worked off a 80-commit REST sample.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { nanoid } from "nanoid";

export interface GitLogCommit {
  sha: string;
  date: string; // ISO 8601 (author date)
  authorName: string;
  authorEmail: string;
  authorLogin: string | null; // best-effort: parsed from `users.noreply.github.com` email
  message: string;
  files: string[];
}

export interface GitLogResult {
  commits: GitLogCommit[];
  truncated?: string;
  elapsedMs: number;
}

const MAX_COMMITS = 10_000; // hard cap — protects against massive repos
const MAX_FILE_CHANGES = 120_000; // cap on total (commit × file) rows
const CLONE_TIMEOUT_MS = 90_000;
const LOG_TIMEOUT_MS = 60_000;

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; maxBuffer?: number } = {}
): Promise<RunResult> {
  return new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const proc = spawn(cmd, args, { cwd: opts.cwd });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);

    proc.stdout.on("data", (d) => stdoutChunks.push(d));
    proc.stderr.on("data", (d) => stderrChunks.push(d));
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr:
          Buffer.concat(stderrChunks).toString("utf-8") +
          `\n[spawn error: ${err.message}]`,
        code: 1,
        timedOut,
      });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        code: code ?? 0,
        timedOut,
      });
    });
  });
}

// GitHub noreply email forms:
//   username@users.noreply.github.com
//   12345+username@users.noreply.github.com
function loginFromEmail(email: string): string | null {
  const m = /^(?:\d+\+)?([a-zA-Z0-9][a-zA-Z0-9-]*)@users\.noreply\.github\.com$/i.exec(
    email
  );
  return m ? m[1] : null;
}

// Record / unit separators we use inside the `--format` string so we can
// safely split even if the commit message contains pipes, tabs, etc.
const GS = "\x1e";
const US = "\x1f";

/**
 * Clone the repo (treeless + bare) into a temp dir and stream git log --numstat.
 * Returns per-commit file-change data covering the full reachable history (up
 * to MAX_COMMITS / MAX_FILE_CHANGES safety caps).
 */
export async function analyzeRepoHistory(
  owner: string,
  repo: string
): Promise<GitLogResult> {
  const started = Date.now();
  const tmpDir = path.join(os.tmpdir(), `gitvision-git-${nanoid(8)}`);
  const cloneUrl = `https://github.com/${owner}/${repo}.git`;

  try {
    const clone = await run(
      "git",
      [
        "clone",
        "--bare",
        "--filter=blob:none",
        "--no-tags",
        "--quiet",
        cloneUrl,
        tmpDir,
      ],
      { timeoutMs: CLONE_TIMEOUT_MS }
    );
    if (clone.code !== 0) {
      return {
        commits: [],
        truncated: clone.timedOut
          ? "git clone timed out (90s)"
          : `git clone failed: ${clone.stderr.slice(0, 200).trim()}`,
        elapsedMs: Date.now() - started,
      };
    }

    const formatStr = `${GS}%H${US}%aI${US}%an${US}%ae${US}%s`;
    // --raw gives us per-commit file paths (from tree diffs) *without* needing
    // blob contents — essential when cloned with `--filter=blob:none`.
    // Format per file row: ":mode1 mode2 sha1 sha2 STATUS\tPATH[\tNEWPATH]"
    const log = await run(
      "git",
      [
        "log",
        "--raw",
        "--no-renames",
        "--no-merges",
        `--format=${formatStr}`,
        `--max-count=${MAX_COMMITS}`,
      ],
      { cwd: tmpDir, timeoutMs: LOG_TIMEOUT_MS }
    );
    if (log.code !== 0) {
      return {
        commits: [],
        truncated: log.timedOut
          ? "git log timed out (60s)"
          : `git log failed: ${log.stderr.slice(0, 200).trim()}`,
        elapsedMs: Date.now() - started,
      };
    }

    const commits: GitLogCommit[] = [];
    let totalFileRows = 0;
    let truncated: string | undefined;
    let current: GitLogCommit | null = null;
    let hitCap = false;

    for (const rawLine of log.stdout.split("\n")) {
      if (hitCap) break;
      const line = rawLine.replace(/\r$/, "");
      if (!line) continue;

      if (line.startsWith(GS)) {
        if (current) commits.push(current);
        const payload = line.slice(1);
        const parts = payload.split(US);
        const [sha, date, name, email, ...msgParts] = parts;
        current = {
          sha: sha ?? "",
          date: date ?? "",
          authorName: name ?? "",
          authorEmail: email ?? "",
          authorLogin: loginFromEmail(email ?? ""),
          message: (msgParts.join(US) ?? "").slice(0, 200),
          files: [],
        };
        continue;
      }

      if (!current) continue;

      // --raw rows: ":mode1 mode2 sha1 sha2 STATUS\tPATH[\tNEWPATH]"
      // Path lives after the tab following the status letter.
      if (line.startsWith(":")) {
        const tabIdx = line.indexOf("\t");
        if (tabIdx < 0) continue;
        const pathPart = line.slice(tabIdx + 1);
        // For renames/copies (R/C) the value is "OLD\tNEW" — we want the new
        // path so imports continue to point at currently-named files.
        const lastTab = pathPart.lastIndexOf("\t");
        const filePath = lastTab >= 0 ? pathPart.slice(lastTab + 1) : pathPart;
        current.files.push(filePath);
        totalFileRows++;
        if (totalFileRows >= MAX_FILE_CHANGES) {
          truncated = `File-change cap reached (${MAX_FILE_CHANGES.toLocaleString()})`;
          hitCap = true;
        }
      }
    }
    if (current) commits.push(current);

    if (!truncated && commits.length >= MAX_COMMITS) {
      truncated = `Commit cap reached (${MAX_COMMITS.toLocaleString()})`;
    }

    return { commits, truncated, elapsedMs: Date.now() - started };
  } catch (err) {
    return {
      commits: [],
      truncated: err instanceof Error ? err.message : "Unknown error",
      elapsedMs: Date.now() - started,
    };
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
