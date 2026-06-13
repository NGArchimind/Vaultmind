# Admin Tabs & Notification Routing — Design

> Status: approved 2026-06-13. Awaiting implementation.

## Purpose

Two related changes to the admin experience:
1. **Tabbed admin section** — reorganise the Admin controls page (`AdminSection.jsx`) from one long vertical scroll into tabbed "windows" (one group visible at a time), styled like the home-page section tabs.
2. **Notification routing** — move the notification settings UI out of the Timesheets admin panel into a new Notifications tab, and change each notification from a single on/off toggle to **two toggles: Admin and HR**. Each event emails whichever roles are switched on.

Both are admin-only (the whole Admin section already is), so no access change.

## Part 1 — Admin tabs

`AdminSection.jsx` currently stacks five groups. Reorganise into five tabs:
- **Users** — User Management (existing)
- **Notifications** (moved in — see Part 2)
- **Quiz** — Quiz Management + Quiz Stats (existing)
- **Branding** — Practice Logo + Drawing Schedule Colours (existing)
- **ArchiSync** — connection code (existing)

A horizontal tab bar (reusing the existing in-repo tab styling from `TimesheetsSection` — active tab underlined in the module colour) sits below the Admin banner. Local `useState` holds the active tab; only the active tab's content renders. No content/logic of the existing groups changes — they are wrapped in tab panels, not rewritten. Default active tab: **Users**.

## Part 2 — Notification routing (Admin / HR)

### UI
The notification settings (currently `NotificationSettings` in `TimesheetsSection.jsx`, rendered in the timesheet `AdminPanel`) **move** to the new Notifications tab. The component is removed from `TimesheetsSection.jsx` (moved, not duplicated). Each of the five notifications shows **two toggles** labelled Admin and HR. Toggling either saves immediately (as today).

### Stored data shape
`app_settings` key `notification_settings` changes from:
```
{ "timesheet_submitted": true, ... }          // old: event → on/off
```
to:
```
{ "timesheet_submitted": { "admin": true, "hr": false }, ... }  // new: event → per-role
```
Stored as JSON in the existing `app_settings` row — **no DB schema change, no SQL**.

### Backward compatibility (so deploy order doesn't matter)
`getNotificationSettings()` normalises each key when reading:
- New object shape `{ admin, hr }` → used as-is (missing sub-key defaults to its role default).
- Old boolean `true`/`false` or missing → mapped to a default object (see defaults below).

This means old stored data and the new server both work, and the new server reads old data without a migration step.

### Defaults
- Three manager alerts (`timesheet_submitted`, `expense_submitted`, `unlock_requested`): **{ admin: true, hr: false }** — matches today's behaviour.
- Two formerly submitter-facing alerts (`expense_decided`, `timesheet_rejected`): **{ admin: false, hr: false }** — off by default; admin opts in.

### Server send logic
- Add `getHrEmails()` mirroring `getAdminEmails()` (filter `app_metadata.role === "hr"`).
- Add `notificationRecipients(key)` → reads settings for `key`, returns a deduped email list: admins if `admin` on, HR if `hr` on, `[]` if both off.
- Replace the five `isNotificationEnabled(key)` / `getAdminEmails()` call sites:
  - `timesheet_submitted` (~4037), `unlock_requested` (~4208), `expense_submitted` (~4362): send `to: notificationRecipients(key)`; skip if empty.
  - `expense_decided` (`notifyExpenseDecision`, ~104) and `timesheet_rejected` (~4168): **stop emailing the submitter**; send to `notificationRecipients(key)` instead; skip if empty.
- `isNotificationEnabled` is removed (or kept only if still referenced) — recipient-list emptiness now gates sending.

### Consequence (confirmed by Nathan)
Staff no longer automatically receive "your expense was approved/rejected" or "your timesheet was returned" emails — those two events become manager-only (Admin/HR), default off.

## Out of scope
- Per-user (individual) notification recipients — still role-based only.
- Notifications for HR about expenses are *allowed* by the toggles even though HR can't open expenses; no extra guard added (admin's choice).

## Testing notes
- Old stored settings (boolean shape) still load and send correctly under the new server (backward-compat path).
- Each event emails exactly the toggled roles; both-off = no email sent, no error.
- HR toggle emails only `hr`-role users; Admin toggle only `admin`-role users; both = union, deduped.
- Notification UI no longer appears in the Timesheets admin panel; appears in Admin → Notifications.
- Admin tabs: switching tabs shows the right group; all existing controls (logo upload, colours, quiz generate/clear, ArchiSync code) still work unchanged.

## Deployment
**Server (Railway) + client (Vercel).** No database/SQL. Backward-compatible read means order is not fragile, but deploy **server first, then client** so the new UI always talks to a server that understands the new shape. Verify on staging, then merge `develop` → `main`.
