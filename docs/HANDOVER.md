# Vaultmind — Developer Handover Notes

Supplementary detail for things that aren't obvious from reading the code.
The main session guide is `CLAUDE.md` at the repo root.

---

## Editing `answerPrompt` in App.js

`answerPrompt` is a single very long string on one line in `client/src/App.js`. The Edit tool cannot reliably match it because it spans thousands of characters and may contain special characters that break string matching.

**Pattern: use a Python replacement script**

1. Write a small Python file that reads App.js, does a targeted string replacement, and writes it back:

```python
# fix_prompt.py
with open("client/src/App.js", "r", encoding="utf-8") as f:
    content = f.read()

old = "...exact substring to replace..."
new = "...replacement..."

assert old in content, "String not found — check the substring"
content = content.replace(old, new, 1)

with open("client/src/App.js", "w", encoding="utf-8") as f:
    f.write(content)

print("Done")
```

2. Run it: `python fix_prompt.py`
3. Delete `fix_prompt.py`
4. Verify the change looks right in App.js before restarting the server.

The assertion ensures the script fails loudly rather than silently doing nothing if the substring has drifted.

---

## mupdf worker thread (extract-pages endpoint)

**File:** `server/workers/extractPages.worker.js`
**Used by:** `POST /api/extract-pages` in `server/index.js`

mupdf's WASM runtime calls `abort()` on malformed PDFs (e.g. "AD Part O - Overheating.pdf"). This cannot be caught with `try/catch` and drops the socket connection — the browser reports it as a CORS error with a null status code.

The fix runs mupdf inside a `worker_thread`. If WASM aborts, only the worker process dies. The main server catches the worker's `error` event and falls through to the pdf-lib fallback, returning a clean HTTP 500 that the client handles gracefully (skips the PDF and continues).

**Why mupdf must stay in this endpoint:** mupdf's compressed output is significantly smaller than pdf-lib's. The extracted pages are sent as base64 document blocks to Gemini, which has file size limits. pdf-lib output for large technical PDFs can exceed those limits.

**Why mupdf must stay in `/api/extract-text`:** pdf-lib has no text extraction capability. Removing mupdf from that endpoint returns empty text and breaks the entire QA pipeline.

---

## R2 / PDF serving pattern

PDFs are never served via presigned R2 URLs to the client — R2 CORS blocks the browser from reading the response. Instead, the server fetches from R2 and returns `{ base64 }` JSON to the client. The client decodes this and passes it as a data URI or ArrayBuffer to the PDF viewer / mupdf / pdf-lib.

---

## Temp doc Q&A — fixes applied (2026-05-21)

**Problem 1: Search buttons were broken** — both Search buttons (temp doc section ~line 1425, vault section ~line 1671) used `onClick={askQuestion}`, which accidentally passed the browser's click event as the `overrideVaultId` argument. This triggered the cross-vault code path with a garbage ID, causing "That vault has not been indexed yet." Fix: both changed to `onClick={() => askQuestion()}`.

**Problem 2: Silent error display** — the temp doc content area only showed `statusMsg` if it started with `"Error:"`. Timeout and rate-limit messages don't start with that, so query failures were invisible: question cleared, spinner ran, fell back to idle UI with no message. Fixed by changing the render condition to show any non-empty statusMsg except `"Answer ready"`.

**Problem 3: Question cleared too early** — the original `setQuestion("")` was at the very top of `askQuestion()`, before the async indexing wait. So if the user pressed Enter while still indexing, the question vanished immediately even if the query then aborted. Fixed: `setQuestion("")` moved to after the indexing wait and early-return guards — the question only clears once the pipeline is committed to running.

**useEffect for temp doc focus** (around line 347): fires when `tempDocIndexing` flips from true→false with a valid `tempDocIndex`. Focuses the temp doc textarea and clears any stale statusMsg so the next query starts clean.

---

## Email search redesign (2026-05-21)

Full redesign of the EmailsTab. Everything on the `develop` branch.

### What was built

**Database (Supabase — manual migrations already applied):**
- `project_emails` table has a new `email_type` column: `text CHECK (email_type IN ('confirmation','query','instruction','information','objection','other'))`
- `search_project_emails_hybrid` RPC now accepts a 5th parameter `p_email_ids uuid[] DEFAULT NULL`. When provided, the RPC restricts both the `semantic` and `keyword` CTEs to that set of IDs before ranking. This is used by the `/emails/ask` endpoint to scope semantic search to a pre-filtered pool.

