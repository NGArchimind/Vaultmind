# Weekly HR Timesheet Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once a week, build a timesheet report of everyone's logged hours for the previous week, render it as a PDF and an Excel file, and email both to HR — admin-configurable, built on the existing reminder scheduler.

**Architecture:** Pure aggregation (`buildHrReportModel`) and a date helper (`addWeeks`) are unit-tested with `node --test`. Two stateless renderers (`pdfkit` for PDF, `ExcelJS` for Excel) turn the model into buffers. `server/index.js` orchestrates (gather data → build model → render → email with attachments) and runs a 15-minute UK-time scheduler tick that reuses `isReminderDue`. A new admin panel configures it.

**Tech Stack:** Node 24 (CommonJS), Express, Supabase, Resend (attachments), **pdfkit** (new dep), ExcelJS (existing), React (CRA), `node --test`.

---

## ⚠️ Project conventions (read before starting)

- **Nathan commits and deploys himself.** Do **not** run `git add/commit/push`. "Checkpoint" = run the verification, show the diff, stop. `git` snippets are for his reference only.
- **Read a file's current state before editing.** Line numbers are from 2026-06-19 and may drift.
- **Client build** (npm script is misconfigured): from `client/`, `node node_modules\react-scripts\bin\react-scripts.js build`.
- **Branch:** `develop`; verify on staging; Nathan merges `develop → main`.
- **No SQL** — `hr_report` / `hr_report_state` are new `app_settings` keys.
- Client→server via `api()`; never raw `fetch`.

---

## File structure

| File | Responsibility | Action |
|------|----------------|--------|
| `server/lib/timesheetReminder.js` | add `addWeeks` date helper | Modify |
| `server/lib/timesheetReminder.test.js` | test `addWeeks` | Modify |
| `server/lib/hrReport.js` | pure `buildHrReportModel` + `round1`/`statusLabel` | Create |
| `server/lib/hrReport.test.js` | tests for the model builder | Create |
| `server/lib/hrReportRender.js` | `renderReportPdf` (pdfkit) + `renderReportExcel` (ExcelJS) | Create |
| `server/index.js` | settings/state, gather, run, tick, scheduler, 3 endpoints; extend `sendEmail` | Modify |
| `server/package.json` / `package-lock.json` | add `pdfkit` | Modify (via npm install) |
| `client/src/components/AdminSection.jsx` | `HrReportSettings` panel | Modify |

---

## Task 1: `addWeeks` date helper (TDD)

**Files:**
- Modify: `server/lib/timesheetReminder.js`
- Modify: `server/lib/timesheetReminder.test.js`

- [ ] **Step 1: Add the failing test.** Append to `server/lib/timesheetReminder.test.js`:

```js
test("addWeeks shifts by whole weeks (negative ok)", () => {
  assert.equal(R.addWeeks("2026-06-22", -1), "2026-06-15");
  assert.equal(R.addWeeks("2026-06-15", 2), "2026-06-29");
});
```

- [ ] **Step 2: Run to verify it fails.** From `server/`:

Run: `node --test lib/timesheetReminder.test.js`
Expected: FAIL — `R.addWeeks is not a function`.

- [ ] **Step 3: Implement.** In `server/lib/timesheetReminder.js`, add this function just after `enumerateWeekStarts`:

```js
// Monday string shifted by n weeks (n may be negative).
function addWeeks(monday, n) {
  const d = parseISODateUTCNoon(monday);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return toISODate(d);
}
```

And add `addWeeks` to the `module.exports` object (place it next to `enumerateWeekStarts`).

- [ ] **Step 4: Run to verify all pass.** From `server/`:

Run: `node --test lib/timesheetReminder.test.js`
Expected: PASS — `# pass 8`, `# fail 0`.

- [ ] **Step 5: Checkpoint** — show Nathan the green run.

---

## Task 2: `buildHrReportModel` pure aggregation (TDD)

**Files:**
- Create: `server/lib/hrReport.js`
- Create: `server/lib/hrReport.test.js`

