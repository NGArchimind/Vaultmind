const { workerData, parentPort } = require("worker_threads");

async function run() {
  const { pdfBuffer, pageList, scanGeneral } = workerData;
  const mupdf = await import("mupdf");
  const srcDoc = new mupdf.PDFDocument(pdfBuffer);
  const totalPages = srcDoc.countPages();

  const validPages = pageList.filter(p => p <= totalPages);
  const pageSet = new Set(validPages);

  // ── General provisions scan ──────────────────────────────────────────────────
  // Finds "General …" section headings in the live document text so governing
  // sections are always extracted — the stored vault index collapses duplicate
  // titles (e.g. AD Part M's several "General provisions" sections) and cannot
  // be trusted to list every occurrence.
  //
  // A line only counts as a heading if it LOOKS like one typographically: bold,
  // or noticeably larger than the document's body text size. This rejects body
  // sentences ("General guidance is given in…") and table rows regardless of
  // wording. Hits are kept if they belong to the same CHAPTER as a requested
  // page (see chapter detection below) and capped so the Gemini request can
  // never balloon past its size limit.
  const generalSections = [];
  if (scanGeneral) {
    const GENERAL_PAGE_CAP = 12;
    const headingTextRe = /^(?:\d+(?:\.\d+)*\s+)?(?:General|GENERAL)\b[^\r\n]{0,40}(?<![\d.])$/;

    // Collect every text line with its font info; track size frequency
    const allLines = []; // { page, text, size, bold }
    const sizeFreq = {};
    for (let i = 0; i < totalPages; i++) {
      let json;
      try {
        json = JSON.parse(srcDoc.loadPage(i).toStructuredText("preserve-whitespace").asJSON());
      } catch (_) { continue; }
      for (const block of json.blocks || []) {
        for (const line of block.lines || []) {
          const text = (line.text || "").trim();
          if (!text) continue;
          const size = line.font?.size || 0;
          const bold = line.font?.weight === "bold" || /bold/i.test(line.font?.name || "");
          allLines.push({ page: i + 1, text, size, bold });
          const k = Math.round(size * 2) / 2;
          sizeFreq[k] = (sizeFreq[k] || 0) + 1;
        }
      }
    }

    // Body text size = the most common line size in the document
    let bodySize = 10, bestCount = 0;
    for (const [k, n] of Object.entries(sizeFreq)) {
      if (n > bestCount) { bestCount = n; bodySize = Number(k); }
    }

    // RELEVANCE RULE — same chapter, not nearby pages. Documents like AD Part B
    // and AD Part M have a "General provisions" per chapter/category; the one
    // that governs the question is the one in the same chapter as the requested
    // pages. Page distance was a proxy for this and failed both ways on long
    // chapters (ADM vol 1's M4(3) spans 38 pages — its General provisions sat
    // 19 pages from the requested content and was dropped, while neighbouring
    // chapters' sections leaked in).
    //
    // A page's chapter = the most common clause-number prefix printed on it
    // ("3.36" → chapter 3, "B1.2" → B1). Pages with no clause numbers inherit:
    // requested pages look BACK (content belongs to the chapter in progress),
    // heading pages look FORWARD (a General heading governs what follows it).
    const clauseRe = /^(\d+)\.\d+\b|^([A-Z]\d?)\.?\d+\b/;
    const chapterVotes = {}; // page -> { chapter: count }
    for (const l of allLines) {
      const m = l.text.match(clauseRe);
      if (!m) continue;
      const ch = m[1] || m[2];
      const votes = chapterVotes[l.page] || (chapterVotes[l.page] = {});
      votes[ch] = (votes[ch] || 0) + 1;
    }
    const ownChapter = {}; // page -> chapter from its own clause numbers
    for (const [p, votes] of Object.entries(chapterVotes)) {
      let best = null, n = 0;
      for (const [ch, c] of Object.entries(votes)) if (c > n) { best = ch; n = c; }
      ownChapter[p] = best;
    }
    const backChapter = {}, fwdChapter = {};
    let run = null;
    for (let p = 1; p <= totalPages; p++) {
      if (ownChapter[p]) run = ownChapter[p];
      backChapter[p] = run;
    }
    run = null;
    for (let p = totalPages; p >= 1; p--) {
      if (ownChapter[p]) run = ownChapter[p];
      fwdChapter[p] = run;
    }

    // Candidate headings: "General…" lines that look like headings.
    const candidates = [];
    const seenPages = new Set();
    for (const l of allLines) {
      if (!headingTextRe.test(l.text)) continue;
      if (!(l.bold || l.size >= bodySize * 1.2)) continue;
      if (seenPages.has(l.page)) continue; // one hit marks the page
      seenPages.add(l.page);
      const dist = validPages.length
        ? Math.min(...validPages.map(p => Math.abs(p - l.page)))
        : 0;
      candidates.push({ page: l.page, title: l.text, dist, chapter: ownChapter[l.page] || fwdChapter[l.page] });
    }

    // Keep candidates whose chapter matches a requested page's chapter.
    // SAFETY NET: a requested page whose chapter produced no General section
    // (chapter undetectable — e.g. a diagram-only page — or a numbering style
    // the regex doesn't know) falls back to the nearest PRECEDING General
    // heading, which in these documents is structurally always the governing
    // one. The fallback only adds, never removes — payload stays bounded by
    // the page cap below and the client's byte budget.
    const requestedChapters = new Set(validPages.map(p => backChapter[p]).filter(Boolean));
    const matched = candidates.filter(c => c.chapter && requestedChapters.has(c.chapter));
    const matchedChapters = new Set(matched.map(c => c.chapter));
    const fallback = new Set();
    for (const p of validPages) {
      const ch = backChapter[p];
      if (ch && matchedChapters.has(ch)) continue;
      let nearest = null;
      for (const c of candidates) {
        if (c.page <= p && (!nearest || c.page > nearest.page)) nearest = c;
      }
      if (nearest) fallback.add(nearest);
    }
    const keep = [...matched, ...[...fallback].filter(c => !matched.includes(c))];

    // Nearest to already-requested pages first; each hit pulls in its page +
    // the next page (clause blocks roll over). Pages already requested are
    // free — only newly added pages count toward the cap.
    keep.sort((a, b) => a.dist - b.dist);
    let added = 0;
    for (const c of keep) {
      const wanted = [c.page, c.page + 1].filter(p => p <= totalPages);
      const newPages = wanted.filter(p => !pageSet.has(p));
      if (newPages.length > 0 && added + newPages.length > GENERAL_PAGE_CAP) continue;
      newPages.forEach(p => { pageSet.add(p); added++; });
      generalSections.push({ page: c.page, title: c.title });
    }
    generalSections.sort((a, b) => a.page - b.page);
  }

  const mergedPages = [...pageSet].sort((a, b) => a - b);
  if (mergedPages.length === 0) {
    parentPort.postMessage({ error: "no-valid-pages" });
    return;
  }
  const outDoc = new mupdf.PDFDocument();
  for (const pageNum of mergedPages) {
    const graftMap = outDoc.newGraftMap();
    outDoc.graftPage(outDoc.countPages(), srcDoc, pageNum - 1, graftMap);
  }
  const rawBuffer = outDoc.saveToBuffer("compress");
  parentPort.postMessage({
    base64: Buffer.from(rawBuffer.asUint8Array()).toString("base64"),
    pagesExtracted: mergedPages.length,
    pageNumbers: mergedPages,
    generalSections,
  });
}

run().catch(err => parentPort.postMessage({ error: err.message }));
