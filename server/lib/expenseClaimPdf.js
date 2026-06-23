const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const A4 = [595.28, 841.89];
const MARGIN = 48;
const INK  = rgb(0.15, 0.16, 0.19);
const GREY = rgb(0.42, 0.54, 0.60);

const TYPE_LABELS = { train: "Train", mileage: "Car Mileage", meals: "Meals", taxi: "Taxi", parking: "Parking" };

function poundStr(pence) { return `£${((pence || 0) / 100).toFixed(2)}`; }
function trunc(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function drawRight(page, text, xRight, y, size, font, color) {
  page.drawText(text, { x: xRight - font.widthOfTextAtSize(text, size), y, size, font, color });
}
function labelFor(it) {
  const proj = it.projects?.job_number ? `${it.projects.job_number} — ${it.projects.name}` : (it.projects?.name || "");
  return `Receipt — ${TYPE_LABELS[it.expense_type] || it.expense_type} · ${proj} · ${poundStr(it.amount_pence)}`;
}

function placeImage(pdf, font, img, label) {
  const page = pdf.addPage(A4);
  const W = page.getWidth(), H = page.getHeight();
  page.drawText(trunc(label, 95), { x: MARGIN, y: H - 40, size: 9, font, color: GREY });
  const maxW = W - MARGIN * 2;
  const maxH = H - 100;
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);
  const w = img.width * scale, h = img.height * scale;
  page.drawImage(img, { x: (W - w) / 2, y: H - 70 - h, width: w, height: h });
}

// Build a one-PDF summary of a claim with each embeddable receipt on its own page.
// Returns { pdfBytes, unembeddable: [{ key, filename, bytes, contentType }] }.
// HEIC/WEBP (and any receipt pdf-lib can't embed) are returned in `unembeddable`
// so the caller can attach them to the email separately.
async function buildClaimPdf({ claim, items, submitterEmail, fetchReceipt }) {
  items = items || [];
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const unembeddable = [];

  const page = pdf.addPage(A4);
  const W = page.getWidth(), H = page.getHeight();
  let y = H - 56;

  page.drawText("Expense Claim", { x: MARGIN, y, size: 20, font: bold, color: INK }); y -= 26;
  page.drawText(`Submitted by: ${submitterEmail || "—"}`, { x: MARGIN, y, size: 11, font, color: INK }); y -= 15;
  const subStr = claim?.submitted_at ? new Date(claim.submitted_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";
  page.drawText(`Submitted: ${subStr}`, { x: MARGIN, y, size: 11, font, color: INK }); y -= 15;
  page.drawText(`Claim ref: ${claim?.id || "—"}`, { x: MARGIN, y, size: 8, font, color: GREY }); y -= 26;

  const colDate = MARGIN, colType = MARGIN + 70, colProj = MARGIN + 145, colDesc = MARGIN + 290, amountRight = W - MARGIN;
  page.drawText("Date", { x: colDate, y, size: 9, font: bold, color: GREY });
  page.drawText("Type", { x: colType, y, size: 9, font: bold, color: GREY });
  page.drawText("Project", { x: colProj, y, size: 9, font: bold, color: GREY });
  page.drawText("Description", { x: colDesc, y, size: 9, font: bold, color: GREY });
  drawRight(page, "Amount", amountRight, y, 9, bold, GREY);
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: W - MARGIN, y }, thickness: 0.5, color: GREY }); y -= 14;

  let total = 0;
  for (const it of items) {
    total += it.amount_pence || 0;
    const projStr = it.projects?.job_number ? `${it.projects.job_number} — ${it.projects.name}` : (it.projects?.name || "—");
    const amtStr = it.expense_type === "mileage" ? `${poundStr(it.amount_pence)} (${it.miles}mi)` : poundStr(it.amount_pence);
    page.drawText(trunc(it.expense_date, 11), { x: colDate, y, size: 9, font, color: INK });
    page.drawText(trunc(TYPE_LABELS[it.expense_type] || it.expense_type, 13), { x: colType, y, size: 9, font, color: INK });
    page.drawText(trunc(projStr, 26), { x: colProj, y, size: 9, font, color: INK });
    page.drawText(trunc(it.description, 28), { x: colDesc, y, size: 9, font, color: INK });
    drawRight(page, amtStr, amountRight, y, 9, font, INK);
    y -= 14;
    if (y < 70) y = 70; // realistic claims fit on one page; avoid drawing off-page
  }
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: W - MARGIN, y }, thickness: 0.5, color: GREY }); y -= 16;
  page.drawText("Total", { x: colProj, y, size: 12, font: bold, color: INK });
  drawRight(page, poundStr(total), amountRight, y, 12, bold, INK);

  for (const it of items) {
    if (!it.receipt_key) continue;
    let r = null;
    try { r = await fetchReceipt(it.receipt_key); } catch { r = null; }
    if (!r || !r.bytes) continue;
    const ct = (r.contentType || "").toLowerCase();
    const filename = it.receipt_key.split("/").pop();
    try {
      if (ct.includes("pdf")) {
        const src = await PDFDocument.load(r.bytes);
        const pages = await pdf.copyPages(src, src.getPageIndices());
        pages.forEach(p => pdf.addPage(p));
      } else if (ct.includes("png")) {
        placeImage(pdf, font, await pdf.embedPng(r.bytes), labelFor(it));
      } else if (ct.includes("jpg") || ct.includes("jpeg")) {
        placeImage(pdf, font, await pdf.embedJpg(r.bytes), labelFor(it));
      } else {
        unembeddable.push({ key: it.receipt_key, filename, bytes: r.bytes, contentType: r.contentType });
      }
    } catch {
      unembeddable.push({ key: it.receipt_key, filename, bytes: r.bytes, contentType: r.contentType });
    }
  }

  const pdfBytes = await pdf.save();
  return { pdfBytes, unembeddable };
}

module.exports = { buildClaimPdf };
