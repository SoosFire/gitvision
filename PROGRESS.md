# GitVision — Progress & Design Notes

> Living document — update as the project evolves. Picks up where the first collab session ended.

---

## The pitch, in one sentence

A desktop-grade repo visualizer that feels like a Figma canvas — paste a GitHub URL, get an explorable map of files, contributors, and hotspots you can save, update, and screenshot to share.

## Guiding principles (do not compromise on these)

1. **Tell a story, don't just show numbers.** GitHub Insights is boring because it's dry. Every view should give an "aha" moment.
2. **Every view must be screenshot-worthy alone.** If a chart can't stand on its own as a shareable image, it either gets improved or cut.
3. **Exploit the "update" angle.** Refresh isn't just a data-refetch — it's *"what changed since last you looked"*. That's gold for teams and solo devs alike.
4. **Polish on localhost first, port to Tauri later.** Web iteration is 10× faster. Port when the product is ~90% of what we want.

---

## Current state (v0.5, as of session 2)

### What works end-to-end

- Paste a public GitHub URL → session created with full initial snapshot
- Sessions saved as JSON files on disk, listed on landing page
- Session page: stat grid, tabs (**Canvas / Dependencies / PRs / Overview**)
- Loading UI during analysis: 5-stage progress with gradient bar, not a blank 30s wait
- **Canvas (hero view):**
  - Folder frames with labels (`● foldername · N files`)
  - File cards sized uniformly (150px), color-coded by file extension
  - Shelf-packed layout: guaranteed zero overlap
  - Ambiguous basenames like `package.json` are shown as `parent/basename` for monorepo disambiguation
  - Click a card → side panel with authors, co-change partners, recent commits
  - `filter path…` search input (debounced, auto-refit)
  - Min-churn slider (debounced via `useDeferredValue`)
  - **Color by type / by author** — contributor overlay with up to 10 distinct palette colors + legend
  - **Time-scrubber** (week / day / commit granularity) — animates how hotspots evolved, auto-play button. Spans the FULL reachable history (v0.4)
  - All edges / minimap toggles (off by default for perf)
  - Auto-fit on mount + after any filter change
  - Drag, zoom, pan — the full React Flow interaction set
- **Dependencies tab** (v0.3): file-to-file import graph with brick-staggered layer layout
  - Languages supported: **JS/TS/JSX/TSX/MJS/CJS, Java, Kotlin, C#, PHP, Ruby, Python, Go** + HTML/CSS as render targets
  - Edge kinds: `import`, `renders` (Spring MVC controller → template), `extends`, `implements`
  - Toggleable per kind
  - Path-search filter + "hide isolated" toggle (on by default for >100 files)
  - Minimap on by default for big repos
  - Click a file → isolate its 1-hop neighborhood
- **PRs tab** (v0.3): sankey of cycle-time flow (Opened → Merged / Closed / Still-open → time-to-merge bucket). Powered by d3-sankey. Median-time-to-merge + merged-% stats
- **Overview tab:** hotspot treemap, contributor list, language mix, bus factor per folder, weekly commit activity
- **Share cards** (v0.3): branded 1200×630 (landscape) and 1080×1080 (square) layouts with gradient background, stats, hotspots + bars, commit-activity sparkline, contributor avatars, language bar. Preview modal with Download PNG
- **Contributor Wrapped** (v0.3): Spotify-Wrapped-style portrait cards (500×720) per top contributor with per-hue variation, pet-file / favorite-day / peak-hour / debut, individual PNG download
- **AI summary** (v0.5): optional Claude-generated repo profile panel on each session. Lazy — stored on the snapshot after first generation. Requires `ANTHROPIC_API_KEY`. Panel gracefully hides the feature when the key is missing
- **Screenshot:** still available — PNG export of whole session page
- **Refresh:** append snapshot, show "Since your last visit" diff
- **Session CRUD:** rename, delete, multiple sessions
- **Rate-limit aware:** shows remaining in footer

### Data we fetch & compute

Per snapshot:

| Source | What |
|---|---|
| GitHub REST API | Repo metadata, top 100 contributors, language bytes, recent 300 commits, last ~200 PRs |
| Server-side `git clone --bare --filter=blob:none` + `git log --raw --no-renames` (v0.4) | Full reachable history — up to 10 000 commits, 120 000 file-change rows. Bounded by clone-time (90s) and log-parse (60s) |
| Tarball `/repos/:owner/:repo/tarball` via Octokit + `tar` extraction | Current source for dep-graph parsing (regex-based per language) |
| Derived | Hotspots (`churn × log(authors+1)`), co-change edges (file pairs co-touched ≥ 2 times, mega-commits skipped), weekly commit buckets, FileGraph nodes+edges with BFS layers |

Caps: top 120 hotspots, top 150 co-change edges, `fileGraph` at ≤3 000 files (skips `node_modules`, `dist`, `target`, etc.), PR fetch at 2 pages.

