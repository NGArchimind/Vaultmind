const { workerData, parentPort } = require("worker_threads");

async function run() {
  const { pdfBuffer, pageList, scanGeneral } = workerData;
  const mupdf = await import("mupdf");
  const srcDoc = new mupdf.PDFDocument(pdfBuffer);
  const totalPages = srcDoc.countPages();

  // Scan the live document text for "General …" heading lines (e.g. "General
  // provisions", "1.1 General") so governing sections are always extracted —
  // the stored vault index collapses duplicate titles and cannot be trusted to
  // list every occurrence. A heading-like line starts with an optional clause
  // number then "General", is short, and does not end in a digit (which would
  // be a table-of-contents line). Each hit pulls in its page + the next page.
  const generalSections = [];
  const generalPages = new Set();
  if (scanGeneral) {
    const headingRe = /^(?:\d+(?:\.\d+)*\s+)?(?:General|GENERAL)\b[^\r\n]{0,40}(?<![\d.])$/;
    for (let i = 0; i < totalPages && generalSections.length < 12; i++) {
      let text = "";
      try {
        text = srcDoc.loadPage(i).toStructuredText("preserve-whitespace").asText();
      } catch (_) { continue; }
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (headingRe.test(trimmed)) {
          generalSections.push({ page: i + 1, title: trimmed });
          generalPages.add(i + 1);
          if (i + 2 <= totalPages) generalPages.add(i + 2);
          break; // one hit marks the page — no need to scan further lines
        }
      }
    }
  }

  const validPages = pageList.filter(p => p <= totalPages);
  if (validPages.length === 0 && generalPages.size === 0) {
    parentPort.postMessage({ error: "no-valid-pages" });
    return;
  }
  const mergedPages = [...new Set([...validPages, ...generalPages])].sort((a, b) => a - b);
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
