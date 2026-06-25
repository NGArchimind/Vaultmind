import { useState, useEffect } from "react";
import { api } from "../../api/client";
import { DESIGN_TEXT, COMPARE_FULL, PROJECTS_FULL } from "../../constants";
import { Spinner } from "../common/Spinner";
import { showToast } from "./toast";

// ── TransmittalTab ────────────────────────────────────────────────────────────
const DEFAULT_COLOURS = {
  header:      "#1a2332",
  groupRow:    "#f8f8fa",
  bforward:    "#2e5e8e",
  latestIssue: "#c25a45",
  rowEven:     "#ffffff",
  rowOdd:      "#f8f8fa",
  headerText:  "#ffffff",
  bodyText:    "#1a2332",
};

export default function TransmittalTab({ projectId, isAdmin }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [logo, setLogo] = useState(null);
  const [colours, setColours] = useState(DEFAULT_COLOURS);
  const [notes, setNotes] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [savingPdf, setSavingPdf] = useState(false);
  const [pdfMsg, setPdfMsg] = useState(null);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  // B' Forward overrides
  const [bfOverrides, setBfOverrides] = useState({});

  // Cell editing — any revision cell in any issue column
  // editingCell: { issueId, drawingNumber } | null
  const [editingCell, setEditingCell] = useState(null);
  const [cellDraft, setCellDraft] = useState("");

  // Warning dialog before saving any cell change
  // pendingCell: { issueId, issueDate, drawingNumber, drawingTitle, oldValue, newValue } | null
  const [pendingCell, setPendingCell] = useState(null);

  // Delete issue column confirmation
  const [pendingDeleteIssue, setPendingDeleteIssue] = useState(null);

  // ── TEST ONLY — inject fake issue columns into local state ──────────────────
  const [testInjected, setTestInjected] = useState(false);
  function injectTestIssues() {
    setData(prev => {
      if (!prev) return prev;
      const revOptions = ["P01","P02","P03","P04","P05","C01","C02","T01","T02"];
      const baseDate = new Date("2023-01-01");
      const fakeIssues = Array.from({ length: 100 }, (_, i) => ({
        id: `test-issue-${i}`,
        project_id: projectId,
        issue_date: new Date(baseDate.getTime() + i * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      }));
      // 100 fake drawings across 5 groups
      const fakeGroups = ["GA","FLOOR PLAN","SECTION","ELEVATION","DETAIL"];
      const fakeDrawings = Array.from({ length: 100 }, (_, i) => ({
        id: `test-drawing-${i}`,
        title: `Test Drawing ${String(i + 1).padStart(3, "0")}`,
        drawing_number: `TEST-BA-${String(i + 1).padStart(2, "0")}-DR-A-${String(i + 1).padStart(5, "0")}`,
        drawing_type: fakeGroups[Math.floor(i / 20)],
      }));
      const allDrawings = [...prev.drawings, ...fakeDrawings];
      const allIssues = [...prev.issues, ...fakeIssues];
      const fakeRevMap = {};
      for (const issue of fakeIssues) {
        fakeRevMap[issue.id] = {};
        for (const drawing of allDrawings) {
          if (drawing.drawing_number && Math.random() > 0.3) {
            fakeRevMap[issue.id][drawing.drawing_number] = revOptions[Math.floor(Math.random() * revOptions.length)];
          }
        }
      }
      return { ...prev, drawings: allDrawings, issues: allIssues, revMap: { ...prev.revMap, ...fakeRevMap } };
    });
    setTestInjected(true);
  }
  function clearTestIssues() {
    setData(prev => {
      if (!prev) return prev;
      const realIssues = prev.issues.filter(i => !String(i.id).startsWith("test-issue-"));
      const realDrawings = prev.drawings.filter(d => !String(d.id).startsWith("test-drawing-"));
      const realRevMap = Object.fromEntries(Object.entries(prev.revMap).filter(([k]) => !k.startsWith("test-issue-")));
      return { ...prev, issues: realIssues, drawings: realDrawings, revMap: realRevMap };
    });
    setTestInjected(false);
  }
  // ────────────────────────────────────────────────────────────────────────────

  async function confirmDeleteIssue() {
    if (!pendingDeleteIssue) return;
    const { issueId } = pendingDeleteIssue;
    setPendingDeleteIssue(null);
    try {
      await api(`/api/projects/${projectId}/transmittal/issues/${issueId}`, { method: "DELETE" });
      setData(prev => {
        if (!prev) return prev;
        const newIssues = prev.issues.filter(i => i.id !== issueId);
        const newRevMap = { ...prev.revMap };
        delete newRevMap[issueId];
        const newAutoBforward = {};
        for (const drawing of prev.drawings) {
          const dn = drawing.drawing_number;
          if (!dn) continue;
          let highest = null;
          for (const issue of newIssues) {
            const rev = newRevMap[issue.id]?.[dn];
            if (rev && (!highest || compareRevStr(rev, highest) > 0)) highest = rev;
          }
          newAutoBforward[dn] = highest || "";
        }
        return { ...prev, issues: newIssues, revMap: newRevMap, autoBforward: newAutoBforward };
      });
    } catch (e) { console.error(e); showToast("Failed to save revision"); }
  }

  // Fixed widths for sticky pinned columns — sized to content
  // Drawing title: ~220px, Drawing No: ~230px, B'Fwd: ~52px
  const W_TITLE = 220;
  const W_DRAWNO = 230;
  const W_BFWD = 52;

  useEffect(() => { load(); loadLogo(); loadColours(); }, [projectId]);

  async function load() {
    setLoading(true);
    try {
      const d = await api(`/api/projects/${projectId}/transmittal`);
      setData(d);
      setNotes(d.notes || "");
      setNotesDraft(d.notes || "");
      setBfOverrides(d.bforwardOverrides || {});
    } catch (e) { console.error(e); showToast("Failed to load transmittal"); }
    setLoading(false);
  }

  async function loadLogo() {
    try {
      const d = await api("/api/logo");
      if (d.base64) setLogo(d);
      else setLogo(null);
    } catch (e) { setLogo(null); }
  }

  async function loadColours() {
    try {
      const d = await api("/api/colours");
      setColours({ ...DEFAULT_COLOURS, ...d });
    } catch (e) {}
  }

  async function saveNotes() {
    setSavingNotes(true);
    try {
      await api(`/api/projects/${projectId}/transmittal/settings`, {
        method: "PATCH", body: { notes: notesDraft },
      });
      setNotes(notesDraft);
      setEditingNotes(false);
    } catch (e) { console.error(e); showToast("Failed to save notes"); }
    setSavingNotes(false);
  }

  // Called when user finishes editing any revision cell
  function requestCellEdit(issueId, issueDate, drawingNumber, drawingTitle, newValue) {
    const oldValue = data?.revMap?.[issueId]?.[drawingNumber] || "";
    setEditingCell(null);
    if (newValue === oldValue) return; // no change
    setPendingCell({ issueId, issueDate, drawingNumber, drawingTitle, oldValue, newValue });
  }

  // Called when user confirms the warning dialog
  async function confirmCellEdit() {
    if (!pendingCell) return;
    const { issueId, drawingNumber, newValue } = pendingCell;
    setPendingCell(null);
    try {
      await api(`/api/projects/${projectId}/transmittal/revisions`, {
        method: "PATCH",
        body: { issue_id: issueId, drawing_number: drawingNumber, revision: newValue },
      });
      // Update local revMap immediately without full reload
      setData(prev => {
        if (!prev) return prev;
        const newRevMap = { ...prev.revMap };
        if (!newRevMap[issueId]) newRevMap[issueId] = {};
        newRevMap[issueId] = { ...newRevMap[issueId], [drawingNumber]: newValue };
        // Recalculate autoBforward
        const newAutoBforward = { ...prev.autoBforward };
        let highest = null;
        for (const issue of prev.issues) {
          const rev = newRevMap[issue.id]?.[drawingNumber];
          if (rev && (!highest || compareRevStr(rev, highest) > 0)) highest = rev;
        }
        newAutoBforward[drawingNumber] = highest || "";
        return { ...prev, revMap: newRevMap, autoBforward: newAutoBforward };
      });
    } catch (e) { console.error(e); showToast("Failed to save edit"); }
  }

  // Simple revision string comparison: stage letter order P<T<C then number
  function compareRevStr(a, b) {
    const parse = s => { const m = String(s).match(/^([A-Za-z]+)(\d+)$/); return m ? { stage: m[1].toUpperCase(), num: parseInt(m[2], 10) } : null; };
    const stageOrder = ["P","T","C"];
    const pa = parse(a); const pb = parse(b);
    if (!pa || !pb) return 0;
    const ia = stageOrder.indexOf(pa.stage); const ib = stageOrder.indexOf(pb.stage);
    const sa = ia === -1 ? 999 : ia; const sb = ib === -1 ? 999 : ib;
    if (sa !== sb) return sa - sb;
    return pa.num - pb.num;
  }

  // "Save PDF Snapshot" — generates PDF, saves to R2, opens print dialog
  // Print warning modal
  const [printWarning, setPrintWarning] = useState(null); // { action: 'snapshot'|'pdf' }
  const printWarningDismissed = typeof window !== "undefined" && localStorage.getItem("archimind_print_warning_dismissed") === "1";

  function handlePrintClick(action) {
    if (printWarningDismissed) {
      if (action === "snapshot") savePdfSnapshot();
      else exportPdf();
    } else {
      setPrintWarning({ action });
    }
  }

  function confirmPrint(dontShowAgain) {
    if (dontShowAgain) localStorage.setItem("archimind_print_warning_dismissed", "1");
    const action = printWarning.action;
    setPrintWarning(null);
    if (action === "snapshot") savePdfSnapshot();
    else exportPdf();
  }

  async function savePdfSnapshot() {
    if (!data || savingPdf) return;
    setSavingPdf(true);
    setPdfMsg(null);
    try {
      const PAGE_W = 1048 - 53; // subtract 7mm*2 side padding
      const PINNED_W = 580;
      const ISSUE_COL_W = 18;
      const maxIssueCols = Math.floor((PAGE_W - PINNED_W) / ISSUE_COL_W);
      const slicedIssues = data.issues.length > maxIssueCols
        ? data.issues.slice(data.issues.length - maxIssueCols)
        : data.issues;
      const printData = { ...data, issues: slicedIssues };
      const html = buildPrintHtml(printData, logo, colours, bfOverrides, notes);
      // Save to R2
      await api(`/api/projects/${projectId}/transmittal/issue`, {
        method: "POST", body: { html },
      });
      setPdfMsg({ type: "ok", text: "Snapshot saved to Documents." });
      // Open print dialog
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (win) win.onload = () => setTimeout(() => { try { win.print(); } catch (_) {} }, 400);
      setTimeout(() => URL.revokeObjectURL(url), 20000);
    } catch (e) {
      setPdfMsg({ type: "err", text: "Failed: " + e.message });
    }
    setSavingPdf(false);
    setTimeout(() => setPdfMsg(null), 6000);
  }

  // "Export PDF" — calculates which issue columns fit on A4 landscape, slices
  // to keep newest N columns, builds clean HTML, opens and prints immediately.
  async function exportPdf() {
    if (!data || exportingPdf) return;
    setExportingPdf(true);
    try {
      const { project, drawings, issues, revMap } = data;

      // ── Page dimensions (A4 portrait at 96dpi, 8mm/10mm margins) ─────────────
      const PAGE_W        = 760;   // usable width px  (A4 portrait ~794px minus margins)
      const PAGE_H        = 1080;  // usable height px (A4 portrait ~1122px minus margins)
      const HDR_H         = 80;    // header block
      const NOTES_LINE_H  = 14;  // px per line at 7pt
      const notesLines    = notes ? notes.split("\n").length : 0;
      const NOTES_H       = notes ? Math.max(28, notesLines * NOTES_LINE_H + 12) : 0;
      const COL_HDR_H     = 40;    // column header row
      const ROW_H         = 20;    // data row height
      const GROUP_ROW_H   = 18;    // group label row height
      const W_TITLE       = 160;
      const W_DRAWNO      = 165;
      const W_BFWD        = 36;
      const W_ISSUE       = 28;
      const PINNED_W      = W_TITLE + W_DRAWNO + W_BFWD;
      const COLS_PER_PAGE = Math.floor((PAGE_W - PINNED_W) / W_ISSUE);

      // ── Slice issues — latest N columns only ─────────────────────────────────
      const slicedIssues = issues.length > COLS_PER_PAGE
        ? issues.slice(issues.length - COLS_PER_PAGE)
        : issues;

      // ── Build flat list of rows (group headers + drawing rows) ───────────────
      const groups = {};
      drawings.forEach(d => {
        const g = d.drawing_type || "Other";
        if (!groups[g]) groups[g] = [];
        groups[g].push(d);
      });
      const flatRows = []; // { type: "group"|"drawing", data }
      Object.entries(groups).forEach(([g, ds]) => {
        flatRows.push({ type: "group", label: g });
        ds.forEach(d => flatRows.push({ type: "drawing", data: d }));
      });

      // ── B' Forward helper — latest revision from issues NOT shown on this page ─
      const slicedIssueIds = new Set(slicedIssues.map(i => i.id));
      const priorIssues = issues.filter(i => !slicedIssueIds.has(i.id));
      function getBf(dn) {
        if (bfOverrides[dn]?.value) return bfOverrides[dn].value;
        // Find latest revision from issues not visible on this page
        if (priorIssues.length > 0) {
          for (let i = priorIssues.length - 1; i >= 0; i--) {
            const rev = revMap[priorIssues[i].id]?.[dn];
            if (rev) return rev;
          }
        }
        // If all issues fit on page (nothing prior), fall back to autoBforward or revMap
        if (data.autoBforward?.[dn]) return data.autoBforward[dn];
        const revs = issues.map(issue => revMap[issue.id]?.[dn]).filter(Boolean);
        return revs.length > 0 ? revs[revs.length - 1] : "";
      }

      // ── Paginate rows ─────────────────────────────────────────────────────────
      const availH = PAGE_H - HDR_H - NOTES_H - COL_HDR_H;
      const pages = [];
      let currentPage = [];
      let usedH = 0;
      flatRows.forEach(row => {
        const h = row.type === "group" ? GROUP_ROW_H : ROW_H;
        if (usedH + h > availH && currentPage.length > 0) {
          pages.push(currentPage);
          currentPage = [];
          usedH = 0;
        }
        currentPage.push(row);
        usedH += h;
      });
      if (currentPage.length > 0) pages.push(currentPage);

      // ── Colour helpers ────────────────────────────────────────────────────────
      const c = colours;
      const logoHtml = logo?.base64
        ? `<img src="data:${logo.mimeType};base64,${logo.base64}" style="max-height:52px;max-width:100px;object-fit:contain;display:block">`
        : `<div style="width:100px;height:52px;border:1px dashed #ccc;display:flex;align-items:center;justify-content:center;font-size:8px;color:#ccc">Logo</div>`;

      function blend(hex, ratio) {
        try {
          const p = h => { const n = parseInt(h.replace("#",""),16); return [(n>>16)&255,(n>>8)&255,n&255]; };
          const [r1,g1,b1] = p(hex); const [r2,g2,b2] = p("#ffffff");
          return `#${[r1+(r2-r1)*ratio,g1+(g2-g1)*ratio,b1+(b2-b1)*ratio].map(x=>Math.round(x).toString(16).padStart(2,"0")).join("")}`;
        } catch(_){ return hex; }
      }

      // ── Build issue column headers ────────────────────────────────────────────
      function issueHeaders() {
        return slicedIssues.map((issue, i) => {
          const dt = new Date(issue.issue_date);
          const day   = String(dt.getUTCDate()).padStart(2,"0");
          const month = String(dt.getUTCMonth()+1).padStart(2,"0");
          const year  = String(dt.getUTCFullYear()).slice(2);
          const isLatest = i === slicedIssues.length - 1;
          const bg = isLatest ? c.latestIssue : c.header;
          return `<td style="background:${bg};color:${c.headerText};width:${W_ISSUE}px;min-width:${W_ISSUE}px;max-width:${W_ISSUE}px;text-align:center;font-size:6pt;font-weight:600;line-height:1.4;padding:2px 1px;border-left:1px solid rgba(255,255,255,0.15);vertical-align:bottom">${day}<br>${month}<br>${year}</td>`;
        }).join("");
      }

      // ── Build a single page HTML ──────────────────────────────────────────────
      function buildPage(rows, pageNum, totalPages) {
        const notesHtml = notes
          ? `<div style="padding:5px 8px;font-size:7pt;color:${c.bodyText};border-bottom:1px solid #e8e0d5;line-height:1.5;background:#fff;white-space:pre-wrap;word-wrap:break-word">${notes.replace(/</g,"&lt;")}</div>`
          : "";

        const rowsHtml = rows.map(row => {
          if (row.type === "group") {
            return `<tr>
              <td colspan="${3 + slicedIssues.length}" style="background:${c.groupRow};color:${c.bodyText};font-weight:700;font-size:7pt;text-transform:uppercase;letter-spacing:0.06em;padding:2px 6px;border-bottom:1px solid #e8e0d5;height:${GROUP_ROW_H}px">${row.label}</td>
              <td style="background:${c.groupRow};border-bottom:1px solid #e8e0d5"></td>
            </tr>`;
          }
          const d = row.data;
          const bfVal = getBf(d.drawing_number);
          const bfBg = blend(c.bforward, 0.82);
          const issueCells = slicedIssues.map((issue, i) => {
            const rev = revMap[issue.id]?.[d.drawing_number] || "";
            const isLatest = i === slicedIssues.length - 1;
            const bg = isLatest ? blend(c.latestIssue, 0.80) : "transparent";
            return `<td style="background:${bg};width:${W_ISSUE}px;min-width:${W_ISSUE}px;max-width:${W_ISSUE}px;text-align:center;font-weight:${rev?700:400};color:${rev?c.bodyText:"#ccc"};border-left:1px solid #e8e0d5;padding:1px 1px;font-size:7pt;height:${ROW_H}px">${rev}</td>`;
          }).join("");
          return `<tr style="background:transparent">
            <td style="width:${W_TITLE}px;min-width:${W_TITLE}px;max-width:${W_TITLE}px;padding:2px 5px;font-size:7pt;color:${c.bodyText};border-bottom:1px solid #e8e0d5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;height:${ROW_H}px">${(d.title||"").replace(/</g,"&lt;")}</td>
            <td style="width:${W_DRAWNO}px;min-width:${W_DRAWNO}px;max-width:${W_DRAWNO}px;text-align:center;padding:2px 3px;font-size:6.5pt;font-weight:600;color:${c.bodyText};border-bottom:1px solid #e8e0d5;border-left:1px solid #e8e0d5;overflow:hidden;white-space:nowrap;height:${ROW_H}px">${(d.drawing_number||"—").replace(/</g,"&lt;")}</td>
            <td style="width:${W_BFWD}px;min-width:${W_BFWD}px;max-width:${W_BFWD}px;background:${bfBg};text-align:center;font-weight:700;padding:2px 1px;font-size:7pt;color:${c.bodyText};border-left:2px solid ${c.bforward};border-bottom:1px solid #e8e0d5;height:${ROW_H}px">${bfVal||"—"}</td>
            ${issueCells}
            <td style="border-bottom:1px solid #e8e0d5"></td>
          </tr>`;
        }).join("");

        return `
          <div class="page" style="width:${PAGE_W}px;height:${PAGE_H}px;overflow:hidden;box-sizing:border-box;background:#fff;position:relative;font-family:Arial,Helvetica,sans-serif">
            <!-- Header -->
            <div style="display:flex;align-items:center;gap:16px;padding:8px 0;border-bottom:2px solid #e8e0d5;height:${HDR_H}px;box-sizing:border-box;background:#fff">
              <div style="width:100px;height:52px;flex-shrink:0;display:flex;align-items:center">${logoHtml}</div>
              <div style="flex:1">
                <div style="font-size:13pt;font-weight:700;color:${c.bodyText};line-height:1.2">${(project?.name||"").replace(/</g,"&lt;")}</div>
                <div style="font-size:7pt;color:#777;margin-top:3px">
                  ${project?.job_number ? `<strong>Job No.</strong> ${project.job_number}` : ""}
                  ${project?.job_number && project?.location ? " · " : ""}
                  ${project?.location || ""}
                </div>
              </div>
              <div style="font-size:7pt;color:#aaa;text-align:right">Page ${pageNum} of ${totalPages}<br>Generated by Archimind</div>
            </div>
            <!-- Notes -->
            ${notesHtml}
            <!-- Table -->
            <table style="width:${PAGE_W}px;border-collapse:collapse;table-layout:auto">
              <thead>
                <tr style="height:${COL_HDR_H}px">
                  <td style="background:${c.header};color:${c.headerText};width:${W_TITLE}px;min-width:${W_TITLE}px;max-width:${W_TITLE}px;padding:3px 5px;font-size:6pt;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;vertical-align:middle">Drawing Title</td>
                  <td style="background:${c.header};color:${c.headerText};width:${W_DRAWNO}px;min-width:${W_DRAWNO}px;max-width:${W_DRAWNO}px;text-align:center;padding:3px 3px;font-size:6pt;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;border-left:1px solid rgba(255,255,255,0.15);vertical-align:middle">Drawing No.</td>
                  <td style="background:${c.bforward};color:${c.headerText};width:${W_BFWD}px;min-width:${W_BFWD}px;max-width:${W_BFWD}px;text-align:center;padding:3px 2px;font-size:6pt;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;border-left:2px solid rgba(255,255,255,0.3);vertical-align:middle">B'Fwd</td>
                  ${issueHeaders()}
                  <td style="background:${c.header};width:auto"></td>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>`;
      }

      // ── Assemble full HTML document ───────────────────────────────────────────
      const pageHtmls = pages.map((rows, i) => buildPage(rows, i+1, pages.length)).join("");

      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Drawing Schedule — ${(project?.name||"").replace(/</g,"&lt;")}</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
  body { margin: 0; padding: 0; background: #fff; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: avoid; }
  @page { size: A4 portrait; margin: 8mm 10mm; }
  @media screen { body { background: #e0e0e0; } .page { margin: 20px auto; box-shadow: 0 2px 8px rgba(0,0,0,0.2); } }
</style>
</head>
<body>${pageHtmls}</body>
</html>`;

      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (win) win.onload = () => setTimeout(() => { try { win.print(); } catch(_){} }, 400);
      setTimeout(() => URL.revokeObjectURL(url), 20000);

    } catch (e) {
      console.error(e);
      showToast("Failed to export PDF");
    }
    setExportingPdf(false);
  }

  async function exportExcel() {
    if (exportingExcel) return;
    setExportingExcel(true);
    try {
      const result = await api(`/api/projects/${projectId}/transmittal/export/excel`);
      const binary = atob(result.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: result.contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = result.name;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) { console.error(e); showToast("Failed to export Excel"); }
    setExportingExcel(false);
  }

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9a9088", fontSize: 13 }}>
      <Spinner size={13} /> Loading drawing schedule…
    </div>
  );

  if (!data) return null;

  const { project, drawings, issues, revMap, autoBforward } = data;

  if (drawings.length === 0) return (
    <div style={{ background: "#fff", border: "1px solid #e8e0d5", padding: "48px", textAlign: "center" }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>📐</div>
      <p style={{ fontSize: 14, color: DESIGN_TEXT, fontWeight: 300, fontFamily: "Inter, Arial, sans-serif" }}>
        No drawings in the register yet.
      </p>
      <p style={{ fontSize: 12, color: "#9a9088", marginTop: 6 }}>
        Upload drawings or sync via Archimind Sync to populate the schedule.
      </p>
    </div>
  );

  const groups = {};
  for (const d of drawings) {
    const grp = (d.drawing_type || "Other").trim();
    if (!groups[grp]) groups[grp] = [];
    groups[grp].push(d);
  }

  const btnSm = (color) => ({
    fontSize: 11, fontWeight: 600, color, background: "none",
    border: `1px solid ${color}`, padding: "4px 12px",
    letterSpacing: "0.04em", cursor: "pointer", flexShrink: 0,
    fontFamily: "Inter, Arial, sans-serif", display: "flex", alignItems: "center", gap: 5,
  });

  const COL_TITLE = 240;
  const COL_NUMBER = 220;
  const COL_BF = 64;
  const COL_ISSUE = 52;
  const totalWidth = COL_TITLE + COL_NUMBER + COL_BF + (issues.length * COL_ISSUE) + 40;

  const cellBase = {
    padding: "5px 8px", borderRight: "1px solid #e8e0d5", borderBottom: "1px solid #e8e0d5",
    fontSize: 11, fontFamily: "Inter, Arial, sans-serif", color: colours.bodyText,
    boxSizing: "border-box",
  };

  const hdrCell = {
    ...cellBase,
    background: colours.header, color: colours.headerText, fontWeight: 600, fontSize: 10,
    letterSpacing: "0.05em", textTransform: "uppercase",
  };

  const thStyle = {
    fontFamily: "Inter, Arial, sans-serif", fontSize: 10, fontWeight: 600,
    letterSpacing: "0.05em", textTransform: "uppercase",
    padding: "6px 8px", border: "none", outline: "1px solid rgba(255,255,255,0.15)",
    verticalAlign: "middle",
  };

  const tdStyle = {
    fontFamily: "Inter, Arial, sans-serif", fontSize: 12,
    padding: "4px 8px", borderBottom: "1px solid #f0ede8",
    verticalAlign: "middle", color: colours.bodyText,
  };

  function getBfValue(dn) {
    // B' Forward = always the latest revision across all issues (auto only)
    return autoBforward[dn] || "";
  }

  return (
    <div>
      {/* Print warning modal */}
      {printWarning && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", width: 480, borderTop: `3px solid ${DESIGN_TEXT}`, padding: "28px 32px", fontFamily: "Inter, Arial, sans-serif" }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: DESIGN_TEXT, marginBottom: 12 }}>🖨 Before you print</h3>
            <p style={{ fontSize: 13, color: "#5a5048", lineHeight: 1.7, marginBottom: 8 }}>
              To remove browser-generated text (URL, page number, date) from your printed schedule:
            </p>
            <ol style={{ fontSize: 13, color: "#5a5048", lineHeight: 2, paddingLeft: 20, marginBottom: 20 }}>
              <li>In the print dialog, click <strong>More settings</strong></li>
              <li>Uncheck <strong>Headers and footers</strong></li>
              <li>Click <strong>Print</strong></li>
            </ol>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <input type="checkbox" id="print-dismiss" style={{ width: 14, height: 14, cursor: "pointer", accentColor: DESIGN_TEXT }}
                onChange={e => { if (e.target.checked) localStorage.setItem("archimind_print_warning_dismissed", "1"); else localStorage.removeItem("archimind_print_warning_dismissed"); }} />
              <label htmlFor="print-dismiss" style={{ fontSize: 12, color: "#9a9088", cursor: "pointer" }}>
                Don't show this again
              </label>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" onClick={() => confirmPrint(localStorage.getItem("archimind_print_warning_dismissed") === "1")}
                style={{ background: DESIGN_TEXT, color: "#fff", border: "none", padding: "9px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}>
                Continue to Print
              </button>
              <button className="btn" onClick={() => setPrintWarning(null)}
                style={{ background: "none", color: "#9a9088", border: "1px solid #e4e4e8", padding: "9px 16px", fontSize: 11, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete issue column confirmation */}
      {pendingDeleteIssue && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", width: 440, borderTop: `3px solid ${COMPARE_FULL}`, padding: "28px 32px", fontFamily: "Inter, Arial, sans-serif" }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: DESIGN_TEXT, marginBottom: 12 }}>⚠ Delete Issue Column?</h3>
            <p style={{ fontSize: 13, color: "#5a5048", lineHeight: 1.7, marginBottom: 8 }}>
              You are about to permanently delete the issue column dated <strong>{new Date(pendingDeleteIssue.issueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</strong>.
            </p>
            <p style={{ fontSize: 12, color: COMPARE_FULL, lineHeight: 1.6, marginBottom: 24 }}>
              This will delete the issue record and all revision data for this column. This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" onClick={confirmDeleteIssue}
                style={{ background: COMPARE_FULL, color: "#fff", border: "none", padding: "9px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}>
                Yes, Delete Column
              </button>
              <button className="btn" onClick={() => setPendingDeleteIssue(null)}
                style={{ background: "none", color: "#9a9088", border: "1px solid #e4e4e8", padding: "9px 16px", fontSize: 11, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Warning dialog for cell edits */}
      {pendingCell && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", width: 480, borderTop: `3px solid ${COMPARE_FULL}`, padding: "28px 32px", fontFamily: "Inter, Arial, sans-serif" }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: DESIGN_TEXT, marginBottom: 12 }}>⚠ Edit Issue Record?</h3>
            <p style={{ fontSize: 13, color: "#5a5048", lineHeight: 1.7, marginBottom: 8 }}>
              You are changing the revision for <strong>{pendingCell.drawingTitle || pendingCell.drawingNumber}</strong> in the issue dated <strong>{new Date(pendingCell.issueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</strong>.
            </p>
            <div style={{ display: "flex", gap: 16, marginBottom: 16, padding: "10px 14px", background: "#f8f8fa", border: "1px solid #e8e0d5" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#9a9088", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Current</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: DESIGN_TEXT }}>{pendingCell.oldValue || "—"}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", fontSize: 16, color: "#9a9088" }}>→</div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#9a9088", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>New</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: COMPARE_FULL }}>{pendingCell.newValue || "—"}</div>
              </div>
            </div>
            <p style={{ fontSize: 12, color: COMPARE_FULL, lineHeight: 1.6, marginBottom: 24 }}>
              Editing the issue history is a permanent change and can cause coordination problems. Only proceed if you are certain this is correct.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" onClick={confirmCellEdit}
                style={{ background: COMPARE_FULL, color: "#fff", border: "none", padding: "9px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}>
                Yes, Save Change
              </button>
              <button className="btn" onClick={() => setPendingCell(null)}
                style={{ background: "none", color: "#9a9088", border: "1px solid #e4e4e8", padding: "9px 16px", fontSize: 11, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Drawing Schedule
        </h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {pdfMsg && (
            <span style={{
              fontSize: 12, padding: "4px 10px",
              background: pdfMsg.type === "ok" ? "#eef6ee" : "#fdf0f0",
              border: `1px solid ${pdfMsg.type === "ok" ? "#a8d4a8" : "#f0b8b8"}`,
              color: pdfMsg.type === "ok" ? "#2e7d4f" : COMPARE_FULL,
            }}>{pdfMsg.text}</span>
          )}
          {isAdmin && (
            <button className="btn" onClick={() => handlePrintClick("snapshot")} disabled={savingPdf} style={btnSm(COMPARE_FULL)}>
              {savingPdf ? <><Spinner size={10} /> Saving…</> : "↓ Save PDF Snapshot"}
            </button>
          )}
          <button className="btn" onClick={() => handlePrintClick("pdf")} disabled={exportingPdf} style={btnSm(DESIGN_TEXT)}>
            {exportingPdf ? <><Spinner size={10} /> Preparing…</> : "↓ Export PDF"}
          </button>
          <button className="btn" onClick={exportExcel} disabled={exportingExcel} style={btnSm(PROJECTS_FULL)}>
            {exportingExcel ? <><Spinner size={10} /> Exporting…</> : "↓ Export Excel"}
          </button>
          {/* ── TEST ONLY ── remove before go-live */}
          {!testInjected
            ? <button className="btn" onClick={injectTestIssues} style={{ fontSize: 10, color: "#fff", background: "#b06000", border: "none", padding: "4px 10px", letterSpacing: "0.04em" }}>⚗ Inject 100 issues + 100 rows</button>
            : <button className="btn" onClick={clearTestIssues} style={{ fontSize: 10, color: "#fff", background: "#7a0000", border: "none", padding: "4px 10px", letterSpacing: "0.04em" }}>⚗ Clear test issues</button>
          }
          <button className="btn" onClick={load}
            style={{ fontSize: 11, color: "#9a9088", background: "none", border: "1px solid #e4e4e8", padding: "4px 10px" }}>
            ↻
          </button>
        </div>
      </div>

      {/* Header block — outside scroll container so it never moves */}
      <div style={{ border: "1px solid #e8e0d5", borderBottom: "none", background: "#fff" }}>
        <div style={{ borderBottom: "2px solid #e8e0d5", padding: "16px 16px", display: "flex", alignItems: "center", gap: 24, minHeight: 88, background: "#fff" }}>
          <div style={{ width: 160, height: 72, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
            {logo?.base64 ? (
              <img src={`data:${logo.mimeType};base64,${logo.base64}`} alt="Practice logo"
                style={{ maxHeight: 72, maxWidth: 160, objectFit: "contain", display: "block" }} />
            ) : (
              <div style={{ width: 160, height: 72, border: "1px dashed #ccc", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 9, color: "#ccc" }}>Practice logo</span>
              </div>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: colours.bodyText, fontFamily: "Inter, Arial, sans-serif", lineHeight: 1.2 }}>{project?.name || "—"}</div>
            <div style={{ fontSize: 11, color: "#777", marginTop: 6 }}>
              {project?.job_number && <><strong>Job No.</strong> {project.job_number}</>}
              {project?.job_number && project?.location && " · "}
              {project?.location || ""}
            </div>
          </div>
        </div>
        {(notes || isAdmin) && (
          <div style={{ padding: "8px 0", background: "#f8f8fa", borderBottom: "1px solid #e8e0d5" }}>
            {isAdmin ? (
              <textarea value={notesDraft} onChange={e => { setNotesDraft(e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }} onBlur={saveNotes}
                placeholder="Transmittal notes (optional)…" rows={2}
                style={{ width: "100%", fontSize: 11, border: "1px solid #e4e4e8", padding: "6px 8px", fontFamily: "Inter, Arial, sans-serif", resize: "vertical", color: colours.bodyText, background: "#fff", boxSizing: "border-box", overflow: "hidden", minHeight: 48 }} />
            ) : (
              <div style={{ fontSize: 11, color: colours.bodyText, lineHeight: 1.6 }}>{notes}</div>
            )}
          </div>
        )}
      </div>

      {/* Schedule table — scroll container starts here, header above never scrolls */}
      <div id="schedule-scroll" style={{ overflowX: "auto", background: "#fff", border: "1px solid #e8e0d5" }}>
        <table style={{ borderCollapse: "collapse", tableLayout: "auto", background: "#fff" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, background: colours.header, color: colours.headerText, position: "sticky", left: 0, zIndex: 3, textAlign: "left", whiteSpace: "nowrap", minWidth: W_TITLE, maxWidth: W_TITLE, width: W_TITLE, overflow: "hidden", textOverflow: "ellipsis" }}>Drawing Title</th>
              <th style={{ ...thStyle, background: colours.header, color: colours.headerText, position: "sticky", left: W_TITLE, zIndex: 3, textAlign: "center", whiteSpace: "nowrap", minWidth: W_DRAWNO, width: W_DRAWNO }}>Drawing No.</th>
              <th style={{ ...thStyle, background: colours.bforward, color: colours.headerText, position: "sticky", left: W_TITLE + W_DRAWNO, zIndex: 3, textAlign: "center", width: W_BFWD, minWidth: W_BFWD, boxShadow: "4px 0 0 0 #e8e0d5, 6px 0 8px rgba(0,0,0,0.12)", borderRight: "2px solid #e8e0d5" }}>B' Fwd</th>
              {issues.map((issue, i) => {
                const dt = new Date(issue.issue_date);
                const day   = String(dt.getUTCDate()).padStart(2, "0");
                const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
                const year  = String(dt.getUTCFullYear()).slice(2);
                const isLatest = i === issues.length - 1;
                const bg = isLatest ? colours.latestIssue : colours.header;
                return (
                  <th key={issue.id} className="issue-th" style={{ ...thStyle, background: bg, color: colours.headerText, textAlign: "center", lineHeight: 1.4, borderLeft: "1px solid rgba(255,255,255,0.15)", position: "relative", paddingBottom: isAdmin ? 20 : undefined }}>
                    <div>{day}</div><div>{month}</div><div>{year}</div>
                    {isAdmin && (
                      <button className="btn"
                        onClick={() => setPendingDeleteIssue({ issueId: issue.id, issueDate: issue.issue_date })}
                        title="Delete this issue column"
                        style={{ position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)", background: "rgba(255,255,255,0.12)", border: "none", color: "rgba(255,255,255,0.45)", fontSize: 9, lineHeight: 1, padding: "1px 5px", cursor: "pointer", fontFamily: "Inter, Arial, sans-serif", whiteSpace: "nowrap" }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(194,90,69,0.75)"; e.currentTarget.style.color = "#fff"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "rgba(255,255,255,0.45)"; }}
                      >del</button>
                    )}
                  </th>
                );
              })}
              {issues.length === 0 && (
                <th style={{ ...thStyle, background: colours.header, color: "rgba(255,255,255,0.5)", fontStyle: "italic", fontWeight: 400 }}>
                  No issues recorded yet — sync drawings via Archimind Sync
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {Object.entries(groups).map(([groupName, groupDrawings]) => (
              <React.Fragment key={groupName}>
                <tr>
                  <td style={{ background: colours.groupRow, color: colours.bodyText, fontWeight: 700, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", padding: "4px 8px", borderBottom: "1px solid #e8e0d5", position: "sticky", left: 0, zIndex: 2, width: W_TITLE, minWidth: W_TITLE, borderRight: "1px solid #e8e0d5" }}>{groupName}</td>
                  <td style={{ background: colours.groupRow, position: "sticky", left: W_TITLE, zIndex: 2, width: W_DRAWNO, minWidth: W_DRAWNO, borderBottom: "1px solid #e8e0d5", borderRight: "1px solid #e8e0d5" }} />
                  <td style={{ background: colours.groupRow, position: "sticky", left: W_TITLE + W_DRAWNO, zIndex: 2, width: W_BFWD, minWidth: W_BFWD, borderBottom: "1px solid #e8e0d5", boxShadow: "4px 0 0 0 #e8e0d5, 6px 0 8px rgba(0,0,0,0.12)" }} />
                  {issues.length > 0 && <td colSpan={issues.length} style={{ background: colours.groupRow, borderBottom: "1px solid #e8e0d5" }} />}
                </tr>
                {groupDrawings.map((d, idx) => {
                  const rowBg = idx % 2 === 0 ? colours.rowEven : colours.rowOdd;
                  const bfVal = getBfValue(d.drawing_number);
                  return (
                    <tr key={d.id} style={{ background: rowBg }}>
                      <td style={{ ...tdStyle, background: rowBg, position: "sticky", left: 0, zIndex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: W_TITLE, minWidth: W_TITLE, maxWidth: W_TITLE, borderRight: "1px solid #e8e0d5" }}>{d.title}</td>
                      <td style={{ ...tdStyle, background: rowBg, textAlign: "center", fontWeight: 600, fontSize: 11, whiteSpace: "nowrap", position: "sticky", left: W_TITLE, zIndex: 1, width: W_DRAWNO, minWidth: W_DRAWNO, borderRight: "1px solid #e8e0d5" }}>{d.drawing_number || "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "center", fontWeight: 700, background: blendHex(colours.bforward, "#ffffff", 0.88), position: "sticky", left: W_TITLE + W_DRAWNO, zIndex: 1, width: W_BFWD, minWidth: W_BFWD, boxShadow: "4px 0 0 0 #e8e0d5, 6px 0 8px rgba(0,0,0,0.12)", borderRight: "2px solid #e8e0d5" }}>{bfVal || "—"}</td>
                      {issues.map((issue, i) => {
                        const rev = revMap[issue.id]?.[d.drawing_number] || "";
                        const isLatest = i === issues.length - 1;
                        const isEditing = editingCell?.issueId === issue.id && editingCell?.drawingNumber === d.drawing_number;
                        return (
                          <td key={issue.id} className="issue-td" style={{ ...tdStyle, textAlign: "center", padding: "2px 4px", fontWeight: rev ? 700 : 400, background: isLatest ? colours.latestIssue + "22" : rowBg, color: rev ? colours.bodyText : "#c8c0b8", borderLeft: "1px solid #e8e0d5" }}>
                            {isEditing ? (
                              <input autoFocus value={cellDraft} onChange={e => setCellDraft(e.target.value)}
                                onBlur={() => requestCellEdit(issue.id, issue.issue_date, d.drawing_number, d.title, cellDraft)}
                                onKeyDown={e => { if (e.key === "Enter") requestCellEdit(issue.id, issue.issue_date, d.drawing_number, d.title, cellDraft); if (e.key === "Escape") setEditingCell(null); }}
                                style={{ width: "100%", border: `1px solid ${PROJECTS_FULL}`, padding: "2px 3px", fontSize: 11, fontFamily: "Inter, Arial, sans-serif", textAlign: "center", outline: "none", background: "#fff" }} />
                            ) : (
                              <span onClick={() => { if (isAdmin) { setEditingCell({ issueId: issue.id, drawingNumber: d.drawing_number }); setCellDraft(rev); } }}
                                title={isAdmin ? "Click to edit (use sparingly)" : rev}
                                style={{ cursor: isAdmin ? "text" : "default", display: "block", lineHeight: "24px" }}>
                                {rev || ""}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      {isAdmin && (
        <p style={{ fontSize: 11, color: "#b0a8a0", marginTop: 8, fontStyle: "italic" }}>
          New issue columns are added automatically when drawings are synced via Archimind Sync.
          Revision cells are editable — click any cell to correct it. Changes are permanent and flagged with a warning.
          B' Forward is auto-calculated and shows the latest revision across all issues.
        </p>
      )}
    </div>
  );
}

// ── blendHex — mix two hex colours (ratio 0=colA, 1=colB) ───────────────────
function blendHex(hexA, hexB, ratio) {
  try {
    const parse = h => { const n = parseInt(h.replace("#",""), 16); return [(n>>16)&255,(n>>8)&255,n&255]; };
    const [r1,g1,b1] = parse(hexA);
    const [r2,g2,b2] = parse(hexB);
    const r = Math.round(r1+(r2-r1)*ratio);
    const g = Math.round(g1+(g2-g1)*ratio);
    const b = Math.round(b1+(b2-b1)*ratio);
    return `#${[r,g,b].map(x=>x.toString(16).padStart(2,"0")).join("")}`;
  } catch (_) { return hexA; }
}

// ── buildPrintHtml — generates self-contained A4 print HTML ──────────────────
function buildPrintHtml(data, logo, colours, bfOverrides, notes) {
  const { project, drawings, issues, revMap, autoBforward } = data;
  const c = { ...DEFAULT_COLOURS, ...(colours || {}) };

  function getBf(dn) {
    const ov = bfOverrides[dn];
    return ov ? ov.value : (autoBforward[dn] || "");
  }

  const groups = {};
  for (const d of drawings) {
    const grp = (d.drawing_type || "Other").trim();
    if (!groups[grp]) groups[grp] = [];
    groups[grp].push(d);
  }

  // All colours as inline styles — required for print-color-adjust to work reliably
  // Print HTML uses normal ltr column order: Drawing No | Title | B'Fwd | oldest→newest issues
  // A beforeprint script shifts the table left so the newest (rightmost) column aligns to the
  // right page edge, and oldest columns overflow off the left — clipped, not scaled.
  const issueDateHeaders = issues.map((issue, i) => {
    const dt = new Date(issue.issue_date);
    const day   = String(dt.getUTCDate()).padStart(2, "0");
    const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const year  = String(dt.getUTCFullYear()).slice(2);
    const isLatest = i === issues.length - 1;
    const bg = isLatest ? c.latestIssue : c.header;
    return `<th class="issue-col" style="background:${bg};color:${c.headerText};text-align:center;line-height:1.5;font-size:7pt;font-weight:600;border:1px solid #999;padding:0;letter-spacing:0.02em"><div style="width:28px;margin:0 auto;padding:3px 2px">${day}<br>${month}<br>${year}</div></th>`;
  }).join("");

  const rowsHtml = Object.entries(groups).map(([grpName, grpDrawings]) => {
    const grpRow = `<tr><td colspan="${3 + issues.length}" style="background:${c.groupRow};color:${c.bodyText};font-weight:700;font-size:7pt;text-transform:uppercase;letter-spacing:0.07em;padding:4px 6px;border:1px solid #bbb">${grpName}</td></tr>`;
    const dRows = grpDrawings.map((d, idx) => {
      const rowBg = idx % 2 === 0 ? c.rowEven : c.rowOdd;
      const bfVal = getBf(d.drawing_number);
      const bfBg = blendHex(c.bforward, "#ffffff", 0.82);
      const issueCells = issues.map((issue, i) => {
        const rev = revMap[issue.id]?.[d.drawing_number] || "";
        const isLatest = i === issues.length - 1;
        const bg = isLatest ? blendHex(c.latestIssue, "#ffffff", 0.80) : rowBg;
        return `<td class="issue-col" style="background:${bg};text-align:center;border:1px solid #ddd;padding:0"><div style="width:28px;margin:0 auto;padding:3px 2px;font-weight:${rev ? 700 : 400};color:${rev ? c.bodyText : "#ccc"};font-size:8pt">${rev}</div></td>`;
      }).join("");
      return `<tr>
        <td class="pin" style="background:${rowBg};color:${c.bodyText};text-align:center;font-weight:600;padding:3px 6px;border:1px solid #e0e0e0;font-size:7.5pt;white-space:nowrap;width:1%">${d.drawing_number || "—"}</td>
        <td class="pin" style="background:${rowBg};color:${c.bodyText};padding:3px 6px;border:1px solid #e0e0e0;font-size:8pt;white-space:nowrap;width:1%">${d.title || ""}</td>
        <td class="pin" style="background:${bfBg};color:${c.bodyText};text-align:center;font-weight:700;padding:3px 6px;border:1px solid #ccc;border-left:2px solid ${c.bforward};font-size:8pt;white-space:nowrap;width:1%">${bfVal || "—"}</td>
        ${issueCells}
      </tr>`;
    }).join("");
    return grpRow + dRows;
  }).join("");

  const logoHtml = logo?.base64
    ? `<img src="data:${logo.mimeType};base64,${logo.base64}" style="max-height:72px;max-width:160px;object-fit:contain;display:block">`
    : `<div style="width:160px;height:72px;border:1px dashed #ccc;display:flex;align-items:center;justify-content:center"><span style="font-size:7pt;color:#ccc">Practice logo</span></div>`;

  const notesHtml = notes
    ? `<div style="display:flex;gap:12px;padding:5px 0 5px;border-bottom:1px solid #ccc;margin-bottom:4px;font-size:8pt"><span style="font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;font-size:7pt;padding-top:1px;min-width:40px;flex-shrink:0">Notes</span><span style="color:${c.bodyText};line-height:1.5">${notes.replace(/</g,"&lt;")}</span></div>`
    : "";

  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2,"0")}/${String(now.getMonth()+1).padStart(2,"0")}/${now.getFullYear()}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Drawing Schedule — ${(project?.name || "").replace(/</g,"&lt;")}</title>
<style>
  @page { size: A4 landscape; margin: 8mm 7mm; }

  *, *::before, *::after {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  html { background: #fff; }

  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8pt;
    color: ${c.bodyText};
    background: #fff;
    margin: 0;
    padding: 0;
  }

  .hdr {
    display: flex;
    align-items: center;
    gap: 20px;
    padding-bottom: 6px;
    border-bottom: 2px solid #333;
    margin-bottom: 4px;
    min-height: 64px;
  }
  .hdr-logo { width: 160px; height: 60px; flex-shrink: 0; display: flex; align-items: center; }
  .hdr-info { flex: 1; }
  .hdr-name { font-size: 13pt; font-weight: 700; color: ${c.bodyText}; line-height: 1.2; }
  .hdr-meta { font-size: 8pt; color: #555; margin-top: 4px; }
  .hdr-generated { font-size: 7pt; color: #aaa; margin-top: 2px; }

  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: auto;
    margin-top: 0;
  }
  thead th {
    background: ${c.header};
    color: ${c.headerText};
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
    border: 1px solid #999;
    padding: 4px 5px;
    vertical-align: middle;
  }
  tbody td { vertical-align: middle; }

  @media print {
    html, body { margin: 0; padding: 0; }
    thead { display: table-header-group; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; page-break-after: auto; }
  }
</style>
</head>
<body>
<table>
  <thead>
    <tr>
      <td colspan="${3 + issues.length}" style="padding:0 0 4px 0;border:none;background:#fff">
        <div class="hdr">
          <div class="hdr-logo">${logoHtml}</div>
          <div class="hdr-info">
            <div class="hdr-name">${(project?.name || "").replace(/</g,"&lt;")}</div>
            <div class="hdr-meta">
              ${project?.job_number ? `<strong>Job No.</strong> ${project.job_number}` : ""}
              ${project?.job_number && project?.location ? " &nbsp;&middot;&nbsp; " : ""}
              ${project?.location || ""}
            </div>
            <div class="hdr-generated">Generated by Archimind &middot; ${dateStr}</div>
          </div>
        </div>
        ${notesHtml}
      </td>
    </tr>
    <tr>
      <th style="text-align:center;white-space:nowrap;padding:4px 6px;width:1%">Drawing No.</th>
      <th style="text-align:left;padding:4px 6px;white-space:nowrap;width:1%">Drawing Title</th>
      <th style="text-align:center;white-space:nowrap;width:1%;background:${c.bforward};color:${c.headerText};border-left:2px solid rgba(255,255,255,0.4)">B' Fwd</th>
      ${issueDateHeaders}
    </tr>
  </thead>
  <tbody>
    ${rowsHtml}
  </tbody>
</table>
</body>
</html>`;
}

