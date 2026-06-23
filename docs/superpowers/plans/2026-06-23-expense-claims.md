# Expense Claims (Item 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace one-at-a-time expenses with multi-item **claims**: staff build up a claim of several lines and submit once; admin approves/rejects the whole claim and receives one PDF containing the total and every receipt.

**Architecture:** A new `expense_claims` table owns status/lifecycle; each `project_expenses` row becomes a **line item** via a new `claim_id`. Claim totals are computed from line items. The PDF is assembled server-side with **pdf-lib** (already a dependency). All data access stays server-only (RLS deny-all).

**Tech Stack:** Supabase (Postgres), Express (Railway), React (Vercel), Cloudflare R2 (receipts), pdf-lib.

**Build in three phases, deploy/verify between each:**
- **Phase A — data model + claims working** (SQL → server → client). Admin email is a text/HTML summary with the total.
- **Phase B — PDF with receipts** (server → client). Adds the assembled PDF to the email + an admin "view PDF" link.

**Working notes:**
- Nathan runs SQL himself (order matters — SQL before the server deploy) and commits/deploys; do not `git commit`.
- Client build check (npm build is broken on this machine): `CI=false node node_modules/react-scripts/bin/react-scripts.js build` from `client/`.
- Server pure logic → `node --test` in `server/lib`. `api()` for all client calls. Routes: specific before `:id`.

---

## Current state (what we're changing)

- **Table** `project_expenses`: `id, user_id, project_id, expense_type, expense_date, amount_pence, miles, description, status('pending'|'approved'|'rejected'), receipt_key, rejection_reason, reviewed_by, reviewed_at, created_at, updated_at`.
- **Staff UI** `client/src/components/ExpensesTab.jsx` — add one expense at a time; each is immediately `pending`.
- **Admin UI** `AdminExpensesPanel` in `client/src/components/TimesheetsSection.jsx` (~line 372) — `GET /api/admin/expenses?status=`, approve/reject per expense.
- **Server** `server/index.js`: `/api/expenses` GET/POST/PUT/DELETE (~4609-4725), `/api/expenses/:id/receipt` POST/GET (~4746-4783), `/api/admin/expenses` GET + `/:id/approve` + `/:id/reject` (~4890-4925), `notifyExpenseDecision` (~367), `expense_submitted` notification recipients.
- **Receipts:** stored in R2 at `expenses/<user>/<expenseId>/<filename>` with a sniffed `ContentType` (PDF/JPG/PNG/WEBP/HEIC). `receipt_key` on the row.

---

# PHASE A — Data model + claims working

## Task A1: Database migration (Nathan runs in Supabase SQL editor)

**Run this whole block first, before deploying the Phase A server.** It is destructive to the existing *test* expense rows only (confirmed all test data).

```sql
-- 1. Claims table
create table if not exists public.expense_claims (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  status          text not null default 'draft',   -- draft | submitted | approved | rejected
  submitted_at    timestamptz,
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  rejection_reason text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 2. Lock it down: RLS on, NO policy = deny-all to the browser key (server uses service key).
alter table public.expense_claims enable row level security;

-- 3. Link line items to a claim
alter table public.project_expenses
  add column if not exists claim_id uuid references public.expense_claims(id) on delete cascade;

-- 4. Clear existing TEST expense rows (start clean; receipts in R2 become orphaned, harmless)
delete from public.project_expenses;
```

- [ ] Verify in Supabase: `expense_claims` exists, RLS shows "enabled, no policies", `project_expenses.claim_id` exists, `project_expenses` is empty.

## Task A2: Claim totals helper (pure, tested)

**Files:** Create `server/lib/expenseClaims.js` + `server/lib/expenseClaims.test.js`

- [ ] **Test first:**
```js
const { test } = require("node:test");
const assert = require("node:assert");
const { claimTotalPence, claimSummary } = require("./expenseClaims");

test("sums line item amounts", () => {
  assert.strictEqual(claimTotalPence([{ amount_pence: 4230 }, { amount_pence: 650 }]), 4880);
});
test("empty claim totals zero", () => {
  assert.strictEqual(claimTotalPence([]), 0);
});
test("summary returns count + total", () => {
  assert.deepStrictEqual(claimSummary([{ amount_pence: 100 }, { amount_pence: 200 }]),
    { count: 2, total_pence: 300 });
});
```
- [ ] **Implement:**
```js
function claimTotalPence(items) {
  return (items || []).reduce((s, e) => s + (e.amount_pence || 0), 0);
}
function claimSummary(items) {
  return { count: (items || []).length, total_pence: claimTotalPence(items) };
}
module.exports = { claimTotalPence, claimSummary };
```
- [ ] Run `node --test server/lib/expenseClaims.test.js` → PASS.

## Task A3: Staff claim endpoints (server)

**Files:** Modify `server/index.js` (add near the `/api/expenses` routes; specific paths before `:id`).

Add `const { claimTotalPence } = require("./lib/expenseClaims");` with the other lib requires.

