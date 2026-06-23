const { test } = require("node:test");
const assert = require("node:assert");
const { recentProjectIds } = require("./recentProjects");

test("returns distinct project ids in row order, newest first", () => {
  const rows = [
    { project_id: "a" }, { project_id: "b" }, { project_id: "a" }, { project_id: "c" },
  ];
  assert.deepStrictEqual(recentProjectIds(rows, 8), ["a", "b", "c"]);
});

test("skips null/category rows", () => {
  const rows = [{ project_id: null }, { project_id: "a" }, { project_id: null }];
  assert.deepStrictEqual(recentProjectIds(rows, 8), ["a"]);
});

test("caps at limit", () => {
  const rows = [{ project_id: "a" }, { project_id: "b" }, { project_id: "c" }];
  assert.deepStrictEqual(recentProjectIds(rows, 2), ["a", "b"]);
});