- [ ] **Step 1: Write the failing test** at `server/lib/hrReport.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { buildHrReportModel } = require("./hrReport");

test("folds in zero-loggers, maps status, totals & sorts", () => {
  const model = buildHrReportModel({
    entries: [
      { userId: "u1", name: "Sarah Jones", projectLabel: "24009 — Woolwich", hours: 7.5, overtime: 2 },
      { userId: "u1", name: "Sarah Jones", projectLabel: "24014 — Deptford", hours: 7.5, overtime: 0 },
      { userId: "u2", name: "Tom Reilly", projectLabel: "24009 — Woolwich", hours: 7.5, overtime: 0 },
    ],
    expected: [
      { userId: "u1", name: "Sarah Jones" },
      { userId: "u2", name: "Tom Reilly" },
      { userId: "u3", name: "James Okoro" }, // logged nothing
    ],
    statusByUser: { u1: "submitted", u2: "draft" }, // u3 missing
  });

  assert.deepEqual(model.people, [
    { userId: "u3", name: "James Okoro", hours: 0, overtime: 0, status: "Not started" },
    { userId: "u1", name: "Sarah Jones", hours: 15, overtime: 2, status: "Submitted" },
    { userId: "u2", name: "Tom Reilly", hours: 7.5, overtime: 0, status: "Draft" },
  ]);
  assert.deepEqual(model.byProject, [
    { label: "24009 — Woolwich", hours: 15 },
    { label: "24014 — Deptford", hours: 7.5 },
  ]);
  assert.deepEqual(model.totals, { hours: 22.5, overtime: 2 });
});
```

- [ ] **Step 2: Run to verify it fails.** From `server/`:

Run: `node --test lib/hrReport.test.js`
Expected: FAIL — `Cannot find module './hrReport'`.

- [ ] **Step 3: Implement** `server/lib/hrReport.js`:

```js
"use strict";

function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }

function statusLabel(s) {
  if (s === "approved") return "Approved";
  if (s === "submitted") return "Submitted";
  if (s === "draft") return "Draft";
  return "Not started";
}

// entries: [{ userId, name, projectLabel, hours, overtime }] (decimal hours)
// expected: [{ userId, name }] — always-included staff (zero-loggers show 0)
// statusByUser: { [userId]: "approved"|"submitted"|"draft" }
function buildHrReportModel({ entries, expected, statusByUser }) {
  const byUser = new Map();
  const ensure = (userId, name) => {
    if (!byUser.has(userId)) byUser.set(userId, { userId, name: name || "Unknown", hours: 0, overtime: 0 });
    const row = byUser.get(userId);
    if (name && (!row.name || row.name === "Unknown")) row.name = name;
    return row;
  };
  for (const p of expected || []) ensure(p.userId, p.name);

  const projects = new Map();
  for (const e of entries || []) {
    const row = ensure(e.userId, e.name);
    row.hours += Number(e.hours) || 0;
    row.overtime += Number(e.overtime) || 0;
    const label = e.projectLabel || "Unassigned";
    projects.set(label, (projects.get(label) || 0) + (Number(e.hours) || 0));
  }

  const people = [...byUser.values()]
    .map((r) => ({ userId: r.userId, name: r.name, hours: round1(r.hours), overtime: round1(r.overtime), status: statusLabel((statusByUser || {})[r.userId]) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const byProject = [...projects.entries()]
    .map(([label, hours]) => ({ label, hours: round1(hours) }))
    .sort((a, b) => b.hours - a.hours || a.label.localeCompare(b.label));

  const totals = {
    hours: round1(people.reduce((s, p) => s + p.hours, 0)),
    overtime: round1(people.reduce((s, p) => s + p.overtime, 0)),
  };

  return { people, byProject, totals };
}

module.exports = { round1, statusLabel, buildHrReportModel };
```

- [ ] **Step 4: Run to verify it passes.** From `server/`:

Run: `node --test lib/hrReport.test.js`
Expected: PASS — `# pass 1`, `# fail 0`.

