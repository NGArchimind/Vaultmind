# Timesheets & Expenses — pre-launch UI tweaks — Design

**Date:** 2026-06-23
**Author:** Nathan + Claude
**Status:** Approved design, ready for implementation plan

Five tweaks to the Timesheets/Expenses area, requested together ahead of rolling the tool out to the office. They are largely independent and will be **built and deployed one at a time** so each can be committed and verified on its own. Order below = build order.

| # | Item | Deploys to |
|---|------|-----------|
| 1 | Searchable project picker (+ curated "Other" reasons) | Client (Vercel) + small server endpoint (Railway) |
| 2 | Per-row Full day / Half day buttons | Client (Vercel) |
| 3 | Multi-item expense claims (+ PDF to admin) | **SQL first**, then server (Railway), then client (Vercel) |
| 4 | Remove "(optional)" from receipt label | Client (Vercel) |
| 5 | Admin password generator (show-once) | Server (Railway) + client (Vercel) |

---

## Item 1 — Searchable project picker

### Problem
The project chooser is a plain `<select>` (`ProjectOptions`, `client/src/components/TimesheetsSection.jsx` ~lines 130–146), reused in the saved entry row (`EntryRow` ~226), the draft row (`DraftRow` ~175), the quick-fill tool (~1089), and the expenses form (`client/src/components/ExpensesTab.jsx` ~199–202). With ~100 projects coming, a flat dropdown is too slow to scan, and there's no search.

### Solution — reusable type-to-search picker
Build **one reusable picker component** (e.g. `client/src/components/ProjectPicker.jsx`) and drop it into all of the above so behaviour is identical everywhere.

Behaviour:
- Closed, it shows the current selection (or a placeholder) and opens on click.
- A **search box** at the top filters as you type; matches on **both job number and project name** (case-insensitive substring).
- **Recently-used projects** for that person are pinned to the top under a **RECENT** heading, then **ALL PROJECTS** below.
- A single **"Other — non-project time"** bar sits **directly under the search box**. Tapping it swaps the panel to the curated reasons list (alphabetical), with a **"‹ Back to projects"** link. Typing a reason name (e.g. "sick") in the search also surfaces the matching reason.
- Keyboard: typing focuses the search; Esc closes. (Mouse/touch is the primary path.)
- Emits the same values the current `<select>` does: a project id, or `cat:<value>` for a reason, or `""`/cleared.

### Curated "Other" reasons (extends `CATEGORIES`)
`CATEGORIES` (TimesheetsSection.jsx ~9–14) grows from 5 to **11**. Kept: Holiday, Sickness, Bank Holiday, Training/CPD, Internal/Non-billable. **Added:** Maternity, Paternity, Compassionate, Medical Appointment, Unpaid Leave, Unauthorised.

These are **plain labels only** — no pay, allowance, or paid/unpaid logic anywhere (the app only logs hours; there is no payroll engine). They behave exactly like today's categories: tag the row, excluded from overtime, shown grouped in the timesheet and HR reports. Any code that maps a category value → label must use the shared `CATEGORIES` list so the new ones flow through (timesheet report group-by/filter, HR report).

### "Recent" data source (the small server bit)
"Recently used by this person" needs server data. New endpoint:
- `GET /api/timesheets/recent-projects` (`requireAuth`) → returns the current user's most-recently-used **distinct project ids** (e.g. last 8), derived from their `timesheets` rows ordered by `entry_date` desc. Client uses this list to order the RECENT group; falls back gracefully to no-recent if empty.

### Constraints / invariants
- Use `api()` from `client/src/api/client.js`, never raw fetch.
- Colours from `constants.js`; reuse the existing overtime amber for the "Other" styling rather than new hex.
- The picker must preserve the exact selection semantics of the current `<select>` so the surrounding save logic (`handleProjectChange`, `DraftRow.save`) is unchanged.

### Deployment
**Server → Railway first** (recent-projects endpoint), **then client → Vercel.** No SQL.

---

## Item 2 — Per-row Full day / Half day buttons

