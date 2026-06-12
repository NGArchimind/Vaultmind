# Schedule Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Schedule tile to the home screen with two tools — PDF Compare (AI diff of two schedule PDFs) and CSV to Excel (Revit CSV → formatted Excel with revision history per project).

**Architecture:** Standalone section (`ScheduleSection.jsx`) with two side-by-side sub-components. Server adds 10 new endpoints to `server/index.js`. `ExcelJS` and `streamToBuffer` are already available. All file content is sent as base64/text in JSON bodies (no multer — consistent with existing patterns).

**Tech Stack:** React (CRA), Express/Node.js, Supabase (PostgreSQL), Cloudflare R2, Google Gemini API, ExcelJS (already installed)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `client/src/constants.js` | Modify | Add `SCHEDULE_FULL`, `SCHEDULE_WASH` |
| `client/src/components/LandingPage.jsx` | Modify | Replace Coming Soon with Schedule tile |
| `client/src/App.js` | Modify | Add `"schedule"` routing case |
| `client/src/api/client.js` | Modify | Add `apiBlob()` helper for binary downloads |
| `client/src/components/ScheduleSection.jsx` | Create | Section shell — header strip + two cards |
| `client/src/components/SchedulePdfCompare.jsx` | Create | PDF Compare tool |
| `client/src/components/ScheduleCsvExcel.jsx` | Create | CSV to Excel tool |
| `server/index.js` | Modify | Add 10 new endpoints (before the catch-all 404) |

---

## Task 1: SQL Migration

**Files:** Supabase SQL editor

- [ ] **Step 1: Run migration in Supabase**

Open the Supabase SQL editor for the project and run:

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

- [ ] **Step 2: Verify tables exist**

In the Supabase Table Editor, confirm both `project_schedule_types` and `project_schedule_revisions` appear with the correct columns.

---

## Task 2: Constants, Tile & Routing

**Files:**
- Modify: `client/src/constants.js`
- Modify: `client/src/components/LandingPage.jsx`
- Modify: `client/src/App.js`

- [ ] **Step 1: Add colours to constants.js**

After the `TIMESHEETS_WASH` line, add:

```js
export const SCHEDULE_FULL = "#5c4a80";
export const SCHEDULE_WASH = "#9288a8";
```

- [ ] **Step 2: Update LandingPage.jsx imports**

Change the import at the top to include the new constants:

```js
import {
  DESIGN_GROUND, DESIGN_MUTED,
  DESIGN_PLACEHOLDER_BORDER, DESIGN_PLACEHOLDER_TEXT,
  VAULT_FULL, VAULT_WASH,
  COMPARE_FULL, COMPARE_WASH,
  LIBRARY_FULL, LIBRARY_WASH,
  PROJECTS_FULL, PROJECTS_WASH,
  TIMESHEETS_FULL, TIMESHEETS_WASH,
  SCHEDULE_FULL, SCHEDULE_WASH,
} from "../constants";
```

- [ ] **Step 3: Add Schedule to PRACTICE_TILES**

Replace the entire `PRACTICE_TILES` array:

```js
const PRACTICE_TILES = [
  { id: "projects",   label: "Projects",   category: "Practice Management", washColor: PROJECTS_WASH,   fullColor: PROJECTS_FULL,   cta: "Open Projects →",   description: "Manage projects, tasks, drawing reviews, and client email correspondence in one place." },
  { id: "timesheets", label: "Timesheets", category: "Practice Management", washColor: TIMESHEETS_WASH, fullColor: TIMESHEETS_FULL, cta: "Open Timesheets →", description: "Log time against projects, track fees, and monitor budget against programme across the practice." },
  { id: "schedule",   label: "Schedule",   category: "Practice Management", washColor: SCHEDULE_WASH,   fullColor: SCHEDULE_FULL,   cta: "Open Schedule →",  description: "Compare schedule revisions and generate formatted Excel outputs from Revit exports." },
];
```

- [ ] **Step 4: Remove the Coming Soon placeholder**

In `LandingPage.jsx`, delete the entire `{/* Coming soon placeholder */}` block:

```jsx
{/* DELETE this entire block — from the comment down to and including the closing </div> */}
{/* Coming soon placeholder */}
<div
  style={{
    flex: 1,
    background: DESIGN_GROUND,
    border: `1px dashed ${DESIGN_PLACEHOLDER_BORDER}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 180,
  }}
>
  <span
    style={{
      fontSize: 8,
      fontWeight: 500,
      color: DESIGN_PLACEHOLDER_TEXT,
      letterSpacing: ".18em",
      textTransform: "uppercase",
    }}
  >
    Coming soon
  </span>
</div>
```

- [ ] **Step 5: Wire routing in App.js**

Find where other sections are imported (near the top of App.js) and add:

```js
import ScheduleSection from "./components/ScheduleSection";
```

Then find where other sections are conditionally rendered (search for `appSection === "vault"` to find the pattern) and add the schedule case in the same style. For example, if the pattern is:

```jsx
{appSection === "timesheets" && <TimesheetsSection ... />}
```

Add immediately after it:

```jsx
{appSection === "schedule" && <ScheduleSection />}
```

- [ ] **Step 6: Commit**

```
git add client/src/constants.js client/src/components/LandingPage.jsx client/src/App.js
git commit -m "feat: add Schedule tile to landing page and routing"
```

---

## Task 3: apiBlob helper + ScheduleSection skeleton

**Files:**
- Modify: `client/src/api/client.js`
- Create: `client/src/components/ScheduleSection.jsx`

- [ ] **Step 1: Add apiBlob to client.js**

At the end of `client/src/api/client.js`, add:

```js
// ── Binary download helper ────────────────────────────────────────────────────
// Like api() but returns the raw Response instead of parsing JSON.
// Use for endpoints that return binary files (Excel, CSV).
// method defaults to POST. Pass body=null for GET requests.
export async function apiBlob(path, body = null, method = "POST") {
  const token = await getAuthToken();
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== null) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res; // caller reads .blob() and .headers
}
```

- [ ] **Step 2: Create ScheduleSection.jsx**

Create `client/src/components/ScheduleSection.jsx`:

```jsx
import { SCHEDULE_FULL, DESIGN_GROUND } from "../constants";
import SchedulePdfCompare from "./SchedulePdfCompare";
import ScheduleCsvExcel from "./ScheduleCsvExcel";

