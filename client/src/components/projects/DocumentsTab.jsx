import { useState, useEffect } from "react";
import { api } from "../../api/client";
import { DESIGN_TEXT, COMPARE_FULL } from "../../constants";
import { Spinner } from "../common/Spinner";
import { showToast } from "./toast";

// ── DocumentsTab ──────────────────────────────────────────────────────────────
export default function DocumentsTab({ projectId, isAdmin }) {
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
    } catch (e) { console.error(e); showToast("Failed to load transmittal files"); }
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
    } catch (e) { console.error(e); showToast("Failed to open file"); }
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
    } catch (e) { console.error(e); showToast("Failed to delete files"); }
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
      <p style={{ fontSize: 14, color: DESIGN_TEXT, fontWeight: 300, fontFamily: "Inter, Arial, sans-serif", marginBottom: 6 }}>No documents yet</p>
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
              style={{ fontSize: 11, fontWeight: 600, color: "#fff", background: COMPARE_FULL, border: `1px solid ${COMPARE_FULL}`, padding: "4px 12px", display: "flex", alignItems: "center", gap: 5 }}>
              {deleting ? <><Spinner size={10} /> Deleting…</> : `× Delete ${selectedKeys.size} selected`}
            </button>
          )}
          <button className="btn" onClick={loadFiles}
            style={{ fontSize: 11, color: "#9a9088", background: "none", border: "1px solid #e4e4e8", padding: "4px 10px" }}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {isAdmin && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 16px", background: "#f5f3f0", border: "1px solid #e8e0d5", borderBottom: "none" }}>
          <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
            style={{ cursor: "pointer", width: 14, height: 14, accentColor: DESIGN_TEXT }} />
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
                style={{ cursor: "pointer", width: 14, height: 14, accentColor: DESIGN_TEXT, flexShrink: 0 }} />
            )}
            <span style={{ fontSize: 18, flexShrink: 0, width: 24, textAlign: "center" }}>📄</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: DESIGN_TEXT, fontFamily: "Inter, Arial, sans-serif" }}>{f.label}</div>
              <div style={{ fontSize: 11, color: "#9a9088", marginTop: 2 }}>{f.name}</div>
            </div>
            <button className="btn" onClick={() => openFile(f)} disabled={opening === f.key}
              style={{ fontSize: 11, fontWeight: 600, color: DESIGN_TEXT, background: "none", border: `1px solid ${DESIGN_TEXT}`, padding: "4px 12px", flexShrink: 0, letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 5 }}>
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