### Problem
The Full day / Half day quick-fill buttons live at the **day** level (TimesheetsSection.jsx ~308–314) and are disabled once a day has more than one entry (`entries.length > 1`), because they fill the whole day. A day split across two jobs can't use them.

### Solution
Add **two buttons, "Full day" and "Half day"** (full wording), to **each entry row**, positioned **just left of the "Time worked" hours/minutes selects** (chosen layout — Option A). Each sets that row's `hours`/`minutes` to:
- Full day → `FULL_DAY` (7h 30m)
- Half day → `HALF_DAY` (3h 45m)

(reusing the `FULL_DAY`/`HALF_DAY` constants ~20–21). Applies to both the saved `EntryRow` and the draft row, and to project **and** category rows (they all have a Time-worked field).

### Constraints / invariants
- **Presentational/shortcut only** — overtime is untouched and stays excluded from the weekly total (per HANDOVER → "Timesheets — overtime").
- Buttons disabled when the week is `locked`.
- The day-level Full/Half buttons may stay as-is (single-entry days) or be removed in favour of the per-row ones — decide during implementation; do not change the day-total/overtime footer logic either way.
- The row widens; rely on the existing horizontal layout (rows already scroll on narrow screens). Keep buttons compact.

### Deployment
**Client only → Vercel.** No server or DB change.

---

## Item 3 — Multi-item expense claims (+ PDF to admin)

### Problem
Today an expense is submitted and approved **one at a time** (`project_expenses` table; `POST /api/expenses` ~4609; per-expense admin email ~4633). The admin email is plain HTML with **no receipt attached** and **no combined total**. Nathan wants staff to build a **claim of several lines** and submit once, and admin to receive **one PDF** with the total and every receipt.

### Data model
New table **`expense_claims`**:
- `id` (uuid, pk), `user_id` (uuid), `status` (`draft` | `pending` | `approved` | `rejected`), `submitted_at`, `decided_at`, `rejection_reason`, `created_at`, `updated_at`.

`project_expenses` gains **`claim_id`** (uuid, FK → `expense_claims.id`). Each expense row becomes a **line item** of a claim. The claim owns the status; the existing per-expense `status`/`rejection_reason` columns are left in place but no longer drive the UI (kept to avoid a destructive migration). The **claim total** is computed from its line items (`SUM(amount_pence)`), not stored.

**RLS:** `expense_claims` gets RLS **enabled with no permissive policy** (server-only, deny-all to the browser key) — same lockdown as every other table (HANDOVER → "RLS — every table is server-only"). **Do not** add a `USING(true)` policy.

**No data migration needed** — all current expense data is test data and will be cleared. The new flow always creates expenses inside a claim.

### Lifecycle
1. **Draft.** Opening the Expenses tab shows the user's open **draft claim** (created on first line add). Each line is added via the existing per-expense form (type, project, date, amount/miles, description, optional receipt) and stored as a `project_expenses` row with `claim_id` = the draft claim. Lines editable/deletable while `draft`.
2. **Submit.** "Submit claim" → claim `status` = `pending`, `submitted_at` set. Server generates the PDF and emails the configured recipients (`notificationRecipients("expense_submitted")`) with the PDF attached.
3. **Review.** Admin approves (`approved`, `decided_at`) or rejects (`rejected` + `rejection_reason`) the **whole claim** (chosen granularity — no per-line approval). Existing decision-notification routing (`expense_decided`, default off) is reused.
4. **After reject.** A rejected claim becomes editable again; fixing and resubmitting returns it to `pending`. Lines are locked while `pending`/`approved`.

### Staff UI (`ExpensesTab.jsx`)
- Reworked to show the **current draft claim** as a table of lines with a **running total** and an **"+ Add line"** action and a **"Submit claim"** button.
- Below: history of submitted claims with status, total, and the per-claim PDF link.

### Admin UI
- The existing admin expense-approval surface (located during implementation — grep approve/reject for `project_expenses`) changes from per-expense rows to **per-claim rows**: submitter · item count · **total** · submitted date · **📄 PDF** · Approve / Reject.

