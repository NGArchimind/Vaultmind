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
  // wording. Hits are ranked by proximity to the already-requested pages (the
  // general provisions twin in the same chapter as the relevant content wins)
  // and capped so the Gemini request can never balloon past its size limit.
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

    // Candidate headings: "General…" lines that look like headings.
    // Only sections NEAR the requested pages are relevant — documents like
    // AD Part B have a "General provisions" in every chapter, and pulling in
    // far-away chapters' sections bloats the Gemini payload with pages the
    // question never touches. Governing sections that matter sit in the same
    // chapter as the scored content (verified: ADM 3.36 case, distance 0).
    const MAX_DIST = 10;
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
      if (dist > MAX_DIST) continue;
      candidates.push({ page: l.page, title: l.text, dist });
    }

    // Nearest to already-requested pages first; each hit pulls in its page +
    // the next page (clause blocks roll over). Pages already requested are
    // free — only newly added pages count toward the cap.
    candidates.sort((a, b) => a.dist - b.dist);
    let added = 0;
    for (const c of candidates) {
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
