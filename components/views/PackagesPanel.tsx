"use client";

// Dedicated panel for package-dependency health. Surfaces the full output
// of the multi-ecosystem plugin pipeline (npm, Cargo, PyPI, ...) — vulnerable
// packages with clickable CVE links, outdated packages with age info, and
// deprecated packages with registry messages.

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  PackageX,
  Search,
  ShieldAlert,
} from "lucide-react";
import type {
  AnalysisSnapshot,
  DependencyHealth,
  DeprecatedDep,
  OutdatedDep,
  VulnerableDep,
} from "@/lib/types";
import { TOK } from "@/lib/theme";

// ------------------- Link builders -------------------

function registryUrl(ecosystem: string, name: string): string {
  switch (ecosystem) {
    case "npm":
      return `https://www.npmjs.com/package/${encodeURIComponent(name)}`;
    case "cargo":
      return `https://crates.io/crates/${encodeURIComponent(name)}`;
    case "pypi":
      return `https://pypi.org/project/${encodeURIComponent(name)}/`;
    default:
      return `https://google.com/search?q=${encodeURIComponent(`${ecosystem} ${name}`)}`;
  }
}

function vulnUrl(id: string): string {
  // osv.dev redirects GHSA-, CVE-, RUSTSEC-, PYSEC- etc. to the right page
  return `https://osv.dev/vulnerability/${encodeURIComponent(id)}`;
}

function ecosystemLabel(eco: string): string {
  switch (eco) {
    case "npm":
      return "npm";
    case "cargo":
      return "Cargo";
    case "pypi":
      return "PyPI";
    default:
      return eco;
  }
}

// ------------------- Props -------------------

