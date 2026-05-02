import React, { useState, useEffect, useRef } from "react";
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

  useEffect(() => {
    if (drawingsList.length <= 1) return;
    function handleKey(e) {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); setCurrentIdx(i => Math.max(0, i - 1)); }
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); setCurrentIdx(i => Math.min(drawingsList.length - 1, i + 1)); }
      else if (e.key === "Escape") { onClose(); }
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
      <div style={{ background: ARC_NAVY, padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
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
          {drawingsList.length > 1 && (
            <button className="btn" onClick={() => hasNext && setCurrentIdx(i => i + 1)} style={navBtnStyle(hasNext)} title="Next drawing (→)">›</button>
          )}
        </div>
        <button className="btn" onClick={onClose}
          style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", padding: "7px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", marginLeft: 16, flexShrink: 0 }}>
          Close ✕
        </button>
      </div>
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

// ── Drawing row ───────────────────────────────────────────────────────────────
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
      <div style={{ fontSize: 11, fontWeight: 600, color: ARC_NAVY, display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
        {isAdmin && onUpdate
          ? <EditableField value={d.drawing_number} onSave={v => onUpdate(d.id, "drawing_number", v)} placeholder="—" style={{ fontSize: 11 }} />
          : <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.drawing_number || "—"}</span>}
        <FileTypeBadge fileName={d.file_name} />
      </div>
      <div style={{ fontSize: 13, color: ARC_NAVY, minWidth: 0, overflow: "hidden" }}>
        {isAdmin && onUpdate
          ? <EditableField value={d.title} onSave={v => onUpdate(d.id, "title", v)} placeholder="Untitled" />
          : <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: ARC_NAVY, textAlign: "center" }}>
        {isAdmin && onUpdate
          ? <EditableField value={d.revision} onSave={v => onUpdate(d.id, "revision", v)} placeholder="—" style={{ fontSize: 12, textAlign: "center" }} />
          : <span>{d.revision || "—"}</span>}
      </div>
      <div><StatusBadge status={d.status} /></div>
      <div style={{ fontSize: 11, color: "#9a9088", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.scale || "—"}</div>
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
      <div style={{ fontSize: 11, color: "#9a9088", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {isAdmin && onUpdate
          ? <EditableField value={d.volume} onSave={v => onUpdate(d.id, "volume", v)} placeholder="—" style={{ fontSize: 11 }} />
          : <span>{d.volume || "—"}</span>}
      </div>
      <div style={{ fontSize: 11, color: "#9a9088", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {isAdmin && onUpdate
          ? <EditableField value={d.level} onSave={v => onUpdate(d.id, "level", v)} placeholder="—" style={{ fontSize: 11 }} />
          : <span>{d.level || "—"}</span>}
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <button className="btn" onClick={() => onDownload(d)} disabled={downloadingId === d.id} title="Download"
          style={{ background: "none", border: "1px solid #ddd8d0", color: "#9a9088", padding: "4px 8px", fontSize: 13, lineHeight: 1 }}
          onMouseEnter={e => e.currentTarget.style.color = ARC_NAVY} onMouseLeave={e => e.currentTarget.style.color = "#9a9088"}>
          {downloadingId === d.id ? <Spinner size={11} /> : "↓"}
        </button>
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        {!(d.file_name || "").endsWith(".dwg") && (
          <button className="btn" onClick={() => onView(d)} title="Full screen view"
            style={{ background: "none", border: "1px solid #ddd8d0", color: "#9a9088", padding: "4px 8px", fontSize: 12, lineHeight: 1 }}
            onMouseEnter={e => e.currentTarget.style.color = ARC_NAVY} onMouseLeave={e => e.currentTarget.style.color = "#9a9088"}>👁</button>
        )}
      </div>
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

// ── Transmittal tab ───────────────────────────────────────────────────────────

// ── DocumentsTab ──────────────────────────────────────────────────────────────
function DocumentsTab({ projectId, isAdmin }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(null);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { loadFiles(); }, [projectId]);

  async function loadFiles() {
    setLoading(true);
    try {
      const data = await api(`/api/projects/${projectId}/transmittals/files`);
      setFiles(data.files || []);
      setSelectedKeys(new Set());
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function openFile(file) {
    if (opening) return;
    setOpening(file.key);
    try {
      const data = await api(`/api/projects/${projectId}/transmittals/download?key=${encodeURIComponent(file.key)}`);
      const binary = atob(data.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch (e) { console.error(e); }
    setOpening(null);
  }

  function toggleSelect(key) {
    setSelectedKeys(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  function toggleSelectAll() {
    if (selectedKeys.size === files.length && files.length > 0) setSelectedKeys(new Set());
    else setSelectedKeys(new Set(files.map(f => f.key)));
  }

  async function deleteSelected() {
    if (!window.confirm(`Delete ${selectedKeys.size} snapshot${selectedKeys.size !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const keysParam = [...selectedKeys].map(k => encodeURIComponent(k)).join(",");
      await api(`/api/projects/${projectId}/transmittals/files?keys=${keysParam}`, { method: "DELETE" });
      setFiles(prev => prev.filter(f => !selectedKeys.has(f.key)));
      setSelectedKeys(new Set());
    } catch (e) { console.error(e); }
    setDeleting(false);
  }

  const allSelected = files.length > 0 && selectedKeys.size === files.length;
  const someSelected = selectedKeys.size > 0;

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9a9088", fontSize: 13 }}>
      <Spinner size={13} /> Loading documents…
    </div>
  );

  if (files.length === 0) return (
    <div style={{ background: "#fff", border: "1px solid #e8e0d5", padding: "48px", textAlign: "center" }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>📁</div>
      <p style={{ fontSize: 14, color: ARC_NAVY, fontWeight: 300, fontFamily: "Inter, Arial, sans-serif", marginBottom: 6 }}>No documents yet</p>
      <p style={{ fontSize: 12, color: "#9a9088" }}>Use "Save PDF Snapshot" in the Drawing Schedule tab to generate and store snapshots here.</p>
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h3 style={{ fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Stored Schedules — Transmittals
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isAdmin && someSelected && (
            <button className="btn" onClick={deleteSelected} disabled={deleting}
              style={{ fontSize: 11, fontWeight: 600, color: "#fff", background: ARC_TERRACOTTA, border: `1px solid ${ARC_TERRACOTTA}`, padding: "4px 12px", display: "flex", alignItems: "center", gap: 5 }}>
              {deleting ? <><Spinner size={10} /> Deleting…</> : `× Delete ${selectedKeys.size} selected`}
            </button>
          )}
          <button className="btn" onClick={loadFiles}
            style={{ fontSize: 11, color: "#9a9088", background: "none", border: "1px solid #ddd8d0", padding: "4px 10px" }}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {isAdmin && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 16px", background: "#f5f3f0", border: "1px solid #e8e0d5", borderBottom: "none" }}>
          <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
            style={{ cursor: "pointer", width: 14, height: 14, accentColor: ARC_NAVY }} />
          <span style={{ fontSize: 11, color: "#9a9088" }}>
            {someSelected ? `${selectedKeys.size} of ${files.length} selected` : "Select all"}
          </span>
        </div>
      )}

      <div style={{ background: "#fff", border: "1px solid #e8e0d5" }}>
        {files.map((f, i) => (
          <div key={f.key} style={{
            display: "flex", alignItems: "center", gap: 14, padding: "10px 16px",
            borderBottom: i < files.length - 1 ? "1px solid #f0ede8" : "none",
            background: selectedKeys.has(f.key) ? "#eef6ff" : "inherit",
          }}>
            {isAdmin && (
              <input type="checkbox" checked={selectedKeys.has(f.key)} onChange={() => toggleSelect(f.key)}
                style={{ cursor: "pointer", width: 14, height: 14, accentColor: ARC_NAVY, flexShrink: 0 }} />
            )}
            <span style={{ fontSize: 18, flexShrink: 0, width: 24, textAlign: "center" }}>📄</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: ARC_NAVY, fontFamily: "Inter, Arial, sans-serif" }}>{f.label}</div>
              <div style={{ fontSize: 11, color: "#9a9088", marginTop: 2 }}>{f.name}</div>
            </div>
            <button className="btn" onClick={() => openFile(f)} disabled={opening === f.key}
              style={{ fontSize: 11, fontWeight: 600, color: ARC_NAVY, background: "none", border: `1px solid ${ARC_NAVY}`, padding: "4px 12px", flexShrink: 0, letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 5 }}>
              {opening === f.key ? <><Spinner size={10} /> Opening…</> : "Open / Print"}
            </button>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11, color: "#b0a8a0", marginTop: 8 }}>
        Open a schedule to print or save as PDF using your browser's print dialog.
      </p>
    </div>
  );
}

// ── TransmittalTab ────────────────────────────────────────────────────────────
const DEFAULT_COLOURS = {
  header:      "#1a2332",
  groupRow:    "#f0ede8",
  bforward:    "#2e5e8e",
  latestIssue: "#c25a45",
  rowEven:     "#ffffff",
  rowOdd:      "#faf8f5",
  headerText:  "#ffffff",
  bodyText:    "#1a2332",
};

function TransmittalTab({ projectId, isAdmin }) {
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
  const [printSlicedIssues, setPrintSlicedIssues] = useState(null);

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
    } catch (e) { console.error(e); }
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
    } catch (e) { console.error(e); }
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
    } catch (e) { console.error(e); }
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
    } catch (e) { console.error(e); }
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
      // Calculate which issue columns fit on A4 landscape
      // Pinned cols: W_TITLE(220) + W_DRAWNO(230) + W_BFWD(52) = 502px
      // Each issue col: 52px. Usable page width ~995px (A4 landscape 297mm at 96dpi minus margins)
      const USABLE_W = 995;
      const PINNED_W = 502;
      const ISSUE_COL_W = 52;
      const maxIssueCols = Math.floor((USABLE_W - PINNED_W) / ISSUE_COL_W);
      const sliced = data.issues.length > maxIssueCols
        ? data.issues.slice(data.issues.length - maxIssueCols)
        : data.issues;

      // Inject print stylesheet
      const styleId = "archimind-print-style";
      let styleEl = document.getElementById(styleId);
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = `
        @media print {
          @page { size: A4 landscape; margin: 8mm 10mm; }
          body * { visibility: hidden; }
          #archimind-transmittal-print, #archimind-transmittal-print * { visibility: visible; }
          #archimind-transmittal-print { position: fixed; top: 0; left: 0; width: 100%; }
          #archimind-transmittal-print table { table-layout: auto; width: auto; }
          #archimind-transmittal-print th,
          #archimind-transmittal-print td { position: static !important; }
          #archimind-transmittal-print #schedule-scroll { overflow: visible !important; }
          #archimind-transmittal-print * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
        }
      `;

      // Set sliced issues so table renders only fitting columns
      setPrintSlicedIssues(sliced);

      // Wait for React to re-render, then print
      setTimeout(() => {
        window.print();
        // Clean up after print dialog closes
        const cleanup = () => {
          setPrintSlicedIssues(null);
          if (styleEl) styleEl.textContent = "";
          setExportingPdf(false);
          window.removeEventListener("afterprint", cleanup);
        };
        window.addEventListener("afterprint", cleanup);
      }, 150);

    } catch (e) {
      console.error(e);
      setExportingPdf(false);
    }
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
    } catch (e) { console.error(e); }
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
      <p style={{ fontSize: 14, color: ARC_NAVY, fontWeight: 300, fontFamily: "Inter, Arial, sans-serif" }}>
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
          <div style={{ background: "#fff", width: 480, borderTop: `3px solid ${ARC_NAVY}`, padding: "28px 32px", fontFamily: "Inter, Arial, sans-serif" }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: ARC_NAVY, marginBottom: 12 }}>🖨 Before you print</h3>
            <p style={{ fontSize: 13, color: "#5a5048", lineHeight: 1.7, marginBottom: 8 }}>
              To remove browser-generated text (URL, page number, date) from your printed schedule:
            </p>
            <ol style={{ fontSize: 13, color: "#5a5048", lineHeight: 2, paddingLeft: 20, marginBottom: 20 }}>
              <li>In the print dialog, click <strong>More settings</strong></li>
              <li>Uncheck <strong>Headers and footers</strong></li>
              <li>Click <strong>Print</strong></li>
            </ol>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <input type="checkbox" id="print-dismiss" style={{ width: 14, height: 14, cursor: "pointer", accentColor: ARC_NAVY }}
                onChange={e => { if (e.target.checked) localStorage.setItem("archimind_print_warning_dismissed", "1"); else localStorage.removeItem("archimind_print_warning_dismissed"); }} />
              <label htmlFor="print-dismiss" style={{ fontSize: 12, color: "#9a9088", cursor: "pointer" }}>
                Don't show this again
              </label>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" onClick={() => confirmPrint(localStorage.getItem("archimind_print_warning_dismissed") === "1")}
                style={{ background: ARC_NAVY, color: "#fff", border: "none", padding: "9px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}>
                Continue to Print
              </button>
              <button className="btn" onClick={() => setPrintWarning(null)}
                style={{ background: "none", color: "#9a9088", border: "1px solid #ddd8d0", padding: "9px 16px", fontSize: 11, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete issue column confirmation */}
      {pendingDeleteIssue && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", width: 440, borderTop: `3px solid ${ARC_TERRACOTTA}`, padding: "28px 32px", fontFamily: "Inter, Arial, sans-serif" }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: ARC_NAVY, marginBottom: 12 }}>⚠ Delete Issue Column?</h3>
            <p style={{ fontSize: 13, color: "#5a5048", lineHeight: 1.7, marginBottom: 8 }}>
              You are about to permanently delete the issue column dated <strong>{new Date(pendingDeleteIssue.issueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</strong>.
            </p>
            <p style={{ fontSize: 12, color: ARC_TERRACOTTA, lineHeight: 1.6, marginBottom: 24 }}>
              This will delete the issue record and all revision data for this column. This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" onClick={confirmDeleteIssue}
                style={{ background: ARC_TERRACOTTA, color: "#fff", border: "none", padding: "9px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}>
                Yes, Delete Column
              </button>
              <button className="btn" onClick={() => setPendingDeleteIssue(null)}
                style={{ background: "none", color: "#9a9088", border: "1px solid #ddd8d0", padding: "9px 16px", fontSize: 11, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Warning dialog for cell edits */}
      {pendingCell && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", width: 480, borderTop: `3px solid ${ARC_TERRACOTTA}`, padding: "28px 32px", fontFamily: "Inter, Arial, sans-serif" }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: ARC_NAVY, marginBottom: 12 }}>⚠ Edit Issue Record?</h3>
            <p style={{ fontSize: 13, color: "#5a5048", lineHeight: 1.7, marginBottom: 8 }}>
              You are changing the revision for <strong>{pendingCell.drawingTitle || pendingCell.drawingNumber}</strong> in the issue dated <strong>{new Date(pendingCell.issueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</strong>.
            </p>
            <div style={{ display: "flex", gap: 16, marginBottom: 16, padding: "10px 14px", background: "#faf8f5", border: "1px solid #e8e0d5" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#9a9088", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Current</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: ARC_NAVY }}>{pendingCell.oldValue || "—"}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", fontSize: 16, color: "#9a9088" }}>→</div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#9a9088", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>New</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: ARC_TERRACOTTA }}>{pendingCell.newValue || "—"}</div>
              </div>
            </div>
            <p style={{ fontSize: 12, color: ARC_TERRACOTTA, lineHeight: 1.6, marginBottom: 24 }}>
              Editing the issue history is a permanent change and can cause coordination problems. Only proceed if you are certain this is correct.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" onClick={confirmCellEdit}
                style={{ background: ARC_TERRACOTTA, color: "#fff", border: "none", padding: "9px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}>
                Yes, Save Change
              </button>
              <button className="btn" onClick={() => setPendingCell(null)}
                style={{ background: "none", color: "#9a9088", border: "1px solid #ddd8d0", padding: "9px 16px", fontSize: 11, cursor: "pointer" }}>
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
              color: pdfMsg.type === "ok" ? "#2e7d4f" : ARC_TERRACOTTA,
            }}>{pdfMsg.text}</span>
          )}
          {isAdmin && (
            <button className="btn" onClick={() => handlePrintClick("snapshot")} disabled={savingPdf} style={btnSm(ARC_TERRACOTTA)}>
              {savingPdf ? <><Spinner size={10} /> Saving…</> : "↓ Save PDF Snapshot"}
            </button>
          )}
          <button className="btn" onClick={() => handlePrintClick("pdf")} disabled={exportingPdf} style={btnSm(ARC_NAVY)}>
            {exportingPdf ? <><Spinner size={10} /> Preparing…</> : "↓ Export PDF"}
          </button>
          <button className="btn" onClick={exportExcel} disabled={exportingExcel} style={btnSm(AD_GREEN)}>
            {exportingExcel ? <><Spinner size={10} /> Exporting…</> : "↓ Export Excel"}
          </button>
          {/* ── TEST ONLY ── remove before go-live */}
          {!testInjected
            ? <button className="btn" onClick={injectTestIssues} style={{ fontSize: 10, color: "#fff", background: "#b06000", border: "none", padding: "4px 10px", letterSpacing: "0.04em" }}>⚗ Inject 100 issues + 100 rows</button>
            : <button className="btn" onClick={clearTestIssues} style={{ fontSize: 10, color: "#fff", background: "#7a0000", border: "none", padding: "4px 10px", letterSpacing: "0.04em" }}>⚗ Clear test issues</button>
          }
          <button className="btn" onClick={load}
            style={{ fontSize: 11, color: "#9a9088", background: "none", border: "1px solid #ddd8d0", padding: "4px 10px" }}>
            ↻
          </button>
        </div>
      </div>

      {/* Header block + schedule — wrapped for print targeting */}
      <div id="archimind-transmittal-print">

      {/* Header block — outside scroll container so it never moves */}
      <div style={{ border: "1px solid #e8e0d5", borderBottom: "none", background: "#faf8f5" }}>
        <div style={{ borderBottom: "2px solid #e8e0d5", padding: "16px 16px", display: "flex", alignItems: "center", gap: 24, minHeight: 88 }}>
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
          <div style={{ padding: "8px 16px", background: "#faf8f5", borderBottom: "1px solid #e8e0d5" }}>
            {isAdmin ? (
              <textarea value={notesDraft} onChange={e => setNotesDraft(e.target.value)} onBlur={saveNotes}
                placeholder="Transmittal notes (optional)…" rows={2}
                style={{ width: "100%", fontSize: 11, border: "1px solid #ddd8d0", padding: "6px 8px", fontFamily: "Inter, Arial, sans-serif", resize: "vertical", color: colours.bodyText, background: "#fff", boxSizing: "border-box" }} />
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
              {(printSlicedIssues ?? issues).map((issue, i) => {
                const dt = new Date(issue.issue_date);
                const day   = String(dt.getUTCDate()).padStart(2, "0");
                const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
                const year  = String(dt.getUTCFullYear()).slice(2);
                const isLatest = i === (printSlicedIssues ?? issues).length - 1;
                const bg = isLatest ? colours.latestIssue : colours.header;
                return (
                  <th key={issue.id} style={{ ...thStyle, background: bg, color: colours.headerText, textAlign: "center", lineHeight: 1.4, borderLeft: "1px solid rgba(255,255,255,0.15)", position: "relative", paddingBottom: isAdmin ? 20 : undefined }}>
                    <div>{day}</div><div>{month}</div><div>{year}</div>
                    {isAdmin && !printSlicedIssues && (
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
                      {(printSlicedIssues ?? issues).map((issue, i) => {
                        const rev = revMap[issue.id]?.[d.drawing_number] || "";
                        const isLatest = i === (printSlicedIssues ?? issues).length - 1;
                        const isEditing = editingCell?.issueId === issue.id && editingCell?.drawingNumber === d.drawing_number;
                        return (
                          <td key={issue.id} style={{ ...tdStyle, textAlign: "center", padding: "2px 4px", fontWeight: rev ? 700 : 400, background: isLatest ? colours.latestIssue + "22" : rowBg, color: rev ? colours.bodyText : "#c8c0b8", borderLeft: "1px solid #e8e0d5" }}>
                            {isEditing ? (
                              <input autoFocus value={cellDraft} onChange={e => setCellDraft(e.target.value)}
                                onBlur={() => requestCellEdit(issue.id, issue.issue_date, d.drawing_number, d.title, cellDraft)}
                                onKeyDown={e => { if (e.key === "Enter") requestCellEdit(issue.id, issue.issue_date, d.drawing_number, d.title, cellDraft); if (e.key === "Escape") setEditingCell(null); }}
                                style={{ width: "100%", border: `1px solid ${AD_GREEN}`, padding: "2px 3px", fontSize: 11, fontFamily: "Inter, Arial, sans-serif", textAlign: "center", outline: "none", background: "#fff" }} />
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

      </div>{/* end #archimind-transmittal-print */}
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
      } catch (e) {}
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
        } catch (e) { console.error("Failed:", drawing.id, e); }
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

    const drawingContext = drawings.length === 0
      ? "No drawings in register."
      : drawings.map(d =>
          `ID:${d.id} | ${d.drawing_number || "—"} | ${d.title || "Untitled"} | Rev:${d.revision || "—"} | Status:${d.status || "—"} | Scale:${d.scale || "—"} | Date:${d.issue_date || "—"} | File:${d.file_name || "—"}`
        ).join("\n");

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
          if (typeof parsed.answer === "string" && parsed.answer.trim()) answerText = parsed.answer;
          if (Array.isArray(parsed.drawing_ids) && parsed.drawing_ids.length > 0) matchedDrawingIds = parsed.drawing_ids;
          if (Array.isArray(parsed.product_ids) && parsed.product_ids.length > 0) matchedProductIds = parsed.product_ids;
        }
      } catch (parseErr) {}
      setAnswer(answerText);
      if (matchedDrawingIds.length > 0) setMatchedDrawings(drawings.filter(d => matchedDrawingIds.includes(d.id)));
      if (matchedProductIds.length > 0) setMatchedProducts(assignedProducts.filter(a => a.products && matchedProductIds.includes(a.products.id)));
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
    setPdfUrl(null); setViewingPdfProduct(null);
  }

  const hasResults = answer || running || status || matchedDrawings.length > 0 || matchedProducts.length > 0;

  return (
    <div style={{ borderTop: "1px solid #e8e0d5", background: "#ffffff", flexShrink: 0 }}>
      {expanded && hasResults && (
        <div style={{ borderBottom: "1px solid #f0ede8", background: "#faf8f5", maxHeight: 400, overflowY: "auto", animation: "fadeIn 0.3s ease", position: "relative" }}>
          <button className="btn" onClick={() => { setAnswer(null); setMatchedDrawings([]); setMatchedProducts([]); setExpandedProductId(null); setStatus(""); setExpanded(false); }}
            style={{ position: "sticky", top: 8, float: "right", marginRight: 12, marginTop: 8, background: "none", color: "#b0a8a0", border: "1px solid #e8e0d5", fontSize: 11, padding: "2px 8px", zIndex: 10, fontFamily: "Inter, Arial, sans-serif" }}
            onMouseEnter={e => e.target.style.color = ARC_TERRACOTTA}
            onMouseLeave={e => e.target.style.color = "#b0a8a0"}>
            ✕
          </button>
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
              <div style={{ padding: "8px 16px", background: "#f0ede8", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {matchedDrawings.length} drawing{matchedDrawings.length !== 1 ? "s" : ""} found
                </span>
                <button className="btn" onClick={downloadAll} disabled={downloadingAll}
                  style={{ fontSize: 10, fontWeight: 600, color: ARC_NAVY, background: "none", border: `1px solid ${ARC_NAVY}`, padding: "3px 10px", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 5 }}>
                  {downloadingAll ? <><Spinner size={10} /> Downloading…</> : "↓ Download All"}
                </button>
              </div>
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
  const [assignments, setAssignments] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState({});
  const [pickerCategoryId, setPickerCategoryId] = useState(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);
  const [movingId, setMovingId] = useState(null);
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
      await load();
    } catch (e) { console.error(e); }
  }

  async function assignProduct(productId, categoryId) {
    try {
      const { product } = await api(`/api/projects/${projectId}/products`, {
        method: "POST",
        body: { product_id: productId, category_id: categoryId },
      });
      setAssignments(prev => [...prev, product]);
    } catch (e) {
      if (e.message?.includes("409") || e.message?.includes("already")) return;
      console.error(e);
    }
    setPickerCategoryId(null); setPickerSearch("");
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

  async function viewDatasheet(product) {
    setViewingProduct(product); setPdfLoading(true); setPdfUrl(null);
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
    setPdfUrl(null); setViewingProduct(null);
  }

  const assignedProductIds = new Set(assignments.map(a => a.product_id));
  function assignmentsForCategory(catId) { return assignments.filter(a => a.category_id === catId); }
  const pickerProducts = allProducts
    .filter(p => !assignedProductIds.has(p.id))
    .filter(p => {
      if (!pickerSearch.trim()) return true;
      const q = pickerSearch.toLowerCase();
      return (p.name || "").toLowerCase().includes(q) || (p.manufacturer || "").toLowerCase().includes(q);
    });
  const totalAssigned = assignments.length;

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9a9088", fontSize: 13 }}>
      <Spinner size={13} /> Loading products…
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h3 style={{ fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.1em", textTransform: "uppercase" }}>Specified Products</h3>
          {totalAssigned > 0 && <p style={{ fontSize: 11, color: "#b0a8a0", marginTop: 3 }}>{totalAssigned} product{totalAssigned !== 1 ? "s" : ""} assigned</p>}
        </div>
      </div>

      {categories.map(cat => {
        const catAssignments = assignmentsForCategory(cat.id);
        const isCollapsed = collapsed[cat.id];
        return (
          <div key={cat.id} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: ARC_NAVY, padding: "8px 14px", cursor: "pointer" }}
              onClick={() => setCollapsed(prev => ({ ...prev, [cat.id]: !prev[cat.id] }))}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fff", flex: 1 }}>{cat.name}</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginRight: 4 }}>{catAssignments.length > 0 ? `${catAssignments.length}` : ""}</span>
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
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: ARC_NAVY, marginBottom: 1 }}>{prod.name}</div>
                          <div style={{ fontSize: 11, color: "#9a9088" }}>{prod.manufacturer || "—"}</div>
                        </div>
                        {prod.product_type && (
                          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "#2a6496", background: "#e8f0f8", padding: "2px 7px", flexShrink: 0 }}>
                            {prod.product_type}
                          </span>
                        )}
                        {prod.file_key && (
                          <button className="btn" onClick={() => viewDatasheet(prod)}
                            style={{ fontSize: 11, color: "#2a6496", background: "none", border: "1px solid #b8d0e8", padding: "3px 10px", flexShrink: 0, fontWeight: 500 }}>
                            📄 Datasheet
                          </button>
                        )}
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

// ── Drawings tab (with Register / Transmittal sub-tabs) ───────────────────────
function DrawingsTab({ projectId, isAdmin, onDrawingsLoaded }) {
  const [drawingSubTab, setDrawingSubTab] = useState("register");
  const [drawings, setDrawings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);
  const [viewingDrawing, setViewingDrawing] = useState(null);
  const fileInputRef = useRef(null);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [downloadingSelected, setDownloadingSelected] = useState(false);

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

  const drawingTypeOptions = [...new Set(drawings.map(d => d.drawing_type).filter(Boolean))].sort();
  const volumeOptions = [...new Set(drawings.map(d => d.volume).filter(Boolean))].sort();
  const levelOptions = [...new Set(drawings.map(d => d.level).filter(Boolean))].sort();
  const hasFilters = filterText || filterDrawingType || filterVolume || filterLevel || filterFileType;

  function clearFilters() {
    setFilterText(""); setFilterDrawingType(""); setFilterVolume(""); setFilterLevel(""); setFilterFileType("");
    setSelectedIds(new Set());
  }

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

  const subTabStyle = (id) => ({
    padding: "6px 14px", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase",
    background: drawingSubTab === id ? ARC_NAVY : "transparent",
    color: drawingSubTab === id ? "#fff" : "#9a9088",
    border: `1px solid ${drawingSubTab === id ? ARC_NAVY : "#ddd8d0"}`,
    cursor: "pointer", fontFamily: "Inter, Arial, sans-serif",
    borderRadius: 2,
  });

  return (
    <div>
      {/* Sub-tab switcher */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 20 }}>
        <button className="btn" style={subTabStyle("register")} onClick={() => setDrawingSubTab("register")}>
          Register
        </button>
        <button className="btn" style={subTabStyle("transmittal")} onClick={() => setDrawingSubTab("transmittal")}>
          Drawing Schedule
        </button>
      </div>

      {/* Register sub-tab */}
      {drawingSubTab === "register" && (
        <div>
          {/* Section header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <h3 style={{ fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.1em", textTransform: "uppercase" }}>Drawing Register</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {isAdmin && !showUpload && (
                <button className="btn" onClick={() => setShowUpload(true)}
                  style={{ fontSize: 11, color: AD_GREEN, background: "none", border: `1px solid ${AD_GREEN}`, padding: "4px 12px", fontWeight: 600, letterSpacing: "0.04em" }}>
                  + Upload Drawing
                </button>
              )}
            </div>
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
      )}

      {/* Transmittal sub-tab */}
      {drawingSubTab === "transmittal" && (
        <TransmittalTab projectId={projectId} isAdmin={isAdmin} />
      )}
    </div>
  );
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
      setNewConsultant({ discipline: "", company: "", contact_name: "", email: "", phone: "" });
      setAddingConsultant(false);
    } catch (e) { console.error(e); }
    setSavingKey("consultant", false);
  }

  async function deleteConsultant(cid) {
    try { await api(`/api/projects/${projectId}/consultants/${cid}`, { method: "DELETE" }); setData(d => ({ ...d, consultants: d.consultants.filter(c => c.id !== cid) })); } catch (e) { console.error(e); }
  }

  async function updateUvalue(uid, field, value) {
    const uv = data.uvalues.find(u => u.id === uid);
    const updated = { ...uv, [field]: value === "" ? null : parseFloat(value) || value };
    try { await api(`/api/projects/${projectId}/uvalues/${uid}`, { method: "PATCH", body: updated }); setData(d => ({ ...d, uvalues: d.uvalues.map(u => u.id === uid ? updated : u) })); } catch (e) { console.error(e); }
  }

  async function addUvalue() {
    if (!newUvalueElement.trim()) return;
    setSavingKey("uvalue", true);
    try {
      const { uvalue } = await api(`/api/projects/${projectId}/uvalues`, { method: "POST", body: { element: newUvalueElement.trim() } });
      setData(d => ({ ...d, uvalues: [...d.uvalues, uvalue] }));
      setNewUvalueElement(""); setAddingUvalue(false);
    } catch (e) { console.error(e); }
    setSavingKey("uvalue", false);
  }

  async function deleteUvalue(uid) {
    try { await api(`/api/projects/${projectId}/uvalues/${uid}`, { method: "DELETE" }); setData(d => ({ ...d, uvalues: d.uvalues.filter(u => u.id !== uid) })); } catch (e) { console.error(e); }
  }

  async function addNote() {
    if (!newNote.label.trim()) return;
    setSavingKey("note", true);
    try {
      const { note } = await api(`/api/projects/${projectId}/notes`, { method: "POST", body: { label: newNote.label.trim(), value: newNote.value.trim(), sort_order: data.notes.length } });
      setData(d => ({ ...d, notes: [...d.notes, note] }));
      setNewNote({ label: "", value: "" }); setAddingNote(false);
    } catch (e) { console.error(e); }
    setSavingKey("note", false);
  }

  async function updateNote(nid, field, value) {
    const note = data.notes.find(n => n.id === nid);
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
                  style={{ width: "100%", border: "1px solid #ddd8d0", padding: "8px 12px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none", boxSizing: "border-box" }} />
              </div>
            ))}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>RIBA Stage</label>
              <select value={editForm.stage || ""} onChange={e => setEditForm(f => ({ ...f, stage: e.target.value }))}
                style={{ width: "100%", border: "1px solid #ddd8d0", padding: "8px 12px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: editForm.stage ? ARC_NAVY : "#9a9088", outline: "none", boxSizing: "border-box" }}>
                <option value="">Select stage…</option>
                {RIBA_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Status</label>
              <select value={editForm.status || "active"} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                style={{ width: "100%", border: "1px solid #ddd8d0", padding: "8px 12px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none", boxSizing: "border-box" }}>
                {["active","on-hold","complete","archived"].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" onClick={saveEditForm} disabled={saving.editForm}
                style={{ background: ARC_NAVY, color: "#fff", padding: "9px 24px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {saving.editForm ? <Spinner size={12} /> : "Save Changes"}
              </button>
              <button className="btn" onClick={() => setEditingProject(false)} style={{ background: "none", color: "#9a9088", padding: "9px 16px", fontSize: 11, border: "1px solid #ddd8d0" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>

        {activeTab === "info" && (
          <div style={{ maxWidth: 700 }}>
            {sectionTitle("Project Information")}
            <div style={{ background: "#fff", border: "1px solid #e8e0d5", padding: "24px" }}>
              {[
                ["Job Number", "job_number"],
                ["Client", "client"],
                ["Location", "location"],
                ["Project Lead", "project_lead"],
                ["Description", "description"],
              ].map(([label, field]) => (
                <div key={field} style={{ display: "flex", marginBottom: 16, gap: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.06em", textTransform: "uppercase", width: 120, flexShrink: 0, paddingTop: 2 }}>{label}</div>
                  <div style={{ flex: 1, fontSize: 13, color: ARC_NAVY }}>
                    {isAdmin
                      ? <EditableField value={project[field]} onSave={async v => { try { const { project: p } = await api(`/api/projects/${projectId}`, { method: "PATCH", body: { [field]: v } }); setData(d => ({ ...d, project: p })); } catch (e) { console.error(e); } }} placeholder={`Click to add ${label.toLowerCase()}…`} multiline={field === "description"} />
                      : <span style={{ color: project[field] ? ARC_NAVY : "#b0a8a0", fontStyle: project[field] ? "normal" : "italic" }}>{project[field] || `No ${label.toLowerCase()} set`}</span>
                    }
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", marginBottom: 0, gap: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.06em", textTransform: "uppercase", width: 120, flexShrink: 0, paddingTop: 2 }}>RIBA Stage</div>
                <div style={{ flex: 1 }}>
                  {isAdmin ? (
                    <select value={project.stage || ""} onChange={async e => { try { const { project: p } = await api(`/api/projects/${projectId}`, { method: "PATCH", body: { stage: e.target.value } }); setData(d => ({ ...d, project: p })); } catch (err) { console.error(err); } }}
                      style={{ border: "1px solid #ddd8d0", padding: "5px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: project.stage ? ARC_NAVY : "#9a9088", outline: "none", background: "#fff" }}>
                      <option value="">Select stage…</option>
                      {RIBA_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <span style={{ fontSize: 13, color: project.stage ? ARC_NAVY : "#b0a8a0" }}>{project.stage || "No stage set"}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "consultants" && (
          <div style={{ maxWidth: 800 }}>
            {sectionTitle("Consultants", isAdmin && addBtn("Add Consultant", () => setAddingConsultant(true)))}
            {addingConsultant && (
              <div style={{ background: "#fff", border: `1px solid ${AD_GREEN}`, padding: "20px 24px", marginBottom: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
                  {[["discipline","Discipline"],["company","Company"],["contact_name","Contact Name"],["email","Email"],["phone","Phone"]].map(([f, l]) => (
                    <div key={f} style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>{l}</label>
                      <input value={newConsultant[f]} onChange={e => setNewConsultant(c => ({ ...c, [f]: e.target.value }))}
                        style={{ width: "100%", border: "1px solid #ddd8d0", padding: "7px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none", boxSizing: "border-box" }} />
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn" onClick={addConsultant} disabled={saving.consultant}
                    style={{ background: AD_GREEN, color: "#fff", padding: "7px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    {saving.consultant ? <Spinner size={11} /> : "Add"}
                  </button>
                  <button className="btn" onClick={() => { setAddingConsultant(false); setNewConsultant({ discipline: "", company: "", contact_name: "", email: "", phone: "" }); }}
                    style={{ background: "none", color: "#9a9088", padding: "7px 12px", fontSize: 11, border: "1px solid #ddd8d0" }}>Cancel</button>
                </div>
              </div>
            )}
            {consultants.length === 0 ? (
              <p style={{ fontSize: 13, color: "#9a9088", fontStyle: "italic" }}>No consultants added yet.</p>
            ) : (
              <div style={{ background: "#fff", border: "1px solid #e8e0d5" }}>
                {consultants.map((c, i) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "14px 20px", borderBottom: i < consultants.length - 1 ? "1px solid #f0ede8" : "none" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: ARC_NAVY, marginBottom: 3 }}>{c.company || "—"}</div>
                      <div style={{ fontSize: 11, color: "#9a9088", display: "flex", gap: 16, flexWrap: "wrap" }}>
                        {c.discipline && <span style={{ fontWeight: 600, color: "#6a7a8a" }}>{c.discipline}</span>}
                        {c.contact_name && <span>👤 {c.contact_name}</span>}
                        {c.email && <span>✉ {c.email}</span>}
                        {c.phone && <span>📞 {c.phone}</span>}
                      </div>
                    </div>
                    {isAdmin && <button className="btn" onClick={() => deleteConsultant(c.id)}
                      style={{ background: "none", color: "#c8c0b8", fontSize: 16, padding: "0 4px", border: "none", flexShrink: 0 }}
                      onMouseEnter={e => e.target.style.color = ARC_TERRACOTTA} onMouseLeave={e => e.target.style.color = "#c8c0b8"}>×</button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "u-values" && (
          <div style={{ maxWidth: 800 }}>
            {sectionTitle("U-Value Targets", isAdmin && addBtn("Add Element", () => setAddingUvalue(true)))}
            {addingUvalue && (
              <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
                <input value={newUvalueElement} onChange={e => setNewUvalueElement(e.target.value)} autoFocus placeholder="Element name…"
                  onKeyDown={e => { if (e.key === "Enter") addUvalue(); if (e.key === "Escape") { setAddingUvalue(false); setNewUvalueElement(""); } }}
                  style={{ flex: 1, border: "1px solid #ddd8d0", padding: "7px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none" }} />
                <button className="btn" onClick={addUvalue} disabled={!newUvalueElement.trim() || saving.uvalue}
                  style={{ background: AD_GREEN, color: "#fff", padding: "7px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {saving.uvalue ? <Spinner size={11} /> : "Add"}
                </button>
                <button className="btn" onClick={() => { setAddingUvalue(false); setNewUvalueElement(""); }}
                  style={{ background: "none", color: "#9a9088", padding: "7px 12px", fontSize: 11, border: "1px solid #ddd8d0" }}>Cancel</button>
              </div>
            )}
            <div style={{ background: "#fff", border: "1px solid #e8e0d5" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px 1fr 36px", gap: "0 12px", padding: "8px 16px", background: ARC_NAVY }}>
                {["Element", "Target (W/m²K)", "Achieved (W/m²K)", "Notes", ""].map((h, i) => (
                  <div key={i} style={{ fontSize: 10, fontWeight: 500, color: "#fff", letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</div>
                ))}
              </div>
              {uvalues.map((u, i) => (
                <div key={u.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px 1fr 36px", gap: "0 12px", padding: "10px 16px", alignItems: "center", background: i % 2 === 0 ? "#faf8f5" : "#fff", borderBottom: "1px solid #f0ede8" }}>
                  <div style={{ fontSize: 13, color: ARC_NAVY, fontWeight: 500 }}>{u.element}</div>
                  <div><EditableField value={u.target !== null ? String(u.target) : ""} onSave={v => updateUvalue(u.id, "target", v)} placeholder="—" style={{ fontSize: 13, textAlign: "center" }} /></div>
                  <div><EditableField value={u.achieved !== null ? String(u.achieved) : ""} onSave={v => updateUvalue(u.id, "achieved", v)} placeholder="—" style={{ fontSize: 13, textAlign: "center" }} /></div>
                  <div><EditableField value={u.notes} onSave={v => updateUvalue(u.id, "notes", v)} placeholder="Notes…" style={{ fontSize: 12 }} /></div>
                  {isAdmin && <button className="btn" onClick={() => deleteUvalue(u.id)}
                    style={{ background: "none", color: "#c8c0b8", fontSize: 16, padding: "0 4px", border: "none", textAlign: "center" }}
                    onMouseEnter={e => e.target.style.color = ARC_TERRACOTTA} onMouseLeave={e => e.target.style.color = "#c8c0b8"}>×</button>}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "notes" && (
          <div style={{ maxWidth: 700 }}>
            {sectionTitle("Key Notes", isAdmin && addBtn("Add Note", () => setAddingNote(true)))}
            {addingNote && (
              <div style={{ background: "#fff", border: `1px solid ${AD_GREEN}`, padding: "16px 20px", marginBottom: 14 }}>
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Label</label>
                  <input value={newNote.label} onChange={e => setNewNote(n => ({ ...n, label: e.target.value }))} autoFocus placeholder="e.g. Planning reference"
                    style={{ width: "100%", border: "1px solid #ddd8d0", padding: "7px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none", boxSizing: "border-box" }} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Value</label>
                  <input value={newNote.value} onChange={e => setNewNote(n => ({ ...n, value: e.target.value }))} placeholder="e.g. 22/01234/FUL"
                    style={{ width: "100%", border: "1px solid #ddd8d0", padding: "7px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none", boxSizing: "border-box" }} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn" onClick={addNote} disabled={!newNote.label.trim() || saving.note}
                    style={{ background: AD_GREEN, color: "#fff", padding: "7px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    {saving.note ? <Spinner size={11} /> : "Add"}
                  </button>
                  <button className="btn" onClick={() => { setAddingNote(false); setNewNote({ label: "", value: "" }); }}
                    style={{ background: "none", color: "#9a9088", padding: "7px 12px", fontSize: 11, border: "1px solid #ddd8d0" }}>Cancel</button>
                </div>
              </div>
            )}
            {notes.length === 0 ? (
              <p style={{ fontSize: 13, color: "#9a9088", fontStyle: "italic" }}>No notes added yet.</p>
            ) : (
              <div style={{ background: "#fff", border: "1px solid #e8e0d5" }}>
                {notes.map((n, i) => (
                  <div key={n.id} style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "12px 20px", borderBottom: i < notes.length - 1 ? "1px solid #f0ede8" : "none", background: i % 2 === 0 ? "#faf8f5" : "#fff" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.04em", textTransform: "uppercase", width: 140, flexShrink: 0, paddingTop: 2 }}>
                      <EditableField value={n.label} onSave={v => updateNote(n.id, "label", v)} placeholder="Label" style={{ fontSize: 11 }} />
                    </div>
                    <div style={{ flex: 1, fontSize: 13, color: ARC_NAVY }}>
                      <EditableField value={n.value} onSave={v => updateNote(n.id, "value", v)} placeholder="Value…" multiline />
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

        {activeTab === "documents" && <DocumentsTab projectId={projectId} isAdmin={isAdmin} />}
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
