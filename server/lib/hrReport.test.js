"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { buildHrReportModel } = require("./hrReport");

test("folds in zero-loggers, maps status, totals & sorts", () => {
  const model = buildHrReportModel({
    entries: [
      { userId: "u1", name: "Sarah Jones", projectLabel: "24009 — Woolwich", hours: 7.5, overtime: 2 },
      { userId: "u1", name: "Sarah Jones", projectLabel: "24014 — Deptford", hours: 7.5, overtime: 0 },
      { userId: "u2", name: "Tom Reilly", projectLabel: "24009 — Woolwich", hours: 7.5, overtime: 0 },
    ],
    expected: [
      { userId: "u1", name: "Sarah Jones" },
      { userId: "u2", name: "Tom Reilly" },
      { userId: "u3", name: "James Okoro" }, // logged nothing
    ],
    statusByUser: { u1: "submitted", u2: "draft" }, // u3 missing
  });

  assert.deepEqual(model.people, [
    { userId: "u3", name: "James Okoro", hours: 0, overtime: 0, status: "Not started" },
    { userId: "u1", name: "Sarah Jones", hours: 15, overtime: 2, status: "Submitted" },
    { userId: "u2", name: "Tom Reilly", hours: 7.5, overtime: 0, status: "Draft" },
  ]);
  assert.deepEqual(model.byProject, [
    { label: "24009 — Woolwich", hours: 15 },
    { label: "24014 — Deptford", hours: 7.5 },
  ]);
  assert.deepEqual(model.totals, { hours: 22.5, overtime: 2 });
});
