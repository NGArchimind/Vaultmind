# Share Answer Feature — Design Spec

**Date:** 2026-05-22
**Feature:** Share vault Q&A answers via a shareable link or email

---

## Overview

A small "Share" button appears below the vault Q&A answer card. Clicking it opens a compact modal giving the user two options: copy a shareable link to clipboard, or open their email client with the link pre-filled. The shareable link leads to a standalone public page showing the formatted answer — identical in appearance to the in-app view. Links expire after 7 days.

---

## UI — Share Button & Modal

### Share Button

- Small grey outline button labelled "Share", placed below the answer card in the same area as the "✎ Test Yourself" button
- Only visible when an answer is present (`answer` state is non-null)
- Styled to match the quiz button (grey outline, same font/size)

### Share Modal

A compact modal with two actions and a close button:

1. **Copy Link** — on click, calls `POST /api/shared-answers`, receives the `id`, constructs the URL as `window.location.origin + '/share/' + id` (works automatically on both staging and production domains). Copies to clipboard. Button label changes to "✓ Copied" for 2 seconds. If the link was already generated in this session, reuses the same ID (no duplicate inserts).
2. **Open in Email** — fires a `mailto:` link with:
   - Subject: `Archimind: {question}`
   - Body: `I used Archimind to look this up — see the full formatted answer here:\n\n{link}`
   - If the link hasn't been generated yet, generates it first, then opens the mailto

The modal closes on click outside or the close button. No form fields — one click per action.

---

## Data — `shared_answers` Table

New Supabase table:

```sql
CREATE TABLE IF NOT EXISTS shared_answers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question    text NOT NULL,
  answer      text NOT NULL,
  vault_name  text,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);
ALTER TABLE shared_answers ENABLE ROW LEVEL SECURITY;
-- Anyone can read (public share page), only authenticated users can insert
CREATE POLICY "Public read" ON shared_answers FOR SELECT USING (true);
CREATE POLICY "Auth insert" ON shared_answers FOR INSERT WITH CHECK (auth.role() = 'authenticated');
```

---

## Server — New Endpoints (`server/index.js`)

### `POST /api/shared-answers`

- Protected by `requireAuth`
- Body: `{ question, answer, vault_name }`
- Inserts a row into `shared_answers` with `expires_at = now() + 7 days`
- Returns `{ id }`

### `GET /api/shared-answers/:id`

- No auth required (public)
- Fetches the row by `id`
- If not found or `expires_at < now()`: returns `404 { error: "not_found" }`
- Returns `{ question, answer, vault_name, expires_at }`

---

## Client — Public Share Page (`SharePage.jsx`)

Standalone React component rendered at route `/share/:id`.

**Layout:**
- No nav bar, no sidebar, no login
- Centred content area (max-width ~800px), white card with teal top border (matching in-app answer card style)
- Uses existing `AnswerRenderer` component to render the answer — identical formatting to the in-app view
- Citations render as styled text but are **not clickable** (PDFs are behind auth)
- Small "Powered by Archimind" footer below the card

**States:**
- Loading: spinner while fetching
- Loaded: renders answer via AnswerRenderer
- Expired / not found: shows "This link has expired or is not available"

**Routing:**
- React Router is not installed in this project. Instead, `App.js` checks `window.location.pathname` at the top level — if it starts with `/share/`, it renders `SharePage` (passing the ID from the path) and returns early, skipping the main app entirely.
- A `vercel.json` file is added to the client root with a catch-all rewrite so Vercel serves `index.html` for all paths including `/share/*`:
  ```json
  { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
  ```

---

## Files Changed

| File | Change |
|---|---|
| `client/src/App.js` | Path check at top to render SharePage for `/share/*`; Share button below answer card; `shareId` state to avoid duplicate inserts |
| `client/src/components/ShareModal.jsx` | New — share modal component |
| `client/src/components/SharePage.jsx` | New — public standalone share page |
| `client/vercel.json` | New — catch-all rewrite so `/share/:id` is served by index.html |
| `server/index.js` | Add `POST /api/shared-answers` and `GET /api/shared-answers/:id` |
| Supabase | Run SQL migration to create `shared_answers` table |

---

## Out of Scope

- Link expiry cleanup job (expired rows are harmless in DB; can add later)
- Custom expiry durations
- Revoking / deleting a shared link
- Tracking who viewed a shared link
