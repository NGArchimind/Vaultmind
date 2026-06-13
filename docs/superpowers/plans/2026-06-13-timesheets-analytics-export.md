# Timesheets Analytics & Export — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. This project has **no automated test suite** — verification is (a) a successful production build and (b) a visual check on the staging site. Nathan commits and deploys himself; "Checkpoint" markers show sensible commit/deploy points — do **not** run `git commit`.

**Goal:** Give the Reports & Analytics screen (HR + admin) and the Fee Review screen (admin only) richer filtering, a Group-by cut, billable/non-billable + utilisation, and the ability to export the current filtered view as a PDF (browser print) or CSV.

**Architecture:** Client-only. Two existing components (`TimesheetReport.jsx`, `FeeReview.jsx`) are extended in place. Shared logic (date presets, CSV build/download, filter-summary string) goes in one small new helper module. PDF uses the browser's own print-to-PDF via a print stylesheet that shows only the report area. No database or server changes — all needed data already comes from existing endpoints.

**Tech Stack:** React (CRA), recharts (already used), plain JS for CSV, CSS `@media print` for PDF. No new dependencies.

**Build check (this machine):** `npm run build` is broken here. Build with:
`cd client; node node_modules\react-scripts\bin\react-scripts.js build` (PowerShell).
A green build = "Compiled successfully". Warnings are acceptable; errors are not.

---

## File structure

- **Create** `client/src/utils/reportExport.js` — shared helpers: `datePreset()`, `endOfCurrentWeek()`, `toCsv()`, `downloadCsv()`, `filterSummary()`.
- **Create** `client/src/printReport.css` — `@media print` rules (show `.print-area`, hide `.no-print`).
- **Modify** `client/src/index.js` — import `printReport.css` once.
- **Modify** `client/src/components/TimesheetReport.jsx` — presets, category + billable filters, Group-by, utilisation card, Export PDF + CSV, current-week default, print classes.
- **Modify** `client/src/components/FeeReview.jsx` — date/project/person filters, Export PDF + CSV, print classes.

---

## Task 1: Shared export/helper module

**Files:**
- Create: `client/src/utils/reportExport.js`

- [ ] **Step 1: Create the helper module**

```javascript
// client/src/utils/reportExport.js
// Shared helpers for the timesheet/fee reports: date presets, CSV, filter summary.
// No external dependencies.

// Build YYYY-MM-DD from LOCAL date parts — never toISOString() (UTC shifts the
// day back under British Summer Time). Mirrors isoDate() used elsewhere.
export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Sunday of the week containing `d` (weeks run Mon–Sun for filtering purposes,
// so the current week — including days logged ahead — is always included).
export function endOfCurrentWeek(d = new Date()) {
  const x = new Date(d);
  const day = x.getDay();              // 0 = Sun, 1 = Mon …
  const add = day === 0 ? 0 : 7 - day; // days forward to Sunday
  x.setDate(x.getDate() + add);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Returns { from, to } as YYYY-MM-DD for a named preset.
// "to" is always the end of the current week so the live week shows.
export function datePreset(name) {
  const now = new Date();
  const to = endOfCurrentWeek(now);
  let from = new Date(now);
  switch (name) {
    case "week":    from = new Date(now); from.setDate(now.getDate() - now.getDay() + 1); break; // Mon this week
    case "month":   from = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case "quarter": from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1); break;
    case "year":    from = new Date(now.getFullYear(), 0, 1); break;
    default:        from = new Date(now.getFullYear(), now.getMonth() - 3, 1); break; // fallback ~3 months
  }
  from.setHours(0, 0, 0, 0);
  return { from: isoDate(from), to: isoDate(to) };
}

// Convert an array of plain objects to a CSV string. Columns = keys of the
// first row, in order. Values are quoted and internal quotes doubled.
export function toCsv(rows) {
  if (!rows || rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = cols.map(esc).join(",");
  const body = rows.map(r => cols.map(c => esc(r[c])).join(",")).join("\r\n");
  return `${header}\r\n${body}`;
}

// Trigger a browser download of a CSV string.
export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Human-readable one-line summary of the active filters (for screen + exports).
// parts = array of strings already formatted by the caller.
export function filterSummary(parts) {
  const clean = parts.filter(Boolean);
  return clean.length ? clean.join(" · ") : "All data";
}
```

