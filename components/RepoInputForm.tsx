"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RepoInputForm() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!value.trim()) return;

    startTransition(async () => {
      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoUrl: value.trim() }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Something went wrong");
          return;
        }
        router.push(`/session/${data.session.id}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://github.com/owner/repo"
          disabled={pending}
          className="w-full h-14 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 pr-32 text-base placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="absolute right-2 top-2 bottom-2 px-5 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-medium text-sm hover:opacity-90 transition disabled:opacity-40"
        >
          {pending ? "Analyzing…" : "Analyze"}
        </button>
      </div>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 px-2">{error}</p>
      )}
      {pending && (
        <p className="text-xs text-zinc-500 px-2">
          Fetching repo data, commits, and computing hotspots. Large repos may take a moment.
        </p>
      )}
    </form>
  );
}
