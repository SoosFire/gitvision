"use client";

import { useState } from "react";
import type { AnalysisSnapshot } from "@/lib/types";
import { Constellation } from "./views/Constellation";
import { HotspotTreemap } from "./views/HotspotTreemap";
import { ContributorList } from "./views/ContributorList";
import { LanguageBar } from "./views/LanguageBar";
import { BusFactorPanel } from "./views/BusFactorPanel";
import { CommitActivity } from "./views/CommitActivity";

export function SessionTabs({ snap }: { snap: AnalysisSnapshot }) {
  const [tab, setTab] = useState<"canvas" | "overview">("canvas");

  return (
    <div className="flex flex-col gap-4 w-full">
      <div
        className="inline-flex self-start gap-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1"
        role="tablist"
      >
        <TabButton active={tab === "canvas"} onClick={() => setTab("canvas")}>
          Canvas
        </TabButton>
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
          Overview
        </TabButton>
      </div>

      {tab === "canvas" && (
        <div className="flex flex-col gap-4">
          <Constellation snapshot={snap} />
          <p className="text-xs text-zinc-500">
            Tip: drag nodes to rearrange · scroll to zoom · click a file to inspect ·
            use the min-churn slider to focus on the most-changed files
          </p>
        </div>
      )}

      {tab === "overview" && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                Hotspots
              </h2>
              <HotspotTreemap hotspots={snap.hotspots} />
            </section>
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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative px-4 h-9 rounded-md text-sm font-medium transition ${
        active
          ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
          : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}
