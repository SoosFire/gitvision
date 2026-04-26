# GitVision — Progress & Design Notes

> Living document — update as the project evolves. Picks up where the first collab session ended.

---

## The pitch, in one sentence

A desktop-grade repo visualizer that feels like a Figma canvas — paste a GitHub URL, get an explorable map of files, contributors, hotspots, and package-dependency health you can save, update, and screenshot to share.

## Guiding principles (do not compromise on these)

1. **Tell a story, don't just show numbers.** GitHub Insights is boring because it's dry. Every view should give an "aha" moment.
2. **Every view must be screenshot-worthy alone.** If a chart can't stand on its own as a shareable image, it either gets improved or cut.
3. **Exploit the "update" angle.** Refresh isn't just a data-refetch — it's *"what changed since last you looked"*. That's gold for teams and solo devs alike.
4. **Polish on localhost first, port to Tauri later.** Web iteration is 10× faster. Port when the product is ~90% of what we want.
5. **Language-agnostic by architecture.** Anywhere we add language support (imports, dep-health, AST), it's through plugins. Adding a new language should never require touching signals, types, UI, or storage.

---

## Current state (v0.16, end of session 4)

### What works end-to-end

- Paste a public GitHub URL → session created with full initial snapshot
- Sessions saved as JSON files on disk, listed on landing page
- Session page tabs: **Canvas / Imports / Code / Packages / PRs / Overview**
- Loading UI during analysis: 5-stage progress with gradient bar, not a blank 30s wait
- **Canvas (hero view):**
  - Folder frames with labels (`● foldername · N files`)
  - File cards sized uniformly (150px), color-coded by file extension
  - Shelf-packed layout: guaranteed zero overlap
  - Ambiguous basenames like `package.json` shown as `parent/basename` (monorepo disambiguation)
  - Click a card → side panel with authors, co-change partners, recent commits
  - `filter path…` search input (debounced, auto-refit)
  - Min-churn slider (debounced via `useDeferredValue`)
  - **Color by type / by author** — contributor overlay with up to 10 distinct palette colors + legend
  - **Time-scrubber** (week / day / commit granularity) — spans FULL reachable history (v0.4)
  - All edges / minimap toggles (off by default for perf)
  - Auto-fit on mount + after any filter change
  - Drag, zoom, pan — full React Flow interaction set
- **Imports tab** (v0.3, renamed from "Dependencies" in v0.9): file-to-file import graph with brick-staggered layer layout
  - Languages: **JS/TS/JSX/TSX/MJS/CJS, Java, Kotlin, C#, PHP, Ruby, Python, Go** + HTML/CSS as render targets
  - Edge kinds: `import`, `renders` (Spring MVC controller → template), `extends`, `implements`
  - Toggleable per kind, path-search filter, "hide isolated" toggle, click to isolate 1-hop neighborhood
  - Backed by `lib/graph.ts` regex pipeline; in v0.10 this also drives `codeAnalysis`'s regex-fallback plugin for the 7 non-JS languages so a single tarball-extract feeds both panels
