# Archimind — Session Handover
**Date:** 2026-05-18
**Project:** Archimind / Vaultmind — Task Board, Drawing Review & PDF Annotation system

---

## Project Overview

Archimind is a personal AI-powered document intelligence tool for architectural practice. Built by Nathan Green (architect, non-coder). Monorepo at `C:\Users\ngree\Archimind\Vaultmind`.

- **Client:** React (CRA), `client/` — deployed on Vercel
- **Server:** Express/Node.js, `server/` — deployed on Railway
- **Storage:** Cloudflare R2 (PDFs + vault indexes), Supabase (auth + data)
- **AI:** Google Gemini API (`gemini-2.5-flash`, embeddings via `gemini-embedding-001`)
- **Auth:** Always use `supabase.auth.getUser(token)` — never `jwt.verify`

**Colour palette (constants.js):** `AD_GREEN = "#0d6478"`, `ARC_NAVY = "#1e2a35"`, `ARC_TERRACOTTA = "#c25a45"`, `LIBRARY_BLUE` constant exists — never hardcode `#2a6496`.

**api() client wrapper** (`client/src/api/client.js`): auto-stringifies body, injects Bearer token, returns JSON. Always use this — never raw fetch.

---

## New Features Built This Session

### 1. Task Board ("To Do" tab in Projects)

**Files:**
- `client/src/components/TaskBoard.jsx` — full task management table
- `client/src/components/ProjectsSection.jsx` — added `{ id: "tasks", label: "To Do" }` tab

**What it does:**
- Per-project task list as a filterable/sortable table
- Filter bar: Status / Priority / Assignee / Due date dropdowns with Clear button
- Sortable columns: Task, Status, Priority, Assigned To, Due Date
- `TaskModal` for full task detail (title, assignee, priority, due date, description, status)
- Anyone can add/edit tasks; both Close (status→done) and Delete available
- `ReviewBadge` component showing drawing review status inline per task row
- "Drawings" button on each row opens `DrawingReview` modal
- `onStatusChange` callback updates `_review` on task in local state without a full reload

**Server endpoints (all in `server/index.js`):**
- `GET /api/projects/:id/tasks` — returns tasks with `_review: { status, round_number }` denormalised from latest review round
- `POST /api/projects/:id/tasks`
- `PATCH /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `GET /api/team-members` — returns `id/full_name/email` for assignee dropdown (any authenticated user)

**Database tables needed (run in Supabase if not done):**
```sql
-- Tasks (may already exist from earlier session)
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'todo',
  priority text NOT NULL DEFAULT 'medium',
  assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access" ON tasks USING (true) WITH CHECK (true);