### PDF generation (server)
- Built server-side on submit using **pdf-lib** (already a dependency; used for merging). 
- **Summary page:** "Expense Claim" header, submitter, submitted date, claim id; a table of every line (type, project, date, description, miles, amount); **Total**.
- **Receipts:** each line with a receipt appended on **its own page** — images (JPG/PNG/WEBP) embedded; **PDF** receipts merged in. **HEIC** can't be embedded by pdf-lib → the summary notes "receipt is HEIC — attached separately" and the raw file is attached to the email alongside the PDF.
- Receipts are fetched from R2 by `receipt_key` (existing pattern ~4738).
- `sendEmail` already accepts `attachments` (server/index.js ~26/39) — pass the generated PDF (and any HEIC fallbacks).

### Endpoints (sketch; `requireAuth`, admin actions `requireAdmin`/existing guards)
- `POST /api/expense-claims` (get-or-create the user's draft claim), line CRUD reuses/extends `/api/expenses` with `claim_id`, `POST /api/expense-claims/:id/submit`, admin approve/reject on the claim, `GET /api/expense-claims/:id/pdf`.
- Route ordering: specific before `:id` (HANDOVER).

### Deployment (order matters)
1. **SQL first** (provided in the plan): create `expense_claims`, add `project_expenses.claim_id`, enable RLS deny-all on `expense_claims`, and clear test expense rows. Running app code that references `claim_id` before the column exists breaks inserts.
2. **Server → Railway.**
3. **Client → Vercel.**
Work on `develop`, verify on staging, merge `develop → main`.

---

## Item 4 — Remove "(optional)" from receipt label

`ExpensesTab.jsx` line 234: `Receipt (optional)` → `Receipt`. Only this label; other "(optional)" labels (Notes, etc.) are left alone.

### Deployment
**Client only → Vercel.**

---

## Item 5 — Admin password generator (show-once)

### Problem
Admin needs to set memorable passwords for staff and hand them out. Real passwords can never be read back (Supabase stores a one-way hash), so this is **generate + set + show once** — never stored in readable form. (Option A from brainstorming; Option B, storing plaintext for a permanent list, was rejected as a security risk.)

### Generator
- Pull **two short words** from a curated construction word bank (brick, dust, mortar, trowel, gravel, cement, rafter, joist, scaffold, timber, render, granite, …) and join them.
- Apply letter→number swaps (i→1, s→5, e→3, o→0, a→4) so there's always a digit or two.
- **All lowercase** (matches the `br1ckdu5t` example). Result ~9–13 chars, comfortably above Supabase's minimum.
- Pure helper (e.g. `client/src/utils/generatePassword.js` or server-side) with a small `node --test` for the swap/format rules.

### Two entry points (`AdminSection.jsx`)
1. **New user** (add-user form, password field ~678/~330): a **↻ Generate** button fills the password field with a generated value (visible), then "Create user" uses the existing `POST /api/admin/users`.
2. **Existing user** (user list): a **"Reset password"** action per row generates a new password, sets it on the account, and reveals it **once** in a highlighted panel with a **Copy** button and a "save it now, won't be shown again" note.

### Server
- `PATCH /api/admin/users/:uid` (~3647) currently updates **role only**. Extend it (or add `POST /api/admin/users/:uid/password`) to accept a new password and call `supabase.auth.admin.updateUserById(uid, { password })`. `requireAdmin`. Validate min length.
- New-user creation already takes a password; no change beyond the client Generate button.

### Constraints / invariants
- Generation/set is **admin-only**; never expose any endpoint that returns an existing password (there is none to return).
- After an admin changes someone's password, that user just logs in with the new one (no token-refresh subtlety like the role change has).

### Deployment
**Server → Railway first** (password-update endpoint), **then client → Vercel.**

---

## Out of scope (parked / future)
- **Per-line** expense approval (whole-claim only for now).
- Any **paid/unpaid or allowance** behaviour behind the new leave reasons — they are labels only.
- Storing or displaying existing passwords (impossible by design; rejected).
- Multi-line **claim-level** project (each line keeps its own project).
- HEIC receipt **embedding** (attached separately instead of rendered in-PDF).
