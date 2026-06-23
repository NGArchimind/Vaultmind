# Searchable Project Picker (Item 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat project `<select>` with a reusable type-to-search picker that pins each user's recently-used projects to the top and exposes the curated non-project reasons via an "Other" bar.

**Architecture:** One new client component (`ProjectPicker`) reused at all four selection sites. Non-project categories move to a shared module and grow from 5 to 11 labels. A small `requireAuth` server endpoint returns each user's recently-used project ids, computed by a pure, unit-tested helper.

**Tech Stack:** React (CRA), Express on Railway, Supabase. Client has **no test runner** in this repo, so client UI is verified by build + manual check; server pure logic is covered by `node --test` (matches existing `server/lib/*.test.js`).

**Working notes:**
- Nathan commits and deploys himself (GitHub Desktop → Vercel/Railway). Each "Handoff" checkpoint is where you stop and hand him the change; do **not** run `git commit`.
- `npm run build` is broken on this machine — verify a client build with: `node node_modules\react-scripts\bin\react-scripts.js build` run from `client/` in PowerShell.
- All client→server calls go through `api()` in `client/src/api/client.js` — never raw fetch.

---

## File Structure

- **Create** `client/src/categories.js` — shared `CATEGORIES` list (11) + `categoryLabel(value)`.
- **Create** `client/src/components/ProjectPicker.jsx` — the reusable picker.
- **Create** `server/lib/recentProjects.js` — pure `recentProjectIds(rows, limit)` helper.
- **Create** `server/lib/recentProjects.test.js` — `node --test` for the helper.
- **Modify** `server/index.js` — add `GET /api/timesheets/recent-projects`.
- **Modify** `client/src/components/TimesheetsSection.jsx` — import shared `CATEGORIES`; fetch recent ids; swap picker into `EntryRow`, `DraftRow`, and the quick-fill select.
- **Modify** `client/src/components/ExpensesTab.jsx` — swap picker into the project select; accept `recentIds`.

---

## Task 1: Shared categories module (5 → 11 reasons)

**Files:**
- Create: `client/src/categories.js`
- Modify: `client/src/components/TimesheetsSection.jsx:9-15`

- [ ] **Step 1: Create the shared module**

```js
// client/src/categories.js
// Non-project "Other" time reasons. Labels only — no pay/allowance logic anywhere.
export const CATEGORIES = [
  { value: "holiday",       label: "Holiday" },
  { value: "sickness",      label: "Sickness" },
  { value: "bank_holiday",  label: "Bank Holiday" },
  { value: "training",      label: "Training / CPD" },
  { value: "internal",      label: "Internal / Non-billable" },
  { value: "maternity",     label: "Maternity" },
  { value: "paternity",     label: "Paternity" },
  { value: "compassionate", label: "Compassionate" },
  { value: "medical",       label: "Medical Appointment" },
  { value: "unpaid",        label: "Unpaid Leave" },
  { value: "unauthorised",  label: "Unauthorised" },
];

export function categoryLabel(value) {
  return CATEGORIES.find(c => c.value === value)?.label || value;
}
```

- [ ] **Step 2: Use it in TimesheetsSection**

In `client/src/components/TimesheetsSection.jsx`, delete the local `const CATEGORIES = [...]` block (lines ~9-15) and add to the imports at the top:

```js
import { CATEGORIES } from "../categories";
```

- [ ] **Step 3: Verify build**

Run from `client/`: `node node_modules\react-scripts\bin\react-scripts.js build`
Expected: build completes with no "CATEGORIES is not defined" error.

- [ ] **Step 4: Handoff** — leave uncommitted; this lands together with the rest of item 1 (see Task 6).

---

## Task 2: Recent-projects helper + endpoint

**Files:**
- Create: `server/lib/recentProjects.js`
- Test: `server/lib/recentProjects.test.js`
- Modify: `server/index.js` (add route near the other `/api/timesheets` routes)

- [ ] **Step 1: Write the failing test**