- [ ] **Step 5: Checkpoint** — show Nathan the green run.

---

## Task 3: PDF + Excel renderers (install pdfkit)

**Files:**
- Create: `server/lib/hrReportRender.js`
- Modify: `server/package.json` + `package-lock.json` (via `npm install`)

- [ ] **Step 1: Install pdfkit.** From `server/` (via Bash):

Run: `npm install pdfkit`
Expected: adds `pdfkit` to `dependencies`; `node -e "require('pdfkit');console.log('OK')"` prints `OK`.

- [ ] **Step 2: Create** `server/lib/hrReportRender.js`:

```js
"use strict";
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");

function fmt(n) { return (Math.round((Number(n) || 0) * 10) / 10).toFixed(1); }

function renderReportPdf(model, weekLabel) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = 40;
    doc.rect(0, 0, doc.page.width, 54).fill("#4c6278");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(15).text("Archimind — Weekly Timesheet Report", left, 18);
    doc.fillColor("#6a8a9a").font("Helvetica").fontSize(10).text(`Week ${weekLabel} · all staff`, left, 64);

    let y = 92;
    const pageBreak = () => { if (y > doc.page.height - 60) { doc.addPage(); y = 50; } };

    const personCols = [220, 90, 90, 95];
    const drawPerson = (cells, opts = {}) => {
      const w = personCols.reduce((a, b) => a + b, 0);
      if (opts.bg) doc.rect(left, y - 2, w, 16).fill(opts.bg);
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor("#262830");
      let x = left;
      cells.forEach((c, i) => {
        doc.fillColor("#262830").text(String(c), x + 4, y, { width: personCols[i] - 8, align: i === 0 || i === 3 ? "left" : "right" });
        x += personCols[i];
      });
      y += 16; pageBreak();
    };

    doc.font("Helvetica-Bold").fontSize(10).fillColor("#33414d").text("By person", left, y); y += 16;
    drawPerson(["Staff", "Hours", "Overtime", "Status"], { bold: true, bg: "#f1f4f6" });
    for (const p of model.people) drawPerson([p.name, fmt(p.hours), fmt(p.overtime), p.status]);
    drawPerson(["Total", fmt(model.totals.hours), fmt(model.totals.overtime), ""], { bold: true, bg: "#f7f9fa" });

    y += 14;
    const projCols = [410, 95];
    const drawProj = (a, b, opts = {}) => {
      if (opts.bg) doc.rect(left, y - 2, projCols[0] + projCols[1], 16).fill(opts.bg);
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor("#262830");
      doc.text(String(a), left + 4, y, { width: projCols[0] - 8, align: "left" });
      doc.text(String(b), left + projCols[0], y, { width: projCols[1] - 8, align: "right" });
      y += 16; pageBreak();
    };

    doc.font("Helvetica-Bold").fontSize(10).fillColor("#33414d").text("Hours by project", left, y); y += 16;
    drawProj("Project / Category", "Hours", { bold: true, bg: "#f1f4f6" });
    for (const r of model.byProject) drawProj(r.label, fmt(r.hours));
    drawProj("Total", fmt(model.totals.hours), { bold: true, bg: "#f7f9fa" });

    doc.end();
  });
}

async function renderReportExcel(model, detailRows, weekLabel) {
  const wb = new ExcelJS.Workbook();

  const sum = wb.addWorksheet("Summary");
  sum.getCell("A1").value = "Archimind — Weekly Timesheet Report";
  sum.getCell("A1").font = { bold: true, size: 14, name: "Arial" };
  sum.getCell("A2").value = `Week ${weekLabel} · all staff`;
  sum.getCell("A2").font = { name: "Arial", size: 10, color: { argb: "FF6A8A9A" } };

  sum.getRow(4).values = ["Staff", "Hours", "Overtime", "Status"];
  sum.getRow(4).font = { bold: true, name: "Arial", size: 10 };
  let r = 5;
  for (const p of model.people) { sum.getRow(r++).values = [p.name, p.hours, p.overtime, p.status]; }
  sum.getRow(r).values = ["Total", model.totals.hours, model.totals.overtime, ""];
  sum.getRow(r).font = { bold: true, name: "Arial", size: 10 };
  r += 2;
  sum.getRow(r).values = ["Hours by project", "Hours"];
  sum.getRow(r++).font = { bold: true, name: "Arial", size: 10 };
  for (const pr of model.byProject) { sum.getRow(r++).values = [pr.label, pr.hours]; }
  sum.getRow(r).values = ["Total", model.totals.hours];
  sum.getRow(r).font = { bold: true, name: "Arial", size: 10 };
  sum.getColumn(1).width = 34; sum.getColumn(2).width = 12; sum.getColumn(3).width = 12; sum.getColumn(4).width = 16;

  const det = wb.addWorksheet("Detail");
  det.getRow(1).values = ["Date", "Staff", "Project / Category", "Hours", "Overtime", "Notes"];
  det.getRow(1).font = { bold: true, name: "Arial", size: 10 };
  let d = 2;
  for (const row of detailRows) det.getRow(d++).values = [row.date, row.name, row.projectLabel, row.hours, row.overtime, row.notes || ""];
  det.getColumn(1).width = 12; det.getColumn(2).width = 22; det.getColumn(3).width = 30;
  det.getColumn(4).width = 9; det.getColumn(5).width = 10; det.getColumn(6).width = 40;

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

module.exports = { renderReportPdf, renderReportExcel };
```