**Server (`server/index.js`):**

*`generateStructuredSummary(subject, fromName, fromAddress, body)`* (~line 1516) — replaced the old `generateSemanticSummary`. Makes one Gemini Flash call per email at ingest time, returns `{ summary: string, type: string }`. The summary is 80–120 words capturing what was confirmed/decided/requested, sender role, key dates/amounts, and technical synonyms. The type is stored as `email_type`. HTTP errors (including 429) are thrown — not silently swallowed — so the ingest/reembed retry logic can catch them. Only JSON parse failures return silent defaults.

*`sleep(ms)`* (~line 1512) — simple Promise delay helper used throughout.

*Ingest endpoint* (`POST /api/projects/:id/emails/ingest`, ~line 1581) — now processes emails in chunks of 10 with 1.2s delay between chunks. Constants scoped inside the handler: `INGEST_CHUNK_SIZE = 10`, `INGEST_CHUNK_DELAY_MS = 1200`, `RATE_LIMIT_WAIT_MS = 15000`. Both `generateStructuredSummary` and `generateEmbedding` have 429 retry logic (wait 15s, retry once). Stores `email_type` in the upsert.

*Reembed endpoint* (`POST /api/projects/:id/emails/reembed`, ~line 1810) — same chunked pattern as ingest. Updates both `embedding` and `email_type` on existing rows. Constants redefined locally (same values).

*Paginated GET endpoint* (`GET /api/projects/:id/emails`, ~line 1690) — returns `{ emails, total, page, limit }`. No `body_text` in the response (metadata only). Server-side filters: `from` (ilike on address/name), `date_from`, `date_to`, `subject`, `has_attachments`, `email_type`. The `from` filter strips `[,()%_|]` before interpolating into the PostgREST `.or()` string to prevent syntax injection. Pagination: `page`/`limit` params, limit capped at 100, NaN-safe.

*Q&A endpoint* (`POST /api/projects/:id/emails/ask`, ~line 1739):
1. Apply metadata filters → get pool of matching email IDs
2. `expandSearchQuery` + `generateEmbedding("RETRIEVAL_QUERY")` on the question
3. Call `search_project_emails_hybrid` RPC with `p_email_ids: filteredIds`
4. Filter results by `similarity >= 0.35`, take top `limit` (default 20)
5. Fetch `body_text` for matched emails (up to 3,000 chars each)
6. Gemini Flash: extract-per-email prompt — quotes the specific sentence/passage from each email that answers the question. Format: opening sentence with count, then `**Sender — Date** / "exact quote"` per email. `maxOutputTokens: 1500`.
7. Returns `{ summary, supportingEmailIds }`. If Gemini fails, returns emails without summary.

**Client (`client/src/components/ProjectsSection.jsx`):**

`EmailsTab` fully rewritten. Key state: `emails`, `totalEmails`, `page`, `loadingEmails`/`loadingMore` for pagination; `question`, `asking`, `qaMode`, `aiSummary`, `supportingEmailIds`, `qaMessage`, `qaError` for Q&A; six filter fields; `reembedding`/`reembedResult` for admin. No `allEmails`, `isSearchMode`, or client-side filtering remains.

Layout: question input + always-visible filter row at top; two-column body (left: AI summary + email list; right: preview pane fixed at 380px); re-index + delete-all at bottom.

- `loadEmails(pageNum, append)` — calls `GET /emails` with current filter params. `useEffect` triggers on `projectId` mount and on any filter state change (not in Q&A mode).
- `handleAsk()` — calls `POST /emails/ask`, then fetches page 1 (limit 100) of emails and filters client-side to the `supportingEmailIds` returned. Sets `qaMode = true`.
- `handleClearResults()` — resets Q&A state, calls `loadEmails(1)`.
- `handleDeleteEmail(id)` — removes from `emails` state, decrements `totalEmails`.
- "Load more" button appends next page when `emails.length < totalEmails` (browse mode only).

`EmailRow` — shows sender name, colour-coded `email_type` badge, attachment indicator, date, subject, from address. Hover reveals delete ×. Props: `{ email, selected, onClick, onDelete }`.

`EmailPreview` — props `{ email, body, loading }`. Header metadata from the list-row `email` object; body from separately-fetched `body` object (fetched on click via `GET /emails/:eid`).

