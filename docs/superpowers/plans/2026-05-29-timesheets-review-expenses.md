# Timesheets Review & Expenses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the Timesheets feature with server-side security and usability fixes, then add an Expenses tab allowing staff to submit ad-hoc expense claims for admin review.

**Architecture:** Security fixes add validation and lock-checking to existing server endpoints. Usability fixes extend existing client components in-place. The Expenses feature introduces one new server section (~200 lines added to `server/index.js`), one new client component (`ExpensesTab.jsx`), and tab-bar routing in `TimesheetsSection.jsx`.

**Tech Stack:** React (CRA), Express/Node.js, Supabase (PostgreSQL), Cloudflare R2, Resend (email), existing `api()` and `apiBlob()` client helpers.

---

## File Map

| File | Change |
|---|---|
| Supabase SQL Editor | Run 4 migration statements |
| `server/index.js` | Add helpers + modify 4 existing endpoints + add ~14 new endpoints + Resend setup |
| `client/src/components/TimesheetsSection.jsx` | Tab bar, delete confirmation, reject flow, unsubmit request, admin expenses toggle |
| `client/src/components/TimesheetHistory.jsx` | Pagination (6-week cursor) |
| `client/src/components/ExpensesTab.jsx` | New component — full expenses UI |

---

## Task 1: Database migrations

**Files:**
- Supabase SQL Editor (no local files changed)

- [ ] **Step 1: Open the Supabase SQL Editor for the Archimind project**

- [ ] **Step 2: Run the timesheet_submissions column additions**

```sql
ALTER TABLE timesheet_submissions
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS unlock_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unlock_reason text;
```

Expected: no error, columns added.

- [ ] **Step 3: Run the project_expenses table creation**

```sql
CREATE TABLE IF NOT EXISTS project_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  expense_type text NOT NULL CHECK (expense_type IN ('train','mileage','meals','taxi','parking')),
  expense_date date NOT NULL,
  amount_pence integer,
  miles numeric(6,1),
  description text NOT NULL,
  receipt_key text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  rejection_reason text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE project_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access" ON project_expenses USING (true) WITH CHECK (true);
```

Expected: table created, RLS enabled.

- [ ] **Step 4: Verify in Supabase Table Editor**

Open Table Editor, confirm `project_expenses` appears and `timesheet_submissions` has the 3 new columns.

---

## Task 2: Server validation helpers

**Files:**
- Modify: `server/index.js` — add 3 helper functions just before the `// ── Timesheets ──` comment at line ~3764

- [ ] **Step 1: Open `server/index.js` and locate the timesheets section comment**

Search for `// ── Timesheets ──` at around line 3764.

- [ ] **Step 2: Insert the three helper functions immediately before that comment**

```js
// ── Timesheet helpers ─────────────────────────────────────────────────────────

function getWeekStart(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split("T")[0];
}

async function getWeekLockStatus(userId, weekStart) {
  const { data } = await supabase
    .from("timesheet_submissions")
    .select("status")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (data?.status === "submitted" || data?.status === "approved") return data.status;
  return null;
}

function validateTimesheetFields({ hours, minutes, entry_date } = {}) {
  if (entry_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) return "entry_date must be YYYY-MM-DD";
    const d = new Date(entry_date + "T12:00:00Z");
    if (isNaN(d.getTime())) return "entry_date is not a valid date";
    const day = d.getUTCDay();
    if (day === 0 || day === 6) return "entry_date must be a weekday (Monday–Friday)";
  }
  if (hours !== undefined) {
    const h = Number(hours);
    if (!Number.isInteger(h) || h < 0 || h > 16) return "hours must be an integer between 0 and 16";
  }
  if (minutes !== undefined) {
    const m = Number(minutes);
    if (![0, 15, 30, 45].includes(m)) return "minutes must be 0, 15, 30, or 45";
  }
  return null;
}
```

- [ ] **Step 3: Verify the server still starts**

In the `server/` directory run `node index.js` (or check Railway logs if testing on the deployed version). Expected: no syntax errors on startup. Kill with Ctrl+C.

- [ ] **Step 4: Stage and commit in GitHub Desktop**

Files: `server/index.js`
Message: `feat: add timesheet server validation helpers`

---

## Task 3: Security — lock enforcement on POST /api/timesheets

**Files:**
- Modify: `server/index.js` — replace the existing `app.post("/api/timesheets", ...)` handler (~line 3817)

- [ ] **Step 1: Locate the existing POST handler**

Find `app.post("/api/timesheets", requireAuth, async (req, res) => {` at around line 3817.

- [ ] **Step 2: Replace the entire handler with the hardened version**

```js
app.post("/api/timesheets", requireAuth, async (req, res) => {
  const { project_id, category, entry_date, hours = 0, minutes = 0, notes } = req.body;
  if (!entry_date) return res.status(400).json({ error: "entry_date required" });
  if (!project_id && !category) return res.status(400).json({ error: "project_id or category required" });

  const validErr = validateTimesheetFields({ entry_date, hours, minutes });
  if (validErr) return res.status(400).json({ error: validErr });

  const weekStart = getWeekStart(entry_date);
  const lockStatus = await getWeekLockStatus(req.user.id, weekStart);
  if (lockStatus) return res.status(403).json({ error: `Week is ${lockStatus} — entries cannot be added` });

  const { data, error } = await supabase
    .from("timesheets")
    .insert({
      user_id: req.user.id,
      project_id: project_id || null,
      category: category || null,
      entry_date,
      hours: Number(hours),
      minutes: Number(minutes),
      notes: notes || null,
    })
    .select("*, projects(id, name, job_number)")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
```

- [ ] **Step 3: Manual test**

In the browser, open the current week's timesheet, add an entry, submit the timesheet, then try to add another entry. Expected: the UI prevents this (already locked client-side). To test the server fix, submit the week first, then open the browser console and run:

```js
await fetch("/api/timesheets", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (await supabase.auth.getSession()).data.session.access_token },
  body: JSON.stringify({ entry_date: "2026-05-26", hours: 8, minutes: 0, category: "internal" })
}).then(r => r.json())
```

Expected: `{ error: "Week is submitted — entries cannot be added" }` (or "approved").

- [ ] **Step 4: Stage and commit in GitHub Desktop**

Files: `server/index.js`
Message: `fix: enforce timesheet week lock on POST with date/hours validation`

---

## Task 4: Security — lock enforcement on PUT and DELETE

**Files:**
- Modify: `server/index.js` — replace the existing PUT and DELETE handlers (~lines 3855–3883)

- [ ] **Step 1: Replace the PUT handler**

Find `app.put("/api/timesheets/:id", requireAuth, ...` and replace with:

```js
app.put("/api/timesheets/:id", requireAuth, async (req, res) => {
  const { data: existing } = await supabase
    .from("timesheets")
    .select("user_id, entry_date")
    .eq("id", req.params.id)
    .single();
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.user_id !== req.user.id) return res.status(403).json({ error: "Not authorised" });

  const weekStart = getWeekStart(existing.entry_date);
  const lockStatus = await getWeekLockStatus(req.user.id, weekStart);
  if (lockStatus) return res.status(403).json({ error: `Week is ${lockStatus} — entries cannot be modified` });

  if ("hours" in req.body) {
    const err = validateTimesheetFields({ hours: req.body.hours });
    if (err) return res.status(400).json({ error: err });
  }
  if ("minutes" in req.body) {
    const err = validateTimesheetFields({ minutes: req.body.minutes });
    if (err) return res.status(400).json({ error: err });
  }

  const updates = { updated_at: new Date().toISOString() };
  if ("hours"      in req.body) updates.hours      = Number(req.body.hours);
  if ("minutes"    in req.body) updates.minutes    = Number(req.body.minutes);
  if ("notes"      in req.body) updates.notes      = req.body.notes ?? null;
  if ("project_id" in req.body) updates.project_id = req.body.project_id || null;
  if ("category"   in req.body) updates.category   = req.body.category  || null;

  const { data, error } = await supabase
    .from("timesheets")
    .update(updates)
    .eq("id", req.params.id)
    .select("*, projects(id, name, job_number)")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
```

- [ ] **Step 2: Replace the DELETE handler**

Find `app.delete("/api/timesheets/:id", requireAuth, ...` and replace with:

```js
app.delete("/api/timesheets/:id", requireAuth, async (req, res) => {
  const { data: existing } = await supabase
    .from("timesheets")
    .select("user_id, entry_date")
    .eq("id", req.params.id)
    .single();
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.user_id !== req.user.id) return res.status(403).json({ error: "Not authorised" });

  const weekStart = getWeekStart(existing.entry_date);
  const lockStatus = await getWeekLockStatus(req.user.id, weekStart);
  if (lockStatus) return res.status(403).json({ error: `Week is ${lockStatus} — entries cannot be deleted` });

  const { error } = await supabase.from("timesheets").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});
```

- [ ] **Step 3: Stage and commit in GitHub Desktop**

Files: `server/index.js`
Message: `fix: enforce timesheet week lock on PUT and DELETE`

