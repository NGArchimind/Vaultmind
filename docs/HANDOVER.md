# Archimind / Vaultmind — Session Handover Notes

> Read this at the start of every session for deeper technical context on tricky areas.

---

## Refactoring completed (2026-06-03)

A code-quality pass was done. No functionality was changed.

| ID | File(s) | What changed |
|----|---------|-------------|
| A1 | `client/src/App.js` | XSS fix — `fileName` HTML-escaped before injection into PDF viewer iframe HTML string (`safeFileName`) |
| A2 | `server/index.js` | All 82 bare `res.status(500).json({ error: err.message })` replaced with `return serverError(res, err, req.path)` — internal errors no longer leak to browser |
| B1 | `server/index.js` | Removed duplicate `app.use(cors({...}))` block |
| B2 | `server/index.js` | Resend client now a lazy module-level singleton via `getResend()` |
| B4 | `client/src/App.js` | Vault lookup wrapped in `useMemo([vaults, selectedVault])` |
| B5 | `client/src/App.js` | `loadVaults` and `loadVaultContents` wrapped in `useCallback([])` |
| C2 | `server/index.js` | `sanitizeVaultPath` moved to top of vault routes section |
| C3 | `client/src/api/client.js` | `AI_TIMEOUT_MS`, `AI_RETRY_DELAY_429`, `AI_RETRY_DELAY_502` named constants |

---

## Parked refactoring items

Identified 2026-06-03 — not yet implemented.

### B3 — In-memory rate limiter resets on restart
- **File:** `server/index.js` ~line 64
- **Problem:** `rateLimitMap` is a plain `Map`. Resets on every Railway deploy or crash.
- **Fix:** Replace with `express-rate-limit` package or add Redis. Acceptable as-is for small user base.

### B6 — No PDF magic byte validation on upload
- **File:** `server/index.js` — `POST /api/vaults/*/pdfs`
- **Fix:** After `Buffer.from(base64, "base64")`, add: `if (buffer.slice(0,4).toString() !== "%PDF") return res.status(400).json({ error: "File is not a valid PDF." });`

### C1 — `callClaude` misnamed (calls Gemini, not Claude)
- **Files:** `client/src/api/client.js`, `server/index.js` endpoint `/api/claude`, ~30 call sites across all components
- **Fix:** Rename to `callGemini`, endpoint to `/api/gemini`. Do in one dedicated session with careful grep-and-replace. Do NOT do mid-feature-work.

### C4 — `api()` and `apiBlob()` duplicate auth logic
- **File:** `client/src/api/client.js`
- **Fix:** Extract a shared `authorisedFetch(path, fetchOptions)` base that both delegate to.

### D1 — App.js god component (1,782 lines)
- **File:** `client/src/App.js`
- **Recommended split:**
  - `contexts/AuthContext.jsx` — session, role, login/logout, `useAuth()` hook
  - `contexts/VaultContext.jsx` — vault list, selected vault, contents, `useVault()` hook
  - `hooks/useQA.js` — entire `askQuestion()` pipeline + progress state
  - `hooks/useVaultPdfs.js` — upload, index, delete
  - `App.js` → routing + composition only (~200 lines)
- **Note:** Reserve a dedicated session. Verify all functionality after split.

### D2 — ProjectsSection.jsx god component (3,699 lines)
- **File:** `client/src/components/ProjectsSection.jsx`
- **Recommended split:** One file per tab (`DrawingsTab.jsx`, `AgreementsTab.jsx`, `TasksTab.jsx`, etc.) with `ProjectsSection.jsx` as the composing shell.

### D3 — Monolithic server (5,330 lines, single file)
- **File:** `server/index.js`
- **Recommended structure:**
  ```
  server/
    routes/   vaults.js, projects.js, timesheets.js, expenses.js, quiz.js, admin.js, schedule.js, ai.js
    middleware/  auth.js, rateLimit.js
    helpers/     r2.js, gemini.js, email.js
    index.js  (< 100 lines — startup + route mounting)
  ```
- **Warning:** Route ordering (specific before wildcard `:id`) must be preserved exactly when splitting.

### D4 — Vault storage not database-backed (long-term)
- **Problem:** Vaults are R2 key prefixes with no DB ownership record. Listing requires R2 `ListObjects` on every page load.
- **Fix (future):** Add a `vaults` Supabase table (`id, owner_id, name, type, parent_id, r2_prefix, created_at`). Low priority.

---

## Tricky technical areas

### mupdf — must not be removed
- `/api/extract-text` — uses mupdf for structured text (pdf-lib has no text extraction)
- `/api/extract-pages` — runs mupdf in `server/workers/extractPages.worker.js` (worker thread). WASM abort kills only the worker; main process falls back to pdf-lib.
- Do not move mupdf out of the worker thread.

### answerPrompt — cannot be edited with the Edit tool
`answerPrompt` in `App.js` is one very long single-line string. Edit tool fails on it. Use a Python replacement script:
```python
with open("client/src/App.js", "r", encoding="utf-8") as f:
    content = f.read()
content = content.replace('const answerPrompt = `...OLD...`', 'const answerPrompt = `...NEW...`')
with open("client/src/App.js", "w", encoding="utf-8") as f:
    f.write(content)
```

### App.js vault section JSX closing brace
`{appSection === "vault" && <div>...`. The `}` that closes must come immediately after `</div>`, before any comment: `</div>}{/* comment */}`. A newline between them causes a render bug.

### AnswerRenderer prop name
Use `text=` not `answer=` when rendering AI answers via `<AnswerRenderer>`.

### Supabase RLS policy pattern
Always: `USING (true) WITH CHECK (true)`. Never: `WITH CHECK (auth.role() = 'authenticated')`.

### Route ordering in server/index.js
Specific routes before wildcard `:id` routes. E.g. `/api/expenses/settings` before `/api/expenses/:id`.

### react-pdf v10 gotchas (PDFAnnotator.jsx)
- Worker must use `.mjs` extension
- `onRenderSuccess` doesn't provide `{ height }` — read from DOM: `pageWrapperRef.current.querySelector("canvas").offsetHeight`
- PDFs served as base64 through API (not presigned R2 URLs — CORS blocks direct R2 access)

### Resend lazy singleton
`getResend()` returns `null` if `RESEND_API_KEY` not set — `sendEmail()` skips silently. Before deploying timesheets/expenses, set both `RESEND_API_KEY` and `RESEND_FROM` on Railway. Use `onboarding@resend.dev` as `RESEND_FROM` until custom domain is ready.

---

## Outstanding issues (as of 2026-06-03)

1. **Multi-clause blocks not combining** (LOW) — same-subject clauses across sections still separate citation blocks
2. **Wide table column extraction** (KNOWN LIMITATION) — mupdf linearises text, loses column structure for wide tables
3. **Email work** (PARKED) — summaries not stored in DB; relevance threshold (0.35) needs tuning
4. **PDF Compare** (NEEDS TESTING) — image-based rewrite deployed to Railway; awaiting first real test with Revit PDFs
5. **Timesheets/Expenses** (ON develop BRANCH) — needs `RESEND_API_KEY` + `RESEND_FROM` on Railway, then deploy client + server
6. **Custom domain** (TODO) — buy `archimind.co.uk`, point to Vercel, add Resend DNS records