- [ ] **Step 2: Verify build still passes**

Run: `cd client; node node_modules\react-scripts\bin\react-scripts.js build`
Expected: "Compiled successfully" (the new file is not imported yet, so this just confirms no syntax error).

- [ ] **Checkpoint:** good point for Nathan to commit ("add report export helpers").

---

## Task 2: Print stylesheet

**Files:**
- Create: `client/src/printReport.css`
- Modify: `client/src/index.js`

- [ ] **Step 1: Create the print stylesheet**

```css
/* client/src/printReport.css
   When printing, show only the report area and hide everything else
   (app shell, nav, filter bar, buttons). The report container gets
   className="print-area"; non-printing chrome gets className="no-print". */
@media print {
  body * { visibility: hidden; }
  .print-area, .print-area * { visibility: visible; }
  .print-area {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    overflow: visible !important;
    background: #fff !important;
  }
  .no-print { display: none !important; }
  /* Avoid breaking a chart or table row across pages where possible */
  .print-area table, .print-area .recharts-wrapper { page-break-inside: avoid; }
  @page { margin: 14mm; }
}
```

- [ ] **Step 2: Import it once in index.js**

Add near the other CSS imports at the top of `client/src/index.js`:

```javascript
import "./printReport.css";
```

- [ ] **Step 3: Verify build passes**

Run: `cd client; node node_modules\react-scripts\bin\react-scripts.js build`
Expected: "Compiled successfully".

- [ ] **Checkpoint:** Nathan commits ("add print stylesheet").

---

## Task 3: Report — date presets + current-week default fix

**Files:**
- Modify: `client/src/components/TimesheetReport.jsx`

- [ ] **Step 1: Import helpers**

At the top of `TimesheetReport.jsx`, after the existing `import { api } ...` line, add:

```javascript
import { datePreset, endOfCurrentWeek, isoDate as isoDateUtil, toCsv, downloadCsv, filterSummary } from "../utils/reportExport";
```

(The file already defines a local `isoDate`; we import the util under an alias to avoid a clash and keep the local one in use where it already is.)

- [ ] **Step 2: Fix the default date range**

Find (around line 88–92):

```javascript
  const [filterFrom, setFilterFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3);
    return isoDate(d);
  });
  const [filterTo, setFilterTo] = useState(isoDate(new Date()));
```

Replace with:

```javascript
  const [filterFrom, setFilterFrom] = useState(() => datePreset("quarter").from);
  const [filterTo,   setFilterTo]   = useState(() => datePreset("quarter").to);
```

- [ ] **Step 3: Add preset buttons to the filter bar**

In the filters block, immediately after the `<select>` for projects (around line 215, before the From/To `<div>`), insert:

```jsx
          <div style={{ display: "flex", gap: 4 }}>
            {[["This week","week"],["Month","month"],["Quarter","quarter"],["Year","year"]].map(([label, key]) => (
              <button key={key} type="button"
                onClick={() => { const p = datePreset(key); setFilterFrom(p.from); setFilterTo(p.to); }}
                style={{ ...selStyle, cursor: "pointer", background: "#f4f7f9" }}>
                {label}
              </button>
            ))}
          </div>
```

- [ ] **Step 4: Verify build + visual check**

Run the build. Then on staging, open Timesheets → Reports & Analytics. Expected: four preset buttons appear; clicking "This week" sets the dates to the current week; the default view now includes the current week (the overtime entry from 15 Jun shows without changing dates if within the quarter).

- [ ] **Checkpoint:** Nathan commits + deploys to Vercel ("report date presets + current-week default").

---

## Task 4: Report — category + billable/non-billable filters

**Files:**
- Modify: `client/src/components/TimesheetReport.jsx`

- [ ] **Step 1: Add a category-label list and filter state**

Near the top of the file, after the `DAYS` constant (around line 14), add:

```javascript
const CATEGORY_LABELS = {
  holiday: "Holiday", sickness: "Sickness", bank_holiday: "Bank Holiday",
  training: "Training / CPD", internal: "Internal / Non-billable",
};
```

In the component state block (after `filterTo`), add:

```javascript
  const [filterCategory, setFilterCategory] = useState(""); // "" = all, or a category value
  const [filterBillable, setFilterBillable] = useState(""); // "", "billable", "nonbillable"
```

- [ ] **Step 2: Apply the two filters client-side**

