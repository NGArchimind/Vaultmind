# Staff Leavers ("Mark as left") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin give a member of staff a leaving date (past or future). Up to and including that day they work normally; their final week only needs the days up to the leaving date filled (later days show "n/a – left"). The morning after, their account closes: login blocked, final week auto-submitted if they hadn't, reminders/tallies stop, hidden from "assign to" pickers. Every historic record keeps their name, and they can be reinstated.

**Architecture:** Leaver state lives on the Supabase auth user's `app_metadata` (server-only, same place as `role`): `left_at` (`"YYYY-MM-DD"`, the last working day) and `leaver_closed_at` (ISO timestamp, set once the account has been closed). Closing = Supabase ban (`ban_duration`) + auto-submit of the leaving week. Closing runs immediately when a past date is entered, otherwise from a new 15-min `leaverTick` beside the existing reminder/HR ticks. No new table, **no SQL**. The account is never deleted, so every `user_id` → name lookup keeps working.

**Tech Stack:** Express + `@supabase/supabase-js` admin API (server, Railway), React CRA (client, Vercel), `node --test`.

**Spec:** Design agreed in chat with Nathan on 2026-11-09 (no separate spec doc):
- Mark as left with a leaving date; date may be in the future (notice period).
- Status: **active** (no `left_at`), **leaving** (`left_at` ≥ today UK), **left** (`left_at` < today UK).
- Leaving week minimum = 7.5h × weekdays (Mon–Fri) up to and including `left_at`; weekdays after it show "n/a – left" and are locked. No hours are written for n/a days.
- On closing: login blocked; if the leaving week isn't submitted/approved it is submitted automatically with whatever was entered and lands in Admin Review; admin/HR notified. Earlier unsubmitted weeks are left as "Not submitted".
- Reminders, "X of Y submitted" tallies and HR report count the leaver up to and including the leaving week, never after. Reminder emails continue while **leaving**, stop once **left**.
- **Left** staff hidden from "assign to" pickers (still named on old records); **leaving** staff still assignable.
- Admin → Users: **leaving** staff stay in the main list with a "Leaving d MMM yyyy" tag + "Cancel leaving"; **left** staff move to a "Former staff" section with "Reinstate".
- History (reports, Fee Review, exports, Q&A log) unchanged.

## Global Constraints

- No SQL, no new tables.
- Ban to close: `ban_duration: "876000h"`. Unban: `ban_duration: "none"`.
- "Today" is always the UK date: server `ukParts(new Date()).dateStr` (`lib/timesheetReminder.js`); client: `new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" })`.
- `left_at` must be a real `YYYY-MM-DD` date, not before the account's creation date. Future dates allowed.
- An admin cannot mark their own account as leaving/left.
- Leaver endpoints are `requireAuth, requireAdmin` (HR stays walled off from user management).
- Never delete the account as part of this feature; existing Delete button stays (stronger warning).
- Q&A pipeline (`App.js` `askQuestion`, `/api/claude`, prompts) is **not touched**.
- Client colours from `constants.js`; client→server calls via `api()` only.
- Nathan commits himself via GitHub Desktop — implementers do **not** commit. "Checkpoint" = stop and tell Nathan what changed.
- Work on `develop`; staging-test before develop→main. Deploy: server (Railway) + client (Vercel), no SQL.
- Client build on this machine: `CI=false node node_modules/react-scripts/bin/react-scripts.js build` in `client/`.

## Review Focus

1. **Open sessions after leaving:** a closed leaver may still hold a valid access token for ~1h → `requireAuth` rejects any user whose status is **left**, regardless of ban (Task 2).
2. **Closing runs twice / never:** a past date entered in Admin closes immediately; a future date closes on the first tick after midnight UK; a server restart mid-way must not double-submit or double-email — `leaver_closed_at` makes it idempotent (Task 1 `needsClosing` tests; Task 2 helper sets it last).
3. **Role change wiping leaver fields:** `PATCH /api/admin/users/:uid` sends `app_metadata: { role }`. Supabase merges top-level `app_metadata` keys so `left_at`/`leaver_closed_at` should survive — verify on staging (Task 5); client also hides the role dropdown for **left** staff.
4. **Leaving day on a weekend or bank holiday:** a Saturday/Sunday `left_at` means the full week (5 weekdays, 37.5h) is required; bank holidays still need a Bank Holiday line as now (Task 1 tests).
5. **Old tasks assigned to a leaver:** the edit form must still show their name selected (Task 3: filter keeps the currently-selected id).

---

### Task 1: Pure logic — leaver rules

