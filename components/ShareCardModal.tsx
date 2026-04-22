"use client";

// Modal that previews the share card at exact pixel dimensions (scaled to fit),
// lets the user flip variant (landscape / square), and downloads a PNG.

import { useEffect, useRef, useState } from "react";
import * as htmlToImage from "html-to-image";
import type { AnalysisSnapshot } from "@/lib/types";
import {
  ShareCard,
  SHARE_CARD_DIMS,
  type ShareCardVariant,
} from "./ShareCard";

interface Props {
  snapshot: AnalysisSnapshot;
  sessionName: string;
  open: boolean;
  onClose: () => void;
}

export function ShareCardModal({
  snapshot,
  sessionName,
  open,
  onClose,
}: Props) {
  const [variant, setVariant] = useState<ShareCardVariant>("landscape");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const dim = SHARE_CARD_DIMS[variant];

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      if (!cardRef.current) throw new Error("Card not mounted");
      const dataUrl = await htmlToImage.toPng(cardRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        width: dim.w,
        height: dim.h,
        style: { transform: "none" }, // override preview scaling
      });
      const link = document.createElement("a");
      link.download = `gitvision-${sessionName
        .replace(/\s+/g, "-")
        .toLowerCase()}-${variant}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  // Scale the card to fit the viewport preview area
  const previewMaxW = Math.min(960, typeof window !== "undefined" ? window.innerWidth - 120 : 960);
  const previewMaxH = Math.min(620, typeof window !== "undefined" ? window.innerHeight - 260 : 620);
  const scale = Math.min(previewMaxW / dim.w, previewMaxH / dim.h, 1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <div
        className="relative bg-zinc-100 dark:bg-zinc-900 rounded-2xl border border-zinc-300 dark:border-zinc-700 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        style={{ maxWidth: "min(1040px, 95vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Share card</h2>
            <span className="text-xs text-zinc-500">
              {dim.w}×{dim.h}
            </span>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition text-zinc-500"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Preview */}
        <div
          className="flex-1 min-h-0 p-6 flex items-center justify-center overflow-hidden"
          style={{ background: "rgba(0,0,0,0.15)" }}
        >
          <div
            style={{
              width: dim.w * scale,
              height: dim.h * scale,
              position: "relative",
              borderRadius: 12,
              overflow: "hidden",
              boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
            }}
          >
            <div
              ref={cardRef}
              style={{
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                width: dim.w,
                height: dim.h,
              }}
            >
              <ShareCard snapshot={snapshot} variant={variant} />
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
          <div
            role="tablist"
            className="inline-flex gap-1 rounded-lg border border-zinc-200 dark:border-zinc-800 p-1"
          >
            <button
              role="tab"
              aria-selected={variant === "landscape"}
              onClick={() => setVariant("landscape")}
              className={`px-3 h-8 rounded-md text-sm font-medium transition ${
                variant === "landscape"
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              Landscape · 1200×630
            </button>
            <button
              role="tab"
              aria-selected={variant === "square"}
              onClick={() => setVariant("square")}
              className={`px-3 h-8 rounded-md text-sm font-medium transition ${
                variant === "square"
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              Square · 1080×1080
            </button>
          </div>

          <div className="flex items-center gap-3">
            {error && (
              <span className="text-sm text-red-600 dark:text-red-400">
                {error}
              </span>
            )}
            <span className="text-xs text-zinc-500 hidden sm:inline">
              OG / Twitter / LinkedIn · Instagram
            </span>
            <button
              onClick={download}
              disabled={downloading}
              className="h-9 px-4 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium hover:opacity-90 transition disabled:opacity-40"
            >
              {downloading ? "Rendering…" : "Download PNG"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
