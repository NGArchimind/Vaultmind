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

### 1. Multi-clause blocks not combining — FIXED
`answerPrompt` already contains rules to combine same-requirement clauses and sub-clauses under one block.

### 2. Email work (PARKED — defer to dedicated email session)
- Email structured summaries generated at index time but not stored in DB. Future: add `email_summary text` column, store in ingest + reembed upserts, surface as snippet in EmailRow UI.
- Email Q&A relevance tuning: `SIM_THRESHOLD = 0.35` and `limit = 20` are starting points — may need adjustment as corpus grows.

---

## Resolved Issues (session 2026-05-22)

- **Pass 2 fallback bug** — `effectivePdfs.slice(0, 2)` replaced with explicit "No relevant documents found" error message. Wrong PDFs no longer fetched silently.
- **SQL migrations** — `task_review_rounds` and `task_review_comments` confirmed present in Supabase.
- **Conversation history contamination** — "Context: N Q&As stored — clear" indicator added below search bar in both vault and temp doc areas (`App.js`). One click resets history without page refresh.
- **Cross-reference clauses in Detailed Analysis** — `answerPrompt` rule extended to also exclude introductory and document-relationship clauses (0.x sections, "should be read in conjunction with" etc.).

---

## New Features Built (session 2026-05-22)

### "Test Yourself" Quiz Feature

**Files:**
- `client/src/components/QuizModal.jsx` — full quiz UI (subject picker → document picker → question screen)
- `client/src/components/AdminSection.jsx` — Quiz Management section added at bottom
- `client/src/App.js` — "✎ Test Yourself" button added to vault toolbar; QuizModal import and state
- `server/index.js` — 6 new endpoints (see below)

**What it does:**
- Grey outline "✎ Test Yourself" button in vault toolbar (always visible, not admin-gated)
- Modal opens with two tiles: Approved Documents (teal) and CITB CSCS (slate)
- **AD path:** picks a document from the designated vault → serves shuffled questions one at a time
- **CSCS path:** jumps straight to quiz from the question bank
- Per-question feedback: correct option turns green ✓, wrong option red ✗ with correct highlighted and explanation shown
- Questions cycle indefinitely (reshuffled when exhausted), no score shown to user

**Server endpoints (in `server/index.js`):**
- `GET /api/quiz/questions` — fetch questions (params: `type`, `vault_name`, `document_name`)
- `POST /api/quiz/answer` — record answer; upserts user's `quiz_stats` row
- `GET /api/admin/quiz/settings` — get designated AD vault name
- `PUT /api/admin/quiz/settings` — set designated AD vault name
- `GET /api/admin/quiz/stats` — admin-only; all users' correct/incorrect counts with emails
- `POST /api/admin/quiz/generate` — generate 25 questions for one AD doc via Gemini + R2
- `DELETE /api/admin/quiz/questions` — clear questions for a doc or all CSCS
- `POST /api/admin/quiz/upload-cscs` — parse CSCS PDF verbatim, store questions

**Admin Quiz Management section** (bottom of Admin panel):
- AD vault selector dropdown + Save
- Per-document table: question count, Generate button (calls Gemini ~15s), Clear button
- CSCS section: Upload PDF button, question count, Clear all
- User stats table: email + AD correct/incorrect + CSCS correct/incorrect (admin-only)

**Database tables (already migrated):**
```sql
quiz_questions (id, type, vault_name, document_name, question_text, options jsonb, explanation, source_clause, created_at)
quiz_stats (id, user_id, quiz_type, correct_count, incorrect_count, updated_at) -- UNIQUE(user_id, quiz_type)
app_settings (key, value, updated_at) -- stores quiz_ad_vault_name
```

**Status:** Code complete, pending Nathan's live testing. Deploy: client → Vercel, server → Railway.

---

## Feature Backlog

### Vault
- **Loading animation** — add "test while you wait" content during answer generation (building regs or CSCS themed animation/tips)
- **Part K guarding question** — question references Part K but not the correct clause; correct clause should appear front and centre in the answer
- **Wrong diagram page** — most critical diagram for an answer is not being surfaced; should be the first/most prominent thing shown
- **Forward answer via email** — ability to email a Q&A answer directly from the vault interface

### Projects
- **Bottom Q&A — data coverage** — update project Q&A to cover all data within the project section; recently added data types need connecting to the index
- **Bottom Q&A bug — contact vs drawings** — when asking about a contact (e.g. Ed/Jason), Q&A returns drawings instead; happens consistently for every question
- **Consultant dropdown** — add dropdown for selecting consultant info (client/company) when adding to a project; consultant records saved globally and reusable across projects
- **Programme tab** — new tab in project detail; tiled options for Client programme and Internal programme; each is a single PDF upload (replaceable); standard PDF viewer tools
- **U-Values tab** — upload SAPs PDF covering all U-values (multiple, replaceable); plus individual upload button per U-value row for individual calc PDFs (multiple per row)
- **Documents sub-categories** — sub-categorise project documents as External / Internal / Transmittals; upload button per category; search by name, type, and rough content
- **Products — multi-system** — ability to add a product to more than one system within project products
- **Todo list — email notifications** — email alerts for todo list items (assignee notifications, due date reminders etc.)

### New Functions
- **Schedule Compare** — upload two schedules, AI summarises differences, highlights changed cells, exports comparison as PDF
- **IFC Organiser** — batch drawing upload; create a register per supplier/contractor (drawing number, revision, title, status); LLM detects new vs duplicate vs updated drawings; drawings go into folders; user comments added to register; stamp editor (when applied, register updated); completed batches go to an 'Out' folder

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
