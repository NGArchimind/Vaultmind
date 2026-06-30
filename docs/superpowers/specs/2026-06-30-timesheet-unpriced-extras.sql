-- Unpriced-extra works tracking — schema changes
-- Run this ON SUPABASE FIRST, before deploying the server + client code.
-- (Deploying code that references these columns before they exist would break
--  timesheet inserts.) The change is additive (new table + nullable/defaulted
--  columns), so it is low-risk on the shared develop/main database.

-- 1. Per-project list of "extra-types" (grows on the fly as staff add them)
create table project_extra_types (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  label       text not null,
  created_at  timestamptz default now()
);

-- One label per project, case-insensitive, to limit near-duplicates.
create unique index project_extra_types_unique
  on project_extra_types (project_id, lower(label));

-- RLS lockdown convention: enable RLS, add NO permissive policy.
-- All access is server-side via the service key (deny-all to the browser key).
alter table project_extra_types enable row level security;

-- 2. Two new columns on timesheets
--    unpriced_extra: the tick. extra_type_id: the chosen type for that line.
alter table timesheets add column unpriced_extra boolean not null default false;
alter table timesheets add column extra_type_id  uuid references project_extra_types(id) on delete set null;
