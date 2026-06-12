# Timesheets Review & Expenses Feature — Design Spec

**Date:** 2026-05-29
**Status:** Approved — ready for implementation planning

---

## Overview

Two workstreams in one implementation:

1. **Timesheets hardening** — security fixes and usability improvements to the existing Timesheets feature before it is rolled out to staff (who can only see Vault and Timesheets).
2. **Expenses feature** — a new "My Expenses" tab within the Timesheets section allowing staff to submit ad-hoc expense claims for review and approval.

---

## Part 1 — Timesheets Security Fixes

### 1.1 Server-side lock enforcement

**Problem:** The submitted/approved lock is only enforced in the UI. The server will accept PUT, DELETE, and POST timesheet entries for any week regardless of its submission status. A direct API call (or a client bug) can mutate a submitted or approved timesheet.

**Fix:** On every write endpoint (`POST /api/timesheets`, `PUT /api/timesheets/:id`, `DELETE /api/timesheets/:id`), look up the week's `timesheet_submissions` row for the current user. If `status` is `submitted` or `approved`, return `403 Forbidden` with a clear error message. The date of the entry determines which week to check.

### 1.2 Prevent downgrade of approved status

**Problem:** `POST /api/timesheets/submit` uses an upsert that overwrites the status unconditionally. An approved timesheet can be downgraded back to `submitted` by calling this endpoint again.

**Fix:** Before upserting, fetch the existing submission. If `status === "approved"`, return `403 Forbidden — week already approved`.

### 1.3 Hours and minutes validation

**Problem:** The server accepts any numeric value for `hours` and `minutes` — negative numbers, fractional values, or unreasonably large numbers are all accepted.

**Fix:**
- `hours` must be an integer in range 0–16
- `minutes` must be one of: 0, 15, 30, 45
- Apply on both `POST /api/timesheets` and `PUT /api/timesheets/:id`
- Return `400 Bad Request` with a descriptive error message on failure

### 1.4 Entry date validation

**Problem:** `entry_date` is accepted without any format or range validation. A user could submit entries for weekends, far-future dates, or malformed date strings.

**Fix:** On `POST /api/timesheets`, validate that:
- `entry_date` is a valid ISO date string (YYYY-MM-DD)
- The day of the week is Monday–Friday (getDay() returns 1–5)
- Return `400 Bad Request` if either check fails

---

## Part 2 — Timesheets Usability Fixes

### 2.1 Delete confirmation dialog

**Problem:** The × button on each entry row deletes immediately with no warning. Accidental deletions cannot be undone.

**Fix:** Replace the direct `onDelete` call with a confirmation dialog (reuse the existing `ConfirmDialog` component in `TimesheetsSection.jsx`). Dialog text: "Remove this entry? This cannot be undone."

### 2.2 Admin timesheet rejection flow

**Problem:** Nathan can only approve timesheets. There is no way to reject one and send it back for correction.

**Fix:**
- Add a "Reject" button alongside "Approve" in `AdminPanel` within `TimesheetsSection.jsx`
- Clicking "Reject" opens a small inline form with a text input for the rejection reason
- On confirm: call `POST /api/admin/timesheets/reject` with `{ week, user_id, reason }`
- Server sets `status = "draft"`, stores `rejection_reason` on the `timesheet_submissions` row
- Staff member sees a rejection banner on that week's timesheet showing Nathan's reason, and can correct and resubmit

**Database change:** Add `rejection_reason text` column to `timesheet_submissions`.

### 2.3 History pagination

**Problem:** `GET /api/timesheets/history` returns all entries for the user with no limit. This will become slow as the team grows.

**Fix:**
- Load 6 weeks at a time (newest first)
- Add a "Load more" control at the bottom of the History view (a dropdown/button to load the next 6 weeks)
- Server: add `limit` and `offset` query params to `GET /api/timesheets/history`

### 2.4 DraftRow debounce

**Problem:** `DraftRow` calls `save()` on every individual field change (project, hours, minutes). Rapid changes fire multiple simultaneous API calls that can race.

**Fix:** Debounce the `save()` call by 300ms using `setTimeout`/`clearTimeout` inside the component. The save fires only after the user has stopped changing values for 300ms.

### 2.5 Unsubmit request flow

**Problem:** Staff have no way to correct a timesheet they have already submitted. They must contact Nathan outside the app.

