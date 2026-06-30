# Timesheets — "Unpriced Extra" works tracking (design spec)

**Date:** 2026-06-30
**Status:** Approved design, ready to build (intended for a fresh build session)
**Owner:** Nathan (non-technical) — follow the working-style rules: explain in plain English before changes, get explicit approval each step, never commit (Nathan commits), say what to deploy & where, give SQL run-order, and **staging-test before main** (timesheets are payroll-adjacent — be careful).

---

## 1. Purpose

Let staff flag time spent on **works not covered by the current fee** ("unpriced extras"), **categorised by a per-project list of extra-types**, so the practice can track accrued unpriced work per job and raise variations. The category groups extras together; an optional note captures specifics.

## 2. Decisions (already agreed with Nathan — do not re-litigate)

1. **It's a tag, not a separate bucket.** Unpriced-extra time **counts as normal worked time** — it still counts toward the daily 7.5h cap and the weekly total exactly like any project time. No changes to hours, pay, overtime, cap or totals logic. The flag is purely for billing/tracking.
2. **Project lines only.** The tickbox appears only on **project** entry rows, never on leave/category rows (extras only make sense against a job).
3. **Category + optional note.** Ticking reveals a **dropdown of that project's extra-types**. Picking a type is **required** when ticked. The existing **notes** field stays as optional free-text detail.
4. **Anyone adds types on the fly.** If the needed extra-type isn't in the dropdown, the user types a new one and it's saved to that project's list for everyone from then on. (No admin management UI in v1; an admin tidy-up/merge tool can come later if duplicates become a problem.)
5. **Tracking lives in Fee Review** (admin), per project, **grouped by extra-type**, with hours + notes, included in the existing PDF/CSV export.
6. **Submit gate:** if a line is marked unpriced-extra but has **no type chosen**, block the week's Submit with a clear prompt (mirror the existing daily-cap gate — client blocks + server rejects).

## 3. Data model

**New table `project_extra_types`** (per-project list of extra-types):

```sql
create table project_extra_types (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  label       text not null,
  created_at  timestamptz default now()
);
-- one label per project (case-insensitive) to limit near-duplicates
create unique index project_extra_types_unique on project_extra_types (project_id, lower(label));
-- RLS lockdown convention: enable RLS, add NO permissive policy (server-only via service key).
alter table project_extra_types enable row level security;
```

**`timesheets` — two new columns:**

```sql
alter table timesheets add column unpriced_extra boolean not null default false;
alter table timesheets add column extra_type_id  uuid references project_extra_types(id) on delete set null;
```

Notes:
- A line is an unpriced extra iff `unpriced_extra = true`; `extra_type_id` holds the chosen type. (Both stored to match the tickbox mental model and make reporting filters trivial.)
- `on delete set null` is fine because there's no type-delete UI in v1. `project_extra_types` cascades when a project is deleted (consistent with the all-CASCADE project tree confirmed 2026-06-30).
- **RLS:** every table is server-only deny-all (see HANDOVER "RLS — every table is server-only"). Do **not** add a permissive `USING(true)` policy.

## 4. Server changes

### 4a. Project extra-types endpoints — `server/routes/projects.js`
Mirror the existing sub-resource pattern (see consultants/notes around lines 131–270). Add:

