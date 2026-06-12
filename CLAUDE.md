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
- **mupdf** (WASM) — PDF text extraction and page splitting. **Must not be removed** — runs in worker thread to isolate WASM aborts. See `docs/HANDOVER.md`.
- **pdf-lib** — PDF page merging (drawing review) and fallback page splitting.
- `api()` wrapper in `client/src/api/client.js` — always use this for client→server calls. Never use raw `fetch`.
- `requireAuth` middleware on all protected routes. `requireAdmin` on all `/api/admin/*` routes.

---

## Colour constants

**Always import from `constants.js`, never hardcode hex values.**

Design tokens: `DESIGN_SHELL`, `DESIGN_GROUND`, `DESIGN_GOLD`, `DESIGN_TEXT`, `DESIGN_MUTED`
Module colours: `VAULT_FULL/WASH`, `COMPARE_FULL/WASH`, `LIBRARY_FULL/WASH`, `PROJECTS_FULL/WASH`, `TIMESHEETS_FULL/WASH`, `SCHEDULE_FULL/WASH`
Legacy (do not use in new UI): `ARC_NAVY`, `ARC_STONE`, `ARC_TERRACOTTA`, `AD_GREEN`, `AD_GREEN_MID`
Logic-only (do not remove): `BOILERPLATE_HEADINGS`, `isBoilerplate`, `AD_GREEN_FOREST`, `STAGE_COLORS`

---

## 3-Pass Q&A pipeline (`client/src/App.js`)

All logic in `askQuestion()`:

**Pass 1**: Sends vault heading index to Gemini → JSON of relevant sections with page hints. Response is sanitised + salvage-parsed (Gemini emits illegal newlines inside JSON strings).
**Pass 2**: Fetches PDFs from R2, extracts relevant pages via `/api/extract-pages` with `scanGeneral: true` — the server worker font-scans the live text for "General …" headings and includes those pages automatically.
**Pass 3**: Sends extracted pages to Gemini with `answerPrompt` → final formatted answer. General provisions titles are appended to PRIORITY SECTIONS.

Details + invariants in `docs/HANDOVER.md` → "Q&A pipeline robustness".

**`answerPrompt`** is one very long single-line string — the Edit tool cannot reliably match it. Use a Python replacement script. See `docs/HANDOVER.md` for the pattern.

---

## Answer format

Four sections: `## Summary`, `## Detailed Analysis`, `## Contradictions & Conflicts`, `## Practical Conclusion`
Citation format: `*Exact Filename | Clause title*` — must use exact filename from source.

---

## Citation system

`handleCitationClick` resolves the page in 3 tiers: clause-number text search (definitive) → vault index heading match (type-aware for Diagram/Table/Figure) → `citationPageMap` fallback. See `docs/HANDOVER.md` → "Q&A pipeline robustness".
PDF viewer: inline iframe, PDF.js CDN v3.11.174.

---

## Outstanding issues

See `docs/HANDOVER.md` for the current list.
