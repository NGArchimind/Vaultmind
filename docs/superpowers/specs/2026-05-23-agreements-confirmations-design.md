# Agreements & Confirmations — Design Spec
**Date:** 2026-05-23
**Status:** Approved for implementation

---

## Overview

A per-project database of agreements and confirmations extracted automatically from uploaded meeting minutes and synced emails. Each agreement is a living record with a full update timeline. Users review and approve extracted items before they are saved. The database is browsable via filters and searchable via natural language Q&A.

---

## Scope

- Per-project (not global)
- Initial trigger: manual text input on the Agreements tab (paste or upload minutes text)
- Future triggers (out of scope for this spec): automatic extraction on Minutes tab upload; automatic extraction on email sync
- Both future triggers will call the same extraction endpoint — no structural changes needed when those features are built

---

## Data Model

### `project_agreements` table
One row per distinct agreement topic/subject.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid FK → projects | |
| `current_text` | text | Latest agreed text |
| `date_agreed` | date | Date of most recent agreement |
| `confirmed_by` | text | Name of person who confirmed |
| `others_present` | text | Comma-separated names |
| `source_type` | text | `'minutes'`, `'email'`, or `'manual'` |
| `source_id` | uuid nullable | FK to minutes/email record (when those features exist) |
| `source_label` | text | Human-readable label, e.g. "Design Team Meeting 14 May 2026" |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

RLS: `USING (true) WITH CHECK (true)` — standard pattern.

### `project_agreement_entries` table
One row per update to an agreement. The original creation also writes an entry.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `agreement_id` | uuid FK → project_agreements | |
| `text` | text | Text at this point in time |
| `date_agreed` | date | |
| `confirmed_by` | text | |
| `others_present` | text | |
| `source_type` | text | |
| `source_label` | text | |
| `source_id` | uuid nullable | |
| `created_at` | timestamptz | |

RLS: `USING (true) WITH CHECK (true)`.

---

## Server Endpoints

