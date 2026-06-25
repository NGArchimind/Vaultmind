# Tech-debt "full whack" — action plan (READ FIRST in the new session)

**Created:** 2026-06-23 (for a 2026-06-24 session)
**Purpose:** Orient a fresh session to tackle the P2 refactors safely. This is the starting point — read this, then `docs/HANDOVER.md`, then pick a workstream.

## Where things stand
The pre-launch timesheets/expenses batch + a security audit/cleanup shipped 2026-06-23 (see HANDOVER "2026-06-23" section). The app is stable and rolling out to the office. The **high-value audit fixes are done**; what's left is **large refactoring**, deliberately deferred from the launch window. Full deferred list: `docs/superpowers/plans/2026-06-23-post-launch-tech-debt.md`.

## Goal
Reduce the three biggest maintainability risks **without changing behaviour**:
1. **Split `server/index.js`** (~5,600 lines, single file) — **do this first.**
2. **Split the god components** — `App.js` (~1,800) and `ProjectsSection.jsx` (~3,700).
3. **DB-backed vaults** — replace per-load R2 `ListObjects` with a `vaults` Supabase table.

These are **three separate projects**, not one sitting. Each gets its own brainstorm → spec → plan → execute. A realistic day likely **starts and makes real progress on #1**, not all three.

## Non-negotiable guardrails
- **This is pure refactoring — behaviour must not change.** No feature changes mixed in.
- **Work on `develop`**, verify on staging, then merge `develop → main`. **Nathan commits & deploys** (GitHub Desktop) — never run `git commit`. Tell him exactly what to deploy and where.
- **Verify after every step:** server must boot/parse (`node --check server/index.js`), `node --test server/lib/*.test.js` stays green, and the client builds with `CI=false node node_modules/react-scripts/bin/react-scripts.js build` from `client/` (the npm build script is broken on this machine).
- **Do NOT touch the Q&A / AI pipeline** as part of this. Nathan is very protective of it. If a refactor would move `askGemini`/`/api/claude`/embeddings/prompts, stop and treat it as its own explicitly-agreed, staging-tested change.
- Keep conventions: client calls via `api()`/`apiBlob()`; colours from `constants.js`; `requireAuth`/`requireAdmin` on routes; RLS stays deny-all (server-only); route ordering specific-before-`:id`.
- **Commit frequently** in small, working increments so Nathan can review and roll back easily.

## Recommended approach per workstream

### 1. Split `server/index.js` (start here)
Lowest behavioural risk if done incrementally; biggest day-to-day pain relief.
- Introduce `server/routes/`, `server/middleware/`, `server/helpers/`.
- Move **one domain at a time** into a router module (e.g. start with a self-contained domain like `expense-claims` or `quiz`): create `routes/<domain>.js` exporting an `express.Router()`, move its routes verbatim, `app.use(...)` it from `index.js`.
- Share `supabase`, `r2`, `sendEmail`, `requireAuth`, etc. via a small `helpers`/`middleware` module rather than duplicating.
- **After each domain move:** `node --check`, boot the server, smoke-test that domain on staging, commit. Never move two domains in one commit.
- Suggested order (least-entangled first): quiz → expense-claims/expenses → timesheets → admin → projects/vaults last (most cross-references).

### 2. Split god components
- `App.js` → extract `AuthContext`, `VaultContext`, and hooks `useQA`, `useVaultPdfs` (per HANDOVER D1). Pull one unit out at a time behind stable props/context; build green after each.
- `ProjectsSection.jsx` → one file per tab (D2).
- **Caution:** `App.js` contains the Q&A `askQuestion()` orchestration and `answerPrompt` (one giant line — edit only via a Python replace script, per HANDOVER). Extracting Q&A logic is the riskiest part — leave it until last and treat with the pipeline-caution rule above, or skip it this round.

### 3. DB-backed vaults (own brainstorm)
- More design than mechanical. Add a `vaults` table (server-only RLS), make it the source of truth for vault metadata, keep R2 for file bytes. Migration + backfill from current R2 listing. Brainstorm before touching.

## How to begin tomorrow
1. Read this + `docs/HANDOVER.md` (esp. "Parked refactoring items" and the 2026-06-23 section).
2. Confirm with Nathan which workstream to start (recommend **#1, server split**) and how far he wants to go.
3. Invoke the **brainstorming** skill for that workstream → agree a spec → **writing-plans** for an incremental, commit-per-step plan → execute with checkpoints.

## Also pending (small, can slot in)
- **P1.3** — per-route body-size limits (keep large only on `/api/claude`, `/api/extract-*`, receipt upload).
- **P1.4** — real pagination on the claim lists (currently capped at `.limit(200/500)`).
