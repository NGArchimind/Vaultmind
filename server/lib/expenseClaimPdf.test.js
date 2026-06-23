const { test } = require("node:test");
const assert = require("node:assert");
const { PDFDocument } = require("pdf-lib");
const { buildClaimPdf } = require("./expenseClaimPdf");

const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const isPdf = (bytes) => Buffer.from(bytes.slice(0, 5)).toString("latin1") === "%PDF-";

test("builds a summary PDF with no receipts", async () => {
  const { pdfBytes, unembeddable } = await buildClaimPdf({
    claim: { id: "c1", submitted_at: new Date().toISOString() },
    items: [{ expense_type: "train", expense_date: "2026-06-12", amount_pence: 4230, description: "Site visit", projects: { job_number: "2487", name: "Riverside" } }],
    submitterEmail: "jsmith@firm.co.uk",
    fetchReceipt: async () => null,
  });
  assert.ok(isPdf(pdfBytes));
  assert.deepStrictEqual(unembeddable, []);
});

test("embeds a PNG receipt on its own page", async () => {
  const { pdfBytes, unembeddable } = await buildClaimPdf({
    claim: { id: "c2" },
    items: [{ expense_type: "taxi", amount_pence: 1000, receipt_key: "x/y/r.png", projects: { name: "P" } }],
    submitterEmail: "a@b.c",
    fetchReceipt: async () => ({ bytes: PNG_1x1, contentType: "image/png" }),
  });
  const doc = await PDFDocument.load(pdfBytes);
  assert.ok(doc.getPageCount() >= 2);
  assert.strictEqual(unembeddable.length, 0);
});

test("HEIC receipts are collected as unembeddable", async () => {
  const { unembeddable } = await buildClaimPdf({
    claim: { id: "c3" },
    items: [{ expense_type: "meals", amount_pence: 800, receipt_key: "x/y/r.heic", projects: { name: "P" } }],
    submitterEmail: "a@b.c",
    fetchReceipt: async () => ({ bytes: Buffer.from("fake-heic-bytes"), contentType: "image/heic" }),
  });
  assert.strictEqual(unembeddable.length, 1);
  assert.strictEqual(unembeddable[0].filename, "r.heic");
});

test("merges a PDF receipt into the document", async () => {
  const small = await PDFDocument.create(); small.addPage([200, 200]);
  const smallBytes = await small.save();
  const { pdfBytes } = await buildClaimPdf({
    claim: { id: "c4" },
    items: [{ expense_type: "parking", amount_pence: 500, receipt_key: "x/y/r.pdf", projects: { name: "P" } }],
    submitterEmail: "a@b.c",
    fetchReceipt: async () => ({ bytes: smallBytes, contentType: "application/pdf" }),
  });
  const doc = await PDFDocument.load(pdfBytes);
  assert.ok(doc.getPageCount() >= 2);
});