All routes use `requireAuth` middleware. All under `/api/projects/:id/agreements`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/projects/:id/agreements` | Return all agreements for project, with entries nested, newest first |
| `POST` | `/api/projects/:id/agreements` | Create a new agreement (manual or from review) |
| `POST` | `/api/projects/:id/agreements/:aid/entries` | Add an update entry to an existing agreement |
| `DELETE` | `/api/projects/:id/agreements/:aid` | Delete an agreement and all its entries |
| `POST` | `/api/projects/:id/agreements/extract` | Receive raw text (minutes/email body), call Gemini to extract candidate agreements, return list — does NOT save anything |
| `POST` | `/api/projects/:id/agreements/ask` | Q&A search — receive question, search agreement text semantically, return Gemini-synthesised answer |

---

## Extraction Endpoint — Detail

`POST /api/projects/:id/agreements/extract`

**Request body:** `{ text: "...", source_label: "Design Team Meeting 14 May 2026", source_type: "minutes" }`

**What it does:**
1. Sends the text to Gemini with a prompt instructing it to extract only genuine agreements, decisions, and confirmations — not action points, general discussion, or cross-references
2. For each extracted item, identifies: the agreement text, who confirmed it, who else was present, and the date (falling back to today if not stated)
3. Compares each extracted item against existing agreements for this project — flags possible matches (similarity above threshold) as potential updates rather than new agreements
4. Returns the list of candidates to the client — nothing is saved

**Gemini prompt rules:**
- Extract only explicit confirmations and decisions ("agreed", "confirmed", "to proceed with", "it was decided")
- Exclude: action points, questions, general discussion, "see attached", cross-reference clauses
- Return JSON array: `[{ text, confirmed_by, others_present, date_agreed, possible_match_id }]`
- `possible_match_id` is non-null if the item appears to update an existing agreement

**Possible match detection (server-side, before returning candidates):**
After Gemini extracts candidates, the server checks each one against existing agreements for the project. If a candidate sounds like something already agreed — for example, new minutes mention "door frames" and there's already an agreement about door frames — it flags that row in the review screen with an amber warning: "this might be an update to an existing agreement." This prevents accidental duplicates and makes it easy to add the new decision to the existing agreement's timeline instead of creating a separate record. Detection uses simple keyword overlap (no vector embeddings needed at this scale).

---

## Review Modal (Client)

Triggered from the Agreements tab by a "Review Minutes" button. User pastes or uploads text → modal opens showing extracted candidates.

**Per-row state:** undecided → agreed (green) | discarded (greyed, strikethrough)

**Amber warning row:** if `possible_match_id` is set, the row shows: *"⚠ Possible update to an existing agreement — review timeline before saving"*

**Footer:** live tally of agreed / discarded / pending. "Save agreed (N)" button commits only the agreed rows.

**On save:**
- For rows with no `possible_match_id`: creates a new `project_agreements` record + first `project_agreement_entries` record
- For rows with `possible_match_id` where user agreed: creates a new `project_agreement_entries` record on the existing agreement, and updates `project_agreements.current_text`, `date_agreed`, `confirmed_by`, `others_present`, `source_label`

---

## Agreements Tab (Client)

New tab in the project section: **"Agreements"**, alongside Info, Consultants, Drawings etc.

### Layout (top to bottom)

**Q&A bar** — green (PROJECTS_FULL) bar at top. Text input: "Ask anything about agreements on this project…". Uses `/api/projects/:id/agreements/ask`. Answer displayed in the existing full-screen Q&A panel.

**Filter bar** — below Q&A bar:
- Source dropdown: All / Minutes / Email / Manual
- Person dropdown: populated from `confirmed_by` values in this project
- Keyword text input: filters on `current_text`
- "Review Minutes" button (right-aligned) — opens the review modal
- "+ Add Agreement" button — opens a simple form for manual entry

**Agreement cards** — flat list, newest `date_agreed` first, filtered in real time.

Each card (collapsed):
- Bold current text
- Row of metadata: 📅 date · 👤 confirmed by · 👥 others · source badge (Minutes/Email/Manual)
- "Open source" button — takes you back to where the agreement came from, so you can read the full context. Hidden on manual entries (nothing to open). For email agreements, opens the original email thread. For minutes agreements, this will work once the Minutes tab is built — shown as inactive until then.
- ▼ expand arrow

Each card (expanded): shows the above + an "Update history" section below, bordered left in light grey. Each historical entry shows: original/previous text, date, source label. Entries are in reverse chronological order (oldest at bottom).

**Manual add form:** text area for agreement text, date picker, confirmed-by field, others-present field. Source type set to `'manual'`. No source label or ID.

---

## Q&A Search — Detail

`POST /api/projects/:id/agreements/ask`

**Approach:** Same pattern as the email Q&A. All agreement texts (current + historical entries) for the project are compiled into a context string and sent to Gemini with the question. Gemini synthesises a direct answer citing the relevant agreements by text (e.g. "As agreed on 14 May 2026 — door frames to be oak veneer…").

**Answer display:** Rendered inline within the Agreements tab, below the Q&A bar. A simple answer card appears with the Gemini response and a "Clear" button to dismiss it.

**Bottom bar Q&A:** The existing Projects bottom bar Q&A (which already includes tasks, transmittal, drawings, products etc.) will also be updated to include agreements data in its context — so the user can ask about agreements from anywhere in the project, not just while on the Agreements tab. The bottom bar fetches agreements alongside the other data sources on load.

---

## What Is Not In Scope

- Automatic triggering from Minutes tab upload (future — Minutes tab not yet built)
- Automatic triggering from email sync (future)
- Embedding/vector search (plain text search + Gemini synthesis is sufficient at this scale)
- Agreement status flags ("active" / "superseded") — the timeline makes this implicit
- Notifications or alerts when agreements are added

---

## SQL Migration

```sql
CREATE TABLE IF NOT EXISTS project_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  current_text text NOT NULL,
  date_agreed date NOT NULL,
  confirmed_by text NOT NULL DEFAULT '',
  others_present text NOT NULL DEFAULT '',
  source_type text NOT NULL DEFAULT 'manual' CHECK (source_type IN ('minutes','email','manual')),
  source_id uuid,
  source_label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_agreement_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES project_agreements(id) ON DELETE CASCADE,
  text text NOT NULL,
  date_agreed date NOT NULL,
  confirmed_by text NOT NULL DEFAULT '',
  others_present text NOT NULL DEFAULT '',
  source_type text NOT NULL DEFAULT 'manual' CHECK (source_type IN ('minutes','email','manual')),
  source_label text NOT NULL DEFAULT '',
  source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE project_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access" ON project_agreements USING (true) WITH CHECK (true);

ALTER TABLE project_agreement_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access" ON project_agreement_entries USING (true) WITH CHECK (true);
```

---

## Deployment

- Client changes → Vercel
- Server changes → Railway
- SQL migration → run in Supabase before deploying server

---

## Files to Create / Modify

| File | Change |
|---|---|
| `server/index.js` | Add 6 new endpoints |
| `client/src/components/ProjectsSection.jsx` | Add Agreements tab + tab content component |
| `client/src/components/AgreementsTab.jsx` | New component — tab content, filter bar, card list, manual add form |
| `client/src/components/AgreementsReviewModal.jsx` | New component — review modal |
| Supabase | Run SQL migration above |
