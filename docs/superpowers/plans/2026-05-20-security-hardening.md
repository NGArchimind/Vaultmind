# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 8 surgical security issues identified in the May 2026 security review, leaving tenant isolation and audit logging for a separate plan (they require schema migrations).

**Architecture:** All changes are confined to `server/index.js` except Task 1 (helmet install). Each task is a self-contained, low-risk surgical edit. No file restructuring. No refactoring of working code.

**Tech Stack:** Node.js / Express, Railway, Supabase, Cloudflare R2, Helmet.js (new dependency)

**Context:** Nathan is a non-developer. Always use Edit tool (never rewrite whole files). Always read the file before editing. Provide complete context in each step — don't reference earlier steps for code.

---

## Files Modified

- `server/package.json` — add `helmet` dependency
- `server/index.js` — all other changes

---

### Task 1: Install Helmet.js

Helmet adds standard HTTP security headers (X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security, etc.) in one line.

**Files:**
- Modify: `server/package.json`
- Modify: `server/index.js` (top of file, after `const cors = require("cors");`)

- [ ] **Step 1: Add helmet to package.json**

Open `server/package.json`. Add `"helmet": "^7.1.0"` to the dependencies object so it reads:

```json
{
  "name": "archimind-server",
  "dependencies": {
    "@aws-sdk/client-s3": "^3.600.0",
    "@aws-sdk/s3-request-presigner": "^3.1045.0",
    "@supabase/supabase-js": "^2.45.0",
    "cors": "^2.8.5",
    "exceljs": "^4.4.0",
    "express": "^4.18.2",
    "helmet": "^7.1.0",
    "pdf-lib": "^1.17.1",
    "mupdf": "^1.27.0"
  }
}
```

- [ ] **Step 2: Add the require at the top of server/index.js**

In `server/index.js`, the first line after `const cors = require("cors");` (line ~2), add:

```js
const helmet = require("helmet");
```

- [ ] **Step 3: Mount helmet before all other middleware**

In `server/index.js`, immediately after `const app = express();` (line ~7), add:

```js
app.use(helmet({ crossOriginResourcePolicy: false }));
```

`crossOriginResourcePolicy: false` is needed because the API serves binary content (PDFs as base64) to a cross-origin frontend.

- [ ] **Step 4: Verify the require and app.use are in the right order**

The top of `server/index.js` should now read in this order:
```js
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
// ... other requires ...

const app = express();
app.use(helmet({ crossOriginResourcePolicy: false }));

const rateLimitMap = new Map();
```

- [ ] **Step 5: Commit (GitHub Desktop)**

Stage `server/package.json` and `server/index.js`. Commit message:
```
security: add helmet.js for HTTP security headers
```

---

### Task 2: Fix CORS Allowlist

The CORS list contains two old Vercel preview URLs but not the real production domain `https://archimind.vercel.app`.

**Files:**
- Modify: `server/index.js` (the `app.use(cors(...))` block, lines ~28-34)

- [ ] **Step 1: Read the current CORS block**

In `server/index.js`, find the `app.use(cors({` block. It currently reads:

```js
app.use(cors({
  origin: [
    "https://archimind-omega.vercel.app",
    "https://archimind-git-develop-nathan-greens-projects-192281d0.vercel.app"
  ],
  credentials: true
}));
```

- [ ] **Step 2: Replace with the corrected allowlist**

Replace the entire block with:

```js
app.use(cors({
  origin: [
    "https://archimind.vercel.app",
    "https://archimind-omega.vercel.app",
    "https://archimind-git-develop-nathan-greens-projects-192281d0.vercel.app"
  ],
  credentials: true
}));
```

The production URL is now first in the list. The two preview URLs are kept for staging.

- [ ] **Step 3: Confirm in Railway that `VERCEL_URL` or similar isn't being used dynamically**

This is a manual check — no code change. Log in to Railway, open the Archimind service, check Environment Variables. Confirm there's no `CORS_ORIGIN` variable that might override this. If there is, note it for investigation.

- [ ] **Step 4: Commit (GitHub Desktop)**

Stage `server/index.js`. Commit message:
```
security: fix CORS allowlist to include production domain
```

---

### Task 3: Whitelist Allowed Gemini Models

Any authenticated user can currently request any `gemini-*` model (including expensive ones like Gemini Ultra) by passing it in the request body.

**Files:**
- Modify: `server/index.js` (inside the `POST /api/claude` handler, line ~213)

- [ ] **Step 1: Find the model selection line**

In `server/index.js`, inside the `app.post("/api/claude", ...)` handler, find this line:

