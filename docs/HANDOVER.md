# Archimind / Vaultmind — Session Handover Notes

> Read at the start of every session for technical context on tricky areas.

---

## Code quality pass (2026-06-03, complete)

XSS fix in PDF viewer, 82 error-leak routes standardised, duplicate CORS removed, Resend singleton, vault useMemo/useCallback, AI timeout named constants. See git log for details.

---

## Parked refactoring items

- **B3** Rate limiter (`server/index.js` ~line 64) — plain `Map`, resets on Railway restart. Fix: `express-rate-limit` or Redis.
- **B6** No PDF magic byte check on upload — add `if (buffer.slice(0,4).toString() !== "%PDF")` check after base64 decode.
- **C1** `callClaude` misnamed (calls Gemini) — ~30 call sites. Rename in a dedicated session, not mid-feature.
- **C4** `api()`/`apiBlob()` duplicate auth logic — extract shared `authorisedFetch()` base.
- **D1** App.js god component (1,800+ lines) — split into `AuthContext`, `VaultContext`, `useQA`, `useVaultPdfs`.
- **D2** ProjectsSection.jsx (3,700+ lines) — split into one file per tab.
- **D3** server/index.js (5,300+ lines) — split into `routes/`, `middleware/`, `helpers/`.
- **D4** Vaults not DB-backed — R2 ListObjects on every load. Future: add `vaults` Supabase table.

---

## Tricky technical areas

### mupdf — must not be removed
- `/api/extract-text` — mupdf structured text powers QA Pass 1. pdf-lib has no text extraction.
- `/api/extract-pages` — runs mupdf in `server/workers/extractPages.worker.js`. WASM abort kills only the worker; main process falls back to pdf-lib. Do not move out of the worker.

### answerPrompt — cannot be edited with Edit tool
Single very long line in `App.js`. Use a Python replacement script:
```python
with open("client/src/App.js", "r", encoding="utf-8") as f:
    content = f.read()
content = content.replace('OLD_ANCHOR', 'NEW_ANCHOR')
with open("client/src/App.js", "w", encoding="utf-8") as f:
    f.write(content)
```
Write the script to a `.py` file and run it — do not use `python -c` with double-quoted Bash strings (backslash escaping breaks).

### App.js vault section JSX
`{appSection === "vault" && <div>...`. Closing `}` must be on same line as `</div>`: `</div>}{/* comment */}`. Newline between them causes render bug.

### AnswerRenderer prop name
Use `text=` not `answer=`.

### Supabase RLS policy pattern
Always: `USING (true) WITH CHECK (true)`. Never: `WITH CHECK (auth.role() = 'authenticated')`.

### Route ordering in server/index.js
Specific routes before wildcard `:id` routes. E.g. `/api/expenses/settings` before `/api/expenses/:id`.

### react-pdf v10 gotchas (PDFAnnotator.jsx)
- Worker must use `.mjs` extension
- `onRenderSuccess` has no `{ height }` — read from DOM: `pageWrapperRef.current.querySelector("canvas").offsetHeight`
- PDFs served as base64 through API (not presigned R2 URLs — CORS blocks direct R2 access)

### Resend lazy singleton
`getResend()` returns `null` if `RESEND_API_KEY` not set — `sendEmail()` skips silently. Both `RESEND_API_KEY` and `RESEND_FROM` are set on Railway (2026-06-12): production sends from `Archimind <noreply@archimind.co.uk>`, staging from `admin@archimind.co.uk`. Domain is verified in Resend — any `@archimind.co.uk` address works as the from. **Send-only**: no inbound mail is set up, replies bounce (Cloudflare email forwarding is the future option if needed).

### Custom domain + CORS (2026-06-12)
`archimind.co.uk` bought on Cloudflare (DNS lives there); bare domain 308-redirects to `www.archimind.co.uk`; Vercel production = `main` branch. Old `.vercel.app` URLs still work. **Any new frontend origin (e.g. a staging-branch preview URL) must be added to `corsOptions.origin` in `server/index.js`** — symptom of a missing origin: page loads and login works, but vaults/data silently fail to load. Cloudflare DNS records for Vercel must stay "DNS only" (grey cloud). Share links use `window.location.origin` so they follow whatever domain the user is on. Outstanding: Supabase Auth → URL Configuration may still point at the old vercel.app address (affects password-reset/confirmation email links only).

