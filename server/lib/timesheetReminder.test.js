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
