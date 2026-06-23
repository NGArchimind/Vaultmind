const { test } = require("node:test");
const assert = require("node:assert");
const { claimTotalPence, claimSummary } = require("./expenseClaims");

test("sums line item amounts", () => {
  assert.strictEqual(claimTotalPence([{ amount_pence: 4230 }, { amount_pence: 650 }]), 4880);
});

test("empty claim totals zero", () => {
  assert.strictEqual(claimTotalPence([]), 0);
  assert.strictEqual(claimTotalPence(null), 0);
});

test("summary returns count + total", () => {
  assert.deepStrictEqual(claimSummary([{ amount_pence: 100 }, { amount_pence: 200 }]),
    { count: 2, total_pence: 300 });
});
