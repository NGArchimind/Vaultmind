# Timesheet clarity fix + weekly reminder — Design

**Date:** 2026-06-19
**Author:** Nathan + Claude
**Status:** Approved design, ready for implementation plan

Two independent pieces of work, requested together:

1. **Part 1 — Entry-page clarity.** Make the time-input vs overtime columns unambiguous on the weekly timesheet entry page.
2. **Part 2 — Weekly reminder email.** Automatically email staff who have outstanding timesheets, on an admin-configurable day/time (default Friday 16:00).

They share no code and can be built/deployed separately.

---

## Part 1 — Entry-page column clarity (Option C)

### Problem
On the weekly entry page (`client/src/components/TimesheetsSection.jsx`), the column header row (lines ~1058–1064) only labels **Project / Category · Hours · Mins · Notes**. But each *project* row (`EntryRow`, lines ~202–264) renders **two extra dropdowns** — an "OT" label plus overtime Hours/Mins — squeezed between Mins and Notes. Result: the overtime boxes have no header, and "Notes" no longer sits above the Notes field. Category/leave rows have no overtime fields, so rows don't line up.

### Solution — "Option C" grouped columns
Rework the header row and every entry row so time inputs sit under two clear group headings:

- Header columns become: **Project / Category · Time worked · Overtime · Notes** (+ trailing 28px action spacer).
- **Time worked** group: the existing Hours + Mins selects, equal width within a fixed-width container.
- **Overtime** group: the existing OT Hours + Mins selects, tinted amber (existing overtime colour `#8a6a3a` family), in a fixed-width container the same width as the time-worked group.
- The inline "OT" pill is removed — the column header now labels overtime.
- On **category/leave rows** (no overtime), the Overtime container renders a muted `n/a` placeholder of the same width so columns stay aligned under the header.

### Constraints / invariants (do not regress)
- **No logic change.** Overtime stays project-only, stays tracked separately from the weekly total and the 37.5/45h warnings (per `docs/HANDOVER.md` → "Timesheets — dates, overtime, notifications").
- Switching a row to a category still clears overtime (existing `handleProjectChange`, line ~215).
- The footer week-total + overtime summary (lines ~1114–1129) is unchanged.
- Apply the same grouped-column widths to **all** sibling rows in a day card — the saved `EntryRow`, the add/draft entry row, and any quick-fill row — so headers line up everywhere. (Implementation must read the surrounding row components in the file.)
- Colours come from `constants.js` where a token exists; no new hardcoded hex beyond reusing the existing overtime amber.

### Deployment
**Client only → Vercel.** No server or DB change.

---

## Part 2 — Weekly timesheet reminder

### Behaviour summary
An admin-configurable scheduled email that chases staff with outstanding timesheets.

- **When:** admin picks day (Mon–Fri) + time (30-min steps), default **Friday 16:00 UK time**. On/off toggle, default **on**.
- **Who:** non-admin staff only — every user whose `app_metadata.role` is **not** `admin` and **not** `hr` (role `user`, or unset, is included) who has at least one incomplete week.
- **What counts as incomplete:** any week from the configurable cut-off date up to the current week whose `timesheet_submissions.status` is not `submitted` or `approved`. Per-week label: **Draft** (a row exists in `draft`) or **Not started** (no row).
- **Cut-off:** an admin date setting (default **2026-07-01**), so weeks before timesheets were rolled out are never chased. Additionally floored **per user** at the Monday of their account-creation week, so new joiners aren't nagged about weeks before they existed.
- **Current week** = the Monday-based week containing the fire moment (matches the `week_start` convention).

### Data model (no SQL migration)
Reuse the existing `app_settings` key-value table (JSON values), same pattern as `notification_settings` (server/index.js ~line 100 / save ~line 4553).

- New key **`timesheet_reminder`**:
  ```json
  { "enabled": true, "day": 5, "time": "16:00", "track_from": "2026-07-01" }
  ```
  `day`: 1=Mon … 5=Fri. `time`: UK local HH:MM, 30-min steps. `track_from`: ISO date floor.
- New key **`timesheet_reminder_state`** (idempotency marker):
  ```json
  { "last_sent_week": "2026-06-15" }
  ```
  The Monday `week_start` the reminder last fired for. Prevents double-send across timer ticks and server restarts.

Missing keys default to: `enabled` true, `day` 5, `time` "16:00", `track_from` "2026-07-01".