```js
// server/lib/recentProjects.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { recentProjectIds } = require("./recentProjects");

test("returns distinct project ids in row order, newest first", () => {
  const rows = [
    { project_id: "a" }, { project_id: "b" }, { project_id: "a" }, { project_id: "c" },
  ];
  assert.deepStrictEqual(recentProjectIds(rows, 8), ["a", "b", "c"]);
});

test("skips null/category rows", () => {
  const rows = [{ project_id: null }, { project_id: "a" }, { project_id: null }];
  assert.deepStrictEqual(recentProjectIds(rows, 8), ["a"]);
});

test("caps at limit", () => {
  const rows = [{ project_id: "a" }, { project_id: "b" }, { project_id: "c" }];
  assert.deepStrictEqual(recentProjectIds(rows, 2), ["a", "b"]);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test server/lib/recentProjects.test.js`
Expected: FAIL — cannot find module `./recentProjects`.

- [ ] **Step 3: Write the helper**

```js
// server/lib/recentProjects.js
// Distinct project ids preserving first-seen order (rows passed newest-first), capped.
function recentProjectIds(rows, limit = 8) {
  const seen = [];
  for (const r of rows) {
    const id = r && r.project_id;
    if (!id) continue;
    if (!seen.includes(id)) seen.push(id);
    if (seen.length >= limit) break;
  }
  return seen;
}
module.exports = { recentProjectIds };
```

- [ ] **Step 4: Run test, verify it passes**

Run: `node --test server/lib/recentProjects.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the endpoint**

In `server/index.js`, near the other `/api/timesheets` GET routes (specific routes before any `:id` wildcard, per HANDOVER), add:

```js
const { recentProjectIds } = require("./lib/recentProjects");

app.get("/api/timesheets/recent-projects", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("timesheets")
      .select("project_id, entry_date")
      .eq("user_id", req.user.id)
      .not("project_id", "is", null)
      .order("entry_date", { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json({ project_ids: recentProjectIds(data || [], 8) });
  } catch (err) {
    return serverError(res, err, "GET /api/timesheets/recent-projects");
  }
});
```

(If `require` is already used at top-of-file, move the `require("./lib/recentProjects")` up with the other requires rather than inline.)

- [ ] **Step 6: Handoff** — Nathan commits server changes and deploys **server → Railway** (staging/`develop`). Verify in the browser console that `GET /api/timesheets/recent-projects` returns `{ project_ids: [...] }`.

---

## Task 3: Build the ProjectPicker component

**Files:**
- Create: `client/src/components/ProjectPicker.jsx`

- [ ] **Step 1: Write the component**

```jsx
// client/src/components/ProjectPicker.jsx
import React, { useState, useRef, useEffect, useMemo } from "react";
import { DESIGN_TEXT } from "../constants";
import { CATEGORIES } from "../categories";

