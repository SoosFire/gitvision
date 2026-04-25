// Minimal tsconfig.json reader for TypeScript path mappings.
//
// Why this lives here: the JS/TS plugin needs to resolve @/foo and ~/bar style
// imports against compilerOptions.paths, which means reading tsconfig.json at
// load time (per-repo, not per-process). The resolver must stay synchronous
// once running, so we parse and freeze a small struct ahead of time.
//
// Scope intentionally limited:
//   - Only reads tsconfig.json at the project root (not extends chains, not
//     monorepo subdirectory configs).
//   - Supports compilerOptions.baseUrl and compilerOptions.paths.
//   - Tolerates JSON-with-comments (tsconfig allows them).
// Anything beyond this is out of scope for this iteration — flag and revisit
// if real repos demand it.

import { promises as fs } from "node:fs";
import path from "node:path";

export interface TsPathMappings {
  /** Repo-rel posix path that baseUrl + paths resolve against.
   *  "" means repo root. */
  baseUrl: string;
  /** tsconfig pattern → array of substitutions, both as written. The matcher
   *  handles trailing "/*" wildcards. */
  paths: Record<string, string[]>;
}

/** Best-effort tsconfig.json/jsconfig.json read. Returns null if absent or
 *  malformed beyond comment-stripping. Never throws. */
export async function loadTsconfigPaths(
  repoRoot: string
): Promise<TsPathMappings | null> {
  // Try tsconfig.json first, then jsconfig.json (used for plain JS projects)
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const full = path.join(repoRoot, name);
    let text: string;
    try {
      text = await fs.readFile(full, "utf-8");
    } catch {
      continue;
    }
    const parsed = parseJsonTolerant(text);
    if (!parsed || typeof parsed !== "object") continue;
    const co = (parsed as Record<string, unknown>).compilerOptions;
    if (!co || typeof co !== "object") continue;
    const opts = co as Record<string, unknown>;

    const rawBaseUrl =
      typeof opts.baseUrl === "string" ? opts.baseUrl : "";
    // Normalize baseUrl to a posix path relative to repo root.
    const baseUrl = path.posix.normalize(
      rawBaseUrl.replace(/\\/g, "/").replace(/^\.\/?/, "")
    );

    const rawPaths =
      opts.paths && typeof opts.paths === "object"
        ? (opts.paths as Record<string, unknown>)
        : {};
    const paths: Record<string, string[]> = {};
    for (const [pattern, value] of Object.entries(rawPaths)) {
      if (!Array.isArray(value)) continue;
      const subs = value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.replace(/\\/g, "/"));
      if (subs.length > 0) paths[pattern] = subs;
    }

    if (Object.keys(paths).length === 0 && !rawBaseUrl) continue;
    return { baseUrl: baseUrl === "." ? "" : baseUrl, paths };
  }
  return null;
}

/** Apply tsconfig path mappings to an import spec. Returns 0+ candidate
 *  repo-rel paths (without extensions — caller appends .ts/.tsx/etc.). */
export function applyPathMapping(
  spec: string,
  mappings: TsPathMappings
): string[] {
  const candidates: string[] = [];
  for (const [pattern, subs] of Object.entries(mappings.paths)) {
    const matched = matchPattern(pattern, spec);
    if (matched === null) continue;
    for (const sub of subs) {
      const filled = fillSubstitution(sub, matched);
      const joined = mappings.baseUrl
        ? path.posix.normalize(path.posix.join(mappings.baseUrl, filled))
        : path.posix.normalize(filled);
      // Strip "./" prefix that normalize may leave on simple paths
      candidates.push(joined.replace(/^\.\//, ""));
    }
  }
  return candidates;
}

/** Match a tsconfig path pattern against a spec. Returns the wildcard capture
 *  string, or "" for an exact (no-wildcard) match, or null for no match. */
function matchPattern(pattern: string, spec: string): string | null {
  const star = pattern.indexOf("*");
  if (star === -1) {
    return pattern === spec ? "" : null;
  }
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!spec.startsWith(prefix)) return null;
  if (!spec.endsWith(suffix)) return null;
  if (spec.length < prefix.length + suffix.length) return null;
  return spec.slice(prefix.length, spec.length - suffix.length);
}

/** Substitute the wildcard capture into a substitution template. */
function fillSubstitution(sub: string, captured: string): string {
  const star = sub.indexOf("*");
  if (star === -1) return sub;
  return sub.slice(0, star) + captured + sub.slice(star + 1);
}

/** Tolerant JSON: tries strict parse first, then strips line + block comments
 *  (tsconfig allows JSONC) and tries again. Returns null on failure. */
function parseJsonTolerant(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // fall through
  }
  // Strip block comments first, then line comments. This is approximate —
  // a "//" inside a string would be wrongly stripped — but works for the
  // overwhelming majority of tsconfigs in the wild.
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1");
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}