---

## Task 5: Security — prevent approved→submitted downgrade

**Files:**
- Modify: `server/index.js` — replace `app.post("/api/timesheets/submit", ...)` (~line 3839)

- [ ] **Step 1: Replace the submit handler**

Find `app.post("/api/timesheets/submit", requireAuth, async (req, res) => {` and replace with:

```js
app.post("/api/timesheets/submit", requireAuth, async (req, res) => {
  const { week } = req.body;
  if (!week) return res.status(400).json({ error: "week required" });

  const { data: existing } = await supabase
    .from("timesheet_submissions")
    .select("status")
    .eq("user_id", req.user.id)
    .eq("week_start", week)
    .maybeSingle();
  if (existing?.status === "approved") {
    return res.status(403).json({ error: "This week has already been approved and cannot be resubmitted" });
  }

  const { data, error } = await supabase
    .from("timesheet_submissions")
    .upsert(
      { user_id: req.user.id, week_start: week, status: "submitted", submitted_at: new Date().toISOString(), rejection_reason: null },
      { onConflict: "user_id,week_start" }
    )
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
```

Note: `rejection_reason: null` clears any previous rejection when the user resubmits.

- [ ] **Step 2: Stage and commit in GitHub Desktop**

Files: `server/index.js`
Message: `fix: prevent resubmitting an already-approved timesheet week`

---

## Task 6: Usability — delete confirmation dialog

**Files:**
- Modify: `client/src/components/TimesheetsSection.jsx`

- [ ] **Step 1: Add a `handleDeleteWithConfirm` callback in `TimesheetsSection` (the main component)**

Find the existing `handleDelete` callback (~line 517). Directly after it, add:

```js
const handleDeleteWithConfirm = useCallback((id) => {
  setDialog({
    title: "Remove entry?",
    message: "This entry will be permanently deleted and cannot be undone.",
    confirmLabel: "Remove",
    onConfirm: () => { setDialog(null); handleDelete(id); },
  });
}, [handleDelete]);
```

- [ ] **Step 2: Pass `handleDeleteWithConfirm` to DayCard instead of `handleDelete`**

Find the `<DayCard` block inside the `DAYS.map(...)` at around line 712. Change `onDelete={handleDelete}` to `onDelete={handleDeleteWithConfirm}`.

- [ ] **Step 3: Verify in browser**

Open a draft timesheet, add an entry, click the × button. Expected: a confirmation dialog appears. Click Cancel — entry stays. Click × again, click Remove — entry is deleted.

- [ ] **Step 4: Stage and commit in GitHub Desktop**

Files: `client/src/components/TimesheetsSection.jsx`
Message: `feat: add delete confirmation dialog to timesheet entries`

---

## Task 7: Usability — admin timesheet rejection flow (server)

**Files:**
- Modify: `server/index.js` — add reject endpoint after the approve endpoint (~line 3910)

- [ ] **Step 1: Add the reject endpoint after `POST /api/admin/timesheets/approve`**

```js
app.post("/api/admin/timesheets/reject", requireAuth, requireAdmin, async (req, res) => {
  const { week, user_id, reason } = req.body;
  if (!week || !user_id) return res.status(400).json({ error: "week and user_id required" });
  if (!reason?.trim()) return res.status(400).json({ error: "rejection reason required" });
  const { data, error } = await supabase
    .from("timesheet_submissions")
    .update({
      status: "draft",
      rejection_reason: reason.trim(),
      reviewed_by: req.user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("user_id", user_id)
    .eq("week_start", week)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
```

- [ ] **Step 2: Stage and commit in GitHub Desktop**

Files: `server/index.js`
Message: `feat: add admin timesheet rejection endpoint`

---

## Task 8: Usability — admin rejection UI + rejection banner (client)

**Files:**
- Modify: `client/src/components/TimesheetsSection.jsx`

- [ ] **Step 1: Add `rejectingKey` and `rejectReason` state to `AdminPanel`**

Inside the `function AdminPanel({ projects })` component, find the existing `useState` declarations and add:

```js
const [rejectingKey, setRejectingKey] = useState(null);
const [rejectReason, setRejectReason] = useState("");
```

- [ ] **Step 2: Add `handleReject` function inside `AdminPanel`**

After the existing `handleApprove` function, add:

```js
const handleReject = async (sub) => {
  if (!rejectReason.trim()) return;
  const key = `${sub.user_id}|${sub.week_start}`;
  await api("/api/admin/timesheets/reject", { method: "POST", body: { week: sub.week_start, user_id: sub.user_id, reason: rejectReason.trim() } });
  setSubmissions(prev => prev.map(s =>
    s.user_id === sub.user_id && s.week_start === sub.week_start ? { ...s, status: "draft" } : s
  ));
  setRejectingKey(null);
  setRejectReason("");
  showToast("Timesheet returned to staff for correction.");
};
```

- [ ] **Step 3: Add Reject button alongside Approve in the admin row**

Find the `{sub.status === "submitted" && (` block (~line 402) that renders the Approve button. Replace the entire `{sub.status === "submitted" && ( ... )}` block with:

```jsx
{sub.status === "submitted" && rejectingKey !== key && (
  <>
    <button onClick={e => { e.stopPropagation(); handleApprove(sub); }}
      style={{ background: TIMESHEETS_FULL, color: "#fff", border: "none", padding: "4px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
      Approve
    </button>
    <button onClick={e => { e.stopPropagation(); setRejectingKey(key); setRejectReason(""); }}
      style={{ background: "#fff", border: `1px solid ${COMPARE_FULL}`, color: COMPARE_FULL, padding: "4px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
      Reject
    </button>
  </>
)}
{sub.status === "submitted" && rejectingKey === key && (
  <div onClick={e => e.stopPropagation()} style={{ display: "flex", gap: 6, alignItems: "center" }}>
    <input
      autoFocus
      value={rejectReason}
      onChange={e => setRejectReason(e.target.value)}
      placeholder="Reason for rejection…"
      style={{ fontSize: 12, padding: "3px 8px", border: "1px solid #d0d8de", width: 200 }}
    />
    <button onClick={() => handleReject(sub)} disabled={!rejectReason.trim()}
      style={{ background: rejectReason.trim() ? COMPARE_FULL : "#ccc", color: "#fff", border: "none", padding: "4px 10px", fontSize: 12, cursor: rejectReason.trim() ? "pointer" : "default", fontWeight: 600 }}>
      Send
    </button>
    <button onClick={() => setRejectingKey(null)}
      style={{ background: "none", border: "none", color: "#aaa", fontSize: 16, cursor: "pointer", padding: "0 4px" }}>×</button>
  </div>
)}
```

- [ ] **Step 4: Show rejection banner to the staff member on their own timesheet**

In the main `TimesheetsSection` return, find the `{/* Week navigator */}` div. Directly above the week navigator div, add:

```jsx
{submission?.status === "draft" && submission?.rejection_reason && (
  <div style={{ marginBottom: 16, padding: "10px 16px", background: "#fdf0ee", borderLeft: `4px solid ${COMPARE_FULL}` }}>
    <span style={{ fontSize: 13, fontWeight: 600, color: COMPARE_FULL }}>Timesheet returned for correction — </span>
    <span style={{ fontSize: 13, color: "#4a5a6a" }}>{submission.rejection_reason}</span>
  </div>
)}
```

- [ ] **Step 5: Verify in browser (as admin)**

Open Admin Review, find a submitted timesheet, click Reject. Type a reason, click Send. Confirm status changes to Draft in the list. Log in as that staff member and open that week — confirm the red banner shows the reason.

- [ ] **Step 6: Stage and commit in GitHub Desktop**

Files: `client/src/components/TimesheetsSection.jsx`
Message: `feat: add admin timesheet rejection flow with reason banner`

---

## Task 9: Usability — history pagination

**Files:**
- Modify: `server/index.js` — replace `GET /api/timesheets/history`
- Modify: `client/src/components/TimesheetHistory.jsx`

- [ ] **Step 1: Replace the history server endpoint**

Find `app.get("/api/timesheets/history", requireAuth, async (req, res) => {` and replace the entire handler:

```js
app.get("/api/timesheets/history", requireAuth, async (req, res) => {
  const weeks = Math.min(parseInt(req.query.weeks) || 6, 52);
  const endDate = req.query.before
    ? new Date(req.query.before + "T12:00:00Z")
    : new Date();
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - weeks * 7);
  const endStr   = endDate.toISOString().split("T")[0];
  const startStr = startDate.toISOString().split("T")[0];

  const [{ data: entries, error }, { data: subs }] = await Promise.all([
    supabase.from("timesheets").select("*, projects(id, name, job_number)")
      .eq("user_id", req.user.id)
      .gte("entry_date", startStr).lte("entry_date", endStr)
      .order("entry_date", { ascending: false }),
    supabase.from("timesheet_submissions").select("week_start, status, rejection_reason")
      .eq("user_id", req.user.id)
      .gte("week_start", startStr).lte("week_start", endStr),
  ]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ entries: entries || [], submissions: subs || [], startStr });
});
```

