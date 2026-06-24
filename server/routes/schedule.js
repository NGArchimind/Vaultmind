// Schedule tools — schedule types & revisions, CSV→Excel export (with diff
// highlighting), and PDF schedule compare (mupdf render + Gemini vision).
// Extracted verbatim from index.js; paths and behaviour unchanged.
const express = require("express");
const { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const ExcelJS = require("exceljs");
const { requireAuth } = require("../middleware/auth");
const { supabase, r2, BUCKET } = require("../helpers/clients");
const { streamToBuffer } = require("../helpers/r2");
const { GEMINI_BASE } = require("../helpers/gemini");

const router = express.Router();

// CSV parser (handles quoted fields with embedded commas)
function parseCsvText(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  return lines.filter(l => l.trim()).map(line => {
    const fields = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        fields.push(field.trim());
        field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field.trim());
    return fields;
  });
}

router.get("/api/projects/:id/schedule-types", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("project_schedule_types")
    .select("id, name, created_at")
    .eq("project_id", req.params.id)
    .order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post("/api/projects/:id/schedule-types", requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  const { data, error } = await supabase
    .from("project_schedule_types")
    .insert({ project_id: req.params.id, name: name.trim() })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.patch("/api/projects/:id/schedule-types/:tid", requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  const { data, error } = await supabase
    .from("project_schedule_types")
    .update({ name: name.trim() })
    .eq("id", req.params.tid)
    .eq("project_id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "not found" });
  res.json(data);
});

router.delete("/api/projects/:id/schedule-types/:tid", requireAuth, async (req, res) => {
  // Fetch all revision CSV keys before cascade delete
  const { data: revisions } = await supabase
    .from("project_schedule_revisions")
    .select("csv_key")
    .eq("schedule_type_id", req.params.tid);
  // Delete R2 objects (best-effort — don't fail if a key is missing)
  for (const rev of (revisions || [])) {
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: rev.csv_key })).catch(() => {});
  }
  // Delete from DB — cascades to project_schedule_revisions
  const { error } = await supabase
    .from("project_schedule_types")
    .delete()
    .eq("id", req.params.tid)
    .eq("project_id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Schedule Revisions ─────────────────────────────────────────────────────────

router.get("/api/schedule-types/:tid/revisions", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("project_schedule_revisions")
    .select("id, csv_key, row_count, uploaded_at")
    .eq("schedule_type_id", req.params.tid)
    .order("uploaded_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.delete("/api/schedule-revisions/:rid", requireAuth, async (req, res) => {
  const { data: rev } = await supabase
    .from("project_schedule_revisions")
    .select("csv_key")
    .eq("id", req.params.rid)
    .single();
  if (!rev) return res.status(404).json({ error: "not found" });
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: rev.csv_key })).catch(() => {});
  const { error } = await supabase
    .from("project_schedule_revisions")
    .delete()
    .eq("id", req.params.rid);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.get("/api/schedule-revisions/:rid/csv", requireAuth, async (req, res) => {
  const { data: rev } = await supabase
    .from("project_schedule_revisions")
    .select("csv_key")
    .eq("id", req.params.rid)
    .single();
  if (!rev) return res.status(404).json({ error: "not found" });
  const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: rev.csv_key }));
  const buffer = await streamToBuffer(obj.Body);
  res.set({
    "Content-Type": "text/csv",
    "Content-Disposition": `attachment; filename="revision.csv"`,
  });
  res.send(buffer);
});

// ── CSV to Excel ───────────────────────────────────────────────────────────────

