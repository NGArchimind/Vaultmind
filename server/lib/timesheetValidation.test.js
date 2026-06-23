const { test } = require("node:test");
const assert = require("node:assert");
const { daysOverCap, DAY_CAP_MINS } = require("./timesheetValidation");

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