- [ ] **Step 3: Verify the renderers produce real files.** Create a throwaway file `server/_tmp_render_check.js`:

```js
const fs = require("fs");
const { renderReportPdf, renderReportExcel } = require("./lib/hrReportRender");
const model = {
  people: [
    { userId: "u3", name: "James Okoro", hours: 0, overtime: 0, status: "Not started" },
    { userId: "u1", name: "Sarah Jones", hours: 15, overtime: 2, status: "Submitted" },
    { userId: "u2", name: "Tom Reilly", hours: 7.5, overtime: 0, status: "Draft" },
  ],
  byProject: [{ label: "24009 — Woolwich Central", hours: 15 }, { label: "24014 — Deptford Wharf", hours: 7.5 }],
  totals: { hours: 22.5, overtime: 2 },
};
const detail = [
  { date: "15 Jun", name: "Sarah Jones", projectLabel: "24009 — Woolwich Central", hours: 7.5, overtime: 2, notes: "Tender queries" },
  { date: "16 Jun", name: "Sarah Jones", projectLabel: "24014 — Deptford Wharf", hours: 7.5, overtime: 0, notes: "" },
];
(async () => {
  const pdf = await renderReportPdf(model, "15 Jun – 19 Jun 2026");
  const xlsx = await renderReportExcel(model, detail, "15 Jun – 19 Jun 2026");
  fs.writeFileSync("_check.pdf", pdf);
  fs.writeFileSync("_check.xlsx", xlsx);
  console.log("PDF bytes:", pdf.length, "XLSX bytes:", xlsx.length);
})();
```

Run (from `server/`): `node _tmp_render_check.js`
Expected: prints e.g. `PDF bytes: 3000+ XLSX bytes: 6000+` (both comfortably non-zero) with no error.

- [ ] **Step 4: Checkpoint for Nathan** — he opens `server/_check.pdf` and `server/_check.xlsx` to confirm they look like Layout C (header, by-person, by-project; Summary + Detail sheets).

- [ ] **Step 5: Delete the temporary files.** Remove `server/_tmp_render_check.js`, `server/_check.pdf`, `server/_check.xlsx`. (Remind Nathan not to commit them.)

---

## Task 4: Server orchestration + `sendEmail` attachments

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Read** `server/index.js:20-40` (`sendEmail`), the requires block (~line 12), and the reminder helpers (~line 133+).

- [ ] **Step 2: Extend `sendEmail`** to pass attachments through to Resend. Replace the existing `sendEmail` function (around lines 20–40) with:

```js
async function sendEmail({ to, subject, html, text, attachments }) {
  const resend = getResend();
  if (!resend) {
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
      ...(attachments && attachments.length ? { attachments } : {}),
    });
  } catch (err) {
    console.error("[email] Send failed:", err.message);
  }
}
```

- [ ] **Step 3: Add requires.** Just after the existing `const reminderLib = require("./lib/timesheetReminder");` line (added by the reminder feature, ~line 12), add:

```js
const hrReport = require("./lib/hrReport");
const { renderReportPdf, renderReportExcel } = require("./lib/hrReportRender");
const HR_REPORT_DEFAULTS = { enabled: true, day: 1, time: "08:00", coverage: "previous" };
```

- [ ] **Step 4: Add the HR-report block.** Immediately after the reminder's `reminderTick` function (Grep for `async function reminderTick`, insert after its closing `}`), add:

```js

async function getHrReportSettings() {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "hr_report").maybeSingle();
  let parsed = {};
  try { parsed = data?.value ? JSON.parse(data.value) : {}; } catch { parsed = {}; }
  return { ...HR_REPORT_DEFAULTS, ...parsed };
}
async function getHrReportState() {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "hr_report_state").maybeSingle();
  try { return data?.value ? JSON.parse(data.value) : {}; } catch { return {}; }
}
async function setHrReportState(state) {
  await supabase.from("app_settings").upsert(
    { key: "hr_report_state", value: JSON.stringify(state), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
}

function hrProjectLabel(e) {
  if (e.projects) return `${e.projects.job_number ? e.projects.job_number + " — " : ""}${e.projects.name}`;
  if (e.category === "internal") return "Practice / Internal";
  return e.category ? e.category.charAt(0).toUpperCase() + e.category.slice(1) : "Unassigned";
}
function hrToHours(h, m) { return (Number(h || 0) * 60 + Number(m || 0)) / 60; }

async function gatherHrReportData(reportWeekMonday) {
  const end = new Date(reportWeekMonday + "T12:00:00Z");
  end.setUTCDate(end.getUTCDate() + 6);
  const reportWeekEnd = end.toISOString().slice(0, 10);

  const [{ data: rawEntries }, { data: subs }, { data: usersData }] = await Promise.all([
    supabase.from("timesheets")
      .select("user_id, entry_date, hours, minutes, overtime_hours, overtime_minutes, category, notes, projects(name, job_number)")
      .gte("entry_date", reportWeekMonday).lte("entry_date", reportWeekEnd),
    supabase.from("timesheet_submissions").select("user_id, status").eq("week_start", reportWeekMonday),
    supabase.auth.admin.listUsers(),
  ]);

  const users = usersData?.users || [];
  const nameById = {};
  for (const u of users) nameById[u.id] = u.user_metadata?.full_name || u.email || "Unknown";

  const entries = (rawEntries || []).map((e) => ({
    userId: e.user_id, name: nameById[e.user_id] || "Unknown",
    projectLabel: hrProjectLabel(e), hours: hrToHours(e.hours, e.minutes), overtime: hrToHours(e.overtime_hours, e.overtime_minutes),
  }));

  const detailRows = (rawEntries || []).map((e) => ({
    date: new Date(e.entry_date + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    name: nameById[e.user_id] || "Unknown", projectLabel: hrProjectLabel(e),
    hours: hrReport.round1(hrToHours(e.hours, e.minutes)), overtime: hrReport.round1(hrToHours(e.overtime_hours, e.overtime_minutes)),
    notes: e.notes || "",
  })).sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date));

  const expected = users
    .filter((u) => reminderLib.isRemindableRole(u.app_metadata?.role))
    .map((u) => ({ userId: u.id, name: nameById[u.id] }));

  const statusByUser = {};
  for (const s of subs || []) statusByUser[s.user_id] = s.status;

  return { entries, detailRows, expected, statusByUser };
}

async function runHrReport(onlyEmail) {
  const settings = await getHrReportSettings();
  const ukNow = reminderLib.ukParts(new Date());
  const sendWeekMonday = reminderLib.mondayOf(ukNow.dateStr);
  const reportWeekMonday = settings.coverage === "current" ? sendWeekMonday : reminderLib.addWeeks(sendWeekMonday, -1);

  const { entries, detailRows, expected, statusByUser } = await gatherHrReportData(reportWeekMonday);
  const model = hrReport.buildHrReportModel({ entries, expected, statusByUser });
  const weekLabel = formatWeekRange(reportWeekMonday);

  const [pdf, xlsx] = await Promise.all([
    renderReportPdf(model, weekLabel),
    renderReportExcel(model, detailRows, weekLabel),
  ]);

  const recipients = onlyEmail ? [onlyEmail] : await getHrEmails();
  if (!recipients.length) return 0;

  const fileBase = `weekly-timesheet-report-${reportWeekMonday}`;
  const body = `<p style="margin:0 0 14px;font-size:15px;color:#262830;">The weekly timesheet report for <strong>${escapeHtml(weekLabel)}</strong> is attached (PDF + Excel).</p>`
    + `<p style="margin:0;font-size:13px;color:#5a6b76;">Total: <strong>${model.totals.hours}</strong> hours`
    + (model.totals.overtime ? `, including <strong>${model.totals.overtime}</strong> overtime` : "")
    + ` across ${model.people.length} staff.</p>`;

  await sendEmail({
    to: recipients,
    subject: `Weekly timesheet report — ${weekLabel}`,
    html: notificationEmailHtml("Timesheets", body),
    text: `The weekly timesheet report for ${weekLabel} is attached (PDF + Excel). Total ${model.totals.hours} hours across ${model.people.length} staff.`,
    attachments: [
      { filename: `${fileBase}.pdf`, content: pdf.toString("base64") },
      { filename: `${fileBase}.xlsx`, content: xlsx.toString("base64") },
    ],
  });
  return recipients.length;
}

async function hrReportTick() {
  try {
    const settings = await getHrReportSettings();
    if (!settings.enabled) return;
    const ukNow = reminderLib.ukParts(new Date());
    const sendWeekMonday = reminderLib.mondayOf(ukNow.dateStr);
    const state = await getHrReportState();
    if (!reminderLib.isReminderDue({
      nowDay: ukNow.day, nowTime: ukNow.time, cfgDay: settings.day, cfgTime: settings.time,
      currentWeekMonday: sendWeekMonday, lastSentWeek: state.last_sent_week,
    })) return;
    const count = await runHrReport();
    await setHrReportState({ last_sent_week: sendWeekMonday });
    console.log(`[HR report] Sent weekly report to ${count} HR recipient(s) for send-week ${sendWeekMonday}`);
  } catch (e) {
    console.error("[HR report] tick failed:", e.message);
  }
}
```

