"use client";

// Per-contributor "Wrapped"-style cards — Spotify Wrapped for a repo.
// Opens a modal with a grid of portrait cards (one per top contributor).
// Each card is independently downloadable as a PNG.

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import * as htmlToImage from "html-to-image";
import type { AnalysisSnapshot, Contributor } from "@/lib/types";

interface Props {
  snapshot: AnalysisSnapshot;
  open: boolean;
  onClose: () => void;
}

const CARD_W = 500;
const CARD_H = 720;

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

interface ContribStats {
  key: string; // login if present, else author name
  displayName: string;
  login: string | null;
  commits: number;
  topFile: { path: string; count: number } | null;
  favoriteDay: string | null;
  peakHour: number | null;
  firstCommit: string | null;
}

function computeStats(snapshot: AnalysisSnapshot): ContribStats[] {
  // sha → { date, login, name }
  const shaMeta = new Map<
    string,
    { date: string; login: string | null; name: string }
  >();
  if (snapshot.commitIndex) {
    for (const [sha, meta] of Object.entries(snapshot.commitIndex)) {
      shaMeta.set(sha, { date: meta.d, login: meta.a, name: meta.n ?? "" });
    }
  }
  for (const c of snapshot.recentCommits ?? []) {
    if (!shaMeta.has(c.sha)) {
      shaMeta.set(c.sha, {
        date: c.date,
        login: c.authorLogin,
        name: c.authorName,
      });
    }
  }

  // Build per-author buckets keyed by login-or-name
  interface Bucket {
    key: string;
    displayName: string;
    login: string | null;
    shas: Set<string>;
    files: Map<string, number>;
  }
  const byKey = new Map<string, Bucket>();
  function keyFor(login: string | null, name: string): string {
    return login ? `L:${login}` : `N:${name.toLowerCase()}`;
  }

  for (const h of snapshot.hotspots) {
    for (const sha of h.commits ?? []) {
      const meta = shaMeta.get(sha);
      if (!meta) continue;
      if (!meta.login && !meta.name) continue;
      const key = keyFor(meta.login, meta.name);
      const existing = byKey.get(key);
      if (existing) {
        existing.shas.add(sha);
        existing.files.set(
          h.path,
          (existing.files.get(h.path) ?? 0) + 1
        );
      } else {
        byKey.set(key, {
          key,
          displayName: meta.login ?? meta.name ?? "unknown",
          login: meta.login,
          shas: new Set([sha]),
          files: new Map([[h.path, 1]]),
        });
      }
    }
  }

  const stats: ContribStats[] = [];
  for (const bucket of byKey.values()) {
    const dayCounts = new Array(7).fill(0);
    const hourCounts = new Array(24).fill(0);
    let firstTs = Number.POSITIVE_INFINITY;

    for (const sha of bucket.shas) {
      const meta = shaMeta.get(sha);
      if (!meta?.date) continue;
      const d = new Date(meta.date);
      if (Number.isNaN(d.getTime())) continue;
      dayCounts[d.getDay()]++;
      hourCounts[d.getHours()]++;
      if (d.getTime() < firstTs) firstTs = d.getTime();
    }

    const dayIdx = dayCounts.indexOf(Math.max(...dayCounts));
    const hourIdx = hourCounts.indexOf(Math.max(...hourCounts));
    let topFile: { path: string; count: number } | null = null;
    for (const [path, count] of bucket.files) {
      if (!topFile || count > topFile.count) topFile = { path, count };
    }

    stats.push({
      key: bucket.key,
      displayName: bucket.displayName,
      login: bucket.login,
      commits: bucket.shas.size,
      topFile,
      favoriteDay: dayCounts[dayIdx] > 0 ? DAY_NAMES[dayIdx] : null,
      peakHour: hourCounts[hourIdx] > 0 ? hourIdx : null,
      firstCommit:
        firstTs === Number.POSITIVE_INFINITY
          ? null
          : new Date(firstTs).toISOString(),
    });
  }

  stats.sort((a, b) => b.commits - a.commits);
  return stats;
}