- [ ] **Get-or-create the user's open draft, with line items:**
```js
// GET /api/expense-claims — all of this user's claims (newest first) with line items
app.get("/api/expense-claims", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("expense_claims")
    .select("*, project_expenses(*, projects(id, name, job_number))")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });
  if (error) return serverError(res, error, "GET /api/expense-claims");
  res.json((data || []).map(c => ({ ...c, total_pence: claimTotalPence(c.project_expenses) })));
});

// POST /api/expense-claims — return the user's open draft, creating one if needed
app.post("/api/expense-claims", requireAuth, async (req, res) => {
  const { data: existing } = await supabase.from("expense_claims")
    .select("id").eq("user_id", req.user.id).eq("status", "draft").maybeSingle();
  if (existing) return res.json(existing);
  const { data, error } = await supabase.from("expense_claims")
    .insert({ user_id: req.user.id, status: "draft" }).select().single();
  if (error) return serverError(res, error, "POST /api/expense-claims");
  res.json(data);
});
```

- [ ] **Submit a claim** (validates ≥1 line; Phase A email is a summary — PDF added in Phase B):
```js
// POST /api/expense-claims/:id/submit
app.post("/api/expense-claims/:id/submit", requireAuth, async (req, res) => {
  const { data: claim } = await supabase.from("expense_claims")
    .select("*, project_expenses(*, projects(id, name, job_number))")
    .eq("id", req.params.id).single();
  if (!claim) return res.status(404).json({ error: "Not found" });
  if (claim.user_id !== req.user.id) return res.status(403).json({ error: "Not authorised" });
  if (!["draft", "rejected"].includes(claim.status)) return res.status(403).json({ error: "Claim already submitted" });
  const items = claim.project_expenses || [];
  if (items.length === 0) return res.status(400).json({ error: "Add at least one expense before submitting" });

  const { data, error } = await supabase.from("expense_claims")
    .update({ status: "submitted", submitted_at: new Date().toISOString(), rejection_reason: null, updated_at: new Date().toISOString() })
    .eq("id", req.params.id).select().single();
  if (error) return serverError(res, error, "submit claim");

  // Notify admins (Phase A: summary only; Phase B attaches the PDF)
  const recipients = await notificationRecipients("expense_submitted");
  if (recipients.length) {
    const total = `£${(claimTotalPence(items) / 100).toFixed(2)}`;
    const rows = items.map(i => `<tr><td style="padding:4px 8px;">${escapeHtml(i.projects?.job_number ? i.projects.job_number + " — " + i.projects.name : i.projects?.name || "—")}</td><td style="padding:4px 8px;">${escapeHtml(i.description || "")}</td><td style="padding:4px 8px;text-align:right;">£${((i.amount_pence||0)/100).toFixed(2)}</td></tr>`).join("");
    await sendEmail({
      to: recipients,
      subject: `Expense claim — ${req.user.email.split("@")[0]} · ${items.length} item(s) · ${total}`,
      html: notificationEmailHtml("Expenses", `<p style="margin:0 0 12px;font-size:15px;color:#262830;"><strong>${escapeHtml(req.user.email)}</strong> submitted an expense claim of <strong>${total}</strong> (${items.length} item(s)).</p><table style="width:100%;border-collapse:collapse;font-size:13px;">${rows}</table>`),
      text: `${req.user.email} submitted an expense claim of ${total} (${items.length} items).`,
    });
  }
  res.json(data);
});
```

## Task A4: Line items belong to the draft claim (server)

**Files:** Modify `server/index.js` `POST /api/expenses` (~4621) and guard PUT/DELETE.

- [ ] In `POST /api/expenses`, accept `claim_id` in the body and store it on the inserted row. Validate the claim belongs to `req.user.id` and is `draft`/`rejected`. (Client always sends the draft claim id from Task A6.)
- [ ] In `PUT`/`DELETE /api/expenses/:id`, replace the per-expense `status === "pending"` checks with: allow edit/delete only when the parent claim's status is `draft` or `rejected` (join via `claim_id`). Keep the owner check.
- [ ] Receipt POST (`/api/expenses/:id/receipt`, ~4746): replace its `existing.status !== "pending"` guard with the same parent-claim `draft`/`rejected` check.

## Task A5: Admin claim endpoints (server)

**Files:** Modify `server/index.js` (admin section, `requireAdmin`).

- [ ] `GET /api/admin/expense-claims?status=` → claims joined with line items + projects, each with `total_pence` (via `claimTotalPence`) and the submitter email (look up via `supabase.auth.admin.getUserById` or the existing users list helper). Default to `status=submitted`.
- [ ] `POST /api/admin/expense-claims/:id/approve` → set claim `status='approved', reviewed_by, reviewed_at`; call existing `notifyExpenseDecision`-style send (reuse/extend for claims).
- [ ] `POST /api/admin/expense-claims/:id/reject` → require `reason`; set `status='rejected', rejection_reason, reviewed_by, reviewed_at`; notify.
- [ ] Leave the old `/api/admin/expenses*` endpoints in place until the client no longer calls them (remove in a cleanup step at end of Phase A).

