"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const {
  CATEGORIES, buildExtractionPrompt, parseFacts, findTitleMatch, planFact,
  buildMapContext, parseAskResponse, agreementToMapItem,
} = require("./projectMap");

const fact = (over = {}) => ({
  category: "decisions", title: "Ground floor walls", value: "Blockwork to ground floor.",
  quote: "blockwork at ground floor", stated_by: "JS", match: null, relation: "new", ...over,
});

test("categories are in the agreed order of importance", () => {
  assert.deepEqual(CATEGORIES.map((c) => c.id), [
    "decisions", "instructions", "approvals", "cost", "programme",
    "actions", "risks", "people", "site", "general",
  ]);
});

test("extraction prompt numbers existing items from 1 and fences the email as data", () => {
  const prompt = buildExtractionPrompt({
    email: { from: "Jo <jo@x.com>", date: "2026-06-04", subject: "Walls", body: "Use drylining." },
    items: [{ category: "decisions", title: "Ground floor walls", current_value: "Blockwork" }],
  });
  assert.match(prompt, /\[1\] \(decisions\) Ground floor walls — Blockwork/);
  assert.match(prompt, /---BEGIN EMAIL---[\s\S]*Use drylining\.[\s\S]*---END EMAIL---/);
});

test("parseFacts reads a fenced JSON reply and keeps valid facts", () => {
  const raw = "```json\n" + JSON.stringify([fact(), fact({ title: "Roof", value: "Slate", match: 1, relation: "same" })]) + "\n```";
  const out = parseFacts(raw, 3);
  assert.equal(out.length, 2);
  assert.equal(out[1].match, 1);
  assert.equal(out[1].relation, "same");
});

test("parseFacts drops facts with no title or value and unknown categories fall to general", () => {
  const out = parseFacts(JSON.stringify([
    fact({ title: "" }), fact({ value: "  " }), fact({ category: "nonsense" }), "junk", null,
  ]), 0);
  assert.equal(out.length, 1);
  assert.equal(out[0].category, "general");
});

test("parseFacts ignores a match number outside the item list and treats the fact as new", () => {
  const out = parseFacts(JSON.stringify([fact({ match: 9, relation: "change" }), fact({ match: "2", relation: "same" })]), 3);
  assert.deepEqual(out.map((f) => [f.match, f.relation]), [[null, "new"], [null, "new"]]);
});

test("parseFacts treats a matched fact labelled new as a change", () => {
  const out = parseFacts(JSON.stringify([fact({ match: 2, relation: "new" })]), 3);
  assert.equal(out[0].relation, "change");
});

test("parseFacts throws when the reply is not JSON so the email can be retried", () => {
  assert.throws(() => parseFacts("Sorry, I cannot help with that.", 0));
  assert.throws(() => parseFacts('{"not":"a list"}', 0));
});

test("an empty list is a valid reply for an email with nothing of substance", () => {
  assert.deepEqual(parseFacts("[]", 5), []);
});

test("findTitleMatch catches the same title in the same category, ignoring case and spacing", () => {
  const items = [
    { category: "cost", title: "Ground floor walls" },
    { category: "decisions", title: "Ground  Floor Walls." },
  ];
  assert.equal(findTitleMatch(fact({ title: "ground floor walls" }), items), 1);
  assert.equal(findTitleMatch(fact({ title: "Roof" }), items), -1);
});

test("planFact: a new topic is created", () => {
  assert.equal(planFact(fact(), null, "2026-03-12"), "create");
});

test("planFact: restating the current value is a supporting source, even if labelled a change", () => {
  const item = { category: "decisions", current_value: "Blockwork to ground floor", current_date: "2026-03-12" };
  assert.equal(planFact(fact({ relation: "same" }), item, "2026-04-01"), "support");
  assert.equal(planFact(fact({ relation: "change", value: "blockwork to  ground floor." }), item, "2026-04-01"), "support");
});