If `git` isn't available on PATH or the clone fails, `analyzeRepo` falls back to the old REST-only path (80-commit sample) — `historySource.kind` tells the UI which one ran.

### Key design decisions we made

1. **File storage over database.** SQLite/Prisma was overkill for single-user. `.gitvision/sessions/<id>.json` is inspectable, gitignored, and portable.
2. **React Flow for every canvas.** Drag/zoom/pan/minimap for free. Custom node types for `file`, `folder`.
3. **Shelf packing for Canvas**, **brick-stagger layered layout for Dep Canvas.** Both avoid the "wall of nodes" feel at scale.
4. **Folder frames as React Flow nodes** (not overlays) — same coord space as cards, `zIndex: -1`.
5. **No blur filters on cards** — killed perf at 120 nodes. Sharp outlines only.
6. **`useDeferredValue` for sliders and filter inputs.**
7. **Defensive fallbacks for old snapshots.** Every new field is optional (`fileGraph?`, `pullRequests?`, `commitIndex?`, `historySource?`) so pre-v0.3 sessions still render.
8. **Ambiguous basename disambiguation.** `next/package.json` rendering.
9. **Server-side `git log --raw` (not `--numstat`).** `--numstat` forces git to auto-fetch blobs to compute line-counts — fails or hangs on a blobless clone. `--raw` derives paths from tree diffs, no blobs needed, ~1–2s per year of history.
10. **Dep Canvas filters over aggregation.** We removed folder/subfolder grouping modes — user validated that hiding orphans + a path filter is the right scale strategy. Don't reintroduce aggregation without signal.
11. **Client-side layout recompute.** `DependencyCanvas` recalculates positions every render from `graph.nodes` + `graph.edges` — layout algorithm changes apply to old snapshots without needing a refresh.

### Known trade-offs and limits