export function PackagesPanel({ snapshot }: { snapshot: AnalysisSnapshot }) {
  const healths =
    snapshot.dependencyHealths ??
    (snapshot.dependencyHealth ? [snapshot.dependencyHealth] : []);
  const [query, setQuery] = useState("");

  const totals = useMemo(() => {
    let packages = 0,
      vulnerable = 0,
      outdated = 0,
      deprecated = 0;
    for (const h of healths) {
      packages += h.uniquePackages ?? h.total;
      vulnerable += h.vulnerable.length;
      outdated += h.outdated.length;
      deprecated += h.deprecated.length;
    }
    return { packages, vulnerable, outdated, deprecated };
  }, [healths]);

  if (healths.length === 0) {
    return (
      <div
        className="rounded-xl border border-dashed p-10 text-center text-sm flex flex-col gap-2"
        style={{
          borderColor: TOK.border,
          color: TOK.textMuted,
        }}
      >
        <PackageX size={20} className="mx-auto" style={{ color: TOK.textMuted }} />
        <div>No package manifests detected.</div>
        <div className="text-[11px]">
          GitVision scans{" "}
          <code className="font-mono" style={{ color: TOK.textSecondary }}>
            package.json
          </code>
          ,{" "}
          <code className="font-mono" style={{ color: TOK.textSecondary }}>
            Cargo.toml
          </code>
          ,{" "}
          <code className="font-mono" style={{ color: TOK.textSecondary }}>
            pyproject.toml
          </code>
          , and{" "}
          <code className="font-mono" style={{ color: TOK.textSecondary }}>
            requirements*.txt
          </code>
          .
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary bar */}
      <div
        className="rounded-xl p-4 flex items-center flex-wrap gap-x-6 gap-y-2"
        style={{
          background: TOK.surface,
          border: `1px solid ${TOK.border}`,
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] uppercase tracking-[0.18em] font-medium"
            style={{ color: TOK.textMuted }}
          >
            Across
          </span>
          <span
            className="text-sm font-semibold tabular-nums"
            style={{ color: TOK.textPrimary }}
          >
            {healths.length}
          </span>
          <span className="text-sm" style={{ color: TOK.textSecondary }}>
            ecosystem{healths.length === 1 ? "" : "s"}
            {": "}
            {healths.map((h) => ecosystemLabel(h.ecosystem)).join(", ")}
          </span>
        </div>
        <div className="h-5 w-px" style={{ background: TOK.border }} />
        <StatPill label="packages" count={totals.packages} />
        <StatPill
          label="vulnerable"
          count={totals.vulnerable}
          color={TOK.rose}
        />
        <StatPill
          label="outdated"
          count={totals.outdated}
          color={TOK.amber}
        />
        <StatPill
          label="deprecated"
          count={totals.deprecated}
          color={TOK.amber}
        />
      </div>

      {/* Search */}
      <div
        className="flex items-center rounded-lg"
        style={{
          background: TOK.surface,
          border: `1px solid ${TOK.border}`,
        }}
      >
        <Search size={14} className="ml-3" style={{ color: TOK.textMuted }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by package name..."
          className="flex-1 bg-transparent h-9 px-3 text-sm focus:outline-none"
          style={{ color: TOK.textPrimary }}
        />
      </div>

      {/* Per-ecosystem sections */}
      {healths.map((h) => (
        <EcosystemSection key={h.ecosystem} health={h} query={query} />
      ))}

      {/* Footer note */}
      <p className="text-xs" style={{ color: TOK.textMuted }}>
        Vulnerabilities from{" "}
        <a
          href="https://osv.dev"
          target="_blank"
          rel="noopener"
          className="underline underline-offset-2"
        >
          OSV.dev
        </a>
        . Registry metadata from each ecosystem&apos;s official API. Click any
        package name to open its registry page, or any CVE ID to see the
        advisory.
      </p>
    </div>
  );
}

// ------------------- Stat pill -------------------

function StatPill({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color?: string;
}) {
  const isZero = count === 0;
  const activeColor = color && !isZero ? color : TOK.textPrimary;
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className="text-base font-semibold tabular-nums"
        style={{ color: isZero ? TOK.textMuted : activeColor }}
      >
        {count.toLocaleString()}
      </span>
      <span
        className="text-xs"
        style={{ color: TOK.textSecondary }}
      >
        {label}
      </span>
    </div>
  );
}

// ------------------- Ecosystem section -------------------

function EcosystemSection({
  health,
  query,
}: {
  health: DependencyHealth;
  query: string;
}) {
  const q = query.trim().toLowerCase();
  const vulnerable = q
    ? health.vulnerable.filter((d) => d.name.toLowerCase().includes(q))
    : health.vulnerable;
  const outdated = q
    ? health.outdated.filter((d) => d.name.toLowerCase().includes(q))
    : health.outdated;
  const deprecated = q
    ? health.deprecated.filter((d) => d.name.toLowerCase().includes(q))
    : health.deprecated;

  const matchTotal = vulnerable.length + outdated.length + deprecated.length;
  if (q && matchTotal === 0) return null;

  return (
    <section
      className="rounded-xl overflow-hidden"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      {/* Header */}
      <header
        className="flex items-center gap-3 px-5 py-3 border-b"
        style={{ borderColor: TOK.border }}
      >
        <span
          className="text-[11px] uppercase tracking-[0.18em] font-semibold px-2 py-0.5 rounded"
          style={{
            background: TOK.accentSoft,
            color: TOK.accent,
          }}
        >
          {ecosystemLabel(health.ecosystem)}
        </span>
        <div className="flex items-center gap-4 text-xs flex-wrap">
          <span style={{ color: TOK.textSecondary }}>
            <span
              className="font-semibold tabular-nums"
              style={{ color: TOK.textPrimary }}
            >
              {health.uniquePackages ?? health.total}
            </span>{" "}
            packages
          </span>
          {health.packageFiles !== undefined && (
            <span style={{ color: TOK.textMuted }}>
              <span className="tabular-nums">{health.packageFiles}</span>{" "}
              manifest{health.packageFiles === 1 ? "" : "s"}
            </span>
          )}
          {health.note && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{
                background: "rgba(255,255,255,0.04)",
                color: TOK.textMuted,
              }}
              title={health.note}
            >
              note
            </span>
          )}
        </div>
      </header>

      {/* Sections */}
      <div className="flex flex-col divide-y" style={{ borderColor: TOK.border }}>
        {vulnerable.length > 0 && (
          <IssueGroup
            title="Vulnerable"
            icon={<ShieldAlert size={14} />}
            accent={TOK.rose}
            accentBg={TOK.roseSoft}
            count={vulnerable.length}
          >
            {vulnerable.map((d) => (
              <VulnerableRow
                key={`${d.name}@${d.current}`}
                ecosystem={health.ecosystem}
                dep={d}
              />
            ))}
          </IssueGroup>
        )}

        {outdated.length > 0 && (
          <IssueGroup
            title="Outdated"
            icon={<Clock size={14} />}
            accent={TOK.amber}
            accentBg={TOK.amberSoft}
            count={outdated.length}
          >
            {outdated.map((d) => (
              <OutdatedRow
                key={`${d.name}@${d.current}`}
                ecosystem={health.ecosystem}
                dep={d}
              />
            ))}
          </IssueGroup>
        )}

        {deprecated.length > 0 && (
          <IssueGroup
            title="Deprecated"
            icon={<AlertTriangle size={14} />}
            accent={TOK.amber}
            accentBg={TOK.amberSoft}
            count={deprecated.length}
          >
            {deprecated.map((d) => (
              <DeprecatedRow
                key={`${d.name}@${d.current}`}
                ecosystem={health.ecosystem}
                dep={d}
              />
            ))}
          </IssueGroup>
        )}

        {vulnerable.length === 0 &&
          outdated.length === 0 &&
          deprecated.length === 0 && (
            <div
              className="px-5 py-4 text-sm"
              style={{ color: TOK.textMuted }}
            >
              No issues surfaced for this ecosystem.
            </div>
          )}
      </div>
    </section>
  );
}

