import { useState } from "react";
import { PROJECTS_FULL, DESIGN_TEXT } from "../../constants";

// ── Editable field ────────────────────────────────────────────────────────────
export default function EditableField({ value, onSave, placeholder, multiline = false, style = {} }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const commit = () => { setEditing(false); if (draft !== value) onSave(draft); };
  if (editing) {
    const shared = {
      value: draft, onChange: e => setDraft(e.target.value), onBlur: commit, autoFocus: true,
      onKeyDown: e => { if (!multiline && e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value || ""); setEditing(false); } },
      style: { width: "100%", border: `1px solid ${PROJECTS_FULL}`, padding: "4px 8px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, outline: "none", background: "#fff", resize: "none", ...style },
    };
    return multiline ? <textarea rows={3} {...shared} /> : <input {...shared} />;
  }
  return (
    <span onClick={() => { setDraft(value || ""); setEditing(true); }} title="Click to edit"
      style={{ cursor: "text", color: value ? DESIGN_TEXT : "#b0a8a0", fontStyle: value ? "normal" : "italic", ...style }}>
      {value || placeholder}
    </span>
  );
}