## Task A6: Staff UI — build & submit a claim

**Files:** Rework `client/src/components/ExpensesTab.jsx`.

- [ ] On mount: `POST /api/expense-claims` to get the open draft id, and `GET /api/expense-claims` for the full list. Split into the **draft** claim (editable) and **history** (submitted/approved/rejected).
- [ ] **Draft section:** a table of line items (the existing add-expense form becomes "+ Add line", each line still has type/project/date/amount/description/optional receipt, posted with `claim_id`). Show a **running total** and a **"Submit claim"** button → `POST /api/expense-claims/:id/submit`. Disable submit when zero lines.
- [ ] **History section:** read-only cards per claim — status badge, total, item count, submitted date; rejected claims show the reason and a **"Reopen & resubmit"** affordance (a rejected claim is editable again; submitting returns it to the draft-style flow). Keep the existing `ProjectPicker` (with `hideOther`) and receipt upload.
- [ ] Verify build.

## Task A7: Admin UI — review by claim

**Files:** Rework `AdminExpensesPanel` in `client/src/components/TimesheetsSection.jsx` (~372).

- [ ] Fetch `GET /api/admin/expense-claims?status=` instead of per-expense. Render **one row per claim**: submitter · item count · **total** · submitted date · expand-to-see-lines · **Approve** / **Reject** (whole claim, reason on reject) → the new claim approve/reject endpoints.
- [ ] Keep the mileage-rate settings block as-is.
- [ ] Verify build.

## Task A8: Cleanup + handoff (Phase A)

- [ ] Remove the now-unused `/api/admin/expenses` approve/reject/GET endpoints and any dead per-expense client code (grep to confirm zero callers first).
- [ ] **Deploy order:** Nathan runs the **SQL (A1) first**, then deploys **server → Railway**, then **client → Vercel**. Verify on staging: build a 3-line claim, submit, admin sees one row with the correct total, approve/reject works, admin gets the summary email.

---

# PHASE B — PDF with receipts

## Task B1: PDF builder (server)

**Files:** Create `server/lib/expenseClaimPdf.js`.

- [ ] Export `async function buildClaimPdf({ claim, items, submitterEmail, fetchReceipt })` returning `{ pdfBytes, unembeddable: [{ key, filename, bytes, contentType }] }`.
  - Use **pdf-lib** `PDFDocument.create()`. Page 1 = summary: "Expense Claim", submitter, submitted date, claim id, then a table of line items (project, date, type, description, miles, amount) and the **Total**.
  - For each line with a `receipt_key`, call `fetchReceipt(key)` → `{ bytes, contentType }`:
    - `application/pdf` → `PDFDocument.load(bytes)`, `copyPages` all pages, add each.
    - `image/jpeg` → `embedJpg`; `image/png` → `embedPng`; place on a new page scaled to fit.
    - `image/webp` / `image/heic` (pdf-lib can't embed) → push to `unembeddable` and add a summary line "Receipt attached separately: <filename>".
- [ ] Pure-ish unit test with tiny in-memory PNG/JPG + a stub `fetchReceipt`, asserting `pdfBytes` starts with `%PDF` and `unembeddable` collects HEIC.

## Task B2: Wire PDF into submit + admin (server)

**Files:** Modify `server/index.js`.

- [ ] Add a shared `fetchReceipt(key)` helper that GETs the R2 object → `{ bytes, contentType }` (mirrors the existing receipt GET).
- [ ] In `POST /api/expense-claims/:id/submit`, build the PDF and pass it to `sendEmail` via `attachments: [{ filename: 'expense-claim.pdf', content: Buffer }, ...unembeddable receipts]`.
- [ ] Add `GET /api/admin/expense-claims/:id/pdf` (`requireAdmin`) → streams the freshly-built PDF (`Content-Type: application/pdf`).

## Task B3: Admin "view PDF" + handoff (Phase B)

**Files:** `AdminExpensesPanel` (TimesheetsSection.jsx).

- [ ] Add a **📄 PDF** button per claim row → opens `GET /api/admin/expense-claims/:id/pdf` (via `apiBlob`, same pattern as receipt view).
- [ ] Verify build. **Deploy:** server → Railway, then client → Vercel. Test: submit a claim with a JPG receipt + a PDF receipt + (if possible) a HEIC → admin email has the assembled PDF; HEIC arrives as a separate attachment; admin "PDF" button opens the same document.

---

## Out of scope
- Per-line approval (whole-claim only).
- Embedding HEIC/WEBP in the PDF (attached separately instead).
- Migrating old expense data (all test data, cleared in A1).
- Paid/unpaid or allowance logic.

## Invariants
- `expense_claims` stays server-only (RLS deny-all) — never add a permissive policy.
- Claim totals are always computed from line items, never stored.
- All client calls via `api()`/`apiBlob()`; colours from `constants.js`.
