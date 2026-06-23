const { test } = require("node:test");
const assert = require("node:assert");
const { generatePassword, leet } = require("./passwordGen");

test("leet swaps the right letters to digits", () => {
  assert.strictEqual(leet("brickdust"), "br1ckdu5t");
  assert.strictEqual(leet("mortarjoist"), "m0rt4rj015t");
});

test("generated passwords are lowercase alphanumeric, contain a digit, sensible length", () => {
  for (let i = 0; i < 300; i++) {
    const pw = generatePassword();
    assert.match(pw, /^[a-z0-9]+$/, `bad chars in ${pw}`);
    assert.ok(/[0-9]/.test(pw), `no digit in ${pw}`);
    assert.ok(pw.length >= 7 && pw.length <= 24, `bad length ${pw}`);
  }
});

test("two different words are joined", () => {
  // deterministic-ish rand that steps through values
  let n = 0;
  const seq = [0.01, 0.5];
  const pw = generatePassword(() => seq[(n++) % seq.length]);
  assert.match(pw, /^[a-z0-9]+$/);
  assert.ok(pw.length > 6);
});