- [ ] **Step 2: Update `TimesheetHistory.jsx` to paginate**

Replace the entire `useEffect` that calls the API (lines ~59–83) with:

```js
const [before, setBefore] = useState(null); // ISO date string cursor

useEffect(() => {
  setLoading(true);
  const url = before
    ? `/api/timesheets/history?weeks=6&before=${before}`
    : `/api/timesheets/history?weeks=6`;
  api(url).then(({ entries, submissions }) => {
    const byWeek = {};
    (entries || []).forEach(e => {
      const mon = isoDate(getMonday(e.entry_date));
      if (!byWeek[mon]) byWeek[mon] = [];
      byWeek[mon].push(e);
    });
    const subMap = {};
    (submissions || []).forEach(s => { subMap[s.week_start] = s.status; });

    const newWeeks = Object.keys(byWeek)
      .sort((a, b) => b.localeCompare(a))
      .map(mon => ({
        mondayStr: mon,
        entries:   byWeek[mon],
        status:    subMap[mon] || "draft",
        total:     byWeek[mon].reduce((s, e) => s + entryMins(e), 0),
      }));

    setWeeks(prev => {
      const existingKeys = new Set(prev.map(w => w.mondayStr));
      const fresh = newWeeks.filter(w => !existingKeys.has(w.mondayStr));
      return [...prev, ...fresh].sort((a, b) => b.mondayStr.localeCompare(a.mondayStr));
    });
  }).catch(() => {}).finally(() => setLoading(false));
}, [before]);
```

- [ ] **Step 3: Add the "Load more" control at the bottom of the table in `TimesheetHistory.jsx`**

After the closing `</table>` tag (inside the `!loading && weeks.length > 0` block), add:

```jsx
<div style={{ padding: "12px 16px", borderTop: "1px solid #eef2f4", display: "flex", justifyContent: "center" }}>
  <button
    onClick={() => {
      const oldest = weeks[weeks.length - 1]?.mondayStr;
      if (oldest) setBefore(oldest);
    }}
    disabled={loading}
    style={{ fontSize: 12, padding: "5px 20px", border: `1px solid ${TIMESHEETS_FULL}`, color: TIMESHEETS_FULL, background: "#fff", cursor: "pointer" }}>
    {loading ? "Loading…" : "Load more"}
  </button>
</div>
```

- [ ] **Step 4: Verify in browser**

Open View History. Confirm it loads 6 weeks. Click "Load more" — confirms next 6 weeks append to the list.

- [ ] **Step 5: Stage and commit in GitHub Desktop**

Files: `server/index.js`, `client/src/components/TimesheetHistory.jsx`
Message: `feat: paginate timesheet history to 6 weeks with load-more`

---

## Task 10: Usability — DraftRow debounce

**Files:**
- Modify: `client/src/components/TimesheetsSection.jsx`

- [ ] **Step 1: Add `useRef` to the React import at the top of `TimesheetsSection.jsx`**

Change:
```js
import React, { useState, useEffect, useCallback } from "react";
```
To:
```js
import React, { useState, useEffect, useCallback, useRef } from "react";
```

- [ ] **Step 2: Add a `saveTimerRef` inside the `DraftRow` component**

Find `function DraftRow({ projects, onCreate }) {` and inside the component body, after the `useState` lines, add:

```js
const saveTimerRef = useRef(null);
```

- [ ] **Step 3: Replace the `save` callback in `DraftRow` with a debounced version**

Find the existing `const save = useCallback(async (selVal, h, m, n) => {` inside `DraftRow` and replace the entire callback with:

```js
const save = useCallback((selVal, h, m, n) => {
  const isDefault = !selVal && h === 0 && m === 0;
  if (isDefault) return;
  clearTimeout(saveTimerRef.current);
  saveTimerRef.current = setTimeout(async () => {
    if (saving) return;
    setSaving(true);
    const project_id = selVal && !selVal.startsWith("cat:") ? selVal : null;
    const category   = selVal && selVal.startsWith("cat:") ? selVal.replace("cat:", "") : (!selVal ? "internal" : null);
    await onCreate({ project_id, category, hours: h, minutes: m, notes: n || null });
  }, 300);
}, [saving, onCreate]);
```

- [ ] **Step 4: Verify in browser**

Open an empty week. On any empty day, quickly change the project dropdown then immediately change hours. Confirm only one entry is created (not two or three).

- [ ] **Step 5: Stage and commit in GitHub Desktop**

Files: `client/src/components/TimesheetsSection.jsx`
Message: `fix: debounce DraftRow save to prevent duplicate API calls`

---

## Task 11: Resend email setup

**Files:**
- Modify: `server/package.json` and `server/index.js`

- [ ] **Step 1: Install the Resend package**

Open a terminal in `C:\Users\ngree\Archimind\Vaultmind\server\` and run:

```
npm install resend
```

Expected: `resend` appears in `node_modules` and `package.json` dependencies.

- [ ] **Step 2: Add Resend initialisation and `sendEmail` helper near the top of `server/index.js`**

Find the line `const { S3Client, ...` imports at the top of the file. After all the existing `require` statements (around line 20), add:

```js
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping:", subject);
    return;
  }
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM || "Archimind <noreply@example.com>",
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    });
  } catch (err) {
    console.error("[email] Send failed:", err.message);
    // Non-fatal — email failure does not break the API response
  }
}

async function getAdminEmails() {
  const { data } = await supabase.auth.admin.listUsers();
  return (data?.users || [])
    .filter(u => u.user_metadata?.role === "admin")
    .map(u => u.email)
    .filter(Boolean);
}
```

- [ ] **Step 3: Set environment variables on Railway**

In Railway, add to the server service:
- `RESEND_API_KEY` — your Resend API key (from resend.com dashboard)
- `RESEND_FROM` — e.g. `Archimind <timesheets@yourpractice.co.uk>`

These are not needed locally for now — `sendEmail` safely no-ops if the key is absent.

- [ ] **Step 4: Verify server starts without error**

Run `node index.js` in the server directory. Expected: no `Cannot find module 'resend'` error. Kill with Ctrl+C.

- [ ] **Step 5: Stage and commit in GitHub Desktop**

Files: `server/index.js`, `server/package.json`, `server/package-lock.json`
Message: `feat: add Resend email helper and getAdminEmails utility`

---

## Task 12: Usability — unsubmit request flow

**Files:**
- Modify: `server/index.js` — add 2 endpoints
- Modify: `client/src/components/TimesheetsSection.jsx` — request button + dialog + admin unlock

- [ ] **Step 1: Add the two server endpoints after `POST /api/admin/timesheets/reject`**

```js
// POST /api/timesheets/unlock-request  — must be before /:id route
app.post("/api/timesheets/unlock-request", requireAuth, async (req, res) => {
  const { week, reason } = req.body;
  if (!week) return res.status(400).json({ error: "week required" });
  if (!reason?.trim()) return res.status(400).json({ error: "reason required" });

  const { data: sub } = await supabase
    .from("timesheet_submissions")
    .select("status")
    .eq("user_id", req.user.id)
    .eq("week_start", week)
    .maybeSingle();
  if (!sub || (sub.status !== "submitted" && sub.status !== "approved")) {
    return res.status(400).json({ error: "No locked timesheet found for this week" });
  }

  const { error } = await supabase
    .from("timesheet_submissions")
    .update({ unlock_requested: true, unlock_reason: reason.trim() })
    .eq("user_id", req.user.id)
    .eq("week_start", week);
  if (error) return res.status(500).json({ error: error.message });

  // Email admin
  const adminEmails = await getAdminEmails();
  if (adminEmails.length) {
    const weekDate = new Date(week + "T12:00:00Z");
    const fri = new Date(weekDate); fri.setUTCDate(fri.getUTCDate() + 4);
    const o = { day: "numeric", month: "short" };
    const weekStr = `${weekDate.toLocaleDateString("en-GB", o)} – ${fri.toLocaleDateString("en-GB", { ...o, year: "numeric" })}`;
    await sendEmail({
      to: adminEmails,
      subject: `Timesheet edit request — ${req.user.email}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;"><div style="background:#4c6278;padding:16px 24px;"><span style="color:#fff;font-size:14px;font-weight:600;">Archimind — Timesheets</span></div><div style="padding:24px;border:1px solid #dde4e8;border-top:none;"><p style="margin:0 0 16px;font-size:15px;color:#262830;"><strong>${req.user.email}</strong> has requested to edit their timesheet for <strong>${weekStr}</strong>.</p><p style="font-size:13px;color:#6a8a9a;margin:0 0 6px;">Reason:</p><p style="margin:0;font-size:13px;color:#262830;padding:10px 14px;background:#f1f2f4;border-left:3px solid #4c6278;">${reason.trim()}</p></div></div>`,
      text: `Timesheet edit request from ${req.user.email}\n\nWeek: ${weekStr}\nReason: ${reason.trim()}`,
    });
  }

  res.json({ ok: true });
});