```js
const requestedModel = model && model.startsWith("gemini-") ? model : "gemini-2.5-flash";
```

- [ ] **Step 2: Replace with a whitelist check**

Replace that single line with:

```js
const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
]);
const requestedModel = (model && ALLOWED_MODELS.has(model)) ? model : "gemini-2.5-flash";
```

Add the models you actually use to `ALLOWED_MODELS`. Any model name not in this set falls back to `gemini-2.5-flash`.

- [ ] **Step 3: Commit (GitHub Desktop)**

Stage `server/index.js`. Commit message:
```
security: whitelist allowed Gemini models to prevent cost abuse
```

---

### Task 4: Sanitise Vault Rename — Missing newName Validation

The PATCH `/api/vaults/*` handler sanitises the source vault path but NOT the new name, allowing unusual characters to enter R2 key paths.

**Files:**
- Modify: `server/index.js` (the `app.patch("/api/vaults/*", ...)` handler, lines ~381-403)

- [ ] **Step 1: Find the rename handler**

In `server/index.js`, find this handler:

```js
app.patch("/api/vaults/*", requireAuth, async (req, res) => {
  const vaultPath = sanitizeVaultPath(req.params[0]);
  const { name: newName } = req.body;
  if (!newName) return res.status(400).json({ error: "New name required" });
```

- [ ] **Step 2: Add sanitisation for newName**

Replace those four lines with:

```js
app.patch("/api/vaults/*", requireAuth, async (req, res) => {
  const vaultPath = sanitizeVaultPath(req.params[0]);
  const rawNewName = req.body.name;
  if (!rawNewName) return res.status(400).json({ error: "New name required" });
  const newName = sanitizeVaultPath(rawNewName);
  if (!newName) return res.status(400).json({ error: "Invalid vault name" });
```

The rest of the handler remains unchanged. `sanitizeVaultPath` strips `..`, `.`, empty segments, and backslashes — the same protection already applied to the source path.

- [ ] **Step 3: Verify the rest of the handler is untouched**

Confirm the lines after the ones you changed still read exactly:

```js
  try {
    const parts = vaultPath.split("/");
    let newPath;
    if (parts.length === 1) {
      newPath = newName;
    } else {
      newPath = [...parts.slice(0, -1), newName].join("/");
    }
```

No other changes needed in this handler.

- [ ] **Step 4: Commit (GitHub Desktop)**

Stage `server/index.js`. Commit message:
```
security: sanitise vault rename newName to prevent malformed R2 keys
```

---

### Task 5: Validate file_key Prefix on Drawing Sync

The `/api/projects/:id/drawings/sync` endpoint stores whatever `file_key` ArchiSync sends without checking it falls within the expected `projects/{id}/drawings/` prefix.

**Files:**
- Modify: `server/index.js` (inside the `app.post("/api/projects/:id/drawings/sync", ...)` handler, lines ~1184-1190)

- [ ] **Step 1: Find the sync loop**

In `server/index.js`, inside the drawing sync handler, find the `for (const item of incoming)` loop. The first few lines of the loop body read:

```js
  for (const item of incoming) {
    const { title, drawing_number, revision, status, scale, volume, level, drawing_type, file_name, file_size, file_key } = item;
    if (!title || !drawing_number || !file_name || !file_key) {
      results.push({ drawing_number, action: "skipped", error: "Missing required fields" });
      continue;
    }
```

- [ ] **Step 2: Add the file_key prefix check immediately after the existing guard**

Replace those lines with:

```js
  for (const item of incoming) {
    const { title, drawing_number, revision, status, scale, volume, level, drawing_type, file_name, file_size, file_key } = item;
    if (!title || !drawing_number || !file_name || !file_key) {
      results.push({ drawing_number, action: "skipped", error: "Missing required fields" });
      continue;
    }
    const expectedKeyPrefix = `projects/${req.params.id}/drawings/`;
    if (!file_key.startsWith(expectedKeyPrefix)) {
      results.push({ drawing_number, action: "skipped", error: "Invalid file_key — key must be within this project's drawings folder" });
      continue;
    }
```

This ensures ArchiSync can only register file keys that actually belong to the correct project's drawings folder in R2.

- [ ] **Step 3: Commit (GitHub Desktop)**

Stage `server/index.js`. Commit message:
```
security: validate file_key prefix on drawing sync to prevent cross-project key injection
```

---

### Task 6: Rate-Limit Expensive Endpoints

Only `/api/claude` has rate limiting. Several other endpoints are expensive (CPU/memory/API cost) and unprotected.