### Scheduler (built into the Railway server)
A single `setInterval` started once at server boot, firing every **15 minutes** (no new npm dependency; UK time derived via `Intl.DateTimeFormat`/`toLocaleString` with `timeZone: "Europe/London"`, which handles BST automatically).

Each tick:
1. Load `timesheet_reminder`. If `enabled` is false → stop.
2. Compute current UK day-of-week and HH:MM.
3. **Due?** current UK day === `day` AND current UK time ≥ `time`.
4. Compute this week's Monday (UK). If `timesheet_reminder_state.last_sent_week` already equals it → stop (already sent this week).
5. If due and not yet sent → run the reminder send, then set `last_sent_week` to this Monday.

**Accepted limitation:** if the server is down for the entire configured day, that week's reminder is skipped (no catch-up on a later day). A late boot *on the same day* still sends.

### Recipient + outstanding-week computation
1. List all users via `supabase.auth.admin.listUsers()`; drop any with role `admin` or `hr`.
2. One query: all `timesheet_submissions` with `week_start >= track_from`, grouped by `user_id` → `{week_start: status}`.
3. For each remaining user:
   - `effectiveStart` = later of (`track_from` Monday, Monday of the user's `created_at` week).
   - Enumerate every Monday from `effectiveStart` to the current week's Monday inclusive.
   - A week is outstanding if its status is not `submitted`/`approved`; label Draft (row in `draft`) or Not started (no row).
   - If ≥1 outstanding week → queue an email to that user.

### Email
- Built with the existing **`notificationEmailHtml("Timesheets", body)`** wrapper (navy "Archimind — Timesheets" header bar) — matches current notification emails.
- **Subject:** e.g. `Timesheet reminder — you have N outstanding timesheet(s)`.
- **Body:**
  - Greeting by first name (from user metadata full name, else email local-part), `escapeHtml`'d.
  - "The following timesheets are **not yet submitted:**"
  - A table of outstanding weeks via `formatWeekRange(week)` with a status cell (Draft amber `#8a6a3a` / Not started red `#c0392b`).
  - **Toned-down note** (plain sentence case, muted grey, no highlight box):
    > Please ensure timesheets are completed at the end of each week. These are critical to ensuring fees are tracked effectively and jobs are priced correctly.
  - A navy button **"Open Archimind →"** linking to the app base URL.
  - Small footer: "You're receiving this because your timesheet is outstanding…"
- Plain-text fallback supplied to `sendEmail` alongside `html`.
- **App URL:** read from an env var (e.g. `PUBLIC_APP_URL`), default `https://archimind.co.uk` if unset. Set on Railway (both environments).

### Admin UI
New **"Timesheet reminder"** block in `AdminSection.jsx` → **Notifications** tab (admin-only, sits alongside the existing notification toggles):
- Enabled checkbox.
- Day dropdown (Mon–Fri).
- Time select (30-min steps).
- "Chase incomplete weeks from" date input.
- **"Send a test reminder to my email"** button → triggers the reminder run immediately but delivers only to the logged-in admin, so the email + week logic can be verified on demand without waiting for the scheduled day. (Time-gated features are otherwise hard to test.)

### Server endpoints (admin-only, `requireAdmin`)
- `GET /api/admin/timesheet-reminder` → current `timesheet_reminder` settings (with defaults applied).
- `PATCH /api/admin/timesheet-reminder` → save settings to `app_settings`.
- `POST /api/admin/timesheet-reminder/test` → run the reminder computation now and send only to the requesting admin's email.

Client calls go through `api()` in `client/src/api/client.js` (never raw fetch). Route ordering: place specific routes before any `:id` wildcard (per HANDOVER).

### Deployment
**Server + client.** No SQL.
- Deploy **server → Railway first** (so the new settings/test endpoints and scheduler exist), **then client → Vercel** (admin UI that calls them).
- Ensure `PUBLIC_APP_URL` is set on Railway (both staging and prod).
- Work on `develop`, verify on staging (use the "Send test to my email" button to confirm the email and recipient logic), then merge `develop → main`.

---

## Out of scope
- Reminders to admins/HR about their own timesheets (explicitly excluded).
- Catch-up sends for whole-day server outages.
- Reminders for expenses (separate concern).
- Any change to overtime calculation, weekly-total logic, or submission workflow.
