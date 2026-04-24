// OSV.dev batch query — ecosystem-agnostic shared helper.
// https://google.github.io/osv.dev/post-v1-querybatch/
//
// Every ecosystem plugin passes its own `osvEcosystem` string (e.g. "npm",
// "crates.io", "PyPI"). OSV handles the rest, returning vulnerability IDs per
// (package, version) pair.

interface OsvVulnRef {
  id: string;
}
interface OsvBatchResult {
  vulns?: OsvVulnRef[];
}

export interface OsvQuery {
  name: string;
  version: string;
  ecosystem: string; // OSV-specific ecosystem string
}

export async function fetchOsvBatch(queries: OsvQuery[]): Promise<string[][]> {
  if (queries.length === 0) return [];
  try {
    const res = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queries: queries.map((q) => ({
          package: { name: q.name, ecosystem: q.ecosystem },
          version: q.version,
        })),
      }),
    });
    if (!res.ok) return queries.map(() => []);
    const data = (await res.json()) as { results?: OsvBatchResult[] };
    const results = data.results ?? [];
    return queries.map((_, i) =>
      (results[i]?.vulns ?? []).map((v) => v.id)
    );
  } catch {
    return queries.map(() => []);
  }
}