app.post("/api/admin/timesheets/unlock", requireAuth, requireAdmin, async (req, res) => {
  const { week, user_id } = req.body;
  if (!week || !user_id) return res.status(400).json({ error: "week and user_id required" });
  const { error } = await supabase
    .from("timesheet_submissions")
    .update({ status: "draft", unlock_requested: false, unlock_reason: null, rejection_reason: null })
    .eq("user_id", user_id)
    .eq("week_start", week);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});
```

- [ ] **Step 2: Add `showUnlockDialog`, `unlockReason`, `unlocking` state to `TimesheetsSection`**

Find the state declarations near the top of the main `TimesheetsSection` export function and add:

```js
const [showUnlockDialog, setShowUnlockDialog] = useState(false);
const [unlockReason,     setUnlockReason]     = useState("");
const [unlocking,        setUnlocking]        = useState(false);
```

- [ ] **Step 3: Add `handleUnlockRequest` callback in `TimesheetsSection`**

After the `handleSubmitClick` function, add:

```js
const handleUnlockRequest = useCallback(async () => {
  if (!unlockReason.trim()) return;
  setUnlocking(true);
  try {
    await api("/api/timesheets/unlock-request", { method: "POST", body: { week: weekKey, reason: unlockReason.trim() } });
    setSubmission(prev => ({ ...prev, unlock_requested: true }));
    setShowUnlockDialog(false);
    setUnlockReason("");
    showToast("Edit request sent to admin.");
  } catch {
    showToast("Could not send request.");
  } finally {
    setUnlocking(false);
  }
}, [unlockReason, weekKey, showToast]);
```

- [ ] **Step 4: Add the unlock dialog and "Request to Edit" button to the JSX**

In the main return block, after the existing `{dialog && <ConfirmDialog ... />}` block, add:

```jsx
{showUnlockDialog && (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9998 }}>
    <div style={{ background: "#fff", padding: 28, maxWidth: 440, width: "90%", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 600, color: DESIGN_TEXT }}>Request to Edit Timesheet</h3>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#4a5a6a", lineHeight: 1.6 }}>
        Explain why you need to edit this week. Your request will be sent to the admin for approval.
      </p>
      <textarea value={unlockReason} onChange={e => setUnlockReason(e.target.value)}
        placeholder="e.g. I put the wrong project on Tuesday"
        rows={3}
        style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #d0d8de", resize: "vertical", fontFamily: "Inter, Arial, sans-serif", boxSizing: "border-box" }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
        <button onClick={() => { setShowUnlockDialog(false); setUnlockReason(""); }}
          style={{ background: "#fff", border: "1px solid #e4e4e8", color: "#666", padding: "7px 18px", fontSize: 13, cursor: "pointer" }}>
          Cancel
        </button>
        <button onClick={handleUnlockRequest} disabled={!unlockReason.trim() || unlocking}
          style={{ background: unlockReason.trim() ? TIMESHEETS_FULL : "#ccc", border: "none", color: "#fff", padding: "7px 18px", fontSize: 13, cursor: unlockReason.trim() ? "pointer" : "default", fontWeight: 600 }}>
          {unlocking ? "Sending…" : "Send Request"}
        </button>
      </div>
    </div>
  </div>
)}
```

In the footer section (inside `{submission?.status === "submitted" && ...}` and `{submission?.status === "approved" && ...}` blocks), add the Request to Edit button to both. In the submitted block change:

```jsx
{submission?.status === "submitted" && (
  <>
    <span style={{ fontSize: 13, color: "#b07800" }}>Awaiting approval</span>
    <button onClick={nextWeek} ...>Next week →</button>
  </>
)}
```
to:
```jsx
{submission?.status === "submitted" && (
  <>
    <span style={{ fontSize: 13, color: "#b07800" }}>Awaiting approval</span>
    {!submission?.unlock_requested
      ? <button onClick={() => setShowUnlockDialog(true)}
          style={{ ...btnBase, background: "#fff", color: "#8a9aa8", border: "1px solid #dde4e8", padding: "5px 12px", fontSize: 11 }}>
          Request to Edit
        </button>
      : <span style={{ fontSize: 12, color: "#8a9aa8", fontStyle: "italic" }}>Edit request pending…</span>
    }
    <button onClick={nextWeek} style={{ ...btnBase, background: "#fff", color: TIMESHEETS_FULL, border: `1px solid ${TIMESHEETS_FULL}`, padding: "6px 16px", fontSize: 12 }}>
      Next week →
    </button>
  </>
)}
```

Apply the same `Request to Edit` addition to the `submission?.status === "approved"` block.

- [ ] **Step 5: Add Unlock button in AdminPanel**

Inside `AdminPanel`, add `handleUnlock` after `handleReject`:

```js
const handleUnlock = async (sub) => {
  await api("/api/admin/timesheets/unlock", { method: "POST", body: { week: sub.week_start, user_id: sub.user_id } });
  setSubmissions(prev => prev.map(s =>
    s.user_id === sub.user_id && s.week_start === sub.week_start
      ? { ...s, status: "draft", unlock_requested: false, unlock_reason: null }
      : s
  ));
  showToast("Timesheet unlocked for editing.");
};
```

In the admin row header div (where Approve/Reject appear), add after those buttons:

```jsx
{sub.unlock_requested && (
  <>
    <span style={{ fontSize: 10, background: "#fff8e1", color: "#b07800", border: "1px solid #b0780044", padding: "2px 8px", letterSpacing: ".05em", fontWeight: 600 }}>
      EDIT REQUESTED
    </span>
    <button onClick={e => { e.stopPropagation(); handleUnlock(sub); }}
      style={{ background: TIMESHEETS_FULL, color: "#fff", border: "none", padding: "4px 12px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
      Unlock
    </button>
  </>
)}
```

To show the unlock reason when the row is expanded, inside the `{isOpen && (` expanded detail block, add before the `{DAYS.map(...)}`:

```jsx
{sub.unlock_reason && (
  <div style={{ marginBottom: 10, padding: "8px 12px", background: "#fff8e1", borderLeft: "3px solid #b07800", fontSize: 12 }}>
    <strong style={{ color: "#b07800" }}>Edit request: </strong>
    <span style={{ color: "#4a5a6a" }}>{sub.unlock_reason}</span>
  </div>
)}
```

- [ ] **Step 6: Verify in browser**

Log in as staff, submit a week, click "Request to Edit", type a reason, click Send. Confirm toast shows. Log in as admin, see the "EDIT REQUESTED" badge on that row. Click Unlock. Log back in as staff — confirm the week is back to Draft and editable.

- [ ] **Step 7: Stage and commit in GitHub Desktop**

Files: `server/index.js`, `client/src/components/TimesheetsSection.jsx`
Message: `feat: unsubmit request flow — staff request, admin unlocks`

---

## Task 13: Expenses — server endpoints

**Files:**
- Modify: `server/index.js` — add expenses section after the admin timesheets section (~after line 3951)

- [ ] **Step 1: Add the entire expenses server section**

After the `// ── Quiz endpoints ──` comment, insert a new expenses section. Add this block before it:

```js
// ── Expenses ──────────────────────────────────────────────────────────────────

const VALID_EXPENSE_TYPES = ["train", "mileage", "meals", "taxi", "parking"];

async function getMileageRatePpm() {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "mileage_rate_ppm").maybeSingle();
  return parseInt(data?.value) || 45;
}

// GET /api/expenses/settings  — must be before /api/expenses/:id
app.get("/api/expenses/settings", requireAuth, async (req, res) => {
  res.json({ mileage_rate_ppm: await getMileageRatePpm() });
});

// GET /api/expenses
app.get("/api/expenses", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("project_expenses")
    .select("*, projects(id, name, job_number)")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/expenses
app.post("/api/expenses", requireAuth, async (req, res) => {
  const { project_id, expense_type, expense_date, amount_pence, miles, description } = req.body;
  if (!project_id) return res.status(400).json({ error: "project_id required" });
  if (!VALID_EXPENSE_TYPES.includes(expense_type)) return res.status(400).json({ error: "Invalid expense_type" });
  if (!expense_date || !/^\d{4}-\d{2}-\d{2}$/.test(expense_date)) return res.status(400).json({ error: "expense_date required (YYYY-MM-DD)" });
  const expD = new Date(expense_date + "T12:00:00Z");
  if (isNaN(expD.getTime())) return res.status(400).json({ error: "Invalid expense_date" });
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (expD > tomorrow) return res.status(400).json({ error: "expense_date cannot be in the future" });
  if (!description?.trim()) return res.status(400).json({ error: "description required" });

  let computedPence;
  let computedMiles = null;
  if (expense_type === "mileage") {
    const m = Number(miles);
    if (!m || m <= 0) return res.status(400).json({ error: "miles required for mileage expenses" });
    const rate = await getMileageRatePpm();
    computedPence = Math.round(m * rate);
    computedMiles = m;
  } else {
    const p = Number(amount_pence);
    if (!p || p <= 0) return res.status(400).json({ error: "amount_pence required" });
    computedPence = Math.round(p);
  }

  const { data, error } = await supabase
    .from("project_expenses")
    .insert({
      user_id: req.user.id,
      project_id,
      expense_type,
      expense_date,
      amount_pence: computedPence,
      miles: computedMiles,
      description: description.trim(),
      status: "pending",
    })
    .select("*, projects(id, name, job_number)")
    .single();
  if (error) return res.status(500).json({ error: error.message });

  // Notify admin
  const adminEmails = await getAdminEmails();
  if (adminEmails.length) {
    const typeLbl = { train:"Train",mileage:"Car Mileage",meals:"Meals",taxi:"Taxi",parking:"Parking" }[expense_type] || expense_type;
    const amtStr  = `£${(computedPence / 100).toFixed(2)}`;
    const miStr   = computedMiles ? ` (${computedMiles} miles)` : "";
    const projStr = data.projects?.job_number ? `${data.projects.job_number} — ${data.projects.name}` : data.projects?.name || "—";
    const dateStr = expD.toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" });
    await sendEmail({
      to: adminEmails,
      subject: `New expense — ${req.user.email.split("@")[0]} · ${typeLbl} · ${amtStr}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;"><div style="background:#4c6278;padding:16px 24px;"><span style="color:#fff;font-size:14px;font-weight:600;">Archimind — Expenses</span></div><div style="padding:24px;border:1px solid #dde4e8;border-top:none;"><p style="margin:0 0 20px;font-size:15px;color:#262830;"><strong>${req.user.email}</strong> submitted an expense for review.</p><table style="width:100%;font-size:13px;border-collapse:collapse;"><tr><td style="padding:5px 0;color:#6a8a9a;width:110px;">Type</td><td style="padding:5px 0;color:#262830;font-weight:600;">${typeLbl}</td></tr><tr><td style="padding:5px 0;color:#6a8a9a;">Date</td><td style="padding:5px 0;color:#262830;">${dateStr}</td></tr><tr><td style="padding:5px 0;color:#6a8a9a;">Project</td><td style="padding:5px 0;color:#262830;">${projStr}</td></tr><tr><td style="padding:5px 0;color:#6a8a9a;">Amount</td><td style="padding:5px 0;color:#262830;font-weight:600;">${amtStr}${miStr}</td></tr><tr><td style="padding:5px 0;color:#6a8a9a;">Description</td><td style="padding:5px 0;color:#262830;">${data.description}</td></tr></table></div></div>`,
      text: `New expense from ${req.user.email}\nType: ${typeLbl}\nDate: ${dateStr}\nProject: ${projStr}\nAmount: ${amtStr}${miStr}\nDescription: ${data.description}`,
    });
  }

  res.json(data);
});

