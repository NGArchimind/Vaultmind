# Notification Settings — Design

> Status: approved 2026-06-12. Awaiting implementation plan.

## Purpose

Give admins office-wide control over which timesheet/expense events send a notification email. Today two emails fire unconditionally to all admins; this adds on/off switches and three new notification types.

## Scope

Five notification types, each with a global (office-wide) on/off switch. Recipients are **not** configurable — admin events go to all admins, submitter events go to the submitting user. No per-person or per-recipient lists (explicitly out of scope).

| # | Event | Recipient | Today |
|---|-------|-----------|-------|
| 1 | Timesheet submitted | All admins | New email |
| 2 | Expense submitted | All admins | Exists |
| 3 | Timesheet unlock requested | All admins | Exists |
| 4 | Expense approved/rejected | Submitter | New email |
| 5 | Timesheet rejected/unlocked | Submitter | New email |

## Storage

Single row in existing `app_settings` table, key `notification_settings`, value = JSON of five booleans, e.g.
`{"timesheet_submitted":true,"expense_submitted":true,"unlock_requested":true,"expense_decided":true,"timesheet_rejected":true}`.
No new table, no migration. Already locked down server-side (RLS work 2026-06-12). Absent/missing keys default to `true`.

## Server

- `GET /api/admin/notification-settings` (requireAuth + requireAdmin) — returns the five flags, defaulting missing ones to true.
- `PUT /api/admin/notification-settings` (requireAuth + requireAdmin) — validates body is the known five boolean keys, upserts the JSON into `app_settings`.
- Helper `isNotificationEnabled(key)` reads the settings row; each send-site checks its flag before calling `sendEmail`.
- New send-sites:
  - Timesheet submitted → in `POST /api/timesheets/submit`, email admins (mirror existing expense-email style).
  - Expense decided → in admin expense approve/reject routes, look up submitter email (`supabase.auth.admin.getUserById`) and email them the outcome.
  - Timesheet rejected → in admin timesheet reject + unlock routes, email the submitter.
- All new emails reuse the existing branded HTML pattern and `escapeHtml()` for user-supplied text.

## Client

- New "Notifications" card in the admin settings area (alongside Mileage Rate in the admin panel), with five labelled toggle switches. Admin-only.
- Loads via `GET`, saves via `PUT`, with a small saved/toast confirmation.

## Defaults

All five default **on** at ship. Preserves current behaviour for #2 and #3; the three new ones (#1, #4, #5) are live but immediately switchable.

## Testing notes

- Toggling a type off suppresses only that email; others unaffected.
- Submitter-events resolve the correct recipient and skip silently if email lookup fails.
- Settings persist across server restarts (DB-backed).

## Deployment

Both: server (Railway) + client (Vercel). No DB migration.
