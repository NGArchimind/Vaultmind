"use strict";

// Finds a definitions/glossary appendix in a document's live text so its pages can
// be force-included in QA page extraction — the stored vault index never captures
// individual defined terms (they read as body text), so definitions are otherwise
// invisible to the pipeline. Mirrors the "General provisions" scan in the worker:
// a line only counts as a heading if it LOOKS like one typographically (bold, or
// noticeably larger than body text), which rejects body sentences that merely
// mention "definitions"/"glossary".

// A definitions appendix heading, e.g. "Appendix A: Key terms", "Appendix B —
// Definitions", "Glossary". A bare glossary word is allowed so documents whose
// section is titled just "Definitions"/"Glossary" are still caught.
const DEFINITION_HEADING_RE =
  /^(?:appendix|annex)\b[^\r\n]*\b(?:key terms?|definitions?|glossary|interpretation)\b|^(?:key terms?|definitions?|glossary|interpretation)\b/i;

// Major structural headings that bound an appendix (the next one ends the current
// section's page range): another appendix/annex, or a back-of-book index.
const MAJOR_HEADING_RE = /^(?:appendix|annex|index)\b/i;

const DEFAULT_CAP = 8;

// lines: [{ page, text, size, bold }] — every text line with font info, as the
//   extract-pages worker already collects for the General provisions scan.
// bodySize: most common line size in the document (its body-text size).
// Returns { pages: number[], sections: [{ page, title }] }.
function findAppendixDefinitionPages({ lines, bodySize, totalPages, cap = DEFAULT_CAP }) {
  if (!Array.isArray(lines) || lines.length === 0) return { pages: [], sections: [] };

  const looksLikeHeading = (l) => l.bold || (l.size || 0) >= bodySize * 1.2;

  // The LAST definitions heading wins. A document's Contents page lists the
  // glossary too (e.g. "Appendix A: Key terms" with a page number), and that
  // listing looks heading-like — but it always precedes the real appendix in the
  // body, so the later occurrence is the genuine one.
  const defHeading = lines
    .filter((l) => looksLikeHeading(l) && DEFINITION_HEADING_RE.test((l.text || "").trim()))
    .sort((a, b) => a.page - b.page)
    .pop();
  if (!defHeading) return { pages: [], sections: [] };

  const startPage = defHeading.page;

  // Identity of a section heading, e.g. "Appendix A: Key terms" -> "appendix a",
  // "Index" -> "index". Used so the appendix's own running header (which repeats
  // "Appendix A" at the top of each glossary page) is NOT mistaken for the next
  // section — only a DIFFERENT identity ("Appendix B", "Index") ends the range.
  const sectionId = (text) => {
    const m = (text || "").trim().match(/^(appendix|annex|index)\b\s*([a-z0-9]+)?/i);
    if (!m) return null;
    return (m[1] + (m[2] ? " " + m[2] : "")).toLowerCase();
  };
  const currentId = sectionId(defHeading.text);

  // The appendix ends just before the next major heading of a different section.
  const nextMajor = lines
    .filter((l) => l.page > startPage && looksLikeHeading(l) && MAJOR_HEADING_RE.test((l.text || "").trim()))
    .filter((l) => sectionId(l.text) !== currentId)
    .sort((a, b) => a.page - b.page)[0];
  const boundaryPage = nextMajor ? nextMajor.page - 1 : Infinity;

  // Don't run past the last page that actually has text.
  const maxContentPage = lines.reduce((m, l) => (l.page > m ? l.page : m), 0);

  const endPage = Math.min(startPage + cap - 1, totalPages, boundaryPage, maxContentPage);

  const pages = [];
  for (let p = startPage; p <= endPage; p++) pages.push(p);

  return { pages, sections: [{ page: startPage, title: (defHeading.text || "").trim() }] };
}

module.exports = { findAppendixDefinitionPages, DEFINITION_HEADING_RE, MAJOR_HEADING_RE };