**Files:**
- Create: `server/lib/leavers.js`, `server/lib/leavers.test.js`
- Modify: `server/lib/timesheetReminder.js` (`buildWeekStatus`; add + export `isExpectedInWeek`), `server/lib/timesheetReminder.test.js`

**Interfaces:**
- Produces (`lib/leavers.js`, requires `mondayOf` from `./timesheetReminder`; `DAY_CAP_MINS`, `MIN_WEEK_MINS` from `./timesheetValidation`):
  - `leaverStatus(appMetadata: object|undefined, todayISO: string) -> "active"|"leaving"|"left"`
  - `validateLeftAt(leftAt: any, { createdISO: string }) -> string|null` — error message or `null`. Exact messages: `"Leaving date must be YYYY-MM-DD"`, `"Leaving date cannot be before the account was created"`.
  - `requiredWeekMins(weekStart: string, leftAt: string|null|undefined) -> number` — `MIN_WEEK_MINS` if no `leftAt` or `leftAt` ≥ that week's Friday; `0` if `leftAt` < `weekStart`; otherwise `DAY_CAP_MINS` × weekdays from `weekStart` to `leftAt` inclusive.
  - `needsClosing(appMetadata, todayISO) -> boolean` — status **left** and no `leaver_closed_at`.
  - `leavingWeek(leftAt: string) -> string` — `mondayOf(leftAt)`.
- Produces (`lib/timesheetReminder.js`):
  - `isExpectedInWeek({ startMonday, leftAt }, week) -> boolean` — `startMonday <= week && (!leftAt || week <= mondayOf(leftAt))`.
  - `buildWeekStatus` users may carry `leftAt`; `expectedStaff` uses `isExpectedInWeek`.

- [ ] **Step 1: Write failing tests** (`node:test` + `node:assert`, style of `timesheetReminder.test.js`):

```js
// leavers.test.js
test("leaverStatus", () => {
  assert.equal(leaverStatus({ role: "user" }, "2026-11-09"), "active");
  assert.equal(leaverStatus({ left_at: "2026-11-09" }, "2026-11-09"), "leaving"); // last day: still working
  assert.equal(leaverStatus({ left_at: "2026-11-20" }, "2026-11-09"), "leaving");
  assert.equal(leaverStatus({ left_at: "2026-11-07" }, "2026-11-09"), "left");
  assert.equal(leaverStatus(undefined, "2026-11-09"), "active");
  assert.equal(leaverStatus({ left_at: "" }, "2026-11-09"), "active");
});
test("validateLeftAt", () => {
  const ctx = { createdISO: "2026-06-01" };
  assert.equal(validateLeftAt("2026-11-07", ctx), null);
  assert.equal(validateLeftAt("2027-01-15", ctx), null); // future allowed
  assert.equal(validateLeftAt("07/11/2026", ctx), "Leaving date must be YYYY-MM-DD");
  assert.equal(validateLeftAt("2026-02-30", ctx), "Leaving date must be YYYY-MM-DD");
  assert.equal(validateLeftAt(undefined, ctx), "Leaving date must be YYYY-MM-DD");
  assert.equal(validateLeftAt("2026-05-31", ctx), "Leaving date cannot be before the account was created");
});
test("requiredWeekMins", () => {
  const wk = "2026-11-02"; // Mon
  assert.equal(requiredWeekMins(wk, null), 2250);
  assert.equal(requiredWeekMins(wk, "2026-11-06"), 2250);  // left Fri
  assert.equal(requiredWeekMins(wk, "2026-11-08"), 2250);  // left Sun
  assert.equal(requiredWeekMins(wk, "2026-11-04"), 1350);  // left Wed: 3 × 450
  assert.equal(requiredWeekMins(wk, "2026-11-02"), 450);   // left Mon
  assert.equal(requiredWeekMins(wk, "2026-10-30"), 0);     // left before this week
  assert.equal(requiredWeekMins(wk, "2026-12-01"), 2250);  // leaves later
});
test("needsClosing", () => {
  assert.equal(needsClosing({ left_at: "2026-11-07" }, "2026-11-09"), true);
  assert.equal(needsClosing({ left_at: "2026-11-07", leaver_closed_at: "2026-11-08T00:05:00Z" }, "2026-11-09"), false);
  assert.equal(needsClosing({ left_at: "2026-11-09" }, "2026-11-09"), false); // still their last day
  assert.equal(needsClosing({ role: "user" }, "2026-11-09"), false);
});
test("leavingWeek", () => { assert.equal(leavingWeek("2026-11-06"), "2026-11-02"); });
```

Append to `timesheetReminder.test.js`:

```js
test("isExpectedInWeek: expected up to and including the leaving week", () => {
  const u = { startMonday: "2026-06-01", leftAt: "2026-11-05" };
  assert.equal(R.isExpectedInWeek(u, "2026-11-02"), true);
  assert.equal(R.isExpectedInWeek(u, "2026-11-09"), false);
  assert.equal(R.isExpectedInWeek({ startMonday: "2026-06-01", leftAt: null }, "2026-11-09"), true);
  assert.equal(R.isExpectedInWeek({ startMonday: "2026-11-16", leftAt: null }, "2026-11-09"), false);
});
test("buildWeekStatus: a leaver is not expected after their leaving week", () => {
  const users = [
    { id: "u1", name: "Sarah", role: "user", createdAt: "2026-06-01" },
    { id: "u2", name: "Tom",   role: "user", createdAt: "2026-06-01", leftAt: "2026-07-03" },
  ];
  const out = buildWeekStatus({ users, subsByUser: {}, trackFromMonday: "2026-06-29", currentWeekMonday: "2026-07-06" });
  assert.deepEqual(out[0], { week: "2026-07-06", expected: 1, outstanding: [{ id: "u1", name: "Sarah", label: "Not started" }] });
  assert.equal(out[1].expected, 2);
});
```

- [ ] **Step 2: Run, confirm failure** — in `server/`: `node --test lib/leavers.test.js lib/timesheetReminder.test.js` → FAIL (`Cannot find module './leavers'`, `isExpectedInWeek is not a function`).

- [ ] **Step 3: Implement.** Real-date check: `new Date(s + "T12:00:00Z")` round-trips to `s`. All date comparisons are ISO string comparisons. Weekday count: step from `weekStart` by day, count Mon–Fri ≤ `leftAt`.

- [ ] **Step 4: Run full suite** — `node --test lib/` → all PASS, 0 fail.

- [ ] **Step 5: Checkpoint.**

---

### Task 2: Server — closing, endpoints, login block, submit minimum, reminders/tallies/HR/team list

**Files:**
- Create: `server/helpers/leavers.js` (I/O wrapper: closing an account)
- Modify: `server/middleware/auth.js`, `server/routes/admin.js`, `server/routes/timesheets.js` (submit ~L234-239; outstanding ~L367-372), `server/helpers/schedulers.js` (reminders ~L64-66; HR expected ~L176-178; new `leaverTick`; export it), `server/index.js` (~L8, L162-163), `server/routes/taskBoard.js:137-140`

**Interfaces:**
- Consumes: Task 1 functions; `ukParts`, `mondayOf`; `notificationRecipients`, `sendEmail`, `notificationEmailHtml`, `escapeHtml` (whatever `routes/timesheets.js` already imports for the submit notification — import from the same modules); `formatWeekRange` from `helpers/schedulers.js`.
- Produces:
  - `closeLeaverAccount(user: SupabaseUser) -> Promise<{ autoSubmittedWeek: string|null }>` in `helpers/leavers.js`. Order: (1) if leaving week's `timesheet_submissions` status isn't `submitted`/`approved` → upsert `{ user_id, week_start: leavingWeek(left_at), status: "submitted", submitted_at: now, rejection_reason: null }` (`onConflict: "user_id,week_start"`) and email `notificationRecipients("timesheet_submitted")`: subject `Final timesheet auto-submitted — <email>`, body `"<email>'s account closed after their leaving date (<d MMM yyyy>). Their final timesheet for <week range> was not submitted, so it has been submitted automatically with whatever was entered. Please review it."`; (2) `updateUserById(id, { ban_duration: "876000h", app_metadata: { leaver_closed_at: new Date().toISOString() } })` — last, so a crash before it means the next tick retries; step 1's upsert is safe to repeat (re-check status first so the email isn't re-sent once submitted).
  - `leaverTick()` in `helpers/schedulers.js`: list users, call `closeLeaverAccount` for each where `needsClosing(u.app_metadata, today)`; try/catch + `console.log("[Leavers] closed <email>")` in the style of `reminderTick`. Registered in `index.js`: `setInterval(leaverTick, 15 * 60 * 1000)`.
  - HTTP:
    - `GET /api/admin/users` → each user gains `left_at: string|null`, `leaver_status: "active"|"leaving"|"left"`.
    - `POST /api/admin/users/:uid/leave` body `{ left_at }` → `200 { user: { id, email, role, created_at, left_at, leaver_status } }`; `400` for self (`"You cannot mark your own account as left"`) or a `validateLeftAt` message. Fetch user via `getUserById` (for `created_at`), set `app_metadata: { left_at, leaver_closed_at: null }`, then if status is now **left** call `closeLeaverAccount` immediately.
    - `POST /api/admin/users/:uid/reinstate` → `updateUserById(uid, { ban_duration: "none", app_metadata: { left_at: null, leaver_closed_at: null } })` → `200 { user: {…, left_at: null, leaver_status: "active" } }`. Serves both "Cancel leaving" and "Reinstate". Auto-submitted weeks are not un-submitted.
    - `GET /api/team-members` → each member gains `left: boolean` (= status **left**). Leavers kept so old names resolve.
