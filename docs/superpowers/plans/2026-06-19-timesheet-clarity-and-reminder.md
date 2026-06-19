# Timesheet Clarity + Weekly Reminder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the timesheet entry page's time vs. overtime columns unambiguous, and add an admin-configurable email that reminds non-admin staff with outstanding timesheets (default Friday 16:00 UK).

**Architecture:** Part 1 is a presentational refactor of `TimesheetsSection.jsx` (grouped "Time worked / Overtime" columns) — no logic change. Part 2 adds pure date/recipient helpers (unit-tested with Node's built-in test runner), a 15-minute in-server timer, three admin endpoints, a branded email, and an admin settings panel.

**Tech Stack:** React (CRA), Express (CommonJS, single file), Supabase (`app_settings` key/value + `timesheet_submissions` + Auth admin), Resend, `node --test` (built-in, no new dependency).

---

## ⚠️ Project conventions (read before starting)

- **Nathan commits and deploys himself.** Do **not** run `git add`/`git commit`/`git push`. Where this plan says "Checkpoint," it means: run the stated verification, show Nathan the diff, and let him commit. The `git` snippets are for *his* reference only.
- **Always read a file's current state before editing** (line numbers below are from 2026-06-19 and may drift).
- **Build runs via the documented workaround** (npm build script is misconfigured on this machine): from `client/`, run `node node_modules\react-scripts\bin\react-scripts.js build` in PowerShell.
- **Branch:** work on `develop`, verify on staging, then Nathan merges `develop → main`.
- **No SQL / no migration** — `app_settings` is an existing key/value table.
- Client→server calls use `api()` from `client/src/api/client.js` — never raw `fetch`.
- Server auth: `supabase.auth.getUser` via existing `requireAuth`; admin via `requireAdmin`.

---

## File structure

| File | Responsibility | Action |
|------|----------------|--------|
| `client/src/components/TimesheetsSection.jsx` | Entry grid — grouped time/overtime columns | Modify (header row, `EntryRow`, `DraftRow`) |
| `server/lib/timesheetReminder.js` | Pure date/recipient/due helpers | Create |
| `server/lib/timesheetReminder.test.js` | Unit tests for the above (`node --test`) | Create |
| `server/index.js` | Settings helpers, email builder, run + scheduler, 3 admin endpoints | Modify |
| `client/src/components/AdminSection.jsx` | `TimesheetReminderSettings` panel in Notifications tab | Modify |

---

# PART 1 — Entry-page column clarity (Option C)

Client only → Vercel. No logic change: overtime stays project-only and stays out of the weekly total.

### Task 1: Grouped column headers

**Files:**
- Modify: `client/src/components/TimesheetsSection.jsx:1058-1064` (the `{/* Column headers */}` block)

- [ ] **Step 1: Read** lines 1055–1095 to confirm the header block is unchanged.

- [ ] **Step 2: Replace the inner spans** of the header row (currently Project / Hours / Mins / Notes / spacer) with grouped headings:

```jsx
                <div style={{ display: "flex", gap: 8, padding: "0 14px 6px", fontSize: 11, color: "#8a9aa8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  <span style={{ flex: 1 }}>Project / Category</span>
                  <span style={{ width: 132, textAlign: "center" }}>Time worked</span>
                  <span style={{ width: 132, textAlign: "center", color: "#8a6a3a" }}>Overtime</span>
                  <span style={{ flex: 1 }}>Notes</span>
                  <span style={{ width: 28 }} />
                </div>
```

- [ ] **Step 3: Visual check deferred** to Task 3 (header alignment only makes sense once the rows match). Move on.

### Task 2: `EntryRow` — grouped Time worked / Overtime cells

**Files:**
- Modify: `client/src/components/TimesheetsSection.jsx:221-262` (the `EntryRow` return)

- [ ] **Step 1: Read** lines 219–263 to confirm current markup.

- [ ] **Step 2: Replace** the hours select, minutes select, the `OT` pill span, and the two overtime selects (currently lines ~226–250) with two fixed-width group containers. Leave the Project select (above) and the Notes input + delete button (below) untouched:

```jsx
      {/* Time worked */}
      <div style={{ width: 132, display: "flex", gap: 8 }}>
        <select value={entry.hours ?? 0}
          onChange={e => onUpdate(entry.id, { hours: parseInt(e.target.value) })}
          disabled={locked} style={{ ...ss, flex: 1, minWidth: 0 }}>
          {HOUR_OPTIONS.map(h => <option key={h} value={h}>{h}h</option>)}
        </select>
        <select value={entry.minutes ?? 0}
          onChange={e => onUpdate(entry.id, { minutes: parseInt(e.target.value) })}
          disabled={locked} style={{ ...ss, flex: 1, minWidth: 0 }}>
          {MINUTE_OPTIONS.map(m => <option key={m} value={m}>{m}m</option>)}
        </select>
      </div>
      {/* Overtime — project rows only; placeholder keeps columns aligned */}
      <div style={{ width: 132, display: "flex", gap: 8 }}>
        {isProject ? (
          <>
            <select value={entry.overtime_hours ?? 0}
              onChange={e => onUpdate(entry.id, { overtime_hours: parseInt(e.target.value) })}
              disabled={locked} title="Overtime hours"
              style={{ ...ss, flex: 1, minWidth: 0, background: "#fbf3e6", borderColor: "#e3cfa6", color: "#8a6a3a" }}>
              {HOUR_OPTIONS.map(h => <option key={h} value={h}>{h}h</option>)}
            </select>
            <select value={entry.overtime_minutes ?? 0}
              onChange={e => onUpdate(entry.id, { overtime_minutes: parseInt(e.target.value) })}
              disabled={locked} title="Overtime minutes"
              style={{ ...ss, flex: 1, minWidth: 0, background: "#fbf3e6", borderColor: "#e3cfa6", color: "#8a6a3a" }}>
              {MINUTE_OPTIONS.map(m => <option key={m} value={m}>{m}m</option>)}
            </select>
          </>
        ) : (
          <span style={{ flex: 1, textAlign: "center", alignSelf: "center", color: "#b6c0c8", fontSize: 12 }}>n/a</span>
        )}
      </div>
```

Note: `isProject` is already defined at line ~210 (`const isProject = !!entry.project_id;`). `ss` (from `selStyle(locked)`) is already defined at line ~219.

### Task 3: `DraftRow` — matching column widths + verify alignment

**Files:**
- Modify: `client/src/components/TimesheetsSection.jsx:173-196` (the `DraftRow` return)

- [ ] **Step 1: Read** lines 173–197 to confirm current markup.

- [ ] **Step 2: Wrap** the draft hours+minutes selects in a 132-wide group and add an empty 132-wide overtime placeholder (a new draft has no overtime until it's saved as a project entry), so the add-row lines up under the headers. Replace the two existing hours/minutes `<select>`s (lines ~180–189) with:

```jsx
      <div style={{ width: 132, display: "flex", gap: 8 }}>
        <select value={hours} disabled={saving}
          onChange={e => { const v = parseInt(e.target.value); setHours(v); save(sel, v, minutes, notes); }}
          style={{ ...ss, flex: 1, minWidth: 0 }}>
          {HOUR_OPTIONS.map(h => <option key={h} value={h}>{h}h</option>)}
        </select>
        <select value={minutes} disabled={saving}
          onChange={e => { const v = parseInt(e.target.value); setMinutes(v); save(sel, hours, v, notes); }}
          style={{ ...ss, flex: 1, minWidth: 0 }}>
          {MINUTE_OPTIONS.map(m => <option key={m} value={m}>{m}m</option>)}
        </select>
      </div>
      <div style={{ width: 132 }} />
```

- [ ] **Step 3: Build the client.** From `client/` in PowerShell:

Run: `node node_modules\react-scripts\bin\react-scripts.js build`
Expected: `Compiled successfully` (warnings OK, no errors).

- [ ] **Step 4: Visual check (Checkpoint for Nathan).** On staging, open a week that has both a project row (with overtime) and a leave/category row (e.g. Annual Leave). Confirm: headers "Time worked" / "Overtime" sit directly above their boxes; overtime boxes are amber; the leave row shows "n/a" under Overtime and still lines up; Notes sits over the Notes box. Nathan commits Part 1 and deploys to **Vercel** when happy.

```bash
# For Nathan's reference only:
git add client/src/components/TimesheetsSection.jsx
git commit -m "Clarify timesheet entry: grouped Time worked / Overtime columns"
```

---

# PART 2 — Weekly timesheet reminder

Server + client → Railway **then** Vercel. No SQL. Set `PUBLIC_APP_URL` on Railway (both envs); defaults to `https://archimind.co.uk` if unset.

## Task 4: Pure helper library + tests (TDD)

**Files:**
- Create: `server/lib/timesheetReminder.js`
- Create: `server/lib/timesheetReminder.test.js`

- [ ] **Step 1: Write the failing tests** at `server/lib/timesheetReminder.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const R = require("./timesheetReminder");

test("mondayOf returns the Monday of the week", () => {
  assert.equal(R.mondayOf("2026-06-19"), "2026-06-15"); // Friday -> Monday
  assert.equal(R.mondayOf("2026-06-15"), "2026-06-15"); // Monday -> itself
  assert.equal(R.mondayOf("2026-06-21"), "2026-06-15"); // Sunday -> that week's Monday
});

test("enumerateWeekStarts is inclusive and steps by 7 days", () => {
  assert.deepEqual(
    R.enumerateWeekStarts("2026-06-01", "2026-06-15"),
    ["2026-06-01", "2026-06-08", "2026-06-15"]
  );
  assert.deepEqual(R.enumerateWeekStarts("2026-06-15", "2026-06-15"), ["2026-06-15"]);
});

test("laterMonday picks the later date string", () => {
  assert.equal(R.laterMonday("2026-07-06", "2026-06-15"), "2026-07-06");
  assert.equal(R.laterMonday("2026-06-15", "2026-07-06"), "2026-07-06");
});

test("isRemindableRole excludes admin and hr", () => {
  assert.equal(R.isRemindableRole("admin"), false);
  assert.equal(R.isRemindableRole("hr"), false);
  assert.equal(R.isRemindableRole("user"), true);
  assert.equal(R.isRemindableRole(undefined), true);
});

test("computeOutstandingWeeks labels Draft vs Not started, skips done", () => {
  const weeks = ["2026-06-01", "2026-06-08", "2026-06-15"];
  const subs = { "2026-06-01": "approved", "2026-06-08": "draft" }; // 06-15 missing
  assert.deepEqual(R.computeOutstandingWeeks(weeks, subs), [
    { week: "2026-06-08", label: "Draft" },
    { week: "2026-06-15", label: "Not started" },
  ]);
  assert.deepEqual(R.computeOutstandingWeeks(weeks, {
    "2026-06-01": "submitted", "2026-06-08": "approved", "2026-06-15": "approved",
  }), []);
});

test("ukParts handles BST and GMT", () => {
  // June = BST (UTC+1): 15:00Z -> 16:00 local, Friday
  assert.deepEqual(R.ukParts(new Date("2026-06-19T15:00:00Z")),
    { day: 5, time: "16:00", dateStr: "2026-06-19" });
  // January = GMT (UTC+0): 16:30Z -> 16:30 local, Friday
  assert.deepEqual(R.ukParts(new Date("2026-01-09T16:30:00Z")),
    { day: 5, time: "16:30", dateStr: "2026-01-09" });
});

test("isReminderDue: due only on configured day, at/after time, once per week", () => {
  const base = { nowDay: 5, nowTime: "16:00", cfgDay: 5, cfgTime: "16:00",
    currentWeekMonday: "2026-06-15", lastSentWeek: null };
  assert.equal(R.isReminderDue(base), true);
  assert.equal(R.isReminderDue({ ...base, nowDay: 4 }), false);          // wrong day
  assert.equal(R.isReminderDue({ ...base, nowTime: "15:45" }), false);   // before time
  assert.equal(R.isReminderDue({ ...base, lastSentWeek: "2026-06-15" }), false); // already sent
  assert.equal(R.isReminderDue({ ...base, nowTime: "18:30" }), true);    // later same day
});
```

- [ ] **Step 2: Run the tests to verify they fail.** From `server/`:

Run: `node --test lib/timesheetReminder.test.js`
Expected: FAIL — `Cannot find module './timesheetReminder'`.

- [ ] **Step 3: Implement** `server/lib/timesheetReminder.js`:

```js
"use strict";

// Parse 'YYYY-MM-DD' at UTC noon to avoid DST/offset edges in date arithmetic.
function parseISODateUTCNoon(dateStr) {
  return new Date(dateStr + "T12:00:00Z");
}
function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

// Monday (week_start) of the week containing dateStr, as 'YYYY-MM-DD'.
function mondayOf(dateStr) {
  const d = parseISODateUTCNoon(dateStr);
  const dow = d.getUTCDay();                 // 0=Sun .. 6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;     // shift back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return toISODate(d);
}

// Inclusive list of Monday week_starts from fromMonday to toMonday.
function enumerateWeekStarts(fromMonday, toMonday) {
  const out = [];
  const cur = parseISODateUTCNoon(fromMonday);
  const end = parseISODateUTCNoon(toMonday);
  while (cur <= end) {
    out.push(toISODate(cur));
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return out;
}

// Later of two 'YYYY-MM-DD' strings (lexicographic == chronological for ISO dates).
function laterMonday(a, b) {
  return a >= b ? a : b;
}

function isRemindableRole(role) {
  return role !== "admin" && role !== "hr";
}

// submissions: { [week_start]: status }. Returns outstanding weeks with a label.
function computeOutstandingWeeks(weekStarts, submissions) {
  const done = new Set(["submitted", "approved"]);
  return weekStarts
    .filter((w) => !done.has(submissions[w]))
    .map((w) => ({ week: w, label: submissions[w] === "draft" ? "Draft" : "Not started" }));
}

// UK (Europe/London) day/time/date parts for a given instant — handles BST automatically.
function ukParts(date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "short", hour12: false,
    hour: "2-digit", minute: "2-digit", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const dayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const hour = p.hour === "24" ? "00" : p.hour; // some ICU builds emit "24" at midnight
  return { day: dayMap[p.weekday], time: `${hour}:${p.minute}`, dateStr: `${p.year}-${p.month}-${p.day}` };
}

// Times are zero-padded "HH:MM", so string comparison is chronological.
function isReminderDue({ nowDay, nowTime, cfgDay, cfgTime, currentWeekMonday, lastSentWeek }) {
  if (nowDay !== cfgDay) return false;
  if (nowTime < cfgTime) return false;
  if (lastSentWeek === currentWeekMonday) return false;
  return true;
}

module.exports = {
  parseISODateUTCNoon, toISODate, mondayOf, enumerateWeekStarts,
  laterMonday, isRemindableRole, computeOutstandingWeeks, ukParts, isReminderDue,
};
```

- [ ] **Step 4: Run the tests to verify they pass.** From `server/`:

Run: `node --test lib/timesheetReminder.test.js`
Expected: PASS — `# pass 7`, `# fail 0`.

- [ ] **Step 5: Checkpoint** — show Nathan the green test run; he commits the new lib + test files.

## Task 5: Server settings helpers + email builder + run + scheduler

**Files:**
- Modify: `server/index.js` (add helpers near the other notification helpers ~line 128; add scheduler near `app.listen`)

- [ ] **Step 1: Read** `server/index.js:118-155` (existing email helpers) and the area around `app.listen` (search for `app.listen`).

- [ ] **Step 2: Add the require + constants** near the top, just after the existing requires (after line ~11):

```js
const reminderLib = require("./lib/timesheetReminder");
const APP_URL = process.env.PUBLIC_APP_URL || "https://archimind.co.uk";
const REMINDER_DEFAULTS = { enabled: true, day: 5, time: "16:00", track_from: "2026-07-01" };
```

- [ ] **Step 3: Add settings + state helpers** just after `notificationEmailHtml` (after line ~128):

```js
async function getReminderSettings() {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "timesheet_reminder").maybeSingle();
  let parsed = {};
  try { parsed = data?.value ? JSON.parse(data.value) : {}; } catch { parsed = {}; }
  return { ...REMINDER_DEFAULTS, ...parsed };
}
async function getReminderState() {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "timesheet_reminder_state").maybeSingle();
  try { return data?.value ? JSON.parse(data.value) : {}; } catch { return {}; }
}
async function setReminderState(state) {
  await supabase.from("app_settings").upsert(
    { key: "timesheet_reminder_state", value: JSON.stringify(state), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
}

// Branded reminder email body (uses the shared notificationEmailHtml wrapper).
function reminderEmailHtml(firstName, weeks) {
  const rows = weeks.map((w, i) => {
    const colour = w.label === "Draft" ? "#8a6a3a" : "#c0392b";
    const bg = i % 2 === 0 ? "#f6f8f9" : "#ffffff";
    return `<tr style="background:${bg};"><td style="padding:9px 12px;color:#262830;border:1px solid #e3e9ec;">${escapeHtml(formatWeekRange(w.week))}</td>`
      + `<td style="padding:9px 12px;color:${colour};border:1px solid #e3e9ec;width:110px;">${w.label}</td></tr>`;
  }).join("");
  const body = `<p style="margin:0 0 14px;font-size:15px;color:#262830;">Hi ${escapeHtml(firstName)},</p>`
    + `<p style="margin:0 0 16px;font-size:14px;color:#262830;">The following timesheets are <strong>not yet submitted</strong>:</p>`
    + `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">${rows}</table>`
    + `<p style="margin:0 0 22px;font-size:13px;line-height:1.6;color:#5a6b76;">Please ensure timesheets are completed at the end of each week. These are critical to ensuring fees are tracked effectively and jobs are priced correctly.</p>`
    + `<a href="${APP_URL}" style="display:inline-block;background:#4c6278;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;">Open Archimind &rarr;</a>`
    + `<p style="margin:22px 0 0;font-size:12px;color:#8a9aa8;">You're receiving this because your timesheet is outstanding. Once submitted, you'll drop off next week's reminder.</p>`;
  return notificationEmailHtml("Timesheets", body);
}

// Build recipients. onlyUserId (optional) = test mode: target just that user and
// bypass the admin/HR role filter so an admin can preview against their own account.
async function computeReminderRecipients(settings, onlyUserId) {
  const trackFromMonday = reminderLib.mondayOf(settings.track_from);
  const ukNow = reminderLib.ukParts(new Date());
  const currentWeekMonday = reminderLib.mondayOf(ukNow.dateStr);

  const { data: subs } = await supabase
    .from("timesheet_submissions").select("user_id, week_start, status")
    .gte("week_start", trackFromMonday);
  const byUser = {};
  for (const s of subs || []) (byUser[s.user_id] ||= {})[s.week_start] = s.status;

  const { data: usersData } = await supabase.auth.admin.listUsers();
  const recipients = [];
  for (const u of usersData?.users || []) {
    if (onlyUserId && u.id !== onlyUserId) continue;
    if (!onlyUserId && !reminderLib.isRemindableRole(u.app_metadata?.role)) continue;
    const createdMonday = reminderLib.mondayOf((u.created_at || settings.track_from).slice(0, 10));
    const start = reminderLib.laterMonday(trackFromMonday, createdMonday);
    if (start > currentWeekMonday) continue;
    const weeks = reminderLib.computeOutstandingWeeks(
      reminderLib.enumerateWeekStarts(start, currentWeekMonday), byUser[u.id] || {});
    if (!weeks.length || !u.email) continue;
    const firstName = (u.user_metadata?.full_name || u.email || "there").split(/[ @]/)[0];
    recipients.push({ email: u.email, firstName, weeks });
  }
  return recipients;
}

async function runTimesheetReminders(onlyUserId) {
  const settings = await getReminderSettings();
  const recipients = await computeReminderRecipients(settings, onlyUserId);
  for (const r of recipients) {
    const n = r.weeks.length;
    await sendEmail({
      to: r.email,
      subject: `Timesheet reminder — you have ${n} outstanding timesheet${n === 1 ? "" : "s"}`,
      html: reminderEmailHtml(r.firstName, r.weeks),
      text: `Hi ${r.firstName},\n\nThe following timesheets are not yet submitted:\n`
        + r.weeks.map((w) => `- ${formatWeekRange(w.week)} (${w.label})`).join("\n")
        + `\n\nPlease ensure timesheets are completed at the end of each week. These are critical to ensuring fees are tracked effectively and jobs are priced correctly.\n\nOpen Archimind: ${APP_URL}`,
    });
  }
  return recipients.length;
}

// 15-minute scheduler — fires once on the configured UK day at/after the configured time.
async function reminderTick() {
  try {
    const settings = await getReminderSettings();
    if (!settings.enabled) return;
    const ukNow = reminderLib.ukParts(new Date());
    const currentWeekMonday = reminderLib.mondayOf(ukNow.dateStr);
    const state = await getReminderState();
    if (!reminderLib.isReminderDue({
      nowDay: ukNow.day, nowTime: ukNow.time, cfgDay: settings.day, cfgTime: settings.time,
      currentWeekMonday, lastSentWeek: state.last_sent_week,
    })) return;
    const count = await runTimesheetReminders();
    await setReminderState({ last_sent_week: currentWeekMonday });
    console.log(`[Reminder] Sent timesheet reminders to ${count} staff for week ${currentWeekMonday}`);
  } catch (e) {
    console.error("[Reminder] tick failed:", e.message);
  }
}
```

Note: `escapeHtml`, `formatWeekRange`, `sendEmail`, `notificationEmailHtml`, and `supabase` already exist in this file. `||=` is supported on Node 24.

- [ ] **Step 4: Start the scheduler** — add this line immediately after the existing `app.listen(...)` call:

```js
setInterval(reminderTick, 15 * 60 * 1000);
```

- [ ] **Step 5: Smoke-test the module loads.** From `server/`:

Run: `node -e "require('./index.js'); setTimeout(()=>process.exit(0), 1500)"`
Expected: server boots without a `ReferenceError`/`SyntaxError` (it may log its normal startup lines; ignore "port in use" if the real server is running — re-run with `PORT=5999` if needed).

- [ ] **Step 6: Checkpoint** — show Nathan the diff. (Endpoints come next; don't deploy yet.)

## Task 6: Admin endpoints

**Files:**
- Modify: `server/index.js` — add three routes next to the notification-settings routes (after line ~4558)

- [ ] **Step 1: Read** `server/index.js:4542-4558` to match the surrounding route style.

- [ ] **Step 2: Add** the routes:

```js
// GET /api/admin/timesheet-reminder
app.get("/api/admin/timesheet-reminder", requireAuth, requireAdmin, async (req, res) => {
  res.json(await getReminderSettings());
});

// PUT /api/admin/timesheet-reminder
app.put("/api/admin/timesheet-reminder", requireAuth, requireAdmin, async (req, res) => {
  const b = req.body || {};
  const cur = await getReminderSettings();
  const settings = {
    enabled: typeof b.enabled === "boolean" ? b.enabled : cur.enabled,
    day: [1, 2, 3, 4, 5].includes(Number(b.day)) ? Number(b.day) : cur.day,
    time: /^([01]\d|2[0-3]):(00|30)$/.test(b.time) ? b.time : cur.time,
    track_from: /^\d{4}-\d{2}-\d{2}$/.test(b.track_from) ? b.track_from : cur.track_from,
  };
  const { error } = await supabase.from("app_settings").upsert(
    { key: "timesheet_reminder", value: JSON.stringify(settings), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json(settings);
});

// POST /api/admin/timesheet-reminder/test → send only to the requesting admin
app.post("/api/admin/timesheet-reminder/test", requireAuth, requireAdmin, async (req, res) => {
  try {
    const sent = await runTimesheetReminders(req.user.id);
    res.json({ ok: true, sent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: Checkpoint (Nathan).** Nathan commits the server changes, sets `PUBLIC_APP_URL` on Railway (staging + prod), and deploys to **Railway**. Verify the endpoint responds: logged in as admin on staging, `GET /api/admin/timesheet-reminder` returns the defaults JSON.

## Task 7: Admin UI — Timesheet Reminder panel

**Files:**
- Modify: `client/src/components/AdminSection.jsx` (add a component; render it in the Notifications tab at line ~586)

- [ ] **Step 1: Read** `AdminSection.jsx:1-4` (imports) and `:48-97` (`NotificationSettings` for style) and `:586`.

- [ ] **Step 2: Add** the `TimesheetReminderSettings` component immediately after `NotificationSettings` (after line ~97). `DESIGN_SHELL` is already imported (line 4):

```jsx
function TimesheetReminderSettings() {
  const [cfg, setCfg]       = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast]   = useState(null);

  useEffect(() => { api("/api/admin/timesheet-reminder").then(setCfg).catch(() => {}); }, []);

  const save = async (patch) => {
    if (!cfg || saving) return;
    const prev = cfg, next = { ...cfg, ...patch };
    setCfg(next); setSaving(true);
    try {
      const saved = await api("/api/admin/timesheet-reminder", { method: "PUT", body: next });
      setCfg(saved); setToast("Saved"); setTimeout(() => setToast(null), 1500);
    } catch {
      setCfg(prev); setToast("Could not save"); setTimeout(() => setToast(null), 2000);
    } finally { setSaving(false); }
  };

  const sendTest = async () => {
    setSaving(true);
    try {
      const r = await api("/api/admin/timesheet-reminder/test", { method: "POST" });
      setToast(r.sent ? "Test sent to your email" : "Nothing outstanding for you — no test email");
    } catch { setToast("Could not send test"); }
    finally { setSaving(false); setTimeout(() => setToast(null), 2500); }
  };

  const DAYS = [[1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"], [5, "Friday"]];
  const TIMES = [];
  for (let h = 7; h <= 20; h++) { const hh = String(h).padStart(2, "0"); TIMES.push(`${hh}:00`, `${hh}:30`); }
  const inp = { fontSize: 13, padding: "6px 8px", border: "1px solid #d0d8de", background: "#fff", color: DESIGN_SHELL, fontFamily: "Inter, Arial, sans-serif" };

  return (
    <div style={{ marginBottom: 48 }}>
      <h2 style={{ fontSize: 16, fontWeight: 300, color: DESIGN_SHELL, marginBottom: 4 }}>Timesheet Reminder</h2>
      <p style={{ fontSize: 12, color: "#9a9088", marginBottom: 20 }}>
        Emails staff (excluding Admin/HR) who have outstanding timesheets, on the day &amp; time below.
        {toast && <span style={{ marginLeft: 10, color: DESIGN_SHELL, fontWeight: 600 }}>{toast}</span>}
      </p>
      <div style={{ background: "#fff", border: "1px solid #e0dbd4", borderTop: `3px solid ${DESIGN_SHELL}`, padding: "18px 24px", maxWidth: 640 }}>
        {!cfg && <p style={{ fontSize: 13, color: "#9a9088" }}>Loading…</p>}
        {cfg && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: DESIGN_SHELL }}>
              <input type="checkbox" checked={cfg.enabled} disabled={saving} onChange={e => save({ enabled: e.target.checked })} />
              Send weekly reminders
            </label>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <label style={{ fontSize: 12, color: "#9a9088" }}>Day<br />
                <select value={cfg.day} disabled={saving} onChange={e => save({ day: Number(e.target.value) })} style={inp}>
                  {DAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12, color: "#9a9088" }}>Time (UK)<br />
                <select value={cfg.time} disabled={saving} onChange={e => save({ time: e.target.value })} style={inp}>
                  {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12, color: "#9a9088" }}>Chase incomplete weeks from<br />
                <input type="date" value={cfg.track_from} disabled={saving} onChange={e => save({ track_from: e.target.value })} style={inp} />
              </label>
            </div>
            <div>
              <button type="button" onClick={sendTest} disabled={saving}
                style={{ fontSize: 12, padding: "8px 16px", border: `1px solid ${DESIGN_SHELL}`, background: "#fff", color: DESIGN_SHELL, cursor: saving ? "default" : "pointer" }}>
                Send a test reminder to my email
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Render it** in the Notifications tab. Change line ~586 from:

```jsx
      {adminTab === "notifications" && <NotificationSettings />}
```
to:
```jsx
      {adminTab === "notifications" && (<><NotificationSettings /><TimesheetReminderSettings /></>)}
```

- [ ] **Step 4: Build the client.** From `client/`:

Run: `node node_modules\react-scripts\bin\react-scripts.js build`
Expected: `Compiled successfully`.

- [ ] **Step 5: End-to-end check (Checkpoint for Nathan).** On staging (after the Task 6 server deploy):
  1. Admin → Notifications → "Timesheet Reminder" panel loads with Friday / 16:00 / 2026-07-01.
  2. Change the day, reload — it persisted.
  3. Click **Send a test reminder to my email**. Confirm the branded email arrives, lists your outstanding weeks (or you see "Nothing outstanding for you"), with the toned-down note and a working "Open Archimind" link.
  4. Nathan commits the client change, deploys to **Vercel**, then merges `develop → main` and deploys prod.

```bash
# For Nathan's reference only:
git add client/src/components/AdminSection.jsx
git commit -m "Add admin Timesheet Reminder settings panel"
```

---

## Post-implementation

- [ ] Update `docs/HANDOVER.md` with a short "Timesheet reminder" subsection (settings keys `timesheet_reminder` / `timesheet_reminder_state`, the 15-min UK-time scheduler, `PUBLIC_APP_URL`, the per-user join-date floor, and the no-catch-up limitation). **Nathan commits.**
- [ ] Delete this note: the temporary `node -e` smoke test leaves no files; no cleanup needed.

## Self-review notes (coverage)

- Spec Part 1 (Option C grouped columns, amber OT, aligned n/a, no logic change) → Tasks 1–3.
- Spec Part 2 data model (`timesheet_reminder`, `timesheet_reminder_state`, no SQL) → Task 5 helpers.
- Scheduler (15-min, UK time, idempotent) → Task 5 `reminderTick` + Task 4 `isReminderDue`/`ukParts`.
- Recipient logic (non-admin/HR, cut-off + per-user join floor, Draft/Not started) → Task 4 pure fns + Task 5 `computeReminderRecipients`.
- Email (branded wrapper, toned-down note, week list, button) → Task 5 `reminderEmailHtml`.
- Admin UI (enabled/day/time/cut-off + test button) → Tasks 6–7.
- Deployment order (Railway before Vercel, `PUBLIC_APP_URL`) → Task 6 Step 3 / Task 7 Step 5.
