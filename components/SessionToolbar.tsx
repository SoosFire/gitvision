"use client";

// Session topbar. Actions grouped:
//   - Primary: Refresh (accent)
//   - Share dropdown: Wrapped, Share card, Screenshot
//   - Overflow menu: Delete (destructive)
// Rename is still triggered by clicking the session name in the hero.

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as htmlToImage from "html-to-image";
import {
  ArrowLeft,
  Camera,
  ChevronDown,
  Gift,
  MoreHorizontal,
  RefreshCw,
  Share2,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { AnalysisSnapshot } from "@/lib/types";
import { TOK } from "@/lib/theme";
import { ShareCardModal } from "./ShareCardModal";
import { ContributorWrappedModal } from "./ContributorWrappedModal";

interface Props {
  sessionId: string;
  sessionName: string;
  snapshot: AnalysisSnapshot;
  targetId: string;
  // Delivered from the parent session page so we know what to show in the top strip
  updatedAtISO: string;
  snapshotCount: number;
}

function formatRel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = 60_000,
    hr = 60 * min,
    day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  const days = Math.floor(diff / day);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

export function SessionToolbar({
  sessionId,
  sessionName,
  snapshot,
  targetId,
  updatedAtISO,
  snapshotCount,
}: Props) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [wrappedOpen, setWrappedOpen] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) {
        setShareMenuOpen(false);
      }
      if (
        overflowMenuRef.current &&
        !overflowMenuRef.current.contains(e.target as Node)
      ) {
        setOverflowOpen(false);
      }
    }
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, []);

  function refresh() {
    startRefresh(async () => {
      setMessage(null);
      const res = await fetch(`/api/sessions/${sessionId}/refresh`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage(data.error || "Refresh failed");
        return;
      }
      router.refresh();
    });
  }

  function remove() {
    if (!confirm(`Delete session "${sessionName}"? This cannot be undone.`)) return;
    startDelete(async () => {
      await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
      router.push("/");
      router.refresh();
    });
  }

  async function screenshot() {
    setShareMenuOpen(false);
    const el = document.getElementById(targetId);
    if (!el) {
      setMessage("Couldn't find content to capture");
      return;
    }
    try {
      const dataUrl = await htmlToImage.toPng(el, {
        pixelRatio: 2,
        backgroundColor:
          getComputedStyle(document.body).getPropertyValue("background-color") ||
          TOK.bg,
        cacheBust: true,
      });
      const link = document.createElement("a");
      link.download = `gitvision-${sessionName.replace(/\s+/g, "-").toLowerCase()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Screenshot failed");
    }
  }

  return (
    <div
      className="border-b"
      style={{ borderColor: TOK.border }}
    >
      <div className="max-w-6xl mx-auto px-8 h-14 flex items-center gap-4">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-sm transition"
          style={{ color: TOK.textSecondary }}
        >
          <ArrowLeft size={14} />
          <span>All sessions</span>
        </Link>
        <div className="h-5 w-px" style={{ background: TOK.border }} />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className="font-mono text-sm truncate"
            style={{ color: TOK.textPrimary }}
          >
            {snapshot.repo.fullName}
          </span>
          <span
            className="text-xs shrink-0"
            style={{ color: TOK.textMuted }}
          >
            · updated {formatRel(updatedAtISO)} · snapshot {snapshotCount} of{" "}
            {snapshotCount}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Share dropdown */}
          <div ref={shareMenuRef} className="relative">
            <button
              onClick={() => setShareMenuOpen((v) => !v)}
              className="h-8 px-3 rounded-md text-xs transition flex items-center gap-1.5 hover:bg-white/5"
              style={{
                background: TOK.surface,
                border: `1px solid ${TOK.border}`,
                color: TOK.textSecondary,
              }}
            >
              <Share2 size={14} />
              <span>Share</span>
              <ChevronDown size={12} style={{ color: TOK.textMuted }} />
            </button>
            {shareMenuOpen && (
              <div
                className="absolute right-0 mt-1 w-56 rounded-lg py-1 z-50 shadow-xl"
                style={{
                  background: TOK.surfaceElevated,
                  border: `1px solid ${TOK.borderStrong}`,
                }}
              >
                <MenuItem
                  icon={<Sparkles size={14} />}
                  label="Share card"
                  hint="1200×630 branded PNG"
                  onClick={() => {
                    setShareMenuOpen(false);
                    setShareOpen(true);
                  }}
                />
                <MenuItem
                  icon={<Gift size={14} />}
                  label="Contributor Wrapped"
                  hint="Per-person portrait cards"
                  onClick={() => {
                    setShareMenuOpen(false);
                    setWrappedOpen(true);
                  }}
                />
                <MenuItem
                  icon={<Camera size={14} />}
                  label="Screenshot page"
                  hint="Capture everything as PNG"
                  onClick={screenshot}
                />
              </div>
            )}
          </div>

          {/* Refresh — primary */}
          <button
            onClick={refresh}
            disabled={refreshing}
            className="h-8 px-3 rounded-md text-xs font-medium transition flex items-center gap-1.5 disabled:opacity-40 hover:brightness-110"
            style={{
              background: TOK.accent,
              color: TOK.accentOn,
            }}
          >
            <RefreshCw
              size={13}
              className={refreshing ? "animate-spin" : ""}
            />
            <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
          </button>

          {/* Overflow */}
          <div ref={overflowMenuRef} className="relative">
            <button
              onClick={() => setOverflowOpen((v) => !v)}
              className="h-8 w-8 rounded-md transition flex items-center justify-center hover:bg-white/5"
              style={{
                background: TOK.surface,
                border: `1px solid ${TOK.border}`,
                color: TOK.textMuted,
              }}
              aria-label="More actions"
            >
              <MoreHorizontal size={14} />
            </button>
            {overflowOpen && (
              <div
                className="absolute right-0 mt-1 w-48 rounded-lg py-1 z-50 shadow-xl"
                style={{
                  background: TOK.surfaceElevated,
                  border: `1px solid ${TOK.borderStrong}`,
                }}
              >
                <MenuItem
                  icon={<Trash2 size={14} />}
                  label="Delete session"
                  danger
                  disabled={deleting}
                  onClick={() => {
                    setOverflowOpen(false);
                    remove();
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {message && (
        <div
          className="max-w-6xl mx-auto px-8 py-2 text-xs"
          style={{ color: TOK.rose }}
        >
          {message}
        </div>
      )}

      <ShareCardModal
        snapshot={snapshot}
        sessionName={sessionName}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />
      <ContributorWrappedModal
        snapshot={snapshot}
        open={wrappedOpen}
        onClose={() => setWrappedOpen(false)}
      />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  danger,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-white/5 disabled:opacity-40"
      style={{
        color: danger ? TOK.rose : TOK.textPrimary,
      }}
    >
      <span className="shrink-0 mt-0.5" aria-hidden>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div>{label}</div>
        {hint && (
          <div
            className="text-[11px] mt-0.5"
            style={{ color: TOK.textMuted }}
          >
            {hint}
          </div>
        )}
      </div>
    </button>
  );
}