- Behaviour changes:
  - `requireAuth`: after `getUser`, if `leaverStatus(user.app_metadata, today) === "left"` → `401 { error: "This account has been deactivated" }`.
  - Submit route: replace `weekBelowMinimum(weekEntries || [], week)` with `weekBelowMinimum(weekEntries || [], week, requiredWeekMins(week, req.user.app_metadata?.left_at))`; error text uses the required figure: `` `This week totals ${h}h ${m}m — ${req/60} hours must be accounted for before submitting…` `` (keep the rest of the existing sentence).
  - Outstanding route: users gain `leftAt: u.app_metadata?.left_at || null`.
  - `computeReminderRecipients`: first line in loop `if (leaverStatus(u.app_metadata, ukNow.dateStr) === "left") continue;`; pass nothing else — leaving staff are still chased for prior weeks.
  - `gatherHrReportData` `expected`: drop users whose `left_at` is set and `reportWeekMonday > mondayOf(left_at)`.

- [ ] **Step 1: Implement all of the above.**

- [ ] **Step 2: Load-check touched modules** (catches the missing-import class of bug from the D3 split) — in `server/`:

```bash
SUPABASE_URL=http://x SUPABASE_SERVICE_KEY=x R2_ENDPOINT=http://x R2_BUCKET=x R2_ACCESS_KEY_ID=x R2_SECRET_ACCESS_KEY=x node -e "['./middleware/auth','./helpers/leavers','./routes/admin','./routes/timesheets','./routes/taskBoard','./helpers/schedulers'].forEach(m=>require(m)); console.log('ok')"
```
Expected: `ok`. Also `node -c index.js` → no output.

- [ ] **Step 3: Confirm routes registered** — same env, `node -e "require('./routes/admin').stack.filter(l=>l.route).forEach(l=>console.log(Object.keys(l.route.methods)[0], l.route.path))"` → includes `post /api/admin/users/:uid/leave` and `post /api/admin/users/:uid/reinstate`.

- [ ] **Step 4: Run lib suite** — `node --test lib/` → all PASS.

- [ ] **Step 5: Checkpoint.**

---

### Task 3: Client — Admin Users + Task Board pickers

**Files:**
- Modify: `client/src/components/AdminSection.jsx` (users handlers ~L344-375; users table ~L730-781), `client/src/components/TaskBoard.jsx:173`, `:265`

**Interfaces:**
- Consumes: Task 2 endpoints and `left_at` / `leaver_status` / `left`.

