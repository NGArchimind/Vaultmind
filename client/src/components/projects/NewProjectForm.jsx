import { useState } from "react";
import { DESIGN_TEXT, COMPARE_FULL } from "../../constants";
import { RIBA_STAGES } from "./projectHelpers";
import { Spinner } from "../common/Spinner";

// ── New project form ──────────────────────────────────────────────────────────
export default function NewProjectForm({ onSave, onCancel }) {
  const [form, setForm] = useState({ name: "", job_number: "", client: "", location: "", stage: "", description: "", project_lead: "" });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const handleSave = async () => { if (!form.name.trim()) return; setSaving(true); await onSave(form); setSaving(false); };
  const labelStyle = { fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 };
  const inputStyle = { width: "100%", border: "1px solid #e4e4e8", padding: "8px 12px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, outline: "none", background: "#fff", marginBottom: 14 };
  return (
    <div style={{ background: "#fff", border: `1px solid #e8e0d5`, borderTop: `3px solid ${COMPARE_FULL}`, padding: "28px 32px", marginBottom: 20 }}>
      <h3 style={{ fontSize: 15, fontWeight: 500, color: DESIGN_TEXT, marginBottom: 20 }}>New Project</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
        <div><label style={labelStyle}>Project Name *</label><input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. 14 Station Road" style={inputStyle} autoFocus /></div>
        <div><label style={labelStyle}>Job Number</label><input value={form.job_number} onChange={e => set("job_number", e.target.value)} placeholder="e.g. 2024-042" style={inputStyle} /></div>
        <div><label style={labelStyle}>Client</label><input value={form.client} onChange={e => set("client", e.target.value)} placeholder="Client name" style={inputStyle} /></div>
        <div><label style={labelStyle}>Location</label><input value={form.location} onChange={e => set("location", e.target.value)} placeholder="Town / county" style={inputStyle} /></div>
        <div><label style={labelStyle}>Project Lead</label><input value={form.project_lead} onChange={e => set("project_lead", e.target.value)} placeholder="e.g. Nathan" style={inputStyle} /></div>
        <div>
          <label style={labelStyle}>RIBA Stage</label>
          <select value={form.stage} onChange={e => set("stage", e.target.value)} style={{ ...inputStyle, color: form.stage ? DESIGN_TEXT : "#9a9088" }}>
            <option value="">Select stage…</option>
            {RIBA_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}><label style={labelStyle}>Description</label><input value={form.description} onChange={e => set("description", e.target.value)} placeholder="Brief description" style={inputStyle} /></div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button className="btn" onClick={handleSave} disabled={!form.name.trim() || saving}
          style={{ background: form.name.trim() ? DESIGN_TEXT : "#c8c0b8", color: "#fff", padding: "9px 24px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {saving ? <Spinner size={12} /> : "Create Project"}
        </button>
        <button className="btn" onClick={onCancel} style={{ background: "none", color: "#9a9088", padding: "9px 16px", fontSize: 11, border: "1px solid #e4e4e8" }}>Cancel</button>
      </div>
    </div>
  );
}

