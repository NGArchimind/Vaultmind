# Schedule Tool — Design Spec
**Date:** 2026-05-26
**Status:** Approved

---

## Overview

A new "Schedule" tile replaces the "Coming Soon" placeholder in the Practice Management row on the home screen. It opens a standalone section containing two independent tools:

1. **PDF Compare** — upload two PDF schedules, AI extracts and compares the tables, results shown in-browser with a downloadable Excel
2. **CSV to Excel** — upload a Revit CSV export, generate a formatted Excel with the Archimind header style, compare against the most recent stored revision for that project + schedule type, download the highlighted output. Full revision history is stored, viewable, and deletable.

---

## 1. Home Screen Tile

**File changed:** `client/src/components/LandingPage.jsx`, `client/src/constants.js`

Add the Schedule tile to `PRACTICE_TILES`:

```js
{ id: "schedule", label: "Schedule", category: "Practice Management",
  washColor: SCHEDULE_WASH, fullColor: SCHEDULE_FULL,
  cta: "Open Schedule →",
  description: "Compare schedule revisions and generate formatted Excel outputs from Revit exports." }
```

New constants (add to `constants.js`):
```js
export const SCHEDULE_FULL = "#5c4a80";   // slate plum
export const SCHEDULE_WASH = "#9288a8";
```

Remove the "Coming Soon" dashed placeholder `<div>` from `LandingPage.jsx`.

---

## 2. Routing

**File changed:** `client/src/App.js`

Add `"schedule"` as a valid `appSection` value. Wire it to render `<ScheduleSection />` the same way other sections are wired (conditional render inside the main content area).

---

## 3. ScheduleSection Component

**New file:** `client/src/components/ScheduleSection.jsx`

### Layout
- Header strip in `SCHEDULE_FULL` with title "Schedule" — consistent with other sections
- Body: two side-by-side tool cards, each occupying 50% of the content width, separated by a gap
- Left card: **PDF Compare**
- Right card: **CSV to Excel**

Each card has:
- A card title (e.g. "PDF Compare") in `SCHEDULE_FULL`
- A brief subtitle
- Its own upload and action area

---

## 4. Tool 1 — PDF Compare

### Upload state
- Two upload zones side by side, labelled "Revision A (Previous)" and "Revision B (Current)"
- Each accepts PDF files only (drag-and-drop or click to browse)
- A ⇄ arrow between the two zones for visual clarity
- "Compare Schedules" button — disabled until both PDFs are uploaded

### Processing
- Client sends both PDFs as multipart form data to `POST /api/schedule/compare-pdfs`
- Server encodes both PDFs as base64 and sends them to Gemini as two document parts in a single prompt
- Gemini prompt instructs it to:
  - Extract the schedule table from each PDF (matching by the item Mark reference, e.g. W.01.02)
  - Return a JSON array of row diff objects

### Gemini response format
```json
[
  { "mark": "W.02.28", "status": "added", "fields": { "Type": {"new": "A-WT-E3A"}, "Width": {"new": "2400"} } },
  { "mark": "W.01.02", "status": "changed", "fields": { "Width": {"old": "1248", "new": "1350"} } },
  { "mark": "W.02.29", "status": "removed", "fields": { "Type": {"old": "A-WT-C3"} } },
  { "mark": "W.01.03", "status": "unchanged", "fields": {} }
]
```

### Results state (client)
- Summary bar: "X added", "X changed", "X removed" badges
- Filter toggle: "All" / "Changed only" (hides unchanged rows)
- Colour-coded table:
  - Green row + ✚ = added
  - Amber row + changed cells showing old value in brackets = changed
  - Red row + ✕ = removed
  - Faded/greyed = unchanged
- "Download Excel" button — calls `POST /api/schedule/compare-pdfs/excel` with the diff JSON, returns `.xlsx`

### Excel download (server)
- Generated with `exceljs`
- Same colour scheme as on-screen table (green/amber/red fills)
- Changed cells show `NEW_VALUE (was OLD_VALUE)` text
- No Archimind header block (PDF source is unknown — just the diff table)
- Filename: `Schedule_Compare.xlsx`

### Server endpoints
- `POST /api/schedule/compare-pdfs` — multipart, fields `pdfA` and `pdfB`
- `POST /api/schedule/compare-pdfs/excel` — JSON body `{ diff: [...] }`, returns xlsx binary

---

## 5. Tool 2 — CSV to Excel

### Upload state
Three inputs in sequence:

1. **Project** — dropdown populated from `GET /api/projects`. Required.
2. **Schedule Type** — dropdown populated from `GET /api/projects/:id/schedule-types` when a project is selected. Options are the types stored for that project, plus a divider and "+ Add new type for this project..." at the bottom. Types can be renamed or deleted via inline controls (pencil / trash icon next to each option). Required.
3. **CSV file** — upload zone, accepts `.csv` only.

"Generate Excel" button — disabled until all three are provided.

### Adding a new schedule type (inline)
When "+ Add new type for this project..." is selected, the schedule type dropdown is replaced with:
- A text input (placeholder: "e.g. Sanitary Ware Schedule")
- "Add" button → `POST /api/projects/:id/schedule-types` → on success, type is added to the dropdown and auto-selected
- "Cancel" link → reverts to dropdown