- **Dep-graph is always HEAD-time.** Imports come from parsing the latest tarball; we don't time-travel the parser, so a Canvas time-scrubber would be approximate. Decided to skip until we have a reason.
- **Contributors list capped at 100** by GitHub API.
- **PR review stages not tracked** — sankey is Opened → Outcome → duration. Adding reviewer/approval stages needs extra REST calls per PR.
- **Linux-kernel-sized repos won't fit** — 10 000 commit / 120 000 file-change caps protect the server; anything bigger truncates with `historySource.truncated` set.
- **Monorepo hotspots still dominated by version-bump files** (CHANGELOG.md, package.json). Filter-by-path workaround exists; a smart "hide metadata files" toggle is still a TODO.
- **Regex-based parsers are ~90–95% accurate, not 100%.** Edge cases (dynamic `require()`, Python `importlib`, C# `using static` of a whole namespace) get approximated. Good enough for viz; AST-based parser swap is available as an upgrade path.
- **React Flow warning in console** about fresh `nodeTypes` object refs — harmless but noisy. Should memoize outside the component in a cleanup pass.

---

## Tech stack reminders

- **Next.js 16 (App Router, Turbopack).** Breaking changes from earlier major versions — check `node_modules/next/dist/docs/01-app/` before assuming old patterns work.
- **React 19** + TypeScript 5.
- **Tailwind CSS v4** — arbitrary values (`bg-[#...]`) sometimes behave oddly when imported from `"use client"` components. Canvas components use inline `style={}` for dimensions and critical colors.
- **@xyflow/react (React Flow 12).** CSS imported in `app/globals.css` (NOT inside components — caused silent render failures).
- **D3 v7** — treemap, color scales, hierarchy. `d3-sankey` added in v0.3 for PR flow.
- **`tar` npm package** (v0.3) — for tarball extraction in `lib/graph.ts`.
- **Server-side `git` binary** (v0.4) — required on PATH. Falls back to REST sample if missing.
- **`@anthropic-ai/sdk`** (v0.5) — powers the AI summary. Uses `claude-opus-4-7` with adaptive thinking. Optional — only loaded when the user clicks Generate.

---

## The next-steps menu

Ranked "bang per buck" — user to pick priority next session. ✅ = shipped.

### Shipped in session 2 (v0.3 + v0.4)

- ✅ Search / highlight on canvas
- ✅ Auto-fit on canvas mount + after filter change
- ✅ Loading state during analysis (5-stage progress bar)
- ✅ Dedicated share-card layouts (1200×630, 1080×1080)
- ✅ Contributor overlay (color by author + legend)
- ✅ Time-scrubber (week / day / commit granularity, auto-play)
- ✅ PR data + cycle-time sankey (Opened → Outcome → duration)
- ✅ **Dependency Canvas** (was not on the original list — emerged mid-session). Multi-language file-to-file import graph with brick-stagger layers, edge-kind toggles, search+filter.
- ✅ **Full-history analysis via server-side git clone** (v0.4). Was planned as a post-Tauri feature; turned out to work fine in Node with `git log --raw`.
- ✅ **Hide metadata files toggle** on Canvas (v0.5). Filters out `CHANGELOG.md`, lockfiles, `.prettierrc`, `.github/`, etc. so monorepo hotspots show real code activity.
- ✅ **Claude-generated repo summary** (v0.5). Opt-in, lazy, cached on the snapshot.

### Quick wins still on the table

1. **Rate-limit friendly errors** — proper UI when we hit the ceiling.
2. **Empty states** — when a repo has no data or the session is fresh.
3. **Memoize `nodeTypes` objects** — silence the React Flow console warning, trivial perf win.
4. **"Hide metadata files" toggle** — filter out `CHANGELOG.md`, `package.json` etc. so monorepo hotspots show real code activity.
5. **Refresh-session auto-upgrade old snapshots** — right now old sessions have no `fileGraph` / `pullRequests` / `commitIndex`; the UI tells them to refresh. Could do it silently on first view.

### Medium effort, big differentiator

6. **Landing-page polish** — hero illustration, nicer session tiles, "try with…" public-repo demo row.
7. **Per-contributor "Wrapped"-style cards** — personalized achievement cards ("Top committer Monday mornings", "Pet file: auth.ts") — shareable moments.
8. **AST-based parsers** for JS/TS and Java — swap regex for `@babel/parser` / `java-parser` so dynamic `require()` and `using static` edge cases resolve correctly.
9. **PR review-stage tracking** — expand PR sankey with "opened → first review → approved → merged" stages. Needs extra REST calls per PR.

### Big swings

10. **Tauri desktop app** — see section below. With v0.4 git-log already done server-side, the Tauri port is mostly about packaging + replacing `lib/storage.ts` fs calls.
11. **Multi-user + real DB** — only if we go public. File-storage fine while it's localhost.

---

## Tauri port — the plan

### Why we deferred

Wrapping a choppy webapp in Tauri doesn't make it smooth — both Tauri and Electron use a webview to render. We prioritized fixing perf/polish on localhost first (correct call in hindsight, the canvas feels smooth now).

### When to pull the trigger

Any of:
- Want a downloadable `.app` / `.exe` to share
- Want to eliminate the server-side git-clone step (goes from "clone on backend per analyze" to "analyze the user's local repo in place")
- Core features are done and iteration is now polish-only

Note: **full-history analysis is no longer a Tauri-only feature** — v0.4 ships it in the Node server. Tauri is now purely about packaging, offline use, and operating on local repos.

### The migration work (estimate: 2–3 hours on a quiet afternoon)

1. Install Tauri CLI, `npm create tauri-app` inside the existing project
2. Switch from Next.js SSR → static export (`output: "export"` in `next.config.ts`)
3. Rewrite `app/api/*` Route Handlers:
   - Either as **Tauri commands** in Rust (fastest, smallest, most work)
   - Or as **direct client calls to GitHub API** (simplest, slightly slower, no Rust)
4. Replace `lib/storage.ts` fs calls with Tauri's `@tauri-apps/api/fs`
5. Test on Mac
6. Build for Windows: `npm run tauri build -- --target x86_64-pc-windows-msvc`

Bonus unlocks when we're native:
- `git2-rs` / spawn `git` — real blame, real history
- Native notifications for "Since last visit" changes
- Filesystem drag-and-drop for local repos
- OS-level keyboard shortcuts

---

## Running locally again on a fresh machine

```bash
git clone https://github.com/SoosFire/gitvision
cd gitvision
npm install
cp .env.example .env.local
# paste your GitHub token into .env.local
npm run dev
```

**Node version required:** 20.9+ (we're on 25.9 locally, both work fine).

Sessions are stored in `.gitvision/sessions/` — **not committed**, machine-local. Create new ones via the landing page.

---

## Security / credentials note

- `.env.local` is gitignored. Your `GITHUB_TOKEN` stays local.
- **Always use a token with minimum scope** — read-only `public_repo` is enough for now.
- If you ever paste your token into chat / a shared screen / a Discord, **rotate it immediately** at https://github.com/settings/tokens.

---

## Open questions / things to discuss

- Do we want the app to be **multi-user eventually**? Currently file-storage + filesystem is single-user. Post-Tauri we'd stay solo-first.
- **Hosting strategy** if we ever deploy the web version — Vercel works, but sessions would need to move to a real DB.
- **Brand direction** — GitVision name is fine; do we want a distinctive wordmark / icon?
- **Public release** — GitHub + npm package? Self-hosted only? Commercial?

---

*Last updated: end of session 2 (v0.3 Dependency Canvas + multi-language parsers + PR sankey + share cards + contributor overlay; v0.4 full-history via server-side `git log --raw`; v0.5 Contributor Wrapped cards + hide-metadata toggle + AI summary via Claude).*
