// Landing page: paste a GitHub URL + list of saved sessions.

import Link from "next/link";
import { listSessions } from "@/lib/storage";
import { RepoInputForm } from "@/components/RepoInputForm";
import { SessionCard } from "@/components/SessionCard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const sessions = await listSessions();

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16 canvas-dots">
      <div className="w-full max-w-3xl flex flex-col gap-10">
        <header className="flex flex-col gap-3 text-center">
          <div className="inline-flex mx-auto items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 backdrop-blur px-3 py-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> GitVision · v0.2
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
            See any repo as a{" "}
            <span className="bg-gradient-to-r from-emerald-500 via-sky-500 to-violet-500 bg-clip-text text-transparent">
              constellation
            </span>
            .
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 max-w-xl mx-auto">
            Paste a GitHub URL. Get an interactive canvas of files, contributors, and hotspots — saved and updatable any time.
          </p>
        </header>

        <RepoInputForm />

        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Your sessions
            </h2>
            <span className="text-xs text-zinc-500">
              {sessions.length} saved
            </span>
          </div>
          {sessions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">
              No sessions yet. Paste a URL above to start.
            </div>
          ) : (
            <ul className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link href={`/session/${s.id}`} className="block">
                    <SessionCard session={s} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="text-center text-xs text-zinc-500 mt-8">
          Tip: set <code className="px-1 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-800 font-mono">GITHUB_TOKEN</code> in{" "}
          <code className="px-1 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-800 font-mono">.env.local</code> for a 5000 req/hr quota.
        </footer>
      </div>
    </main>
  );
}
