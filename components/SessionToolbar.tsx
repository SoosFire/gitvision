"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as htmlToImage from "html-to-image";

interface Props {
  sessionId: string;
  sessionName: string;
  repoUrl: string;
  targetId: string; // DOM id of the element to screenshot
}

export function SessionToolbar({ sessionId, sessionName, repoUrl, targetId }: Props) {
  const router = useRouter();
  const [name, setName] = useState(sessionName);
  const [editing, setEditing] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  async function rename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === sessionName) {
      setEditing(false);
      setName(sessionName);
      return;
    }
    await fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    setEditing(false);
    router.refresh();
  }

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
    const el = document.getElementById(targetId);
    if (!el) {
      setMessage("Couldn't find content to capture");
      return;
    }
    try {
      const dataUrl = await htmlToImage.toPng(el, {
        pixelRatio: 2,
        backgroundColor:
          getComputedStyle(document.body).getPropertyValue("background-color") || "#ffffff",
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
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex-1 min-w-[200px]">
        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === "Enter") rename();
              if (e.key === "Escape") {
                setEditing(false);
                setName(sessionName);
              }
            }}
            className="text-2xl font-semibold tracking-tight bg-transparent border-b border-zinc-300 dark:border-zinc-700 focus:outline-none focus:border-emerald-500 w-full"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-2xl font-semibold tracking-tight hover:bg-zinc-100 dark:hover:bg-zinc-800 px-1 -mx-1 rounded transition"
            title="Click to rename"
          >
            {sessionName}
          </button>
        )}
        <div className="text-xs text-zinc-500 font-mono mt-0.5">
          <a href={repoUrl} target="_blank" rel="noopener" className="hover:underline">
            {repoUrl}
          </a>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={screenshot}
          className="h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
        >
          📸 Screenshot
        </button>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="h-9 px-3 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium hover:opacity-90 transition disabled:opacity-40"
        >
          {refreshing ? "Refreshing…" : "🔄 Refresh"}
        </button>
        <button
          onClick={remove}
          disabled={deleting}
          className="h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition disabled:opacity-40"
        >
          Delete
        </button>
      </div>
      {message && (
        <div className="w-full text-sm text-red-600 dark:text-red-400">{message}</div>
      )}
    </div>
  );
}