export default function ScheduleSection() {
  return (
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      background: DESIGN_GROUND,
      overflowY: "auto",
      fontFamily: "Inter, Arial, sans-serif",
    }}>
      {/* Header strip */}
      <div style={{ background: SCHEDULE_FULL, padding: "14px 32px", flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: "#fff", letterSpacing: ".04em" }}>
          Schedule
        </span>
      </div>

      {/* Two tool cards */}
      <div style={{ padding: 32, display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SchedulePdfCompare />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ScheduleCsvExcel />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create placeholder SchedulePdfCompare.jsx**

Create `client/src/components/SchedulePdfCompare.jsx` with a stub so App.js compiles:

```jsx
import { SCHEDULE_FULL } from "../constants";

export default function SchedulePdfCompare() {
  return (
    <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 4, overflow: "hidden", fontFamily: "Inter, Arial, sans-serif" }}>
      <div style={{ background: SCHEDULE_FULL, padding: "10px 14px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", letterSpacing: ".04em" }}>PDF Compare</div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.65)", marginTop: 2 }}>Upload two PDF schedules to compare revisions</div>
      </div>
      <div style={{ padding: 16, fontSize: 11, color: "#9a9aa0" }}>Coming soon…</div>
    </div>
  );
}
```

- [ ] **Step 4: Create placeholder ScheduleCsvExcel.jsx**

Create `client/src/components/ScheduleCsvExcel.jsx`:

```jsx
import { SCHEDULE_FULL } from "../constants";

export default function ScheduleCsvExcel() {
  return (
    <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 4, overflow: "hidden", fontFamily: "Inter, Arial, sans-serif" }}>
      <div style={{ background: SCHEDULE_FULL, padding: "10px 14px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", letterSpacing: ".04em" }}>CSV to Excel</div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.65)", marginTop: 2 }}>Import a Revit schedule export and generate a formatted Excel</div>
      </div>
      <div style={{ padding: 16, fontSize: 11, color: "#9a9aa0" }}>Coming soon…</div>
    </div>
  );
}
```

- [ ] **Step 5: Verify app compiles**

Run `npm start` in `client/`. Open the app, click the Schedule tile. You should see the plum header strip and two placeholder cards side by side. Fix any import errors before continuing.

- [ ] **Step 6: Commit**

```
git add client/src/api/client.js client/src/components/ScheduleSection.jsx client/src/components/SchedulePdfCompare.jsx client/src/components/ScheduleCsvExcel.jsx
git commit -m "feat: schedule section skeleton with placeholder tool cards"
```

---

## Task 4: Server — Schedule Types CRUD

**Files:**
- Modify: `server/index.js` (add before the catch-all `app.get("*", ...)` near the end of the file)

- [ ] **Step 1: Add a CSV parser helper**

Near the top of the new server block (before the endpoints), add this helper function. Place it near the other helper functions (around line 87):

```js
// ── CSV parser (handles quoted fields with embedded commas) ───────────────────
function parseCsvText(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  return lines.filter(l => l.trim()).map(line => {
    const fields = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        fields.push(field.trim());
        field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field.trim());
    return fields;
  });
}
```

- [ ] **Step 2: Add schedule types endpoints**

Add the following four endpoints to `server/index.js` just before `app.get("*", ...)`:

```js
// ── Schedule Types ─────────────────────────────────────────────────────────────

app.get("/api/projects/:id/schedule-types", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("project_schedule_types")
    .select("id, name, created_at")
    .eq("project_id", req.params.id)
    .order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post("/api/projects/:id/schedule-types", requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  const { data, error } = await supabase
    .from("project_schedule_types")
    .insert({ project_id: req.params.id, name: name.trim() })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

app.patch("/api/projects/:id/schedule-types/:tid", requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  const { data, error } = await supabase
    .from("project_schedule_types")
    .update({ name: name.trim() })
    .eq("id", req.params.tid)
    .eq("project_id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "not found" });
  res.json(data);
});

app.delete("/api/projects/:id/schedule-types/:tid", requireAuth, async (req, res) => {
  // Fetch all revision CSV keys before cascade delete
  const { data: revisions } = await supabase
    .from("project_schedule_revisions")
    .select("csv_key")
    .eq("schedule_type_id", req.params.tid);
  // Delete R2 objects (best-effort — don't fail if a key is missing)
  for (const rev of (revisions || [])) {
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: rev.csv_key })).catch(() => {});
  }
  // Delete from DB — cascades to project_schedule_revisions
  const { error } = await supabase
    .from("project_schedule_types")
    .delete()
    .eq("id", req.params.tid)
    .eq("project_id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});
```

- [ ] **Step 3: Verify with curl**

Start the server locally (`npm start` in `server/`) then test:

```bash
# Replace TOKEN with a valid JWT from your browser's dev tools (Application → Local Storage → supabase token)
# Replace PROJECT_ID with a real project ID from Supabase

# Create a type
curl -X POST http://localhost:3001/api/projects/PROJECT_ID/schedule-types \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Window & Door Schedule"}'
# Expected: {"id":"...","project_id":"...","name":"Window & Door Schedule","created_at":"..."}

# List types
curl http://localhost:3001/api/projects/PROJECT_ID/schedule-types \
  -H "Authorization: Bearer TOKEN"
# Expected: [{"id":"...","name":"Window & Door Schedule",...}]
```

- [ ] **Step 4: Commit**

```
git add server/index.js
git commit -m "feat: schedule types CRUD endpoints"
```

---

## Task 5: Server — Revisions CRUD

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add revisions endpoints**

Add these three endpoints in `server/index.js` after the schedule types block:

```js
// ── Schedule Revisions ─────────────────────────────────────────────────────────

app.get("/api/schedule-types/:tid/revisions", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("project_schedule_revisions")
    .select("id, csv_key, row_count, uploaded_at")
    .eq("schedule_type_id", req.params.tid)
    .order("uploaded_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.delete("/api/schedule-revisions/:rid", requireAuth, async (req, res) => {
  const { data: rev } = await supabase
    .from("project_schedule_revisions")
    .select("csv_key")
    .eq("id", req.params.rid)
    .single();
  if (!rev) return res.status(404).json({ error: "not found" });
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: rev.csv_key })).catch(() => {});
  const { error } = await supabase
    .from("project_schedule_revisions")
    .delete()
    .eq("id", req.params.rid);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.get("/api/schedule-revisions/:rid/csv", requireAuth, async (req, res) => {
  const { data: rev } = await supabase
    .from("project_schedule_revisions")
    .select("csv_key")
    .eq("id", req.params.rid)
    .single();
  if (!rev) return res.status(404).json({ error: "not found" });
  const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: rev.csv_key }));
  const buffer = await streamToBuffer(obj.Body);
  res.set({
    "Content-Type": "text/csv",
    "Content-Disposition": `attachment; filename="revision.csv"`,
  });
  res.send(buffer);
});
```

- [ ] **Step 2: Commit**

```
git add server/index.js
git commit -m "feat: schedule revisions list/delete/download endpoints"
```

---

## Task 6: Server — CSV to Excel endpoint

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add the endpoint**

Add after the revisions block:

```js
// ── CSV to Excel ───────────────────────────────────────────────────────────────

app.post("/api/schedule/csv-to-excel", requireAuth, async (req, res) => {
  const { projectId, scheduleTypeId, csvText } = req.body;
  if (!projectId || !scheduleTypeId || !csvText) {
    return res.status(400).json({ error: "projectId, scheduleTypeId and csvText required" });
  }

  const allRows = parseCsvText(csvText);
  if (allRows.length < 2) return res.status(400).json({ error: "CSV must have a header row and at least one data row" });
  const headers = allRows[0];
  const dataRows = allRows.slice(1);

  const [{ data: project }, { data: schedType }] = await Promise.all([
    supabase.from("projects").select("name").eq("id", projectId).single(),
    supabase.from("project_schedule_types").select("name").eq("id", scheduleTypeId).single(),
  ]);

  // Get most recent previous revision
  const { data: prevRevisions } = await supabase
    .from("project_schedule_revisions")
    .select("id, csv_key")
    .eq("schedule_type_id", scheduleTypeId)
    .order("uploaded_at", { ascending: false })
    .limit(1);

  // Build diff map — mark → { status, changedCols: Set<colIndex> }
  const diffMap = {};
  let prevDataRows = [];

  if (prevRevisions?.length > 0) {
    const prevObj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: prevRevisions[0].csv_key }));
    const prevBuffer = await streamToBuffer(prevObj.Body);
    const prevAllRows = parseCsvText(prevBuffer.toString("utf8"));
    prevDataRows = prevAllRows.slice(1);

    const prevByMark = {};
    prevDataRows.forEach(row => { if (row[0]) prevByMark[row[0]] = row; });
    const newByMark = {};
    dataRows.forEach(row => { if (row[0]) newByMark[row[0]] = row; });

    dataRows.forEach(row => {
      const mark = row[0]; if (!mark) return;
      if (!prevByMark[mark]) {
        diffMap[mark] = { status: "added", changedCols: new Set() };
      } else {
        const changed = new Set();
        headers.forEach((_, i) => {
          if ((row[i] || "") !== (prevByMark[mark][i] || "")) changed.add(i);
        });
        if (changed.size > 0) diffMap[mark] = { status: "changed", changedCols: changed };
      }
    });
    prevDataRows.forEach(row => {
      const mark = row[0]; if (!mark) return;
      if (!newByMark[mark]) diffMap[mark] = { status: "removed", changedCols: new Set() };
    });
  }

  const added   = Object.values(diffMap).filter(d => d.status === "added").length;
  const changed = Object.values(diffMap).filter(d => d.status === "changed").length;
  const removed = Object.values(diffMap).filter(d => d.status === "removed").length;

  // Generate Excel
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Schedule");
  const colCount = headers.length;

  // Header block
  ws.mergeCells(1, 1, 1, colCount);
  ws.getCell("A1").value = "Architectural Design and Technology";
  ws.getCell("A1").font = { bold: true, size: 14, name: "Arial" };

  ws.getCell("A3").value = "Project:";      ws.getCell("A3").font = { bold: true, name: "Arial", size: 10 };
  ws.getCell("B3").value = project?.name || "";
  ws.mergeCells(3, 2, 3, colCount);

  ws.getCell("A4").value = "Schedule Type:"; ws.getCell("A4").font = { bold: true, name: "Arial", size: 10 };
  ws.getCell("B4").value = schedType?.name || "";
  ws.mergeCells(4, 2, 4, colCount);

  ws.getCell("A5").value = "Date:";          ws.getCell("A5").font = { bold: true, name: "Arial", size: 10 };
  ws.getCell("B5").value = new Date().toLocaleDateString("en-GB");
  ws.mergeCells(5, 2, 5, colCount);

  ws.getCell("A6").value = prevRevisions?.length > 0 ? "Changes:" : "Note:";
  ws.getCell("A6").font = { bold: true, name: "Arial", size: 10 };
  ws.getCell("B6").value = prevRevisions?.length > 0
    ? `${added} added, ${changed} changed, ${removed} removed`
    : "First revision — saved as baseline";
  ws.mergeCells(6, 2, 6, colCount);

  // Column headers — row 9
  const headerRow = ws.getRow(9);
  headerRow.height = 20;
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, name: "Arial", size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E0F0" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FF5C4A80" } } };
  });

  // Data rows
  const FILL_ADDED   = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F5E9" } };
  const FILL_CHANGED = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8E1" } };
  const FILL_REMOVED = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEBEE" } };
  let rowIdx = 10;

  dataRows.forEach(row => {
    const mark = row[0];
    const diff = diffMap[mark];
    const wsRow = ws.getRow(rowIdx++);
    headers.forEach((_, i) => {
      const cell = wsRow.getCell(i + 1);
      cell.value = row[i] || "";
      cell.font = { name: "Arial", size: 9 };
      cell.alignment = { horizontal: "left", vertical: "middle" };
      if (diff?.status === "added") cell.fill = FILL_ADDED;
      else if (diff?.status === "changed" && diff.changedCols.has(i)) cell.fill = FILL_CHANGED;
    });
  });

  // Removed rows appended at bottom
  prevDataRows.forEach(row => {
    if (diffMap[row[0]]?.status !== "removed") return;
    const wsRow = ws.getRow(rowIdx++);
    headers.forEach((_, i) => {
      const cell = wsRow.getCell(i + 1);
      cell.value = row[i] || "";
      cell.font = { name: "Arial", size: 9, color: { argb: "FFC62828" }, italic: true };
      cell.fill = FILL_REMOVED;
      cell.alignment = { horizontal: "left", vertical: "middle" };
    });
  });

  // Column widths
  headers.forEach((h, i) => {
    ws.getColumn(i + 1).width = Math.max((h || "").length + 4, 14);
  });

  const excelBuffer = await wb.xlsx.writeBuffer();

  // Upload new CSV to R2
  const csvKey = `schedules/${projectId}/${scheduleTypeId}/${Date.now()}.csv`;
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: csvKey,
    Body: Buffer.from(csvText, "utf8"),
    ContentType: "text/csv",
  }));

  // Record revision
  await supabase.from("project_schedule_revisions").insert({
    schedule_type_id: scheduleTypeId,
    project_id: projectId,
    csv_key: csvKey,
    row_count: dataRows.length,
  });

  const safeName = (schedType?.name || "Schedule").replace(/[^a-z0-9 .\-]/gi, "_");
  res.set({
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${safeName}.xlsx"`,
    "X-Schedule-Added":   String(added),
    "X-Schedule-Changed": String(changed),
    "X-Schedule-Removed": String(removed),
    "X-Schedule-Rows":    String(dataRows.length),
  });
  res.send(Buffer.from(excelBuffer));
});
```

- [ ] **Step 2: Commit**

```
git add server/index.js
git commit -m "feat: CSV to Excel generation endpoint with diff highlighting"
```

---

## Task 7: Server — PDF Compare endpoints

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add the two PDF compare endpoints**

Add after the CSV to Excel block:

```js
// ── PDF Schedule Compare ───────────────────────────────────────────────────────