### Q&A pipeline robustness (2026-06-11, working — do not regress)
- **Pass 1 JSON parsing**: Gemini wraps long heading strings onto a second line (raw newline inside a JSON string literal = illegal). `sanitizeJsonControlChars` cleans inside-string control chars before parse; `salvageScoring` recovers truncated JSON by closing brackets. Both inside `askQuestion()`. Failure-only `[Scoring]` console.warn diagnostics — keep them.
- **General provisions** (chapter-matching, 2026-06-12): found server-side by the extract-pages worker (`scanGeneral: true` in the request body). It scans live document text for "General …" headings using font info (mupdf `toStructuredText().asJSON()` — a line counts only if **bold or ≥1.2× body text size**), and keeps hits in the **same chapter as a requested page**. Chapter detection: a page's chapter = the most common clause-number prefix printed on it ("3.36" → 3, "B1.2" → B1); pages with no clause numbers inherit — requested pages look back, heading pages look forward. Safety net: a requested page whose chapter yields no General section falls back to the nearest **preceding** General heading. Caps unchanged: +12 pages/doc, 15MB client byte budget. Returns `generalSections[{page,title}]`; client appends titles to PRIORITY SECTIONS in Pass 3 — without that, Gemini ignores the extra pages. **Do not reintroduce a page-distance cap** — the old ≤10-page rule failed both ways (ADM v1's M4(3) chapter spans 38 pages, so its General provisions sat 19 pages from the requested content and was dropped, while neighbouring chapters' sections leaked in). **Do not source general provisions from the vault index** — indexes built before the title@page dedupe fix collapsed duplicate heading titles; a collapsed index also stops Pass 1 requesting the right chapter's pages at all, which the worker scan cannot rescue — fix is re-indexing (Part M vault done 2026-06-12; others may still be stale).
- **Gemini hard limit**: ~20MB request. `400 INVALID_ARGUMENT` = payload too big; oversized payloads can also crash the Railway container (502, no CORS headers) or hang to timeout. `/api/claude` error log includes payload MB; client logs `[Pass3] Sending ~X MB` before the call. Pass 2 enforces a **15MB byte budget**: if extracted docs total more, every doc's page list is scaled down proportionally, dropping lowest-priority pages (Set insertion order = priority); general provisions pages survive because the server scan re-adds them on re-extraction.
- **Citation click → page resolution** (3 tiers in `handleCitationClick`): (1) `findPageByClauseNumber` — text-search the PDF for a line-anchored clause number (3.36, B1); paragraph numbers are unique per document so this beats heading matching (AD Part M has identical "General provisions" headings in M4(2) and M4(3)); doc text cached in `docTextCacheRef`. (2) `findPageInVaultIndex` — 4-level heading match, type-aware: Diagram/Table/Figure citations only match same-type index headings. (3) `citationPageMap` fallback.