- **Packages tab (v0.9):** multi-ecosystem dependency health — see "Dependency-health pipeline" below
- **PRs tab** (v0.3): sankey of cycle-time flow (Opened → Merged / Closed / Still-open → time-to-merge bucket). Powered by d3-sankey. Median-time-to-merge + merged-% stats.
- **Overview tab:** hotspot treemap (muted teal→emerald→amber→rose palette, label truncation with ellipsis), contributor list, language mix, bus factor per folder, weekly commit activity.
- **Share cards** (v0.3): branded 1200×630 (landscape) and 1080×1080 (square) layouts.
- **Contributor Wrapped** (v0.3): Spotify-style portrait cards per top contributor.
- **AI summary** (v0.5, tuned in v0.8): Claude Sonnet 4.5 profile per snapshot. 150-200 word prose with hard rules + few-shot example prompt. Stored on snapshot — regeneration is explicit. Requires `ANTHROPIC_API_KEY` (panel gracefully hides the feature when missing).
- **Health Check (v0.6):** three-column verdict (What works / Where to dig deeper / Open questions) via hybrid rule-based signals + Claude narrative. **17 deterministic signal detectors** as of v0.9 (see "Signal catalog" below).
- **Screenshot:** PNG export of whole session page via `html-to-image`.
- **Refresh:** append snapshot, show "Since your last visit" diff banner with emerald gradient.
- **Session CRUD:** rename, delete, multiple sessions. Session actions grouped: Share dropdown (Wrapped / Share card / Screenshot), primary Refresh, overflow menu for Delete.
- **Rate-limit aware:** shows remaining in footer.
- **Code tab (v0.11):** AST-based blast-radius UI on top of the codeAnalysis pipeline. Picks the heaviest file by default, shows incoming + outgoing dependency hops (3 deep, capped at 200 files per direction), the file's top-6 functions in the header, plus side-by-side "heaviest files" and "most complex functions" lists for quick navigation. Coverage chip is honest: full call-graph + complexity for JS/TS, imports only for the 7 fallback languages. New snapshots get `codeGraph` populated automatically; old snapshots show an empty state pointing to the Refresh button.
- **Code-analysis pipeline (v0.10 foundation):** AST-based parser for JS/TS via tree-sitter (WASM), regex-fallback for the other 7 languages, unified `CodeGraph` aggregate persisted on every fresh snapshot since Phase 4a. Also exposed standalone via `/api/debug/code-analysis` for live testing and `npm run analyze <path>` for local inspection. See "Code-analysis pipeline" below.

### Dependency-health pipeline (v0.9 architecture)

Plugin-based architecture designed so adding a new ecosystem is one file:

```
lib/depsHealth/
├── index.ts              Orchestrator — runs every plugin whose
│                         manifests are present. One DependencyHealth
│                         per ecosystem, aggregated at signal/UI level.
├── types.ts              EcosystemPlugin contract + shared types.
├── tree.ts               GitHub Trees API fetch (recursive=true,
│                         universal skip-patterns).
├── osv.ts                OSV.dev batch query (ecosystem-agnostic).
├── pool.ts               Concurrency-limited map helper.
└── ecosystems/
    ├── npm.ts            registry.npmjs.org     → OSV "npm"
    ├── cargo.ts          crates.io              → OSV "crates.io"
    └── pypi.ts           pypi.org               → OSV "PyPI"
```

Per-ecosystem the pipeline is: fetch manifests → parse → dedupe (name,version)
→ registry meta → OSV batch → categorize into outdated / vulnerable / deprecated
with `sources[]` tracking which manifest files declared each dep.

**Outputs per snapshot:**

| Field | Shape |
|---|---|
| `dependencyHealths` | `DependencyHealth[]` (one per detected ecosystem) |
| *each entry* | `{ ecosystem, total, uniquePackages, packageFiles, outdated, vulnerable, deprecated, note? }` |

Backward-compat: pre-v0.9 snapshots stored singular `dependencyHealth`.
Read-side helper `getDependencyHealths()` normalizes both shapes.

### Code-analysis pipeline (v0.10 architecture)

Plugin-based, designed so adding a new language (or migrating one off regex
to AST) is a single file. Same mindset as `lib/depsHealth/`.

```
lib/codeAnalysis/
├── analyze.ts              Orchestrator — walks a directory, runs every
│                           plugin whose extensions are present, aggregates
│                           results into a CodeGraph.
├── codeGraph.ts            Cross-file aggregator: function index, call
│                           resolution + disambiguation, import dedup,
│                           per-plugin stats roll-up.
├── parse.ts                Per-file dispatcher — tree-sitter pipeline OR
│                           plugin-supplied parseDirect (regex / non-AST).
├── runtime.ts              web-tree-sitter WASM bootstrap + grammar cache.
├── tsconfig.ts             tsconfig/jsconfig loader for path mappings.
├── workspaces.ts           pnpm/yarn/npm workspace package discovery.
├── types.ts                Plugin contract + CodeGraph types.
├── cli.ts                  Dev CLI: `npm run analyze <path>`.
└── plugins/
    ├── javascript.ts       Tree-sitter (JS/TS/TSX/MJS/CJS/MTS/CTS) — full
    │                       imports + functions + calls + complexity.
    ├── python.ts           Tree-sitter (.py) — same coverage. Migrated
    │                       from regex-fallback in v0.12.
    ├── go.ts               Tree-sitter (.go) — same coverage as
    │                       javascript.ts PLUS type-aware call resolution
    │                       since v0.16. parseDirect with two-pass walk:
    │                       pass 1 collects struct field types; pass 2
    │                       walks methods tracking receiver types,
    │                       parameter types, and `var x Type` declarations.
    │                       prepareForRepo still reads go.mod for module-
    │                       prefix-aware import resolution.
    ├── java.ts             Tree-sitter (.java) — same coverage as
    │                       javascript.ts PLUS type-aware call resolution
    │                       since v0.15. Uses parseDirect with manual AST
    │                       walk to track field types, parameter types,
    │                       and local variable types in scope; resolves
    │                       receiver types on every method_invocation.
    │                       Methods get containerType (their owning class).
    └── regexFallback.ts    Wraps lib/graph.ts's per-language regex parsers
                            (Kotlin, C#, PHP, Ruby + HTML/CSS as passive).
                            Imports-only — no functions/calls/complexity
                            from regex.
```