**Files:**
- Modify: `server/index.js` — add `rateLimit(...)` middleware to 5 routes

- [ ] **Step 1: Add rate limiting to extract-text**

Find:
```js
app.post("/api/extract-text", requireAuth, async (req, res) => {
```
Replace with:
```js
app.post("/api/extract-text", requireAuth, rateLimit(30, 60_000), async (req, res) => {
```
(30 PDF text extractions per minute per user is generous for legitimate use.)

- [ ] **Step 2: Add rate limiting to extract-pages**

Find:
```js
app.post("/api/extract-pages", requireAuth, async (req, res) => {
```
Replace with:
```js
app.post("/api/extract-pages", requireAuth, rateLimit(30, 60_000), async (req, res) => {
```

- [ ] **Step 3: Add rate limiting to reindex-all**

Find:
```js
app.post("/api/projects/:id/drawings/reindex-all", requireAuth, async (req, res) => {
```
Replace with:
```js
app.post("/api/projects/:id/drawings/reindex-all", requireAuth, rateLimit(3, 60_000), async (req, res) => {
```
(Reindexing all drawings in a project calls Gemini for every drawing — 3 per minute is already generous.)

- [ ] **Step 4: Add rate limiting to email reembed**

Find:
```js
app.post("/api/projects/:id/emails/reembed", requireAuth, async (req, res) => {
```
Replace with:
```js
app.post("/api/projects/:id/emails/reembed", requireAuth, rateLimit(3, 60_000), async (req, res) => {
```

- [ ] **Step 5: Add rate limiting to email ingest**

Find:
```js
app.post("/api/projects/:id/emails/ingest", requireAuth, async (req, res) => {
```
Replace with:
```js
app.post("/api/projects/:id/emails/ingest", requireAuth, rateLimit(10, 60_000), async (req, res) => {
```
(ArchiSync sends emails in batches; 10 batch calls per minute is sufficient.)

- [ ] **Step 6: Commit (GitHub Desktop)**

Stage `server/index.js`. Commit message:
```
security: add rate limiting to expensive PDF extraction and AI indexing endpoints
```

---

### Task 7: Sanitise Error Messages

Every `res.status(500)` currently sends `err.message` directly to the client, exposing database internals, R2 paths, and Supabase error details.

**Files:**
- Modify: `server/index.js` — add a helper function near the top, then replace sensitive error leaks

- [ ] **Step 1: Add a serverError helper function**

In `server/index.js`, find the `requireAuth` function (around line 178). Immediately before it, add this helper:

```js
// Send a safe 500 response — logs detail server-side, returns a generic message to the client
function serverError(res, err, context) {
  console.error(`[${context}]`, err.message || err);
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}
```

- [ ] **Step 2: Replace error leaks in admin routes (highest sensitivity)**

These routes expose user management internals. Find and replace the catch blocks in these four admin handlers:

In `GET /api/admin/users`:
```js
  } catch (err) {
    res.status(500).json({ error: err.message });  // ← find this
  }
```
Replace with:
```js
  } catch (err) {
    return serverError(res, err, "GET /api/admin/users");
  }
```

In `POST /api/admin/users`:
```js
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
```
Replace with:
```js
  } catch (err) {
    return serverError(res, err, "POST /api/admin/users");
  }
```

In `PATCH /api/admin/users/:uid`:
```js
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
```
Replace with:
```js
  } catch (err) {
    return serverError(res, err, "PATCH /api/admin/users/:uid");
  }
```

In `DELETE /api/admin/users/:uid`:
```js
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
```
Replace with:
```js
  } catch (err) {
    return serverError(res, err, "DELETE /api/admin/users/:uid");
  }
```

- [ ] **Step 3: Replace error leaks in vault routes (exposes R2 paths)**

In `GET /api/vaults`, `POST /api/vaults`, `PATCH /api/vaults/*`, `DELETE /api/vaults/*`:

For each catch block that reads:
```js
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
```
Replace with the appropriate `serverError(res, err, "ROUTE NAME")` call. Example for the vault list:
```js
  } catch (err) {
    return serverError(res, err, "GET /api/vaults");
  }
```

Apply to all four vault route handlers.

- [ ] **Step 4: Replace error leaks in the Gemini proxy**

The proxy currently sends the raw Gemini API response text directly:
```js
      const err = await response.text();
      console.error("Gemini error:", err);
      return res.status(response.status).json({ error: err });
```
Replace the `return res.status(response.status)...` line with:
```js
      return res.status(502).json({ error: "AI service error — please try again." });
```
The existing `console.error` already logs the detail server-side.

