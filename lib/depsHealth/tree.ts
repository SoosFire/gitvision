// Fetch the repo's full file tree once, share across all ecosystem plugins.
// Uses GitHub's Git Trees API (recursive=true) — single call for any repo size
// regardless of how many manifest formats we're looking for.

import type { Octokit } from "octokit";

// Paths under any of these folders are irrelevant for first-party manifest
// detection in every ecosystem we support. Centralizing here so plugins can
// stay focused on their own filename patterns.
const UNIVERSAL_SKIP_PATTERNS: RegExp[] = [
  /(^|\/)node_modules\//,
  /(^|\/)\.git\//,
  /(^|\/)vendor\//,
  /(^|\/)bower_components\//,
  /(^|\/)\.next\//,
  /(^|\/)\.cache\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)coverage\//,
  /(^|\/)out\//,
  /(^|\/)target\//, // Rust build output
  /(^|\/)\.venv\//, // Python venv
  /(^|\/)venv\//,
  /(^|\/)__pycache__\//,
  /(^|\/)\.idea\//,
  /(^|\/)\.vscode\//,
];

export async function fetchRepoTree(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<string[]> {
  try {
    const { data } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: ref,
      recursive: "true",
    });
    return (data.tree ?? [])
      .filter((n) => n.type === "blob" && typeof n.path === "string")
      .map((n) => n.path as string)
      .filter((p) => !UNIVERSAL_SKIP_PATTERNS.some((re) => re.test(p)));
  } catch {
    return [];
  }
}
