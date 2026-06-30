const { test } = require("node:test");
const assert = require("node:assert");
const { extrasMissingType } = require("./unpricedExtras");

test("flags a row marked as an unpriced extra with no extra-type chosen", () => {
  const entries = [
    { id: "1", unpriced_extra: true, extra_type_id: null },
  ];
  assert.deepStrictEqual(extrasMissingType(entries), [entries[0]]);
});

test("a marked extra WITH a type is fine", () => {
  const entries = [
    { id: "1", unpriced_extra: true, extra_type_id: "abc" },
  ];
  assert.deepStrictEqual(extrasMissingType(entries), []);
});

test("a normal (un-ticked) row with no type is fine", () => {
  const entries = [
    { id: "1", unpriced_extra: false, extra_type_id: null },
  ];
  assert.deepStrictEqual(extrasMissingType(entries), []);
});

test("returns only the offending rows from a mixed week", () => {
  const entries = [
    { id: "1", unpriced_extra: false, extra_type_id: null },   // normal — ok
    { id: "2", unpriced_extra: true,  extra_type_id: "t1" },   // extra w/ type — ok
    { id: "3", unpriced_extra: true,  extra_type_id: null },   // extra, no type — flagged
    { id: "4", unpriced_extra: true,  extra_type_id: "" },     // extra, blank type — flagged
  ];
  assert.deepStrictEqual(extrasMissingType(entries), [entries[2], entries[3]]);
});

test("treats undefined unpriced_extra / extra_type_id as not-an-extra", () => {
  const entries = [{ id: "1" }];
  assert.deepStrictEqual(extrasMissingType(entries), []);
});

test("handles empty / nullish input", () => {
  assert.deepStrictEqual(extrasMissingType([]), []);
  assert.deepStrictEqual(extrasMissingType(null), []);
  assert.deepStrictEqual(extrasMissingType(undefined), []);
});
