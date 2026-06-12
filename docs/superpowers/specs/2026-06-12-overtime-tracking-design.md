# Overtime Tracking — Design

> Status: approved 2026-06-12. Awaiting implementation plan.

## Purpose

Let users record overtime against individual job entries on their timesheet, stored so admins can review overtime as a metric across people and jobs.

## Key decisions

- **Additional, not a portion** — overtime is extra time on top of the normal hours for that entry (7h30 normal + 2h OT = 9h30 worked).
- **Tracked separately** — overtime does NOT feed the weekly total or the 37.5h/45h under/over warnings. The normal total displays as today; overtime shows as its own figure.
- **Job entries only** — the overtime counter appears on project/job entries, not on "Other" categories (Holiday, Sickness, Bank Holiday, Training, Internal).

## Storage

Two new columns on `timesheets`: `overtime_hours int not null default 0`, `overtime_minutes int not null default 0`. One-time `ALTER TABLE`; existing rows read as zero. No data migration.

## Server

- `POST /api/timesheets` and `PUT /api/timesheets/:id` accept `overtime_hours` / `overtime_minutes`.
- Validation reuses `validateTimesheetFields` limits (hours 0–16, minutes ∈ {0,15,30,45}). Overtime only meaningful when `project_id` set; ignore/zero it for category entries.
- Locking unchanged — submitted/approved weeks reject overtime edits via the existing lock check.
- `GET` routes (user + admin) already `select("*")`, so the new columns flow through automatically.

## Client

- `EntryRow` and `DraftRow`: add a second hours+minutes pair labelled "Overtime", shown only when the row is a project entry. Same selectors/increments, same locked styling.
- Week view: show a separate "Overtime: Xh" total beside the existing weekly total. Overtime excluded from the existing total and the submit warnings.
- Admin review (`AdminPanel`): show per-entry overtime and a weekly overtime total per person.
- `TimesheetReport`: add an overtime column to the export.

## Testing notes

- Overtime saves/loads per entry; defaults to zero on existing data.
- Weekly total and 37.5/45 warnings unchanged by overtime values.
- Overtime hidden/zeroed on category entries.
- Locked weeks reject overtime changes.

## Deployment

Full set: database (add two columns) + server (Railway) + client (Vercel).
