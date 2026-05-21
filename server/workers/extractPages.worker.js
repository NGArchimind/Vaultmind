const { workerData, parentPort } = require("worker_threads");

async function run() {
  const { pdfBuffer, pageList } = workerData;
  const mupdf = await import("mupdf");
  const srcDoc = new mupdf.PDFDocument(pdfBuffer);
  const totalPages = srcDoc.countPages();
  const validPages = pageList.filter(p => p <= totalPages);
  if (validPages.length === 0) {
    parentPort.postMessage({ error: "no-valid-pages" });
    return;
  }
  const outDoc = new mupdf.PDFDocument();
  for (const pageNum of validPages) {
    const graftMap = outDoc.newGraftMap();
    outDoc.graftPage(outDoc.countPages(), srcDoc, pageNum - 1, graftMap);
  }
  const rawBuffer = outDoc.saveToBuffer("compress");
  parentPort.postMessage({
    base64: Buffer.from(rawBuffer.asUint8Array()).toString("base64"),
    pagesExtracted: validPages.length,
    pageNumbers: validPages,
  });
}

run().catch(err => parentPort.postMessage({ error: err.message }));