Directly after the `entries` are loaded into aggregations (just before `const totalMins = ...`, around line 122), insert a derived filtered list and use it everywhere `entries` is aggregated:

```javascript
  const fEntries = entries.filter(e => {
    if (filterBillable === "billable"    && !e.project_id) return false;
    if (filterBillable === "nonbillable" &&  e.project_id) return false;
    if (filterCategory && e.category !== filterCategory)   return false;
    return true;
  });
```

Then replace every aggregation use of `entries` with `fEntries` in this file **except** the network fetch and the `entries.length === 0` empty-state check. Specifically update: `totalMins`, `totalOt`, the `byWeek` loop, the `byProject` loop, the `byPerson` loop, `activeStaff`, `activeProjects`, and the `tableRows` loop. (Search the file for `entries.forEach` and `entries.reduce` — there are 6 — and the two `new Set(entries` lines.)

- [ ] **Step 3: Add the filter controls to the bar**

After the project `<select>` (and after the preset buttons from Task 3), add:

```jsx
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={selStyle}>
            <option value="">All types</option>
            {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>

          <select value={filterBillable} onChange={e => setFilterBillable(e.target.value)} style={selStyle}>
            <option value="">Billable + non-billable</option>
            <option value="billable">Billable (project work)</option>
            <option value="nonbillable">Non-billable (categories)</option>
          </select>
```

- [ ] **Step 4: Verify build + visual check**

Build, then on staging confirm: choosing "Billable (project work)" drops category entries from the cards/charts/table; choosing a specific type (e.g. Holiday) shows only those; totals update consistently across cards, charts and the table.

- [ ] **Checkpoint:** Nathan commits + deploys ("report category + billable filters").

---

## Task 5: Report — Group-by selector

**Files:**
- Modify: `client/src/components/TimesheetReport.jsx`

- [ ] **Step 1: Add group-by state**

After the filter state added in Task 4, add:

```javascript
  const [groupBy, setGroupBy] = useState("week"); // week | project | person | category
```

- [ ] **Step 2: Build a single grouped dataset**

After `fEntries` (Task 4), add a helper that produces the grouped rows for the primary chart + table:

```javascript
  const groupKey = (e) => {
    if (groupBy === "project")  return e.project_id
      ? (e.projects?.job_number ? `${e.projects.job_number} — ${e.projects.name}` : e.projects?.name || "Unknown")
      : (e.category ? (CATEGORY_LABELS[e.category] || e.category) : "Other");
    if (groupBy === "person")   return users.find(u => u.id === e.user_id)?.email || (e.user_id?.slice(0, 8) + "…");
    if (groupBy === "category") return e.project_id ? "Project work" : (CATEGORY_LABELS[e.category] || e.category || "Other");
    // default: week
    return isoDate(getMonday(e.entry_date));
  };

  const grouped = {};
  fEntries.forEach(e => {
    const k = groupKey(e);
    if (!grouped[k]) grouped[k] = 0;
    grouped[k] += entryMins(e);
  });
  const groupedData = Object.entries(grouped)
    .map(([k, mins]) => ({ key: k, label: groupBy === "week" ? formatWeekShort(k) : k, hours: minsToHours(mins) }))
    .sort((a, b) => groupBy === "week" ? a.key.localeCompare(b.key) : b.hours - a.hours);
```

- [ ] **Step 3: Add the Group-by selector to the filter bar**

After the billable `<select>`, add:

```jsx
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
            <span style={{ fontSize: 12, color: "#8a9aa8" }}>Group by</span>
            <select value={groupBy} onChange={e => setGroupBy(e.target.value)} style={selStyle}>
              <option value="week">Week</option>
              <option value="project">Project</option>
              <option value="person">Person</option>
              <option value="category">Category</option>
            </select>
          </div>
```

- [ ] **Step 4: Point the primary "Hours by Week" chart at the grouped data**

Replace the "Hours by Week" chart card (around lines 252–264) so its heading and data follow `groupBy`:

```jsx
              <div style={{ background: "#fff", border: "1px solid #dde4e8", padding: "20px 20px 12px" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 13, fontWeight: 700, color: DESIGN_TEXT, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Hours by {groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={groupedData} margin={{ top: 0, right: 8, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f4" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8a9aa8" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#8a9aa8" }} unit="h" />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="hours" fill={TIMESHEETS_FULL} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
```

