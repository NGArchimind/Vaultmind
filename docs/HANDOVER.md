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

## Vault indexing — heading extraction fix (2026-05-22)

**Problem:** Certain important headings in Approved Documents were not making it into the vault index, so the Pass 1 scoring AI never saw them and couldn't select the right pages.

Two classes of heading were being silently dropped:

1. **Unnumbered named sub-headings** — e.g. "Siting of pedestrian guarding", "Design of guarding". In mupdf's flat text output these look identical to body text (no clause number, no visual styling cue). Gemini-flash-lite was treating them as body text and not extracting them.

2. **Diagram/table captions** — e.g. "Diagram 3.1 Guarding design". The green caption bar sits at the very bottom of a table block. In mupdf text output it appears as the last line after all the table row text and looks like another row, not a structural heading.

Additionally, the crowded pages filter (`count > 8`) was stripping entire pages that had dense tables — removing even the diagram title headings from the index.

**Fixes applied (all in `client/src/App.js`):**

- **`TEXT_PROMPT` and `INDEX_PROMPT`** — both updated to explicitly instruct Gemini to: (a) extract unnumbered named sub-headings that introduce distinct content blocks; (b) recognise diagram/table captions at the bottom of table text as structural titles, not table row content.

- **Crowded pages filter** (Pass 1 index build, ~line 760) — changed from dropping all headings on crowded pages to keeping any heading whose title matches `^(table|figure|diagram)\s+\d+/i` even on crowded pages.

- **Scoring prompt** — added DUTY CLAUSES AND IMPLEMENTATION SECTIONS rule: for quantitative questions (heights, dimensions, thresholds), the scoring AI must select both the duty clause (e.g. K2) AND the implementation sections that follow later in the same document (e.g. "Section 3: Protection from falling", "Design of guarding"). The duty clause only states the legal obligation — the actual values are always in the implementation sections.

**Critical — re-index after deploying:** The vault index is stored in Supabase and was built with the old extraction prompt. Deploying these changes has no effect until the affected documents are re-indexed via the vault admin panel. Re-indexing replaces the stored headings list with one built from the new prompt.

---

## Agreements & Confirmations feature (2026-05-23)

**Spec:** `docs/superpowers/specs/2026-05-23-agreements-confirmations-design.md`

### Route ordering — critical

The file `server/index.js` has these agreements routes registered in order (~line 1467):

```
GET  /api/projects/:id/agreements
POST /api/projects/:id/agreements
POST /api/projects/:id/agreements/extract   ← MUST be before :aid routes
POST /api/projects/:id/agreements/ask       ← MUST be before :aid routes
POST /api/projects/:id/agreements/:aid/entries
DELETE /api/projects/:id/agreements/:aid
```

Express matches routes in registration order. If `extract` or `ask` were moved below the `:aid` routes, Express would match the literal string "extract" or "ask" as the `:aid` parameter, silently routing to the wrong handler. **Do not reorder these routes.**

### Two-insert pattern (data integrity)

