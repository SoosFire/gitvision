# Agent onboarding — GitVision

Welcome. This file is the primary context you need to work effectively on GitVision. Read it fully before touching code. If something here conflicts with the rest of the repo or your training data, this file wins — it captures decisions that aren't obvious from code alone.

---

## 🛑 Before you do anything else

1. **Read `PROGRESS.md`** — 300+ lines of current state, design decisions, signal catalog, and the next-steps menu. You can't plan meaningful work without it.
2. **Run `git log -10 --oneline`** — the last ten commits usually explain what changed most recently and why.
3. **Run `npm run test:run`** — confirm the 196-test suite is green before you start. If red on a fresh checkout, fix that first; don't build on a broken baseline.
4. **Greet the user in Danish.** See "Who you're working with" below.
5. **Ask what they want to work on** before suggesting. They often have context you don't. Default to proposing from the `PROGRESS.md` roadmap if they're open.

---

## 👤 Who you're working with

**Name:** Jonas (GitHub: SoosFire)
**Age:** 24
**Location:** Denmark
**Education:** Datamatiker student at Zealand, currently 2nd semester. Graduates summer 2027.
**Day job:** Circle K (student job — can code during quiet shifts).
**Track record:** Shipped "Calandr" on App Store (iOS calendar app). Uses Claude Code effectively — understands AI-assisted development isn't magic, it's a tool.
**Life:** Lives with girlfriend (separate finances), trains regularly, values balance. **Hobby velocity** — not trying to crunch 10-hour sessions.

### Language

**Respond in Danish.** Always. Even if Jonas writes to you in English, continue in Danish unless he explicitly asks to switch. Code comments stay in English (for future readers), commit messages in English (convention), but all conversation to Jonas is Danish.

### Communication style he expects

- **Honest critique over enthusiasm.** If his idea is weak, say so with reasoning. Don't hedge.
- **Architecture-first.** Before writing code, propose the approach, explain trade-offs, let him choose. For small fixes, execute directly.
- **Specific over vague.** "`lib/signals.ts` line 142 has a race condition" beats "there might be a concurrency issue somewhere".
- **Quality over quantity — explicit user directive.** He'd rather we do one thing properly than ship five things halfway.
- **Push back welcome.** If he asks for something that breaks an invariant (e.g., hardcoding a language), explain why it's a bad idea before doing it.
- **Danish hobby developer humility.** No "amazing!" or "perfect!" hype. Plain language, technical precision.

### What he values

1. **Language-agnostic architecture.** He explicitly said: don't make this a language-specific tool. Future plugin additions must be one-file drop-ins.
2. **Not painting into corners.** Prefer the harder-but-right design over the easy-but-brittle one. He said "kvalitet over kvantitet uanset hvad".
3. **Building portfolio + optionality.** This is a hobby project that might become a commercial product. License is PolyForm Noncommercial — don't accept PRs or suggest changes that would make commercialization harder.
4. **Balance.** He enjoys the building. Don't push him to do 10 things when 2 would be meaningful. Respect when he wants to pause.

### What scares him (and how to help)

- **Fear of failure / not becoming something.** He said so directly. When he's hesitant, remind him of concrete progress (commit log, shipped features) — not platitudes.
- **Analysis paralysis on big architectural calls.** When he's stuck, narrow the options to 2-3 and recommend one with reasoning.

---

## 🗣️ How we talk

Five principles, in order of importance:

1. **Tell a story, don't just show numbers.** Applies to both product output and our explanations.
2. **Every view must be screenshot-worthy alone.** Features should stand on their own as shareable artifacts.
3. **Exploit the "update" angle.** Refresh is "what changed since last time", not just a re-fetch.
4. **Polish on localhost first, port to Tauri later.** Web iteration is 10× faster.
5. **Language-agnostic by architecture.** No feature should require touching signals/types/UI to add a new language.

These live in `PROGRESS.md` too. Reference them when a design decision trades one against another.

---

## 🏗️ What GitVision is (30-second version)

A session-based GitHub repo visualizer. User pastes a public repo URL → we fetch metadata + git history + package manifests → analyze → show an interactive canvas, an AI briefing, a hybrid rule-based + AI health check, and a multi-ecosystem dependency-health panel. Sessions are saved as JSON files, refreshable, and diff between snapshots for a "since your last visit" banner.

**Full state in `PROGRESS.md` → "Current state" section.** Don't skip reading it.

---

## 🧭 Architecture invariants (never break without discussion)