(The existing "Hours by Project", "Hours by Person", pie and detailed table stay as they are — they remain useful fixed cuts. Group-by drives the primary chart.)

- [ ] **Step 5: Verify build + visual check**

Build, then on staging: switch Group by between Week/Project/Person/Category and confirm the primary chart re-pivots and the bar total stays consistent (sum of bars = Total hours card).

- [ ] **Checkpoint:** Nathan commits + deploys ("report group-by selector").

---

## Task 6: Report — utilisation card

**Files:**
- Modify: `client/src/components/TimesheetReport.jsx`

- [ ] **Step 1: Compute utilisation from the filtered set**

After `groupedData` (or anywhere after `fEntries`), add:

```javascript
  const billableMins = fEntries.reduce((s, e) => s + (e.project_id ? entryMins(e) : 0), 0);
  const utilisationPct = totalMins > 0 ? Math.round((billableMins / totalMins) * 100) : 0;
```

- [ ] **Step 2: Add a Utilisation summary card**

In the summary-cards row (around line 235–241), add after the "Overtime" card:

```jsx
          <SummaryCard label="Utilisation" value={`${utilisationPct}%`} sub="billable share of hours" color={TIMESHEETS_FULL} />
```

- [ ] **Step 3: Verify build + visual check**

Build, then on staging confirm the Utilisation card shows a sensible % (100% when only project work is in range; lower when holidays/internal are included) and that it tracks the billable filter.

- [ ] **Checkpoint:** Nathan commits + deploys ("report utilisation card").

---

## Task 7: Report — Export PDF + CSV

**Files:**
- Modify: `client/src/components/TimesheetReport.jsx`

- [ ] **Step 1: Build the on-screen filter summary + a print-only report header**

After the filter state, compute:

```javascript
  const summaryText = filterSummary([
    filterUser ? (users.find(u => u.id === filterUser)?.email) : "All staff",
    filterProject ? (projects.find(p => String(p.id) === String(filterProject))?.name) : "All projects",
    filterCategory ? CATEGORY_LABELS[filterCategory] : null,
    filterBillable === "billable" ? "Billable only" : filterBillable === "nonbillable" ? "Non-billable only" : null,
    (filterFrom && filterTo) ? `${filterFrom} → ${filterTo}` : null,
  ]);
```

- [ ] **Step 2: Add export handlers**

```javascript
  const handlePrint = () => window.print();

  const handleCsv = () => {
    const rows = fEntries.map(e => ({
      Date: e.entry_date,
      Person: users.find(u => u.id === e.user_id)?.email || e.user_id,
      "Project / Category": e.project_id
        ? (e.projects?.job_number ? `${e.projects.job_number} — ${e.projects.name}` : e.projects?.name || "")
        : (e.category ? (CATEGORY_LABELS[e.category] || e.category) : ""),
      Hours: minsToHours(entryMins(e)),
      Overtime: minsToHours(entryOtMins(e)),
      Notes: e.notes || "",
    }));
    downloadCsv(`timesheet-report-${isoDate(new Date())}.csv`, toCsv(rows));
  };
```

- [ ] **Step 3: Add the buttons + a print-only header; mark chrome no-print**

In the page header row (around line 193–199), add the buttons on the right and wrap them so they don't print:

```jsx
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 300, color: DESIGN_TEXT }}>Reports &amp; Analytics</h2>
        <div className="no-print" style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={handleCsv} style={{ ...selStyle, cursor: "pointer", background: "#fff" }}>Download CSV</button>
          <button onClick={handlePrint} style={{ ...selStyle, cursor: "pointer", background: DESIGN_TEXT, color: "#fff", border: "none" }}>Export PDF</button>
        </div>
```

Add `className="no-print"` to: the back-button (line ~194) — actually keep Back but wrap it; the simplest is to add `className="no-print"` to the **filters** container `<div>` (line ~204) and to the coloured "Timesheets — Report" banner (line ~188). Add `className="print-area"` to the scrolling content container `<div style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}>` (line ~201).

Inside that print-area container, as its first child, add a print-only header that is hidden on screen:

```jsx
        <div style={{ display: "none" }} className="print-only-header">
          <h1 style={{ fontSize: 20, margin: "0 0 4px", color: DESIGN_TEXT }}>Archimind — Timesheet Report</h1>
          <p style={{ fontSize: 12, color: "#6a8a9a", margin: "0 0 16px" }}>{summaryText} · Generated {isoDate(new Date())}</p>
        </div>
```

