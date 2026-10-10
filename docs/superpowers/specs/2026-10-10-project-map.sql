-- Project Map (step 1: built from synced emails) — schema changes
-- Run this ON SUPABASE FIRST, before deploying the server + client code.
-- The change is additive (two new tables + two nullable columns on
-- project_emails), so it is low-risk on the shared develop/main database:
-- the live production server does not reference any of it.

-- 1. One row per topic in the map ("Ground floor walls"), holding its CURRENT value.
create table project_map_items (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  category            text not null,
  title               text not null,
  current_value       text not null default '',
  -- 'unconfirmed' = added by the AI, not yet checked. 'confirmed' = signed off by admin.
  status              text not null default 'unconfirmed' check (status in ('unconfirmed','confirmed')),
  -- Set when the item was carried over from the Agreements tab (stops double import).
  legacy_agreement_id uuid unique,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index project_map_items_project on project_map_items (project_id);

-- 2. The history tree: every statement about a topic, each with its source.
--    state: current    = the value in force
--           superseded = an earlier value, replaced
--           supporting = restates the current value (an extra source for it)
--           pending    = a proposed change awaiting admin sign-off
--           rejected   = a proposed change the admin turned down (kept for the record)
create table project_map_entries (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references project_map_items(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  title        text not null default '',
  value        text not null,
  quote        text not null default '',
  stated_by    text not null default '',
  entry_date   date,
  source_type  text not null default 'email' check (source_type in ('email','agreement','manual','minutes','document')),
  source_id    uuid,
  source_label text not null default '',
  state        text not null check (state in ('current','superseded','supporting','pending','rejected')),
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index project_map_entries_item on project_map_entries (item_id);
create index project_map_entries_project_state on project_map_entries (project_id, state);

-- RLS lockdown convention: enable RLS, add NO permissive policy.
-- All access is server-side via the service key (deny-all to the browser key).
alter table project_map_items   enable row level security;
alter table project_map_entries enable row level security;

-- 3. Track which emails have been read into the map.
--    map_processed_at: set once the email has been read (even if it held nothing of substance).
--    map_error: set instead if reading failed, so the admin can retry.
alter table project_emails add column map_processed_at timestamptz;
alter table project_emails add column map_error text;
