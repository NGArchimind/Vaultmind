import { useState, useEffect, useRef } from "react";
import { api, callClaude } from "../api/client";
import AnswerRenderer from "./common/AnswerRenderer";
import { Spinner } from "./common/Spinner";
import { ARC_NAVY, ARC_TERRACOTTA, ARC_STONE, AD_GREEN } from "../constants";

const DRAWING_TYPE_OPTIONS = [
  'Plan', 'Floor Plan', 'Roof Plan', 'Reflected Ceiling Plan', 'Site Plan',
  'Elevation', 'Section', 'Detail', 'GA', 'Setting Out',
  'Schedule', 'Specification', 'Diagram', 'Survey', 'Other'
];

const RIBA_STAGES = [
  "Stage 0 — Strategic Definition",
  "Stage 1 — Preparation & Briefing",
  "Stage 2 — Concept Design",
  "Stage 3 — Spatial Coordination",
  "Stage 4 — Technical Design",
  "Stage 5 — Manufacturing & Construction",
  "Stage 6 — Handover",
  "Stage 7 — Use",
];

const STAGE_COLORS = {
  "Stage 0": "#9a9088", "Stage 1": "#7a6aaa", "Stage 2": "#2a6496",
  "Stage 3": AD_GREEN,  "Stage 4": "#c25a45", "Stage 5": "#c28a20",
  "Stage 6": "#4a7c20", "Stage 7": "#505a5f",
};

function stageColor(stage) {
  if (!stage) return "#9a9088";
  const key = Object.keys(STAGE_COLORS).find(k => stage.startsWith(k));
  return key ? STAGE_COLORS[key] : "#9a9088";
}

function stageShort(stage) {
  if (!stage) return "—";
  const m = stage.match(/Stage (\d)/);
  return m ? `S${m[1]}` : stage;
}

// ── Editable field ────────────────────────────────────────────────────────────
function EditableField({ value, onSave, placeholder, multiline = false, style = {} }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const commit = () => { setEditing(false); if (draft !== value) onSave(draft); };
  if (editing) {
    const shared = {
      value: draft, onChange: e => setDraft(e.target.value), onBlur: commit, autoFocus: true,
      onKeyDown: e => { if (!multiline && e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value || ""); setEditing(false); } },
      style: { width: "100%", border: `1px solid ${AD_GREEN}`, padding: "4px 8px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none", background: "#fff", resize: "none", ...style },
    };
    return multiline ? <textarea rows={3} {...shared} /> : <input {...shared} />;
  }
  return (
    <span onClick={() => { setDraft(value || ""); setEditing(true); }} title="Click to edit"
      style={{ cursor: "text", color: value ? ARC_NAVY : "#b0a8a0", fontStyle: value ? "normal" : "italic", ...style }}>
      {value || placeholder}
    </span>
  );
}