- [ ] **Step 1: AdminSection.**
  - Main table = users with `leaver_status !== "left"`; count line `N current user(s)`.
  - **active** rows: add **"Mark as left"** button (style of "Reset password"). Opens an inline panel under the row: date input (default today, no max) + Confirm/Cancel. Confirm dialog (exact): `"Mark <email> as leaving on <d MMM yyyy>? They can work and submit timesheets up to that day. The next morning their account closes, and any unsubmitted final week is submitted automatically. All their history is kept."` → `POST …/leave`, update local state from returned user. Errors via existing `alert("Failed to …: " + e.message)` pattern (covers the server's self-check — AdminSection has no current-user id).
  - **leaving** rows: amber-ish tag `Leaving <d MMM yyyy>` beside the email (use an existing warning colour token from `constants.js`); "Mark as left" replaced by **"Cancel leaving"** (confirm: `"Cancel <email>'s leaving date?"`) → `POST …/reinstate`.
  - When any **left** users exist: section below, `sectionHeader("Former staff", "Accounts kept for records. They cannot log in.")`, table: Email · Left (d MMM yyyy) · Joined · **Reinstate** (confirm: `"Reinstate <email>? They will be able to log in again and will receive timesheet reminders."`). No role dropdown, password reset or delete here.
  - Delete confirm (exact): `"Permanently delete \"<email>\"? This cannot be undone, and their name will disappear from timesheets and reports. If they have left, use \"Mark as left\" instead."`
- [ ] **Step 2: TaskBoard** assignee selects (L173, L265): `users.filter(u => !u.left || u.id === form.assignee_id)`. Filter dropdown (~L392) and `UserChip` stay unfiltered.
- [ ] **Step 3: Build** — `client/`: `CI=false node node_modules/react-scripts/bin/react-scripts.js build` → `Compiled successfully` (or only pre-existing warnings).
- [ ] **Step 4: Checkpoint.**

---

### Task 4: Client — leaving week on the staff timesheet screen

**Files:**
- Modify: `client/src/hooks/useAuth.js` (expose `userLeftAt` from `session.user.app_metadata.left_at`, set in the same two places `role` is, ~L21 and ~L31)
- Modify: `client/src/App.js:1335` (pass `leftAt={userLeftAt}` to `TimesheetsSection`)
- Modify: `client/src/components/TimesheetsSection.jsx` (helpers near L17-20; `DayCard` L402-430; week render ~L1470-1500; submit check ~L1233-1290)

**Interfaces:**
- Consumes: `left_at` on the session user (set by Task 2). Mirrors server `requiredWeekMins` — keep the two in step.
- Produces (in `TimesheetsSection.jsx`): `requiredWeekMins(weekStart: string, leftAt: string|null) -> number` (same rule as Task 1) and `isAfterLeaving(date: string, leftAt: string|null) -> boolean` (`!!leftAt && date > leftAt`).

- [ ] **Step 1:** `TimesheetsSection({ isAdmin, isHr, leftAt })`. In the day loop: `const dayAfterLeaving = isAfterLeaving(date, leftAt);` → `locked={isLocked || dayPreLaunch || dayAfterLeaving}`, new `DayCard` prop `afterLeaving={dayAfterLeaving}` rendered exactly like `preLaunch` (greyed, 0.7 opacity) with label `n/a – left`. Quick-fill / week auto-fill (~L1183) must skip after-leaving days the same way it skips pre-launch days.
- [ ] **Step 2:** Replace the fixed `MIN_WEEK_MINS` comparisons (hard-block dialog ~L1263 and `underMin` ~L1290) with `const reqMins = requiredWeekMins(weekKey, leftAt);`. Dialog text when `reqMins < MIN_WEEK_MINS`: `` `Your week totals ${formatMins(total)} — ${formatMins(reqMins)} must be accounted for (up to your leaving date) before it can be submitted.` ``; otherwise the existing text unchanged.
- [ ] **Step 3: Build** (as Task 3) → compiles.
- [ ] **Step 4: Checkpoint.**

---

### Task 5: Staging test + docs

**Files:**
- Modify: `docs/HANDOVER.md` — short "Staff leavers (2026-11-09)" section: state fields, statuses, ban values, `leaverTick`, the client/server `requiredWeekMins` mirror, which places filter leavers and which deliberately don't.

- [ ] **Step 1: Deploy for staging** — Nathan commits on `develop` (GitHub Desktop) and pushes → Railway staging + Vercel preview rebuild. **No SQL.**

- [ ] **Step 2: Staging checklist** (throwaway test user, never the real leaver):
  1. Mark test user leaving **tomorrow** → stays in main list with "Leaving" tag; they can still log in.
  2. As test user: this week shows days after tomorrow as "n/a – left"; submitting with only the days up to tomorrow filled is accepted; one hour short is blocked with the reduced figure.
  3. Cancel leaving → tag gone, normal 37.5h week again.
  4. Mark leaving **yesterday**, with this week left unsubmitted → moves straight to Former staff; this week appears in Admin Review as Submitted; admin/HR get the "Final timesheet auto-submitted" email; test user can't log in, and an already-open session fails on its next action.
  5. Change *another* user's role → test user still in Former staff; Supabase dashboard → Auth → test user → `app_metadata` still has `left_at` and `leaver_closed_at`.
  6. Admin Review tallies and Admin → Notifications "send test reminder" unaffected for everyone else; test user absent from "Not submitted" after their leaving week.
  7. Reports & Analytics / Fee Review still show the test user's name on old entries. Task Board: old task assigned to them shows their name; new-task assignee list doesn't offer them.
  8. Reinstate → back in main list, can log in.
  9. Optional overnight check: mark leaving **today**, confirm next morning the account has closed by itself (Railway logs show `[Leavers] closed …`).
  10. Delete the throwaway user once all pass.

- [ ] **Step 3: Live use** — after develop→main, mark the real leaver with his actual leaving date (a Friday — full final week).

- [ ] **Step 4: Checkpoint** — HANDOVER updated; tell Nathan it's ready to merge.