// PUT /api/expenses/:id
app.put("/api/expenses/:id", requireAuth, async (req, res) => {
  const { data: existing } = await supabase.from("project_expenses").select("user_id, status, expense_type, miles").eq("id", req.params.id).single();
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.user_id !== req.user.id) return res.status(403).json({ error: "Not authorised" });
  if (existing.status !== "pending") return res.status(403).json({ error: "Only pending expenses can be edited" });

  const newType = req.body.expense_type || existing.expense_type;
  if ("expense_type" in req.body && !VALID_EXPENSE_TYPES.includes(req.body.expense_type)) {
    return res.status(400).json({ error: "Invalid expense_type" });
  }

  const updates = { updated_at: new Date().toISOString() };
  if ("expense_type"  in req.body) updates.expense_type  = req.body.expense_type;
  if ("expense_date"  in req.body) updates.expense_date  = req.body.expense_date;
  if ("description"   in req.body) updates.description   = req.body.description?.trim();
  if ("project_id"    in req.body) updates.project_id    = req.body.project_id;

  if (newType === "mileage") {
    const newMiles = "miles" in req.body ? Number(req.body.miles) : existing.miles;
    const rate = await getMileageRatePpm();
    updates.amount_pence = Math.round(newMiles * rate);
    updates.miles = newMiles;
  } else if ("amount_pence" in req.body) {
    updates.amount_pence = Math.round(Number(req.body.amount_pence));
    updates.miles = null;
  }

  const { data, error } = await supabase.from("project_expenses").update(updates).eq("id", req.params.id).select("*, projects(id, name, job_number)").single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/expenses/:id
app.delete("/api/expenses/:id", requireAuth, async (req, res) => {
  const { data: existing } = await supabase.from("project_expenses").select("user_id, status, receipt_key").eq("id", req.params.id).single();
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.user_id !== req.user.id) return res.status(403).json({ error: "Not authorised" });
  if (existing.status !== "pending") return res.status(403).json({ error: "Only pending expenses can be deleted" });

  if (existing.receipt_key) {
    try { await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: existing.receipt_key })); }
    catch (e) { console.error("R2 receipt delete error:", e.message); }
  }
  const { error } = await supabase.from("project_expenses").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// POST /api/expenses/:id/receipt