(`getHrEmails`, `formatWeekRange`, `escapeHtml`, `notificationEmailHtml`, `supabase` all already exist.)

- [ ] **Step 5: Start the second scheduler.** Find the line `setInterval(reminderTick, 15 * 60 * 1000);` (added by the reminder feature, just after `app.listen`). Add immediately after it:

```js
setInterval(hrReportTick, 15 * 60 * 1000);
```

- [ ] **Step 6: Syntax check.** From `server/`:

Run: `node --check index.js && echo SYNTAX_OK`
Expected: `SYNTAX_OK`.

- [ ] **Step 7: Checkpoint** — show Nathan the diff.

---

## Task 5: Admin endpoints

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Read** the reminder endpoints (Grep `"/api/admin/timesheet-reminder"`) to anchor placement.

- [ ] **Step 2: Insert** these routes immediately after the `POST /api/admin/timesheet-reminder/test` route's closing `});`:

```js

// GET /api/admin/hr-report
app.get("/api/admin/hr-report", requireAuth, requireAdmin, async (req, res) => {
  res.json(await getHrReportSettings());
});

// PUT /api/admin/hr-report
app.put("/api/admin/hr-report", requireAuth, requireAdmin, async (req, res) => {
  const b = req.body || {};
  const cur = await getHrReportSettings();
  const settings = {
    enabled: typeof b.enabled === "boolean" ? b.enabled : cur.enabled,
    day: [1, 2, 3, 4, 5].includes(Number(b.day)) ? Number(b.day) : cur.day,
    time: /^([01]\d|2[0-3]):(00|30)$/.test(b.time) ? b.time : cur.time,
    coverage: ["previous", "current"].includes(b.coverage) ? b.coverage : cur.coverage,
  };
  const { error } = await supabase.from("app_settings").upsert(
    { key: "hr_report", value: JSON.stringify(settings), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json(settings);
});

// POST /api/admin/hr-report/test → generate now and send only to the requesting admin
app.post("/api/admin/hr-report/test", requireAuth, requireAdmin, async (req, res) => {
  try {
    const sent = await runHrReport(req.user.email);
    res.json({ ok: true, sent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: Syntax check.** From `server/`: `node --check index.js && echo SYNTAX_OK` → `SYNTAX_OK`.

- [ ] **Step 4: Checkpoint** — show Nathan the diff. (He deploys server after Task 6 is built.)

---

## Task 6: Admin UI — HR Report panel

**Files:**
- Modify: `client/src/components/AdminSection.jsx`

- [ ] **Step 1: Read** the `TimesheetReminderSettings` component and the Notifications-tab render line (Grep `TimesheetReminderSettings`).

- [ ] **Step 2: Add** the `HrReportSettings` component immediately after the `TimesheetReminderSettings` component's closing `}`:

```jsx
function HrReportSettings() {
  const [cfg, setCfg]       = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast]   = useState(null);

  useEffect(() => { api("/api/admin/hr-report").then(setCfg).catch(() => {}); }, []);

  const save = async (patch) => {
    if (!cfg || saving) return;
    const prev = cfg, next = { ...cfg, ...patch };
    setCfg(next); setSaving(true);
    try {
      const saved = await api("/api/admin/hr-report", { method: "PUT", body: next });
      setCfg(saved); setToast("Saved"); setTimeout(() => setToast(null), 1500);
    } catch {
      setCfg(prev); setToast("Could not save"); setTimeout(() => setToast(null), 2000);
    } finally { setSaving(false); }
  };

  const sendTest = async () => {
    setSaving(true);
    try {
      const r = await api("/api/admin/hr-report/test", { method: "POST" });
      setToast(r.sent ? "Test report sent to your email" : "No HR recipients / nothing to send");
    } catch { setToast("Could not send test"); }
    finally { setSaving(false); setTimeout(() => setToast(null), 2500); }
  };

  const DAYS = [[1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"], [5, "Friday"]];
  const TIMES = [];
  for (let h = 7; h <= 20; h++) { const hh = String(h).padStart(2, "0"); TIMES.push(`${hh}:00`, `${hh}:30`); }
  const inp = { fontSize: 13, padding: "6px 8px", border: "1px solid #d0d8de", background: "#fff", color: DESIGN_SHELL, fontFamily: "Inter, Arial, sans-serif" };

  return (
    <div style={{ marginBottom: 48 }}>
      <h2 style={{ fontSize: 16, fontWeight: 300, color: DESIGN_SHELL, marginBottom: 4 }}>Weekly HR Report</h2>
      <p style={{ fontSize: 12, color: "#9a9088", marginBottom: 20 }}>
        Emails HR a PDF + Excel of everyone's logged hours, on the day &amp; time below.
        {toast && <span style={{ marginLeft: 10, color: DESIGN_SHELL, fontWeight: 600 }}>{toast}</span>}
      </p>
      <div style={{ background: "#fff", border: "1px solid #e0dbd4", borderTop: `3px solid ${DESIGN_SHELL}`, padding: "18px 24px", maxWidth: 640 }}>
        {!cfg && <p style={{ fontSize: 13, color: "#9a9088" }}>Loading…</p>}
        {cfg && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: DESIGN_SHELL }}>
              <input type="checkbox" checked={cfg.enabled} disabled={saving} onChange={e => save({ enabled: e.target.checked })} />
              Send weekly report to HR
            </label>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <label style={{ fontSize: 12, color: "#9a9088" }}>Day<br />
                <select value={cfg.day} disabled={saving} onChange={e => save({ day: Number(e.target.value) })} style={inp}>
                  {DAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12, color: "#9a9088" }}>Time (UK)<br />
                <select value={cfg.time} disabled={saving} onChange={e => save({ time: e.target.value })} style={inp}>
                  {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12, color: "#9a9088" }}>Week covered<br />
                <select value={cfg.coverage} disabled={saving} onChange={e => save({ coverage: e.target.value })} style={inp}>
                  <option value="previous">Previous week</option>
                  <option value="current">Current week</option>
                </select>
              </label>
            </div>
            <div>
              <button type="button" onClick={sendTest} disabled={saving}
                style={{ fontSize: 12, padding: "8px 16px", border: `1px solid ${DESIGN_SHELL}`, background: "#fff", color: DESIGN_SHELL, cursor: saving ? "default" : "pointer" }}>
                Send a test report to my email
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Render it** in the Notifications tab. Change the existing line:

```jsx
      {adminTab === "notifications" && (<><NotificationSettings /><TimesheetReminderSettings /></>)}
```
to:
```jsx
      {adminTab === "notifications" && (<><NotificationSettings /><TimesheetReminderSettings /><HrReportSettings /></>)}
```

- [ ] **Step 4: Build the client.** From `client/`:

Run: `node node_modules\react-scripts\bin\react-scripts.js build`
Expected: `Compiled successfully`.

- [ ] **Step 5: End-to-end Checkpoint for Nathan.**
  1. Commit (incl. `server/package.json` + `package-lock.json` so Railway installs pdfkit), deploy **server → Railway** first, then **client → Vercel**.
  2. On staging: Admin → Notifications → **Weekly HR Report** — change a setting, reload to confirm it saved.
  3. Click **Send a test report to my email**; confirm the email arrives with both attachments and that the PDF/Excel match Layout C. (If the previous week had no entries, totals will be 0 and everyone shows Not started — switch "Week covered" to a week with data, or lower nothing — this is expected.)
  4. When happy, merge `develop → main`.

```bash
# For Nathan's reference only:
git add server/ client/src/components/AdminSection.jsx
git commit -m "Add weekly HR timesheet report (PDF + Excel) with admin settings"
```

---

## Post-implementation