Add to `printReport.css` inside the `@media print` block:

```css
  .print-only-header { display: block !important; }
```

- [ ] **Step 4: Verify build + visual check**

Build, then on staging: "Download CSV" downloads a file that opens in Excel with the filtered rows and correct totals. "Export PDF" opens the browser print dialog; in the preview only the report (with the Archimind header + filter summary) shows — no nav, no filter bar, no buttons. Choose "Save as PDF" to confirm output.

- [ ] **Checkpoint:** Nathan commits + deploys ("report PDF + CSV export").

---

## Task 8: Fee Review — filters

**Files:**
- Modify: `client/src/components/FeeReview.jsx`

- [ ] **Step 1: Import helpers**

After `import { api } ...`:

```javascript
import { datePreset, toCsv, downloadCsv, filterSummary } from "../utils/reportExport";
```

- [ ] **Step 2: Add filter state**

In the main `FeeReview` component state block (after `toast`), add:

```javascript
  const [fFrom,    setFFrom]    = useState(() => datePreset("year").from);
  const [fTo,      setFTo]      = useState(() => datePreset("year").to);
  const [fProject, setFProject] = useState("");
  const [fPerson,  setFPerson]  = useState("");
```

- [ ] **Step 3: Derive a filtered entry list and feed the aggregations**

Replace direct uses of `allEntries` in the spend calculations with a filtered list. Just before `projectsWithFee` (around line 333), add:

```javascript
  const filteredEntries = allEntries.filter(e => {
    if (fProject && String(e.project_id) !== String(fProject)) return false;
    if (fPerson  && e.user_id !== fPerson)                     return false;
    if (fFrom && e.entry_date < fFrom)                          return false;
    if (fTo   && e.entry_date > fTo)                            return false;
    return true;
  });
```

Then in `projectsWithFee`, change `const pEntries = allEntries.filter(...)` to filter from `filteredEntries`. In the drill-down render (line ~312), change `allEntries.filter(e => e.project_id === drillProject.id)` to `filteredEntries.filter(...)`.

- [ ] **Step 4: Add a filter bar above the project cards**

Immediately after the Setup panel closing `</div>` (before "Project cards", around line 437), add:

```jsx
            <div className="no-print" style={{ background: "#fff", border: "1px solid #dde4e8", padding: "14px 18px", marginBottom: 20, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#6a8a9a", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Filters</span>
              <select value={fProject} onChange={e => setFProject(e.target.value)} style={selStyle}>
                <option value="">All projects</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.job_number ? `${p.job_number} — ${p.name}` : p.name}</option>)}
              </select>
              <select value={fPerson} onChange={e => setFPerson(e.target.value)} style={selStyle}>
                <option value="">All staff</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
              </select>
              <div style={{ display: "flex", gap: 4 }}>
                {[["Month","month"],["Quarter","quarter"],["Year","year"]].map(([label, key]) => (
                  <button key={key} type="button" onClick={() => { const p = datePreset(key); setFFrom(p.from); setFTo(p.to); }}
                    style={{ ...selStyle, cursor: "pointer", background: "#f4f7f9" }}>{label}</button>
                ))}
              </div>
              <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} style={selStyle} />
              <span style={{ fontSize: 12, color: "#8a9aa8" }}>to</span>
              <input type="date" value={fTo} onChange={e => setFTo(e.target.value)} style={selStyle} />
            </div>
```

- [ ] **Step 5: Verify build + visual check**

Build, then on staging (as admin): the fee cards' "Spent" figures change when you narrow the date range or pick one project/person; the fee total stays the project's full fee. Drill into a project and confirm the burn chart/staff table also respect the filters.

- [ ] **Checkpoint:** Nathan commits + deploys ("fee review filters").

---

## Task 9: Fee Review — Export PDF + CSV

**Files:**
- Modify: `client/src/components/FeeReview.jsx`

- [ ] **Step 1: Filter summary + handlers**

In the main component (after `filteredEntries`), add:

