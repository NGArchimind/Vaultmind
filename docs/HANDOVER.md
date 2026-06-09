# Archimind / Vaultmind — Session Handover Notes

> Read at the start of every session for technical context on tricky areas.

---

## Code quality pass (2026-06-03, complete)

XSS fix in PDF viewer, 82 error-leak routes standardised, duplicate CORS removed, Resend singleton, vault useMemo/useCallback, AI timeout named constants. See git log for details.

---

## Parked refactoring items

- **B3** Rate limiter (`server/index.js` ~line 64) — plain `Map`, resets on Railway restart. Fix: `express-rate-limit` or Redis.
- **B6** No PDF magic byte check on upload — add `if (buffer.slice(0,4).toString() !== "%PDF")` check after base64 decode.
- **C1** `callClaude` misnamed (calls Gemini) — ~30 call sites. Rename in a dedicated session, not mid-feature.
- **C4** `api()`/`apiBlob()` duplicate auth logic — extract shared `authorisedFetch()` base.
- **D1** App.js god component (1,800+ lines) — split into `AuthContext`, `VaultContext`, `useQA`, `useVaultPdfs`.
- **D2** ProjectsSection.jsx (3,700+ lines) — split into one file per tab.
- **D3** server/index.js (5,300+ lines) — split into `routes/`, `middleware/`, `helpers/`.
- **D4** Vaults not DB-backed — R2 ListObjects on every load. Future: add `vaults` Supabase table.

---

## Tricky technical areas

### mupdf — must not be removed
- `/api/extract-text` — mupdf structured text powers QA Pass 1. pdf-lib has no text extraction.
- `/api/extract-pages` — runs mupdf in `server/workers/extractPages.worker.js`. WASM abort kills only the worker; main process falls back to pdf-lib. Do not move out of the worker.

### answerPrompt — cannot be edited with Edit tool
Single very long line in `App.js`. Use a Python replacement script:
```python
with open("client/src/App.js", "r", encoding="utf-8") as f:
    content = f.read()
content = content.replace('OLD_ANCHOR', 'NEW_ANCHOR')
with open("client/src/App.js", "w", encoding="utf-8") as f:
    f.write(content)
```
Write the script to a `.py` file and run it — do not use `python -c` with double-quoted Bash strings (backslash escaping breaks).

### App.js vault section JSX
`{appSection === "vault" && <div>...`. Closing `}` must be on same line as `</div>`: `</div>}{/* comment */}`. Newline between them causes render bug.

### AnswerRenderer prop name
Use `text=` not `answer=`.

### Supabase RLS policy pattern
Always: `USING (true) WITH CHECK (true)`. Never: `WITH CHECK (auth.role() = 'authenticated')`.

### Route ordering in server/index.js
Specific routes before wildcard `:id` routes. E.g. `/api/expenses/settings` before `/api/expenses/:id`.

### react-pdf v10 gotchas (PDFAnnotator.jsx)
- Worker must use `.mjs` extension
- `onRenderSuccess` has no `{ height }` — read from DOM: `pageWrapperRef.current.querySelector("canvas").offsetHeight`
- PDFs served as base64 through API (not presigned R2 URLs — CORS blocks direct R2 access)

### Resend lazy singleton
`getResend()` returns `null` if `RESEND_API_KEY` not set — `sendEmail()` skips silently. Before deploying timesheets/expenses: set both `RESEND_API_KEY` and `RESEND_FROM` on Railway. Use `onboarding@resend.dev` as `RESEND_FROM` until custom domain is ready.

---

## Outstanding issues (as of 2026-06-07)

1. **General provisions scoring** — code injection deployed 2026-06-07; awaiting test confirmation
2. **Multi-clause blocks not combining** (LOW) — same-subject clauses across sections still separate citation blocks
3. **Wide table extraction** (KNOWN LIMITATION) — mupdf linearises text, loses column structure
4. **Email work** (PARKED) — summaries not stored in DB; relevance threshold (0.35) needs tuning
5. **PDF Compare** (NEEDS TESTING) — image-based rewrite on Railway; needs first Revit schedule test
6. **Timesheets/Expenses** (ON develop BRANCH) — needs `RESEND_API_KEY` + `RESEND_FROM` on Railway
7. **Custom domain** — buy `archimind.co.uk`, point to Vercel, add Resend DNS