**Fix — Staff side:**
- Show a "Request to Edit" button on any submitted or approved week (below the week navigator)
- Clicking opens a dialog with a required text field: "Why do you need to edit this timesheet?"
- On submit: call `POST /api/timesheets/unlock-request` with `{ week, reason }`
- Server stores the request and sends an email to Nathan (admin) via Resend

**Fix — Admin side:**
- Pending unlock requests appear in the admin review panel, highlighted
- Each request shows: staff member name, week, and their typed reason
- Nathan clicks "Unlock" → calls `POST /api/admin/timesheets/unlock` with `{ week, user_id }`
- Server resets the submission `status` to `"draft"`, clears `unlock_requested`
- Staff member can now edit and resubmit normally

**Database changes on `timesheet_submissions`:**
- `unlock_requested boolean NOT NULL DEFAULT false`
- `unlock_reason text`

**Email to Nathan:**
> Subject: Timesheet edit request — [Staff name]
> Body: [Staff name] has requested to edit their timesheet for [week].
> Reason: [their typed reason]
> [Review in Archimind — link to admin panel]

---

## Part 3 — Expenses Feature

### 3.1 Database

**New table: `project_expenses`**

```sql
CREATE TABLE IF NOT EXISTS project_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  expense_type text NOT NULL CHECK (expense_type IN ('train','mileage','meals','taxi','parking')),
  expense_date date NOT NULL,
  amount_pence integer,          -- null for mileage; stored in pence to avoid float errors
  miles numeric(6,1),            -- null for non-mileage types
  description text NOT NULL,
  receipt_key text,              -- R2 object key; null if no receipt uploaded
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  rejection_reason text,         -- populated by admin on rejection
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE project_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access" ON project_expenses USING (true) WITH CHECK (true);
```

**Mileage rate:** Configurable by admin — stored in the existing `app_settings` table with key `mileage_rate_ppm` (pence per mile, integer — e.g. 45 = £0.45/mile). Defaults to 45 if not yet set.

When a mileage expense is created or edited (while still pending), the server fetches the current rate and calculates `amount_pence = round(miles × rate_ppm)`, storing it on the record. This freezes the reimbursement value at the rate in effect at submission time — changing the rate later does not affect already-approved or rejected expenses. Both `miles` and `amount_pence` are stored; `miles` is shown for reference, `amount_pence` is the authoritative claim value.

**Receipt storage:** Cloudflare R2, key pattern: `expenses/{userId}/{expenseId}/{originalFilename}`. Accepted file types: images (JPEG, PNG, HEIC) and PDF.

### 3.2 Server endpoints

