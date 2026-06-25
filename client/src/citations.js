import { api } from "./api/client";

export const findPageInVaultIndex = (fileName, headingText, lastAnswerIndex) => {
    if (!lastAnswerIndex?.documents || !headingText) return null;
    const stripPdf = s => (s || "").replace(/\.pdf$/i, "").trim();
    const indexDoc = lastAnswerIndex.documents.find(d => {
      const dn = stripPdf(d.name).toLowerCase();
      const fn = stripPdf(fileName).toLowerCase();
      return dn === fn || dn.includes(fn) || fn.includes(dn);
    });
    if (!indexDoc?.headings?.length) return null;

    // Type-aware candidate set: a citation for "Diagram 3.1" must only match
    // index headings that are themselves a Diagram/Table/Figure — never plain
    // section "3.1", which starts on a different page. Citations without a
    // type word skip diagram/table/figure headings for the same reason.
    // diagram/figure/fig are treated as one type (documents vary in naming).
    const typeOf = (s, anchored) => {
      const m = (s || "").match(anchored ? /^\s*(diagram|table|figure|fig)\b/i : /\b(diagram|table|figure|fig)\b/i);
      if (!m) return null;
      const t = m[1].toLowerCase();
      return t === "table" ? "table" : "figure";
    };
    const citType = typeOf(headingText, false);
    const candidates = indexDoc.headings.filter(h => typeOf(h.title, true) === citType);
    if (!candidates.length) return null;

    // Level 1: exact case-insensitive match
    const target = headingText.toLowerCase().trim();
    let h = candidates.find(h => h.title.toLowerCase().trim() === target);
    if (h?.pageHint) return h.pageHint;

    // Level 2: normalised match — keep dots (preserves "5.3"), strip other special chars
    const norm = s => s.toLowerCase().replace(/[^a-z0-9.\s]/g, " ").replace(/\s+/g, " ").trim();
    const nt = norm(headingText);
    h = candidates.find(h => norm(h.title) === nt);
    if (h?.pageHint) return h.pageHint;

    // Level 3: clause number prefix match — "5.3", "B3", "K2", "AD-B3" etc.
    const cnMatch = headingText.match(/\b([A-Z]?\d[\d.]*[A-Za-z]?)\b/i);
    if (cnMatch) {
      const cn = cnMatch[1].toLowerCase();
      h = candidates.find(h => {
        const m = h.title.match(/\b([A-Z]?\d[\d.]*[A-Za-z]?)\b/i);
        return m && m[1].toLowerCase() === cn;
      });
      if (h?.pageHint) return h.pageHint;
    }

    // Level 4: all significant words (>3 chars) appear in the vault heading
    const sigWords = s => s.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(w => w.length > 3);
    const tw = sigWords(headingText);
    if (tw.length >= 2) {
      h = candidates.find(h => {
        const hw = sigWords(h.title);
        return tw.every(w => hw.includes(w));
      });
      if (h?.pageHint) return h.pageHint;
    }

    return null;
  };

  // ── Find the exact page of a numbered clause by searching the document text ───
  // Paragraph numbers (3.36, 5.3.7, B1) are unique within a document, unlike
  // headings — Approved Documents repeat near-identical headings across chapters
  // (e.g. "Sanitary facilities — General provisions" in both M4(2) and M4(3)).
  // Searching the real text for the line that starts with the clause number gives
  // the definitive page. Text is fetched once per document and cached.
  export const findPageByClauseNumber = async (base64, fileName, headingText, docTextCacheRef) => {
    if (!headingText) return null;
    // Skip diagram/table/figure citations — the type-aware index lookup handles those
    if (/\b(diagram|table|figure|fig)\b/i.test(headingText)) return null;
    // Clause number must be dotted (3.36, 5.3.7) or letter+digits (B1, K2) —
    // bare integers like "2" are too ambiguous to search for, and category
    // references like "M4(2)" are excluded (the bracket is part of the name)
    const cnMatch = headingText.match(/\b(\d+(?:\.\d+)+|[A-Z]\d+(?!\())\b/);
    if (!cnMatch) return null;
    const clause = cnMatch[1];

    let pages = docTextCacheRef.current[fileName];
    if (!pages) {
      const { text, hasText } = await api("/api/extract-text", { method: "POST", body: { base64 } });
      if (!hasText || !text) return null;
      pages = text.split(/(?=\[Page \d+\])/).map(chunk => {
        const m = chunk.match(/^\[Page (\d+)\]/);
        return m ? { page: Number(m[1]), text: chunk } : null;
      }).filter(Boolean);
      docTextCacheRef.current[fileName] = pages;
    }

    // Line-anchored match: the clause number at the start of a line, not followed
    // by further digits or dots (so "3.3" never matches "3.36" or "3.3.1")
    const escaped = clause.replace(/\./g, "\\.");
    const clauseRe = new RegExp(`(^|\\n)\\s*${escaped}(?![\\d.])`);

    // A clause number can appear at a line start on several pages. The first one is
    // often a reference/contents table that LISTS the clause rather than the page
    // that DEFINES it — e.g. NHBC chapters open with a "Figure Reference Table" that
    // packs dozens of clause numbers (one per line) onto a single page, which sits
    // before the real clause. mupdf linearises that table cell-by-cell, so every
    // clause number lands at a line start there. The real clause page is sparse, so
    // among the matching pages pick the one with the FEWEST clause-style numbers.
    // Ties keep the earliest page (the original "first match" behaviour). This leaves
    // Approved Documents unchanged — they have no such dense tables (density 0).
    const clauseToken = /\d+(?:\.\d+){2,}/g;
    const matches = pages.filter(p => clauseRe.test(p.text));
    if (matches.length === 0) return null;
    let best = matches[0];
    let bestDensity = (best.text.match(clauseToken) || []).length;
    for (const p of matches.slice(1)) {
      const density = (p.text.match(clauseToken) || []).length;
      if (density < bestDensity) { best = p; bestDensity = density; }
    }
    return best.page;
  };
