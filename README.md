# GitVision

> A beautiful, explorable dashboard for any GitHub repository.

Paste a GitHub URL. Get an interactive canvas of files, contributors, and hotspots — saved and updatable any time. Think Figma-canvas meets GitHub Insights.

![GitVision v0.2](https://img.shields.io/badge/version-0.2-emerald) ![Next.js 16](https://img.shields.io/badge/next.js-16-black) ![React 19](https://img.shields.io/badge/react-19-blue) ![Turbopack](https://img.shields.io/badge/turbopack-on-orange)

## Quick start

```bash
# 1. Install
npm install

# 2. Optional but recommended: add a GitHub token for 5000 req/hr
cp .env.example .env.local
# then edit .env.local and paste your token after GITHUB_TOKEN=

# 3. Run
npm run dev
```

Open http://localhost:3000.

To generate a token: https://github.com/settings/tokens/new — tick **`public_repo`** scope only.

## What it does

Paste any public GitHub repo URL on the landing page. GitVision fetches:

- Repo metadata (stars, forks, issues, language, topics)
- Top 100 contributors
- Language bytes breakdown
- Recent 300 commits (3 pages × 100)
- File-level change data from the last 80 commits
- Rate-limit snapshot

It computes:

- **Hotspots** — files scored by `churn × log(authors+1)`
- **Co-change edges** — file pairs that frequently change together in the same commit
- **Weekly commit activity** — from sampled commits

You get a **Canvas view** (hero) with folder frames and file cards, and an **Overview** tab with treemap, contributors, language mix, and bus-factor approximation.

Sessions are saved to `.gitvision/sessions/<id>.json` — you can reopen, refresh (with "Since your last visit" diff), rename, or delete.

## Architecture

```
app/
├─ page.tsx                        Landing: URL input + saved sessions
├─ session/[id]/page.tsx           Dashboard for one repo
└─ api/
   ├─ sessions/route.ts            POST (create), GET (list)
   ├─ sessions/[id]/route.ts       GET, PATCH (rename), DELETE
   └─ sessions/[id]/refresh/route  POST — re-analyze and append snapshot

components/
├─ RepoInputForm.tsx               URL input + submit
├─ SessionCard.tsx                 Tile on landing
├─ SessionToolbar.tsx              Rename, refresh, screenshot, delete
├─ SessionTabs.tsx                 Canvas / Overview switcher
└─ views/
   ├─ Constellation.tsx            Hero: React Flow canvas with folder frames
   ├─ FileDetailsPanel.tsx         Right panel when a file is clicked
   ├─ HotspotTreemap.tsx           D3 squarified treemap
   ├─ ContributorList.tsx          Top contributors with bars
   ├─ LanguageBar.tsx              Stacked bar
   ├─ BusFactorPanel.tsx           Folder-level knowledge concentration
   ├─ CommitActivity.tsx           Weekly bar chart
   ├─ SinceLastVisit.tsx           Diff panel after a refresh
   └─ StatGrid.tsx                 Top stat cards

lib/
├─ types.ts                        Shared interfaces
├─ github.ts                       Octokit wrapper + hotspot/co-change compute
├─ storage.ts                      File-based session persistence
└─ diff.ts                         Snapshot diff for "Since last visit"
```

## Tech stack

- **Next.js 16** (App Router, Turbopack)
- **React 19** + TypeScript
- **Tailwind CSS v4** via `@tailwindcss/postcss`
- **@xyflow/react** (React Flow 12) for the interactive canvas
- **D3** for treemap, force math, color scales, hierarchy helpers
- **Octokit** for GitHub API
- **html-to-image** for screenshot export
- **nanoid** for session IDs
- **zod** for input validation

Storage is filesystem-based (`.gitvision/sessions/<id>.json`) — simple, portable, inspectable. No database to set up.

## Cross-platform

The project runs identically on macOS and Windows. Uses cross-platform npm scripts, `.gitattributes` enforces LF line endings to avoid CRLF drift.

## See [PROGRESS.md](./PROGRESS.md)

Full recap of what's been built, design decisions, known trade-offs, and the next-steps idea list.