**Two execution paths in the plugin contract:**
- Tree-sitter plugins implement `languageFor(ext)` + `queriesFor(ext)`. The
  orchestrator compiles S-expression queries and walks captures by canonical
  names (`spec`, `name`, `callee`, `body`, `params`).
- Direct plugins implement `parseDirect(file, ix)`. Used when AST parsing
  doesn't apply (the regex-fallback plugin) or as an escape hatch.

**Coverage matrix (live-tested against real repos):**

| Language family | Plugin | Imports | Functions | Calls | Complexity |
|---|---|---|---|---|---|
| JS / TS / JSX / TSX / MJS / CJS / MTS / CTS | `javascript` | ✅ AST | ✅ | ✅ | ✅ |
| Python (.py) | `python` (v0.12) | ✅ AST | ✅ | ✅ | ✅ |
| Go (.go) | `go` (v0.13) | ✅ AST | ✅ | ✅ | ✅ |
| Java (.java) | `java` (v0.14) | ✅ AST | ✅ | ✅ | ✅ |
| Kotlin, C#, PHP, Ruby | `regex-fallback` | ✅ regex | — | — | — |

**Resolver features (the JS/TS plugin):**
- TS-ESM convention: `./foo.js` spec → `./foo.ts` file (and the .jsx/.mjs/.cjs ↔ .tsx/.mts/.cts pairs).
- tsconfig path mappings (`@/*`, `~/*`, etc.) loaded per-repo.
- Workspace package resolution (`@scope/name` → `packages/name/src/index.ts`) for pnpm/yarn/npm monorepos.
- Empty / dot path resolution (`import "../.."` → `index.{ts,js,...}` at repo root).
- Vendored / minified file filter — skips `tests/assets/`, `vendor/`, `*.min.js`, and content with avg-line-length signatures of bundled output.

**Live validation matrix** (resolved-imports % is a meaningful proxy for resolver coverage):

| Repo | Stack | Files | Resolved imports |
|---|---|---|---|
| ai/nanoid | JS | 21 | 27.8% (mostly external) |
| colinhacks/zod | TS monorepo | 400 | 67.0% |
| vuejs/core | TS monorepo | 524 | 86.6% |
| vitejs/vite | TS monorepo | 1,434 | 47.0% |
| trpc/trpc | TS monorepo | 902 | 64.1% |
| tanstack/query | TS monorepo | 1,003 | 56.0% |
| vercel/swr | TS | 262 | 35.1% |
| preactjs/preact | JS | 237 | 38.8% |
| expressjs/express | JS (CJS) | 141 | 38.8% |
| microsoft/playwright | TS | 1,526 | 51.9% |
| spring-projects/spring-petclinic | Java | 60 | 100% |
| django/django | Python | 3,360 | 99.99% |
| golang/example | Go | 40 | 100% |

**Outputs per repo (the `CodeGraph` shape):**
- `functions: FunctionDef[]` — name + filePath + rows + complexity
- `calls: CallEdge[]` — fromFile, fromFunction, calleeName, toFile, toFunction
- `imports: ImportEdge[]` — from, to, kind (import / extends / implements / renders)
- `fileComplexity`, `filesByExt`, `byPlugin` — stats for UI/debug
- `truncated`, `generatedAt` — caps + freshness