app.post("/api/expenses/:id/receipt", requireAuth, async (req, res) => {
  const { content, filename, mimeType } = req.body;
  if (!content || !filename) return res.status(400).json({ error: "content and filename required" });
  const { data: existing } = await supabase.from("project_expenses").select("user_id, status").eq("id", req.params.id).single();
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.user_id !== req.user.id) return res.status(403).json({ error: "Not authorised" });
  if (existing.status !== "pending") return res.status(403).json({ error: "Only pending expenses can have receipts updated" });

  const buffer = Buffer.from(content.replace(/^data:[^;]+;base64,/, ""), "base64");
  const key = `expenses/${req.user.id}/${req.params.id}/${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: mimeType || "application/octet-stream" }));
  const { error } = await supabase.from("project_expenses").update({ receipt_key: key, updated_at: new Date().toISOString() }).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, key });
});

// GET /api/expenses/:id/receipt
app.get("/api/expenses/:id/receipt", requireAuth, async (req, res) => {
  const { data: existing } = await supabase.from("project_expenses").select("user_id, receipt_key").eq("id", req.params.id).single();
  if (!existing?.receipt_key) return res.status(404).json({ error: "No receipt" });
  const isOwner = existing.user_id === req.user.id;
  const isAdm   = req.user?.user_metadata?.role === "admin";
  if (!isOwner && !isAdm) return res.status(403).json({ error: "Not authorised" });
  try {
    const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: existing.receipt_key }));
    const chunks = []; for await (const c of obj.Body) chunks.push(c);
    res.set("Content-Type", obj.ContentType || "application/octet-stream");
    res.set("Content-Disposition", `inline; filename="${existing.receipt_key.split("/").pop()}"`);
    res.send(Buffer.concat(chunks));
  } catch (e) {
    res.status(500).json({ error: "Could not retrieve receipt" });
  }
});

// ── Admin expenses ─────────────────────────────────────────────────────────────

// GET /api/admin/expenses/settings  — must be before /api/admin/expenses/:id
app.get("/api/admin/expenses/settings", requireAuth, requireAdmin, async (req, res) => {
  res.json({ mileage_rate_ppm: await getMileageRatePpm() });
});

// PUT /api/admin/expenses/settings
app.put("/api/admin/expenses/settings", requireAuth, requireAdmin, async (req, res) => {
  const rate = parseInt(req.body.mileage_rate_ppm);
  if (!Number.isInteger(rate) || rate < 1 || rate > 200) {
    return res.status(400).json({ error: "mileage_rate_ppm must be an integer between 1 and 200" });
  }
  const { error } = await supabase.from("app_settings").upsert(
    { key: "mileage_rate_ppm", value: String(rate), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, mileage_rate_ppm: rate });
});

// GET /api/admin/expenses
app.get("/api/admin/expenses", requireAuth, requireAdmin, async (req, res) => {
  const { status, user_id, from, to } = req.query;
  let query = supabase.from("project_expenses").select("*, projects(id, name, job_number)").order("created_at", { ascending: false });
  if (status)  query = query.eq("status", status);
  if (user_id) query = query.eq("user_id", user_id);
  if (from)    query = query.gte("expense_date", from);
  if (to)      query = query.lte("expense_date", to);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/admin/expenses/:id/approve  — must be before /api/admin/expenses/settings if defined after
app.post("/api/admin/expenses/:id/approve", requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("project_expenses")
    .update({ status: "approved", reviewed_by: req.user.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/admin/expenses/:id/reject
app.post("/api/admin/expenses/:id/reject", requireAuth, requireAdmin, async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: "reason required" });
  const { data, error } = await supabase
    .from("project_expenses")
    .update({ status: "rejected", rejection_reason: reason.trim(), reviewed_by: req.user.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
```

- [ ] **Step 2: Verify server starts without error**

Run `node index.js` in the server directory. Expected: clean startup. Kill with Ctrl+C.

- [ ] **Step 3: Stage and commit in GitHub Desktop**

Files: `server/index.js`, `server/package.json`, `server/package-lock.json`
Message: `feat: add all expenses server endpoints`

---

## Task 14: Expenses — tab bar in TimesheetsSection

**Files:**
- Modify: `client/src/components/TimesheetsSection.jsx`

- [ ] **Step 1: Add `activeTab` state and `ExpensesTab` import**

At the top of `TimesheetsSection.jsx`, add the import:

```js
import ExpensesTab from "./ExpensesTab";
```

Inside the main `TimesheetsSection` function, add the state after existing state declarations:

```js
const [activeTab, setActiveTab] = useState("timesheet"); // "timesheet" | "expenses"
```

- [ ] **Step 2: Add the tab bar to the JSX**

In the return block, after the white header bar `</div>` (the div containing the `<h2>Timesheets</h2>` and buttons), and before `<div style={{ flex: 1, overflow: "auto" }}>`, add:

```jsx
{view === "mine" && (
  <div style={{ background: "#fff", display: "flex", borderBottom: "2px solid #e0e4e8", flexShrink: 0 }}>
    {[{ key: "timesheet", label: "My Timesheet" }, { key: "expenses", label: "My Expenses" }].map(tab => (
      <button key={tab.key} onClick={() => setActiveTab(tab.key)}
        style={{
          fontSize: 12, padding: "9px 20px", border: "none", background: "none", cursor: "pointer",
          color: activeTab === tab.key ? TIMESHEETS_FULL : "#8a9aa8",
          fontWeight: activeTab === tab.key ? 700 : 500,
          borderBottom: activeTab === tab.key ? `2px solid ${TIMESHEETS_FULL}` : "2px solid transparent",
          marginBottom: -2, fontFamily: "Inter, Arial, sans-serif",
        }}>
        {tab.label}
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 3: Conditionally render ExpensesTab when active**

Find the `{view === "mine" ? (` block. Inside the mine view's `<div style={{ padding: "24px 32px" }}>`, wrap all existing content with `{activeTab === "timesheet" && ( ... )}` and add the ExpensesTab below:

```jsx
<div style={{ flex: 1, overflow: "auto" }}>
  {view === "admin" ? (
    /* existing AdminPanel block unchanged */
  ) : (
    <>
      {activeTab === "timesheet" && (
        <div style={{ padding: "24px 32px" }}>
          {/* ALL existing mine-view content goes here unchanged */}
        </div>
      )}
      {activeTab === "expenses" && (
        <ExpensesTab projects={projects} />
      )}
    </>
  )}
</div>
```

- [ ] **Step 4: Verify in browser**

Open Timesheets. Confirm a tab bar appears with "My Timesheet" and "My Expenses". Clicking each tab switches the view. The weekly timesheet still works correctly on the Timesheet tab.

- [ ] **Step 5: Stage and commit in GitHub Desktop**

Files: `client/src/components/TimesheetsSection.jsx`
Message: `feat: add My Timesheet / My Expenses tab bar`

---

## Task 15: Expenses — ExpensesTab.jsx

**Files:**
- Create: `client/src/components/ExpensesTab.jsx`

- [ ] **Step 1: Create the file**

```jsx
import React, { useState, useEffect, useCallback } from "react";
import { api, apiBlob } from "../api/client";
import { DESIGN_GROUND, DESIGN_TEXT, TIMESHEETS_FULL, COMPARE_FULL } from "../constants";

const EXPENSE_TYPES = [
  { value: "train",   label: "Train" },
  { value: "mileage", label: "Car Mileage" },
  { value: "meals",   label: "Meals" },
  { value: "taxi",    label: "Taxi" },
  { value: "parking", label: "Parking" },
];

function typeLabel(v) { return EXPENSE_TYPES.find(t => t.value === v)?.label || v; }

function formatAmount(expense) {
  const pounds = (expense.amount_pence / 100).toFixed(2);
  if (expense.expense_type === "mileage") return `£${pounds} (${expense.miles} mi)`;
  return `£${pounds}`;
}

function formatDate(d) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function StatusBadge({ status }) {
  const map = {
    pending:  { label: "Pending",  bg: "#fff8e1", color: "#b07800" },
    approved: { label: "Approved", bg: "#e8f5e9", color: "#2e7d32" },
    rejected: { label: "Rejected", bg: "#fdf0ee", color: "#9e4a3a" },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}44`, padding: "2px 8px", fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0 }}>
      {s.label}
    </span>
  );
}

export default function ExpensesTab({ projects }) {
  const [expenses,    setExpenses]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [filter,      setFilter]      = useState("all");
  const [mileageRate, setMileageRate] = useState(45);
  const [showForm,    setShowForm]    = useState(false);
  const [editingId,   setEditingId]   = useState(null);
  const [toast,       setToast]       = useState(null);
  const [confirmDel,  setConfirmDel]  = useState(null);

  // Form fields
  const [fType,    setFType]    = useState("train");
  const [fProject, setFProject] = useState("");
  const [fDate,    setFDate]    = useState(new Date().toISOString().split("T")[0]);
  const [fAmount,  setFAmount]  = useState("");
  const [fMiles,   setFMiles]   = useState("");
  const [fDesc,    setFDesc]    = useState("");
  const [fFile,    setFFile]    = useState(null); // { name, base64, mimeType }
  const [saving,   setSaving]   = useState(false);

  const showToast = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); }, []);

  useEffect(() => {
    Promise.all([api("/api/expenses"), api("/api/expenses/settings")])
      .then(([exp, settings]) => {
        setExpenses(exp || []);
        setMileageRate(settings?.mileage_rate_ppm || 45);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const resetForm = useCallback(() => {
    setEditingId(null); setFType("train"); setFProject(""); setFDate(new Date().toISOString().split("T")[0]);
    setFAmount(""); setFMiles(""); setFDesc(""); setFFile(null); setShowForm(false);
  }, []);

  const openEdit = useCallback((exp) => {
    setEditingId(exp.id);
    setFType(exp.expense_type);
    setFProject(exp.project_id);
    setFDate(exp.expense_date);
    if (exp.expense_type === "mileage") { setFMiles(String(exp.miles)); setFAmount(""); }
    else { setFAmount(String(exp.amount_pence / 100)); setFMiles(""); }
    setFDesc(exp.description);
    setFFile(null);
    setShowForm(true);
  }, []);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) { setFFile(null); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setFFile({ name: file.name, base64: ev.target.result, mimeType: file.type });
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!fProject) return showToast("Please select a project.");
    if (!fDesc.trim()) return showToast("Please enter a description.");
    if (fType === "mileage" && (!fMiles || Number(fMiles) <= 0)) return showToast("Please enter miles.");
    if (fType !== "mileage" && (!fAmount || Number(fAmount) <= 0)) return showToast("Please enter an amount.");

    setSaving(true);
    try {
      const body = {
        project_id: fProject, expense_type: fType, expense_date: fDate, description: fDesc.trim(),
        ...(fType === "mileage"
          ? { miles: Number(fMiles) }
          : { amount_pence: Math.round(Number(fAmount) * 100) }),
      };
      let saved;
      if (editingId) {
        saved = await api(`/api/expenses/${editingId}`, { method: "PUT", body });
        setExpenses(prev => prev.map(e => e.id === editingId ? saved : e));
      } else {
        saved = await api("/api/expenses", { method: "POST", body });
        setExpenses(prev => [saved, ...prev]);
      }
      if (fFile) {
        await api(`/api/expenses/${saved.id}/receipt`, {
          method: "POST",
          body: { content: fFile.base64, filename: fFile.name, mimeType: fFile.mimeType },
        });
        setExpenses(prev => prev.map(e => e.id === saved.id ? { ...e, receipt_key: saved.id } : e));
      }
      showToast(editingId ? "Expense updated." : "Expense submitted.");
      resetForm();
    } catch {
      showToast("Could not save expense.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api(`/api/expenses/${id}`, { method: "DELETE" });
      setExpenses(prev => prev.filter(e => e.id !== id));
      showToast("Expense deleted.");
    } catch { showToast("Could not delete expense."); }
    finally { setConfirmDel(null); }
  };

  const openReceipt = async (id) => {
    try {
      const res = await apiBlob(`/api/expenses/${id}/receipt`, null, "GET");
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank");
    } catch { showToast("Could not open receipt."); }
  };

  const filtered = filter === "all" ? expenses : expenses.filter(e => e.status === filter);
  const isMileage = fType === "mileage";
  const calcAmt   = isMileage && fMiles ? `= £${(Number(fMiles) * mileageRate / 100).toFixed(2)}` : "";

  const ss = { padding: "6px 8px", fontSize: 12, border: "1px solid #d0d8de", background: "#fff", color: DESIGN_TEXT, fontFamily: "Inter, Arial, sans-serif" };

  return (
    <div style={{ padding: "24px 32px" }}>
      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, background: DESIGN_TEXT, color: "#fff", padding: "10px 20px", fontSize: 13, zIndex: 9999 }}>{toast}</div>}

      {confirmDel && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9998 }}>
          <div style={{ background: "#fff", padding: 28, maxWidth: 400, width: "90%", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 600, color: DESIGN_TEXT }}>Delete expense?</h3>
            <p style={{ margin: "0 0 22px", fontSize: 13, color: "#4a5a6a" }}>This expense will be permanently deleted.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setConfirmDel(null)} style={{ background: "#fff", border: "1px solid #e4e4e8", color: "#666", padding: "7px 18px", fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => handleDelete(confirmDel)} style={{ background: COMPARE_FULL, border: "none", color: "#fff", padding: "7px 18px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div style={{ background: "#fff", border: "1px solid #dde4e8", padding: "18px 20px", marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 12, fontWeight: 700, color: DESIGN_TEXT, textTransform: "uppercase", letterSpacing: ".06em" }}>
            {editingId ? "Edit Expense" : "Add Expense"}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>Type</div>
              <select value={fType} onChange={e => setFType(e.target.value)} style={{ ...ss, width: "100%" }}>
                {EXPENSE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>Project</div>
              <select value={fProject} onChange={e => setFProject(e.target.value)} style={{ ...ss, width: "100%" }}>
                <option value="">— Select —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.job_number ? `${p.job_number} — ${p.name}` : p.name}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>Date</div>
              <input type="date" value={fDate} onChange={e => setFDate(e.target.value)} style={{ ...ss, width: "100%", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>
                {isMileage ? "Miles" : "Amount (£)"}
              </div>
              <input type="number" min="0" step={isMileage ? "1" : "0.01"}
                value={isMileage ? fMiles : fAmount}
                onChange={e => isMileage ? setFMiles(e.target.value) : setFAmount(e.target.value)}
                placeholder={isMileage ? "e.g. 42" : "e.g. 24.50"}
                style={{ ...ss, width: "100%", boxSizing: "border-box" }}
              />
              {isMileage && calcAmt && (
                <div style={{ fontSize: 10, color: TIMESHEETS_FULL, marginTop: 3, fontWeight: 600 }}>{calcAmt} @ {mileageRate}p/mi</div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>Description</div>
              <input type="text" value={fDesc} onChange={e => setFDesc(e.target.value)}
                placeholder="What was it for?"
                style={{ ...ss, width: "100%", boxSizing: "border-box" }}
              />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: ".06em" }}>Receipt (optional)</div>
              <label style={{ fontSize: 11, border: "1px dashed #d0d8de", color: "#8a9aa8", padding: "3px 10px", cursor: "pointer" }}>
                📎 {fFile ? fFile.name : "Attach file"}
                <input type="file" accept="image/*,.pdf" onChange={handleFileChange} style={{ display: "none" }} />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={resetForm} style={{ ...ss, background: "#fff", color: "#6a8a9a", cursor: "pointer" }}>Cancel</button>
              <button onClick={handleSubmit} disabled={saving}
                style={{ background: TIMESHEETS_FULL, color: "#fff", border: "none", padding: "6px 20px", fontSize: 12, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}>
                {saving ? "Saving…" : editingId ? "Save Changes" : "Submit Expense"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#6a8a9a", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>Filter:</span>
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{ ...ss, fontSize: 11 }}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        {!showForm && (
          <button onClick={() => { resetForm(); setShowForm(true); }}
            style={{ background: TIMESHEETS_FULL, color: "#fff", border: "none", padding: "6px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            + Add Expense
          </button>
        )}
      </div>

      {loading && <p style={{ color: "#6a8a9a", fontSize: 13 }}>Loading…</p>}
      {!loading && filtered.length === 0 && (
        <p style={{ color: "#6a8a9a", fontSize: 13 }}>
          {filter === "all" ? "No expenses yet. Click "+ Add Expense" to submit one." : `No ${filter} expenses.`}
        </p>
      )}

      {filtered.map(expense => (
        <div key={expense.id} style={{ background: "#fff", border: "1px solid #dde4e8", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: expense.status === "approved" ? "#2e7d32" : expense.status === "rejected" ? "#9e4a3a" : "#b07800", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: DESIGN_TEXT }}>{typeLabel(expense.expense_type)}</span>
                <span style={{ fontSize: 11, color: "#6a8a9a" }}>{formatDate(expense.expense_date)}</span>
                <span style={{ fontSize: 12, color: TIMESHEETS_FULL, fontWeight: 600 }}>{formatAmount(expense)}</span>
                <span style={{ fontSize: 11, color: "#6a8a9a", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{expense.description}</span>
              </div>
              <div style={{ fontSize: 10, color: "#8a9aa8" }}>
                {expense.projects?.job_number ? `${expense.projects.job_number} — ${expense.projects.name}` : expense.projects?.name || "—"}
              </div>
            </div>
            <StatusBadge status={expense.status} />
            {expense.receipt_key && (
              <button onClick={() => openReceipt(expense.id)} title="View receipt"
                style={{ fontSize: 14, color: "#8a9aa8", background: "none", border: "none", cursor: "pointer", padding: "0 2px" }}>📎</button>
            )}
            {expense.status === "pending" && (
              <>
                <button onClick={() => openEdit(expense)}
                  style={{ fontSize: 11, color: TIMESHEETS_FULL, background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: "0 4px" }}>
                  Edit
                </button>
                <button onClick={() => setConfirmDel(expense.id)}
                  style={{ fontSize: 18, color: "#bbb", background: "none", border: "none", cursor: "pointer", lineHeight: 1, padding: "0 4px", width: 28, flexShrink: 0 }}>
                  ×
                </button>
              </>
            )}
            {expense.status !== "pending" && <div style={{ width: 28 }} />}
          </div>
          {expense.status === "rejected" && expense.rejection_reason && (
            <div style={{ padding: "0 14px 10px 34px" }}>
              <div style={{ padding: "6px 10px", background: "#fdf0ee", borderLeft: "3px solid #9e4a3a", fontSize: 12, color: "#9e4a3a" }}>
                <strong>Reason: </strong>{expense.rejection_reason}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Click "My Expenses" tab. Click "+ Add Expense". Fill in all fields (try Train type with £24.50). Click Submit Expense. Confirm the new expense appears in the list with Pending status. Try attaching a receipt image — confirm the 📎 icon appears. Click it — receipt opens in a new tab.

Try "Car Mileage" type — confirm the field label changes to "Miles" and the calculated amount appears below (e.g. "= £18.90 @ 45p/mi").

Click Edit on a pending expense — confirm the form pre-fills. Click the × button — confirm the delete confirmation dialog appears.

- [ ] **Step 3: Stage and commit in GitHub Desktop**

Files: `client/src/components/ExpensesTab.jsx`
Message: `feat: add ExpensesTab component with add/edit/delete and receipt upload`

---

## Task 16: Expenses — admin expenses panel

**Files:**
- Modify: `client/src/components/TimesheetsSection.jsx`

- [ ] **Step 1: Add `AdminExpensesPanel` inner component before `AdminPanel`**

Find `function AdminPanel({ projects }) {` (~line 303). Directly before it, add:

```jsx
function AdminExpensesPanel({ users }) {
  const [expenses,      setExpenses]      = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [mileageRate,   setMileageRate]   = useState(45);
  const [editingRate,   setEditingRate]   = useState(false);
  const [newRate,       setNewRate]       = useState("");
  const [filterStatus,  setFilterStatus]  = useState("pending");
  const [rejectingId,   setRejectingId]   = useState(null);
  const [rejectReason,  setRejectReason]  = useState("");
  const [toast,         setToast]         = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const userEmail = (uid) => users.find(u => u.id === uid)?.email || uid.slice(0, 8) + "…";

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api(`/api/admin/expenses?status=${filterStatus}`),
      api("/api/admin/expenses/settings"),
    ]).then(([exp, settings]) => {
      setExpenses(exp || []);
      setMileageRate(settings?.mileage_rate_ppm || 45);
      setNewRate(String(settings?.mileage_rate_ppm || 45));
    }).catch(() => {}).finally(() => setLoading(false));
  }, [filterStatus]);

  const handleApprove = async (exp) => {
    await api(`/api/admin/expenses/${exp.id}/approve`, { method: "POST" });
    setExpenses(prev => prev.map(e => e.id === exp.id ? { ...e, status: "approved" } : e));
    showToast("Expense approved.");
  };

  const handleReject = async (exp) => {
    if (!rejectReason.trim()) return;
    await api(`/api/admin/expenses/${exp.id}/reject`, { method: "POST", body: { reason: rejectReason.trim() } });
    setExpenses(prev => prev.map(e => e.id === exp.id ? { ...e, status: "rejected", rejection_reason: rejectReason.trim() } : e));
    setRejectingId(null);
    setRejectReason("");
    showToast("Expense rejected.");
  };

  const handleSaveRate = async () => {
    const rate = parseInt(newRate);
    if (!rate || rate < 1) return;
    await api("/api/admin/expenses/settings", { method: "PUT", body: { mileage_rate_ppm: rate } });
    setMileageRate(rate);
    setEditingRate(false);
    showToast("Mileage rate updated.");
  };

  const formatAmt = (exp) => {
    const p = `£${(exp.amount_pence / 100).toFixed(2)}`;
    return exp.expense_type === "mileage" ? `${p} (${exp.miles} mi)` : p;
  };
  const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const typeLbl = { train:"Train", mileage:"Car Mileage", meals:"Meals", taxi:"Taxi", parking:"Parking" };

  const ss = { padding: "5px 10px", fontSize: 12, border: "1px solid #d0d8de", background: "#fff", color: DESIGN_TEXT, fontFamily: "Inter, Arial, sans-serif" };

  return (
    <div style={{ padding: "0 32px 32px" }}>
      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, background: DESIGN_TEXT, color: "#fff", padding: "10px 20px", fontSize: 13, zIndex: 9999 }}>{toast}</div>}

      {/* Mileage rate setting */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: DESIGN_GROUND, border: "1px solid #dde4e8", marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: "#6a8a9a", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>Mileage Rate</span>
        {!editingRate ? (
          <>
            <span style={{ fontSize: 13, color: DESIGN_TEXT, fontWeight: 600 }}>{mileageRate}p / mile (£{(mileageRate / 100).toFixed(2)})</span>
            <button onClick={() => setEditingRate(true)} style={{ background: "none", border: "none", color: TIMESHEETS_FULL, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Edit</button>
          </>
        ) : (
          <>
            <input type="number" value={newRate} onChange={e => setNewRate(e.target.value)} min="1" max="200"
              style={{ ...ss, width: 80 }} />
            <span style={{ fontSize: 12, color: "#6a8a9a" }}>p/mile</span>
            <button onClick={handleSaveRate} style={{ background: TIMESHEETS_FULL, color: "#fff", border: "none", padding: "4px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Save</button>
            <button onClick={() => setEditingRate(false)} style={{ background: "none", border: "none", color: "#aaa", fontSize: 12, cursor: "pointer" }}>Cancel</button>
          </>
        )}
      </div>

      {/* Filter */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: "#6a8a9a", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>Filter:</span>
        {["pending", "approved", "rejected", "all"].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            style={{ fontSize: 11, padding: "3px 12px", border: `1px solid ${filterStatus === s ? TIMESHEETS_FULL : "#d0d8de"}`, background: filterStatus === s ? TIMESHEETS_FULL : "#fff", color: filterStatus === s ? "#fff" : "#6a8a9a", cursor: "pointer", textTransform: "capitalize" }}>
            {s}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: "#6a8a9a", fontSize: 13 }}>Loading…</p>}
      {!loading && expenses.length === 0 && <p style={{ color: "#6a8a9a", fontSize: 13 }}>No expenses found.</p>}

      {expenses.map(exp => (
        <div key={exp.id} style={{ background: "#fff", border: "1px solid #dde4e8", marginBottom: 8, padding: "10px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: DESIGN_TEXT, minWidth: 120 }}>{userEmail(exp.user_id)}</span>
            <span style={{ fontSize: 12, color: "#6a8a9a" }}>{typeLbl[exp.expense_type] || exp.expense_type}</span>
            <span style={{ fontSize: 12, color: "#6a8a9a" }}>{fmtDate(exp.expense_date)}</span>
            <span style={{ fontSize: 12, color: TIMESHEETS_FULL, fontWeight: 600 }}>{formatAmt(exp)}</span>
            <span style={{ fontSize: 12, color: "#6a8a9a", flex: 1 }}>
              {exp.projects?.job_number ? `${exp.projects.job_number} — ${exp.projects.name}` : exp.projects?.name}
            </span>
            <span style={{ fontSize: 12, color: "#6a8a9a", fontStyle: "italic" }}>{exp.description}</span>
            {exp.receipt_key && (
              <a href={`/api/expenses/${exp.id}/receipt`} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 12, color: TIMESHEETS_FULL }}>📎 receipt</a>
            )}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
              {exp.status === "pending" && rejectingId !== exp.id && (
                <>
                  <button onClick={() => handleApprove(exp)}
                    style={{ background: TIMESHEETS_FULL, color: "#fff", border: "none", padding: "4px 12px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                    Approve
                  </button>
                  <button onClick={() => { setRejectingId(exp.id); setRejectReason(""); }}
                    style={{ background: "#fff", border: `1px solid ${COMPARE_FULL}`, color: COMPARE_FULL, padding: "4px 12px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                    Reject
                  </button>
                </>
              )}
              {exp.status === "pending" && rejectingId === exp.id && (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input autoFocus value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                    placeholder="Reason…"
                    style={{ fontSize: 11, padding: "3px 8px", border: "1px solid #d0d8de", width: 180 }}
                  />
                  <button onClick={() => handleReject(exp)} disabled={!rejectReason.trim()}
                    style={{ background: rejectReason.trim() ? COMPARE_FULL : "#ccc", color: "#fff", border: "none", padding: "3px 10px", fontSize: 11, cursor: rejectReason.trim() ? "pointer" : "default", fontWeight: 600 }}>
                    Send
                  </button>
                  <button onClick={() => setRejectingId(null)}
                    style={{ background: "none", border: "none", color: "#aaa", fontSize: 16, cursor: "pointer" }}>×</button>
                </div>
              )}
              {exp.status !== "pending" && (
                <span style={{ fontSize: 11, fontWeight: 600, color: exp.status === "approved" ? "#2e7d32" : "#9e4a3a", textTransform: "uppercase" }}>
                  {exp.status}
                </span>
              )}
            </div>
          </div>
          {exp.rejection_reason && (
            <div style={{ marginTop: 6, padding: "5px 10px", background: "#fdf0ee", borderLeft: "3px solid #9e4a3a", fontSize: 11, color: "#9e4a3a" }}>
              <strong>Reason: </strong>{exp.rejection_reason}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add a `Timesheets | Expenses` toggle to `AdminPanel`**

Inside `AdminPanel`, add `adminView` state:

```js
const [adminView, setAdminView] = useState("timesheets"); // "timesheets" | "expenses"
```

At the top of the `AdminPanel` return, before the filter bar div, add:

```jsx
{/* Admin view toggle */}
<div style={{ padding: "16px 32px 0", display: "flex", gap: 0 }}>
  {["timesheets", "expenses"].map(v => (
    <button key={v} onClick={() => setAdminView(v)}
      style={{
        fontSize: 12, padding: "7px 20px", border: `1px solid ${TIMESHEETS_FULL}`,
        background: adminView === v ? TIMESHEETS_FULL : "#fff",
        color: adminView === v ? "#fff" : TIMESHEETS_FULL,
        cursor: "pointer", fontWeight: 600, textTransform: "capitalize",
        marginRight: v === "timesheets" ? -1 : 0,
      }}>
      {v}
    </button>
  ))}
</div>
```

Then wrap the existing filter + submissions list in `{adminView === "timesheets" && ( ... )}` and add:

```jsx
{adminView === "expenses" && <AdminExpensesPanel users={users} />}
```

`AdminExpensesPanel` needs the `users` list. `users` is already fetched in `AdminPanel` — pass it as a prop.

- [ ] **Step 3: Verify in browser (as admin)**

Open Admin Review. Confirm the Timesheets/Expenses toggle appears. Click Expenses — confirm the expenses list loads (pending by default). Approve one — confirm status changes to Approved. Reject one with a reason — confirm the reason is stored and displayed.

Click the mileage rate Edit link — change the rate — confirm it saves.

- [ ] **Step 4: Stage and commit in GitHub Desktop**

Files: `client/src/components/TimesheetsSection.jsx`
Message: `feat: add admin expenses panel with mileage rate setting`

---

## Task 17: Deploy

- [ ] **Step 1: Run the SQL migrations in Supabase**

(Already done in Task 1 — confirm the columns and table exist if not already verified.)

- [ ] **Step 2: Set Railway environment variables**

In Railway, open the server service → Variables. Add:
- `RESEND_API_KEY` — from resend.com dashboard
- `RESEND_FROM` — e.g. `Archimind <timesheets@yourpractice.co.uk>`

- [ ] **Step 3: Push to Railway (server)**

In GitHub Desktop, push the `develop` branch. Railway auto-deploys. Wait for the Railway build to go green.

- [ ] **Step 4: Push to Vercel (client)**

In GitHub Desktop, confirm the client files are on the `develop` branch (or merge to main if that's Vercel's target branch). Vercel auto-deploys.

- [ ] **Step 5: Smoke test on live**

1. Log in as a staff member. Open Timesheets.
2. Add an entry, submit the week — confirm the submit button works.
3. Try to navigate to the next week and add entries — works fine.
4. Go back to the submitted week — confirm entries cannot be edited (locked).
5. Click "Request to Edit" — type a reason — confirm Nathan receives an email.
6. As Nathan, go to Admin Review → find the unlock request → click Unlock.
7. Back as staff — confirm the week is editable again.
8. Click "My Expenses" tab — add a Train expense for £24.50 against a project.
9. As Nathan, go to Admin Review → Expenses → Approve it. Confirm status changes.
10. As Nathan, change the mileage rate to 50p. As staff, add a mileage expense for 10 miles — confirm it shows £5.00 (not £4.50).
