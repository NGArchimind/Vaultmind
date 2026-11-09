"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { leaverStatus, validateLeftAt, requiredWeekMins, needsClosing, leavingWeek, isCurrentStaff, isAfterLeavingWeek } = require("./leavers");

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
  assert.equal(requiredWeekMins(wk, "2026-11-04"), 1350);  // left Wed: 3 x 450
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

test("leavingWeek", () => {
  assert.equal(leavingWeek("2026-11-06"), "2026-11-02");
});

test("isCurrentStaff: false only once someone has left", () => {
  assert.equal(isCurrentStaff({ role: "hr" }, "2026-11-09"), true);
  assert.equal(isCurrentStaff({ role: "hr", left_at: "2026-11-20" }, "2026-11-09"), true); // notice period
  assert.equal(isCurrentStaff({ role: "hr", left_at: "2026-11-06" }, "2026-11-09"), false);
});

test("isAfterLeavingWeek: weeks after the leaving week can't be submitted", () => {
  assert.equal(isAfterLeavingWeek("2026-11-09", "2026-11-06"), true);
  assert.equal(isAfterLeavingWeek("2026-11-02", "2026-11-06"), false); // the leaving week itself
  assert.equal(isAfterLeavingWeek("2026-11-09", null), false);
});