// ── New project form ──────────────────────────────────────────────────────────
function NewProjectForm({ onSave, onCancel }) {
  const [form, setForm] = useState({ name: "", job_number: "", client: "", location: "", stage: "", description: "", project_lead: "" });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const handleSave = async () => { if (!form.name.trim()) return; setSaving(true); await onSave(form); setSaving(false); };
  const labelStyle = { fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 };
  const inputStyle = { width: "100%", border: "1px solid #ddd8d0", padding: "8px 12px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none", background: "#fff", marginBottom: 14 };
  return (
    <div style={{ background: "#fff", border: `1px solid #e8e0d5`, borderTop: `3px solid ${ARC_TERRACOTTA}`, padding: "28px 32px", marginBottom: 20 }}>
      <h3 style={{ fontSize: 15, fontWeight: 500, color: ARC_NAVY, marginBottom: 20 }}>New Project</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
        <div><label style={labelStyle}>Project Name *</label><input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. 14 Station Road" style={inputStyle} autoFocus /></div>
        <div><label style={labelStyle}>Job Number</label><input value={form.job_number} onChange={e => set("job_number", e.target.value)} placeholder="e.g. 2024-042" style={inputStyle} /></div>
        <div><label style={labelStyle}>Client</label><input value={form.client} onChange={e => set("client", e.target.value)} placeholder="Client name" style={inputStyle} /></div>
        <div><label style={labelStyle}>Location</label><input value={form.location} onChange={e => set("location", e.target.value)} placeholder="Town / county" style={inputStyle} /></div>
        <div><label style={labelStyle}>Project Lead</label><input value={form.project_lead} onChange={e => set("project_lead", e.target.value)} placeholder="e.g. Nathan" style={inputStyle} /></div>
        <div>
          <label style={labelStyle}>RIBA Stage</label>
          <select value={form.stage} onChange={e => set("stage", e.target.value)} style={{ ...inputStyle, color: form.stage ? ARC_NAVY : "#9a9088" }}>
            <option value="">Select stage…</option>
            {RIBA_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}><label style={labelStyle}>Description</label><input value={form.description} onChange={e => set("description", e.target.value)} placeholder="Brief description" style={inputStyle} /></div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button className="btn" onClick={handleSave} disabled={!form.name.trim() || saving}
          style={{ background: form.name.trim() ? ARC_NAVY : "#c8c0b8", color: "#fff", padding: "9px 24px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {saving ? <Spinner size={12} /> : "Create Project"}
        </button>
        <button className="btn" onClick={onCancel} style={{ background: "none", color: "#9a9088", padding: "9px 16px", fontSize: 11, border: "1px solid #ddd8d0" }}>Cancel</button>
      </div>
    </div>
  );
}

// ── Project card ──────────────────────────────────────────────────────────────
function ProjectCard({ project, onClick }) {
  const color = stageColor(project.stage);
  return (
    <div className="btn" onClick={onClick}
      style={{ background: "#fff", border: "1px solid #e8e0d5", borderLeft: `4px solid ${color}`, padding: "18px 24px", cursor: "pointer", display: "flex", alignItems: "center", gap: 20, transition: "all 0.15s" }}>
      <div style={{ width: 44, height: 44, background: color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", letterSpacing: "0.04em" }}>{stageShort(project.stage)}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: ARC_NAVY, marginBottom: 3, fontFamily: "Inter, Arial, sans-serif" }}>{project.name}</div>
        <div style={{ fontSize: 12, color: "#9a9088", display: "flex", gap: 16, flexWrap: "wrap" }}>
          {project.job_number && <span>#{project.job_number}</span>}
          {project.client && <span>👤 {project.client}</span>}
          {project.location && <span>📍 {project.location}</span>}
          {project.project_lead && <span>🧑‍💼 {project.project_lead}</span>}
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>
        {project.stage && (
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color, background: `${color}18`, padding: "3px 8px" }}>
            {project.stage.split("—")[0].trim()}
          </span>
        )}
      </div>
    </div>
  );
}

// ── PDF Viewer Modal — full screen ────────────────────────────────────────────
function PdfViewerModal({ drawing: initialDrawing, projectId, onClose, drawings: drawingsList = [], currentIndex: initialIndex = 0 }) {
  const [currentIdx, setCurrentIdx] = useState(initialIndex);
  const drawing = (drawingsList.length > 0 && drawingsList[currentIdx]) ? drawingsList[currentIdx] : initialDrawing;
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true); setPdfUrl(null); setError("");
      try {
        const { base64, file_name } = await api(`/api/projects/${projectId}/drawings/${drawing.id}/file`);
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: "application/pdf" });
        setPdfUrl(URL.createObjectURL(blob));
      } catch (e) { setError("Failed to load drawing: " + e.message); }
      setLoading(false);
    }
    load();
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
  }, [drawing.id]);

  // Keyboard arrow navigation
  useEffect(() => {
    if (drawingsList.length <= 1) return;
    function handleKey(e) {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setCurrentIdx(i => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setCurrentIdx(i => Math.min(drawingsList.length - 1, i + 1));
      } else if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [drawingsList.length, onClose]);

  const hasPrev = drawingsList.length > 1 && currentIdx > 0;
  const hasNext = drawingsList.length > 1 && currentIdx < drawingsList.length - 1;
  const navBtnStyle = (enabled) => ({
    background: enabled ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.2)", color: enabled ? "#fff" : "rgba(255,255,255,0.25)",
    padding: "7px 12px", fontSize: 14, fontWeight: 600, cursor: enabled ? "pointer" : "default",
    lineHeight: 1, fontFamily: "Inter, Arial, sans-serif",
  });

  return (
    <div style={{ position: "fixed", inset: 0, background: "#1a1a1a", zIndex: 2000, display: "flex", flexDirection: "column" }}>
      {/* Header bar */}
      <div style={{ background: ARC_NAVY, padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
          {/* Prev button */}
          {drawingsList.length > 1 && (
            <button className="btn" onClick={() => hasPrev && setCurrentIdx(i => i - 1)} style={navBtnStyle(hasPrev)} title="Previous drawing (←)">‹</button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{drawing.title}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 2, display: "flex", gap: 16 }}>
              {drawing.drawing_number && <span>{drawing.drawing_number}</span>}
              {drawing.revision && <span>Rev. {drawing.revision}</span>}
              {drawing.status && <span>{drawing.status}</span>}
              {drawing.scale && <span>{drawing.scale}</span>}
              {drawingsList.length > 1 && <span style={{ color: "rgba(255,255,255,0.4)" }}>{currentIdx + 1} / {drawingsList.length}</span>}
            </div>
          </div>
          {/* Next button */}
          {drawingsList.length > 1 && (
            <button className="btn" onClick={() => hasNext && setCurrentIdx(i => i + 1)} style={navBtnStyle(hasNext)} title="Next drawing (→)">›</button>
          )}
        </div>
        <button className="btn" onClick={onClose}
          style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", padding: "7px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", marginLeft: 16, flexShrink: 0 }}>
          Close ✕
        </button>
      </div>
      {/* Full screen PDF */}
      <div style={{ flex: 1, background: "#525659", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {loading && <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#fff", fontSize: 13 }}><Spinner size={14} /> Loading drawing…</div>}
        {error && <p style={{ fontSize: 13, color: ARC_TERRACOTTA }}>{error}</p>}
        {pdfUrl && !loading && <iframe src={pdfUrl} style={{ width: "100%", height: "100%", border: "none" }} title={drawing.title} />}
      </div>
    </div>
  );
}

// ── File type badge ───────────────────────────────────────────────────────────
function FileTypeBadge({ fileName }) {
  const ext = (fileName || "").split(".").pop().toLowerCase();
  const isDwg = ext === "dwg";
  return (
    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 5px", marginLeft: 6, background: isDwg ? "#fff3e0" : "#e8f0f8", color: isDwg ? "#c25a45" : "#2a6496", border: `1px solid ${isDwg ? "#f5c89a" : "#b8d0e8"}` }}>
      {isDwg ? "DWG" : "PDF"}
    </span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  if (!status) return <span style={{ color: "#b0a8a0", fontSize: 11 }}>—</span>;
  return (
    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", padding: "2px 8px", background: "#f0ede8", color: "#9a7060", whiteSpace: "nowrap" }}>
      {status}
    </span>
  );
}

// ── Drawing row (used in register and in QA results) ──────────────────────────
function DrawingRow({ d, projectId, isAdmin, onUpdate, onDelete, onView, downloadingId, onDownload, highlight = false, selectable = false, selected = false, onSelect }) {
  const COLS = selectable
    ? "32px minmax(180px,220px) 1fr 60px minmax(70px,120px) 80px 120px 90px 80px 36px 36px 36px"
    : "minmax(180px,220px) 1fr 60px minmax(70px,120px) 80px 120px 90px 80px 36px 36px 36px";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: COLS,
      gap: "0 10px", padding: "9px 16px", alignItems: "center",
      background: selected ? "#eef6ff" : highlight ? "#f0f8f0" : "inherit",
      borderBottom: "1px solid #f0ede8", minWidth: 900,
    }}>
      {selectable && (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <input type="checkbox" checked={selected} onChange={() => onSelect(d.id)}
            style={{ cursor: "pointer", width: 14, height: 14, accentColor: ARC_NAVY }} />
        </div>
      )}
      {/* Drawing number */}
      <div style={{ fontSize: 11, fontWeight: 600, color: ARC_NAVY, display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
        {isAdmin && onUpdate
          ? <EditableField value={d.drawing_number} onSave={v => onUpdate(d.id, "drawing_number", v)} placeholder="—" style={{ fontSize: 11 }} />
          : <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.drawing_number || "—"}</span>}
        <FileTypeBadge fileName={d.file_name} />
      </div>
      {/* Title */}
      <div style={{ fontSize: 13, color: ARC_NAVY, minWidth: 0, overflow: "hidden" }}>
        {isAdmin && onUpdate
          ? <EditableField value={d.title} onSave={v => onUpdate(d.id, "title", v)} placeholder="Untitled" />
          : <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>}
      </div>
      {/* Revision */}
      <div style={{ fontSize: 12, fontWeight: 600, color: ARC_NAVY, textAlign: "center" }}>
        {isAdmin && onUpdate
          ? <EditableField value={d.revision} onSave={v => onUpdate(d.id, "revision", v)} placeholder="—" style={{ fontSize: 12, textAlign: "center" }} />
          : <span>{d.revision || "—"}</span>}
      </div>
      {/* Status */}
      <div><StatusBadge status={d.status} /></div>
      {/* Scale */}
      <div style={{ fontSize: 11, color: "#9a9088", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.scale || "—"}</div>
      {/* Type */}
      <div style={{ minWidth: 0 }}>
        {isAdmin && onUpdate ? (
          <select value={d.drawing_type || ""} onChange={e => onUpdate(d.id, "drawing_type", e.target.value)}
            style={{ width: "100%", border: "1px solid #ddd8d0", padding: "3px 5px", fontSize: 11, fontFamily: "Inter, Arial, sans-serif", color: d.drawing_type ? ARC_NAVY : "#b0a8a0", outline: "none", background: "#fff" }}>
            <option value="">— type —</option>
            {DRAWING_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        ) : (
          <span style={{ fontSize: 11, color: d.drawing_type ? ARC_NAVY : "#b0a8a0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
            {d.drawing_type || "—"}
          </span>
        )}
      </div>
      {/* Volume */}
      <div style={{ fontSize: 11, color: "#9a9088", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {isAdmin && onUpdate
          ? <EditableField value={d.volume} onSave={v => onUpdate(d.id, "volume", v)} placeholder="—" style={{ fontSize: 11 }} />
          : <span>{d.volume || "—"}</span>}
      </div>
      {/* Level */}
      <div style={{ fontSize: 11, color: "#9a9088", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {isAdmin && onUpdate
          ? <EditableField value={d.level} onSave={v => onUpdate(d.id, "level", v)} placeholder="—" style={{ fontSize: 11 }} />
          : <span>{d.level || "—"}</span>}
      </div>
      {/* Download */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <button className="btn" onClick={() => onDownload(d)} disabled={downloadingId === d.id} title="Download"
          style={{ background: "none", border: "1px solid #ddd8d0", color: "#9a9088", padding: "4px 8px", fontSize: 13, lineHeight: 1 }}
          onMouseEnter={e => e.currentTarget.style.color = ARC_NAVY} onMouseLeave={e => e.currentTarget.style.color = "#9a9088"}>
          {downloadingId === d.id ? <Spinner size={11} /> : "↓"}
        </button>
      </div>
      {/* Quick view */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        {!(d.file_name || "").endsWith(".dwg") && (
          <button className="btn" onClick={() => onView(d)} title="Full screen view"
            style={{ background: "none", border: "1px solid #ddd8d0", color: "#9a9088", padding: "4px 8px", fontSize: 12, lineHeight: 1 }}
            onMouseEnter={e => e.currentTarget.style.color = ARC_NAVY} onMouseLeave={e => e.currentTarget.style.color = "#9a9088"}>👁</button>
        )}
      </div>
      {/* Delete */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        {isAdmin && onDelete && (
          <button className="btn" onClick={() => onDelete(d.id)} title="Delete"
            style={{ background: "none", border: "none", color: "#c8c0b8", fontSize: 16, padding: "0 4px", lineHeight: 1 }}
            onMouseEnter={e => e.currentTarget.style.color = ARC_TERRACOTTA} onMouseLeave={e => e.currentTarget.style.color = "#c8c0b8"}>×</button>
        )}
      </div>
    </div>
  );
}

// ── QA Bar ────────────────────────────────────────────────────────────────────
function QABar({ project, consultants, uvalues, notes, drawings, projectId }) {
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

  useEffect(() => {
    async function loadProducts() {
      try {
        const [{ products }, { categories }] = await Promise.all([
          api(`/api/projects/${projectId}/products`),
          api(`/api/projects/${projectId}/categories`),
        ]);
        setAssignedProducts(products || []);
        setProductCategories(categories || []);
      } catch (e) { /* non-critical — QA still works without it */ }
    }
    loadProducts();
  }, [projectId]);

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
    } catch (e) { console.error("Download failed:", e); }
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
        } catch (e) { console.error("Failed to fetch drawing:", drawing.id, e); }
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      const safeName = (lastQuestion || "drawings").replace(/[^a-z0-9]/gi, "-").slice(0, 40);
      a.download = `drawings-${safeName}.zip`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) { console.error("Download all failed:", e); }
    setDownloadingAll(false);
  }

  async function ask() {
    if (!question.trim() || running) return;
    const q = question.trim();
    setLastQuestion(q);
    setQuestion(""); setRunning(true); setAnswer(null); setMatchedDrawings([]); setMatchedProducts([]); setExpandedProductId(null); setExpanded(true); setStatus("Thinking…");

    // Build drawing register context
    const drawingContext = drawings.length === 0
      ? "No drawings in register."
      : drawings.map(d =>
          `ID:${d.id} | ${d.drawing_number || "—"} | ${d.title || "Untitled"} | Rev:${d.revision || "—"} | Status:${d.status || "—"} | Scale:${d.scale || "—"} | Date:${d.issue_date || "—"} | File:${d.file_name || "—"}`
        ).join("\n");

    // Build assigned products context — grouped by category with full attributes
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

    const ctx = `PROJECT: ${project.name}
Job Number: ${project.job_number || "—"}
Client: ${project.client || "—"}
Location: ${project.location || "—"}
Project Lead: ${project.project_lead || "—"}
RIBA Stage: ${project.stage || "—"}
Status: ${project.status || "active"}
Description: ${project.description || "—"}

CONSULTANTS:
${consultants.length === 0 ? "None recorded." : consultants.map(c => `${c.discipline || "Unknown"} — ${c.company || ""}${c.contact_name ? ` (${c.contact_name})` : ""}${c.email ? ` · ${c.email}` : ""}${c.phone ? ` · ${c.phone}` : ""}`).join("\n")}

U-VALUE REQUIREMENTS:
${uvalues.length === 0 ? "None recorded." : uvalues.map(u => `${u.element}: Target ${u.target !== null ? u.target + " W/m²K" : "not set"}, Achieved ${u.achieved !== null ? u.achieved + " W/m²K" : "not set"}${u.notes ? ` — ${u.notes}` : ""}`).join("\n")}

ADDITIONAL NOTES:
${notes.length === 0 ? "None recorded." : notes.map(n => `${n.label}: ${n.value}`).join("\n")}

SPECIFIED PRODUCTS:
${productsContext}

DRAWING REGISTER (${drawings.length} drawings):
${drawingContext}`;

    const systemPrompt = `You are a project assistant for an architectural practice. You have full access to the project data provided — including project info, consultants, U-values, notes, specified products (with full technical attributes), and the drawing register.

Answer questions with appropriate detail based on the project data. Do not say you cannot access information — everything you need is in the context provided.

Return a JSON object with this exact structure:
{
  "answer": "Your response here — as detailed as the question requires",
  "drawing_ids": ["id1", "id2"],
  "product_ids": ["id1", "id2"]
}

Rules:
- Always populate "answer" with a helpful, direct response. For technical questions (fire ratings, U-values, certifications etc) include the specific values from the product attributes.
- Only populate "drawing_ids" when the question is specifically about finding or listing drawings
- Only populate "product_ids" when the answer references one or more specific products — use the product IDs from the SPECIFIED PRODUCTS context (the id field in the products join, format: uuid)
- Never say you don't have access to information — use what is in the context
- Do not include any text outside the JSON object`;

    try {
      const { text } = await callClaude(
        [{ role: "user", content: `${ctx}\n\n---\n\nQUESTION: ${q}` }],
        systemPrompt, 3000, 1, "gemini-2.5-flash"
      );

      let answerText = text;
      let matchedDrawingIds = [];
      let matchedProductIds = [];
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (typeof parsed.answer === "string" && parsed.answer.trim()) {
            answerText = parsed.answer;
          }
          if (Array.isArray(parsed.drawing_ids) && parsed.drawing_ids.length > 0) {
            matchedDrawingIds = parsed.drawing_ids;
          }
          if (Array.isArray(parsed.product_ids) && parsed.product_ids.length > 0) {
            matchedProductIds = parsed.product_ids;
          }
        }
      } catch (parseErr) {
        // fall through — answerText remains the raw text
      }
      setAnswer(answerText);
      if (matchedDrawingIds.length > 0) {
        setMatchedDrawings(drawings.filter(d => matchedDrawingIds.includes(d.id)));
      }
      if (matchedProductIds.length > 0) {
        setMatchedProducts(assignedProducts.filter(a => a.products && matchedProductIds.includes(a.products.id)));
      }
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
    } catch (e) { console.error(e); }
    setPdfLoading(false);
  }

  function closePdf() {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null);
    setViewingPdfProduct(null);
  }

  const hasResults = answer || running || status || matchedDrawings.length > 0 || matchedProducts.length > 0;

  return (
    <div style={{ borderTop: "1px solid #e8e0d5", background: "#ffffff", flexShrink: 0 }}>
      {expanded && hasResults && (
        <div style={{ borderBottom: "1px solid #f0ede8", background: "#faf8f5", maxHeight: 400, overflowY: "auto", animation: "fadeIn 0.3s ease" }}>
          {running && (
            <div style={{ padding: "14px 32px", display: "flex", alignItems: "center", gap: 8, color: "#9a9088", fontSize: 12 }}>
              <Spinner size={11} /> {status}
            </div>
          )}
          {answer && (
            <div style={{ padding: "14px 32px", borderBottom: (matchedDrawings.length > 0 || matchedProducts.length > 0) ? "1px solid #e8e0d5" : "none" }}>
              <AnswerRenderer text={answer} />
            </div>
          )}
          {!running && status && (
            <div style={{ padding: "14px 32px" }}>
              <p style={{ fontSize: 12, color: ARC_TERRACOTTA }}>{status}</p>
            </div>
          )}
          {/* Matched products */}
          {matchedProducts.length > 0 && (
            <div>
              <div style={{ padding: "8px 16px", background: "#f0ede8", display: "flex", alignItems: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {matchedProducts.length} product{matchedProducts.length !== 1 ? "s" : ""} referenced
                </span>
              </div>
              {matchedProducts.map((a, i) => {
                const p = a.products;
                if (!p) return null;
                const cat = productCategories.find(c => c.id === a.category_id);
                const isExpanded = expandedProductId === p.id;
                const hasAttrs = p.attributes && p.attributes.length > 0;
                return (
                  <div key={a.id} style={{ borderBottom: i < matchedProducts.length - 1 ? "1px solid #f0ede8" : "none", background: i % 2 === 0 ? "#faf8f5" : "#fff" }}>
                    {/* Product row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px" }}>
                      <div style={{ flex: 1, minWidth: 0, cursor: hasAttrs ? "pointer" : "default" }}
                        onClick={() => hasAttrs && setExpandedProductId(isExpanded ? null : p.id)}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: ARC_NAVY }}>{p.name}</div>
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
                    {/* Attributes table */}
                    {isExpanded && hasAttrs && (
                      <div style={{ borderTop: "1px solid #e8e0d5", padding: "0 16px 12px" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "Inter, Arial, sans-serif" }}>
                          <thead>
                            <tr>
                              <th style={{ background: ARC_NAVY, color: "#fff", padding: "5px 12px", textAlign: "left", fontWeight: 500, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", width: "35%" }}>Attribute</th>
                              <th style={{ background: ARC_NAVY, color: "#fff", padding: "5px 12px", textAlign: "left", fontWeight: 500, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase" }}>Value</th>
                              <th style={{ background: ARC_NAVY, color: "#fff", padding: "5px 12px", textAlign: "left", fontWeight: 500, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", width: "15%" }}>Unit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.attributes.map((attr, j) => (
                              <tr key={j} style={{ background: j % 2 === 0 ? "#f9f7f5" : "#fff" }}>
                                <td style={{ padding: "6px 12px", borderBottom: "1px solid #e8e0d5", color: "#5a5048", fontWeight: 500 }}>{attr.attribute}</td>
                                <td style={{ padding: "6px 12px", borderBottom: "1px solid #e8e0d5", color: ARC_NAVY }}>{attr.value}</td>
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
          {matchedDrawings.length > 0 && (
            <div>
              {/* Results header */}
              <div style={{ padding: "8px 16px", background: "#f0ede8", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {matchedDrawings.length} drawing{matchedDrawings.length !== 1 ? "s" : ""} found
                </span>
                <button className="btn" onClick={downloadAll} disabled={downloadingAll}
                  style={{ fontSize: 10, fontWeight: 600, color: ARC_NAVY, background: "none", border: `1px solid ${ARC_NAVY}`, padding: "3px 10px", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 5 }}>
                  {downloadingAll ? <><Spinner size={10} /> Downloading…</> : "↓ Download All"}
                </button>
              </div>
              {/* Column headers */}
              <div style={{ display: "grid", gridTemplateColumns: "minmax(200px,240px) 1fr 60px minmax(80px,140px) 80px 36px 36px 36px", gap: "0 12px", padding: "6px 16px", background: ARC_NAVY }}>
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
      )}

      <div style={{ padding: "12px 32px", display: "flex", alignItems: "stretch" }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "flex", alignItems: "center", paddingRight: 12, flexShrink: 0 }}>Ask</div>
        <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === "Enter") ask(); }}
          placeholder="Ask anything about this project, or find drawings — e.g. 'show me all 1:200 floor plans'"
          className="arc-input"
          style={{ flex: 1, border: "1px solid #ddd8d0", borderRight: "none", padding: "8px 14px", fontSize: 13, color: ARC_NAVY, outline: "none", fontFamily: "Inter, Arial, sans-serif", background: "#fff" }} />
        <button className="btn" onClick={ask} disabled={!question.trim() || running}
          style={{ background: question.trim() && !running ? ARC_NAVY : "#f0ede8", color: question.trim() && !running ? "#fff" : "#9a9088", padding: "0 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", border: `1px solid ${question.trim() && !running ? ARC_NAVY : "#ddd8d0"}`, minWidth: 70 }}>
          {running ? <Spinner size={12} /> : "Ask"}
        </button>
        {hasResults && (
          <button className="btn" onClick={() => { setAnswer(null); setMatchedDrawings([]); setMatchedProducts([]); setExpandedProductId(null); setStatus(""); setExpanded(false); }}
            style={{ background: "none", color: "#9a9088", padding: "0 10px", fontSize: 11, border: "1px solid #ddd8d0", borderLeft: "none", marginLeft: -1 }}>Clear</button>
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

      {/* Product datasheet viewer */}
      {viewingPdfProduct && (
        <div style={{ position: "fixed", inset: 0, background: "#1a1a1a", zIndex: 2000, display: "flex", flexDirection: "column" }}>
          <div style={{ background: ARC_NAVY, padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
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

// ── Products tab ──────────────────────────────────────────────────────────────
function ProductsTab({ projectId, isAdmin }) {
  const [categories, setCategories] = useState([]);
  const [assignments, setAssignments] = useState([]); // project_products rows with joined product
  const [allProducts, setAllProducts] = useState([]);  // full library for picker
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState({});      // categoryId → bool

  // Add-product picker modal
  const [pickerCategoryId, setPickerCategoryId] = useState(null);
  const [pickerSearch, setPickerSearch] = useState("");

  // Add-category form
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);

  // Move-to-category dropdown state
  const [movingId, setMovingId] = useState(null); // assignment id being moved

  // PDF quick-view
  const [viewingProduct, setViewingProduct] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    try {
      const [catData, assignData, libData] = await Promise.all([
        api(`/api/projects/${projectId}/categories`),
        api(`/api/projects/${projectId}/products`),
        api("/api/products"),
      ]);
      setCategories(catData.categories || []);
      setAssignments(assignData.products || []);
      setAllProducts(libData.products || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  // ── Category actions ────────────────────────────────────────────────────────
  async function addCategory() {
    if (!newCategoryName.trim()) return;
    setSavingCategory(true);
    try {
      const { category } = await api(`/api/projects/${projectId}/categories`, {
        method: "POST",
        body: { name: newCategoryName.trim(), sort_order: categories.length },
      });
      setCategories(prev => [...prev, category]);
      setNewCategoryName(""); setAddingCategory(false);
    } catch (e) { console.error(e); }
    setSavingCategory(false);
  }

  async function deleteCategory(catId) {
    const cat = categories.find(c => c.id === catId);
    if (!window.confirm(`Delete category "${cat?.name}"? Products in it will be moved to Uncategorised.`)) return;
    try {
      await api(`/api/projects/${projectId}/categories/${catId}`, { method: "DELETE" });
      // Reload to get reassigned products reflected correctly
      await load();
    } catch (e) { console.error(e); }
  }

  // ── Product assignment actions ──────────────────────────────────────────────
  async function assignProduct(productId, categoryId) {
    try {
      const { product } = await api(`/api/projects/${projectId}/products`, {
        method: "POST",
        body: { product_id: productId, category_id: categoryId },
      });
      setAssignments(prev => [...prev, product]);
    } catch (e) {
      if (e.message?.includes("409") || e.message?.includes("already")) return; // silently skip duplicate
      console.error(e);
    }
    setPickerCategoryId(null);
    setPickerSearch("");
  }

  async function removeAssignment(assignmentId) {
    try {
      await api(`/api/projects/${projectId}/products/${assignmentId}`, { method: "DELETE" });
      setAssignments(prev => prev.filter(a => a.id !== assignmentId));
    } catch (e) { console.error(e); }
  }

  async function moveAssignment(assignmentId, newCategoryId) {
    try {
      const { product } = await api(`/api/projects/${projectId}/products/${assignmentId}`, {
        method: "PATCH",
        body: { category_id: newCategoryId },
      });
      setAssignments(prev => prev.map(a => a.id === assignmentId ? product : a));
    } catch (e) { console.error(e); }
    setMovingId(null);
  }

  // ── PDF viewer ──────────────────────────────────────────────────────────────
  async function viewDatasheet(product) {
    setViewingProduct(product);
    setPdfLoading(true);
    setPdfUrl(null);
    try {
      const data = await api(`/api/products/${product.id}/pdf`);
      const bytes = atob(data.base64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const blob = new Blob([arr], { type: "application/pdf" });
      setPdfUrl(URL.createObjectURL(blob));
    } catch (e) { console.error(e); }
    setPdfLoading(false);
  }

  function closePdf() {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null);
    setViewingProduct(null);
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  const assignedProductIds = new Set(assignments.map(a => a.product_id));

  function assignmentsForCategory(catId) {
    return assignments.filter(a => a.category_id === catId);
  }

  // Products available for a given category picker (not yet assigned to this project)
  const pickerProducts = allProducts
    .filter(p => !assignedProductIds.has(p.id))
    .filter(p => {
      if (!pickerSearch.trim()) return true;
      const q = pickerSearch.toLowerCase();
      return (p.name || "").toLowerCase().includes(q) || (p.manufacturer || "").toLowerCase().includes(q);
    });

  const totalAssigned = assignments.length;

  // ── Shared styles ───────────────────────────────────────────────────────────
  const smallLabel = { fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase" };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9a9088", fontSize: 13 }}>
      <Spinner size={13} /> Loading products…
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h3 style={{ fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.1em", textTransform: "uppercase" }}>Specified Products</h3>
          {totalAssigned > 0 && <p style={{ fontSize: 11, color: "#b0a8a0", marginTop: 3 }}>{totalAssigned} product{totalAssigned !== 1 ? "s" : ""} assigned</p>}
        </div>
      </div>

      {/* Category sections */}
      {categories.map(cat => {
        const catAssignments = assignmentsForCategory(cat.id);
        const isCollapsed = collapsed[cat.id];
        return (
          <div key={cat.id} style={{ marginBottom: 12 }}>
            {/* Category header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: ARC_NAVY, padding: "8px 14px", cursor: "pointer" }}
              onClick={() => setCollapsed(prev => ({ ...prev, [cat.id]: !prev[cat.id] }))}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fff", flex: 1 }}>
                {cat.name}
              </span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginRight: 4 }}>
                {catAssignments.length > 0 ? `${catAssignments.length}` : ""}
              </span>
              {isAdmin && (
                <button className="btn" onClick={e => { e.stopPropagation(); setPickerCategoryId(cat.id); setPickerSearch(""); }}
                  style={{ fontSize: 10, color: "#fff", background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", padding: "2px 10px", fontWeight: 600, letterSpacing: "0.04em" }}>
                  + Add
                </button>
              )}
              {isAdmin && cat.name !== "Uncategorised" && (
                <button className="btn" onClick={e => { e.stopPropagation(); deleteCategory(cat.id); }}
                  style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", background: "none", border: "none", padding: "0 4px", lineHeight: 1 }}
                  onMouseEnter={e => e.target.style.color = ARC_TERRACOTTA}
                  onMouseLeave={e => e.target.style.color = "rgba(255,255,255,0.4)"}>×</button>
              )}
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginLeft: 2 }}>{isCollapsed ? "▶" : "▼"}</span>
            </div>

            {/* Product rows */}
            {!isCollapsed && (
              <div style={{ background: "#fff", border: "1px solid #e8e0d5", borderTop: "none" }}>
                {catAssignments.length === 0 ? (
                  <div style={{ padding: "14px 16px", fontSize: 12, color: "#b0a8a0", fontStyle: "italic" }}>
                    No products in this category.{isAdmin && " Click + Add to assign one."}
                  </div>
                ) : (
                  catAssignments.map((a, i) => {
                    const prod = a.products;
                    if (!prod) return null;
                    return (
                      <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: i < catAssignments.length - 1 ? "1px solid #f0ede8" : "none", background: i % 2 === 0 ? "#faf8f5" : "#fff" }}>
                        {/* Product info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: ARC_NAVY, marginBottom: 1 }}>{prod.name}</div>
                          <div style={{ fontSize: 11, color: "#9a9088" }}>{prod.manufacturer || "—"}</div>
                        </div>
                        {/* Type badge */}
                        {prod.product_type && (
                          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "#2a6496", background: "#e8f0f8", padding: "2px 7px", flexShrink: 0 }}>
                            {prod.product_type}
                          </span>
                        )}
                        {/* Datasheet button */}
                        {prod.file_key && (
                          <button className="btn" onClick={() => viewDatasheet(prod)}
                            style={{ fontSize: 11, color: "#2a6496", background: "none", border: "1px solid #b8d0e8", padding: "3px 10px", flexShrink: 0, fontWeight: 500 }}>
                            📄 Datasheet
                          </button>
                        )}
                        {/* Move to category */}
                        {isAdmin && (
                          movingId === a.id ? (
                            <select autoFocus defaultValue={a.category_id || ""}
                              onChange={e => { if (e.target.value) moveAssignment(a.id, e.target.value); else setMovingId(null); }}
                              onBlur={() => setMovingId(null)}
                              style={{ fontSize: 11, padding: "3px 6px", border: "1px solid #ddd8d0", fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY }}>
                              <option value="">— cancel —</option>
                              {categories.filter(c => c.id !== a.category_id).map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          ) : (
                            <button className="btn" onClick={() => setMovingId(a.id)}
                              title="Move to another category"
                              style={{ fontSize: 11, color: "#9a9088", background: "none", border: "1px solid #ddd8d0", padding: "3px 8px", flexShrink: 0 }}>
                              ⇄
                            </button>
                          )
                        )}
                        {/* Remove */}
                        {isAdmin && (
                          <button className="btn" onClick={() => removeAssignment(a.id)}
                            style={{ fontSize: 14, color: "#c8c0b8", background: "none", border: "none", padding: "0 4px", flexShrink: 0 }}
                            onMouseEnter={e => e.target.style.color = ARC_TERRACOTTA}
                            onMouseLeave={e => e.target.style.color = "#c8c0b8"}>×</button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Add category */}
      {isAdmin && (
        <div style={{ marginTop: 16 }}>
          {addingCategory ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} autoFocus
                placeholder="Category name…"
                onKeyDown={e => { if (e.key === "Enter") addCategory(); if (e.key === "Escape") { setAddingCategory(false); setNewCategoryName(""); } }}
                style={{ flex: 1, border: "1px solid #ddd8d0", padding: "7px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none" }} />
              <button className="btn" onClick={addCategory} disabled={!newCategoryName.trim() || savingCategory}
                style={{ background: AD_GREEN, color: "#fff", padding: "7px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {savingCategory ? <Spinner size={11} /> : "Add"}
              </button>
              <button className="btn" onClick={() => { setAddingCategory(false); setNewCategoryName(""); }}
                style={{ background: "none", color: "#9a9088", padding: "7px 12px", fontSize: 11, border: "1px solid #ddd8d0" }}>Cancel</button>
            </div>
          ) : (
            <button className="btn" onClick={() => setAddingCategory(true)}
              style={{ fontSize: 11, color: "#9a9088", background: "none", border: "1px solid #ddd8d0", padding: "6px 16px", fontWeight: 600, letterSpacing: "0.04em" }}>
              + Add Category
            </button>
          )}
        </div>
      )}

      {/* Product picker modal */}
      {pickerCategoryId !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", width: 520, maxHeight: "80vh", display: "flex", flexDirection: "column", borderTop: `3px solid ${AD_GREEN}`, fontFamily: "Inter, Arial, sans-serif" }}>
            <div style={{ padding: "20px 24px 14px", borderBottom: "1px solid #e8e0d5", flexShrink: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: ARC_NAVY, marginBottom: 12 }}>
                Add Product — {categories.find(c => c.id === pickerCategoryId)?.name}
              </div>
              <input value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} autoFocus
                placeholder="Search by name or manufacturer…"
                style={{ width: "100%", border: "1px solid #ddd8d0", padding: "8px 12px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
              {allProducts.length === 0 ? (
                <div style={{ padding: "32px", textAlign: "center", fontSize: 13, color: "#9a9088" }}>No products in the library yet.</div>
              ) : pickerProducts.length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", fontSize: 13, color: "#9a9088" }}>
                  {assignedProductIds.size === allProducts.length ? "All library products are already assigned to this project." : "No products match your search."}
                </div>
              ) : (
                pickerProducts.map(p => (
                  <div key={p.id}
                    onClick={() => assignProduct(p.id, pickerCategoryId)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 24px", cursor: "pointer", borderBottom: "1px solid #f0ede8" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f0f8f0"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: ARC_NAVY }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: "#9a9088", marginTop: 1 }}>{p.manufacturer || "—"}</div>
                    </div>
                    {p.product_type && (
                      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "#2a6496", background: "#e8f0f8", padding: "2px 7px", flexShrink: 0 }}>
                        {p.product_type}
                      </span>
                    )}
                    <span style={{ fontSize: 18, color: AD_GREEN, flexShrink: 0 }}>+</span>
                  </div>
                ))
              )}
            </div>
            <div style={{ padding: "12px 24px", borderTop: "1px solid #e8e0d5", flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => { setPickerCategoryId(null); setPickerSearch(""); }}
                style={{ background: "none", color: "#9a9088", padding: "7px 16px", fontSize: 11, border: "1px solid #ddd8d0" }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* PDF viewer modal */}
      {viewingProduct && (
        <div style={{ position: "fixed", inset: 0, background: "#1a1a1a", zIndex: 2000, display: "flex", flexDirection: "column" }}>
          <div style={{ background: ARC_NAVY, padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{viewingProduct.name}</div>
              {viewingProduct.manufacturer && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>{viewingProduct.manufacturer}</div>}
            </div>
            <button className="btn" onClick={closePdf}
              style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", padding: "7px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em" }}>
              Close ✕
            </button>
          </div>
          <div style={{ flex: 1, background: "#525659", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {pdfLoading && <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#fff", fontSize: 13 }}><Spinner size={14} /> Loading datasheet…</div>}
            {pdfUrl && !pdfLoading && <iframe src={pdfUrl} style={{ width: "100%", height: "100%", border: "none" }} title={viewingProduct.name} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Placeholder tab ───────────────────────────────────────────────────────────
function PlaceholderTab({ icon, title, description }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 40px", textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
      <p style={{ fontSize: 16, color: ARC_NAVY, fontWeight: 300, fontFamily: "Inter, Arial, sans-serif", marginBottom: 8 }}>{title}</p>
      <p style={{ fontSize: 12, color: "#9a9088", maxWidth: 360, lineHeight: 1.7 }}>{description}</p>
      <div style={{ marginTop: 20, fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#b0a8a0", border: "1px solid #e8e0d5", padding: "4px 12px" }}>Coming Soon</div>
    </div>
  );
}

// ── Drawings tab ──────────────────────────────────────────────────────────────
function DrawingsTab({ projectId, isAdmin, onDrawingsLoaded }) {
  const [drawings, setDrawings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);
  const [viewingDrawing, setViewingDrawing] = useState(null);
  const fileInputRef = useRef(null);

  // Multi-select
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [downloadingSelected, setDownloadingSelected] = useState(false);

  // Filters
  const [filterText, setFilterText] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterVolume, setFilterVolume] = useState("");
  const [filterLevel, setFilterLevel] = useState("");
  const [filterDrawingType, setFilterDrawingType] = useState("");
  const [filterFileType, setFilterFileType] = useState("");

  const emptyForm = { title: "", drawing_number: "", revision: "", status: "" };
  const [form, setForm] = useState(emptyForm);
  const [selectedFile, setSelectedFile] = useState(null);

  useEffect(() => { loadDrawings(); }, [projectId]);

  async function loadDrawings() {
    setLoading(true);
    try {
      const { drawings: data } = await api(`/api/projects/${projectId}/drawings`);
      const loaded = data || [];
      setDrawings(loaded);
      if (onDrawingsLoaded) onDrawingsLoaded(loaded);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["pdf", "dwg"].includes(ext)) { setUploadError("Only PDF and DWG files are supported."); return; }
    setUploadError("");
    setSelectedFile(file);
    if (!form.title) {
      const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
      setForm(f => ({ ...f, title: baseName }));
    }
  }

  async function handleUpload() {
    if (!selectedFile || !form.title.trim()) return;
    setUploading(true); setUploadError("");
    try {
      const base64 = await fileToBase64(selectedFile);
      const { drawing } = await api(`/api/projects/${projectId}/drawings`, {
        method: "POST",
        body: { title: form.title.trim(), drawing_number: form.drawing_number.trim(), revision: form.revision.trim(), status: form.status, file_name: selectedFile.name, file_size: selectedFile.size, base64 },
      });
      const updated = [drawing, ...drawings];
      setDrawings(updated);
      if (onDrawingsLoaded) onDrawingsLoaded(updated);
      setForm(emptyForm); setSelectedFile(null); setShowUpload(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) { setUploadError("Upload failed: " + e.message); }
    setUploading(false);
  }

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
    } catch (e) { console.error("Download failed:", e); }
    setDownloadingId(null);
  }

  async function handleDelete(drawingId) {
    if (!window.confirm("Delete this drawing? This cannot be undone.")) return;
    try {
      await api(`/api/projects/${projectId}/drawings/${drawingId}`, { method: "DELETE" });
      const updated = drawings.filter(d => d.id !== drawingId);
      setDrawings(updated);
      if (onDrawingsLoaded) onDrawingsLoaded(updated);
    } catch (e) { console.error(e); }
  }

  async function updateField(drawingId, field, value) {
    try {
      const { drawing } = await api(`/api/projects/${projectId}/drawings/${drawingId}`, { method: "PATCH", body: { [field]: value } });
      const updated = drawings.map(d => d.id === drawingId ? drawing : d);
      setDrawings(updated);
      if (onDrawingsLoaded) onDrawingsLoaded(updated);
    } catch (e) { console.error(e); }
  }

  function cancelUpload() {
    setShowUpload(false); setForm(emptyForm); setSelectedFile(null); setUploadError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Filtered list
  const filteredDrawings = drawings.filter(d => {
    if (filterText) {
      const q = filterText.toLowerCase();
      if (!((d.drawing_number || "").toLowerCase().includes(q) || (d.title || "").toLowerCase().includes(q))) return false;
    }
    if (filterDrawingType && d.drawing_type !== filterDrawingType) return false;
    if (filterVolume && d.volume !== filterVolume) return false;
    if (filterLevel && d.level !== filterLevel) return false;
    if (filterFileType) {
      const ext = (d.file_name || "").split(".").pop().toLowerCase();
      if (filterFileType === "pdf" && ext !== "pdf") return false;
      if (filterFileType === "dwg" && ext !== "dwg") return false;
    }
    return true;
  });

  // Unique values for filter dropdowns (from actual data)
  const drawingTypeOptions = [...new Set(drawings.map(d => d.drawing_type).filter(Boolean))].sort();
  const volumeOptions = [...new Set(drawings.map(d => d.volume).filter(Boolean))].sort();
  const levelOptions = [...new Set(drawings.map(d => d.level).filter(Boolean))].sort();
  const hasFilters = filterText || filterDrawingType || filterVolume || filterLevel || filterFileType;

  function clearFilters() {
    setFilterText(""); setFilterDrawingType(""); setFilterVolume(""); setFilterLevel(""); setFilterFileType("");
    setSelectedIds(new Set());
  }

  // Select / deselect
  function toggleSelect(id) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleSelectAll() {
    if (selectedIds.size === filteredDrawings.length && filteredDrawings.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDrawings.map(d => d.id)));
    }
  }
  const allSelected = filteredDrawings.length > 0 && selectedIds.size === filteredDrawings.length;
  const someSelected = selectedIds.size > 0;

  async function deleteSelected() {
    if (!window.confirm(`Delete ${selectedIds.size} drawing${selectedIds.size !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    setDeletingSelected(true);
    for (const id of [...selectedIds]) {
      try { await api(`/api/projects/${projectId}/drawings/${id}`, { method: "DELETE" }); } catch (e) { console.error(e); }
    }
    const updated = drawings.filter(d => !selectedIds.has(d.id));
    setDrawings(updated);
    if (onDrawingsLoaded) onDrawingsLoaded(updated);
    setSelectedIds(new Set());
    setDeletingSelected(false);
  }

  async function downloadSelected() {
    if (selectedIds.size === 0 || downloadingSelected) return;
    setDownloadingSelected(true);
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
      for (const drawing of drawings.filter(d => selectedIds.has(d.id))) {
        try {
          const { base64, file_name } = await api(`/api/projects/${projectId}/drawings/${drawing.id}/file`);
          zip.file(file_name || drawing.file_name || `${drawing.drawing_number || drawing.id}.pdf`, base64, { base64: true });
        } catch (e) { console.error("Failed:", drawing.id, e); }
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "drawings-selection.zip";
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) { console.error(e); }
    setDownloadingSelected(false);
  }

  const labelStyle = { fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 };
  const inputStyle = { width: "100%", border: "1px solid #ddd8d0", padding: "7px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none", background: "#fff" };
  const filterSelectStyle = { border: "1px solid #ddd8d0", padding: "6px 8px", fontSize: 11, fontFamily: "Inter, Arial, sans-serif", outline: "none", background: "#fff", color: "#9a9088" };
  const COLS = "32px minmax(180px,220px) 1fr 60px minmax(70px,120px) 80px 120px 90px 80px 36px 36px 36px";

  return (
    <div>
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h3 style={{ fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.1em", textTransform: "uppercase" }}>Drawing Register</h3>
        {isAdmin && !showUpload && (
          <button className="btn" onClick={() => setShowUpload(true)}
            style={{ fontSize: 11, color: AD_GREEN, background: "none", border: `1px solid ${AD_GREEN}`, padding: "4px 12px", fontWeight: 600, letterSpacing: "0.04em" }}>
            + Upload Drawing
          </button>
        )}
      </div>

      {/* Upload panel */}
      {showUpload && (
        <div style={{ background: "#fff", border: `1px solid ${AD_GREEN}`, padding: "20px 24px", marginBottom: 20 }}>
          <h4 style={{ fontSize: 12, fontWeight: 600, color: ARC_NAVY, marginBottom: 16, letterSpacing: "0.04em", textTransform: "uppercase" }}>Upload Drawing</h4>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>File (PDF or DWG)</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input ref={fileInputRef} type="file" accept=".pdf,.dwg" onChange={handleFileChange}
                style={{ fontSize: 12, color: ARC_NAVY, fontFamily: "Inter, Arial, sans-serif", flex: 1 }} />
              {selectedFile && <span style={{ fontSize: 11, color: "#9a9088", whiteSpace: "nowrap" }}>{(selectedFile.size / 1024 / 1024).toFixed(1)} MB</span>}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "0 16px" }}>
            <div style={{ marginBottom: 14 }}><label style={labelStyle}>Title *</label><input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Ground Floor Plan" style={inputStyle} /></div>
            <div style={{ marginBottom: 14 }}><label style={labelStyle}>Drawing No.</label><input value={form.drawing_number} onChange={e => setForm(f => ({ ...f, drawing_number: e.target.value }))} placeholder="e.g. A-001" style={inputStyle} /></div>
            <div style={{ marginBottom: 14 }}><label style={labelStyle}>Revision</label><input value={form.revision} onChange={e => setForm(f => ({ ...f, revision: e.target.value }))} placeholder="e.g. P1" style={inputStyle} /></div>
            <div style={{ marginBottom: 14 }}><label style={labelStyle}>Status</label><input value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} placeholder="e.g. Preliminary" style={inputStyle} /></div>
          </div>
          {uploadError && <p style={{ fontSize: 12, color: ARC_TERRACOTTA, marginBottom: 12 }}>{uploadError}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={handleUpload} disabled={!selectedFile || !form.title.trim() || uploading}
              style={{ background: selectedFile && form.title.trim() && !uploading ? AD_GREEN : "#c8c0b8", color: "#fff", padding: "8px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {uploading ? <><Spinner size={12} /> &nbsp;Uploading…</> : "Upload"}
            </button>
            <button className="btn" onClick={cancelUpload} disabled={uploading} style={{ background: "none", color: "#9a9088", padding: "8px 14px", fontSize: 11, border: "1px solid #ddd8d0" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Filter bar */}
      {drawings.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          <input value={filterText} onChange={e => { setFilterText(e.target.value); setSelectedIds(new Set()); }}
            placeholder="Search no. or title…"
            style={{ flex: "1 1 180px", minWidth: 140, border: "1px solid #ddd8d0", padding: "6px 10px", fontSize: 11, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none", background: "#fff" }} />
          {drawingTypeOptions.length > 0 && (
            <select value={filterDrawingType} onChange={e => { setFilterDrawingType(e.target.value); setSelectedIds(new Set()); }} style={filterSelectStyle}>
              <option value="">All types</option>
              {drawingTypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {volumeOptions.length > 0 && (
            <select value={filterVolume} onChange={e => { setFilterVolume(e.target.value); setSelectedIds(new Set()); }} style={filterSelectStyle}>
              <option value="">All volumes</option>
              {volumeOptions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
          {levelOptions.length > 0 && (
            <select value={filterLevel} onChange={e => { setFilterLevel(e.target.value); setSelectedIds(new Set()); }} style={filterSelectStyle}>
              <option value="">All levels</option>
              {levelOptions.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
          <select value={filterFileType} onChange={e => { setFilterFileType(e.target.value); setSelectedIds(new Set()); }} style={filterSelectStyle}>
            <option value="">PDF + DWG</option>
            <option value="pdf">PDF only</option>
            <option value="dwg">DWG only</option>
          </select>
          {hasFilters && (
            <button className="btn" onClick={clearFilters}
              style={{ fontSize: 11, color: "#9a9088", background: "none", border: "1px solid #ddd8d0", padding: "5px 10px" }}>
              Clear ×
            </button>
          )}
          <span style={{ fontSize: 11, color: "#b0a8a0", marginLeft: "auto" }}>
            {filteredDrawings.length}{filteredDrawings.length !== drawings.length ? ` of ${drawings.length}` : ""} drawing{filteredDrawings.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Bulk action toolbar */}
      {someSelected && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: "#eef6ff", border: "1px solid #b8d0e8", marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: ARC_NAVY }}>{selectedIds.size} selected</span>
          <button className="btn" onClick={downloadSelected} disabled={downloadingSelected}
            style={{ fontSize: 11, fontWeight: 600, color: ARC_NAVY, background: "#fff", border: `1px solid ${ARC_NAVY}`, padding: "4px 12px", display: "flex", alignItems: "center", gap: 5 }}>
            {downloadingSelected ? <><Spinner size={10} /> Downloading…</> : "↓ Download Selected"}
          </button>
          {isAdmin && (
            <button className="btn" onClick={deleteSelected} disabled={deletingSelected}
              style={{ fontSize: 11, fontWeight: 600, color: "#fff", background: ARC_TERRACOTTA, border: `1px solid ${ARC_TERRACOTTA}`, padding: "4px 12px", display: "flex", alignItems: "center", gap: 5 }}>
              {deletingSelected ? <><Spinner size={10} /> Deleting…</> : "× Delete Selected"}
            </button>
          )}
          <button className="btn" onClick={() => setSelectedIds(new Set())}
            style={{ fontSize: 11, color: "#9a9088", background: "none", border: "none", padding: "4px 8px", marginLeft: "auto" }}>
            Clear selection
          </button>
        </div>
      )}

      {/* Drawing list */}
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9a9088", fontSize: 13 }}><Spinner size={12} /> Loading drawings…</div>
      ) : drawings.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8e0d5", padding: "48px", textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📐</div>
          <p style={{ fontSize: 14, color: ARC_NAVY, fontWeight: 300, fontFamily: "Inter, Arial, sans-serif", marginBottom: 6 }}>No drawings uploaded yet</p>
          {isAdmin && <p style={{ fontSize: 12, color: "#9a9088" }}>Click + Upload Drawing to add the first one, or use Archimind Sync.</p>}
        </div>
      ) : filteredDrawings.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8e0d5", padding: "32px", textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "#9a9088", fontStyle: "italic" }}>No drawings match the current filters.</p>
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e8e0d5", overflowX: "auto" }}>
          {/* Column headers */}
          <div style={{ display: "grid", gridTemplateColumns: COLS, gap: "0 10px", padding: "8px 16px", background: ARC_NAVY, minWidth: 900 }}>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
              <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                style={{ cursor: "pointer", width: 14, height: 14, accentColor: "#fff" }} />
            </div>
            {["Drawing No.", "Title", "Rev.", "Status", "Scale", "Type", "Volume", "Level", "", "", ""].map((h, i) => (
              <div key={i} style={{ fontSize: 10, fontWeight: 500, color: "#fff", letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</div>
            ))}
          </div>
          {filteredDrawings.map((d, i) => (
            <div key={d.id} style={{ background: selectedIds.has(d.id) ? "#eef6ff" : i % 2 === 0 ? "#faf8f5" : "#fff", minWidth: 900 }}>
              <DrawingRow d={d} projectId={projectId} isAdmin={isAdmin}
                onUpdate={updateField} onDelete={handleDelete}
                onView={setViewingDrawing} downloadingId={downloadingId} onDownload={handleDownload}
                selectable={true} selected={selectedIds.has(d.id)} onSelect={toggleSelect} />
            </div>
          ))}
        </div>
      )}

      {drawings.length > 0 && (
        <p style={{ fontSize: 11, color: "#b0a8a0", marginTop: 8, fontStyle: "italic" }}>
          {drawings.length} drawing{drawings.length !== 1 ? "s" : ""}{isAdmin ? " · Click title, drawing number, or revision to edit inline. Type, volume and level are also editable." : ""}
        </p>
      )}

      {viewingDrawing && (
        <PdfViewerModal
          drawing={viewingDrawing}
          projectId={projectId}
          onClose={() => setViewingDrawing(null)}
          drawings={filteredDrawings}
          currentIndex={filteredDrawings.findIndex(d => d.id === viewingDrawing.id)}
        />
      )}
    </div>
  );
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

// ── Project detail ────────────────────────────────────────────────────────────
function ProjectDetail({ projectId, onBack, isAdmin }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("info");
  const [saving, setSaving] = useState({});
  const [addingConsultant, setAddingConsultant] = useState(false);
  const [newConsultant, setNewConsultant] = useState({ discipline: "", company: "", contact_name: "", email: "", phone: "" });
  const [addingUvalue, setAddingUvalue] = useState(false);
  const [newUvalueElement, setNewUvalueElement] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [newNote, setNewNote] = useState({ label: "", value: "" });
  const [editingProject, setEditingProject] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [drawings, setDrawings] = useState([]);

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    try { const d = await api(`/api/projects/${projectId}`); setData(d); } catch (e) { console.error(e); }
    setLoading(false);
  }

  const setSavingKey = (key, val) => setSaving(s => ({ ...s, [key]: val }));

  async function saveEditForm() {
    setSavingKey("editForm", true);
    try { const { project } = await api(`/api/projects/${projectId}`, { method: "PATCH", body: editForm }); setData(d => ({ ...d, project })); setEditingProject(false); } catch (e) { console.error(e); }
    setSavingKey("editForm", false);
  }

  async function addConsultant() {
    if (!newConsultant.company && !newConsultant.discipline) return;
    setSavingKey("consultant", true);
    try {
      const { consultant } = await api(`/api/projects/${projectId}/consultants`, { method: "POST", body: newConsultant });
      setData(d => ({ ...d, consultants: [...d.consultants, consultant] }));
      setNewConsultant({ discipline: "", company: "", contact_name: "", email: "", phone: "" }); setAddingConsultant(false);
    } catch (e) { console.error(e); }
    setSavingKey("consultant", false);
  }

  async function updateConsultant(cid, field, value) {
    const consultant = data.consultants.find(c => c.id === cid);
    if (!consultant) return;
    const updated = { ...consultant, [field]: value };
    try { await api(`/api/projects/${projectId}/consultants/${cid}`, { method: "PATCH", body: updated }); setData(d => ({ ...d, consultants: d.consultants.map(c => c.id === cid ? updated : c) })); } catch (e) { console.error(e); }
  }

  async function deleteConsultant(cid) {
    try { await api(`/api/projects/${projectId}/consultants/${cid}`, { method: "DELETE" }); setData(d => ({ ...d, consultants: d.consultants.filter(c => c.id !== cid) })); } catch (e) { console.error(e); }
  }

  async function updateUvalue(uid, field, value) {
    const parsed = value === "" ? null : Number(value);
    try { const { uvalue } = await api(`/api/projects/${projectId}/uvalues/${uid}`, { method: "PATCH", body: { [field]: field === "notes" ? value : parsed } }); setData(d => ({ ...d, uvalues: d.uvalues.map(u => u.id === uid ? uvalue : u) })); } catch (e) { console.error(e); }
  }

  async function addUvalue() {
    if (!newUvalueElement.trim()) return;
    try { const { uvalue } = await api(`/api/projects/${projectId}/uvalues`, { method: "POST", body: { element: newUvalueElement.trim() } }); setData(d => ({ ...d, uvalues: [...d.uvalues, uvalue] })); setNewUvalueElement(""); setAddingUvalue(false); } catch (e) { console.error(e); }
  }

  async function deleteUvalue(uid) {
    try { await api(`/api/projects/${projectId}/uvalues/${uid}`, { method: "DELETE" }); setData(d => ({ ...d, uvalues: d.uvalues.filter(u => u.id !== uid) })); } catch (e) { console.error(e); }
  }

  async function addNote() {
    if (!newNote.label.trim()) return;
    try { const { note } = await api(`/api/projects/${projectId}/notes`, { method: "POST", body: newNote }); setData(d => ({ ...d, notes: [...d.notes, note] })); setNewNote({ label: "", value: "" }); setAddingNote(false); } catch (e) { console.error(e); }
  }

  async function updateNote(nid, field, value) {
    const note = data.notes.find(n => n.id === nid);
    if (!note) return;
    const updated = { ...note, [field]: value };
    try { await api(`/api/projects/${projectId}/notes/${nid}`, { method: "PATCH", body: updated }); setData(d => ({ ...d, notes: d.notes.map(n => n.id === nid ? updated : n) })); } catch (e) { console.error(e); }
  }

  async function deleteNote(nid) {
    try { await api(`/api/projects/${projectId}/notes/${nid}`, { method: "DELETE" }); setData(d => ({ ...d, notes: d.notes.filter(n => n.id !== nid) })); } catch (e) { console.error(e); }
  }

  if (loading) return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: "#9a9088" }}><Spinner size={14} /> Loading project…</div>;
  if (!data) return null;

  const { project, consultants, uvalues, notes } = data;
  const sColor = stageColor(project.stage);

  const TABS = [
    { id: "info", label: "Info" }, { id: "consultants", label: "Consultants" }, { id: "u-values", label: "U-Values" },
    { id: "notes", label: "Notes" }, { id: "drawings", label: "Drawings" }, { id: "documents", label: "Documents" },
    { id: "products", label: "Products" }, { id: "minutes", label: "Minutes" }, { id: "emails", label: "Emails" },
  ];

  const tabStyle = t => ({
    padding: "10px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
    background: activeTab === t ? "#ffffff" : "transparent", color: activeTab === t ? ARC_NAVY : "#9a9088",
    border: "none", borderBottom: activeTab === t ? `2px solid ${sColor}` : "2px solid transparent",
    cursor: "pointer", fontFamily: "Inter, Arial, sans-serif", transition: "all 0.15s",
  });

  const sectionTitle = (title, action) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
      <h3 style={{ fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.1em", textTransform: "uppercase" }}>{title}</h3>
      {action}
    </div>
  );

  const addBtn = (label, onClick) => (
    <button className="btn" onClick={onClick} style={{ fontSize: 11, color: AD_GREEN, background: "none", border: `1px solid ${AD_GREEN}`, padding: "4px 12px", fontWeight: 600, letterSpacing: "0.04em" }}>+ {label}</button>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: "#ffffff", borderBottom: "1px solid #e8e0d5", padding: "20px 32px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
          <button className="btn" onClick={onBack} style={{ background: "none", color: "#9a9088", fontSize: 13, padding: "4px 0", border: "none", display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginTop: 2 }}>← Back</button>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <h1 style={{ fontSize: 22, fontWeight: 300, color: ARC_NAVY, fontFamily: "Inter, Arial, sans-serif" }}>{project.name}</h1>
              {project.job_number && <span style={{ fontSize: 11, color: "#9a9088", background: ARC_STONE, padding: "2px 8px", fontWeight: 500 }}>#{project.job_number}</span>}
              {project.stage && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: sColor, background: `${sColor}18`, padding: "3px 8px" }}>{project.stage.split("—")[0].trim()}</span>}
            </div>
            <div style={{ fontSize: 12, color: "#9a9088", display: "flex", gap: 20, flexWrap: "wrap" }}>
              {project.client && <span>👤 {project.client}</span>}
              {project.location && <span>📍 {project.location}</span>}
              {project.project_lead && <span>🧑‍💼 {project.project_lead}</span>}
              {project.stage && <span>🏗 {project.stage}</span>}
            </div>
          </div>
          {isAdmin && <button className="btn" onClick={() => { setEditForm({ ...project }); setEditingProject(true); }} style={{ background: "none", color: "#9a9088", border: "1px solid #ddd8d0", padding: "6px 14px", fontSize: 11, flexShrink: 0 }}>Edit</button>}
        </div>
        <div style={{ display: "flex", overflowX: "auto" }}>
          {TABS.map(t => <button key={t.id} className="btn" style={tabStyle(t.id)} onClick={() => setActiveTab(t.id)}>{t.label}</button>)}
        </div>
      </div>

      {/* Edit modal */}
      {editingProject && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", padding: "32px", width: 560, borderTop: `3px solid ${ARC_TERRACOTTA}`, fontFamily: "Inter, Arial, sans-serif", maxHeight: "90vh", overflowY: "auto" }}>
            <h2 style={{ fontSize: 16, fontWeight: 500, color: ARC_NAVY, marginBottom: 20 }}>Edit Project</h2>
            {[["name","Project Name"],["job_number","Job Number"],["client","Client"],["location","Location"],["project_lead","Project Lead"],["description","Description"]].map(([field, label]) => (
              <div key={field} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>{label}</label>
                <input value={editForm[field] || ""} onChange={e => setEditForm(f => ({ ...f, [field]: e.target.value }))}
                  style={{ width: "100%", border: "1px solid #ddd8d0", padding: "8px 12px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none" }} />
              </div>
            ))}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>RIBA Stage</label>
              <select value={editForm.stage || ""} onChange={e => setEditForm(f => ({ ...f, stage: e.target.value }))} style={{ width: "100%", border: "1px solid #ddd8d0", padding: "8px 12px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: editForm.stage ? ARC_NAVY : "#9a9088" }}>
                <option value="">Select stage…</option>
                {RIBA_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Status</label>
              <select value={editForm.status || "active"} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))} style={{ width: "100%", border: "1px solid #ddd8d0", padding: "8px 12px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif" }}>
                <option value="active">Active</option><option value="on-hold">On Hold</option><option value="complete">Complete</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" onClick={saveEditForm} disabled={saving.editForm} style={{ background: ARC_NAVY, color: "#fff", padding: "9px 24px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{saving.editForm ? <Spinner size={12} /> : "Save"}</button>
              <button className="btn" onClick={() => setEditingProject(false)} style={{ background: "none", color: "#9a9088", padding: "9px 16px", fontSize: 11, border: "1px solid #ddd8d0" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>

        {activeTab === "info" && (
          <div style={{ maxWidth: 700 }}>
            {sectionTitle("Project Information")}
            <div style={{ background: "#fff", border: "1px solid #e8e0d5", padding: "20px 24px", marginBottom: 20 }}>
              {[["Project Name", project.name],["Job Number", project.job_number],["Client", project.client],["Location", project.location],["Project Lead", project.project_lead],["RIBA Stage", project.stage],["Status", project.status]].map(([label, value]) => (
                <div key={label} style={{ display: "flex", borderBottom: "1px solid #f0ede8", padding: "10px 0", alignItems: "flex-start", gap: 16 }}>
                  <div style={{ width: 160, fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.05em", textTransform: "uppercase", flexShrink: 0, paddingTop: 1 }}>{label}</div>
                  <div style={{ flex: 1, fontSize: 13, color: value ? ARC_NAVY : "#b0a8a0", fontStyle: value ? "normal" : "italic" }}>{value || "Not set"}</div>
                </div>
              ))}
              {project.description && (
                <div style={{ display: "flex", padding: "10px 0", alignItems: "flex-start", gap: 16 }}>
                  <div style={{ width: 160, fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.05em", textTransform: "uppercase", flexShrink: 0, paddingTop: 1 }}>Description</div>
                  <div style={{ flex: 1, fontSize: 13, color: ARC_NAVY, lineHeight: 1.6 }}>{project.description}</div>
                </div>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#b0a8a0", fontStyle: "italic" }}>Created {new Date(project.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>
          </div>
        )}

        {activeTab === "consultants" && (
          <div style={{ maxWidth: 800 }}>
            {sectionTitle("Consultants", isAdmin && addBtn("Add Consultant", () => setAddingConsultant(true)))}
            {addingConsultant && (
              <div style={{ background: "#fff", border: `1px solid ${AD_GREEN}`, padding: "20px 24px", marginBottom: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
                  {[["discipline","Discipline","e.g. Structural Engineer"],["company","Company","Company name"],["contact_name","Contact Name","Full name"],["email","Email","email@example.com"],["phone","Phone","01234 567890"]].map(([field, label, placeholder]) => (
                    <div key={field} style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>{label}</label>
                      <input value={newConsultant[field]} onChange={e => setNewConsultant(c => ({ ...c, [field]: e.target.value }))} placeholder={placeholder}
                        style={{ width: "100%", border: "1px solid #ddd8d0", padding: "7px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none" }} />
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button className="btn" onClick={addConsultant} disabled={saving.consultant} style={{ background: AD_GREEN, color: "#fff", padding: "7px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{saving.consultant ? <Spinner size={12} /> : "Add"}</button>
                  <button className="btn" onClick={() => { setAddingConsultant(false); setNewConsultant({ discipline: "", company: "", contact_name: "", email: "", phone: "" }); }} style={{ background: "none", color: "#9a9088", padding: "7px 14px", fontSize: 11, border: "1px solid #ddd8d0" }}>Cancel</button>
                </div>
              </div>
            )}
            {consultants.length === 0 && !addingConsultant ? (
              <div style={{ background: "#fff", border: "1px solid #e8e0d5", padding: "40px", textAlign: "center" }}><p style={{ fontSize: 13, color: "#9a9088", fontStyle: "italic" }}>No consultants added yet.</p></div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {consultants.map(c => (
                  <div key={c.id} style={{ background: "#fff", border: "1px solid #e8e0d5", padding: "14px 20px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: ARC_NAVY, marginBottom: 4 }}>
                          <EditableField value={c.discipline} onSave={v => updateConsultant(c.id, "discipline", v)} placeholder="Discipline" />
                          {c.company && <span style={{ fontWeight: 400, color: "#9a9088" }}> — <EditableField value={c.company} onSave={v => updateConsultant(c.id, "company", v)} placeholder="Company" /></span>}
                        </div>
                        <div style={{ fontSize: 12, color: "#9a9088", display: "flex", gap: 16, flexWrap: "wrap" }}>
                          {c.contact_name && <span>👤 <EditableField value={c.contact_name} onSave={v => updateConsultant(c.id, "contact_name", v)} placeholder="Name" style={{ fontSize: 12 }} /></span>}
                          {c.email && <span>✉ <EditableField value={c.email} onSave={v => updateConsultant(c.id, "email", v)} placeholder="Email" style={{ fontSize: 12 }} /></span>}
                          {c.phone && <span>📞 <EditableField value={c.phone} onSave={v => updateConsultant(c.id, "phone", v)} placeholder="Phone" style={{ fontSize: 12 }} /></span>}
                        </div>
                      </div>
                      {isAdmin && <button className="btn" onClick={() => deleteConsultant(c.id)} style={{ background: "none", color: "#c8c0b8", fontSize: 16, padding: "0 4px", border: "none", flexShrink: 0 }} onMouseEnter={e => e.target.style.color = ARC_TERRACOTTA} onMouseLeave={e => e.target.style.color = "#c8c0b8"}>×</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "u-values" && (
          <div style={{ maxWidth: 700 }}>
            {sectionTitle("U-Value Requirements", isAdmin && addBtn("Add Element", () => setAddingUvalue(true)))}
            {addingUvalue && (
              <div style={{ background: "#fff", border: `1px solid ${AD_GREEN}`, padding: "16px 20px", marginBottom: 16, display: "flex", gap: 10, alignItems: "center" }}>
                <input value={newUvalueElement} onChange={e => setNewUvalueElement(e.target.value)} placeholder="Element name e.g. Flat Roof" autoFocus
                  onKeyDown={e => { if (e.key === "Enter") addUvalue(); if (e.key === "Escape") { setAddingUvalue(false); setNewUvalueElement(""); } }}
                  style={{ flex: 1, border: "1px solid #ddd8d0", padding: "7px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none" }} />
                <button className="btn" onClick={addUvalue} style={{ background: AD_GREEN, color: "#fff", padding: "7px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Add</button>
                <button className="btn" onClick={() => { setAddingUvalue(false); setNewUvalueElement(""); }} style={{ background: "none", color: "#9a9088", padding: "7px 12px", fontSize: 11, border: "1px solid #ddd8d0" }}>Cancel</button>
              </div>
            )}
            <div style={{ background: "#fff", border: "1px solid #e8e0d5" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>{["Element","Target (W/m²K)","Achieved (W/m²K)","Notes",""].map((h, i) => (
                    <th key={i} style={{ background: ARC_NAVY, color: "#fff", padding: "8px 14px", textAlign: "left", fontSize: 10, fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase", width: i === 4 ? 32 : "auto" }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {uvalues.map((u, i) => (
                    <tr key={u.id} style={{ background: i % 2 === 0 ? "#faf8f5" : "#fff" }}>
                      <td style={{ padding: "9px 14px", borderBottom: "1px solid #e8e0d5", fontWeight: 500, color: ARC_NAVY }}>{u.element}</td>
                      <td style={{ padding: "9px 14px", borderBottom: "1px solid #e8e0d5" }}>
                        {isAdmin ? <input type="number" step="0.01" defaultValue={u.target ?? ""} placeholder="—" onBlur={e => updateUvalue(u.id, "target", e.target.value)} style={{ width: 80, border: "1px solid #e8e0d5", padding: "3px 6px", fontSize: 12, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none", background: "transparent" }} />
                        : <span style={{ color: u.target !== null ? ARC_NAVY : "#b0a8a0" }}>{u.target !== null ? u.target : "—"}</span>}
                      </td>
                      <td style={{ padding: "9px 14px", borderBottom: "1px solid #e8e0d5" }}>
                        {isAdmin ? <input type="number" step="0.01" defaultValue={u.achieved ?? ""} placeholder="—" onBlur={e => updateUvalue(u.id, "achieved", e.target.value)} style={{ width: 80, border: "1px solid #e8e0d5", padding: "3px 6px", fontSize: 12, fontFamily: "Inter, Arial, sans-serif", color: u.achieved !== null && u.target !== null ? (u.achieved <= u.target ? AD_GREEN : ARC_TERRACOTTA) : ARC_NAVY, outline: "none", background: "transparent" }} />
                        : <span style={{ color: u.achieved !== null && u.target !== null ? (u.achieved <= u.target ? AD_GREEN : ARC_TERRACOTTA) : (u.achieved !== null ? ARC_NAVY : "#b0a8a0") }}>{u.achieved !== null ? u.achieved : "—"}</span>}
                      </td>
                      <td style={{ padding: "9px 14px", borderBottom: "1px solid #e8e0d5" }}>
                        {isAdmin ? <input defaultValue={u.notes ?? ""} placeholder="Optional notes" onBlur={e => updateUvalue(u.id, "notes", e.target.value)} style={{ width: "100%", border: "1px solid #e8e0d5", padding: "3px 6px", fontSize: 12, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none", background: "transparent" }} />
                        : <span style={{ color: u.notes ? ARC_NAVY : "#b0a8a0" }}>{u.notes || "—"}</span>}
                      </td>
                      <td style={{ padding: "9px 8px", borderBottom: "1px solid #e8e0d5", textAlign: "center" }}>
                        {isAdmin && <button className="btn" onClick={() => deleteUvalue(u.id)} style={{ background: "none", color: "#c8c0b8", fontSize: 14, padding: "0 2px", border: "none" }} onMouseEnter={e => e.target.style.color = ARC_TERRACOTTA} onMouseLeave={e => e.target.style.color = "#c8c0b8"}>×</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 11, color: "#b0a8a0", marginTop: 8, fontStyle: "italic" }}>Achieved values shown in green if they meet or beat the target, red if they exceed it.{isAdmin && " Click any value to edit it directly."}</p>
          </div>
        )}

        {activeTab === "notes" && (
          <div style={{ maxWidth: 700 }}>
            {sectionTitle("Additional Information", isAdmin && addBtn("Add Note", () => setAddingNote(true)))}
            {addingNote && (
              <div style={{ background: "#fff", border: `1px solid ${AD_GREEN}`, padding: "16px 20px", marginBottom: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "0 16px" }}>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Label</label>
                    <input value={newNote.label} onChange={e => setNewNote(n => ({ ...n, label: e.target.value }))} placeholder="e.g. Planning Reference" autoFocus
                      style={{ width: "100%", border: "1px solid #ddd8d0", padding: "7px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none", marginBottom: 12 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Value</label>
                    <input value={newNote.value} onChange={e => setNewNote(n => ({ ...n, value: e.target.value }))} placeholder="e.g. 24/01234/FUL"
                      style={{ width: "100%", border: "1px solid #ddd8d0", padding: "7px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none", marginBottom: 12 }} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn" onClick={addNote} style={{ background: AD_GREEN, color: "#fff", padding: "7px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Add</button>
                  <button className="btn" onClick={() => { setAddingNote(false); setNewNote({ label: "", value: "" }); }} style={{ background: "none", color: "#9a9088", padding: "7px 14px", fontSize: 11, border: "1px solid #ddd8d0" }}>Cancel</button>
                </div>
              </div>
            )}
            {notes.length === 0 && !addingNote ? (
              <div style={{ background: "#fff", border: "1px solid #e8e0d5", padding: "40px", textAlign: "center" }}><p style={{ fontSize: 13, color: "#9a9088", fontStyle: "italic" }}>No additional notes yet.</p></div>
            ) : (
              <div style={{ background: "#fff", border: "1px solid #e8e0d5" }}>
                {notes.map((n, i) => (
                  <div key={n.id} style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "10px 16px", borderBottom: i < notes.length - 1 ? "1px solid #f0ede8" : "none" }}>
                    <div style={{ width: 180, fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.05em", textTransform: "uppercase", flexShrink: 0, paddingTop: 1 }}>
                      {isAdmin ? <EditableField value={n.label} onSave={v => updateNote(n.id, "label", v)} placeholder="Label" /> : n.label}
                    </div>
                    <div style={{ flex: 1, fontSize: 13, color: ARC_NAVY }}>
                      {isAdmin ? <EditableField value={n.value} onSave={v => updateNote(n.id, "value", v)} placeholder="Value" multiline /> : n.value}
                    </div>
                    {isAdmin && <button className="btn" onClick={() => deleteNote(n.id)} style={{ background: "none", color: "#c8c0b8", fontSize: 16, padding: "0 4px", border: "none", flexShrink: 0 }} onMouseEnter={e => e.target.style.color = ARC_TERRACOTTA} onMouseLeave={e => e.target.style.color = "#c8c0b8"}>×</button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "drawings" && (
          <DrawingsTab projectId={projectId} isAdmin={isAdmin} onDrawingsLoaded={setDrawings} />
        )}

        {activeTab === "documents" && <PlaceholderTab icon="📁" title="Documents" description="Store and retrieve project documents — reports, specifications, certificates, and other project-specific files." />}
        {activeTab === "products" && (
          <ProductsTab projectId={projectId} isAdmin={isAdmin} />
        )}
        {activeTab === "minutes" && <PlaceholderTab icon="📝" title="Meeting Minutes" description="Upload or paste meeting minutes. Search and query them using the Q&A bar below to find decisions, actions, and key discussion points." />}
        {activeTab === "emails" && <PlaceholderTab icon="✉️" title="Emails" description="Connect your email to index project correspondence. Search threads, find attachments, and ask questions across the full project email history." />}

      </div>

      <QABar project={project} consultants={consultants} uvalues={uvalues} notes={notes} drawings={drawings} projectId={projectId} />
    </div>
  );
}

// ── Projects list ─────────────────────────────────────────────────────────────
export default function ProjectsSection({ isAdmin }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState("active");

  useEffect(() => { loadProjects(); }, []);

  async function loadProjects() {
    setLoading(true);
    try { const { projects: data } = await api("/api/projects"); setProjects(data || []); } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function createProject(form) {
    try {
      const { project } = await api("/api/projects", { method: "POST", body: form });
      setProjects(prev => [project, ...prev]);
      setShowNewForm(false);
      setSelectedId(project.id);
    } catch (e) { console.error(e); }
  }

  if (selectedId) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#faf8f5" }}>
        <ProjectDetail projectId={selectedId} onBack={() => setSelectedId(null)} isAdmin={isAdmin} />
      </div>
    );
  }

  const filtered = projects.filter(p => filterStatus === "all" || p.status === filterStatus);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#faf8f5" }}>
      <div style={{ background: "#ffffff", borderBottom: "1px solid #e8e0d5", padding: "20px 32px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 300, color: ARC_NAVY, fontFamily: "Inter, Arial, sans-serif" }}>Projects</h1>
            <p style={{ fontSize: 11, color: "#9a9088", marginTop: 4, letterSpacing: "0.04em", textTransform: "uppercase" }}>{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", border: "1px solid #e8e0d5", overflow: "hidden" }}>
              {["active","all","on-hold","complete"].map(s => (
                <button key={s} className="btn" onClick={() => setFilterStatus(s)}
                  style={{ padding: "6px 14px", fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", background: filterStatus === s ? ARC_NAVY : "transparent", color: filterStatus === s ? "#fff" : "#9a9088", border: "none", borderRight: "1px solid #e8e0d5" }}>
                  {s === "on-hold" ? "On Hold" : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            {isAdmin && <button className="btn" onClick={() => setShowNewForm(true)} style={{ background: ARC_NAVY, color: "#fff", padding: "8px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>+ New Project</button>}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
        {showNewForm && <NewProjectForm onSave={createProject} onCancel={() => setShowNewForm(false)} />}
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#9a9088", fontSize: 13 }}><Spinner size={13} /> Loading projects…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 40px" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🏗</div>
            <p style={{ fontSize: 15, color: ARC_NAVY, fontWeight: 300, fontFamily: "Inter, Arial, sans-serif", marginBottom: 8 }}>{projects.length === 0 ? "No projects yet" : "No projects match this filter"}</p>
            <p style={{ fontSize: 12, color: "#9a9088" }}>{projects.length === 0 && isAdmin ? "Click + New Project to get started" : "Try a different filter"}</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 900 }}>
            {filtered.map(p => <ProjectCard key={p.id} project={p} onClick={() => setSelectedId(p.id)} />)}
          </div>
        )}
      </div>
    </div>
  );
}