**Where it's exposed:**
- **Code tab on every session page (v0.11)** — blast radius hero card + heaviest-files + most-complex-functions lists. Reads `snapshot.codeGraph` directly; the BFS runs client-side (`lib/codeAnalysis/blastRadius.ts`) so picking a different file recomputes instantly without a server round-trip.
- `GET /api/debug/code-analysis?repo=owner/name` — full pipeline against a public repo, JSON summary. Auto-deployed on Railway.
- `npm run analyze <local-path>` — same shape, runs against a local checkout.

**Migration story for the 7 fallback languages:** add a tree-sitter plugin file per language (one file each), shrink `regexFallbackPlugin.extensions`, eventually delete `lib/graph.ts` entirely when the last language migrates.

### Signal catalog (v0.9 — 17 detectors)

Every signal is a pure function over an `AnalysisSnapshot`. Unit-tested in `lib/__tests__/signals.test.ts`.

**Positive (working) signals**
- `healthy-pr-throughput` — merged ≥ open among human-authored PRs
- `fast-pr-cycle` — sub-3-day median time-to-merge (human-authored only)
- `broad-ownership` — ≥3 folders with 3+ recent contributors
- `very-active` — last commit within 7 days
- `consistent-cadence` — ≥60% of sampled weeks had activity
- `good-test-presence` — ≥60% of top-churn code files have discoverable tests
- `real-code-activity` — ≤20% of top hotspots are metadata
- `many-contributors` — 20+ contributors with healthy top-5 share
- `fresh-deps` — all ecosystems clean (no CVE, no deprecated, <20% six-month-stale)

**Concerning (needsWork) signals**
- `pr-backlog` — open > merged × 1.5 (human-authored, bot-filtered)
- `slow-pr-cycle` — ≥14-day median time-to-merge (human-authored)
- `bus-factor-risk` — single-owner folders (suppressed on solo projects to avoid double-dipping with `solo-project`)
- `untested-hotspots` — ≥50% of top-churn code files lack tests (gated: suppressed when repo has ≥30 test files globally, to avoid false positives when tests live in unconventional layouts)
- `cross-boundary-coupling` — file pairs across different top-level folders co-change ≥3 times (domain-aware: source→output folder pairs like `scripts→docs` are excluded)
- `vulnerable-deps` — any CVE across any ecosystem (HIGH severity)
- `outdated-deps` — 3+ packages ≥12 months behind
- `deprecated-deps` — any deprecated/yanked packages
- `stale` — last commit >90 days ago

**Questions**
- `solo-project` — only one contributor visible
- `metadata-dominance` — ≥60% of top hotspots are metadata files
- `missing-hygiene` — no LICENSE and/or no README (README check uses the definitive GitHub `/readme` endpoint since v0.6, not path heuristics)

### Data we fetch & compute

Per snapshot:

| Source | What |
|---|---|
| GitHub REST API | Repo metadata, top 100 contributors, language bytes, recent 300 commits, last ~200 PRs, `/readme` existence check |
| Server-side `git clone --bare --filter=blob:none` + `git log --raw --no-renames` (v0.4) | Full reachable history — up to 10 000 commits, 120 000 file-change rows |
| Tarball `/repos/:owner/:repo/tarball` via Octokit + `tar` extraction | Source for file-import graph parsing (regex-based per language) |
| GitHub Trees API (`recursive=true`) | Full file list for dep-health manifest discovery (v0.9) |
| Per-ecosystem registries (v0.9) | npm: registry.npmjs.org, Cargo: crates.io, PyPI: pypi.org |
| OSV.dev `/v1/querybatch` | CVE data per (package, version) across all ecosystems |
| Derived | Hotspots, co-change edges, commit activity, FileGraph, 17 deterministic health signals |

Caps: top 120 hotspots, top 150 co-change edges, `fileGraph` at ≤3 000 files, PR fetch 2 pages, dep-health 50 manifests × 300 unique packages per ecosystem.

Graceful fallback: if `git` isn't on PATH, REST-only path (80-commit sample). If no manifest for a given ecosystem, that plugin silently skips.