Both the POST /agreements and POST /agreements/:aid/entries endpoints write to two tables. To avoid orphaned rows without transactions (Supabase JS SDK doesn't expose BEGIN/COMMIT):

- **POST /agreements**: creates parent row first, then inserts first entry. If entry insert fails, a compensating `DELETE` removes the parent row before throwing.
- **POST /agreements/:aid/entries**: inserts entry (`.select().single()` to capture id), then updates parent. If parent update fails, a compensating `DELETE` removes the orphaned entry row before throwing.

### Keyword match detection

The extract endpoint runs a simple overlap check (no vector embeddings) against existing project agreements. Words ≥4 chars, minus common stop words, are extracted from both the candidate text and each existing agreement's `current_text`. If ≥3 words overlap, `possible_match_id` is set to the existing agreement's id (best match by overlap count, not first match).

Stop words list is inline in the extract handler — expand it if false positives become a problem.

### Date rendering — timezone safety

`date_agreed` comes from PostgreSQL as a plain date string (e.g. `"2026-05-14"`). `new Date("2026-05-14")` parses as UTC midnight — in browsers behind UTC this shifts the displayed date one day earlier. Both `AgreementsTab.jsx` and `AgreementsReviewModal.jsx` use a `formatDateStr(str)` helper that constructs the Date in local time:

```js
function formatDateStr(str) {
  if (!str) return "";
  const [y, m, d] = str.split("-");
  return new Date(Number(y), Number(m) - 1, Number(d))
    .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
```

Apply this pattern everywhere a `date` column from Supabase is rendered — not just in the agreements components.

### What's not built yet

Auto-extraction triggers are deferred:
- Email sync → call `POST /agreements/extract` with email body, `source_type: "email"`
- Minutes tab upload → call `POST /agreements/extract` with minutes text, `source_type: "minutes"`

Both endpoints already accept these source types. No structural changes needed when those features are built — just call the extract endpoint and open the review modal with the returned candidates.

### SQL migration (pending Nathan)

The `project_agreements` and `project_agreement_entries` tables must be created in Supabase before the server endpoints will work. SQL is in the memory file (`project_archimind.md` → Agreements & Confirmations section). Run in Supabase → SQL Editor → New query. Deploy order: SQL first, then server (Railway), then client (Vercel).

---

## QA Bar scope selector + agreements cards (2026-05-26)

**File:** `client/src/components/ProjectsSection.jsx` — QABar component only.

### Scope selector pattern

`activeTab` is passed as a prop from the parent component (which owns the tab state) into QABar alongside the existing `onNavigateTab` callback. A `useEffect` watches `activeTab` and updates a `scope` state accordingly:

```js
useEffect(() => {
  const TAB_SCOPE = { agreements: "agreements", drawings: "drawings", tasks: "tasks", products: "products" };
  setScope(TAB_SCOPE[activeTab] || "all");
}, [activeTab]);
```

In `ask()`, four boolean flags gate what work is done and what context is sent:

```js
const includeDrawings = scope === "all" || scope === "drawings";
const includeAgreements = scope === "all" || scope === "agreements";
const includeTasks = scope === "all" || scope === "tasks";
const includeProducts = scope === "all" || scope === "products";
```

The context is built as a filtered array rather than one monolithic template literal — sections are `null` when excluded, then `.filter(Boolean).join("\n\n")` assembles the final string. This is the pattern to follow if further sections are added.

### Drawing content search contamination fix

The content search (`POST /drawings/search`) always ran and its results were always merged into `matchedDrawings`. When asking non-drawing questions (e.g. "show me all instructions"), the semantic search found drawings containing the word "instructions" and surfaced them as results.

**Fix:** content search results are only merged if the AI also explicitly cited at least one drawing via `drawing_ids`:

```js
if (matchedDrawingIds.length > 0) {
  for (const d of contentMatches) { ... }
}
```

Content search still runs when scope includes drawings (AI needs it for context), but the results only appear in the UI when the AI found them relevant enough to reference.

### Navigation from QA panel to tabs

Buttons that navigate to a tab must call `closePanel()` before `onNavigateTab(tabId)`. The QA result panel is `position: fixed` covering the whole viewport — setting the tab state underneath it has no visible effect until the overlay is removed. Pattern used in both the "View all in Agreements tab →" button and the per-card source buttons.

---

## Schedule Tool (2026-05-27)

**Spec:** `docs/superpowers/specs/2026-05-26-schedule-tool-design.md`

### Gemini 2.5 Flash — multi-part response pattern

Gemini 2.5 Flash is a **thinking model**. Its responses may include internal reasoning as one or more `parts` with `"thought": true` before the actual answer part. Code that reads only `parts[0].text` will get the thinking text, not the answer.

**Always extract text like this for Gemini 2.5 Flash endpoints:**
```js
const parts = data.candidates?.[0]?.content?.parts || [];
const text = parts.filter(p => !p.thought).map(p => p.text || "").join("\n");
```

The PDF Compare endpoint (`POST /api/schedule/compare-pdfs`) uses this pattern. Any new endpoints calling Gemini 2.5 Flash that need to parse structured output from the response should do the same.

**Speed:** For tasks that don't need reasoning (structured extraction, table parsing), disable thinking with `thinkingBudget: 0`:
```js
generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } }
```
This is set on the PDF Compare endpoint. Other endpoints using Gemini for simpler extraction tasks should consider adding it too.

### CORS — exposing custom response headers

Browsers only expose 7 "CORS-safelisted" response headers to JavaScript by default. Any custom response headers (e.g. `X-Schedule-Added`, `X-Custom-*`) must be explicitly listed in the server's CORS config or `res.headers.get("X-Custom-*")` returns `null` in the browser.

In `server/index.js`, both the `corsOptions` object and the duplicate `app.use(cors({...}))` block now include:
```js
exposedHeaders: ["X-Schedule-Added", "X-Schedule-Changed", "X-Schedule-Removed", "X-Schedule-Rows"],
```

**Pattern for future features:** If a server endpoint sets custom response headers that the client needs to read (e.g. diff counts, pagination metadata), add those header names to both CORS blocks.

### apiBlob() — binary downloads with readable response headers

The `api()` wrapper always parses JSON. For endpoints returning binary files (Excel, CSV) where you also need custom response headers:

```js
// client/src/api/client.js
export async function apiBlob(path, body = null, method = "POST") { ... }
```

Usage:
```js
// Read headers first, then blob — calling .blob() consumes the Response body
const res = await apiBlob("/api/schedule/csv-to-excel", { projectId, ... });
const count = parseInt(res.headers.get("X-Schedule-Added") || "0");
const blob = await res.blob();  // must come AFTER reading headers
```

For GET requests: `apiBlob("/api/path", null, "GET")`

### CSV parsing

`parseCsvText(text)` helper added to `server/index.js` (near line 88, after `streamToBuffer`). Handles:
- `\r\n` / `\r` / `\n` line endings
- Quoted fields with embedded commas
- Escaped double-quotes (`""` within quoted fields)
- Returns `string[][]` — array of rows, each row an array of trimmed field strings

Revit schedule exports may contain quoted fields with commas (e.g. "Type A, Type B"). Standard `split(",")` breaks these — use `parseCsvText` instead.

### Schedule types are per-project

`project_schedule_types` rows have a `project_id` foreign key. Schedule types are NOT global — "Window & Door Schedule" for project A is a different row from "Window & Door Schedule" for project B. The client loads types fresh for each selected project via `GET /api/projects/:id/schedule-types`.

### Revision comparison — always vs most recent

The diff is always computed against the **most recent stored revision** (ordered by `uploaded_at DESC`, limit 1). There is no UI to compare against older revisions. First upload always saves as baseline (no diff colouring).

---

## PDF Compare — image-based extraction (2026-05-29)

**Endpoint:** `POST /api/schedule/compare-pdfs` in `server/index.js`

### Why image-based (not text-based)

mupdf text extraction linearises PDF content left-to-right. For schedule tables this means all columns are flattened into a single stream with no column boundaries. Gemini could not reliably attribute cell values to their correct columns, producing random additions/removals in the diff.

The fix: render each PDF page to a JPEG using mupdf's pixel rendering API, then send the image to Gemini vision. Gemini reads the visual table layout directly — column assignment is correct regardless of PDF source (Revit, Excel, AutoCAD, external).

### mupdf rendering API

```js
const mupdf = await import("mupdf");
const page = doc.loadPage(i);
const pixmap = page.toPixmap(mupdf.Matrix.scale(1.5, 1.5), mupdf.ColorSpace.DeviceRGB, false);
const jpegBase64 = Buffer.from(pixmap.asJPEG(80)).toString("base64");
```

Scale 1.5 × quality 80 balances readability vs image size for typical A3/A1 schedule pages.

### Gemini vision call format

```js
contents: [{
  parts: [
    { inline_data: { mime_type: "image/jpeg", data: pageBase64 } },
    { text: prompt },
  ],
}],
generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 8192 },
```

`responseMimeType: "application/json"` forces bare JSON output — Gemini won't wrap it in code fences.

### Architecture

1. `renderPdfPages(base64)` — renders each page to JPEG, returns array of base64 strings
2. `extractPageRows(pageBase64)` — sends one page image to Gemini, returns `{ columns: [...], rows: [[...], ...] }`
3. `combinePages(results)` — merges all page results into one table (columns from first page, rows from all pages)
4. JS diff — `byMarkA`/`byMarkB` lookup maps, O(n) comparison, no AI involvement

Pages are processed in parallel via `Promise.all`. Each page has its own Gemini call so no single call is too large.

---

## Role-based UI — staff rollout (2026-05-29)

**Spec:** `docs/superpowers/specs/2026-05-28-role-based-ui-design.md`
**Branch:** `develop` (3 commits, not yet merged to main)

### What was built

Staff users (non-admin) see only Vault and Timesheets. Admin (Nathan) sees full interface unchanged.

**How role is determined:** `session.user?.user_metadata?.role === "admin"` → `isAdmin` boolean, already computed at ~line 305 of `App.js`. Set in Supabase user metadata per account.

**`App.js` changes:**
- `NAV_SECTIONS` constant (right after `NAV_LABELS`, inside the main UI block): `isAdmin ? [all 5] : ["vault", "timesheets"]`
- Nav `.map()` uses `NAV_SECTIONS` instead of hardcoded array
- `isAdmin` prop passed to `<LandingPage>`
- `isAdmin &&` guards on compare, library, projects, schedule section renders (not timesheets — staff can access it)

**`LandingPage.jsx` changes:**
- `isAdmin = false` default prop
- Early-return for `!isAdmin`: two-tile centred layout (`maxWidth: 760`) using Vault + Timesheets tiles derived from existing `DOCUMENT_TILES`/`PRACTICE_TILES` arrays via `STAFF_IDS = ["vault", "timesheets"]` filter
- Admin path falls through to unchanged six-tile layout

### Extending staff access in future

To grant staff access to an additional module (e.g. Schedule):
1. `App.js`: add the section id to the `NAV_SECTIONS` non-admin array and remove its `isAdmin &&` guard
2. `LandingPage.jsx`: add the id to `STAFF_IDS`

---

## Deployment

| Target | How |
|--------|-----|
| Client changes | Push to Vercel (auto-deploys from git) |
| Server changes | Push to Railway (auto-deploys from git) |
| ArchiSync desktop | `npm run dist` in `archimind-sync/archimind-sync/` → distribute new `.exe` |