// ------------------- Issue group (collapsible) -------------------

function IssueGroup({
  title,
  icon,
  accent,
  accentBg,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  accentBg: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-5 py-3 text-sm transition hover:bg-white/[0.02]"
        style={{ color: TOK.textPrimary }}
      >
        {open ? (
          <ChevronDown size={14} style={{ color: TOK.textMuted }} />
        ) : (
          <ChevronRight size={14} style={{ color: TOK.textMuted }} />
        )}
        <span style={{ color: accent }}>{icon}</span>
        <span className="font-semibold">{title}</span>
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded tabular-nums"
          style={{
            background: accentBg,
            color: accent,
          }}
        >
          {count}
        </span>
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

// ------------------- Package rows -------------------

function PackageRow({
  ecosystem,
  name,
  children,
}: {
  ecosystem: string;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="px-5 py-3 flex items-start gap-3 border-t"
      style={{ borderColor: "rgba(255,255,255,0.04)" }}
    >
      <a
        href={registryUrl(ecosystem, name)}
        target="_blank"
        rel="noopener"
        className="font-mono text-[13px] font-medium flex items-center gap-1 shrink-0 hover:underline"
        style={{ color: TOK.textPrimary, minWidth: 180 }}
      >
        <span className="truncate">{name}</span>
        <ExternalLink
          size={10}
          style={{ color: TOK.textMuted }}
          className="shrink-0"
        />
      </a>
      <div className="flex-1 min-w-0 flex flex-col gap-1">{children}</div>
    </div>
  );
}

function VersionBlob({
  current,
  latest,
}: {
  current: string;
  latest?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-mono">
      <span
        className="px-1.5 py-0.5 rounded"
        style={{
          background: "rgba(255,255,255,0.04)",
          color: TOK.textPrimary,
        }}
      >
        {current}
      </span>
      {latest && (
        <>
          <span style={{ color: TOK.textMuted }}>→</span>
          <span
            className="px-1.5 py-0.5 rounded"
            style={{
              background: TOK.accentSoft,
              color: TOK.accent,
            }}
          >
            {latest}
          </span>
        </>
      )}
    </div>
  );
}

function Sources({ sources }: { sources?: string[] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div
      className="text-[10px] font-mono flex items-center gap-1.5 flex-wrap"
      style={{ color: TOK.textMuted }}
    >
      <span>in:</span>
      {sources.slice(0, 3).map((s, i) => (
        <span key={i} className="truncate max-w-[260px]">
          {s}
          {i < Math.min(sources.length, 3) - 1 ? " ·" : ""}
        </span>
      ))}
      {sources.length > 3 && <span>+{sources.length - 3} more</span>}
    </div>
  );
}

function VulnerableRow({
  ecosystem,
  dep,
}: {
  ecosystem: string;
  dep: VulnerableDep;
}) {
  return (
    <PackageRow ecosystem={ecosystem} name={dep.name}>
      <VersionBlob current={dep.current} />
      <div className="flex items-center gap-1.5 flex-wrap">
        {dep.cves.slice(0, 5).map((cve) => (
          <a
            key={cve}
            href={vulnUrl(cve)}
            target="_blank"
            rel="noopener"
            className="text-[10px] font-mono px-1.5 py-0.5 rounded hover:brightness-125 transition"
            style={{
              background: TOK.roseSoft,
              color: TOK.rose,
            }}
          >
            {cve}
          </a>
        ))}
        {dep.cves.length > 5 && (
          <span
            className="text-[10px] font-mono"
            style={{ color: TOK.textMuted }}
          >
            +{dep.cves.length - 5} more
          </span>
        )}
      </div>
      <Sources sources={dep.sources} />
    </PackageRow>
  );
}

function OutdatedRow({
  ecosystem,
  dep,
}: {
  ecosystem: string;
  dep: OutdatedDep;
}) {
  return (
    <PackageRow ecosystem={ecosystem} name={dep.name}>
      <div className="flex items-center gap-2 flex-wrap">
        <VersionBlob current={dep.current} latest={dep.latest} />
        <span
          className="text-[10px] px-1.5 py-0.5 rounded font-mono"
          style={{
            background: TOK.amberSoft,
            color: TOK.amber,
          }}
        >
          {dep.ageMonths}m behind
        </span>
      </div>
      <Sources sources={dep.sources} />
    </PackageRow>
  );
}

function DeprecatedRow({
  ecosystem,
  dep,
}: {
  ecosystem: string;
  dep: DeprecatedDep;
}) {
  return (
    <PackageRow ecosystem={ecosystem} name={dep.name}>
      <VersionBlob current={dep.current} />
      <p
        className="text-xs leading-relaxed"
        style={{ color: TOK.textSecondary }}
      >
        {dep.message}
      </p>
      <Sources sources={dep.sources} />
    </PackageRow>
  );
}