### Key design decisions we made

1. **File storage over database.** `.gitvision/sessions/<id>.json` is inspectable, gitignored, portable.
2. **React Flow for every canvas.** Drag/zoom/pan/minimap for free.
3. **Shelf packing for Canvas**, **brick-stagger layered layout for Dep Canvas.**
4. **Folder frames as React Flow nodes** (not overlays) — same coord space as cards.
5. **No blur filters on cards** — killed perf at 120 nodes.
6. **`useDeferredValue` for sliders and filter inputs.**
7. **Defensive fallbacks for old snapshots.** Every new field is optional; read-side helpers normalize legacy shapes.
8. **Ambiguous basename disambiguation** (`next/package.json` rendering).
9. **Server-side `git log --raw` (not `--numstat`).** No blob fetches needed on a blobless clone.
10. **Dep Canvas filters over aggregation.** User validated path-filter + hide-orphans is the right scale strategy.
11. **Client-side layout recompute.** Layout algorithm changes apply to old snapshots without a refresh.
12. **Plugin architecture for dep-health (v0.9).** Adding Cargo / PyPI / future Go-Maven-NuGet is one file. Signals, UI, storage never touched for a new language.
13. **Bot-author filtering** in PR throughput + cycle-time signals. Dependabot/Renovate/release-bot PRs distort human-review metrics; matched by a curated regex list.
14. **Forced dark theme** (v0.7). Removed system-preference conditional — fixes a whole class of "class doesn't apply" bugs and matches Linear's aesthetic. CSS vars + `color-scheme: dark`.
15. **lucide-react for all icons.** Consistent sizing (12-14px), tree-shaken, matches the Linear look. No emoji in UI chrome.
16. **Hybrid rule-based signals + Claude narrative.** Every AI claim is grounded in a computed signal. Zero hallucination room.

### Known trade-offs and limits

- **Dep-graph is always HEAD-time.** Imports parsed from latest tarball; no time-travel.
- **Contributors capped at 100** by GitHub API.
- **PR review stages not tracked** — sankey is Opened → Outcome → duration.
- **Linux-kernel-sized repos won't fit** — 10k commit / 120k file-change caps protect the server.
- **Monorepo hotspots still dominated by version-bump files.** Metadata-dominance signal flags it; the `hide-metadata` canvas toggle masks it in the visual.
- **JS/TS code analysis is AST-based (tree-sitter); the other 7 languages still go through regex.** Functions, call-graph and complexity are JS/TS-only as of v0.10 — regex-fallback contributes imports only. Migrating each of Java/Kotlin/C#/PHP/Ruby/Python/Go to tree-sitter is one plugin file each, no architectural work.
- **Dep-health ecosystem coverage:** npm / Cargo / PyPI only as of v0.9. Go / Maven / NuGet / etc. are plugin-additions (one file each) — not architectural work.
- **React Flow console warning** about fresh `nodeTypes` object refs — harmless but noisy.

### Testing

Vitest-based unit tests (added v0.8 as part of the "eat our own dog food" action; substantially expanded in v0.10 alongside Tier 2 foundation):

```
lib/__tests__/
├── github.test.ts          parseRepoUrl, computeHotspots, computeCoChange,
│                           computeCommitActivity (15 tests)
├── depsHealth.test.ts      npm normalizeVersion (8 tests)
├── cargo.test.ts           Cargo normalizer + parseManifest variants (17 tests)
├── pypi.test.ts            PyPI normalizer + requirements.txt + pyproject.toml
│                           (PEP 621 / Poetry / Flit dialects) (18 tests)
├── signals.test.ts         Detector behavior with mock snapshots (27 tests)
├── codeAnalysis.test.ts    Runtime, plugin contract, queries, parser
│                           extraction, JS/TS resolver across all the
│                           bug fixes, vendored/minified filter (44 tests)
├── tsconfig.test.ts        Tsconfig path-mapping reader: JSONC tolerance,
│                           wildcard substitution, baseUrl handling (12 tests)
├── workspaces.test.ts      Workspace package discovery: Yarn/npm forms,
│                           pnpm fallback, source-entry probing (9 tests)
├── codeGraph.test.ts       Cross-file aggregator: function index, call
│                           disambiguation, import dedup, byPlugin (10 tests)
└── regexFallback.test.ts   extractImportsFromSourceFiles + plugin wiring
                            for Java/Python/Go (9 tests)
```