```

---

### 2. Drawing Review

**File:** `client/src/components/DrawingReview.jsx`

**What it does:**
- Modal opened from the "Drawings" button on each task row
- Upload one or more PDFs via drag-and-drop or file picker (PDFs only)
- All PDFs in a round are merged server-side into a single pack using `pdf-lib`
- Tracks review rounds — can only upload a new round when the previous one is "reviewed"
- Existing rounds listed with status badge (amber = in review, green = reviewed)
- Expandable rows show comments per round
- "Open for Review" / "View / Annotate" opens the full-screen `PDFAnnotator`

**Server endpoints:**
- `POST /api/tasks/:id/review-rounds` — merges PDFs with pdf-lib, uploads to R2, creates DB record
- `GET /api/tasks/:id/review-rounds` — list rounds for a task
- `GET /api/review-rounds/:id/pdf` — fetches PDF from R2, returns `{ base64 }` (avoids CORS issues with direct R2 URLs)
- `PATCH /api/review-rounds/:id` — save annotations JSON
- `POST /api/review-rounds/:id/complete` — mark reviewed, set completed_at
- `GET /api/review-rounds/:id/comments`
- `POST /api/review-rounds/:id/comments`
- `DELETE /api/review-comments/:id`

**Database tables needed (run in Supabase if not done):**
```sql
CREATE TABLE IF NOT EXISTS task_review_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  round_number int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'in_review' CHECK (status IN ('in_review','reviewed')),
  pdf_key text,
  annotations jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS task_review_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES task_review_rounds(id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  page_number int NOT NULL DEFAULT 1,
  comment_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE task_review_rounds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access" ON task_review_rounds USING (true) WITH CHECK (true);
ALTER TABLE task_review_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access" ON task_review_comments USING (true) WITH CHECK (true);
```

---

### 3. PDF Annotator

**File:** `client/src/components/PDFAnnotator.jsx`

Full-screen annotation tool. Uses `react-pdf` v10.4.1 for rendering and an HTML5 Canvas overlay for drawing.

**Critical react-pdf v10 gotchas:**
- Worker must use `.mjs` extension: `pdfjs.GlobalWorkerOptions.workerSrc = \`https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs\`` — `.min.js` won't work
- `onRenderSuccess` callback in v10 no longer provides `{ height }` — get page height by querying the DOM: `pageWrapperRef.current.querySelector("canvas").offsetHeight`
- PDFs must be served as base64 through our own API (not presigned R2 URLs) — R2 presigned URLs are blocked by browser CORS

**PDF serving pattern:**
Client uses `data:application/pdf;base64,...` as the `file` prop on `<Document>`. Server fetches from R2 and returns `{ base64 }`. This avoids R2 CORS and auth issues consistently.

**Annotation tools:**
| Symbol | Tool | Data model |
|--------|------|------------|
| ↖ | Select & edit | — |
| ✏ | Freehand pen | `{ type:"pen", pts:[{x,y}], color, sw }` |
| ▭ | Rectangle | `{ type:"rect", x, y, w, h, color, sw }` |
| ◯ | Ellipse | `{ type:"ellipse", x, y, w, h, color, sw }` |
| → | Arrow | `{ type:"arrow", x1, y1, x2, y2, color, sw }` |
| T | Text label | `{ type:"text", x, y, text, color, sw, fs }` |
| ↗T | Leader callout | `{ type:"leader", ax, ay, tx, ty, text, color, sw, fs, tbw, tbh }` |

**Leader annotation model:**
- `ax, ay` = arrowhead point
- `tx, ty` = text box origin (bottom-left of first text line)
- `tbw, tbh` = explicit box dimensions (set on creation from text measurement; resizable via handles)
- Box top-left derived as `(tx - 5, ty - fs - 5)`
- Arrow drawn from `(tx, ty)` → `(ax, ay)`
- Text wraps within `tbw` width using `wrapText(ctx, text, innerWidth)`
- **Resizable:** right-edge handles (`box_tr`, `box_mr`, `box_br`, `box_bm`) resize `tbw`/`tbh` live

**Pure utility functions (outside component):**
- `leaderBoxDims(ann)` — computes consistent `{ bx, by, bw, bh, fs, pad }` from annotation
- `wrapText(ctx, text, maxWidth)` — word-wraps text for canvas rendering
- `distToSegment(pt, a, b)` — distance from point to line segment
- `getHandles(ann)` — returns `[{ id, x, y }]` per annotation type
- `hitTestHandle(handles, pt)` — finds handle within 9px radius
- `hitTestAnnotation(ann, pt)` — hit tests annotation body (T=8px threshold)
- `applyHandleDrag(ann, handleId, dx, dy)` — pure function, deep-copies and modifies annotation
- `drawSelectionOverlay(ctx, ann)` — dashed outline + circular handles
- `redrawCanvas(canvas, anns, preview, selectedIdx)` — full canvas redraw

**Selection system:**
- `selected` state: `{ page, index } | null`
- `dragStateRef` (useRef, not useState) — avoids stale closures in mousemove: `{ handleId, startPt, origAnn }`
- Select tool: mousedown checks handles of current selection first, then hit-tests all annotations top-down
- Double-click on text/leader annotation opens inline text editor
- ESC clears selection and cancels pending operations
- Toolbar color/stroke/font-size controls update selected annotation live when one is selected
- Font size control (`Aa` ± buttons) only shown for text/leader tool or selected text/leader

**Comment panel:**
- Side panel (300px) lists all comments for the round
- Each comment shows page number, text, timestamp, copy button (⎘), and delete button
- **Copy/paste between sheets:** `copiedComment` state `{ text }` persists while navigating pages. When set, a clipboard strip appears above the "Add Comment" area with a "Paste p.N" button that immediately creates the comment on the current page.
- Comments created via `POST /api/review-rounds/:id/comments` with `{ comment_text, page_number }`

**Saving:**
- Annotations stored as `{ [pageNumber]: [annotation, ...] }` JSON on `task_review_rounds.annotations`
- "Save" button PATCHes the round
- "Complete Review" PATCHes then POSTs to `/complete` endpoint, then calls `onComplete()` + `onClose()`

---

## Fee Review

**File:** `client/src/components/FeeReview.jsx` (built earlier in session — status unknown if deployed)
**Wired into:** `client/src/components/TimesheetsSection.jsx` — "Fee Review" button in admin header, `subView === "fee"` routing

---

## 3-Pass Q&A Pipeline

All query logic is in `askQuestion()` in `client/src/App.js`.

**Pass 1 — Index scoring (`scoringPrompt`, ~line 747):**
Sends the vault's heading index to Gemini, returns JSON `{ selectedDocs: [{ docName, sections: [{ heading, pageHint, probability }] }] }`.

**Pass 2 — Page extraction:**
Fetches PDFs from R2 for scored documents. Falls back to first 2 PDFs if scoring returns no matches — **known critical bug** (see Outstanding Issues).

**Pass 3 — Answer synthesis (`answerPrompt`, ~line 1027):**
Sends extracted page content to Gemini with detailed format prompt.

**`answerPrompt` is one very long single-line string** — cannot be edited with the Edit tool. Use a Python replacement script. See "How to Edit the answerPrompt" section below.

---

## Answer Format (current prompt structure)

Four sections in order: `## Summary`, `## Detailed Analysis`, `## Contradictions & Conflicts`, `## Practical Conclusion`

- **Summary:** Direct answer, no preamble, no "it depends". Synthesised overview table if needed (NOT a source doc copy, NO citation on it).
- **Detailed Analysis:** One citation block per unique doc+section. PART 1 = `*Exact Filename | Clause title*`, PART 2 = verbatim text, PART 3 = italic explanation if needed. Skip pure cross-refs, skip repeated dimensions, combine same-doc same-section clauses.
- **Contradictions:** Substantive only. Quote both sides, explain conflict, give resolution.
- **Practical Conclusion:** Short, specific numbers only. No citations, no doc names.

---

## Citation System

`citationPageMap` state: keys = `docName` and `docName||heading`, values = `{page, vaultId, fileName}`

`handleCitationClick` fuzzy matching (3 levels):
1. Exact key match
2. Part-letter extraction — extracts "K" from "Approved Document K" or "AD Part K - ..." and matches
3. Normalised string overlap fallback

PDF viewer: inline iframe, PDF.js CDN v3.11.174. Two-pass heading search (±20 pages of hint, then rest skipping early pages to avoid TOC false positives).

---

## Key State / Bugs Fixed (session 2026-05-15 to 2026-05-18)

- `followUpVaultId` now reset to `""` at start of every `askQuestion` call
- `followUpQuestion` now reset to `""` after successful answers
- Follow-up vault index fetch: uses `.then`/`.catch` pattern to distinguish API errors from genuinely unindexed vaults
- "Citation" label removed from CitationLine card in AnswerRenderer.jsx
- `*italic*` (single asterisk without `|`) now renders as `<em>` in `formatInline()`

---

## Outstanding Issues

### 1. Pass 2 fallback to first 2 PDFs (HIGH PRIORITY)
```javascript
const docsToFetch = docsNeeded.length > 0 ? docsNeeded : effectivePdfs.slice(0, 2);
```
When scoring returns doc names that don't match any PDF filename, silently fetches the wrong 2 PDFs. Should either error explicitly or fall back to ALL PDFs.

### 2. SQL migrations may not have been run (MUST CHECK)
The `task_review_rounds` and `task_review_comments` tables need to exist in Supabase before the drawing review feature will work. SQL is in the Drawing Review section above.

### 3. Conversation history contamination (MEDIUM)
Bad/failed answers stored in `conversationHistory` pollute subsequent Pass 1 scoring. Workaround = page refresh.

### 4. Cross-reference clauses still appearing in Detailed Analysis (LOW)
AD M Vol 1 cl.0.14 and AD M Vol 2 relationship clause still appear despite filtering rule.

### 5. Multi-clause blocks from same document not always combining (LOW)
AD K 1.38, 1.39, 1.40 etc. get separate blocks. Prompt rule covers same-section but not same-subject across sections.

### 6. Wide table column extraction (KNOWN LIMITATION)
mupdf linearises text, loses column boundaries for wide tables. Cannot be fixed by prompt alone.

---

## How to Edit the answerPrompt

The `answerPrompt` is a single very long string on ~line 1027 of `App.js`. The Edit tool cannot handle it reliably. Use this pattern:

```python
# fix_promptN.py
path = r"C:\Users\ngree\Archimind\Vaultmind\client\src\App.js"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

old = "exact string to find"
new = "replacement string"

if old in content:
    content = content.replace(old, new, 1)
    print("Updated.")
else:
    print("ERROR: not found.")

with open(path, "w", encoding="utf-8") as f:
    f.write(content)
```

Run with: `cd "C:\Users\ngree\Archimind\Vaultmind" && python fix_promptN.py && rm fix_promptN.py`

---

## Deployment

- **Client changes** (`client/src/`) → push to Vercel
- **Server changes** (`server/index.js`) → push to Railway
- Nathan uses GitHub Desktop for version control
- After any server change note: "server → push to Railway"
- After any client change note: "client → push to Vercel"

---

## Working With Nathan

- Always explain the issue in plain English before making any change. Wait for explicit approval before touching any file.
- Nathan is an architect, not a developer. Use analogies. Avoid jargon.
- After every fix, state clearly which deployment target is affected.
- Read every file before editing it.
- Large rewrites: write to disk and reference the path rather than pasting inline.
