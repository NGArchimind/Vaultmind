# Post-launch tech-debt — deferred audit items

**Date:** 2026-06-23
**Status:** Deferred from the pre-launch audit — do in focused sessions AFTER launch, not in the launch rush.

The pre-launch audit's P0 and safe P1 items were done on 2026-06-23 (dead-code removal, rate-limiter eviction, query caps, HANDOVER refresh; route-auth confirmed clean). These remaining items were **deliberately deferred** because they either touch the core Q&A pipeline (need live testing) or are large refactors that are reckless to attempt right before launch.

## P1 — deferred (do soon after launch, with staging tests)

### 1. Gemini API key: move from URL query to header — ✅ DONE 2026-06-23 (all 5 sites; verified on staging)
`?key=${apiKey}` appears in ~10 server call sites (e.g. `/api/claude` and the embed/agreement/email-ask paths). Keys in URLs can leak into logs. Several Gemini calls in this codebase **already** use the `x-goog-api-key` header successfully, so the pattern is proven.
- **Approach:** for each Gemini `fetch`, drop `?key=` from the URL and add `headers: { "x-goog-api-key": process.env.GEMINI_API_KEY }`.
- **Risk:** these are the product's core Q&A calls — a mistake breaks answering. **Must** be tested live on staging (ask a real question, run an agreement/email extract) before merging to main.
- **Why deferred:** can't unit-test live Gemini; not worth risking the core pipeline in the launch window.

### 2. Rename `callClaude` → `askGemini` — ✅ DONE 2026-06-23 (all 23 references)
`callClaude` is misnamed — it calls Gemini. ~30 call sites across `App.js`, `ProjectsSection.jsx`, `CompareSection.jsx`, `DatasheetsLibrarySection.jsx`.
- **Approach:** mechanical rename across the client; verify build.
- **Why deferred:** cosmetic; HANDOVER already advises "rename in a dedicated session, not mid-feature." A 30-site diff is needless churn during launch.

### 3. Body-size limit
`express.json({ limit: "100mb" })` is generous. Left at 100mb intentionally — the Q&A payload path can approach ~20MB and lowering it risks a `413` on the core feature.
- **Approach (later):** apply a small per-route limit (e.g. 1mb) to most routes, keep a large limit only on `/api/claude`, `/api/extract-*`, and receipt upload.

### 4. Pagination on claim lists
`GET /api/expense-claims` and `/api/admin/expense-claims` now cap at 200/500 rows (cheap guard added). Real pagination (UI + cursor) is the proper fix once claim volume grows.

## P2 — larger refactors (own sessions, each brainstormed/planned)

### 5. Split `server/index.js` (~5,600 lines)
Into `routes/` (per domain: vaults, projects, timesheets, expenses, quiz, admin…), `middleware/` (auth, rateLimit), `helpers/` (email, r2, gemini). Do incrementally, one domain at a time, with the server booting green after each move.

### 6. Split god components
`App.js` (~1,800) → `AuthContext`, `VaultContext`, `useQA`, `useVaultPdfs`. `ProjectsSection.jsx` (~3,700) → one file per tab. High effort; extract one unit at a time behind stable props.

### 7. DB-backed vaults
Vaults currently do an R2 `ListObjects` on every load. Add a `vaults` Supabase table (server-only RLS) as the source of truth; R2 stays for file bytes only.

## Sequencing
P1.1 → P1.2 → P1.4 → P1.3, each its own small PR tested on staging. P2.5–7 are separate projects: brainstorm → spec → plan → execute, one at a time, post-launch.