**246 tests total, all passing.** Run with `npm test` (watch) or `npm run test:run` (CI). v0.16 added 10 new tests in `go.test.ts` covering containerType from method receivers (including pointer-stripping), calleeType inference from receiver / struct field access / parameter / `var` / `:=` composite-literal / `:=` pointer-to-composite forms, bare-call implicit-receiver behavior, graceful pass-through for un-inferable `:=` rhs, and multi-field disambiguation on a single struct.

Tests have caught real bugs at every stage: v0.8 found `lib/` incorrectly in `OUTPUT_LIKE_FOLDERS`; v0.10 caught query-syntax issues and the `../../` trailing-slash edge case before they shipped to production.

---

## Tech stack reminders

- **Next.js 16 (App Router).** Breaking changes from earlier majors — check `node_modules/next/dist/docs/01-app/` before assuming old patterns work.
  - Dev uses Turbopack (default in v16). **Production build uses webpack** (`next build --webpack`) — Turbopack chokes on Emscripten-style WASM packages like web-tree-sitter. See `next.config.ts` for `serverExternalPackages` + `outputFileTracingIncludes` config.
- **React 19** + TypeScript 5.
- **Tailwind CSS v4** — arbitrary values (`bg-[#...]`) sometimes behave oddly when imported from `"use client"` components. Canvas and dep-health UI use inline `style={}` with TOK tokens for reliability.
- **@xyflow/react (React Flow 12).** CSS imported in `app/globals.css` (NOT inside components — caused silent render failures).
- **D3 v7** — treemap, color scales, hierarchy. `d3-sankey` for PR flow.
- **`@iarna/toml`** — TOML parser used by Cargo + PyPI plugins.
- **`tar` npm package** — for tarball extraction in `lib/graph.ts`.
- **`web-tree-sitter` + `@vscode/tree-sitter-wasm`** (v0.10) — AST parsing for the `codeAnalysis` pipeline. WASM-only so it works identically on Mac, Linux/Railway, Windows, and a future Tauri build. Path resolution uses `process.cwd() + "node_modules/..."` to dodge bundler externalization quirks.
- **Server-side `git` binary** — required on PATH for full history; falls back to REST sample if missing.
- **`@anthropic-ai/sdk`** — Claude Sonnet 4.5 for AI summary + health narrative. Optional.
- **`lucide-react`** — icons.
- **`tsx`** — ESM-native TS runner for the dev CLI (`npm run analyze`).
- **`vitest`** — unit tests (dev dep).

---

## License

**PolyForm Noncommercial License 1.0.0** (changed from MIT in v0.9 to prevent commercial forks).

- Personal use, learning, hobby projects, research, nonprofits → free.
- Commercial/for-profit use → separate license required.

---

## Live deployment

Production deploy on Railway (single service + persistent volume at `/data`):
- URL set via Railway-generated subdomain
- `GITVISION_DATA_DIR=/data` env var for persistent session storage
- `GITHUB_TOKEN` + `ANTHROPIC_API_KEY` set as env vars in Railway UI
- Auto-deploys from `main` branch on every push

---

## The next-steps menu

Ranked "bang per buck". ✅ = shipped.

