const { test } = require("node:test");
const assert = require("node:assert");
const { daysOverCap, DAY_CAP_MINS, weekBelowMinimum, MIN_WEEK_MINS } = require("./timesheetValidation");

test("DAY_CAP_MINS is 450 (7h 30m)", () => {
  assert.strictEqual(DAY_CAP_MINS, 450);
});

test("flags a day with >7.5h of time worked across projects", () => {
  const entries = [
    { entry_date: "2026-06-22", hours: 4, minutes: 0 },
    { entry_date: "2026-06-22", hours: 3, minutes: 0 },
    { entry_date: "2026-06-22", hours: 3, minutes: 0 }, // 10h total
  ];
  assert.deepStrictEqual(daysOverCap(entries), [{ date: "2026-06-22", mins: 600 }]);
});

test("exactly 7h 30m is allowed", () => {
  const entries = [{ entry_date: "2026-06-22", hours: 7, minutes: 30 }];
  assert.deepStrictEqual(daysOverCap(entries), []);
});

test("overtime does not count toward the cap", () => {
  const entries = [{ entry_date: "2026-06-22", hours: 7, minutes: 30, overtime_hours: 3, overtime_minutes: 0 }];
  assert.deepStrictEqual(daysOverCap(entries), []);
});

test("different days are evaluated independently", () => {
  const entries = [
    { entry_date: "2026-06-22", hours: 8, minutes: 0 }, // over
    { entry_date: "2026-06-23", hours: 7, minutes: 30 }, // ok
  ];
  assert.deepStrictEqual(daysOverCap(entries), [{ date: "2026-06-22", mins: 480 }]);
});

// ── weekBelowMinimum ───────────────────────────────────────────────────────────

test("MIN_WEEK_MINS is 2250 (37.5h)", () => {
  assert.strictEqual(MIN_WEEK_MINS, 2250);
});

test("flags a short week (overtime never counts toward the minimum)", () => {
  const entries = [
    { entry_date: "2026-07-06", hours: 7, minutes: 30, overtime_hours: 5 },
    { entry_date: "2026-07-07", hours: 7, minutes: 30 },
  ]; // 15h worked
  const r = weekBelowMinimum(entries, "2026-07-06");
  assert.strictEqual(r.belowMin, true);
  assert.strictEqual(r.totalMins, 900);
});

test("a full 37.5h week passes (leave/category hours count)", () => {
  const entries = [
    { entry_date: "2026-07-06", hours: 7, minutes: 30 },
    { entry_date: "2026-07-07", hours: 7, minutes: 30 },
    { entry_date: "2026-07-08", hours: 7, minutes: 30 },
    { entry_date: "2026-07-09", hours: 7, minutes: 30 }, // e.g. holiday category
    { entry_date: "2026-07-10", hours: 7, minutes: 30 },
  ];
  assert.strictEqual(weekBelowMinimum(entries, "2026-07-06").belowMin, false);
});

test("weeks starting before the launch date are exempt", () => {
  const entries = [{ entry_date: "2026-06-29", hours: 1, minutes: 0 }];
  assert.strictEqual(weekBelowMinimum(entries, "2026-06-29").belowMin, false);
});

test("empty week is below minimum (but submit already requires entries)", () => {
  assert.strictEqual(weekBelowMinimum([], "2026-07-06").belowMin, true);
});