- `GET  /api/projects/:id/extra-types` (`requireAuth`) → `select("*").eq("project_id", id).order("label")` → `{ extra_types }`.
- `POST /api/projects/:id/extra-types` (`requireAuth`) → body `{ label }`. Trim; reject empty. **Dedupe:** first look for an existing row with `lower(label)` match for this project and return it if found (so concurrent/again-typed labels don't error on the unique index); otherwise insert and return the new row. Return `{ extra_type }`.
  - (Anyone authenticated can add — agreed. Not admin-gated.)

### 4b. Timesheet create/update — `server/routes/timesheets.js`
- **POST `/api/timesheets`** (line ~129): accept `unpriced_extra`, `extra_type_id` in the body. In the insert (line ~145), add — **only for project lines**:
  ```js
  unpriced_extra: project_id ? !!unpriced_extra : false,
  extra_type_id:  project_id ? (extra_type_id || null) : null,
  ```
- **PUT `/api/timesheets/:id`** (line ~224): add to the conditional `updates` block (after line ~261):
  ```js
  if ("unpriced_extra" in req.body) updates.unpriced_extra = !!req.body.unpriced_extra;
  if ("extra_type_id"  in req.body) updates.extra_type_id  = req.body.extra_type_id || null;
  ```
- **Selects:** the entry selects use `"*, projects(id, name, job_number)"` (lines 65, 86, 157, 267). `*` already returns the two new columns. Add the extra-type label join where the label is needed for display:
  `"*, projects(id, name, job_number), project_extra_types(id, label)"`
  Apply at least to: GET `/api/timesheets` (line 65) and GET `/api/admin/timesheets` (line ~409, used by Fee Review).

### 4c. Submit validation — `server/routes/timesheets.js` POST `/api/timesheets/submit` (line ~164)
Alongside the existing `daysOverCap` check (lines ~178–194), add a check: fetch the week's entries' `unpriced_extra, extra_type_id`; if any row has `unpriced_extra = true && extra_type_id == null`, reject:
`400 { error: "Every 'unpriced extra' line needs an extra-type selected before you can submit." }`
Consider a small pure helper in `server/lib/` (e.g. `extrasMissingType(entries)`) with a `node --test` suite, matching `timesheetValidation.js` convention.

## 5. Client changes

### 5a. Entry row — `client/src/components/TimesheetsSection.jsx`
- `EntryRow` (around lines 210–290) already renders project/category select, Full/Half buttons, hours/minutes, overtime boxes, and a **notes** input. Add, **for project rows only** (i.e. when the row has a `project_id`, not a category):
  - An **"Unpriced extra"** checkbox near the overtime boxes.
  - When checked, a **dropdown** of that project's extra-types + an **"add new"** affordance (type-a-label → POST to `/api/projects/:projectId/extra-types`, then select it). A creatable-select; can reuse the look of the existing `ProjectPicker`/categories selects.
  - Persist via the existing `onUpdate(entry.id, { unpriced_extra, extra_type_id })` PUT path.
- **Fetching types:** lazy-load a project's extra-types on demand (when a row is ticked / when rendering an extra line). Cache by `project_id` in component state to avoid refetching. Endpoint: `GET /api/projects/:projectId/extra-types`.
- **Display:** an extra line should clearly show it's an extra and its type label (entry carries `project_extra_types.label` from the join).
- **Submit gate:** mirror `overCapDays` (lines ~965–975). Compute `extrasMissingType = entries.filter(e => e.unpriced_extra && !e.extra_type_id)`; if any, block `handleSubmitClick` with a toast ("Some unpriced-extra lines have no type selected") just like the daily-cap block.
- The `DraftRow` (first row on an empty day) can keep it simple — the tick can be set after the line is created (acceptable for v1), or add the same control if straightforward.

### 5b. Fee Review — `client/src/components/FeeReview.jsx`
- Data already comes from `GET /api/admin/timesheets` (line ~292), which will now include `unpriced_extra`, `extra_type_id`, and the joined `project_extra_types.label`.
- In `ProjectDrillDown` (line ~105): add an **"Unpriced extras"** section. Filter `entries.filter(e => e.unpriced_extra)`, group by `e.project_extra_types?.label || "(no type)"`, show per-type total hours and the individual entries (person via `userMap`, date, hours, note).
- **CSV export** (around line ~333): add an `Unpriced Extra` column = the type label (empty for normal lines) so extras export too. (PDF export is browser print of the `.print-area`, so the new section prints automatically.)

## 6. What stays exactly the same
Everyone's hours, pay, overtime, the **daily 7.5h cap**, weekly totals, leave handling, and the timesheet **launch-day lock / pre-1-July greying** (`TimesheetsSection.jsx`). This change only adds a tag, a per-project list, and a Fee Review section.

## 7. Build order, testing, deploy

1. **Run the SQL first** on Supabase (single shared DB across develop/main): create `project_extra_types` (+ RLS enable + unique index), then `alter table timesheets add ...`. **Before** deploying code — code that references missing columns breaks timesheet inserts.
2. Server changes (4a–4c). Add `node --test` for any new `lib/` helper.
3. Client changes (5a–5b). Build with `CI=false node node_modules/react-scripts/bin/react-scripts.js build` in `client/` (plain `npm run build` is broken on Nathan's machine).
4. **Staging test (develop):**
   - Add a new extra-type inline; confirm it persists and reappears for another row/user.
   - Log an unpriced extra with a type + note; confirm it saves and counts in the day/week totals normally.
   - Try to submit a week with an extra line that has **no type** → submit is blocked (client) and rejected (server).
   - Open Fee Review → drill into the project → confirm the "Unpriced extras" section groups by type with hours + notes; confirm CSV includes the type column.
   - Confirm leave/category rows have **no** tickbox.
5. Merge **develop → main**. **Deploy: both** — server → Railway, client → Vercel — **after** the SQL is applied.

## 8. Gotchas / conventions to honour
- **RLS deny-all** on the new table — no permissive policy.
- **`api()` wrapper** for all client calls (never raw `fetch`); colours from `constants.js`.
- **Auth:** `requireAuth` on the staff endpoints; the extra-types add is intentionally not admin-gated.
- **isoDate / BST:** if any date logic is touched, build `YYYY-MM-DD` from local parts, never `toISOString()`.
- **No backups (Supabase free tier)** — the SQL is additive (new table + nullable/defaulted columns), so it's low-risk, but double-check before running on the shared DB.

## 9. Out of scope (v1)
- Admin UI to rename/merge/delete extra-types (tidy-up tool) — revisit if duplicates accumulate.
- Per-project at-a-glance unpriced badge outside Fee Review.
- Reporting unpriced extras in the HR/Timesheet Report (only Fee Review for now).