### Shipped
- ✅ Session 2 (v0.3-v0.5): Canvas hero, Dep-graph tab, PR sankey, share cards, contributor Wrapped, full-history git-log, AI summary
- ✅ v0.6 — Health Check (rule-based signals + Claude narrative, hybrid architecture)
- ✅ v0.7 — Linear-lighter UI rework (forced dark theme, TOK tokens, lucide icons, all components restyled)
- ✅ v0.8 — Dep-health v1 (npm only, monorepo-aware), LICENSE, vitest + 50 tests
- ✅ v0.9 — Plugin architecture + Cargo + PyPI + dedicated Packages panel (+ tab rename "Dependencies" → "Imports")
- ✅ v0.10 — Tier 2 foundation (Phases 1-3): tree-sitter for JS/TS via WASM, regex-fallback wrapper for the other 7 languages, unified `CodeGraph` aggregator, debug API + dev CLI for live testing.
- ✅ v0.11 — Tier 2 complete (Phases 4a-b): `codeGraph` lifted onto `AnalysisSnapshot` via shared tarball-extract with `FileGraph` (Phase 4a). Code tab with Blast Radius UI: heaviest-file default, incoming/outgoing hop lists, twin lists for navigation, honest coverage chip (Phase 4b).
- ✅ v0.12 — Python migrated to its own tree-sitter plugin. Live impact on django/django: 0 → **31,894 functions, 183,798 calls** with full per-function complexity. Top-complex surfaces real Django hotspots like `_alter_field @ 91` (schema migrations) and `__new__ @ 62` (model metaclass).
- ✅ v0.13 — Go migrated to its own tree-sitter plugin. `prepareForRepo` reads `go.mod` for module-prefix-aware import resolution, with a suffix-match heuristic as fallback. Live impact across four repos: gin (1,311 fns), cobra (589), testify (1,519), terraform (16,930). Top-complex surfaces gin's radix-tree router internals, cobra's shell completion, testify's `compare`, terraform's `backendFromConfig`.
- ✅ v0.14 — Java migrated to its own tree-sitter plugin. `prepareForRepo` regex-scans `package` declarations across the FileIndex to build FQN→path + package→members maps; resolver tries direct FQN then falls back to package lookup (which catches wildcard imports). Live impact: spring-petclinic (165 fns), spring-boot (30,116 fns at the 5,000-file cap), guava (56,485), jenkins (19,895). Captures method + constructor invocations + `new Foo<>()` object creation as call sites.
- ✅ v0.15 — **Phase 5a: type-aware call resolution for Java.** `ParsedFunction.containerType` + `ParsedCall.calleeType` (both optional) added to the plugin contract. The Java plugin switched to parseDirect + manual AST walk that tracks class field types, method parameter types, and local variable declarations in scope; resolves the receiver's type on every `obj.method()` call. `codeGraph.pickCallTarget` now uses calleeType + containerType as the primary disambiguator BEFORE falling back to same-file/imported-files. Live impact on the school Spring Boot project (RaceKatteKlubben): the 8 unresolved `validate()` calls dropped to 0; resolvedCalls 198→208. The unresolved list is now exclusively stdlib + Spring (JDBC ResultSet, Model, etc.) — no internal names left.
- ✅ v0.16 — **Phase 5b: type-aware call resolution for Go.** Two-pass parseDirect: pass 1 collects every struct's `field_declaration_list` into a `structName → { fieldName → typeName }` table; pass 2 walks methods tracking receiver type (with `*Service` → `Service` pointer-stripping), parameter types, `var x Type` declarations, and `x := T{}` / `x := &T{}` composite literals. Receiver-types resolve `s.field.method()` chains via the struct field table. Bare calls inside a method (`helper()`) get the receiver type as implicit calleeType. `:=` from arbitrary expressions stays untyped (return-type inference is out of v1 scope). Validated against cobra, gin, testify — slight resolved-calls improvements (32-52% range; most remaining unresolved are stdlib calls that never could resolve to in-repo code) and zero regressions on the existing Go tests.

### Next up: continue Phase 5 (type-aware resolution for the remaining 2 typed langs)

The Phase 5 contract (containerType + calleeType) is in place; each remaining
typed language's plugin needs the same internal upgrade.

- **Phase 5c — TypeScript**: explicit type annotations on class fields, function parameters, `let x: Type`. Inferred types are out of scope — TS inference is too complex for our static walk. ~2 evenings for the typed subset (which is 80%+ of modern TS).
- **Phase 5d — Python**: optional type hints (`def f(x: Foo)`). Untyped Python stays name-match — no inference attempted. ~1 evening.

After Phase 5 is fully shipped, the resolver will be deterministic for
typed languages — UI-visible blast radius accuracy goes from "good
heuristic" to "structural truth" for any project that uses static types.

### Then: continue migrating remaining regex-fallback languages