router.post("/api/schedule/csv-to-excel", requireAuth, async (req, res) => {
  const { projectId, scheduleTypeId, csvText } = req.body;
  if (!projectId || !scheduleTypeId || !csvText) {
    return res.status(400).json({ error: "projectId, scheduleTypeId and csvText required" });
  }

  const allRows = parseCsvText(csvText);
  if (allRows.length < 2) return res.status(400).json({ error: "CSV must have a header row and at least one data row" });
  const headers = allRows[0];
  const dataRows = allRows.slice(1);

  const [{ data: project }, { data: schedType }] = await Promise.all([
    supabase.from("projects").select("name").eq("id", projectId).single(),
    supabase.from("project_schedule_types").select("name").eq("id", scheduleTypeId).single(),
  ]);

  // Get most recent previous revision
  const { data: prevRevisions } = await supabase
    .from("project_schedule_revisions")
    .select("id, csv_key")
    .eq("schedule_type_id", scheduleTypeId)
    .order("uploaded_at", { ascending: false })
    .limit(1);

  // Build diff map — mark → { status, changedCols: Set<colIndex> }
  const diffMap = {};
  let prevDataRows = [];

  if (prevRevisions?.length > 0) {
    const prevObj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: prevRevisions[0].csv_key }));
    const prevBuffer = await streamToBuffer(prevObj.Body);
    const prevAllRows = parseCsvText(prevBuffer.toString("utf8"));
    prevDataRows = prevAllRows.slice(1);

    const prevByMark = {};
    prevDataRows.forEach(row => { if (row[0]) prevByMark[row[0]] = row; });
    const newByMark = {};
    dataRows.forEach(row => { if (row[0]) newByMark[row[0]] = row; });

    dataRows.forEach(row => {
      const mark = row[0]; if (!mark) return;
      if (!prevByMark[mark]) {
        diffMap[mark] = { status: "added", changedCols: new Set() };
      } else {
        const changed = new Set();
        headers.forEach((_, i) => {
          if ((row[i] || "") !== (prevByMark[mark][i] || "")) changed.add(i);
        });
        if (changed.size > 0) diffMap[mark] = { status: "changed", changedCols: changed };
      }
    });
    prevDataRows.forEach(row => {
      const mark = row[0]; if (!mark) return;
      if (!newByMark[mark]) diffMap[mark] = { status: "removed", changedCols: new Set() };
    });
  }

  const added   = Object.values(diffMap).filter(d => d.status === "added").length;
  const changed = Object.values(diffMap).filter(d => d.status === "changed").length;
  const removed = Object.values(diffMap).filter(d => d.status === "removed").length;

  // Generate Excel
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Schedule");
  const colCount = headers.length;

  // Header block (rows 1–6)
  ws.mergeCells(1, 1, 1, colCount);
  ws.getCell("A1").value = "Architectural Design and Technology";
  ws.getCell("A1").font = { bold: true, size: 14, name: "Arial" };

  ws.getCell("A3").value = "Project:";      ws.getCell("A3").font = { bold: true, name: "Arial", size: 10 };
  ws.getCell("B3").value = project?.name || "";
  ws.mergeCells(3, 2, 3, colCount);

  ws.getCell("A4").value = "Schedule Type:"; ws.getCell("A4").font = { bold: true, name: "Arial", size: 10 };
  ws.getCell("B4").value = schedType?.name || "";
  ws.mergeCells(4, 2, 4, colCount);

  ws.getCell("A5").value = "Date:";          ws.getCell("A5").font = { bold: true, name: "Arial", size: 10 };
  ws.getCell("B5").value = new Date().toLocaleDateString("en-GB");
  ws.mergeCells(5, 2, 5, colCount);

  ws.getCell("A6").value = prevRevisions?.length > 0 ? "Changes:" : "Note:";
  ws.getCell("A6").font = { bold: true, name: "Arial", size: 10 };
  ws.getCell("B6").value = prevRevisions?.length > 0
    ? `${added} added, ${changed} changed, ${removed} removed`
    : "First revision — saved as baseline";
  ws.mergeCells(6, 2, 6, colCount);

  // Column headers — row 9
  const headerRow = ws.getRow(9);
  headerRow.height = 20;
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, name: "Arial", size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E0F0" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FF5C4A80" } } };
  });

  // Data rows
  const FILL_ADDED   = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F5E9" } };
  const FILL_CHANGED = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8E1" } };
  const FILL_REMOVED = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEBEE" } };
  let rowIdx = 10;

  dataRows.forEach(row => {
    const mark = row[0];
    const diff = diffMap[mark];
    const wsRow = ws.getRow(rowIdx++);
    headers.forEach((_, i) => {
      const cell = wsRow.getCell(i + 1);
      cell.value = row[i] || "";
      cell.font = { name: "Arial", size: 9 };
      cell.alignment = { horizontal: "left", vertical: "middle" };
      if (diff?.status === "added") cell.fill = FILL_ADDED;
      else if (diff?.status === "changed" && diff.changedCols.has(i)) cell.fill = FILL_CHANGED;
    });
  });

  // Removed rows appended at bottom
  prevDataRows.forEach(row => {
    if (diffMap[row[0]]?.status !== "removed") return;
    const wsRow = ws.getRow(rowIdx++);
    headers.forEach((_, i) => {
      const cell = wsRow.getCell(i + 1);
      cell.value = row[i] || "";
      cell.font = { name: "Arial", size: 9, color: { argb: "FFC62828" }, italic: true };
      cell.fill = FILL_REMOVED;
      cell.alignment = { horizontal: "left", vertical: "middle" };
    });
  });

  // Column widths — auto based on header text length
  headers.forEach((h, i) => {
    ws.getColumn(i + 1).width = Math.max((h || "").length + 4, 14);
  });

  const excelBuffer = await wb.xlsx.writeBuffer();

  // Upload new CSV to R2
  const csvKey = `schedules/${projectId}/${scheduleTypeId}/${Date.now()}.csv`;
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: csvKey,
    Body: Buffer.from(csvText, "utf8"),
    ContentType: "text/csv",
  }));

  // Record revision in DB
  await supabase.from("project_schedule_revisions").insert({
    schedule_type_id: scheduleTypeId,
    project_id: projectId,
    csv_key: csvKey,
    row_count: dataRows.length,
  });

  const safeName = (schedType?.name || "Schedule").replace(/[^a-z0-9 .\-]/gi, "_");
  res.set({
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${safeName}.xlsx"`,
    "X-Schedule-Added":   String(added),
    "X-Schedule-Changed": String(changed),
    "X-Schedule-Removed": String(removed),
    "X-Schedule-Rows":    String(dataRows.length),
  });
  res.send(Buffer.from(excelBuffer));
});