```javascript
  const feeSummary = filterSummary([
    fProject ? (projects.find(p => String(p.id) === String(fProject))?.name) : "All projects",
    fPerson  ? (userMap[fPerson]) : "All staff",
    (fFrom && fTo) ? `${fFrom} → ${fTo}` : null,
  ]);

  const handlePrint = () => window.print();

  const handleCsv = () => {
    const rows = filteredEntries.map(e => {
      const hrs = (e.hours || 0) + (e.minutes || 0) / 60;
      const rate = rates[e.user_id] || 0;
      return {
        Date: e.entry_date,
        Person: userMap[e.user_id] || e.user_id,
        Project: e.projects?.name || "",
        Hours: Math.round(hrs * 100) / 100,
        "Rate (£/h)": rate,
        "Cost (£)": Math.round(hrs * rate * 100) / 100,
      };
    });
    downloadCsv(`fee-review-${new Date().toISOString().slice(0,10)}.csv`, toCsv(rows));
  };
```

- [ ] **Step 2: Add buttons to the header + print classes**

In the main list-view header row (around line 357–361), add buttons on the right and a print class to the content:

```jsx
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 300, color: DESIGN_TEXT }}>Fee Review</h2>
        <div className="no-print" style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={handleCsv} style={{ ...selStyle, cursor: "pointer", background: "#fff" }}>Download CSV</button>
          <button onClick={handlePrint} style={{ ...selStyle, cursor: "pointer", background: DESIGN_TEXT, color: "#fff", border: "none" }}>Export PDF</button>
        </div>
```

Add `className="print-area"` to the content container `<div style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}>` (line ~363). Add `className="no-print"` to the coloured "Timesheets — Fee Review" banner (line ~351) and to the Setup panel container (line ~369).

As the first child inside the print-area container, add the print-only header:

```jsx
        <div style={{ display: "none" }} className="print-only-header">
          <h1 style={{ fontSize: 20, margin: "0 0 4px", color: DESIGN_TEXT }}>Archimind — Fee Review</h1>
          <p style={{ fontSize: 12, color: "#6a8a9a", margin: "0 0 16px" }}>{feeSummary} · Generated {new Date().toISOString().slice(0,10)}</p>
        </div>
```

(The same drill-down view also benefits: add `className="print-area"` to its content container at line ~319 and `className="no-print"` to its Back-button header, so an admin can print a single project's fee detail. The `print-only-header` element can be duplicated there with the project name in the title.)

- [ ] **Step 3: Verify build + visual check**

Build, then on staging (admin): "Download CSV" gives a fee CSV (date, person, project, hours, rate, cost) matching the filters. "Export PDF" print preview shows only the fee report with the Archimind header + filter line; the Setup panel, filter bar and buttons are hidden.

- [ ] **Checkpoint:** Nathan commits + deploys ("fee review PDF + CSV export").

---

## Task 10: Role-wall + final verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm HR cannot reach fee export**

On staging, log in as an **HR** user. Expected: the "Fee Review" button is not shown (it is `isAdmin`-gated at `TimesheetsSection.jsx:1055`), and the Reports & Analytics screen shows no fee/cost figures or fee CSV — only hours. No code change expected; if HR can see fees, stop and report.

- [ ] **Step 2: Full filtered-export smoke test**

As admin, on the Reports screen: set a person + project + "This week", confirm cards/charts/table agree, Export PDF, Download CSV. On the Fee Review screen: set a project + date range, Export PDF, Download CSV. Confirm both PDFs share the same header/footer template with only the content differing.

- [ ] **Step 3: Production release**

Once staging is signed off: merge `develop` → `main` (GitHub Desktop) so Vercel rebuilds production. **Client-only — nothing to run in Supabase, nothing on Railway.**

- [ ] **Checkpoint:** feature complete.

---

## Self-review notes (author)

- **Spec coverage:** presets + current-week default (T3), category + billable filters (T4), Group-by (T5), utilisation (T6), report PDF+CSV (T7), fee filters (T8), fee PDF+CSV (T9), shared template/summary/CSV helpers (T1) + print CSS (T2), role-wall check (T10). All spec sections covered.
- **No DB/server work** — matches "client only → Vercel" in the spec.
- **Naming consistency:** helper exports (`datePreset`, `endOfCurrentWeek`, `toCsv`, `downloadCsv`, `filterSummary`) used with the same names in T3–T9. Report uses `fEntries`; Fee Review uses `filteredEntries` (distinct, intentional).
- **Known soft spot:** exact line numbers drift as edits land — each step also gives a code anchor to search for, not just a line.