- Migrate Kotlin — Java's lillebror; could share JVM-style FQN indexing logic.
- Migrate C#, PHP, Ruby — in any order, ~1 evening each.
- Function-level blast radius (today the hero is file-level) — the call-graph is per-function but the UI projects to files. Could add a "click a function chip → blast radius for just that function".
- AST-based duplicate detection via tree-walking similarity hashes.
- Test-to-code mapping refinements using the call-graph.

### Dep-health follow-ups (small, anytime)

Each is ~1 evening of work, no blocking:

- Go modules plugin (`go.mod` + `proxy.golang.org`)
- Maven plugin (`pom.xml` + Maven Central) — Java
- NuGet plugin (`*.csproj` + `nuget.org`) — C#
- Gradle plugin — harder, Java/Kotlin DSL parsing
- Conan + vcpkg plugins — C/C++ (for projects that use a package manager)
- RubyGems, Composer (PHP), pub (Dart/Flutter) — quick additions

### Other polish candidates

- Rate-limit friendly error states
- Empty states polish (fresh session, no data)
- Memoize `nodeTypes` (silence React Flow console warning)
- Auto-upgrade old snapshots on first view (currently user must click Refresh)
- Landing-page hero illustration + demo-repo row
- Per-contributor "Wrapped"-style achievements — extended cards
- *(Done in v0.10 for JS/TS via tree-sitter; Java + the other 5 languages are one-file plugin migrations whenever we want them.)*

### Big swings (non-blocking, for when core features settle)

- Tauri desktop app (see section below)
- Multi-user + real DB (only if going public)
- Conversational codebase ("chat with your repo")
- Predictive health (learn from 10k+ repos)
- Temporal knowledge graph — "why did we switch to Redux here?"

---

## Tauri port — the plan

### Why still deferred

Wrapping doesn't fix render perf — both Tauri and Electron use a webview. Iteration is still 10× faster on localhost than in a packaged webview. We port when the web version is ~90% of what we want feature-wise.

### When to pull the trigger

Any of:
- Want a downloadable `.app` / `.exe` to share
- Want to analyze user's **local** repos (not GitHub-hosted ones)
- Core features done and iteration is now polish-only

### The migration work (estimate: 2-3 hours)

1. `npm create tauri-app` inside existing project
2. Next.js static export (`output: "export"`)
3. Rewrite `app/api/*` — either Tauri commands in Rust, or direct-from-client GitHub API calls
4. Replace `lib/storage.ts` fs calls with Tauri's `@tauri-apps/api/fs`
5. Mac build + Windows cross-compile

Full-history analysis already works server-side in Node (v0.4) — Tauri port no longer needs Rust for that.

---

## Running locally on a fresh machine

```bash
git clone https://github.com/SoosFire/gitvision
cd gitvision
npm install
cp .env.example .env.local
# paste your GitHub token + optional Anthropic key into .env.local
npm run dev
```

**Node version required:** 20.9+ (tested on 25.x).

Run tests: `npm test` (watch) or `npm run test:run` (single pass).

Sessions stored in `.gitvision/sessions/` — not committed, machine-local.

---

## Security / credentials note

- `.env.local` is gitignored. Your `GITHUB_TOKEN` and `ANTHROPIC_API_KEY` stay local.
- **Minimum scope tokens only** — read-only `public_repo` is plenty.
- If a token ever leaks (chat, screen-share, commit message), **rotate it immediately** at the issuer's UI.

---

## Open questions / future thinking

- **Where does GitVision live long-term?** Self-hosted open-source core + commercial hosted? Pure personal tool that happens to be public? Both are valid — decide when a real user base tells us.
- **When do we add auth/multi-user?** Currently single-user architecture. A multi-tenant move requires rethinking storage, session ownership, rate-limit pooling. Non-trivial but not urgent.
- **Brand direction.** GitVision name is fine. No logo/wordmark yet — low priority until we have a reason.

---

*Last updated: end of session 4 (v0.16 — Phase 5b: type-aware call resolution for Go. Two-pass parseDirect collects struct field types in pass 1 and walks methods with full type-tracking scope in pass 2. Handles receiver-types, struct-field-access chains, var declarations, and `:=` composite-literal inference. TypeScript and Python remain for Phase 5c/5d).*