All user-facing endpoints require `requireAuth`. Admin endpoints additionally require `requireAdmin`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/expenses` | User's own expenses, newest first. Includes project name. |
| POST | `/api/expenses` | Create expense. Triggers email to admin. |
| PUT | `/api/expenses/:id` | Edit expense. Only if `status = pending` and `user_id` matches. |
| DELETE | `/api/expenses/:id` | Delete expense. Same ownership + status rules. |
| POST | `/api/expenses/:id/receipt` | Upload receipt file to R2. Updates `receipt_key`. |
| GET | `/api/expenses/:id/receipt` | Proxy receipt file from R2 to client. |
| GET | `/api/expenses/settings` | Returns current mileage rate in ppm (auth, not admin — needed by the expense form). |
| GET | `/api/admin/expenses` | All expenses. Filterable by `status`, `user_id`, `from`, `to`. |
| POST | `/api/admin/expenses/:id/approve` | Set `status = approved`, record `reviewed_by` + `reviewed_at`. |
| POST | `/api/admin/expenses/:id/reject` | Set `status = rejected`, store `rejection_reason`. Body: `{ reason }`. |
| GET | `/api/admin/expenses/settings` | Returns current mileage rate in ppm. |
| PUT | `/api/admin/expenses/settings` | Update mileage rate. Body: `{ mileage_rate_ppm: number }`. Validates positive integer. |

**Validation on POST/PUT `/api/expenses`:**
- `project_id` required
- `expense_type` must be one of the five allowed values
- `expense_date` must be a valid date, not in the future by more than 1 day (to catch timezone edge cases)
- For non-mileage: `amount_pence` required and must be a positive integer
- For mileage: `miles` required and must be a positive number; `amount_pence` is ignored

### 3.3 UI — Tab layout

`TimesheetsSection.jsx` gains a tab bar immediately below the white header bar:

```
[ My Timesheet ]  [ My Expenses ]
```

The active tab is underlined in `TIMESHEETS_FULL`. `My Timesheet` renders the existing weekly timesheet view. `My Expenses` renders the new `ExpensesTab.jsx` component.

### 3.4 UI — ExpensesTab.jsx (new component)

**List view (default):**
- Filter dropdown: All / Pending / Approved / Rejected
- "+ Add Expense" button (top right) — reveals the inline form above the list
- Each row shows: colour dot (amber=pending, green=approved, red=rejected), type, date, amount, description, project name, status badge
- Pending rows have: Edit button, Delete (×) button, receipt attachment icon (📎 if receipt present)
- Approved and rejected rows are read-only
- Rejected rows show Nathan's rejection reason in a red left-bordered panel directly below the row

**Add / Edit form (inline, appears above the list):**
- When editing a pending expense, all fields pre-fill with the existing values
- Type dropdown (Train / Car Mileage / Meals / Taxi / Parking)
- Project dropdown (same projects list as timesheets)
- Date picker (defaults to today)
- Amount field: labelled "Amount (£)" for non-mileage types; labelled "Miles" for Mileage with helper text showing the calculated reimbursement (e.g. "42 miles = £18.90")
- Description text input
- Receipt attachment: "📎 Attach file" — optional; accepts image/* and .pdf; shows filename once attached
- Cancel and Submit buttons

### 3.5 UI — Admin expenses review

Within `AdminPanel` in `TimesheetsSection.jsx`, add a toggle above the filter bar:

```
[ Timesheets ]  [ Expenses ]
```

The Expenses admin view shows all expenses (defaulting to Pending filter), with:
- User name/email, type, date, project, amount/miles, description, receipt link, status
- "Approve" button per row
- "Reject" button per row — clicking opens an inline text input for the rejection reason before confirming

**Mileage rate setting (top of the Expenses admin view):**
A small inline control showing the current rate (e.g. "Mileage rate: 45p / mile") with an "Edit" link. Clicking Edit reveals a number input and Save button. Saving calls `PUT /api/admin/expenses/settings`. Change takes effect for all new expenses from that point; existing records are unaffected.

### 3.6 Email — Resend

**Dependency:** Add `resend` npm package to `server/package.json`.

**Configuration:** `RESEND_API_KEY` environment variable on Railway. `RESEND_FROM` (e.g. `timesheets@yourpractice.co.uk`) set in Railway env vars.

**Email sent to Nathan when expense submitted:**

```
Subject: New expense — [Staff first name] · [Type] · £[amount]

[Staff full name / email] submitted an expense for your review.

Type:        Train
Date:        27 May 2026
Project:     1042 — Office Tower
Amount:      £24.50
Description: Waterloo → Reading, site visit

[Review expenses in Archimind →]
```

HTML version uses `TIMESHEETS_FULL` (#4c6278) as the accent colour to match the app. Plain text fallback included.

The email template is defined as an HTML string in `server/index.js` (or a small `emailTemplates.js` helper file). It can be edited at any time to change formatting, wording, or branding.

---

## Files Changed

### New files
- `client/src/components/ExpensesTab.jsx`

### Modified files
- `client/src/components/TimesheetsSection.jsx` — tab bar, delete confirmation, reject flow, unsubmit request button, admin expenses toggle, debounce on DraftRow
- `client/src/components/TimesheetHistory.jsx` — pagination (6 weeks, load more)
- `server/index.js` — all security fixes, new endpoints, email integration

### Database migrations (run in Supabase before deploying)
- `project_expenses` table (new)
- `ALTER TABLE timesheet_submissions ADD COLUMN IF NOT EXISTS rejection_reason text;`
- `ALTER TABLE timesheet_submissions ADD COLUMN IF NOT EXISTS unlock_requested boolean NOT NULL DEFAULT false;`
- `ALTER TABLE timesheet_submissions ADD COLUMN IF NOT EXISTS unlock_reason text;`

### New dependency
- `server/`: `npm install resend`

---

## Deployment order

1. Run SQL migrations in Supabase
2. Set `RESEND_API_KEY` and `RESEND_FROM` environment variables on Railway
3. Deploy server → Railway
4. Deploy client → Vercel
