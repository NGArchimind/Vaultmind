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

test("addWeeks shifts by whole weeks (negative ok)", () => {
  assert.equal(R.addWeeks("2026-06-22", -1), "2026-06-15");
  assert.equal(R.addWeeks("2026-06-15", 2), "2026-06-29");
});

// ── firstOutstandingWeek (timesheet page opening week) ────────────────────────

const { firstOutstandingWeek } = require("./timesheetReminder");

test("opens on the earliest unsubmitted week", () => {
  const weeks = ["2026-06-29", "2026-07-06", "2026-07-13"];
  const subs = { "2026-06-29": "submitted", "2026-07-06": "draft" };
  assert.strictEqual(firstOutstandingWeek(weeks, subs, "2026-07-13"), "2026-07-06");
});

test("all weeks submitted/approved → the week after the current one", () => {
  const weeks = ["2026-07-06", "2026-07-13"];
  const subs = { "2026-07-06": "approved", "2026-07-13": "submitted" };
  assert.strictEqual(firstOutstandingWeek(weeks, subs, "2026-07-13"), "2026-07-20");
});

test("nothing submitted at all → the first tracked week", () => {
  assert.strictEqual(firstOutstandingWeek(["2026-07-06", "2026-07-13"], {}, "2026-07-13"), "2026-07-06");
});

test("no tracked weeks (tracking starts in the future) → current week", () => {
  assert.strictEqual(firstOutstandingWeek([], {}, "2026-07-13"), "2026-07-13");
});

// ── buildWeekStatus (admin review week grouping + tallies) ────────────────────

const { buildWeekStatus, filterRecipientsToWeek } = require("./timesheetReminder");

const wsUsers = [
  { id: "u1", name: "Sarah",  role: "user",  createdAt: "2026-06-01" },
  { id: "u2", name: "Tom",    role: "user",  createdAt: "2026-06-01" },
  { id: "u3", name: "Nathan", role: "admin", createdAt: "2026-06-01" },
];

test("buildWeekStatus: weeks newest-first with expected count and outstanding names", () => {
  const subsByUser = {
    u1: { "2026-06-29": "approved", "2026-07-06": "submitted" },
    u2: { "2026-06-29": "submitted" }, // nothing for 07-06
  };
  const out = buildWeekStatus({
    users: wsUsers, subsByUser,
    trackFromMonday: "2026-06-29", currentWeekMonday: "2026-07-06",
  });
  assert.deepEqual(out, [
    { week: "2026-07-06", expected: 2, outstanding: [{ id: "u2", name: "Tom", label: "Not started" }] },
    { week: "2026-06-29", expected: 2, outstanding: [] },
  ]);
});

test("buildWeekStatus: admin/hr are never expected", () => {
  const out = buildWeekStatus({
    users: wsUsers, subsByUser: {},
    trackFromMonday: "2026-07-06", currentWeekMonday: "2026-07-06",
  });
  assert.equal(out[0].expected, 2);
  assert.deepEqual(out[0].outstanding.map((o) => o.id), ["u1", "u2"]);
});

test("buildWeekStatus: a new starter is not expected before their creation week", () => {
  const users = [
    { id: "u1", name: "Sarah", role: "user", createdAt: "2026-06-01" },
    { id: "u4", name: "Ben",   role: "user", createdAt: "2026-07-08" }, // joined mid current week
  ];
  const out = buildWeekStatus({
    users, subsByUser: {},
    trackFromMonday: "2026-06-29", currentWeekMonday: "2026-07-06",
  });
  const w0706 = out.find((w) => w.week === "2026-07-06");
  const w0629 = out.find((w) => w.week === "2026-06-29");
  assert.equal(w0706.expected, 2); // Ben's creation week is 07-06 — expected
  assert.equal(w0629.expected, 1); // before Ben existed
  assert.deepEqual(w0629.outstanding.map((o) => o.name), ["Sarah"]);
});

test("buildWeekStatus: a draft counts as outstanding with a Draft label", () => {
  const out = buildWeekStatus({
    users: [{ id: "u1", name: "Sarah", role: "user", createdAt: "2026-06-01" }],
    subsByUser: { u1: { "2026-07-06": "draft" } },
    trackFromMonday: "2026-07-06", currentWeekMonday: "2026-07-06",
  });
  assert.deepEqual(out[0].outstanding, [{ id: "u1", name: "Sarah", label: "Draft" }]);
});

test("buildWeekStatus: tracking starting in the future yields no weeks", () => {
  const out = buildWeekStatus({
    users: wsUsers, subsByUser: {},
    trackFromMonday: "2026-07-13", currentWeekMonday: "2026-07-06",
  });
  assert.deepEqual(out, []);
});

test("buildWeekStatus: outstanding names are sorted alphabetically", () => {
  const users = [
    { id: "u2", name: "Tom",   role: "user", createdAt: "2026-06-01" },
    { id: "u5", name: "Amy",   role: "user", createdAt: "2026-06-01" },
  ];
  const out = buildWeekStatus({
    users, subsByUser: {},
    trackFromMonday: "2026-07-06", currentWeekMonday: "2026-07-06",
  });
  assert.deepEqual(out[0].outstanding.map((o) => o.name), ["Amy", "Tom"]);
});

test("filterRecipientsToWeek keeps only recipients with that week outstanding", () => {
  const recipients = [
    { email: "a@x.com", firstName: "A", weeks: [{ week: "2026-07-06", label: "Not started" }] },
    { email: "b@x.com", firstName: "B", weeks: [{ week: "2026-06-29", label: "Draft" }] },
    { email: "c@x.com", firstName: "C", weeks: [{ week: "2026-06-29", label: "Draft" }, { week: "2026-07-06", label: "Not started" }] },
  ];
  assert.deepEqual(
    filterRecipientsToWeek(recipients, "2026-07-06").map((r) => r.email),
    ["a@x.com", "c@x.com"]
  );
  assert.deepEqual(filterRecipientsToWeek(recipients, "2026-07-13"), []);
});
