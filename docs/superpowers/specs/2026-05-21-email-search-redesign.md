# Email Search Redesign — Design Spec
**Date:** 2026-05-21  
**Status:** Approved for implementation planning

---

## Overview

Redesign the EmailsTab to replace the current raw-list search with a Q&A-first interface. Users can ask natural language questions ("find me a confirmation of the electrical layout change") and receive an AI-generated plain-English summary backed by cited emails. A filterable inbox remains the default view, and a right-hand preview pane allows emails to be read without leaving the screen.

The redesign also improves the embedding strategy at ingest time to better capture confirmation, decision, and intent signals — making semantic search more precise for the core use case of finding client confirmations and agreements.

---

## Core Use Cases

1. **Vague memory search** — "I remember a conversation about party walls around 2023" → find relevant emails, show what was said
2. **Confirmation lookup** — "Did the client confirm we could proceed with the electrical works?" → AI answers yes/no with the supporting email cited
3. **Browse and filter** — Scroll through recent project emails, filter by sender or date without asking a question

---

## UI Design

### Three modes — same layout

| Mode | Trigger | What's shown |
|------|---------|--------------|
| **Browse** | Default on load | All emails, sorted by date descending |
| **Filtered** | Filter applied, no question | Emails matching filter criteria |
| **Q&A result** | Question submitted | AI summary + supporting emails only |

Filters persist across all modes. A **Clear results** button resets Q&A mode back to browse/filtered without clearing the filters.

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ✦ ASK A QUESTION                                               │
│  [Question input field                              ] [ Ask ]   │
│  [ From ▾ ] [ Date ▾ ] [ Attachments ▾ ] [ Subject ▾ ]  [Clear]│
├──────────────────────────────────┬──────────────────────────────┤
│  AI SUMMARY (Q&A mode only)      │                             │
│  ─────────────────────────────── │   EMAIL PREVIEW PANE        │
│  4 SUPPORTING EMAILS             │                             │
│  ┌──────────────────────────┐    │   (shown when an email      │
│  │ J. Smith · 14 Mar 2024   │◀── │    is clicked)              │
│  │ Re: Electrical layout    │    │                             │
│  │ …happy to proceed…       │    │   From / To / Date header   │
│  └──────────────────────────┘    │   Full email body           │
│  ┌──────────────────────────┐    │                             │
│  │ P. Jones · 2 Feb 2024    │    │                             │
│  └──────────────────────────┘    │                             │
└──────────────────────────────────┴──────────────────────────────┘
```

### Email list rows

Each row shows:
- Sender name + email address
- Subject line
- Sent date
- Snippet: first ~120 characters of body text (or the AI-matched excerpt in Q&A mode)
- Attachment indicator if `has_attachments` is true
- Email type badge (`confirmation`, `query`, `instruction`, etc.) — subtle, right-aligned. Only shown if `email_type` is set; hidden for emails not yet re-embedded.

Clicking a row opens it in the preview pane. The previously selected row stays highlighted.

### Preview pane

Always visible on the right. Shows:
- From / To / CC / Date header block
- Full `body_text` (cleaned, reply chain stripped)
- Empty state: *"Select an email to preview it"*

The paginated email list does not include `body_text` (too large to load in bulk). Clicking a row triggers `GET /api/projects/:id/emails/:eid` to fetch the full body, same as today.

---

## Filter System

Filters are always visible at the top. They narrow the email pool in all three modes.

| Filter | Type | Behaviour |
|--------|------|-----------|
| **From** | Text input | `ilike` match on `from_address` or `from_name` |
| **Date range** | Date from / Date to | `gte` / `lte` on `sent_at` |
| **Attachments** | Toggle | `eq has_attachments true` |
| **Subject** | Text input | `ilike` match on `subject` |
| **Email type** | Dropdown | `eq email_type [value]` — new, see below |

In **browse/filtered mode**, filters are applied server-side on each change (replaces the current client-side `applyFiltersToInbox` approach).

In **Q&A mode**, filters are passed to the `/emails/ask` endpoint and applied before semantic search runs.

---

## Q&A Pipeline — New Server Endpoint

`POST /api/projects/:id/emails/ask`

### Request
```json
{
  "question": "Did the client confirm we could proceed with the electrical works?",
  "filters": {
    "from": "",
    "date_from": "2024-01-01",
    "date_to": "",
    "has_attachments": null,
    "subject": "",
    "email_type": "confirmation"
  },
  "limit": 20
}
```

### Server steps

1. **Apply metadata filters** — build a Supabase query against `project_emails` using the filter params. Retrieve matching email IDs (not full bodies yet).
2. **Expand the question** — call `expandSearchQuery(question)` to add synonyms and related terms.
3. **Embed the expanded question** — call `generateEmbedding(expandedQuestion, "RETRIEVAL_QUERY")`.
4. **Hybrid semantic search** — call an updated `search_project_emails_hybrid` RPC that accepts an optional `p_email_ids uuid[]` parameter. When provided, the RPC restricts results to that set before ranking. Pass the filtered email IDs from step 1. Return top `limit` results. (RPC update required in Supabase — see Files Affected.)
5. **Fetch email bodies** — fetch `body_text` for the returned email IDs.
6. **Gemini summarisation** — send email bodies to Gemini Flash with this prompt structure:
   ```
   You are reviewing emails from an architectural practice project.
   Question: [question]
   
   Based only on the emails provided, answer the question directly. 
   Summarise what was confirmed, agreed, or decided. Note any contradictions 
   or unresolved points. If no clear answer is found, say so plainly.
   Keep the summary under 100 words.
   
   Emails:
   [email 1: subject, from, date, body]
   [email 2: ...]
   ```
7. **Return**:
```json
{
  "summary": "Client J. Smith confirmed approval on 14 Mar 2024, stating they were happy to proceed with the revised layout. No contradictions found.",
  "supportingEmailIds": ["uuid1", "uuid2", "uuid3"]
}
```

### Error handling
- If filtered pool returns 0 emails: return `{ summary: null, supportingEmailIds: [], message: "No emails match your filters — try broadening the date range or removing filters." }`
- If Gemini summarisation fails: return the supporting emails without a summary, with a status message.

---

## Embedding Improvements

### Current approach (ingest)
1. Strip reply chain from body
2. `generateSemanticSummary` → generic key topics (60 words)
3. Embed: `[summary, subject, from, body]`

### New approach (ingest)

Replace `generateSemanticSummary` with `generateStructuredSummary` — a single Gemini Flash call that returns both the rich summary and the email type:

**Gemini prompt:**
```
Analyse this email from an architectural practice.

