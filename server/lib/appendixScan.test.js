const { test } = require("node:test");
const assert = require("node:assert");
const { findAppendixDefinitionPages } = require("./appendixScan");

// Helpers to build the { page, text, size, bold } line records the worker collects.
const heading = (page, text) => ({ page, text, size: 14, bold: true });
const body = (page, text) => ({ page, text, size: 10, bold: false });

test("finds an 'Appendix A: Key terms' heading and returns its pages up to the next major heading", () => {
  // Mirrors AD Part K: definitions on pages 61-64, then an Index on page 65.
  const lines = [
    heading(61, "Appendix A: Key terms"),
    body(61, "The following are key terms used in this document:"),
    body(61, "Accessible entrance"),
    body(62, "Barrier"),
    body(63, "Going"),
    body(64, "Pitch"),
    heading(65, "Index"),
    body(65, "Impact, protection from"),
  ];
  const result = findAppendixDefinitionPages({ lines, bodySize: 10, totalPages: 68 });
  assert.deepStrictEqual(result.pages, [61, 62, 63, 64]);
  assert.deepStrictEqual(result.sections, [{ page: 61, title: "Appendix A: Key terms" }]);
});

test("ignores the Contents-page listing and picks the real appendix later in the body", () => {
  // AD Part K lists "Appendix A: Key terms" on its Contents page (p9) AND has the
  // real glossary at p61. The contents entry must not win.
  const lines = [
    heading(8, "Contents"),
    heading(9, "Appendix A: Key terms"), // table-of-contents listing — looks heading-like
    body(9, "51"),
    heading(61, "Appendix A: Key terms"), // the real glossary
    body(61, "The following are key terms used in this document:"),
    body(62, "Barrier"),
    body(63, "Going"),
    body(64, "Pitch"),
    heading(65, "Index"),
  ];
  const result = findAppendixDefinitionPages({ lines, bodySize: 10, totalPages: 68 });
  assert.deepStrictEqual(result.pages, [61, 62, 63, 64]);
  assert.deepStrictEqual(result.sections, [{ page: 61, title: "Appendix A: Key terms" }]);
});

test("the appendix's own running header does not end its page range", () => {
  // AD Part K prints "Appendix A" as a running header on every glossary page.
  // That repeat must not be treated as the next section.
  const lines = [
    heading(61, "Appendix A: Key terms"),
    body(61, "The following are key terms used in this document:"),
    heading(62, "Appendix A"), // running header
    body(62, "Barrier"),
    heading(63, "Appendix A"), // running header
    body(63, "Going"),
    heading(64, "Appendix A"), // running header
    body(64, "Pitch"),
    heading(65, "Index"),
  ];
  const result = findAppendixDefinitionPages({ lines, bodySize: 10, totalPages: 68 });
  assert.deepStrictEqual(result.pages, [61, 62, 63, 64]);
});

test("a different appendix DOES end the range", () => {
  const lines = [
    heading(20, "Appendix A: Definitions"),
    body(20, "term"),
    body(21, "meaning"),
    heading(22, "Appendix B: Calculation method"),
    body(22, "formula"),
  ];
  const result = findAppendixDefinitionPages({ lines, bodySize: 10, totalPages: 40 });
  assert.deepStrictEqual(result.pages, [20, 21]);
});

test("ignores a back-of-book 'Index' heading (not a definitions appendix)", () => {
  const lines = [
    heading(65, "Index"),
    body(65, "Impact, protection from"),
    body(66, "Landings"),
  ];
  const result = findAppendixDefinitionPages({ lines, bodySize: 10, totalPages: 68 });
  assert.deepStrictEqual(result.pages, []);
  assert.deepStrictEqual(result.sections, []);
});

test("ignores a glossary word that appears in body text (not typographically a heading)", () => {
  const lines = [
    body(12, "Appendix A contains key terms and definitions used throughout."),
    body(13, "See the glossary for an explanation of interpretation."),
  ];
  const result = findAppendixDefinitionPages({ lines, bodySize: 10, totalPages: 40 });
  assert.deepStrictEqual(result.pages, []);
  assert.deepStrictEqual(result.sections, []);
});

test("matches Definitions / Glossary / Interpretation variants", () => {
  for (const title of ["Appendix B: Definitions", "Appendix C — Glossary", "Appendix: Interpretation"]) {
    const lines = [heading(20, title), body(20, "term"), body(21, "meaning")];
    const result = findAppendixDefinitionPages({ lines, bodySize: 10, totalPages: 30 });
    assert.deepStrictEqual(result.pages, [20, 21], `failed for: ${title}`);
    assert.strictEqual(result.sections[0].title, title);
  }
});

test("caps a very long glossary at the page cap", () => {
  const lines = [heading(10, "Appendix A: Definitions")];
  for (let p = 10; p <= 30; p++) lines.push(body(p, "term " + p));
  const result = findAppendixDefinitionPages({ lines, bodySize: 10, totalPages: 40, cap: 8 });
  assert.strictEqual(result.pages.length, 8);
  assert.deepStrictEqual(result.pages, [10, 11, 12, 13, 14, 15, 16, 17]);
});

test("returns empty when there is no appendix-definitions heading", () => {
  const lines = [heading(3, "Section 1: The requirement"), body(3, "1.1 Stairs must...")];
  const result = findAppendixDefinitionPages({ lines, bodySize: 10, totalPages: 50 });
  assert.deepStrictEqual(result.pages, []);
  assert.deepStrictEqual(result.sections, []);
});

test("never returns a page beyond totalPages", () => {
  const lines = [heading(48, "Appendix A: Key terms")];
  for (let p = 48; p <= 60; p++) lines.push(body(p, "term"));
  const result = findAppendixDefinitionPages({ lines, bodySize: 10, totalPages: 50, cap: 8 });
  assert.ok(result.pages.every(p => p <= 50), "all pages within bounds");
  assert.deepStrictEqual(result.pages, [48, 49, 50]);
});