### Renaming / deleting a schedule type
Each schedule type in the dropdown has:
- A pencil icon — click to edit the name inline → `PATCH /api/projects/:id/schedule-types/:tid`
- A trash icon — click to confirm and delete → `DELETE /api/projects/:id/schedule-types/:tid` (cascades to all revisions for that type in DB and R2)

### Processing
Client sends `POST /api/schedule/csv-to-excel` with `projectId`, `scheduleTypeId`, and the CSV file.

Server:
1. Parse CSV (headers from first row, data from remaining rows)
2. Fetch project record from Supabase for the header block (name)
3. Query `project_schedule_revisions` for the most recent revision for this schedule type (ordered by `uploaded_at DESC`, limit 1)
4. If a previous revision exists: fetch its CSV from R2, parse it, build a diff map keyed by the first column (the Mark/item reference)
5. Generate Excel with `exceljs`:
   - **Header block** (rows 1–8, matching Archimind style):
     - Company name: "Architectural Design and Technology"
     - Job No. + Project name (from project record)
     - Date of this upload
     - Schedule type name
   - **Column headers** — taken directly from the CSV first row
   - **Data rows** — colour-coded:
     - Green fill (`#e8f5e9`) on entire row = new item
     - Yellow fill (`#fff8e1`) on individual cell = changed value
     - Red fill (`#ffebee`) on entire row = removed item (appended below active rows)
     - No fill = unchanged
6. Upload new CSV to R2 at key `schedules/{projectId}/{scheduleTypeId}/{timestamp}.csv`
7. Insert a new row into `project_schedule_revisions` (schedule_type_id, project_id, csv_key, row_count, uploaded_at)
8. Return Excel file as download

### Result state (client)
- Summary badges: "X added", "X changed", "X removed" (or "No previous revision — saved as baseline" on first upload)
- Download card showing filename and row count
- "⬇ Download" button
- Revision history panel (see below) refreshes to show the new entry at the top

### Revision history panel
Appears below the upload form whenever a project + schedule type is selected. Shows all stored revisions for that combination.

Each row shows:
- Upload date (formatted, e.g. "22 May 2026")
- Row count (e.g. "157 rows")
- A download icon — re-downloads the raw CSV for that revision from R2
- A delete icon — confirms then calls `DELETE /api/schedule-revisions/:rid`, removes DB record and R2 object

Empty state: "No revisions yet — upload a CSV to create the first one."

---

## 6. Database

Two new tables — run in Supabase before deploying:

```sql
CREATE TABLE IF NOT EXISTS project_schedule_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE project_schedule_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access" ON project_schedule_types USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS project_schedule_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_type_id uuid NOT NULL REFERENCES project_schedule_types(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  csv_key text NOT NULL,
  row_count int NOT NULL DEFAULT 0,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE project_schedule_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access" ON project_schedule_revisions USING (true) WITH CHECK (true);
```

Each CSV upload creates a new `project_schedule_revisions` row. The most recent row (by `uploaded_at`) is used as the baseline for the next comparison. Rows can be deleted individually; deleting a schedule type cascades to all its revisions.

---

## 7. Excel Generation — Implementation Note

The server is Node.js/Express. Use the `exceljs` npm package for Excel generation. It supports cell fills, fonts, column widths, and merged cells — sufficient for the Archimind header block and colour-coded data rows.

If not already installed: `npm install exceljs` in `server/`.

---

## 8. Server Endpoints — Full List

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:id/schedule-types` | List schedule types for a project |
| `POST` | `/api/projects/:id/schedule-types` | Create a new schedule type |
| `PATCH` | `/api/projects/:id/schedule-types/:tid` | Rename a schedule type |
| `DELETE` | `/api/projects/:id/schedule-types/:tid` | Delete a schedule type (cascades) |
| `GET` | `/api/schedule-types/:tid/revisions` | List all revisions for a schedule type |
| `DELETE` | `/api/schedule-revisions/:rid` | Delete a single revision (DB + R2) |
| `POST` | `/api/schedule/csv-to-excel` | Upload CSV, generate Excel, store revision |
| `POST` | `/api/schedule/compare-pdfs` | Compare two PDF schedules via Gemini |
| `POST` | `/api/schedule/compare-pdfs/excel` | Generate Excel from a diff JSON payload |

All endpoints use `requireAuth` middleware.

---

## 9. Files Changed / Created

| File | Change |
|------|--------|
| `client/src/constants.js` | Add `SCHEDULE_FULL`, `SCHEDULE_WASH` |
| `client/src/components/LandingPage.jsx` | Add Schedule to `PRACTICE_TILES`, remove Coming Soon placeholder, import new constants |
| `client/src/App.js` | Add `"schedule"` routing case, import `ScheduleSection` |
| `client/src/components/ScheduleSection.jsx` | **New** — full Schedule section with both tools |
| `server/index.js` | Add 9 new endpoints |

---

## 10. Out of Scope

- Emailing the Excel output
- PDF Compare working across PDFs with different schedule types (behaviour undefined — Gemini will do its best)
- Comparing against an older revision other than the most recent (comparison always uses latest)