These are decisions we made deliberately and with reasoning. Breaking them without a talk will cause rework.

### 1. Plugin architecture for language-specific work

- **Dep-health ecosystems** (`lib/depsHealth/ecosystems/*.ts`) — adding Go, Maven, NuGet, Gradle, etc. must be one file implementing `EcosystemPlugin`. Do NOT add language-specific branches to `lib/depsHealth/index.ts`, `lib/signals.ts`, `lib/types.ts`, or any UI component.
- **Code-analysis plugins** (`lib/codeAnalysis/plugins/*.ts`, v0.10) — same pattern. JS/TS lives in `javascript.ts` (tree-sitter), the 7 other languages share `regexFallback.ts` (wraps `lib/graph.ts`'s regex parsers). When migrating a language to tree-sitter, drop a new file in `plugins/`, register it in the orchestrator (`cli.ts` + debug API), shrink `regexFallback.ts`'s extension list. Never branch by language outside plugin files.
- If you find yourself writing `if (ecosystem === "cargo")` anywhere outside a plugin file, stop and refactor.

### 2. Defensive fallbacks for old snapshots

Every new field added to `AnalysisSnapshot` must be **optional**. Old sessions on disk shouldn't crash or lose data.

Example: `dependencyHealths?: DependencyHealth[]` was added in v0.9. The singular `dependencyHealth?` field is kept around. `getDependencyHealths()` helper normalizes both shapes for signal detectors.

### 3. AI claims are always grounded in computed signals

The hybrid architecture for Health Check (rule-based `lib/signals.ts` → Claude narrative `lib/healthAnalysis.ts`) exists for a reason: **zero hallucination**. Every AI sentence must map back to a deterministic signal's evidence.

When adding new AI-generated output, preserve this pattern. Don't write prompts that ask Claude to "assess" anything without feeding it the data.

### 4. Bot filtering in PR metrics

PR throughput + cycle-time signals filter out `dependabot[bot]`, `renovate[bot]`, `vercel-release-bot`, etc. If you're touching these signals, preserve `isBotAuthor()` filtering — without it, automated PRs inflate "healthy"-looking numbers.

### 5. No emoji in UI chrome

All icons come from `lucide-react`. Consistent 12-14px sizing. Exception: semantic emoji in menu items (📸 Share, 🎁 Wrapped) is OK but we're moving away from that — prefer lucide.

### 6. Forced dark theme

`color-scheme: dark` on `html` + CSS vars in `globals.css` + inline `style={}` with `TOK` tokens from `lib/theme.ts` for all deep components. Do NOT reintroduce `prefers-color-scheme` conditionals or Tailwind `dark:` variants for new components — they don't consistently apply with our setup.

### 7. File-based storage, not a database

`.gitvision/sessions/<id>.json`. Simple, inspectable, portable between Mac and Windows. Don't add a DB without a real multi-user need.

### 8. PolyForm Noncommercial license

Don't accept PRs or suggest architectural changes that would make commercialization harder for Jonas. This is his optionality to preserve.

---

## 🪤 Technical gotchas we've already hit (don't repeat them)

### Next.js 16

- Breaking changes from earlier majors. Before using any API you remember, check `node_modules/next/dist/docs/` in the repo for the v16 version.
- The lockfile-conflict warning needs explicit `turbopack.root` in `next.config.ts`.
- `create-next-app` rejects uppercase in package name. Scaffold to a temp dir with lowercase name, then move files up.
- **Production build runs webpack, not Turbopack** (`next build --webpack` in package.json). Turbopack v16 chokes on Emscripten-style WASM packages — it generates a loader file that imports `"GOT.mem"`, `"env"`, `"wasi_snapshot_preview1"` and fails resolution. Webpack with `serverExternalPackages` handles this fine. Dev server still uses Turbopack for speed.
- WASM packages in App Router routes need `serverExternalPackages: [...]` AND `outputFileTracingIncludes` (top-level in `next.config.ts`, NOT under `experimental` in v16). Both are configured for `web-tree-sitter` + `@vscode/tree-sitter-wasm`.

### Tree-sitter / WASM (codeAnalysis pipeline, v0.10)

- Use **`process.cwd() + "node_modules/..."`** for resolving WASM file paths in `lib/codeAnalysis/runtime.ts`. Not `createRequire(import.meta.url)` — Turbopack's dev externalization replaces resolved paths with synthetic `[externals]/...` markers that fail `fs.readFile`. `process.cwd()` is bundler-agnostic.
- Plugin contract has **two parsing paths**: tree-sitter (`languageFor` + `queriesFor`) OR direct (`parseDirect`). Both methods are optional in the interface; plugins implement exactly one path. The orchestrator dispatches automatically.
- Plugins should use `satisfies CodeAnalysisPlugin` rather than `: CodeAnalysisPlugin` annotation, so the concrete-method type is preserved for tests that call optional methods directly.
- Adding a new tree-sitter language: add the grammar to `@vscode/tree-sitter-wasm` if missing (or add `tree-sitter-wasms` for less-common ones), create a single plugin file under `lib/codeAnalysis/plugins/`, register in the orchestrator's plugin list (currently `cli.ts` and the debug API route).
- TS-ESM convention: `import "./foo.js"` resolves to `./foo.ts` on disk. The JS plugin's resolver handles `.js↔.ts`, `.jsx↔.tsx`, `.mjs↔.mts`, `.cjs↔.cts` swaps. Don't reinvent.

### Tailwind CSS v4

- Arbitrary values like `bg-[#0a0a0c]` in `className` sometimes don't apply when imported from a `"use client"` component. **Use inline `style={{ background: "#0a0a0c" }}`** for critical colors.
- `h-[680px]` for React Flow containers: **use inline `style={{ height: 680 }}`** because Tailwind classes have timing quirks with RF's dimension detection.

### React Flow (@xyflow/react v12)

- **CSS must be imported in `app/globals.css`**, NOT inside a `"use client"` component. Importing in a client component caused silent render failures that took an hour to diagnose.
- The parent container needs **explicit width + height** at mount time. Inline style wins over Tailwind class.
- `<title>` elements: use template-literal string, not `{"\n"}`-spliced arrays. React throws warnings otherwise.

### Git

- `git log --numstat` hangs/fails on blobless clones (`--filter=blob:none`) because numstat needs file contents. **Use `git log --raw --no-renames`** — derives paths from tree diffs, no blobs needed.
- Clone with `--filter=blob:none --bare` for speed. Metadata-only, seconds not minutes on big repos.

### GitHub API

- Unauthenticated rate limit: 60/hr. With token: 5000/hr. Always encourage users to set `GITHUB_TOKEN`.
- Trees API `recursive=true` returns `truncated: true` on mega-repos. Handle gracefully.
- Contents API for package.json returns base64 in `content` field, not plain text.

### Package managers

- crates.io API requires a **descriptive User-Agent**; they'll return 403 without one.
- PyPI `yanked` flag is per-file, not per-version. Require *all* files for a version to be yanked before treating as "deprecated".
- npm `install-v1` accept header gives slim responses; without it, some packages return 10MB+ of historical data.

### Tests

- We use **Vitest, not Jest**. Config is `vitest.config.ts`. Path alias `@/` points to project root.
- Tests live in `lib/__tests__/`. Import from `../github`, `../depsHealth/ecosystems/npm`, etc.
- Mock snapshots via the `mockSnapshot()` factory in `signals.test.ts`. Don't reinvent.

---

## 🎯 Decision framework

**When to execute directly (no discussion needed):**
- Bug fixes with obvious single correct solution
- Typos, minor copy changes
- Test additions for existing functions
- Refactors that preserve behavior and pass all tests

**When to propose before executing:**
- New features (always)
- Changes touching multiple files across concerns
- Changes to public types (snapshot shape, API routes)
- Anything that touches `signals.ts` detector logic
- Package dependencies added/removed
- UI/UX changes beyond trivial

**When to ask a clarifying question before proposing:**
- Scope is unclear ("improve the canvas")
- Two valid interpretations exist
- Trade-off between invariants (e.g., speed vs. accuracy)

**Format for proposing:**

```
Short summary of what you want to build.

Three approaches:
1. [Name] — one-line description
   Pros: ...
   Cons: ...
2. ...
3. ...

Recommendation: #2. Reasons: ...

Want to go with #2, or do you see it differently?
```

Keep it tight. No more than half a page for most decisions.

---

## 📏 Quality bar

### Every commit must

- [ ] Pass `npx tsc --noEmit` (TypeScript strict)
- [ ] Pass `npm run test:run` (all 85+ tests green)
- [ ] Pass `npx next build` if it touched anything that could affect build (skip for pure test/doc changes)
- [ ] Never stage `.env.local`, `.gitvision/`, `.claude/settings.local.json`, or node_modules (use explicit `git add <file>` — never `git add -A` without checking)
- [ ] Use the standard commit format with HEREDOC and Co-Authored-By line (see existing commit messages for pattern)

### Commit message conventions

- **Title under 72 chars**, imperative mood ("Add X", "Fix Y", not "Added"/"Fixed")
- **Detailed body** explaining WHY (what was wrong, what we chose, what alternatives rejected)
- **Co-Authored-By** line at end: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- Use heredoc for multi-line bodies — preserves formatting

Pattern:
```bash
git commit -m "$(cat <<'EOF'
Title under 72 chars

Body explaining what changed and why. Multi-paragraph OK.
Reference specific files/lines when it aids review.

Verified: test plan, specific check that confirms it works.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### When to update PROGRESS.md

- After finishing a meaningful feature (new ecosystem, new panel, new analysis)
- After a significant architectural decision
- Not after every commit — the commit log handles the granular story

### When to update this file (AGENTS.md)

- When we hit a new gotcha worth remembering
- When user preferences evolve
- When an architectural invariant changes
- Before major role handoffs (Jonas switching machines, new collaborator)

---

## 🚫 Anti-patterns we've learned to avoid

1. **"Just add a flag for this language"** in shared code. Always extract to a plugin.
2. **Shipping AI output that could contain hallucinations.** Always feed computed data and constrain the prompt to cite only that.
3. **Using `git add -A` before checking status.** Has accidentally staged tokens before. Always `git add <explicit-file>` and `git diff --cached --name-only | grep -E "^\.env"` to verify.
4. **Suggesting Tauri migration prematurely.** It doesn't fix render perf. Only port when the web version is 90%+ of target UX.
5. **Inline commentary on dark/light mode.** We're dark-only. Don't write CSS that assumes system preference.
6. **Generic "let me know what you think".** Instead: "I see X and Y trade-offs here, I'd pick X because Z. OK?"
7. **Over-aggressive refactors.** If user hasn't asked for it, don't refactor working code just because you find a "better" pattern.
8. **Breaking backward compat on snapshot fields.** Old sessions on disk must keep rendering. New fields are optional.
9. **`bg-[#...]` Tailwind arbitrary values for critical colors in `"use client"` components.** Use inline style.
10. **Emoji creep in UI chrome.** lucide-react icons only for new buttons/actions.

---

## 🧰 Useful commands on a fresh session

```bash
# State check
git status
git log -10 --oneline
git diff --stat

# Full test run
npm run test:run

# Watch mode (for TDD)
npm test

# TypeScript check
npx tsc --noEmit

# Production build (reasonable sanity check before committing)
npx next build

# Run the app locally
npm run dev
# → open http://localhost:3000

# Verify a specific session in the API
curl -s http://localhost:3000/api/sessions | python3 -c "import sys,json; [print(s['id'], s['repoFullName']) for s in json.load(sys.stdin)['sessions']]"

# Analyze a fresh repo (triggers full pipeline)
curl -s -X POST http://localhost:3000/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{"repoUrl":"https://github.com/owner/repo"}' | python3 -m json.tool | head -40
```

---

## 📂 Where to look for specific knowledge

| Need | Look in |
|---|---|
| Current feature state + what's next | `PROGRESS.md` |
| Why a design decision was made | Commit message for that change (`git log --grep=<keyword>`) |
| Signal detector behavior | `lib/signals.ts` + `lib/__tests__/signals.test.ts` |
| How to add a new dep-health language | `lib/depsHealth/ecosystems/npm.ts` as reference + implement `EcosystemPlugin` |
| How to add a tree-sitter language plugin | `lib/codeAnalysis/plugins/javascript.ts` as reference + implement `CodeAnalysisPlugin` (tree-sitter path) |
| Code-analysis architecture overview | `PROGRESS.md` → "Code-analysis pipeline (v0.10 architecture)" |
| Theme tokens | `lib/theme.ts` (single source of truth) |
| User preferences / communication style | This file (top sections) |
| Technical gotchas | This file ("Gotchas" section) |
| Deployment config | Railway dashboard; `.claude/launch.json` for local preview |

---

## 🎬 Starting-a-session checklist (copy-paste when new session begins)

```
[ ] Read AGENTS.md (this file) in full
[ ] Read PROGRESS.md "Current state" + "Next-steps menu"
[ ] Run `git log -10 --oneline` for recent context
[ ] Run `npm run test:run` — confirm green baseline
[ ] Greet Jonas in Danish ("Hej, klar til at fortsætte på X?")
[ ] Ask what he wants to work on OR suggest from roadmap
[ ] Propose approach before coding (unless it's a trivial bug fix)
```

---

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