Subject: [subject]
From: [from_name] <[from_address]>
Body: [cleaned body]

Return JSON with two fields:
1. "summary": 80–120 words capturing — what was confirmed, decided, or requested; 
   who sent it and their role (client, consultant, contractor, internal); 
   any key dates, amounts, or reference numbers mentioned; 
   related topics and technical synonyms.
2. "type": one of: confirmation, query, instruction, information, objection, other

Return only valid JSON. No preamble.
```

**Example output:**
```json
{
  "summary": "Client James Smith confirmed approval of revised electrical layout drawings. Decision to proceed with works as shown on Rev C drawings. Sender is client. Related: electrical layout, socket positions, Rev C drawings, sign off, approval, electrical works commencement.",
  "type": "confirmation"
}
```

The `summary` is prepended to the embedding text. The `type` is stored in a new `email_type` column.

### Database migration required
```sql
ALTER TABLE project_emails ADD COLUMN IF NOT EXISTS email_type text 
  CHECK (email_type IN ('confirmation','query','instruction','information','objection','other'));
```

### Re-embedding existing emails
The existing `/emails/reembed` endpoint handles this. It will be updated to:
- Use the new `generateStructuredSummary` function
- Store the returned `type` value into `email_type`
- Process in chunks of 10 with 1s delay between chunks (see Rate Limiting below)
- Accept an optional `projectId` param to re-embed a single project

A **Re-embed emails** button in the admin panel triggers this with a progress counter: *"Re-embedding 240 / 15,000 emails…"*

---

## Rate Limiting & Batch Processing

### Problem
Gemini calls per email at ingest: 1 Flash call (structured summary) + 1 Embedding call. On large initial syncs (hundreds or thousands of emails), firing these sequentially without delay will hit RPM limits.

### Ingest endpoint — chunked processing

Process the incoming email batch in chunks of 10, with a 1-second pause between chunks:

```
Received batch of 300 emails
→ Chunk 1 (1–10): process → pause 1s
→ Chunk 2 (11–20): process → pause 1s
→ ...
→ Return { inserted, skipped, errors } after all chunks complete
```

On a rate-limit error (429) for any individual email, wait 15 seconds and retry once before marking as an error.

### ArchiSync — split large syncs

For initial syncs of large mailboxes, ArchiSync should send emails in batches of 100 per POST request rather than all at once. Subsequent incremental syncs (new emails only, using `synced-ids`) will naturally be small.

This change is in ArchiSync's sync logic, not in the server endpoint.

### Re-embed endpoint — same chunking

Same chunk-of-10 + 1s delay pattern. For 15,000 emails this takes approximately 25 minutes to complete — this is expected and the progress indicator makes it visible.

---

## Performance — Email Loading

### Current problem
On tab load, the client fetches up to 1,000 emails into memory. At 15,000 emails this will be slow and memory-heavy.

### New approach — server-side pagination

Load 50 emails per page. The email list renders the current page and loads the next page as the user scrolls (infinite scroll pattern).

- `GET /api/projects/:id/emails?page=1&limit=50&from=&date_from=&date_to=` — paginated, filtered
- Filters applied server-side on each change (replaces client-side `applyFiltersToInbox`)
- Q&A always runs server-side against the full filtered pool regardless of what page is loaded

---

## Files Affected

| File | Change |
|------|--------|
| `client/src/components/ProjectsSection.jsx` | Rewrite `EmailsTab` component — new layout, three modes, preview pane, pagination |
| `server/index.js` | Add `POST /emails/ask` endpoint; update `generateSemanticSummary` → `generateStructuredSummary`; add chunking to ingest + reembed; add paginated `GET /emails` |
| Supabase | `ALTER TABLE project_emails ADD COLUMN email_type text`; update `search_project_emails_hybrid` RPC to accept optional `p_email_ids uuid[]` parameter |
| `archimind-sync` | Split large initial syncs into batches of 100 per request |

---

## Out of Scope

- Thread/conversation grouping (group replies under a single subject) — considered but deferred; adds complexity and the Q&A approach largely mitigates the need
- Cross-project email search — Nathan always searches within a single project
- Email export
- Marking / flagging emails