- [ ] **Step 5: Commit (GitHub Desktop)**

Stage `server/index.js`. Commit message:
```
security: sanitise 500 error responses to avoid leaking internals
```

> **Note:** This task only covers the highest-sensitivity routes (admin, vaults, AI proxy). The remaining ~40 catch blocks in project/drawing/email routes use the Supabase client which returns safe, sanitised errors — updating those is lower priority and can be done in a follow-up pass.

---

### Task 8: Remove Email Addresses from Team Members Endpoint

`GET /api/team-members` returns every user's email address to any authenticated user. For a wider rollout with external users or client accounts, this leaks staff emails.

**Files:**
- Modify: `server/index.js` (the `GET /api/team-members` handler, lines ~3092-3101)

- [ ] **Step 1: Find the team members handler**

In `server/index.js`, find:

```js
app.get("/api/team-members", requireAuth, async (req, res) => {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) return res.status(500).json({ error: error.message });
  const members = (data.users || []).map(u => ({
    id: u.id,
    full_name: u.user_metadata?.full_name || u.email,
    email: u.email,
  }));
  res.json(members);
});
```

- [ ] **Step 2: Remove the explicit email field**

Replace the entire handler with:

```js
app.get("/api/team-members", requireAuth, async (req, res) => {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) return res.status(500).json({ error: error.message });
  const members = (data.users || []).map(u => ({
    id: u.id,
    full_name: u.user_metadata?.full_name || u.email,
  }));
  res.json(members);
});
```

The `full_name` field will still fall back to the email address if no full name is set in metadata — this is acceptable for internal practice use where team members know each other's emails. The key change is removing `email` as a separate field, so it's not exposed to non-staff users when they're added.

- [ ] **Step 3: Check that nothing in the frontend depends on `member.email`**

Search `client/src` for any use of `.email` on team member objects to confirm this won't break the UI. Run a search in the client folder for the string `team-members` to find every place the endpoint is consumed, then check whether `email` is used on those objects.

- [ ] **Step 4: Commit (GitHub Desktop)**

Stage `server/index.js`. Commit message:
```
security: remove email field from team-members endpoint response
```

---

### Task 9: Tenant Isolation — Brainstorm & Separate Plan

**This task is a planning gate, not an implementation step.**

Tenant isolation (ensuring Practice A cannot see Practice B's data) requires:
- A database schema migration (adding `practice_id` to multiple tables)
- Updating every project/vault/product query to filter by `practice_id`
- A strategy for existing data (Nathan's current data must be assigned a practice_id)
- A decision on whether vaults in R2 are prefixed by practice (requires migrating R2 keys)

This cannot be done safely in a single session without a dedicated brainstorming and design phase.

- [ ] **Step 1: Start a new session and run the brainstorming skill**

Begin a new Claude Code session. Say: "I want to design tenant isolation for Archimind. Let me explain the current architecture..." and run through the current data model. Use `/brainstorming` to design the approach before writing any code.

- [ ] **Step 2: Key questions to answer in brainstorming**
  - Should isolation be at the `practice_id` level (multiple practices, one DB) or separate Supabase projects per practice?
  - Do vaults in R2 need a practice prefix, or is database-level isolation enough?
  - How do we migrate Nathan's existing data to `practice_id = "nathan-practice"` without downtime?
  - What happens to existing ArchiSync tokens when the schema changes?
  - Do we want Supabase RLS policies as a safety net, or rely on Express middleware?

---

## Deployment Checklist

After all tasks above are committed to `develop` branch and deployed to staging:

- [ ] Visit staging frontend, log in, confirm the app still loads
- [ ] Open browser DevTools → Network tab, make a few API calls, confirm no CORS errors
- [ ] Check browser DevTools → Response Headers on an API call — confirm Helmet headers are present (`X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`)
- [ ] Try uploading a drawing — confirm it still works
- [ ] Try a vault rename — confirm it still works and doesn't produce unexpected vault names
- [ ] Open Railway logs — confirm the Gemini model whitelist is working (no "model not found" errors)
- [ ] Merge `develop` → `main` for production deploy
- [ ] Confirm production frontend loads and API calls work

---

## What This Plan Does NOT Cover

- **Tenant isolation** — separate brainstorm + plan required (see Task 9)
- **Audit log** — low priority, separate plan when needed
- **File type validation** — separate plan, requires magic-bytes library
- **Review round ownership** — best implemented as part of tenant isolation
- **ArchiSync JWT → OS keychain** — separate Electron-side plan, low priority for now
- **100MB body limit scoping** — minor, left for a cleanup pass