- [ ] Add a short `docs/HANDOVER.md` subsection: the `hr_report`/`hr_report_state` keys, the second 15-min tick (`hrReportTick`), `pdfkit` dependency, the renderers in `server/lib/hrReportRender.js`, the previous/current coverage option, and the `sendEmail` `attachments` extension. **Nathan commits.**

## Self-review notes (coverage)

- Spec "schedule/coverage configurable, Mon 08:00 default" → Task 4 `runHrReport`/`hrReportTick` + Task 5 PUT validation + Task 6 UI.
- "Recipients HR only" → `getHrEmails()` in `runHrReport`.
- "Population incl. zero-loggers; admin/HR only if they logged" → `expected` filter (`isRemindableRole`) + entry authors folded in by `buildHrReportModel`.
- "Decimals" → `hrToHours` + `round1`.
- "PDF via pdfkit, Excel via ExcelJS, Layout C" → Task 3 renderers.
- "Excel Summary + Detail" → `renderReportExcel`.
- "Email with both attachments, branded" → `runHrReport` + `sendEmail` attachments extension (Task 4 Step 2).
- "Test button" → Task 5 POST + Task 6 button.
- "Settings no SQL" → `app_settings` keys.
- "addWeeks pure + tested; buildHrReportModel pure + tested" → Tasks 1–2.
- Deployment order (pdfkit install, Railway before Vercel) → Task 6 Step 5.