### Roles & access (2026-06-12)
Three roles, stored in Supabase **`app_metadata.role`** (`user` | `admin` | `hr`) — **never `user_metadata`** (that's user-editable → privilege-escalation; migrated 2026-06-12). Server reads `req.user.app_metadata.role`; client reads `session.user.app_metadata.role`. Role is set only by admins via `/api/admin/users` (writes `app_metadata`). After a role change the user must **log out/in** to refresh the token.
- `requireAdmin` — admin only (expenses, fees, notification settings, mileage, quiz, user management, logo/colours).
- `requireTimesheetManager` — admin **or** hr. Applied ONLY to timesheet-review endpoints: `GET /api/admin/timesheets/submissions`, `GET/PATCH /api/admin/timesheets`, approve/reject/unlock, and `GET /api/admin/users` (read, for names). HR is hard-walled from everything else server-side; the client also hides Fee Review, the expenses tab and notification settings for HR (`isAdmin` vs `isHr`/`canReview` in `TimesheetsSection`).

### RLS — every table is server-only (2026-06-12)
All client data access goes through the server (service key, bypasses RLS); the browser uses Supabase **only for auth** (zero `supabase.from()` calls). So every public table has RLS **enabled with no permissive policy** = deny-all to the anon/authenticated browser key. The wide-open `USING(true)`/`"Auth access"` policies and RLS-off tables (incl. `projects`, `project_emails`, `staff_rates`) were locked down via SQL. **Do not add a permissive `USING(true)` policy** — if a feature ever needs direct browser table access, write a per-user policy (`auth.uid() = user_id`, like `quiz_stats`) instead.

### Timesheets — dates, overtime, notifications (2026-06-12)
- **BST date bug (fixed):** `isoDate()` must build `YYYY-MM-DD` from **local** date parts, never `toISOString()` (UTC shifts Mon→Sun in British Summer Time → server rejects as weekend / entries land a day early). Fixed in all 5 timesheet/expense client files. Don't reintroduce `toISOString().split("T")[0]` for entry dates.
- **Overtime:** `timesheets.overtime_hours` / `overtime_minutes` columns. **Tracked separately** — never added into the weekly total or the 37.5/45 warnings. Job (project) entries only; cleared when an entry becomes a category. Shown per-entry, as a weekly figure, in admin review, and in the report.
- **Notification settings:** 5 office-wide on/off toggles stored as JSON in `app_settings` (key `notification_settings`), missing keys default ON. `isNotificationEnabled(key)` gates each send. Events: timesheet_submitted/expense_submitted/unlock_requested → admins; expense_decided/timesheet_rejected → submitter (`getUserEmail`). Admin-only panel in `AdminPanel`.
- **Email hardening:** `escapeHtml()` wraps all user text in notification email HTML; expense POST + unlock-request are rate-limited. Receipt uploads: 10 MB cap, magic-byte type check (PDF/JPG/PNG/WEBP/HEIC), served as `attachment`.

---

## Outstanding issues (as of 2026-06-12)

1. **Re-index stale vaults** (operational, no code) — any vault indexed before the title@page dedupe fix has collapsed duplicate headings and can steer Pass 1 to the wrong chapter. Part M re-indexed 2026-06-12; Part B and other Approved Document vaults are prime suspects. Chapter-matching general provisions verified 2026-06-12 (live M4(2)/M4(3) tests + worker tests against Part M v1/v2 and Part B v2).
2. **Clause-number citation can hit a cross-reference** (LOW, accepted 2026-06-11) — `findPageByClauseNumber` opens the first page where a line starts with the clause number; occasionally that's a cross-reference/table entry on an earlier page rather than the clause itself. Possible future fix: prefer the match where the clause number is followed by sentence text, or pick the page nearest the section's vault-index heading.
3. **Multi-clause blocks not combining** (LOW) — same-subject clauses across sections still separate citation blocks
3. **Wide table extraction** (KNOWN LIMITATION) — mupdf linearises text, loses column structure
4. **Email work** (PARKED) — summaries not stored in DB; relevance threshold (0.35) needs tuning
5. **PDF Compare** (NEEDS TESTING) — image-based rewrite on Railway; needs first Revit schedule test
6. **Timesheets/Expenses** ✅ live on `main` 2026-06-12 — email delivery verified end-to-end. Date bug, overtime, notifications, HR role, email/receipt hardening all shipped (see sections above).
7. ~~Custom domain~~ ✅ DONE 2026-06-12 — see "Custom domain + CORS" section above. Remaining: check Supabase Auth Site URL.
8. **Timesheets/Expenses follow-ups** (deferred, none blocking): admin-configurable email *recipients* (currently all-admins); the unlock-*granted* email isn't sent (only the 5 chosen events). Specs in `docs/superpowers/specs/2026-06-12-*`.
9. **Repo tidy** — `client/build/` is tracked and committed with each change; harmless (Vercel rebuilds from source) but worth adding to `.gitignore`.