app.post("/api/schedule/compare-pdfs", requireAuth, async (req, res) => {
  const { pdfABase64, pdfBBase64 } = req.body;
  if (!pdfABase64 || !pdfBBase64) return res.status(400).json({ error: "pdfABase64 and pdfBBase64 required" });

  const prompt = `You are comparing two architectural schedule PDFs. PDF A is the previous revision. PDF B is the current revision.

Extract the schedule table from each PDF. Each row has a unique item Mark reference (e.g. W.01.01, D.02.03).

Compare row by row, matching by Mark reference. Return ONLY a JSON array — no markdown, no explanation:

[
  { "mark": "W.01.02", "status": "changed", "fields": { "Width": { "old": "1248", "new": "1350" } } },
  { "mark": "W.02.28", "status": "added",   "fields": { "Type": { "new": "A-WT-E3A" }, "Width": { "new": "2400" } } },
  { "mark": "W.02.29", "status": "removed",  "fields": { "Type": { "old": "A-WT-C3" } } },
  { "mark": "W.01.03", "status": "unchanged","fields": {} }
]

Rules:
- "added" = mark in PDF B only
- "removed" = mark in PDF A only
- "changed" = mark in both, at least one field differs — include ONLY the changed fields
- "unchanged" = mark in both, all values identical
- Include ALL rows from both PDFs
- Return ONLY the JSON array`;

  const response = await fetch(
    `${GEMINI_BASE}/gemini-2.5-flash:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: "application/pdf", data: pdfABase64 } },
          { inline_data: { mime_type: "application/pdf", data: pdfBBase64 } },
          { text: prompt },
        ]}],
        generationConfig: { temperature: 0 },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    return res.status(500).json({ error: `Gemini error: ${err.slice(0, 200)}` });
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return res.status(500).json({ error: "Gemini did not return a JSON array" });

  let diff;
  try { diff = JSON.parse(jsonMatch[0]); }
  catch { return res.status(500).json({ error: "Could not parse Gemini response as JSON" }); }

  res.json({ diff });
});

app.post("/api/schedule/compare-pdfs/excel", requireAuth, async (req, res) => {
  const { diff } = req.body;
  if (!Array.isArray(diff)) return res.status(400).json({ error: "diff array required" });

  // Collect all field names across the diff
  const colSet = new Set();
  diff.forEach(row => Object.keys(row.fields || {}).forEach(k => colSet.add(k)));
  const fieldCols = Array.from(colSet);
  const allCols = ["Mark", ...fieldCols, "Status"];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Compare");

  // Header row
  allCols.forEach((col, i) => {
    const cell = ws.getRow(1).getCell(i + 1);
    cell.value = col;
    cell.font = { bold: true, name: "Arial", size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E0F0" } };
    cell.border = { bottom: { style: "thin" } };
  });

  const FILLS = {
    added:     { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F5E9" } },
    changed:   { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8E1" } },
    removed:   { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEBEE" } },
    unchanged: null,
  };

  diff.forEach((row, idx) => {
    const wsRow = ws.getRow(idx + 2);
    const fill = FILLS[row.status];

    allCols.forEach((col, i) => {
      const cell = wsRow.getCell(i + 1);
      cell.font = { name: "Arial", size: 9 };
      if (fill) cell.fill = fill;

      if (col === "Mark") {
        cell.value = row.mark;
      } else if (col === "Status") {
        cell.value = row.status.charAt(0).toUpperCase() + row.status.slice(1);
      } else {
        const field = row.fields?.[col];
        if (!field) { cell.value = ""; return; }
        if (row.status === "changed" && field.old !== undefined && field.new !== undefined) {
          cell.value = `${field.new} (was ${field.old})`;
        } else {
          cell.value = field.new ?? field.old ?? "";
        }
      }
    });
  });

  allCols.forEach((col, i) => {
    ws.getColumn(i + 1).width = col === "Mark" || col === "Status" ? 12 : 22;
  });

  const buf = await wb.xlsx.writeBuffer();
  res.set({
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": 'attachment; filename="Schedule_Compare.xlsx"',
  });
  res.send(Buffer.from(buf));
});
```

- [ ] **Step 2: Commit**

```
git add server/index.js
git commit -m "feat: PDF schedule compare endpoints using Gemini"
```

---

## Task 8: SchedulePdfCompare.jsx — full implementation

**Files:**
- Modify: `client/src/components/SchedulePdfCompare.jsx`

- [ ] **Step 1: Replace the placeholder with the full component**

Replace the entire contents of `client/src/components/SchedulePdfCompare.jsx`:

```jsx
import { useState, useRef } from "react";
import { api, apiBlob, fileToBase64 } from "../api/client";
import { SCHEDULE_FULL } from "../constants";

const STATUS_ROW_STYLE = {
  added:     { background: "#e8f5e9" },
  changed:   { background: "#fff8e1" },
  removed:   { background: "#ffebee" },
  unchanged: { background: "#fff", opacity: 0.65 },
};

export default function SchedulePdfCompare() {
  const [pdfA, setPdfA] = useState(null);      // { name, base64 }
  const [pdfB, setPdfB] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [diff, setDiff] = useState(null);
  const [filter, setFilter] = useState("all"); // "all" | "changed"
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const refA = useRef();
  const refB = useRef();

  async function handleFile(file, setter) {
    if (!file?.type?.includes("pdf")) return;
    const base64 = await fileToBase64(file);
    setter({ name: file.name, base64 });
  }

  async function compare() {
    if (!pdfA || !pdfB) return;
    setComparing(true); setError(""); setDiff(null);
    try {
      const { diff: d } = await api("/api/schedule/compare-pdfs", {
        method: "POST",
        body: { pdfABase64: pdfA.base64, pdfBBase64: pdfB.base64 },
      });
      setDiff(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setComparing(false);
    }
  }

  async function downloadExcel() {
    if (!diff) return;
    setDownloading(true);
    try {
      const res = await apiBlob("/api/schedule/compare-pdfs/excel", { diff });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "Schedule_Compare.xlsx"; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setDownloading(false);
    }
  }

  function reset() {
    setDiff(null); setPdfA(null); setPdfB(null); setFilter("all"); setError("");
  }

  const visible = diff
    ? (filter === "changed" ? diff.filter(r => r.status !== "unchanged") : diff)
    : [];

  const summary = diff && {
    added:   diff.filter(r => r.status === "added").length,
    changed: diff.filter(r => r.status === "changed").length,
    removed: diff.filter(r => r.status === "removed").length,
  };

  // All field column names, preserving order of first appearance
  const fieldCols = diff
    ? Array.from(new Set(diff.flatMap(r => Object.keys(r.fields || {}))))
    : [];

  return (
    <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 4, overflow: "hidden", fontFamily: "Inter, Arial, sans-serif" }}>
      {/* Card header */}
      <div style={{ background: SCHEDULE_FULL, padding: "10px 14px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", letterSpacing: ".04em" }}>PDF Compare</div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.65)", marginTop: 2 }}>Upload two PDF schedules to compare revisions</div>
      </div>

      <div style={{ padding: 16 }}>

        {/* ── Upload state ── */}
        {!diff && (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
              {[
                { label: "Revision A (Previous)", val: pdfA, set: setPdfA, ref: refA },
                { label: "Revision B (Current)",  val: pdfB, set: setPdfB, ref: refB },
              ].map(({ label, val, set, ref }, idx) => (
                <div key={idx} style={{ flex: 1 }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: SCHEDULE_FULL, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 5 }}>{label}</div>
                  <div
                    onClick={() => ref.current.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0], set); }}
                    style={{ border: `2px dashed ${val ? SCHEDULE_FULL : "#c8b8e8"}`, borderRadius: 4, padding: "18px 12px", textAlign: "center", background: "#faf8ff", cursor: "pointer" }}
                  >
                    <div style={{ fontSize: 22, marginBottom: 4 }}>📄</div>
                    <div style={{ fontSize: 9, color: val ? "#444" : "#9a9aa0", wordBreak: "break-all" }}>{val ? val.name : "Drop PDF or click to browse"}</div>
                    {val && (
                      <div
                        style={{ fontSize: 8, color: SCHEDULE_FULL, marginTop: 4, cursor: "pointer" }}
                        onClick={e => { e.stopPropagation(); set(null); }}
                      >✕ Remove</div>
                    )}
                  </div>
                  <input ref={ref} type="file" accept="application/pdf" style={{ display: "none" }}
                    onChange={e => handleFile(e.target.files[0], set)} />
                </div>
              ))}
            </div>

            {error && <div style={{ fontSize: 10, color: "#c62828", marginBottom: 8 }}>{error}</div>}

            <div style={{ textAlign: "right" }}>
              <button
                onClick={compare}
                disabled={!pdfA || !pdfB || comparing}
                style={{
                  background: pdfA && pdfB && !comparing ? SCHEDULE_FULL : "#d0c8e0",
                  color: "#fff", border: "none", padding: "7px 18px", borderRadius: 3,
                  fontSize: 10, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase",
                  cursor: pdfA && pdfB && !comparing ? "pointer" : "default",
                }}
              >
                {comparing ? "Comparing…" : "Compare Schedules"}
              </button>
            </div>
          </>
        )}

        {/* ── Results state ── */}
        {diff && (
          <>
            {/* Summary + controls */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 9, background: "#e8f5e9", color: "#2e7d32", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{summary.added} added</span>
              <span style={{ fontSize: 9, background: "#fff8e1", color: "#e65100", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{summary.changed} changed</span>
              <span style={{ fontSize: 9, background: "#ffebee", color: "#c62828", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{summary.removed} removed</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                {["all", "changed"].map(f => (
                  <button key={f} onClick={() => setFilter(f)} style={{
                    fontSize: 9, padding: "4px 10px",
                    border: `1px solid ${filter === f ? SCHEDULE_FULL : "#e0e0e0"}`,
                    color: filter === f ? SCHEDULE_FULL : "#888",
                    borderRadius: 3, background: "#fff", cursor: "pointer",
                    fontWeight: filter === f ? 600 : 400,
                  }}>{f === "all" ? "All" : "Changed only"}</button>
                ))}
                <button
                  onClick={downloadExcel}
                  disabled={downloading}
                  style={{ background: SCHEDULE_FULL, color: "#fff", border: "none", padding: "5px 12px", borderRadius: 3, fontSize: 9, fontWeight: 600, cursor: "pointer" }}
                >{downloading ? "Downloading…" : "⬇ Download Excel"}</button>
                <button
                  onClick={reset}
                  style={{ background: "#fff", color: SCHEDULE_FULL, border: `1px solid ${SCHEDULE_FULL}`, padding: "5px 10px", borderRadius: 3, fontSize: 9, cursor: "pointer" }}
                >New Compare</button>
              </div>
            </div>

            {error && <div style={{ fontSize: 10, color: "#c62828", marginBottom: 8 }}>{error}</div>}

            {/* Diff table */}
            <div style={{ overflowX: "auto", border: "1px solid #e8e0f0", borderRadius: 3, maxHeight: 480, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9 }}>
                <thead style={{ position: "sticky", top: 0 }}>
                  <tr style={{ background: "#f5f3fa" }}>
                    <th style={{ padding: "6px 8px", textAlign: "left", color: SCHEDULE_FULL, fontWeight: 600, borderBottom: "1px solid #e8e0f0", whiteSpace: "nowrap" }}>Mark</th>
                    {fieldCols.map(col => (
                      <th key={col} style={{ padding: "6px 8px", textAlign: "left", color: SCHEDULE_FULL, fontWeight: 600, borderBottom: "1px solid #e8e0f0", whiteSpace: "nowrap" }}>{col}</th>
                    ))}
                    <th style={{ padding: "6px 8px", color: SCHEDULE_FULL, fontWeight: 600, borderBottom: "1px solid #e8e0f0" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f0ecf8", ...STATUS_ROW_STYLE[row.status] }}>
                      <td style={{ padding: "5px 8px", fontWeight: 600, color: row.status === "removed" ? "#c62828" : "#333" }}>{row.mark}</td>
                      {fieldCols.map(col => {
                        const field = row.fields?.[col];
                        const isChanged = row.status === "changed" && field?.old !== undefined && field?.new !== undefined;
                        return (
                          <td key={col} style={{ padding: "5px 8px", color: row.status === "removed" ? "#c62828" : row.status === "unchanged" ? "#aaa" : "#333" }}>
                            {field ? (field.new ?? field.old ?? "") : ""}
                            {isChanged && <span style={{ color: "#888", marginLeft: 4 }}>(was {field.old})</span>}
                          </td>
                        );
                      })}
                      <td style={{ padding: "5px 8px" }}>
                        <span style={{
                          fontSize: 8, padding: "1px 6px", borderRadius: 2, fontWeight: 600,
                          background: row.status === "added" ? "#2e7d32" : row.status === "changed" ? "#e65100" : row.status === "removed" ? "#c62828" : "#e0e0e0",
                          color: row.status === "unchanged" ? "#888" : "#fff",
                        }}>
                          {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Smoke test**

Open the Schedule section. The PDF Compare card should render correctly. Upload two small schedule PDFs and click Compare. The diff table should appear. Click "Download Excel" and verify the file downloads.

- [ ] **Step 3: Commit**

```
git add client/src/components/SchedulePdfCompare.jsx
git commit -m "feat: PDF Compare tool — upload, Gemini diff, results table, Excel download"
```

---

## Task 9: ScheduleCsvExcel.jsx — full implementation

**Files:**
- Modify: `client/src/components/ScheduleCsvExcel.jsx`

- [ ] **Step 1: Check what /api/projects returns**

Before writing the component, verify the response shape of the existing projects endpoint. In browser dev tools (Network tab), look for the `/api/projects` call made by the Projects section. Note the field names — likely `id` and `name`. If the endpoint returns `{ projects: [...] }` rather than an array, adjust the `setProjects` line in the component accordingly.

- [ ] **Step 2: Replace the placeholder with the full component**

Replace the entire contents of `client/src/components/ScheduleCsvExcel.jsx`:

```jsx
import { useState, useEffect, useRef } from "react";
import { api, apiBlob } from "../api/client";
import { SCHEDULE_FULL } from "../constants";

export default function ScheduleCsvExcel() {
  const [projects,       setProjects]       = useState([]);
  const [projectId,      setProjectId]      = useState("");
  const [scheduleTypes,  setScheduleTypes]  = useState([]);
  const [typeId,         setTypeId]         = useState("");
  const [csvFile,        setCsvFile]        = useState(null);  // { name, text }
  const [generating,     setGenerating]     = useState(false);
  const [result,         setResult]         = useState(null);
  const [error,          setError]          = useState("");
  const [revisions,      setRevisions]      = useState([]);
  const [loadingRevs,    setLoadingRevs]    = useState(false);
  const [addingType,     setAddingType]     = useState(false);
  const [newTypeName,    setNewTypeName]    = useState("");
  const [savingType,     setSavingType]     = useState(false);
  const [editingTypeId,  setEditingTypeId]  = useState(null);
  const [editName,       setEditName]       = useState("");
  const [lastBlob,       setLastBlob]       = useState(null);
  const [lastFilename,   setLastFilename]   = useState("");
  const csvRef = useRef();

  // Load projects once
  useEffect(() => {
    api("/api/projects")
      .then(d => setProjects(Array.isArray(d) ? d : (d.projects || [])))
      .catch(() => {});
  }, []);

  // Load schedule types when project changes
  useEffect(() => {
    if (!projectId) { setScheduleTypes([]); setTypeId(""); return; }
    api(`/api/projects/${projectId}/schedule-types`).then(setScheduleTypes).catch(() => {});
  }, [projectId]);

  // Load revisions when type changes
  useEffect(() => {
    if (!typeId) { setRevisions([]); return; }
    setLoadingRevs(true);
    api(`/api/schedule-types/${typeId}/revisions`)
      .then(setRevisions).catch(() => {}).finally(() => setLoadingRevs(false));
  }, [typeId]);

  async function handleCsvFile(file) {
    if (!file?.name?.endsWith(".csv")) return;
    const text = await file.text();
    setCsvFile({ name: file.name, text });
  }

  async function addType() {
    if (!newTypeName.trim()) return;
    setSavingType(true);
    try {
      const t = await api(`/api/projects/${projectId}/schedule-types`, {
        method: "POST", body: { name: newTypeName.trim() },
      });
      setScheduleTypes(prev => [...prev, t]);
      setTypeId(t.id);
      setAddingType(false); setNewTypeName("");
    } catch (e) { setError(e.message); }
    finally { setSavingType(false); }
  }

  async function saveRename(tid) {
    if (!editName.trim()) return;
    try {
      const t = await api(`/api/projects/${projectId}/schedule-types/${tid}`, {
        method: "PATCH", body: { name: editName.trim() },
      });
      setScheduleTypes(prev => prev.map(s => s.id === tid ? t : s));
      setEditingTypeId(null);
    } catch (e) { setError(e.message); }
  }

  async function deleteType(tid) {
    if (!window.confirm("Delete this schedule type and all its stored revisions?")) return;
    try {
      await api(`/api/projects/${projectId}/schedule-types/${tid}`, { method: "DELETE" });
      setScheduleTypes(prev => prev.filter(s => s.id !== tid));
      if (typeId === tid) { setTypeId(""); setRevisions([]); }
    } catch (e) { setError(e.message); }
  }

  async function deleteRevision(rid) {
    if (!window.confirm("Delete this revision? This cannot be undone.")) return;
    try {
      await api(`/api/schedule-revisions/${rid}`, { method: "DELETE" });
      setRevisions(prev => prev.filter(r => r.id !== rid));
    } catch (e) { setError(e.message); }
  }

  async function downloadRevisionCsv(rid) {
    try {
      const res = await apiBlob(`/api/schedule-revisions/${rid}/csv`, null, "GET");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "revision.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); }
  }

  async function generate() {
    if (!projectId || !typeId || !csvFile) return;
    const hadPrevRevision = revisions.length > 0;
    setGenerating(true); setError(""); setResult(null); setLastBlob(null);
    try {
      const res = await apiBlob("/api/schedule/csv-to-excel", {
        projectId, scheduleTypeId: typeId, csvText: csvFile.text,
      });
      const added   = parseInt(res.headers.get("X-Schedule-Added")   || "0");
      const changed = parseInt(res.headers.get("X-Schedule-Changed") || "0");
      const removed = parseInt(res.headers.get("X-Schedule-Removed") || "0");
      const rows    = parseInt(res.headers.get("X-Schedule-Rows")    || "0");
      const blob = await res.blob();
      const typeName = scheduleTypes.find(t => t.id === typeId)?.name || "Schedule";
      setLastBlob(blob);
      setLastFilename(`${typeName}.xlsx`);
      setResult({ added, changed, removed, rows, isFirst: !hadPrevRevision, filename: `${typeName}.xlsx` });
      // Refresh revision history
      api(`/api/schedule-types/${typeId}/revisions`).then(setRevisions).catch(() => {});
    } catch (e) { setError(e.message); }
    finally { setGenerating(false); }
  }

  function downloadLastExcel() {
    if (!lastBlob) return;
    const url = URL.createObjectURL(lastBlob);
    const a = document.createElement("a"); a.href = url; a.download = lastFilename; a.click();
    URL.revokeObjectURL(url);
  }

  const canGenerate = projectId && typeId && csvFile && !generating;

  return (
    <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 4, overflow: "hidden", fontFamily: "Inter, Arial, sans-serif" }}>
      {/* Card header */}
      <div style={{ background: SCHEDULE_FULL, padding: "10px 14px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", letterSpacing: ".04em" }}>CSV to Excel</div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.65)", marginTop: 2 }}>Import a Revit schedule export and generate a formatted Excel</div>
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>

        {/* Project */}
        <div>
          <div style={{ fontSize: 9, fontWeight: 600, color: SCHEDULE_FULL, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 5 }}>Project</div>
          <select
            value={projectId}
            onChange={e => { setProjectId(e.target.value); setTypeId(""); setCsvFile(null); setResult(null); }}
            style={{ width: "100%", padding: "7px 10px", border: "1px solid #d0d0d8", borderRadius: 3, fontSize: 11, color: "#444", fontFamily: "Inter, Arial, sans-serif" }}
          >
            <option value="">Select a project...</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {/* Schedule Type */}
        {projectId && (
          <div>
            <div style={{ fontSize: 9, fontWeight: 600, color: SCHEDULE_FULL, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 5 }}>Schedule Type</div>
            {addingType ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  value={newTypeName}
                  onChange={e => setNewTypeName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addType()}
                  placeholder="e.g. Sanitary Ware Schedule"
                  autoFocus
                  style={{ flex: 1, padding: "7px 10px", border: `1px solid ${SCHEDULE_FULL}`, borderRadius: 3, fontSize: 11, fontFamily: "Inter, Arial, sans-serif" }}
                />
                <button onClick={addType} disabled={savingType} style={{ background: SCHEDULE_FULL, color: "#fff", border: "none", padding: "7px 14px", borderRadius: 3, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
                  {savingType ? "Adding…" : "Add"}
                </button>
                <button onClick={() => { setAddingType(false); setNewTypeName(""); }} style={{ background: "none", border: "none", color: "#888", fontSize: 10, cursor: "pointer" }}>Cancel</button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select
                    value={typeId}
                    onChange={e => {
                      if (e.target.value === "__add__") { setAddingType(true); }
                      else { setTypeId(e.target.value); setResult(null); }
                    }}
                    style={{ flex: 1, padding: "7px 10px", border: "1px solid #d0d0d8", borderRadius: 3, fontSize: 11, color: "#444", fontFamily: "Inter, Arial, sans-serif" }}
                  >
                    <option value="">Select a schedule type...</option>
                    {scheduleTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    <option value="__add__" style={{ color: SCHEDULE_FULL, fontWeight: 600 }}>+ Add new type for this project...</option>
                  </select>
                  {typeId && (
                    <>
                      <button
                        title="Rename"
                        onClick={() => { setEditingTypeId(typeId); setEditName(scheduleTypes.find(t => t.id === typeId)?.name || ""); }}
                        style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 3, padding: "5px 8px", cursor: "pointer", fontSize: 12 }}
                      >✏️</button>
                      <button
                        title="Delete type"
                        onClick={() => deleteType(typeId)}
                        style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 3, padding: "5px 8px", cursor: "pointer", fontSize: 12 }}
                      >🗑️</button>
                    </>
                  )}
                </div>
                {editingTypeId === typeId && (
                  <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && saveRename(typeId)}
                      style={{ flex: 1, padding: "5px 8px", border: `1px solid ${SCHEDULE_FULL}`, borderRadius: 3, fontSize: 11, fontFamily: "Inter, Arial, sans-serif" }}
                    />
                    <button onClick={() => saveRename(typeId)} style={{ background: SCHEDULE_FULL, color: "#fff", border: "none", padding: "5px 12px", borderRadius: 3, fontSize: 10, cursor: "pointer" }}>Save</button>
                    <button onClick={() => setEditingTypeId(null)} style={{ background: "none", border: "none", color: "#888", fontSize: 10, cursor: "pointer" }}>Cancel</button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* CSV Upload */}
        {projectId && typeId && (
          <div>
            <div style={{ fontSize: 9, fontWeight: 600, color: SCHEDULE_FULL, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 5 }}>Revit Schedule Export (CSV)</div>
            <div
              onClick={() => csvRef.current.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleCsvFile(e.dataTransfer.files[0]); }}
              style={{ border: `2px dashed ${csvFile ? SCHEDULE_FULL : "#c8b8e8"}`, borderRadius: 4, padding: "18px 12px", textAlign: "center", background: "#faf8ff", cursor: "pointer" }}
            >
              <div style={{ fontSize: 22, marginBottom: 4 }}>📋</div>
              <div style={{ fontSize: 9, color: csvFile ? "#444" : "#9a9aa0", wordBreak: "break-all" }}>
                {csvFile ? csvFile.name : "Drop CSV here or click to browse"}
              </div>
              {csvFile && (
                <div style={{ fontSize: 8, color: SCHEDULE_FULL, marginTop: 4, cursor: "pointer" }}
                  onClick={e => { e.stopPropagation(); setCsvFile(null); }}>✕ Remove</div>
              )}
            </div>
            <input ref={csvRef} type="file" accept=".csv" style={{ display: "none" }}
              onChange={e => handleCsvFile(e.target.files[0])} />
          </div>
        )}

        {/* Error */}
        {error && <div style={{ fontSize: 10, color: "#c62828" }}>{error}</div>}

        {/* Generate button */}
        {projectId && typeId && (
          <div style={{ textAlign: "right" }}>
            <button
              onClick={generate}
              disabled={!canGenerate}
              style={{
                background: canGenerate ? SCHEDULE_FULL : "#d0c8e0",
                color: "#fff", border: "none", padding: "7px 18px", borderRadius: 3,
                fontSize: 10, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase",
                cursor: canGenerate ? "pointer" : "default",
              }}
            >{generating ? "Generating…" : "Generate Excel"}</button>
          </div>
        )}

        {/* Result */}
        {result && (
          <div style={{ padding: 12, background: "#f5f3fa", borderRadius: 4, border: "1px solid #e0d8f0" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              {result.isFirst ? (
                <span style={{ fontSize: 9, color: "#888", fontStyle: "italic" }}>First revision — saved as baseline for future comparisons</span>
              ) : (
                <>
                  <span style={{ fontSize: 9, background: "#e8f5e9", color: "#2e7d32", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{result.added} added</span>
                  <span style={{ fontSize: 9, background: "#fff8e1", color: "#e65100", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{result.changed} changed</span>
                  <span style={{ fontSize: 9, background: "#ffebee", color: "#c62828", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{result.removed} removed</span>
                </>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 26 }}>📊</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#333" }}>{result.filename}</div>
                <div style={{ fontSize: 9, color: "#888", marginTop: 2 }}>{result.rows} rows · Saved as latest revision</div>
              </div>
              <button onClick={downloadLastExcel} style={{ background: SCHEDULE_FULL, color: "#fff", border: "none", padding: "6px 14px", borderRadius: 3, fontSize: 9, fontWeight: 600, cursor: "pointer" }}>⬇ Download</button>
            </div>
          </div>
        )}

        {/* Revision History */}
        {typeId && (
          <div>
            <div style={{ fontSize: 9, fontWeight: 600, color: SCHEDULE_FULL, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 6 }}>Revision History</div>
            {loadingRevs ? (
              <div style={{ fontSize: 9, color: "#9a9aa0" }}>Loading…</div>
            ) : revisions.length === 0 ? (
              <div style={{ fontSize: 9, color: "#9a9aa0", fontStyle: "italic" }}>No revisions yet — upload a CSV to create the first one.</div>
            ) : (
              <div style={{ border: "1px solid #e8e0f0", borderRadius: 3, overflow: "hidden" }}>
                {revisions.map((rev, i) => (
                  <div key={rev.id} style={{ display: "flex", alignItems: "center", padding: "7px 10px", borderBottom: i < revisions.length - 1 ? "1px solid #f0ecf8" : "none", background: i === 0 ? "#faf8ff" : "#fff" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, fontWeight: i === 0 ? 600 : 400, color: "#333" }}>
                        {new Date(rev.uploaded_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        {i === 0 && <span style={{ fontSize: 8, marginLeft: 6, background: SCHEDULE_FULL, color: "#fff", padding: "1px 5px", borderRadius: 2 }}>Latest</span>}
                      </div>
                      <div style={{ fontSize: 9, color: "#9a9aa0" }}>{rev.row_count} rows</div>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button title="Download CSV" onClick={() => downloadRevisionCsv(rev.id)}
                        style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 3, padding: "4px 7px", cursor: "pointer", fontSize: 11 }}>⬇</button>
                      <button title="Delete revision" onClick={() => deleteRevision(rev.id)}
                        style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 3, padding: "4px 7px", cursor: "pointer", fontSize: 11, color: "#c62828" }}>🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
```

- [ ] **Step 2: Smoke test**

1. Open the Schedule section. Select a project — schedule type dropdown should appear.
2. Click "+ Add new type for this project…" — add "Window & Door Schedule". Verify it appears in the dropdown.
3. Select the new type. Revision history should show "No revisions yet."
4. Upload a Revit CSV export. Click "Generate Excel". Verify the Excel downloads.
5. Upload a second (different) CSV for the same type. Verify the result shows added/changed/removed counts and the Excel downloads with colour highlights.
6. Check the Revision History panel — should show both uploads. Delete the older one and confirm it disappears.

- [ ] **Step 3: Commit**

```
git add client/src/components/ScheduleCsvExcel.jsx
git commit -m "feat: CSV to Excel tool with schedule types, revision history, and diff highlighting"
```

---

## Task 10: Deploy

- [ ] **Step 1: Push client to Vercel**

Commit any remaining changes and push to the deploy branch. Vercel will build automatically.

- [ ] **Step 2: Push server to Railway**

Push the server changes. Railway will redeploy automatically.

- [ ] **Step 3: Verify in production**

Open the live app. Click the Schedule tile. Test both tools end-to-end with real PDFs and a real Revit CSV export.

---

## Self-Review Notes

- **Spec coverage:** All 9 endpoints specified ✓ | Two-table SQL migration ✓ | Schedule tile + routing ✓ | PDF Compare with in-browser table + Excel download ✓ | CSV to Excel with per-project schedule types, revision history, delete, rename ✓
- **ExcelJS** already imported in server — no install step needed
- **`parseCsvText`** handles quoted fields with embedded commas — sufficient for Revit exports
- **Binary response pattern** (apiBlob) consistent with how api() works — reads headers before blob()
- **`/api/projects` response shape** — flagged in Task 9 Step 1 to verify before assuming array format
