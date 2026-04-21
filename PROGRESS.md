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

## Current state (v0.2, as of session 1)

### What works end-to-end

- Paste a public GitHub URL → session created with full initial snapshot
- Sessions saved as JSON files on disk, listed on landing page
- Session page: stat grid, tabs (Canvas / Overview)
- **Canvas (hero view):**
  - Folder frames with labels (`● foldername · N files`)
  - File cards sized uniformly (150px), color-coded by file extension
  - Shelf-packed layout: guaranteed zero overlap
  - Ambiguous basenames like `package.json` are shown as `parent/basename` for monorepo disambiguation
  - Click a card → side panel with authors, co-change partners, recent commits
  - Min-churn slider (debounced via `useDeferredValue`)
  - All edges / minimap toggles (off by default for perf)
  - Drag, zoom, pan — the full React Flow interaction set
- **Overview tab:** hotspot treemap, contributor list, language mix, bus factor per folder, weekly commit activity
- **Screenshot:** PNG export of the whole session page via `html-to-image`
- **Refresh:** append snapshot, show "Since your last visit" diff (stars/forks/issues delta, new commits, new contributors, new & rising hotspots)
- **Session CRUD:** rename (click title), delete, multiple sessions
- **Rate-limit aware:** shows remaining in footer; works unauthenticated (60/hr) or with `GITHUB_TOKEN` (5000/hr)

### Data we fetch & compute

Per snapshot:

| Source | What |
|---|---|
| GitHub API | Repo metadata, top 100 contributors, language bytes, recent 300 commits |
| Per-commit `getCommit` (last 80) | Files changed, author |
| Derived | Hotspots (`churn × log(authors+1)`), co-change edges (file pairs co-touched ≥ 2 times), weekly commit buckets |

Capped at top 120 hotspots, top 150 co-change edges to keep snapshot JSON reasonable.

### Key design decisions we made

1. **File storage over database.** SQLite/Prisma was overkill for single-user. `.gitvision/sessions/<id>.json` is inspectable, gitignored, and portable. Migration path open if we need it.
2. **React Flow for canvas.** Gives us drag/zoom/pan/minimap for free. Custom node types (`file`, `folder`) handle our styling.
3. **Shelf packing instead of treemap/circle-pack for layout.** Treemap gave uneven regions that caused overlap with mixed folder sizes. Shelf packing computes exact card-grid dimensions per folder, packs blocks row-by-row, guarantees no overlap.
4. **Folder frames as React Flow nodes** (not overlays) — they live in the same coordinate space as cards, pan/zoom together naturally, render behind via `zIndex: -1`.
5. **No blur filters on cards.** Initially we used `blur-md` glows — killed perf at 120 nodes. Removed, replaced with sharp outlines.
6. **`useDeferredValue` for slider.** Force-sim re-computations don't block input anymore.
7. **Defensive fallbacks for old snapshots.** As the data schema evolves (we added `coChange`, `authorLogins`, `commits` fields), old sessions gracefully handle missing fields.
8. **Ambiguous basename disambiguation.** Files like `package.json`, `README.md`, `index.ts` are shown with their parent folder prefixed (`next/package.json`) because they're indistinguishable otherwise — especially on monorepos.

### Known trade-offs and limits

- **Only last 80 commits analyzed for hotspots.** Good for "recent activity" signal, bad for lifetime churn. Upgrade path: when we port to Tauri we can clone the repo locally and run real `git log --numstat` on full history.
- **Contributors list capped at 100** by GitHub API's contributors endpoint.
- **No PR / issue data yet.** All commit-focused. PR cycle-time sankey is a future enhancement.
- **Screenshot captures full page** — not purpose-built share cards.
- **No auto-fit on canvas mount** — user has to click the fit button. Minor UX gap.
- **Monorepo hotspots dominated by version-bump files.** When a release touches 50 `package.json`s, they become the hottest hotspots. Correct signal, but not the most interesting. Future option: filter out common metadata files.
- **No search.** Can't find a specific file in a big canvas. High-impact quick win.

---

## Tech stack reminders

- **Next.js 16 (App Router, Turbopack).** Note: this is a **new** major version with breaking changes from earlier Next.js. Check `node_modules/next/dist/docs/01-app/` before assuming old patterns work.
- **React 19** + TypeScript 5.
- **Tailwind CSS v4** — arbitrary values (`bg-[#...]`) sometimes behave oddly when imported from `"use client"` components. For canvas components we use inline `style={}` for dimensions and critical colors to be safe.
- **@xyflow/react (React Flow 12).** CSS is imported in `app/globals.css` (NOT inside components — that caused silent render failures earlier).
- **D3 v7** — used for treemap, force math in prototype, color scales, hierarchy helpers. We chose shelf-packing over d3 layouts after testing.

---

## The next-steps menu

Ranked "bang per buck" — user to pick priority next session.

### Quick wins (high impact, low effort)

1. **Search / highlight on canvas** — typable filter that highlights matching file cards. Makes big repos navigable.
2. **Auto-fit on canvas mount** — use `useReactFlow().fitView()` in a `useEffect`. Removes the "click fit every time" friction.
3. **Loading state during analysis** — currently it's a blank 30s wait on large repos. Show progress (commits fetched N/M, computing hotspots, etc.).
4. **Rate-limit friendly errors** — proper UI when we hit the ceiling.
5. **Empty states** — when a repo has no data or the session is fresh.

### Medium effort, big differentiator

6. **Dedicated share-card layouts** — stop capturing the whole page. Create purpose-built 1200×630 and 1080×1080 layouts with branded GitVision styling. Think Spotify Wrapped.
7. **Contributor overlay** — toggle to color cards by *dominant author* instead of file type. Visual territory map. Super strong for team leads.
8. **Multi-level folder drill-down** — click a folder block → zoom into subfolders. Useful for monorepos.
9. **Filter hotspots by type** — "hide metadata files" toggle to see real code activity on monorepos.
10. **Landing-page polish** — hero illustration, nicer session tiles, maybe a "try with…" public-repo demo row.

### Big swings

11. **Time-scrubber** — slider below canvas to animate how hotspots shift over time (week by week). One of the coolest features we pitched. Needs us to keep per-week hotspot snapshots or compute from commit data on the fly.
12. **PR data + cycle-time sankey** — fetch PRs, visualize the flow from opened → review → merge. High value, ~1 day of work.
13. **Per-contributor "Wrapped"-style cards** — personalized achievement cards ("Top committer Monday mornings", "Pet file: auth.ts", etc.) — shareable moments.
14. **Tauri desktop app** — see dedicated section below.

---

## Tauri port — the plan

### Why we deferred

Wrapping a choppy webapp in Tauri doesn't make it smooth — both Tauri and Electron use a webview to render. We prioritized fixing perf/polish on localhost first (correct call in hindsight, the canvas feels smooth now).

### When to pull the trigger

Any of:
- Want a downloadable `.app` / `.exe` to share
- Need **local git analysis** (clone repo, run `git blame`, `git log --numstat`) for full-history bus-factor and churn
- Core features are done and iteration is now polish-only

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

*Last updated: end of session 1 (v0.2 canvas redesign, monorepo disambiguation, shelf-packed layout).*