function contributorFor(
  login: string | null,
  contributors: Contributor[]
): Contributor | null {
  if (!login) return null;
  const lower = login.toLowerCase();
  return (
    contributors.find((c) => c.login.toLowerCase() === lower) ?? null
  );
}

function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function formatMonthYear(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function fileBasename(p: string): string {
  return p.split("/").pop() || p;
}

// ------------------- Single card -------------------

interface CardProps {
  repoFullName: string;
  stats: ContribStats;
  contributor: Contributor | null;
}

function WrappedCard({ repoFullName, stats, contributor }: CardProps) {
  const hue = (() => {
    let h = 0;
    const src = stats.displayName;
    for (const ch of src) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  })();

  const initial = stats.displayName.charAt(0).toUpperCase() || "?";

  return (
    <div
      style={{
        width: CARD_W,
        height: CARD_H,
        background: `linear-gradient(160deg, hsl(${hue}, 55%, 12%) 0%, #0b0b14 55%, hsl(${
          (hue + 60) % 360
        }, 60%, 10%) 100%)`,
        color: "#fafafa",
        padding: 40,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 20,
        position: "relative",
        overflow: "hidden",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
      }}
    >
      {/* Decorative blobs */}
      <div
        style={{
          position: "absolute",
          top: -120,
          right: -120,
          width: 320,
          height: 320,
          borderRadius: "50%",
          background: `radial-gradient(circle, hsla(${hue}, 80%, 50%, 0.3) 0%, hsla(${hue}, 80%, 50%, 0) 70%)`,
          filter: "blur(8px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -160,
          left: -120,
          width: 360,
          height: 360,
          borderRadius: "50%",
          background: `radial-gradient(circle, hsla(${
            (hue + 60) % 360
          }, 80%, 50%, 0.25) 0%, hsla(${hue}, 80%, 50%, 0) 70%)`,
          filter: "blur(8px)",
        }}
      />

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: "#10b981",
            }}
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            GitVision · Wrapped
          </span>
        </div>
        <span
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.55)",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          }}
        >
          {repoFullName}
        </span>
      </div>

      {/* Contributor avatar + name */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          position: "relative",
        }}
      >
        {contributor ? (
          <Image
            src={contributor.avatarUrl}
            alt={stats.displayName}
            width={72}
            height={72}
            unoptimized
            style={{
              borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.25)",
            }}
          />
        ) : (
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.25)",
              background: `hsl(${hue}, 65%, 30%)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
              fontWeight: 700,
              color: "rgba(255,255,255,0.9)",
            }}
          >
            {initial}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "rgba(255,255,255,0.5)",
            }}
          >
            This is
          </span>
          <span
            style={{
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              background:
                "linear-gradient(90deg, #ffffff 0%, #bfdbfe 60%, #c4b5fd 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              lineHeight: 1.1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 340,
            }}
          >
            {stats.login ? `@${stats.login}` : stats.displayName}
          </span>
        </div>
      </div>

      {/* Hero number */}
      <div
        style={{
          position: "relative",
          padding: "18px 22px",
          borderRadius: 16,
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          alignItems: "baseline",
          gap: 14,
        }}
      >
        <span
          style={{
            fontSize: 56,
            fontWeight: 800,
            letterSpacing: "-0.04em",
            lineHeight: 1,
          }}
        >
          {stats.commits.toLocaleString()}
        </span>
        <span
          style={{
            fontSize: 13,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color: "rgba(255,255,255,0.55)",
          }}
        >
          commits in sample
        </span>
      </div>

      {/* Stat rows */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          position: "relative",
          flex: 1,
          minHeight: 0,
        }}
      >
        <StatRow
          label="Pet file"
          value={stats.topFile ? fileBasename(stats.topFile.path) : "—"}
          sub={stats.topFile ? stats.topFile.path : undefined}
        />
        <StatRow
          label="Favorite day"
          value={stats.favoriteDay ?? "—"}
        />
        <StatRow
          label="Peak hour"
          value={stats.peakHour != null ? formatHour(stats.peakHour) : "—"}
        />
        <StatRow
          label="Debut"
          value={
            stats.firstCommit ? formatMonthYear(stats.firstCommit) : "—"
          }
        />
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: "rgba(255,255,255,0.45)",
          position: "relative",
        }}
      >
        <span>gitvision.app</span>
        <span>#GitVisionWrapped</span>
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "10px 14px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <span
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: "rgba(255,255,255,0.5)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 18,
          fontWeight: 600,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          letterSpacing: "-0.01em",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </span>
      {sub && (
        <span
          style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.4)",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

// ------------------- Modal -------------------

export function ContributorWrappedModal({ snapshot, open, onClose }: Props) {
  const allStats = useMemo(() => computeStats(snapshot), [snapshot]);
  const topStats = useMemo(() => allStats.slice(0, 12), [allStats]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function download(key: string, displayName: string) {
    setError(null);
    setDownloading(key);
    try {
      const el = cardRefs.current.get(key);
      if (!el) throw new Error("Card not mounted");
      const dataUrl = await htmlToImage.toPng(el, {
        pixelRatio: 2,
        cacheBust: true,
        width: CARD_W,
        height: CARD_H,
        style: { transform: "none" },
      });
      const safe = displayName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
      const link = document.createElement("a");
      link.download = `gitvision-wrapped-${snapshot.repo.name}-${safe}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(null);
    }
  }

  const hasData = topStats.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={onClose}
    >
      <div
        className="relative bg-zinc-100 dark:bg-zinc-900 rounded-2xl border border-zinc-300 dark:border-zinc-700 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        style={{ width: "min(1180px, 96vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">
              Contributor Wrapped{" "}
              <span className="text-zinc-500 font-normal text-sm">
                · {snapshot.repo.fullName}
              </span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition text-zinc-500"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {!hasData ? (
          <div className="p-10 text-center text-sm text-zinc-500">
            No per-contributor data in this snapshot yet. Click{" "}
            <strong>Refresh</strong> to build it.
          </div>
        ) : (
          <div
            className="flex-1 min-h-0 p-6 overflow-auto"
            style={{ background: "rgba(0,0,0,0.2)" }}
          >
            <div
              className="grid gap-6 justify-items-center"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              }}
            >
              {topStats.map((s) => {
                const contributor = contributorFor(
                  s.login,
                  snapshot.contributors
                );
                const scale = 260 / CARD_W;
                return (
                  <div
                    key={s.key}
                    className="flex flex-col items-center gap-2"
                  >
                    <div
                      style={{
                        width: CARD_W * scale,
                        height: CARD_H * scale,
                        borderRadius: 12,
                        overflow: "hidden",
                        position: "relative",
                        boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
                      }}
                    >
                      <div
                        ref={(el) => {
                          if (el) cardRefs.current.set(s.key, el);
                          else cardRefs.current.delete(s.key);
                        }}
                        style={{
                          transform: `scale(${scale})`,
                          transformOrigin: "top left",
                          width: CARD_W,
                          height: CARD_H,
                        }}
                      >
                        <WrappedCard
                          repoFullName={snapshot.repo.fullName}
                          stats={s}
                          contributor={contributor}
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => download(s.key, s.displayName)}
                      disabled={downloading === s.key}
                      className="text-xs px-3 py-1 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition disabled:opacity-40"
                    >
                      {downloading === s.key ? "Rendering…" : "⬇ PNG"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <div className="px-5 py-2 border-t border-zinc-200 dark:border-zinc-800 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
        <div className="px-5 py-2 border-t border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500">
          Stats come from the sampled commit history. Avatars show when the
          author&apos;s git email ties to a GitHub login (typically{" "}
          <code>noreply.github.com</code>); otherwise we use the author name.
        </div>
      </div>
    </div>
  );
}