test("planFact: a later change in a sign-off category waits for the admin", () => {
  const item = { category: "decisions", current_value: "Blockwork", current_date: "2026-03-12" };
  assert.equal(planFact(fact({ relation: "change", value: "Drylining" }), item, "2026-06-04"), "pending");
});

test("planFact: a change in a non-sign-off category applies straight away", () => {
  const item = { category: "actions", current_value: "Engineer to issue calcs", current_date: "2026-03-12" };
  assert.equal(planFact(fact({ relation: "change", value: "Calcs issued" }), item, "2026-06-04"), "apply");
});

test("planFact: a differing value from an OLDER source is history only, never pending", () => {
  const item = { category: "decisions", current_value: "Drylining", current_date: "2026-06-04" };
  assert.equal(planFact(fact({ relation: "change", value: "Blockwork" }), item, "2026-03-12"), "historic");
});

test("planFact: with no dates to compare, a change is treated as newer", () => {
  const item = { category: "decisions", current_value: "Blockwork", current_date: null };
  assert.equal(planFact(fact({ relation: "change", value: "Drylining" }), item, null), "pending");
});

test("buildMapContext flags unconfirmed items and spells out pending changes", () => {
  const { text, included } = buildMapContext([
    { category: "decisions", title: "Ground floor walls", current_value: "Blockwork", status: "confirmed", current_date: "2026-03-12",
      pending: [{ value: "Drylining", entry_date: "2026-06-04", stated_by: "JS" }] },
    { category: "cost", title: "SE fee", current_value: "£4,500", status: "unconfirmed", current_date: null, pending: [] },
  ]);
  assert.equal(included, 2);
  assert.match(text, /\[1\] \(Decisions & agreements\) Ground floor walls: Blockwork \(as of 2026-03-12\) \| PENDING CHANGE awaiting sign-off: "Drylining" raised 2026-06-04 by JS/);
  assert.match(text, /\[2\] \(Cost & fees\) SE fee: £4,500 \[unconfirmed\]/);
});

test("parseAskResponse keeps only valid item numbers and needs both an answer and items to count as found", () => {
  assert.deepEqual(parseAskResponse('{"found":true,"answer":"Blockwork.","items":[1,1,7,"2"]}', 3),
    { found: true, answer: "Blockwork.", items: [1] });
  assert.equal(parseAskResponse('{"found":true,"answer":"Blockwork.","items":[]}', 3).found, false);
  assert.equal(parseAskResponse('{"found":false,"answer":"Not in the map.","items":[]}', 3).found, false);
  assert.equal(parseAskResponse("not json", 3).found, false);
});

test("agreementToMapItem carries the history across with the newest entry current", () => {
  const { item, entries } = agreementToMapItem({
    id: "a1", current_text: "Oak veneer door frames", date_agreed: "2026-05-14", confirmed_by: "Client",
    source_type: "minutes", source_label: "DTM 4",
    project_agreement_entries: [
      { text: "Oak veneer door frames", date_agreed: "2026-05-14", confirmed_by: "Client", source_type: "minutes", source_label: "DTM 4", created_at: "2026-05-14T10:00:00Z" },
      { text: "Painted softwood door frames", date_agreed: "2026-04-02", confirmed_by: "", source_type: "email", source_id: "e9", source_label: "", created_at: "2026-04-02T10:00:00Z" },
    ],
  }, "Door frames");
  assert.deepEqual(item, { category: "decisions", title: "Door frames", current_value: "Oak veneer door frames", status: "confirmed", legacy_agreement_id: "a1" });
  assert.deepEqual(entries.map((e) => [e.value, e.state, e.source_type, e.source_id]), [
    ["Painted softwood door frames", "superseded", "email", "e9"],
    ["Oak veneer door frames", "current", "agreement", null],
  ]);
});

test("agreementToMapItem falls back to the opening words when no title is supplied", () => {
  const { item, entries } = agreementToMapItem({ id: "a2", current_text: "Door frames to be oak veneer throughout the ground floor.", date_agreed: "2026-05-14", source_type: "manual" }, "");
  assert.equal(item.title, "Door frames to be oak veneer throughout");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].state, "current");
});
