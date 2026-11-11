const { test } = require("node:test");
const assert = require("node:assert");
const { generatePassword, capitalisablePositions, WORDS } = require("./passwordGen");

test("word list is large, unique, and 5–9 lowercase letters", () => {
  assert.ok(WORDS.length >= 180, `only ${WORDS.length} words`);
  assert.strictEqual(new Set(WORDS).size, WORDS.length);
  for (const w of WORDS) assert.match(w, /^[a-z]{5,9}$/, `bad word ${w}`);
});

test("format: one word, exactly one capital, then a 2-digit number 10–99", () => {
  for (let i = 0; i < 2000; i++) {
    const pw = generatePassword();
    const m = pw.match(/^([A-Za-z]{5,9})([1-9][0-9])$/);
    assert.ok(m, `bad format ${pw}`);
    const letters = m[1];
    assert.strictEqual((letters.match(/[A-Z]/g) || []).length, 1, `capitals in ${pw}`);
    assert.ok(WORDS.includes(letters.toLowerCase()), `not a list word: ${pw}`);
    assert.ok(!letters.includes("I"), `capital I in ${pw}`);
    assert.ok(pw.length >= 7 && pw.length <= 11, `bad length ${pw}`);
  }
});

test("capital lands in different positions, not always the front", () => {
  const positions = new Set();
  for (let i = 0; i < 2000; i++) {
    const pw = generatePassword();
    positions.add(pw.search(/[A-Z]/));
  }
  assert.ok(positions.size >= 5, `capital only seen at ${[...positions]}`);
});

test("capitalisablePositions never includes an 'i'", () => {
  assert.deepStrictEqual(capitalisablePositions("brick"), [0, 1, 3, 4]);
  assert.deepStrictEqual(capitalisablePositions("mortar"), [0, 1, 2, 3, 4, 5]);
});

test("deterministic rand gives a predictable result", () => {
  // rand always 0 → first word, first capitalisable letter, number 10
  const pw = generatePassword(() => 0);
  assert.strictEqual(pw, WORDS[0][0].toUpperCase() + WORDS[0].slice(1) + "10");
});