### Known limitations / next steps

- **Structured summaries not stored** — `generateStructuredSummary` produces a rich summary at index time but it's only used for the embedding text, not saved to the DB. Storing it in an `email_summary` column would make Q&A faster (no body fetch needed) and allow showing it as a snippet in the list. Future migration: `ALTER TABLE project_emails ADD COLUMN email_summary text`.
- **Q&A relevance tuning** — the 0.35 similarity threshold and top-20 limit are reasonable starting points but may need adjustment as the corpus grows. Both are in the `/emails/ask` endpoint: `SIM_THRESHOLD` constant and the `limit` default in the client call.
- **Existing emails need re-indexing** — emails synced before this deploy have `email_type = null` and embeddings generated from the old `generateSemanticSummary`. Run "Re-index emails" per project to update them. At ~50 emails/minute (rate-limit safe), 500 emails takes ~10 minutes.
- **ESLint note** — `react-hooks` plugin is not in the CRA ESLint config. Use `// eslint-disable-line` (no rule name) in `ProjectsSection.jsx`, not `// eslint-disable-line react-hooks/exhaustive-deps` — the latter causes a build failure.

---

## Global redesign (2026-05-22)

Full visual overhaul of `client/` — all on the `develop` branch, not yet merged to `main`.

**Spec:** `docs/superpowers/specs/2026-05-22-global-redesign.md`

### What was done

- **Design tokens** — 17 new constants added to `client/src/constants.js` (see CLAUDE.md for the full list). All old constants kept for export but UI now uses only the new ones.
- **LandingPage.jsx** — complete rewrite. Two groups ("Document Intelligence" / "Practice Management"), each with a row of tiles. Tile hover: `washColor` at rest → `fullColor` on hover (0.22s transition on the header band and CTA text), with `translateY(-2px)` + shadow lift on the outer card. State: `useState(hover)` per tile, `onMouseEnter`/`onMouseLeave` on the outer div.
- **App.js** — nav bar (DESIGN_SHELL, gold underline for active nav item, DESIGN_GOLD avatar circle), login screen (DESIGN_SHELL outer, COMPARE_FULL error borders), vault section header strip, full colour token replacement.
- **CompareSection.jsx, DatasheetsLibrarySection.jsx, ProjectsSection.jsx** — each gets a section header strip + full colour replacement.
- **TimesheetsSection.jsx + TimesheetHistory.jsx + TimesheetReport.jsx + FeeReview.jsx** — section header strips on all four (the three sub-views render full-screen without the parent, so each needs its own strip).
- **Spinner.jsx** — default colour changed to `DESIGN_GOLD`, `color` prop added.
- **AnswerRenderer.jsx** — `accentColor` prop added (default `VAULT_FULL`), threaded through `CitationLine`, `ClauseBlock`, `DocumentGroup`. All callers pass the correct module colour.
- **VaultManagementModal.jsx, AdminSection.jsx** — colour replacements + Admin section header strip.

### JSX comment gotcha — DO NOT REPEAT

The Task 3 implementer introduced a closing-brace bug that took several passes to find.

The vault section conditional opens at ~line 1287 of App.js as:
```jsx
{appSection === "vault" && <div style={{ ... }}>
  ...
</div>}   ← this } closes the { at the start
```

Because there was no parenthesis (`&&` directly before the JSX), the `}` comes immediately after the closing `</div>`. An earlier attempt to add a comment produced:

```
</div> /* end vault column wrapper */}    ← original: } closes the conditional
```

A fix commit changed this to:

```
</div>{/* end vault column wrapper */}    ← WRONG: } now closes the comment, not the conditional
```

The conditional `{appSection === "vault" && ...` was left unclosed. ESLint reported it as a syntax error hundreds of lines later. The correct form is:

```jsx
</div>}{/* end vault column wrapper */}
    ↑
    closes the {appSection === "vault" && ...} expression
```

**Rule:** When writing JSX comments adjacent to a closing element that itself closes a `{condition && <div>}` expression, the `}` closing the expression must come FIRST, before any `{/* comment */}`.

---

## Deployment

| Target | How |
|--------|-----|
| Client changes | Push to Vercel (auto-deploys from git) |
| Server changes | Push to Railway (auto-deploys from git) |
| ArchiSync desktop | `npm run dist` in `archimind-sync/archimind-sync/` → distribute new `.exe` |
