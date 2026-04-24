"use client";

import { useState } from "react";
import type { AnalysisSnapshot } from "@/lib/types";
import { TOK } from "@/lib/theme";
import { Constellation } from "./views/Constellation";
import { DependencyCanvas } from "./views/DependencyCanvas";
import { PRFlow } from "./views/PRFlow";
import { PackagesPanel } from "./views/PackagesPanel";
import { HotspotTreemap } from "./views/HotspotTreemap";
import { ContributorList } from "./views/ContributorList";
import { LanguageBar } from "./views/LanguageBar";
import { BusFactorPanel } from "./views/BusFactorPanel";
import { CommitActivity } from "./views/CommitActivity";

type TabName = "canvas" | "dependencies" | "packages" | "prs" | "overview";

export function SessionTabs({ snap }: { snap: AnalysisSnapshot }) {
  const [tab, setTab] = useState<TabName>("canvas");
  const hasGraph = !!snap.fileGraph;
  const prCount = snap.pullRequests?.length ?? 0;
  const depCount = snap.fileGraph?.nodes.length ?? 0;

  // Package-dependency count across ecosystems — shown on the "Packages"
  // tab. Uses the sum of unique packages (monorepo-aware).
  const healths =
    snap.dependencyHealths ??
    (snap.dependencyHealth ? [snap.dependencyHealth] : []);
  const packageCount = healths.reduce(
    (s, h) => s + (h.uniquePackages ?? h.total),
    0
  );
  const packageIssues = healths.reduce(
    (s, h) => s + h.vulnerable.length + h.deprecated.length,
    0
  );

  return (
    <div className="flex flex-col gap-4 w-full">
      <div
        className="flex items-center border-b"
        style={{ borderColor: TOK.border }}
        role="tablist"
      >
        <Tab
          label="Canvas"
          active={tab === "canvas"}
          onClick={() => setTab("canvas")}
        />
        <Tab
          label="Imports"
          count={hasGraph ? depCount : undefined}
          hint={hasGraph ? undefined : "refresh"}
          active={tab === "dependencies"}
          onClick={() => setTab("dependencies")}
        />
        <Tab
          label="Packages"
          count={packageCount > 0 ? packageCount : undefined}
          hasIssueBadge={packageIssues > 0}
          active={tab === "packages"}
          onClick={() => setTab("packages")}
        />
        <Tab
          label="PRs"
          count={prCount > 0 ? prCount : undefined}
          active={tab === "prs"}
          onClick={() => setTab("prs")}
        />
        <Tab
          label="Overview"
          active={tab === "overview"}
          onClick={() => setTab("overview")}
        />
      </div>

      {tab === "canvas" && (
        <div className="flex flex-col gap-4">
          <Constellation snapshot={snap} />
          <p className="text-xs" style={{ color: TOK.textMuted }}>
            Tip: drag nodes to rearrange · scroll to zoom · click a file to
            inspect · use the min-churn slider to focus on the most-changed files
          </p>
        </div>
      )}

      {tab === "dependencies" && (
        <div className="flex flex-col gap-4">
          {snap.fileGraph ? (
            <DependencyCanvas graph={snap.fileGraph} />
          ) : (
            <div
              className="rounded-xl border border-dashed p-8 text-center text-sm"
              style={{
                borderColor: TOK.border,
                color: TOK.textMuted,
              }}
            >
              This snapshot was created before the dependency graph feature
              landed. Click <strong>Refresh</strong> above to build one.
            </div>
          )}
          <p className="text-xs" style={{ color: TOK.textMuted }}>
            File-to-file imports, extends/implements and framework-specific
            edges (e.g. Spring MVC controller → template). Layered top-down:
            entry points at top, leaves at bottom.
          </p>
        </div>
      )}

      {tab === "packages" && (
        <div className="flex flex-col gap-4">
          <PackagesPanel snapshot={snap} />
        </div>
      )}

      {tab === "prs" && (
        <div className="flex flex-col gap-4">
          <PRFlow prs={snap.pullRequests ?? []} />
        </div>
      )}

      {tab === "overview" && (
        <div className="grid lg:grid-cols-3 gap-4 items-start">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <HotspotTreemap hotspots={snap.hotspots} />
            <CommitActivity snap={snap} />
          </div>
          <div className="flex flex-col gap-4">
            <ContributorList contributors={snap.contributors} />
            <LanguageBar languages={snap.languages} />
            <BusFactorPanel hotspots={snap.hotspots} />
          </div>
        </div>
      )}
    </div>
  );
}

function Tab({
  label,
  count,
  hint,
  hasIssueBadge,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  hint?: string;
  hasIssueBadge?: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="h-10 px-3 text-sm font-medium flex items-center gap-1.5 transition relative"
      style={{
        color: active ? TOK.textPrimary : TOK.textSecondary,
        borderBottom: active ? `2px solid ${TOK.accent}` : "2px solid transparent",
        marginBottom: -1,
      }}
    >
      {label}
      {count !== undefined && (
        <span
          className="text-[10px] font-mono px-1 rounded tabular-nums"
          style={{
            background: TOK.surface,
            color: TOK.textMuted,
          }}
        >
          {count}
        </span>
      )}
      {hasIssueBadge && (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: TOK.rose }}
          title="Issues found in packages"
        />
      )}
      {hint && (
        <span
          className="text-[10px]"
          style={{ color: TOK.textMuted }}
        >
          {hint}
        </span>
      )}
    </button>
  );
}
