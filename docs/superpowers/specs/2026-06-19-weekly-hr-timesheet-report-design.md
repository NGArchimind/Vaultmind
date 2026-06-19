# Weekly HR Timesheet Report — Design

**Date:** 2026-06-19
**Author:** Nathan + Claude
**Status:** Approved design, ready for implementation plan

A scheduled job that, once a week, builds a timesheet report covering everyone's logged hours, renders it as **both a PDF and an Excel file**, and emails both to HR. Builds directly on the scheduler and settings infrastructure added for the weekly reminder (2026-06-19).

---

## Decisions (locked)

- **Schedule:** default **Monday 08:00 UK**, covering the **previous** week. Day, time, and week-covered (previous/current) are admin-configurable.
- **Recipients:** HR only (`getHrEmails()`).
- **Population:** all non-admin/HR staff (role not `admin`/`hr`) always appear — zero-loggers show **0.0 / Not started**; plus any admin/HR who logged hours that week.
- **Hours:** shown as **decimals** (e.g. `37.5`), computed as `(hours*60 + minutes)/60` rounded to 1 dp. Overtime likewise.
- **PDF engine:** add **`pdfkit`** (one new server dependency, pure JS).
- **Layout C:** PDF = per-person table + by-project totals; Excel = Summary sheet (mirrors PDF) + Detail sheet (every entry).

---

## Data model (read)

- **`timesheets`** table — actual logged rows. Columns used: `user_id`, `entry_date` (YYYY-MM-DD), `project_id`, `category`, `hours`, `minutes`, `overtime_hours`, `overtime_minutes`, `notes`; joined to `projects(name, job_number)`.
- **`timesheet_submissions`** — `(user_id, week_start, status)` where status ∈ `draft|submitted|approved`. Drives the per-person Status column (no row ⇒ "Not started").
- Users + roles via `supabase.auth.admin.listUsers()` (`app_metadata.role`, `user_metadata.full_name`, `email`).

## Settings + state (no SQL — reuse `app_settings` key/value)

- Key **`hr_report`**: `{ "enabled": true, "day": 1, "time": "08:00", "coverage": "previous" }` (`day` 1=Mon…5=Fri; `time` UK HH:MM in 30-min steps; `coverage` `"previous"|"current"`).
- Key **`hr_report_state`**: `{ "last_sent_week": "2026-06-22" }` — the **send-week** Monday last fired for; idempotency guard against restarts/ticks.
- Defaults when missing: enabled true, day 1, time "08:00", coverage "previous".

## Which week the report covers

- `sendWeekMonday = mondayOf(ukNow.dateStr)`.
- `reportWeekMonday = coverage === "current" ? sendWeekMonday : addWeeks(sendWeekMonday, -1)`.
- Entry query range: `entry_date` from `reportWeekMonday` to `reportWeekMonday + 6 days` (Mon–Sun, captures any weekend entries). Header label via existing `formatWeekRange(reportWeekMonday)` ("15 Jun – 19 Jun 2026").

## Architecture / units

Keep rendering and scheduling separate from pure aggregation so the data logic is unit-testable.

### 1. Pure helpers — extend `server/lib/timesheetReminder.js` (or a sibling), unit-tested with `node --test`
- `addWeeks(monday, n)` → Monday string shifted by `n` weeks (n may be negative).
- `buildHrReportModel({ entries, expectedUsers, loggedUserIds, usersById, submissionsByUser })` → pure model:
  ```
  {
    people: [ { userId, name, hours, overtime, status } ],   // sorted by name; status: Approved|Submitted|Draft|Not started
    byProject: [ { label, hours } ],                          // sorted by hours desc; label = "<job_number> — <name>" or category, "Practice / Internal" for the internal category
    totals: { hours, overtime }
  }
  ```
  `entries` carry decimal `hours`/`overtime` already converted by the caller, plus `userId`, `projectLabel`. The builder sums per person and per project, then folds in `expectedUsers` who have no entries as 0.0 rows. **No I/O in this function.**

