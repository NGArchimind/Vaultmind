"use strict";
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");

function fmt(n) { return (Math.round((Number(n) || 0) * 10) / 10).toFixed(1); }

function renderReportPdf(model, weekLabel) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = 40;
    doc.rect(0, 0, doc.page.width, 54).fill("#4c6278");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(15).text("Archimind — Weekly Timesheet Report", left, 18);
    doc.fillColor("#6a8a9a").font("Helvetica").fontSize(10).text(`Week ${weekLabel} · all staff`, left, 64);

    let y = 92;
    const pageBreak = () => { if (y > doc.page.height - 60) { doc.addPage(); y = 50; } };

    const personCols = [220, 90, 90, 95];
    const drawPerson = (cells, opts = {}) => {
      const w = personCols.reduce((a, b) => a + b, 0);
      if (opts.bg) doc.rect(left, y - 2, w, 16).fill(opts.bg);
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor("#262830");
      let x = left;
      cells.forEach((c, i) => {
        doc.fillColor("#262830").text(String(c), x + 4, y, { width: personCols[i] - 8, align: i === 0 || i === 3 ? "left" : "right" });
        x += personCols[i];
      });
      y += 16; pageBreak();
    };

    doc.font("Helvetica-Bold").fontSize(10).fillColor("#33414d").text("By person", left, y); y += 16;
    drawPerson(["Staff", "Hours", "Overtime", "Status"], { bold: true, bg: "#f1f4f6" });
    for (const p of model.people) drawPerson([p.name, fmt(p.hours), fmt(p.overtime), p.status]);
    drawPerson(["Total", fmt(model.totals.hours), fmt(model.totals.overtime), ""], { bold: true, bg: "#f7f9fa" });

    y += 14;
    const projCols = [410, 95];
    const drawProj = (a, b, opts = {}) => {
      if (opts.bg) doc.rect(left, y - 2, projCols[0] + projCols[1], 16).fill(opts.bg);
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor("#262830");
      doc.text(String(a), left + 4, y, { width: projCols[0] - 8, align: "left" });
      doc.text(String(b), left + projCols[0], y, { width: projCols[1] - 8, align: "right" });
      y += 16; pageBreak();
    };

    doc.font("Helvetica-Bold").fontSize(10).fillColor("#33414d").text("Hours by project", left, y); y += 16;
    drawProj("Project / Category", "Hours", { bold: true, bg: "#f1f4f6" });
    for (const r of model.byProject) drawProj(r.label, fmt(r.hours));
    drawProj("Total", fmt(model.totals.hours), { bold: true, bg: "#f7f9fa" });

    doc.end();
  });
}

async function renderReportExcel(model, detailRows, weekLabel) {
  const wb = new ExcelJS.Workbook();

  const sum = wb.addWorksheet("Summary");
  sum.getCell("A1").value = "Archimind — Weekly Timesheet Report";
  sum.getCell("A1").font = { bold: true, size: 14, name: "Arial" };
  sum.getCell("A2").value = `Week ${weekLabel} · all staff`;
  sum.getCell("A2").font = { name: "Arial", size: 10, color: { argb: "FF6A8A9A" } };

  sum.getRow(4).values = ["Staff", "Hours", "Overtime", "Status"];
  sum.getRow(4).font = { bold: true, name: "Arial", size: 10 };
  let r = 5;
  for (const p of model.people) { sum.getRow(r++).values = [p.name, p.hours, p.overtime, p.status]; }
  sum.getRow(r).values = ["Total", model.totals.hours, model.totals.overtime, ""];
  sum.getRow(r).font = { bold: true, name: "Arial", size: 10 };
  r += 2;
  sum.getRow(r).values = ["Hours by project", "Hours"];
  sum.getRow(r++).font = { bold: true, name: "Arial", size: 10 };
  for (const pr of model.byProject) { sum.getRow(r++).values = [pr.label, pr.hours]; }
  sum.getRow(r).values = ["Total", model.totals.hours];
  sum.getRow(r).font = { bold: true, name: "Arial", size: 10 };
  sum.getColumn(1).width = 34; sum.getColumn(2).width = 12; sum.getColumn(3).width = 12; sum.getColumn(4).width = 16;

  const det = wb.addWorksheet("Detail");
  det.getRow(1).values = ["Date", "Staff", "Project / Category", "Hours", "Overtime", "Notes"];
  det.getRow(1).font = { bold: true, name: "Arial", size: 10 };
  let d = 2;
  for (const row of detailRows) det.getRow(d++).values = [row.date, row.name, row.projectLabel, row.hours, row.overtime, row.notes || ""];
  det.getColumn(1).width = 12; det.getColumn(2).width = 22; det.getColumn(3).width = 30;
  det.getColumn(4).width = 9; det.getColumn(5).width = 10; det.getColumn(6).width = 40;

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

module.exports = { renderReportPdf, renderReportExcel };