// value: project id | `cat:<value>` | ""    onChange(newValue)
// projects: [{ id, name, job_number }]      recentIds: [projectId, ...]
export default function ProjectPicker({ value, onChange, projects, recentIds = [], disabled, style }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode]   = useState("projects"); // "projects" | "other"
  const boxRef = useRef(null);

  useEffect(() => {
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) close(); }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function close() { setOpen(false); setQuery(""); setMode("projects"); }
  function pick(v) { onChange(v); close(); }

  const projLabel = (p) => (p.job_number ? `${p.job_number} — ${p.name}` : p.name);
  const currentLabel = useMemo(() => {
    if (!value) return "— Select —";
    if (value.startsWith("cat:")) return CATEGORIES.find(c => `cat:${c.value}` === value)?.label || "Other";
    const p = projects.find(p => p.id === value);
    return p ? projLabel(p) : "— Select —";
  }, [value, projects]);

  const q = query.trim().toLowerCase();
  const matches = (p) => projLabel(p).toLowerCase().includes(q);
  const recentProjects = recentIds.map(id => projects.find(p => p.id === id)).filter(Boolean).filter(matches);
  const recentSet = new Set(recentIds);
  const otherProjects = projects.filter(p => !recentSet.has(p.id)).filter(matches);
  const reasonMatches = q ? CATEGORIES.filter(c => c.label.toLowerCase().includes(q)) : [];

  const ss = { padding: "5px 8px", fontSize: 13, border: "1px solid #d0d8de", background: disabled ? "#f5f5f5" : "#fff",
    color: DESIGN_TEXT, fontFamily: "Inter, Arial, sans-serif", cursor: disabled ? "default" : "pointer" };
  const grpHdr = { padding: "4px 10px", fontSize: 9, fontWeight: 700, letterSpacing: ".08em", color: "#6a8a9a", background: "#f7f9fa" };
  const row    = { padding: "6px 10px", fontSize: 13, color: DESIGN_TEXT, cursor: "pointer" };

  return (
    <div ref={boxRef} style={{ position: "relative", ...style }}>
      <div onClick={() => !disabled && setOpen(o => !o)} style={{ ...ss, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentLabel}</span>
        <span style={{ color: "#8a9aa8" }}>▾</span>
      </div>

      {open && (
        <div style={{ position: "absolute", zIndex: 50, top: "calc(100% + 2px)", left: 0, right: 0, minWidth: 240,
          border: "1px solid #4c6278", background: "#fff", boxShadow: "0 6px 24px rgba(0,0,0,.12)" }}>

          {mode === "projects" ? (
            <>
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="🔍 Search projects…"
                style={{ width: "100%", boxSizing: "border-box", border: "none", borderBottom: "1px solid #eef2f4", padding: "8px 10px", fontSize: 13, outline: "none" }} />
              <div onClick={() => { setMode("other"); setQuery(""); }}
                style={{ padding: "9px 10px", borderBottom: "1px solid #e3cfa6", background: "#fbf3e6", color: "#8a6a3a", fontSize: 13, fontWeight: 600, display: "flex", justifyContent: "space-between", cursor: "pointer" }}>
                <span>Other — non-project time</span><span>›</span>
              </div>
              <div style={{ maxHeight: 240, overflowY: "auto" }}>
                {recentProjects.length > 0 && <div style={grpHdr}>RECENT</div>}
                {recentProjects.map(p => <div key={p.id} style={row} onClick={() => pick(p.id)}>{projLabel(p)}</div>)}
                {otherProjects.length > 0 && <div style={grpHdr}>ALL PROJECTS</div>}
                {otherProjects.map(p => <div key={p.id} style={row} onClick={() => pick(p.id)}>{projLabel(p)}</div>)}
                {reasonMatches.length > 0 && <div style={grpHdr}>OTHER</div>}
                {reasonMatches.map(c => <div key={c.value} style={{ ...row, color: "#8a6a3a" }} onClick={() => pick(`cat:${c.value}`)}>{c.label}</div>)}
                {recentProjects.length + otherProjects.length + reasonMatches.length === 0 &&
                  <div style={{ ...row, color: "#8a9aa8", cursor: "default" }}>No matches</div>}
              </div>
            </>
          ) : (
            <>
              <div onClick={() => { setMode("projects"); setQuery(""); }}
                style={{ padding: "9px 10px", borderBottom: "1px solid #eef2f4", color: "#4c6278", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                ‹ Back to projects
              </div>
              <div style={{ maxHeight: 260, overflowY: "auto" }}>
                {[...CATEGORIES].sort((a, b) => a.label.localeCompare(b.label)).map(c =>
                  <div key={c.value} style={row} onClick={() => pick(`cat:${c.value}`)}>{c.label}</div>)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run from `client/`: `node node_modules\react-scripts\bin\react-scripts.js build`
Expected: build completes (component compiles; not yet rendered anywhere).

---

## Task 4: Swap ProjectPicker into the four selection sites

**Files:**
- Modify: `client/src/components/TimesheetsSection.jsx` (`EntryRow` ~226, `DraftRow` ~175, quick-fill select ~1089; add a `recentIds` fetch + thread it down)
- Modify: `client/src/components/ExpensesTab.jsx` (project select ~199; accept `recentIds` prop)

- [ ] **Step 1: Fetch recent ids once in TimesheetsSection**

In the `TimesheetsSection` component body (top-level, alongside its other state/effects), add:

```js
const [recentIds, setRecentIds] = useState([]);
useEffect(() => {
  api("/api/timesheets/recent-projects")
    .then(r => setRecentIds(r?.project_ids || []))
    .catch(() => {});
}, []);
```

- [ ] **Step 2: Add the import**

At the top of `TimesheetsSection.jsx`:

```js
import ProjectPicker from "./ProjectPicker";
```

- [ ] **Step 3: Replace the `EntryRow` select**

Pass `recentIds` into `EntryRow` where it's rendered (add `recentIds={recentIds}` to both `<EntryRow .../>` usages, ~327 and ~734). Inside `EntryRow`, replace the `<select value={currentValue} ...><ProjectOptions .../></select>` (~226-228) with:

```jsx
<ProjectPicker
  value={currentValue}
  onChange={(val) => handleProjectChange({ target: { value: val } })}
  projects={projects}
  recentIds={recentIds}
  disabled={locked}
  style={{ flex: 1, minWidth: 0 }}
/>
```

(`handleProjectChange` already expects an event-like `{ target: { value } }`; reusing it keeps the category-clears-overtime logic intact.)

- [ ] **Step 4: Replace the `DraftRow` select**

Pass `recentIds={recentIds}` into `<DraftRow .../>` (~325). Inside `DraftRow`, replace its `<select value={sel} ...><ProjectOptions .../></select>` (~175-179) with:

```jsx
<ProjectPicker
  value={sel}
  onChange={(val) => { setSel(val); save(val, hours, minutes, notes); }}
  projects={projects}
  recentIds={recentIds}
  style={{ flex: 1, minWidth: 0 }}
/>
```

- [ ] **Step 5: Replace the quick-fill select**

Replace the `<select value={fillProject} ...><ProjectOptions .../></select>` (~1089-1092) with:

```jsx
<ProjectPicker
  value={fillProject}
  onChange={setFillProject}
  projects={projects}
  recentIds={recentIds}
  style={{ flex: 1, minWidth: 220 }}
/>
```

- [ ] **Step 6: Remove the now-unused `ProjectOptions`**

Delete the `ProjectOptions` function (~130-146) if nothing else references it (grep `ProjectOptions` first — it should now have zero usages).

- [ ] **Step 7: Swap the ExpensesTab select**

In `ExpensesTab.jsx`, add `import ProjectPicker from "./ProjectPicker";`, accept `recentIds = []` in props (`export default function ExpensesTab({ projects, recentIds = [] })`), and replace the project `<select>` (~199-202) with:

```jsx
<ProjectPicker
  value={fProject}
  onChange={setFProject}
  projects={projects}
  recentIds={recentIds}
  style={{ width: "100%" }}
/>
```

Then where `<ExpensesTab projects={projects} />` is rendered inside TimesheetsSection, pass `recentIds={recentIds}` too.

- [ ] **Step 8: Verify build**

Run from `client/`: `node node_modules\react-scripts\bin\react-scripts.js build`
Expected: build completes; no unused-var error for `ProjectOptions`.

---

## Task 5: Manual verification (staging)

- [ ] **Step 1:** On staging, open the weekly timesheet. Click a project cell → picker opens with search focused.
- [ ] **Step 2:** Type part of a job number and part of a name → both filter correctly.
- [ ] **Step 3:** Confirm recently-used projects appear under RECENT at the top.
- [ ] **Step 4:** Click "Other — non-project time" → reasons list shows all 11 alphabetically; "‹ Back to projects" returns.
- [ ] **Step 5:** Pick a project, then a reason → saved value is correct (project row shows time/overtime; reason row shows the label and `n/a` overtime).
- [ ] **Step 6:** Repeat the search + select in the **Expenses** add form and the **quick-fill** ("Apply one project to whole week") tool.
- [ ] **Step 7:** Type "sick" in projects mode → the Sickness reason surfaces inline.

---

## Task 6: Handoff — commit & deploy

- [ ] Nathan commits the client changes and deploys **client → Vercel** (preview/`develop`). Server (Task 2) should already be on Railway.
- [ ] After staging verification passes, Nathan merges `develop → main` to ship to `archimind.co.uk`.

**Deploy order for item 1: server (Railway) first, then client (Vercel).** No SQL.

---

## Notes / invariants
- Selection semantics are unchanged: `""`, a project id, or `cat:<value>`. The surrounding save logic (`handleProjectChange`, `DraftRow.save`, `handleFillWeek`) is untouched.
- No new hardcoded colours beyond the existing overtime amber (`#fbf3e6`/`#e3cfa6`/`#8a6a3a`) already used for category styling.
- `categoryLabel()` is available for any later spot that needs a value→label map (timesheet/HR reports), keeping the 11 reasons consistent everywhere.
