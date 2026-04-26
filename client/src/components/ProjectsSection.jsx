import { useState, useEffect, useRef } from "react";
import { api, callClaude } from "../api/client";
import AnswerRenderer from "./common/AnswerRenderer";
import { Spinner } from "./common/Spinner";
import { ARC_NAVY, ARC_TERRACOTTA, ARC_STONE, AD_GREEN } from "../constants";

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
  "Stage 0": "#9a9088",
  "Stage 1": "#7a6aaa",
  "Stage 2": "#2a6496",
  "Stage 3": AD_GREEN,
  "Stage 4": "#c25a45",
  "Stage 5": "#c28a20",
  "Stage 6": "#4a7c20",
  "Stage 7": "#505a5f",
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

function QABar({ project, consultants, uvalues, notes }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState(false);

  async function ask() {
    if (!question.trim() || running) return;
    const q = question.trim();
    setQuestion(""); setRunning(true); setAnswer(null); setExpanded(true); setStatus("Thinking…");
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
${notes.length === 0 ? "None recorded." : notes.map(n => `${n.label}: ${n.value}`).join("\n")}`;
    try {
      const { text } = await callClaude(
        [{ role: "user", content: `${ctx}\n\n---\n\nQUESTION: ${q}` }],
        "You are a helpful assistant at an architectural practice. Answer questions about the project using only the information provided. Be concise and practical. If the information needed is not in the project data, say so clearly.",
        2000, 1, "gemini-2.5-flash"
      );
      setAnswer(text); setStatus("");
    } catch (e) { setStatus("Error: " + e.message); }
    setRunning(false);
  }

  return (
    <div style={{ borderTop: "1px solid #e8e0d5", background: "#ffffff", flexShrink: 0 }}>
      {expanded && (answer || running || status) && (
        <div style={{ padding: "16px 32px", borderBottom: "1px solid #f0ede8", background: "#faf8f5", maxHeight: 260, overflowY: "auto", animation: "fadeIn 0.3s ease" }}>
          {running && <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9a9088", fontSize: 12 }}><Spinner size={11} /> {status}</div>}
          {answer && <AnswerRenderer text={answer} />}
          {!running && status && <p style={{ fontSize: 12, color: ARC_TERRACOTTA }}>{status}</p>}
        </div>
      )}
      <div style={{ padding: "12px 32px", display: "flex", alignItems: "stretch" }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "flex", alignItems: "center", paddingRight: 12, flexShrink: 0 }}>Ask</div>
        <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === "Enter") ask(); }}
          placeholder="Ask anything about this project…" className="arc-input"
          style={{ flex: 1, border: "1px solid #ddd8d0", borderRight: "none", padding: "8px 14px", fontSize: 13, color: ARC_NAVY, outline: "none", fontFamily: "Inter, Arial, sans-serif", background: "#fff" }} />
        <button className="btn" onClick={ask} disabled={!question.trim() || running}
          style={{ background: question.trim() && !running ? ARC_NAVY : "#f0ede8", color: question.trim() && !running ? "#fff" : "#9a9088", padding: "0 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", border: `1px solid ${question.trim() && !running ? ARC_NAVY : "#ddd8d0"}`, minWidth: 70 }}>
          {running ? <Spinner size={12} /> : "Ask"}
        </button>
        {(answer || status) && (
          <button className="btn" onClick={() => { setAnswer(null); setStatus(""); setExpanded(false); }}
            style={{ background: "none", color: "#9a9088", padding: "0 10px", fontSize: 11, border: "1px solid #ddd8d0", borderLeft: "none", marginLeft: -1 }}>Clear</button>
        )}
      </div>
    </div>
  );
}

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
    { id: "minutes", label: "Minutes" }, { id: "emails", label: "Emails" },
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
                <option value="active">Active</option>
                <option value="on-hold">On Hold</option>
                <option value="complete">Complete</option>
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

        {activeTab === "drawings" && <PlaceholderTab icon="📐" title="Drawing Repository" description="Upload, version and search drawings for this project. Pull up the latest revision of any drawing by asking in the Q&A bar below." />}
        {activeTab === "documents" && <PlaceholderTab icon="📁" title="Documents" description="Store and retrieve project documents — reports, specifications, certificates, and other project-specific files." />}
        {activeTab === "minutes" && <PlaceholderTab icon="📝" title="Meeting Minutes" description="Upload or paste meeting minutes. Search and query them using the Q&A bar below to find decisions, actions, and key discussion points." />}
        {activeTab === "emails" && <PlaceholderTab icon="✉️" title="Emails" description="Connect your email to index project correspondence. Search threads, find attachments, and ask questions across the full project email history." />}

      </div>

      <QABar project={project} consultants={consultants} uvalues={uvalues} notes={notes} />
    </div>
  );
}

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