### 2. Renderers — `server/lib/hrReportRender.js` (new; impure output, manual verification)
- `renderReportPdf(model, weekLabel)` → `Buffer` via `pdfkit`. Navy header band, "By person" table, "Hours by project" table, totals rows; simple fixed-column table helper with page-break handling if rows overflow.
- `renderReportExcel(model, detailRows, weekLabel)` → `Buffer` via `ExcelJS` (already a dependency). *Summary* sheet (per-person + by-project) and *Detail* sheet (Date · Staff · Project/Category · Hours · Overtime · Notes), header row styled, columns auto-sized.

### 3. Orchestration — `server/index.js`
- `gatherHrReportData(reportWeekMonday)` → queries timesheets (range) + submissions (week) + users; converts minutes→decimal hours; computes `expectedUsers`, `loggedUserIds`, `detailRows`; returns everything `buildHrReportModel` and the renderers need.
- `runHrReport(onlyEmail)` → gather → build model → render PDF + Excel → `sendEmail` to HR (or to `onlyEmail` in test mode) with both attachments. Returns recipient count.
- `hrReportTick()` → every 15 min: load `hr_report`; if disabled stop; compute `ukNow`, `sendWeekMonday`; reuse `isReminderDue({ nowDay, nowTime, cfgDay: day, cfgTime: time, currentWeekMonday: sendWeekMonday, lastSentWeek })`; if due → `runHrReport()` then set `hr_report_state.last_sent_week = sendWeekMonday`. Add `setInterval(hrReportTick, 15*60*1000)` after `app.listen` (alongside the reminder tick).

### 4. `sendEmail` — extend signature
Add optional `attachments` and pass through to Resend:
```js
async function sendEmail({ to, subject, html, text, attachments }) { … resend.emails.send({ …, attachments }); }
```
Attachments shape: `[{ filename, content }]` where `content` is a base64 string. Existing callers (no `attachments`) are unaffected.

### 5. Email body
Branded `notificationEmailHtml("Timesheets", …)` wrapper: a one-line message — "The weekly timesheet report for **15 Jun – 19 Jun 2026** is attached (PDF + Excel)." — plus the total hours/overtime as a quick glance. Two attachments named `weekly-timesheet-report-<reportWeekMonday>.pdf` / `.xlsx`.

### 6. Admin endpoints (`requireAuth, requireAdmin`)
- `GET /api/admin/hr-report` → settings (defaults applied).
- `PUT /api/admin/hr-report` → validate + save (`day` ∈ 1–5, `time` matches `^([01]\d|2[0-3]):(00|30)$`, `coverage` ∈ previous/current, `enabled` boolean).
- `POST /api/admin/hr-report/test` → `runHrReport(req.user.email)` — generates the real report for the configured week and sends only to the requesting admin. Returns `{ ok, sent: 1 }`.

### 7. Admin UI — `HrReportSettings` in `AdminSection.jsx` (Notifications tab, under the reminder panel)
Enabled toggle, Day (Mon–Fri), Time (30-min steps), Week covered (Previous/Current), and a **"Send a test report to my email"** button. Same `api()` + optimistic-save + toast pattern as `TimesheetReminderSettings`.

## Testing

- **Pure:** `addWeeks` and `buildHrReportModel` get `node --test` cases (totals, per-project grouping, zero-logger folding, status mapping, sort order).
- **Rendering + scheduling:** manual verification on staging via the **"Send a test report to my email"** button — confirm the PDF and Excel open, totals match, zero-loggers appear, attachments are named correctly.

## Deployment

**Server + client.** No SQL.
- `npm install pdfkit` in `server/` (adds to `package.json`).
- Deploy **server → Railway first**, then **client → Vercel**.
- Work on `develop`, verify with the test button on staging, then merge `develop → main`.

## Out of scope

- Per-person individual report emails (this is one consolidated report to HR).
- Configurable report columns/branding beyond the fixed Layout C.
- Storing generated reports in R2/history (regenerated on demand; not persisted).
- Month/quarter rollups (weekly only).
