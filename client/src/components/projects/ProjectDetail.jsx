import { useState, useEffect } from "react";
import { api } from "../../api/client";
import { DESIGN_TEXT, DESIGN_GROUND, PROJECTS_FULL, COMPARE_FULL } from "../../constants";
import { RIBA_STAGES, stageColor } from "./projectHelpers";
import { Spinner } from "../common/Spinner";
import { showToast } from "./toast";
import EditableField from "./EditableField";
import DocumentsTab from "./DocumentsTab";
import DrawingsTab from "./DrawingsTab";
import ProductsTab from "./ProductsTab";
import EmailsTab from "./emails";
import PlaceholderTab from "./PlaceholderTab";
import QABar from "./QABar";
import TaskBoard from "../TaskBoard";
import AgreementsTab from "../AgreementsTab";

// ── Project detail ────────────────────────────────────────────────────────────
export default function ProjectDetail({ projectId, onBack, isAdmin }) {
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
  const [deleting, setDeleting] = useState(false);          // delete-confirm modal open
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [drawings, setDrawings] = useState([]);

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    try { const d = await api(`/api/projects/${projectId}`); setData(d); } catch (e) { console.error(e); showToast("Failed to load project"); }
    setLoading(false);
  }

  const setSavingKey = (key, val) => setSaving(s => ({ ...s, [key]: val }));

  // Archive = soft hide (reversible); Restore = back to active. Both just set status.
  async function setProjectStatus(status, doneMsg, onDone) {
    setStatusSaving(true);
    try {
      const { project } = await api(`/api/projects/${projectId}`, { method: "PATCH", body: { status } });
      setData(d => ({ ...d, project }));
      showToast(doneMsg);
      onDone && onDone();
    } catch (e) { console.error(e); showToast("Failed to update project"); }
    setStatusSaving(false);
  }

  // Permanent delete — DB cascade removes everything linked (incl. timesheets & expenses).
  async function deleteProject() {
    try {
      await api(`/api/projects/${projectId}`, { method: "DELETE" });
      showToast("Project deleted");
      onBack();   // clears selection and refreshes the list
    } catch (e) { console.error(e); showToast("Failed to delete project"); }
  }

  async function saveEditForm() {
    setSavingKey("editForm", true);
    try { const { project } = await api(`/api/projects/${projectId}`, { method: "PATCH", body: editForm }); setData(d => ({ ...d, project })); setEditingProject(false); } catch (e) { console.error(e); showToast("Failed to save project"); }
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
    } catch (e) { console.error(e); showToast("Failed to add consultant"); }
    setSavingKey("consultant", false);
  }

  async function deleteConsultant(cid) {
    try { await api(`/api/projects/${projectId}/consultants/${cid}`, { method: "DELETE" }); setData(d => ({ ...d, consultants: d.consultants.filter(c => c.id !== cid) })); } catch (e) { console.error(e); showToast("Failed to remove consultant"); }
  }

  async function updateUvalue(uid, field, value) {
    const uv = data.uvalues.find(u => u.id === uid);
    const updated = { ...uv, [field]: value === "" ? null : parseFloat(value) || value };
    try { await api(`/api/projects/${projectId}/uvalues/${uid}`, { method: "PATCH", body: updated }); setData(d => ({ ...d, uvalues: d.uvalues.map(u => u.id === uid ? updated : u) })); } catch (e) { console.error(e); showToast("Failed to save U-value"); }
  }

  async function addUvalue() {
    if (!newUvalueElement.trim()) return;
    setSavingKey("uvalue", true);
    try {
      const { uvalue } = await api(`/api/projects/${projectId}/uvalues`, { method: "POST", body: { element: newUvalueElement.trim() } });
      setData(d => ({ ...d, uvalues: [...d.uvalues, uvalue] }));
      setNewUvalueElement(""); setAddingUvalue(false);
    } catch (e) { console.error(e); showToast("Failed to add U-value"); }
    setSavingKey("uvalue", false);
  }

  async function deleteUvalue(uid) {
    try { await api(`/api/projects/${projectId}/uvalues/${uid}`, { method: "DELETE" }); setData(d => ({ ...d, uvalues: d.uvalues.filter(u => u.id !== uid) })); } catch (e) { console.error(e); showToast("Failed to delete U-value"); }
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
    try { await api(`/api/projects/${projectId}/notes/${nid}`, { method: "PATCH", body: updated }); setData(d => ({ ...d, notes: d.notes.map(n => n.id === nid ? updated : n) })); } catch (e) { console.error(e); showToast("Failed to save note"); }
  }

  async function deleteNote(nid) {
    try { await api(`/api/projects/${projectId}/notes/${nid}`, { method: "DELETE" }); setData(d => ({ ...d, notes: d.notes.filter(n => n.id !== nid) })); } catch (e) { console.error(e); showToast("Failed to delete note"); }
  }

  if (loading) return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: "#9a9088" }}><Spinner size={14} /> Loading project…</div>;
  if (!data) return null;

  const { project, consultants, uvalues, notes } = data;
  const sColor = stageColor(project.stage);

  const TABS = [
    { id: "info", label: "Info" }, { id: "consultants", label: "Consultants" }, { id: "u-values", label: "U-Values" },
    { id: "notes", label: "Notes" }, { id: "drawings", label: "Drawings" }, { id: "documents", label: "Documents" },
    { id: "products", label: "Products" }, { id: "minutes", label: "Minutes" }, { id: "emails", label: "Emails" },
    { id: "tasks", label: "To Do" },
    { id: "agreements", label: "Agreements" },
  ];

  const tabStyle = t => ({
    padding: "10px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
    background: activeTab === t ? "#ffffff" : "transparent", color: activeTab === t ? DESIGN_TEXT : "#9a9088",
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
    <button className="btn" onClick={onClick} style={{ fontSize: 11, color: PROJECTS_FULL, background: "none", border: `1px solid ${PROJECTS_FULL}`, padding: "4px 12px", fontWeight: 600, letterSpacing: "0.04em" }}>+ {label}</button>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: "#ffffff", borderBottom: "1px solid #e8e0d5", padding: "20px 32px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
          <button className="btn" onClick={onBack} style={{ background: "none", color: "#9a9088", fontSize: 13, padding: "4px 0", border: "none", display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginTop: 2 }}>← Back</button>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <h1 style={{ fontSize: 22, fontWeight: 300, color: DESIGN_TEXT, fontFamily: "Inter, Arial, sans-serif" }}>{project.name}</h1>
              {project.status === "archived" && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9a9088", background: "#ece8e2", padding: "3px 8px" }}>Archived</span>}
              {project.job_number && <span style={{ fontSize: 11, color: "#9a9088", background: DESIGN_GROUND, padding: "2px 8px", fontWeight: 500 }}>#{project.job_number}</span>}
              {project.stage && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: sColor, background: `${sColor}18`, padding: "3px 8px" }}>{project.stage.split("—")[0].trim()}</span>}
            </div>
            <div style={{ fontSize: 12, color: "#9a9088", display: "flex", gap: 20, flexWrap: "wrap" }}>
              {project.client && <span>👤 {project.client}</span>}
              {project.location && <span>📍 {project.location}</span>}
              {project.project_lead && <span>🧑‍💼 {project.project_lead}</span>}
              {project.stage && <span>🏗 {project.stage}</span>}
            </div>
          </div>
          {isAdmin && (
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button className="btn" onClick={() => { setEditForm({ ...project }); setEditingProject(true); }} style={{ background: "none", color: "#9a9088", border: "1px solid #e4e4e8", padding: "6px 14px", fontSize: 11 }}>Edit</button>
              {project.status === "archived"
                ? <button className="btn" disabled={statusSaving} onClick={() => setProjectStatus("active", "Project restored")} style={{ background: "none", color: PROJECTS_FULL, border: `1px solid ${PROJECTS_FULL}`, padding: "6px 14px", fontSize: 11 }}>Restore</button>
                : <button className="btn" disabled={statusSaving} onClick={() => setProjectStatus("archived", "Project archived", onBack)} style={{ background: "none", color: "#9a9088", border: "1px solid #e4e4e8", padding: "6px 14px", fontSize: 11 }}>Archive</button>}
              <button className="btn" onClick={() => { setDeleteConfirmText(""); setDeleting(true); }} style={{ background: "none", color: "#b23a2e", border: "1px solid #e3b8b2", padding: "6px 14px", fontSize: 11 }}>Delete</button>
            </div>
          )}
        </div>
        <div style={{ display: "flex", overflowX: "auto" }}>
          {TABS.map(t => <button key={t.id} className="btn" style={tabStyle(t.id)} onClick={() => setActiveTab(t.id)}>{t.label}</button>)}
        </div>
      </div>

      {/* Delete confirmation modal */}
      {deleting && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", padding: "28px 32px", width: 520, borderTop: "3px solid #b23a2e", fontFamily: "Inter, Arial, sans-serif", maxHeight: "90vh", overflowY: "auto" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "#b23a2e", marginBottom: 12 }}>Delete project?</h2>
            <p style={{ fontSize: 13, color: DESIGN_TEXT, lineHeight: 1.6, marginBottom: 12 }}>
              This permanently deletes <b>{project.name}</b> and <b>everything attached to it</b> — drawings, notes, consultants, U-values, agreements, transmittals, products, and any <b>timesheets and expenses logged against it</b>. This cannot be undone, and there are no backups.
            </p>
            <p style={{ fontSize: 12, color: "#9a9088", marginBottom: 6 }}>Type the project name <b>{project.name}</b> to confirm:</p>
            <input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)} autoFocus placeholder={project.name}
              style={{ width: "100%", border: "1px solid #e4e4e8", padding: "8px 12px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, outline: "none", boxSizing: "border-box", marginBottom: 18 }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="btn" onClick={() => setDeleting(false)} style={{ background: "none", color: "#9a9088", border: "1px solid #e4e4e8", padding: "8px 18px", fontSize: 12 }}>Cancel</button>
              <button className="btn" disabled={deleteConfirmText.trim() !== project.name}
                onClick={() => { setDeleting(false); deleteProject(); }}
                style={{ background: deleteConfirmText.trim() !== project.name ? "#e0c4c0" : "#b23a2e", color: "#fff", border: "none", padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: deleteConfirmText.trim() !== project.name ? "default" : "pointer" }}>
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editingProject && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", padding: "32px", width: 560, borderTop: `3px solid ${COMPARE_FULL}`, fontFamily: "Inter, Arial, sans-serif", maxHeight: "90vh", overflowY: "auto" }}>
            <h2 style={{ fontSize: 16, fontWeight: 500, color: DESIGN_TEXT, marginBottom: 20 }}>Edit Project</h2>
            {[["name","Project Name"],["job_number","Job Number"],["client","Client"],["location","Location"],["project_lead","Project Lead"],["description","Description"]].map(([field, label]) => (
              <div key={field} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>{label}</label>
                <input value={editForm[field] || ""} onChange={e => setEditForm(f => ({ ...f, [field]: e.target.value }))}
                  style={{ width: "100%", border: "1px solid #e4e4e8", padding: "8px 12px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, outline: "none", boxSizing: "border-box" }} />
              </div>
            ))}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>RIBA Stage</label>
              <select value={editForm.stage || ""} onChange={e => setEditForm(f => ({ ...f, stage: e.target.value }))}
                style={{ width: "100%", border: "1px solid #e4e4e8", padding: "8px 12px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: editForm.stage ? DESIGN_TEXT : "#9a9088", outline: "none", boxSizing: "border-box" }}>
                <option value="">Select stage…</option>
                {RIBA_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Status</label>
              <select value={editForm.status || "active"} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                style={{ width: "100%", border: "1px solid #e4e4e8", padding: "8px 12px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, outline: "none", boxSizing: "border-box" }}>
                {["active","on-hold","complete","archived"].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" onClick={saveEditForm} disabled={saving.editForm}
                style={{ background: DESIGN_TEXT, color: "#fff", padding: "9px 24px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {saving.editForm ? <Spinner size={12} /> : "Save Changes"}
              </button>
              <button className="btn" onClick={() => setEditingProject(false)} style={{ background: "none", color: "#9a9088", padding: "9px 16px", fontSize: 11, border: "1px solid #e4e4e8" }}>Cancel</button>
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
                  <div style={{ flex: 1, fontSize: 13, color: DESIGN_TEXT }}>
                    {isAdmin
                      ? <EditableField value={project[field]} onSave={async v => { try { const { project: p } = await api(`/api/projects/${projectId}`, { method: "PATCH", body: { [field]: v } }); setData(d => ({ ...d, project: p })); } catch (e) { console.error(e); showToast("Failed to save"); } }} placeholder={`Click to add ${label.toLowerCase()}…`} multiline={field === "description"} />
                      : <span style={{ color: project[field] ? DESIGN_TEXT : "#b0a8a0", fontStyle: project[field] ? "normal" : "italic" }}>{project[field] || `No ${label.toLowerCase()} set`}</span>
                    }
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", marginBottom: 0, gap: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.06em", textTransform: "uppercase", width: 120, flexShrink: 0, paddingTop: 2 }}>RIBA Stage</div>
                <div style={{ flex: 1 }}>
                  {isAdmin ? (
                    <select value={project.stage || ""} onChange={async e => { try { const { project: p } = await api(`/api/projects/${projectId}`, { method: "PATCH", body: { stage: e.target.value } }); setData(d => ({ ...d, project: p })); } catch (err) { console.error(err); showToast("Failed to save stage"); } }}
                      style={{ border: "1px solid #e4e4e8", padding: "5px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: project.stage ? DESIGN_TEXT : "#9a9088", outline: "none", background: "#fff" }}>
                      <option value="">Select stage…</option>
                      {RIBA_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <span style={{ fontSize: 13, color: project.stage ? DESIGN_TEXT : "#b0a8a0" }}>{project.stage || "No stage set"}</span>
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
              <div style={{ background: "#fff", border: `1px solid ${PROJECTS_FULL}`, padding: "20px 24px", marginBottom: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
                  {[["discipline","Discipline"],["company","Company"],["contact_name","Contact Name"],["email","Email"],["phone","Phone"]].map(([f, l]) => (
                    <div key={f} style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>{l}</label>
                      <input value={newConsultant[f]} onChange={e => setNewConsultant(c => ({ ...c, [f]: e.target.value }))}
                        style={{ width: "100%", border: "1px solid #e4e4e8", padding: "7px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, outline: "none", boxSizing: "border-box" }} />
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn" onClick={addConsultant} disabled={saving.consultant}
                    style={{ background: PROJECTS_FULL, color: "#fff", padding: "7px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    {saving.consultant ? <Spinner size={11} /> : "Add"}
                  </button>
                  <button className="btn" onClick={() => { setAddingConsultant(false); setNewConsultant({ discipline: "", company: "", contact_name: "", email: "", phone: "" }); }}
                    style={{ background: "none", color: "#9a9088", padding: "7px 12px", fontSize: 11, border: "1px solid #e4e4e8" }}>Cancel</button>
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
                      <div style={{ fontSize: 13, fontWeight: 600, color: DESIGN_TEXT, marginBottom: 3 }}>{c.company || "—"}</div>
                      <div style={{ fontSize: 11, color: "#9a9088", display: "flex", gap: 16, flexWrap: "wrap" }}>
                        {c.discipline && <span style={{ fontWeight: 600, color: "#6a7a8a" }}>{c.discipline}</span>}
                        {c.contact_name && <span>👤 {c.contact_name}</span>}
                        {c.email && <span>✉ {c.email}</span>}
                        {c.phone && <span>📞 {c.phone}</span>}
                      </div>
                    </div>
                    {isAdmin && <button className="btn" onClick={() => deleteConsultant(c.id)}
                      style={{ background: "none", color: "#c8c0b8", fontSize: 16, padding: "0 4px", border: "none", flexShrink: 0 }}
                      onMouseEnter={e => e.target.style.color = COMPARE_FULL} onMouseLeave={e => e.target.style.color = "#c8c0b8"}>×</button>}
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
                  style={{ flex: 1, border: "1px solid #e4e4e8", padding: "7px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, outline: "none" }} />
                <button className="btn" onClick={addUvalue} disabled={!newUvalueElement.trim() || saving.uvalue}
                  style={{ background: PROJECTS_FULL, color: "#fff", padding: "7px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {saving.uvalue ? <Spinner size={11} /> : "Add"}
                </button>
                <button className="btn" onClick={() => { setAddingUvalue(false); setNewUvalueElement(""); }}
                  style={{ background: "none", color: "#9a9088", padding: "7px 12px", fontSize: 11, border: "1px solid #e4e4e8" }}>Cancel</button>
              </div>
            )}
            <div style={{ background: "#fff", border: "1px solid #e8e0d5" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px 1fr 36px", gap: "0 12px", padding: "8px 16px", background: DESIGN_TEXT }}>
                {["Element", "Target (W/m²K)", "Achieved (W/m²K)", "Notes", ""].map((h, i) => (
                  <div key={i} style={{ fontSize: 10, fontWeight: 500, color: "#fff", letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</div>
                ))}
              </div>
              {uvalues.map((u, i) => (
                <div key={u.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px 1fr 36px", gap: "0 12px", padding: "10px 16px", alignItems: "center", background: i % 2 === 0 ? "#f8f8fa" : "#fff", borderBottom: "1px solid #f0ede8" }}>
                  <div style={{ fontSize: 13, color: DESIGN_TEXT, fontWeight: 500 }}>{u.element}</div>
                  <div><EditableField value={u.target !== null ? String(u.target) : ""} onSave={v => updateUvalue(u.id, "target", v)} placeholder="—" style={{ fontSize: 13, textAlign: "center" }} /></div>
                  <div><EditableField value={u.achieved !== null ? String(u.achieved) : ""} onSave={v => updateUvalue(u.id, "achieved", v)} placeholder="—" style={{ fontSize: 13, textAlign: "center" }} /></div>
                  <div><EditableField value={u.notes} onSave={v => updateUvalue(u.id, "notes", v)} placeholder="Notes…" style={{ fontSize: 12 }} /></div>
                  {isAdmin && <button className="btn" onClick={() => deleteUvalue(u.id)}
                    style={{ background: "none", color: "#c8c0b8", fontSize: 16, padding: "0 4px", border: "none", textAlign: "center" }}
                    onMouseEnter={e => e.target.style.color = COMPARE_FULL} onMouseLeave={e => e.target.style.color = "#c8c0b8"}>×</button>}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "notes" && (
          <div style={{ maxWidth: 700 }}>
            {sectionTitle("Key Notes", isAdmin && addBtn("Add Note", () => setAddingNote(true)))}
            {addingNote && (
              <div style={{ background: "#fff", border: `1px solid ${PROJECTS_FULL}`, padding: "16px 20px", marginBottom: 14 }}>
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Label</label>
                  <input value={newNote.label} onChange={e => setNewNote(n => ({ ...n, label: e.target.value }))} autoFocus placeholder="e.g. Planning reference"
                    style={{ width: "100%", border: "1px solid #e4e4e8", padding: "7px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, outline: "none", boxSizing: "border-box" }} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Value</label>
                  <input value={newNote.value} onChange={e => setNewNote(n => ({ ...n, value: e.target.value }))} placeholder="e.g. 22/01234/FUL"
                    style={{ width: "100%", border: "1px solid #e4e4e8", padding: "7px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, outline: "none", boxSizing: "border-box" }} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn" onClick={addNote} disabled={!newNote.label.trim() || saving.note}
                    style={{ background: PROJECTS_FULL, color: "#fff", padding: "7px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    {saving.note ? <Spinner size={11} /> : "Add"}
                  </button>
                  <button className="btn" onClick={() => { setAddingNote(false); setNewNote({ label: "", value: "" }); }}
                    style={{ background: "none", color: "#9a9088", padding: "7px 12px", fontSize: 11, border: "1px solid #e4e4e8" }}>Cancel</button>
                </div>
              </div>
            )}
            {notes.length === 0 ? (
              <p style={{ fontSize: 13, color: "#9a9088", fontStyle: "italic" }}>No notes added yet.</p>
            ) : (
              <div style={{ background: "#fff", border: "1px solid #e8e0d5" }}>
                {notes.map((n, i) => (
                  <div key={n.id} style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "12px 20px", borderBottom: i < notes.length - 1 ? "1px solid #f0ede8" : "none", background: i % 2 === 0 ? "#f8f8fa" : "#fff" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.04em", textTransform: "uppercase", width: 140, flexShrink: 0, paddingTop: 2 }}>
                      <EditableField value={n.label} onSave={v => updateNote(n.id, "label", v)} placeholder="Label" style={{ fontSize: 11 }} />
                    </div>
                    <div style={{ flex: 1, fontSize: 13, color: DESIGN_TEXT }}>
                      <EditableField value={n.value} onSave={v => updateNote(n.id, "value", v)} placeholder="Value…" multiline />
                    </div>
                    {isAdmin && <button className="btn" onClick={() => deleteNote(n.id)} style={{ background: "none", color: "#c8c0b8", fontSize: 16, padding: "0 4px", border: "none", flexShrink: 0 }} onMouseEnter={e => e.target.style.color = COMPARE_FULL} onMouseLeave={e => e.target.style.color = "#c8c0b8"}>×</button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "drawings" && (
          <DrawingsTab projectId={projectId} isAdmin={isAdmin} onDrawingsLoaded={setDrawings} customDrawingTypes={data?.project?.custom_drawing_types || []} />
        )}

        {activeTab === "documents" && <DocumentsTab projectId={projectId} isAdmin={isAdmin} />}
        {activeTab === "products" && (
          <ProductsTab projectId={projectId} isAdmin={isAdmin} />
        )}
        {activeTab === "minutes" && <PlaceholderTab icon="📝" title="Meeting Minutes" description="Upload or paste meeting minutes. Search and query them using the Q&A bar below to find decisions, actions, and key discussion points." />}
        {activeTab === "emails" && <EmailsTab projectId={projectId} />}
        {activeTab === "tasks" && <TaskBoard projectId={projectId} />}
        {activeTab === "agreements" && <AgreementsTab projectId={projectId} />}

      </div>

      <QABar project={project} consultants={consultants} uvalues={uvalues} notes={notes} drawings={drawings} projectId={projectId} onNavigateTab={setActiveTab} activeTab={activeTab} />
    </div>
  );
}