// ── PDF Schedule Compare ───────────────────────────────────────────────────────

router.post("/api/schedule/compare-pdfs", requireAuth, async (req, res) => {
  const { pdfABase64, pdfBBase64 } = req.body;
  if (!pdfABase64 || !pdfBBase64) return res.status(400).json({ error: "pdfABase64 and pdfBBase64 required" });

  try {
    // ── Step 1: render each PDF page to a JPEG image using mupdf ──────────────
    // Rendering to images preserves table column structure that text extraction loses.
    const mupdf = await import("mupdf");

    function renderPdfPages(base64) {
      const pdfBytes = Buffer.from(base64, "base64");
      const doc = new mupdf.PDFDocument(pdfBytes);
      const count = doc.countPages();
      const pages = [];
      for (let i = 0; i < count; i++) {
        try {
          const page = doc.loadPage(i);
          const pixmap = page.toPixmap(mupdf.Matrix.scale(1.5, 1.5), mupdf.ColorSpace.DeviceRGB, false);
          pages.push(Buffer.from(pixmap.asJPEG(80)).toString("base64"));
        } catch (_) {}
      }
      return pages;
    }

    const [pagesA, pagesB] = [renderPdfPages(pdfABase64), renderPdfPages(pdfBBase64)];
    if (!pagesA.length || !pagesB.length) {
      return res.status(400).json({ error: "Could not render one or both PDFs. Ensure they are valid PDF files." });
    }

    // ── Step 2: ask Gemini vision to extract table rows from each page image ───
    // Each page is sent as a JPEG — Gemini reads the visual table layout directly.
    async function extractPageRows(pageBase64) {
      const prompt = `This is a page from an architectural schedule PDF. Extract the table data.

Always return this exact JSON structure:
{"columns":["Mark","Type","Width (mm)"],"rows":[["W.01.01","A-WT-E1","1247"],["W.01.02","A-WT-E2","900"]]}

Rules:
- "columns": the header names exactly as shown in the table. Always include this field.
- "rows": every data row as an array of string values matching the column order. Include ALL rows visible on this page.
- The first column must be the unique item Mark (e.g. W.01.01, D.02, 101A).
- Skip title rows, page numbers, revision blocks, company names.
- Use "" for any blank or missing cell value.
- Return ONLY the JSON — no markdown, no explanation.`;

      const response = await fetch(`${GEMINI_BASE}/gemini-2.5-flash:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: "image/jpeg", data: pageBase64 } },
              { text: prompt },
            ],
          }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 8192 },
        }),
      });

      if (!response.ok) throw new Error(`Gemini page extraction error: ${(await response.text()).slice(0, 200)}`);
      const data = await response.json();
      const finishReason = data.candidates?.[0]?.finishReason;
      const rawText = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
      console.log(`extractPageRows: finishReason=${finishReason} rawLen=${rawText.length} preview=${rawText.slice(0, 120)}`);
      try { return JSON.parse(rawText); }
      catch (e) {
        console.log(`extractPageRows parse failed: ${e.message} raw=${rawText.slice(0, 200)}`);
        return { columns: [], rows: [] };
      }
    }

    // Extract all pages from both PDFs simultaneously
    const [resultsA, resultsB] = await Promise.all([
      Promise.all(pagesA.map(extractPageRows)),
      Promise.all(pagesB.map(extractPageRows)),
    ]);

    // Combine pages: columns from the first page that has them, rows from all pages
    function combinePages(results, label) {
      let columns = null;
      const rows = [];
      for (const r of results) {
        if (!columns && Array.isArray(r.columns) && r.columns.length) columns = r.columns;
        if (Array.isArray(r.rows)) rows.push(...r.rows);
      }
      console.log(`combinePages ${label}: pages=${results.length} columns=${JSON.stringify(columns)} rows=${rows.length} sample=${JSON.stringify(rows.slice(0,3))}`);
      return { columns: columns || [], rows };
    }

    const [tableA, tableB] = [combinePages(resultsA, "A"), combinePages(resultsB, "B")];

    if (!tableA.columns.length || !tableB.columns.length) {
      return res.status(500).json({
        error: "Could not identify column headers in one or both schedules.",
        _debug: {
          colsA: tableA.columns, rowsA: tableA.rows.length, sampleA: tableA.rows.slice(0, 3),
          colsB: tableB.columns, rowsB: tableB.rows.length, sampleB: tableB.rows.slice(0, 3),
        }
      });
    }

    // ── Step 3: diff in JavaScript — no AI, no size limits ────────────────────
    const colsA = tableA.columns;
    const colsB = tableB.columns;
    const allCols = [...new Set([...colsA, ...colsB])];

    const byMarkA = {};
    tableA.rows.forEach(row => { if (row[0]) byMarkA[String(row[0]).trim()] = row; });
    const byMarkB = {};
    tableB.rows.forEach(row => { if (row[0]) byMarkB[String(row[0]).trim()] = row; });

    const diff = [];

    // Added: in B only
    tableB.rows.forEach(rowB => {
      const mark = String(rowB[0] || "").trim();
      if (!mark || byMarkA[mark]) return;
      const fields = {};
      colsB.forEach((col, i) => { if (i > 0) fields[col] = { new: String(rowB[i] || "").trim() }; });
      diff.push({ mark, status: "added", fields });
    });

    // Removed: in A only
    tableA.rows.forEach(rowA => {
      const mark = String(rowA[0] || "").trim();
      if (!mark || byMarkB[mark]) return;
      const fields = {};
      colsA.forEach((col, i) => { if (i > 0) fields[col] = { old: String(rowA[i] || "").trim() }; });
      diff.push({ mark, status: "removed", fields });
    });

    // Changed: in both, at least one field differs
    tableB.rows.forEach(rowB => {
      const mark = String(rowB[0] || "").trim();
      if (!mark || !byMarkA[mark]) return;
      const rowA = byMarkA[mark];
      const fields = {};
      allCols.forEach(col => {
        const iA = colsA.indexOf(col);
        const iB = colsB.indexOf(col);
        if (iA === 0 || iB === 0) return; // skip mark column
        const valA = iA >= 0 ? String(rowA[iA] || "").trim() : "";
        const valB = iB >= 0 ? String(rowB[iB] || "").trim() : "";
        if (valA !== valB) fields[col] = { old: valA, new: valB };
      });
      if (Object.keys(fields).length > 0) diff.push({ mark, status: "changed", fields });
    });

    diff.sort((a, b) => a.mark.localeCompare(b.mark, undefined, { numeric: true }));

    const _debug = {
      colsA, colsB,
      rowCountA: tableA.rows.length,
      rowCountB: tableB.rows.length,
      sampleMarksA: tableA.rows.slice(0, 5).map(r => r[0]),
      sampleMarksB: tableB.rows.slice(0, 5).map(r => r[0]),
    };

    res.json({ diff, _debug });

  } catch (err) {
    console.error("compare-pdfs error:", err);
    res.status(500).json({ error: err.message || "Comparison failed" });
  }
});

router.post("/api/schedule/compare-pdfs/excel", requireAuth, async (req, res) => {
  const { diff } = req.body;
  if (!Array.isArray(diff)) return res.status(400).json({ error: "diff array required" });

  // Collect all field names across the diff
  const colSet = new Set();
  diff.forEach(row => Object.keys(row.fields || {}).forEach(k => colSet.add(k)));
  const fieldCols = Array.from(colSet);
  const allCols = ["Mark", ...fieldCols, "Status"];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Compare");

  // Header row
  allCols.forEach((col, i) => {
    const cell = ws.getRow(1).getCell(i + 1);
    cell.value = col;
    cell.font = { bold: true, name: "Arial", size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E0F0" } };
    cell.border = { bottom: { style: "thin" } };
  });

  const FILLS = {
    added:     { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F5E9" } },
    changed:   { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8E1" } },
    removed:   { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEBEE" } },
    unchanged: null,
  };

  diff.forEach((row, idx) => {
    const wsRow = ws.getRow(idx + 2);
    const fill = FILLS[row.status];

    allCols.forEach((col, i) => {
      const cell = wsRow.getCell(i + 1);
      cell.font = { name: "Arial", size: 9 };
      if (fill) cell.fill = fill;

      if (col === "Mark") {
        cell.value = row.mark;
      } else if (col === "Status") {
        cell.value = row.status.charAt(0).toUpperCase() + row.status.slice(1);
      } else {
        const field = row.fields?.[col];
        if (!field) { cell.value = ""; return; }
        if (row.status === "changed" && field.old !== undefined && field.new !== undefined) {
          cell.value = `${field.new} (was ${field.old})`;
        } else {
          cell.value = field.new ?? field.old ?? "";
        }
      }
    });
  });

  allCols.forEach((col, i) => {
    ws.getColumn(i + 1).width = col === "Mark" || col === "Status" ? 12 : 22;
  });

  const buf = await wb.xlsx.writeBuffer();
  res.set({
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": 'attachment; filename="Schedule_Compare.xlsx"',
  });
  res.send(Buffer.from(buf));
});

module.exports = router;
