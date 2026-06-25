import { useState, useEffect } from "react";
import { api, askGemini } from "../../api/client";
import { DESIGN_TEXT, COMPARE_FULL, PROJECTS_FULL } from "../../constants";
import { base64ToBlob } from "./projectHelpers";
import { Spinner } from "../common/Spinner";
import { showToast } from "./toast";
import DrawingRow from "./DrawingRow";
import PdfViewerModal from "./PdfViewerModal";

// ── QA Bar ────────────────────────────────────────────────────────────────────
export default function QABar({ project, consultants, uvalues, notes, drawings, projectId, onNavigateTab, activeTab }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [matchedDrawings, setMatchedDrawings] = useState([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [viewingDrawing, setViewingDrawing] = useState(null);
  const [lastQuestion, setLastQuestion] = useState("");
  const [assignedProducts, setAssignedProducts] = useState([]);
  const [productCategories, setProductCategories] = useState([]);
  const [matchedProducts, setMatchedProducts] = useState([]);
  const [expandedProductId, setExpandedProductId] = useState(null);
  const [viewingPdfProduct, setViewingPdfProduct] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [todos, setTodos] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [transmittal, setTransmittal] = useState(null);
  const [matchedTasks, setMatchedTasks] = useState([]);
  const [matchedAgreements, setMatchedAgreements] = useState([]);
  const [scope, setScope] = useState("all");

  useEffect(() => {
    async function loadProducts() {
      try {
        const [{ products }, { categories }, todosRes, membersRes, transmittalRes] = await Promise.all([
          api(`/api/projects/${projectId}/products`),
          api(`/api/projects/${projectId}/categories`),
          api(`/api/projects/${projectId}/todos`),
          api(`/api/team-members`),
          api(`/api/projects/${projectId}/transmittal`),
        ]);
        setAssignedProducts(products || []);
        setProductCategories(categories || []);
        setTodos(todosRes.todos || []);
        setTeamMembers(membersRes || []);
        setTransmittal(transmittalRes);
      } catch (e) {}
    }
    loadProducts();
  }, [projectId]);

  useEffect(() => {
    const TAB_SCOPE = { agreements: "agreements", drawings: "drawings", tasks: "tasks", products: "products" };
    setScope(TAB_SCOPE[activeTab] || "all");
  }, [activeTab]);

  async function handleDownload(drawing) {
    setDownloadingId(drawing.id);
    try {
      const { base64, file_name } = await api(`/api/projects/${projectId}/drawings/${drawing.id}/file`);
      const ext = (drawing.file_name || "").split(".").pop().toLowerCase();
      const mimeType = ext === "dwg" ? "application/acad" : "application/pdf";
      const blob = base64ToBlob(base64, mimeType);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = file_name || drawing.file_name || "drawing";
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) { console.error("Download failed:", e); showToast("Failed to download drawing"); }
    setDownloadingId(null);
  }

  const [downloadingAll, setDownloadingAll] = useState(false);

  async function downloadAll() {
    if (matchedDrawings.length === 0 || downloadingAll) return;
    setDownloadingAll(true);
    try {
      if (!window.JSZip) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
          script.onload = resolve; script.onerror = reject;
          document.head.appendChild(script);
        });
      }
      const zip = new window.JSZip();
      for (const drawing of matchedDrawings) {
        try {
          const { base64, file_name } = await api(`/api/projects/${projectId}/drawings/${drawing.id}/file`);
          zip.file(file_name || drawing.file_name || `${drawing.drawing_number || drawing.id}.pdf`, base64, { base64: true });
        } catch (e) { console.error("Failed:", drawing.id, e); }
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      const safeName = (lastQuestion || "drawings").replace(/[^a-z0-9]/gi, "-").slice(0, 40);
      a.download = `drawings-${safeName}.zip`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) { console.error("Download all failed:", e); showToast("Failed to download drawings"); }
    setDownloadingAll(false);
  }

  async function ask() {
    if (!question.trim() || running) return;
    const q = question.trim();
    setLastQuestion(q);
    const includeDrawings = scope === "all" || scope === "drawings";
    const includeAgreements = scope === "all" || scope === "agreements";
    const includeTasks = scope === "all" || scope === "tasks";
    const includeProducts = scope === "all" || scope === "products";
    setQuestion(""); setRunning(true); setAnswer(null); setMatchedDrawings([]); setMatchedProducts([]); setMatchedTasks([]); setMatchedAgreements([]); setExpandedProductId(null); setExpanded(true); setStatus(includeDrawings ? "Searching drawings…" : "Thinking…");

    const drawingContext = drawings.length === 0
      ? "No drawings in register."
      : drawings.map(d =>
          `ID:${d.id} | ${d.drawing_number || "—"} | ${d.title || "Untitled"} | Rev:${d.revision || "—"} | Status:${d.status || "—"} | Scale:${d.scale || "—"} | Type:${d.drawing_type || "—"} | Level:${d.level || "—"} | Volume:${d.volume || "—"}`
        ).join("\n");

    // Search indexed drawing content — only when scope includes drawings
    let drawingContentContext = "";
    let contentMatches = [];
    if (includeDrawings) {
      try {
        const { results } = await api(`/api/projects/${projectId}/drawings/search`, {
          method: "POST",
          body: { query: q },
        });
        contentMatches = results || [];
        if (contentMatches.length > 0) {
          drawingContentContext = "\n\nINDEXED DRAWING CONTENT (drawings whose content is relevant to this question):\n" +
            contentMatches.map(d =>
              `--- ID:${d.id} | ${d.drawing_number || "—"} | ${d.title || "Untitled"} ---\n${(d.content_text || "").slice(0, 3000)}`
            ).join("\n\n");
        }
      } catch (e) { /* non-fatal — QA continues without drawing content */ }
    }
    setStatus("Thinking…");

    const productsContext = assignedProducts.length === 0
      ? "No products assigned."
      : assignedProducts.map(a => {
          const p = a.products;
          if (!p) return null;
          const cat = productCategories.find(c => c.id === a.category_id);
          const catName = cat ? cat.name : "Uncategorised";
          const attrLine = (p.attributes && p.attributes.length > 0)
            ? "\n  Attributes: " + p.attributes.map(attr => `${attr.attribute}: ${attr.value}${attr.unit ? " " + attr.unit : ""}`).join(", ")
            : "";
          return `ID:${p.id} | ${p.name}${p.manufacturer ? ` by ${p.manufacturer}` : ""}${p.product_type ? ` [${p.product_type}]` : ""} — Category: ${catName}${attrLine}`;
        }).filter(Boolean).join("\n");

    const memberMap = Object.fromEntries(teamMembers.map(m => [m.id, m.full_name]));
    const tasksContext = todos.length === 0
      ? "No tasks recorded."
      : todos.map(t => {
          const assignee = t.assigned_to ? (memberMap[t.assigned_to] || "Unknown") : "Unassigned";
          const due = t.due_date ? new Date(t.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "No due date";
          return `ID:${t.id} | "${t.description}" | Status: ${t.status || "open"} | Assigned: ${assignee} | Due: ${due}`;
        }).join("\n");

    let transmittalContext = "No transmittal issues recorded.";
    if (transmittal && transmittal.issues && transmittal.issues.length > 0) {
      const issueLines = transmittal.issues.map(issue => {
        const revs = transmittal.revMap?.[issue.id] || {};
        const revEntries = Object.entries(revs).map(([dn, rev]) => `${dn} Rev ${rev}`).join(", ");
        const date = new Date(issue.issue_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
        return `${date}: ${revEntries || "no revisions recorded"}`;
      });
      const bfLines = Object.entries(transmittal.autoBforward || {})
        .filter(([, rev]) => rev)
        .map(([dn, rev]) => `${dn}: Rev ${rev}`)
        .join(", ");
      transmittalContext = issueLines.join("\n") + (bfLines ? `\nLatest revision per drawing: ${bfLines}` : "");
    }

    let freshAgreements = [];
    if (includeAgreements) {
      try {
        const agreementsRes = await api(`/api/projects/${projectId}/agreements`);
        freshAgreements = agreementsRes.agreements || [];
      } catch (e) { /* non-fatal — QA continues without agreements */ }
    }

    const agreementsContext = freshAgreements.length === 0
      ? "No client instructions, agreements, or confirmations recorded."
      : freshAgreements.map(a => {
          const history = (a.entries || []).length > 1
            ? ` (previously: ${(a.entries || []).slice(0, -1).map(e => `"${e.text}" on ${e.date_agreed}`).join(", ")})`
            : "";
          return `ID:${a.id} | "${a.current_text}" — confirmed by ${a.confirmed_by || "unknown"} on ${a.date_agreed}${a.others_present ? `, others: ${a.others_present}` : ""}${history}`;
        }).join("\n");

    const ctx = [
      `PROJECT: ${project.name}
Job Number: ${project.job_number || "—"}
Client: ${project.client || "—"}
Location: ${project.location || "—"}
Project Lead: ${project.project_lead || "—"}
RIBA Stage: ${project.stage || "—"}
Status: ${project.status || "active"}
Description: ${project.description || "—"}`,

      `CONSULTANTS:\n${consultants.length === 0 ? "None recorded." : consultants.map(c => `${c.discipline || "Unknown"} — ${c.company || ""}${c.contact_name ? ` (${c.contact_name})` : ""}${c.email ? ` · ${c.email}` : ""}${c.phone ? ` · ${c.phone}` : ""}`).join("\n")}`,

      `U-VALUE REQUIREMENTS:\n${uvalues.length === 0 ? "None recorded." : uvalues.map(u => `${u.element}: Target ${u.target !== null ? u.target + " W/m²K" : "not set"}, Achieved ${u.achieved !== null ? u.achieved + " W/m²K" : "not set"}${u.notes ? ` — ${u.notes}` : ""}`).join("\n")}`,

      `ADDITIONAL NOTES:\n${notes.length === 0 ? "None recorded." : notes.map(n => `${n.label}: ${n.value}`).join("\n")}`,

      includeProducts ? `SPECIFIED PRODUCTS:\n${productsContext}` : null,

      includeTasks ? `TASKS (TO DO LIST):\n${tasksContext}` : null,

      (includeDrawings || includeAgreements) ? `TRANSMITTAL / DRAWING ISSUE HISTORY:\n${transmittalContext}` : null,

      includeAgreements ? `AGREED DECISIONS, CLIENT INSTRUCTIONS & CONFIRMATIONS:\n${agreementsContext}` : null,

      includeDrawings ? `DRAWING REGISTER (${drawings.length} drawings):\n${drawingContext}${drawingContentContext}` : null,
    ].filter(Boolean).join("\n\n");

    const systemPrompt = `You are a project assistant for an architectural practice. You have full access to the project data provided — including project info, consultants, U-values, notes, specified products (with full technical attributes), the tasks/to-do list, transmittal issue history, client instructions and agreed decisions & confirmations (stored in the Agreements section), the drawing register, and extracted content from indexed drawings.

When INDEXED DRAWING CONTENT is present in the context, use it to answer questions about what is shown or noted within specific drawings — room names, materials, annotations, schedules, specifications, and other drawing content. Reference the drawing number when citing content from a specific drawing.

Answer questions with appropriate detail based on the project data. Do not say you cannot access information — everything you need is in the context provided.

Return a JSON object with this exact structure:
{
  "answer": "Your response here — as detailed as the question requires",
  "drawing_ids": ["id1", "id2"],
  "product_ids": ["id1", "id2"],
  "task_ids": ["id1", "id2"],
  "agreement_ids": ["id1", "id2"]
}

Rules:
- Always populate "answer" with a helpful, direct response. For technical questions (fire ratings, U-values, certifications etc) include the specific values from the product attributes.
- Populate "drawing_ids" with the ID of every drawing you reference or cite in your answer — including drawings from INDEXED DRAWING CONTENT that informed your response
- Only populate "product_ids" when the answer references one or more specific products — use the product IDs from the SPECIFIED PRODUCTS context (the id field in the products join, format: uuid)
- Only populate "task_ids" when the answer references one or more specific tasks — use the task IDs from the TASKS context (the ID field, format: uuid)
- Only populate "agreement_ids" when the answer references one or more agreements, decisions, or client instructions — use the IDs from the AGREED DECISIONS context (the ID field after "ID:", format: uuid)
- Never include UUIDs, IDs, or technical identifiers in the "answer" text — they are handled separately via the _ids fields
- When the answer is primarily drawn from agreements or client instructions, keep the "answer" brief: state how many were found and that full details are shown below (e.g. "1 client instruction recorded — see the card below." or "Found 3 recorded instructions — see the cards below.")
- Never say you don't have access to information — use what is in the context
- Do not include any text outside the JSON object`;

    try {
      const { text } = await askGemini(
        [{ role: "user", content: `${ctx}\n\n---\n\nQUESTION: ${q}` }],
        systemPrompt, 3000, 1, "gemini-2.5-flash"
      );

      let answerText = text;
      let matchedDrawingIds = [];
      let matchedProductIds = [];
      let matchedTaskIds = [];
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (typeof parsed.answer === "string" && parsed.answer.trim()) answerText = parsed.answer;
          if (Array.isArray(parsed.drawing_ids) && parsed.drawing_ids.length > 0) matchedDrawingIds = parsed.drawing_ids;
          if (Array.isArray(parsed.product_ids) && parsed.product_ids.length > 0) matchedProductIds = parsed.product_ids;
          if (Array.isArray(parsed.task_ids) && parsed.task_ids.length > 0) matchedTaskIds = parsed.task_ids;
          if (Array.isArray(parsed.agreement_ids) && parsed.agreement_ids.length > 0) setMatchedAgreements(freshAgreements.filter(a => parsed.agreement_ids.includes(a.id)));
        }
      } catch (parseErr) {}
      setAnswer(answerText);
      // Merge AI-referenced drawings with content search results — deduplicated
      const fromAI = drawings.filter(d => matchedDrawingIds.includes(d.id));
      const merged = [...fromAI];
      // Only surface content-search hits if the AI also cited drawings — prevents cross-contamination
      if (matchedDrawingIds.length > 0) {
        for (const d of contentMatches) {
          if (!merged.find(x => x.id === d.id)) {
            merged.push(drawings.find(x => x.id === d.id) || d);
          }
        }
      }
      if (merged.length > 0) setMatchedDrawings(merged);
      if (matchedProductIds.length > 0) setMatchedProducts(assignedProducts.filter(a => a.products && matchedProductIds.includes(a.products.id)));
      if (matchedTaskIds.length > 0) setMatchedTasks(todos.filter(t => matchedTaskIds.includes(t.id)));
      setStatus("");
    } catch (e) {
      setStatus("Error: " + e.message);
    }
    setRunning(false);
  }

  async function viewProductPdf(product) {
    setViewingPdfProduct(product);
    setPdfLoading(true);
    setPdfUrl(null);
    try {
      const data = await api(`/api/products/${product.id}/pdf`);
      const bytes = atob(data.base64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      setPdfUrl(URL.createObjectURL(new Blob([arr], { type: "application/pdf" })));
    } catch (e) { console.error(e); showToast("Failed to load datasheet"); }
    setPdfLoading(false);
  }

  function closePdf() {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null); setViewingPdfProduct(null);
  }

  const hasResults = answer || running || status || matchedDrawings.length > 0 || matchedProducts.length > 0 || matchedTasks.length > 0 || matchedAgreements.length > 0;

  const renderMap = Object.fromEntries(teamMembers.map(m => [m.id, m.full_name]));

  function renderProjectAnswer(text) {
    const lines = text.split("\n");
    const result = [];
    let listBuf = [];
    let listOl = false;
    function flush() {
      if (!listBuf.length) return;
      const items = listBuf.splice(0);
      result.push(listOl
        ? <ol key={result.length} style={{ margin: "6px 0 12px 22px", padding: 0 }}>{items}</ol>
        : <ul key={result.length} style={{ margin: "6px 0 12px 22px", padding: 0 }}>{items}</ul>
      );
      listOl = false;
    }
    function inline(str) {
      return str.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).map((s, i) => {
        if (s.startsWith("**") && s.endsWith("**")) return <strong key={i}>{s.slice(2, -2)}</strong>;
        if (s.startsWith("*") && s.endsWith("*")) return <em key={i}>{s.slice(1, -1)}</em>;
        return s;
      });
    }
    lines.forEach((raw, i) => {
      const line = raw.trim();
      if (!line) { flush(); return; }
      if (/^#{2,3}\s/.test(line)) {
        flush();
        result.push(<div key={i} style={{ fontSize: 13, fontWeight: 700, color: PROJECTS_FULL, margin: "18px 0 6px", letterSpacing: "0.02em" }}>{line.replace(/^#+\s*/, "")}</div>);
        return;
      }
      const ulM = line.match(/^[-•]\s+(.*)/);
      if (ulM) { if (listOl) flush(); listBuf.push(<li key={i} style={{ marginBottom: 4, color: "#3a3632", fontSize: 13 }}>{inline(ulM[1])}</li>); return; }
      const olM = line.match(/^\d+\.\s+(.*)/);
      if (olM) { if (!listOl && listBuf.length) flush(); listOl = true; listBuf.push(<li key={i} style={{ marginBottom: 4, color: "#3a3632", fontSize: 13 }}>{inline(olM[1])}</li>); return; }
      flush();
      result.push(<p key={i} style={{ margin: "0 0 10px", fontSize: 13, color: "#3a3632", lineHeight: 1.65, fontFamily: "Inter, Arial, sans-serif" }}>{inline(line)}</p>);
    });
    flush();
    return <div>{result}</div>;
  }

  function closePanel() {
    setAnswer(null); setMatchedDrawings([]); setMatchedProducts([]); setMatchedTasks([]); setMatchedAgreements([]); setExpandedProductId(null); setStatus(""); setExpanded(false);
  }

  return (
    <div style={{ borderTop: "1px solid #e8e0d5", background: "#ffffff", flexShrink: 0 }}>
      {expanded && hasResults && (
        <div style={{ position: "fixed", top: 56, left: 16, right: 16, bottom: 16, zIndex: 500, background: "#fff", borderRadius: 6, boxShadow: "0 8px 48px rgba(0,0,0,0.24)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Header */}
          <div style={{ background: PROJECTS_FULL, padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div style={{ minWidth: 0, flex: 1, marginRight: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.65)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>Project Q&A</div>
              <div style={{ fontSize: 13, color: "#fff", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lastQuestion}</div>
            </div>
            <button className="btn" onClick={closePanel}
              style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", padding: "7px 18px", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", flexShrink: 0 }}>
              ✕ Close
            </button>
          </div>

          {/* Scrollable body */}
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 40px" }}>
            {running && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#9a9088", fontSize: 13 }}>
                <Spinner size={13} /> {status}
              </div>
            )}
            {!running && status && (
              <p style={{ fontSize: 13, color: COMPARE_FULL }}>{status}</p>
            )}
            {answer && (
              <div style={{ marginBottom: 28 }}>
                {renderProjectAnswer(answer)}
              </div>
            )}

            {/* Matched agreements */}
            {matchedAgreements.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>{matchedAgreements.length} agreement{matchedAgreements.length !== 1 ? "s" : ""} referenced</span>
                  {onNavigateTab && (
                    <button className="btn" onClick={() => { closePanel(); onNavigateTab("agreements"); }}
                      style={{ fontSize: 10, fontWeight: 600, color: PROJECTS_FULL, background: "none", border: `1px solid ${PROJECTS_FULL}`, padding: "3px 10px", letterSpacing: "0.04em" }}>
                      View all in Agreements tab →
                    </button>
                  )}
                </div>
                {matchedAgreements.map(a => {
                  const [y, m, d] = (a.date_agreed || "").split("-");
                  const dateStr = a.date_agreed
                    ? new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                    : null;
                  const prevEntries = (a.entries || []).slice(0, -1);
                  return (
                    <div key={a.id} style={{ background: "#f8f8fa", border: `1px solid #c8e6d4`, borderLeft: `3px solid ${PROJECTS_FULL}`, borderRadius: 4, padding: "12px 16px", marginBottom: 8 }}>
                      <div style={{ fontSize: 13, color: DESIGN_TEXT, fontWeight: 500, marginBottom: 6 }}>{a.current_text}</div>
                      <div style={{ fontSize: 11, color: "#9a9088", display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
                        {dateStr && <span>📅 {dateStr}</span>}
                        {a.confirmed_by && <span>✓ {a.confirmed_by}</span>}
                        {a.others_present && <span>· {a.others_present}</span>}
                        {a.source_label && <span style={{ color: "#b0a8a0" }}>· {a.source_label}</span>}
                      </div>
                      {onNavigateTab && (a.source_type === "email" || a.source_type === "minutes") && (
                        <div style={{ marginTop: 8 }}>
                          <button className="btn" onClick={() => { closePanel(); onNavigateTab(a.source_type === "email" ? "emails" : "minutes"); }}
                            style={{ fontSize: 11, color: "#2a6496", background: "none", border: "1px solid #b8d0e8", padding: "4px 12px", borderRadius: 3, fontWeight: 500, cursor: "pointer" }}>
                            {a.source_type === "email" ? "📧 Open source email" : "📝 Open in Minutes"}
                            {a.source_label ? ` — ${a.source_label}` : ""}
                          </button>
                        </div>
                      )}
                      {prevEntries.length > 0 && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #e8e4e0" }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: "#b0a8a0", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Previous versions</div>
                          {prevEntries.reverse().map((e, i) => {
                            const [ey, em, ed] = (e.date_agreed || "").split("-");
                            const eDateStr = e.date_agreed
                              ? new Date(Number(ey), Number(em) - 1, Number(ed)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                              : null;
                            return (
                              <div key={i} style={{ fontSize: 11, color: "#9a9088", marginBottom: 2 }}>
                                {eDateStr && <span style={{ color: "#b0a8a0" }}>{eDateStr} — </span>}{e.text}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Matched tasks */}
            {matchedTasks.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
                  {matchedTasks.length} task{matchedTasks.length !== 1 ? "s" : ""} referenced
                </div>
                {matchedTasks.map(t => {
                  const assignee = t.assigned_to ? (renderMap[t.assigned_to] || "Unknown") : "Unassigned";
                  const due = t.due_date ? new Date(t.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;
                  const statusColors = { done: "#3e7e58", in_progress: "#2a6496", open: "#9a9088" };
                  const sColor = statusColors[t.status] || "#9a9088";
                  return (
                    <div key={t.id} style={{ background: "#f8f8fa", border: "1px solid #e4e4e8", borderRadius: 4, padding: "12px 16px", marginBottom: 8, display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: DESIGN_TEXT, fontWeight: 500 }}>{t.description}</div>
                        <div style={{ fontSize: 11, color: "#9a9088", marginTop: 3 }}>
                          {assignee}{due && ` · Due ${due}`}
                        </div>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 600, color: sColor, background: sColor + "18", padding: "3px 9px", borderRadius: 3, letterSpacing: "0.05em", textTransform: "uppercase", flexShrink: 0 }}>
                        {(t.status || "open").replace(/_/g, " ")}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Referenced products */}
            {matchedProducts.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
                  {matchedProducts.length} product{matchedProducts.length !== 1 ? "s" : ""} referenced
                </div>
                {matchedProducts.map((a, i) => {
                  const p = a.products;
                  if (!p) return null;
                  const cat = productCategories.find(c => c.id === a.category_id);
                  const isExpanded = expandedProductId === p.id;
                  const hasAttrs = p.attributes && p.attributes.length > 0;
                  return (
                    <div key={a.id} style={{ borderBottom: i < matchedProducts.length - 1 ? "1px solid #f0ede8" : "none", background: i % 2 === 0 ? "#f8f8fa" : "#fff" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px" }}>
                        <div style={{ flex: 1, minWidth: 0, cursor: hasAttrs ? "pointer" : "default" }}
                          onClick={() => hasAttrs && setExpandedProductId(isExpanded ? null : p.id)}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: DESIGN_TEXT }}>{p.name}</div>
                          <div style={{ fontSize: 11, color: "#9a9088", marginTop: 1 }}>
                            {p.manufacturer || "—"}
                            {cat && <span style={{ marginLeft: 10, color: "#b0a8a0" }}>· {cat.name}</span>}
                          </div>
                        </div>
                        {p.product_type && (
                          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "#2a6496", background: "#e8f0f8", padding: "2px 7px", flexShrink: 0 }}>
                            {p.product_type}
                          </span>
                        )}
                        {p.file_key && (
                          <button className="btn" onClick={() => viewProductPdf(p)}
                            style={{ fontSize: 11, color: "#2a6496", background: "none", border: "1px solid #b8d0e8", padding: "3px 10px", flexShrink: 0, fontWeight: 500 }}>
                            📄 Datasheet
                          </button>
                        )}
                        {hasAttrs && (
                          <button className="btn" onClick={() => setExpandedProductId(isExpanded ? null : p.id)}
                            style={{ fontSize: 11, color: "#2a6496", background: "none", border: "none", padding: "2px 6px", flexShrink: 0, fontWeight: 500 }}>
                            {isExpanded ? "▲" : "▼"}
                          </button>
                        )}
                      </div>
                      {isExpanded && hasAttrs && (
                        <div style={{ borderTop: "1px solid #e8e0d5", padding: "0 16px 12px" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "Inter, Arial, sans-serif" }}>
                            <thead>
                              <tr>
                                <th style={{ background: DESIGN_TEXT, color: "#fff", padding: "5px 12px", textAlign: "left", fontWeight: 500, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", width: "35%" }}>Attribute</th>
                                <th style={{ background: DESIGN_TEXT, color: "#fff", padding: "5px 12px", textAlign: "left", fontWeight: 500, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase" }}>Value</th>
                                <th style={{ background: DESIGN_TEXT, color: "#fff", padding: "5px 12px", textAlign: "left", fontWeight: 500, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", width: "15%" }}>Unit</th>
                              </tr>
                            </thead>
                            <tbody>
                              {p.attributes.map((attr, j) => (
                                <tr key={j} style={{ background: j % 2 === 0 ? "#f9f7f5" : "#fff" }}>
                                  <td style={{ padding: "6px 12px", borderBottom: "1px solid #e8e0d5", color: "#5a5048", fontWeight: 500 }}>{attr.attribute}</td>
                                  <td style={{ padding: "6px 12px", borderBottom: "1px solid #e8e0d5", color: DESIGN_TEXT }}>{attr.value}</td>
                                  <td style={{ padding: "6px 12px", borderBottom: "1px solid #e8e0d5", color: "#9a9088" }}>{attr.unit || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Matched drawings */}
            {matchedDrawings.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>{matchedDrawings.length} drawing{matchedDrawings.length !== 1 ? "s" : ""} found</span>
                  <button className="btn" onClick={downloadAll} disabled={downloadingAll}
                    style={{ fontSize: 10, fontWeight: 600, color: DESIGN_TEXT, background: "none", border: `1px solid ${DESIGN_TEXT}`, padding: "3px 10px", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 5 }}>
                    {downloadingAll ? <><Spinner size={10} /> Downloading…</> : "↓ Download All"}
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(200px,240px) 1fr 60px minmax(80px,140px) 80px 36px 36px 36px", gap: "0 12px", padding: "6px 16px", background: DESIGN_TEXT }}>
                  {["Drawing No.", "Title", "Rev.", "Status", "Scale", "", "", ""].map((h, i) => (
                    <div key={i} style={{ fontSize: 10, fontWeight: 500, color: "#fff", letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</div>
                  ))}
                </div>
                {matchedDrawings.map(d => (
                  <DrawingRow key={d.id} d={d} projectId={projectId} isAdmin={false}
                    downloadingId={downloadingId} onDownload={handleDownload} onView={setViewingDrawing}
                    highlight={true} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ padding: "12px 32px", display: "flex", alignItems: "stretch" }}>
        <select value={scope} onChange={e => setScope(e.target.value)}
          style={{ border: "1px solid #e4e4e8", borderRight: "none", padding: "0 10px", fontSize: 11, fontWeight: 600, color: PROJECTS_FULL, background: "#f8fdf9", outline: "none", fontFamily: "Inter, Arial, sans-serif", cursor: "pointer", flexShrink: 0, borderRadius: "3px 0 0 3px" }}>
          <option value="all">Everything</option>
          <option value="agreements">Agreements & Instructions</option>
          <option value="drawings">Drawings</option>
          <option value="tasks">Tasks</option>
          <option value="products">Products</option>
        </select>
        <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === "Enter") ask(); }}
          placeholder="Ask anything about this project, or find drawings — e.g. 'show me all 1:200 floor plans'"
          className="arc-input"
          style={{ flex: 1, border: "1px solid #e4e4e8", borderRight: "none", padding: "8px 14px", fontSize: 13, color: DESIGN_TEXT, outline: "none", fontFamily: "Inter, Arial, sans-serif", background: "#fff" }} />
        <button className="btn" onClick={ask} disabled={!question.trim() || running}
          style={{ background: question.trim() && !running ? DESIGN_TEXT : "#f8f8fa", color: question.trim() && !running ? "#fff" : "#9a9088", padding: "0 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", border: `1px solid ${question.trim() && !running ? DESIGN_TEXT : "#ddd8d0"}`, minWidth: 70 }}>
          {running ? <Spinner size={12} /> : "Ask"}
        </button>
        {hasResults && (
          <button className="btn" onClick={closePanel}
            style={{ background: "none", color: "#9a9088", padding: "0 10px", fontSize: 11, border: "1px solid #e4e4e8", borderLeft: "none", marginLeft: -1 }}>Clear</button>
        )}
      </div>

      {viewingDrawing && (
        <PdfViewerModal
          drawing={viewingDrawing}
          projectId={projectId}
          onClose={() => setViewingDrawing(null)}
          drawings={matchedDrawings}
          currentIndex={matchedDrawings.findIndex(d => d.id === viewingDrawing.id)}
        />
      )}

      {viewingPdfProduct && (
        <div style={{ position: "fixed", inset: 0, background: "#1a1a1a", zIndex: 2000, display: "flex", flexDirection: "column" }}>
          <div style={{ background: DESIGN_TEXT, padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{viewingPdfProduct.name}</div>
              {viewingPdfProduct.manufacturer && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>{viewingPdfProduct.manufacturer}</div>}
            </div>
            <button className="btn" onClick={closePdf}
              style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", padding: "7px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em" }}>
              Close ✕
            </button>
          </div>
          <div style={{ flex: 1, background: "#525659", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {pdfLoading && <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#fff", fontSize: 13 }}><Spinner size={14} /> Loading datasheet…</div>}
            {pdfUrl && !pdfLoading && <iframe src={pdfUrl} style={{ width: "100%", height: "100%", border: "none" }} title={viewingPdfProduct.name} />}
          </div>
        </div>
      )}
    </div>
  );
}





