# Vaultmind — Claude Code Session Guide

> At the start of every session, read `docs/HANDOVER.md` for deeper technical notes on tricky areas.

Archimind / Vaultmind is an AI-powered document intelligence tool for architectural practice.
Non-technical owner: Nathan (architect). Always ask before making code changes — propose the approach first.

---

## Repo structure

```
Vaultmind/
├── client/          React (CRA) frontend — deployed on Vercel
├── server/
│   ├── index.js     Single-file Express backend — deployed on Railway
│   └── workers/
│       └── extractPages.worker.js   mupdf page extraction (worker thread isolation)
```

**ArchiSync desktop app** lives at `C:\Users\ngree\Archimind\archimind-sync\archimind-sync` (separate repo — Electron + React, distributed as portable .exe).

---

## Key tech

- **Supabase** — PostgreSQL + pgvector, auth. Use `supabase.auth.getUser(token)` — never `jwt.verify`.
- **Cloudflare R2** (S3-compatible) — PDF/file storage.
- **Google Gemini API** — `gemini-2.5-flash` for Q&A, `gemini-embedding-001` for embeddings.
- **mupdf** (WASM) — PDF text extraction and page splitting. **Must not be removed** — see below.
- **pdf-lib** — PDF page merging (drawing review) and fallback page splitting.
- `api()` wrapper in `client/src/api/client.js` — always use this for client→server calls. Auto-stringifies body, injects Bearer token, returns JSON. Never use raw `fetch`.
- `requireAuth` middleware on all protected routes. `requireAdmin` on all `/api/admin/*` routes.

---

## Colour constants

Always import from `constants.js`, never hardcode values:
- `AD_GREEN = "#0d6478"` (teal)
- `LIBRARY_BLUE` — use the constant, not `#2a6496`
- `ARC_NAVY = "#1e2a35"`
- `ARC_TERRACOTTA = "#c25a45"`

---

## mupdf — why it must stay and how it's isolated

mupdf is used in two endpoints in `server/index.js`:

### 1. `/api/extract-text` (~line 565)
Extracts structured text from PDFs using `page.toStructuredText()`. This is what powers the QA pipeline (Pass 1 index scoring). pdf-lib has **no text extraction capability** — removing mupdf here breaks QA entirely.

### 2. `/api/extract-pages` (~line 597)
Splits specific pages out of a large PDF into a smaller one before sending to Gemini (Pass 2). mupdf's `saveToBuffer("compress")` produces significantly smaller output than pdf-lib — important because the extracted PDF is sent as a base64 document block to Gemini, which has size limits.

**The problem:** mupdf's WASM `abort()` cannot be caught by `try/catch`. For certain malformed PDFs it aborts the WASM runtime in a way that drops the socket connection. The browser sees this as a CORS error with a null status code.

**The fix (implemented 2026-05-20):** `/api/extract-pages` now runs mupdf inside a Node.js `worker_thread` via `server/workers/extractPages.worker.js`. If WASM aborts, only the worker dies — the main process survives, catches the worker's `error` event, and falls through to the pdf-lib fallback, returning a clean 500. The pdf-lib fallback is sufficient for any PDF that mupdf can't handle.

Do **not** attempt to move mupdf out of the worker thread or remove it from either endpoint without understanding the above.

---

## 3-Pass Q&A pipeline (`client/src/App.js`)

All logic in `askQuestion()`:

**Pass 1 — Index scoring** (~line 747): Sends vault heading index to Gemini → gets back JSON of relevant document sections with page hints.

**Pass 2 — Page extraction** (~line 856): Fetches PDFs from R2, calls `/api/extract-pages` to carve out only the relevant pages. Known bug: falls back to first 2 PDFs alphabetically when scoring returns no matches (`effectivePdfs.slice(0, 2)`). This causes silent wrong answers.

**Pass 3 — Answer synthesis** (~line 1027): Sends extracted page content to Gemini with `answerPrompt`. Returns the final formatted answer.

### Editing `answerPrompt`
`answerPrompt` is one very long single-line string — the Edit tool cannot reliably match it. Use a Python replacement script instead. See `docs/HANDOVER.md` for the pattern.

---

## Answer format (current prompt structure)

Four sections in order: `## Summary`, `## Detailed Analysis`, `## Contradictions & Conflicts`, `## Practical Conclusion`

Citation format: `*Exact Filename | Clause title*` — must use exact filename from source.

---

## Citation system

`citationPageMap` state: keys = `docName` and `docName||heading`, values = `{ page, vaultId, fileName }`.

`handleCitationClick` uses 3-level fuzzy matching:
1. Exact key match
2. Part-letter extraction (e.g. "K" from "Approved Document K")
3. Normalised string overlap fallback

PDF viewer: inline iframe, PDF.js CDN v3.11.174.

---

## react-pdf v10 gotchas (PDFAnnotator.jsx)

- Worker must use `.mjs` extension
- `onRenderSuccess` doesn't provide `{ height }` — read from DOM: `pageWrapperRef.current.querySelector("canvas").offsetHeight`
- PDFs served as base64 through own API (not presigned R2 URLs — blocked by CORS)

---

## Outstanding issues (as of 2026-05-21)

1. **Conversation history contamination** (MEDIUM) — failed answers stored in `conversationHistory` pollute subsequent Pass 1 scoring. Workaround: page refresh.
2. **SQL migrations for review tables** — may not be run in production. See memory file for SQL.
3. **Cross-reference clauses still appearing** (LOW) — AD M Vol 1 cl.0.14 and related still appear despite filtering rule.
4. **Wide table column extraction** (KNOWN LIMITATION) — mupdf linearises text, loses column boundaries for wide tables.
