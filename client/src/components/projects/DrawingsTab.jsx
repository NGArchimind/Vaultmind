import { useState, useEffect, useRef } from "react";
import { api } from "../../api/client";
import { DESIGN_TEXT, COMPARE_FULL, PROJECTS_FULL } from "../../constants";
import { DRAWING_TYPE_OPTIONS, fileToBase64, base64ToBlob } from "./projectHelpers";
import { Spinner } from "../common/Spinner";
import { showToast } from "./toast";
import DrawingRow from "./DrawingRow";
import PdfViewerModal from "./PdfViewerModal";
import TransmittalTab from "./TransmittalTab";

// ── Drawings tab (with Register / Transmittal sub-tabs) ───────────────────────
export default function DrawingsTab({ projectId, isAdmin, onDrawingsLoaded, customDrawingTypes = [] }) {
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

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [searchTermsUsed, setSearchTermsUsed] = useState([]);
  const [searchFilterType, setSearchFilterType] = useState("");
  const [searchFilterLevel, setSearchFilterLevel] = useState("");
  const [searchFilterVolume, setSearchFilterVolume] = useState("");
  const [searchFilterStatus, setSearchFilterStatus] = useState("");
  const [searchSelectedIds, setSearchSelectedIds] = useState(new Set());
  const [searchDownloading, setSearchDownloading] = useState(false);
  const [searchViewingDrawing, setSearchViewingDrawing] = useState(null);

  useEffect(() => { loadDrawings(); }, [projectId]);

  async function loadDrawings() {
    setLoading(true);
    try {
      const { drawings: data } = await api(`/api/projects/${projectId}/drawings`);
      const loaded = data || [];
      setDrawings(loaded);
      if (onDrawingsLoaded) onDrawingsLoaded(loaded);
    } catch (e) { console.error(e); showToast("Failed to load drawings"); }
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
    } catch (e) { console.error("Download failed:", e); showToast("Failed to download drawing"); }
    setDownloadingId(null);
  }

  const [indexingIds, setIndexingIds] = useState(new Set());

  async function handleReindex(drawingId) {
    try {
      await api(`/api/projects/${projectId}/drawings/${drawingId}/reindex`, { method: "POST" });
      setIndexingIds(prev => new Set([...prev, drawingId]));
      setTimeout(async () => {
        try {
          const { drawings: data } = await api(`/api/projects/${projectId}/drawings`);
          setDrawings(data || []);
          if (onDrawingsLoaded) onDrawingsLoaded(data || []);
        } catch (e) {}
        setIndexingIds(prev => { const n = new Set(prev); n.delete(drawingId); return n; });
      }, 60000);
    } catch (e) { showToast("Failed to start indexing: " + e.message); }
  }

  async function handleReindexAll() {
    try {
      const { count } = await api(`/api/projects/${projectId}/drawings/reindex-all`, { method: "POST" });
      setIndexingIds(new Set(drawings.map(d => d.id)));
      showToast(`Re-indexing ${count} drawing${count !== 1 ? "s" : ""}…`);
      setTimeout(async () => {
        try {
          const { drawings: data } = await api(`/api/projects/${projectId}/drawings`);
          setDrawings(data || []);
          if (onDrawingsLoaded) onDrawingsLoaded(data || []);
        } catch (e) {}
        setIndexingIds(new Set());
      }, 120000);
    } catch (e) { showToast("Failed to start re-indexing: " + e.message); }
  }

  async function handleDelete(drawingId) {
    if (!window.confirm("Delete this drawing? This cannot be undone.")) return;
    try {
      await api(`/api/projects/${projectId}/drawings/${drawingId}`, { method: "DELETE" });
      const updated = drawings.filter(d => d.id !== drawingId);
      setDrawings(updated);
      if (onDrawingsLoaded) onDrawingsLoaded(updated);
    } catch (e) { console.error(e); showToast("Failed to delete drawing"); }
  }

  async function updateField(drawingId, field, value) {
    try {
      const { drawing } = await api(`/api/projects/${projectId}/drawings/${drawingId}`, { method: "PATCH", body: { [field]: value } });
      const updated = drawings.map(d => d.id === drawingId ? drawing : d);
      setDrawings(updated);
      if (onDrawingsLoaded) onDrawingsLoaded(updated);
    } catch (e) { console.error(e); showToast("Failed to save changes"); }
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

  const allDrawingTypeOptions = [...new Set([...DRAWING_TYPE_OPTIONS, ...customDrawingTypes, ...drawings.map(d => d.drawing_type).filter(Boolean)])];
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
      try { await api(`/api/projects/${projectId}/drawings/${id}`, { method: "DELETE" }); } catch (e) { console.error(e); showToast("Failed to delete drawing"); }
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
    } catch (e) { console.error(e); showToast("Failed to download drawings"); }
    setDownloadingSelected(false);
  }

  async function handleDrawingSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    setSearchDone(false);
    setSearchSelectedIds(new Set());
    setSearchFilterType(""); setSearchFilterLevel(""); setSearchFilterVolume(""); setSearchFilterStatus("");
    try {
      const { results, terms } = await api(`/api/projects/${projectId}/drawings/search`, {
        method: "POST",
        body: { query: searchQuery.trim() },
      });
      setSearchResults(results || []);
      setSearchTermsUsed(terms || []);
      setSearchDone(true);
    } catch (e) {
      setSearchError("Search failed — please try again.");
      setSearchResults([]);
    }
    setSearching(false);
  }

  async function handleSearchDownloadSelected(selectedDrawings) {
    if (selectedDrawings.length === 0 || searchDownloading) return;
    setSearchDownloading(true);
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
      for (const drawing of selectedDrawings) {
        try {
          const { base64, file_name } = await api(`/api/projects/${projectId}/drawings/${drawing.id}/file`);
          zip.file(file_name || drawing.file_name || `${drawing.drawing_number || drawing.id}.pdf`, base64, { base64: true });
        } catch (e) { console.error("Failed:", drawing.id, e); }
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "search-results.zip";
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) { showToast("Failed to download drawings"); }
    setSearchDownloading(false);
  }

  const labelStyle = { fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 };
  const inputStyle = { width: "100%", border: "1px solid #e4e4e8", padding: "7px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, outline: "none", background: "#fff" };
  const filterSelectStyle = { border: "1px solid #e4e4e8", padding: "6px 8px", fontSize: 11, fontFamily: "Inter, Arial, sans-serif", outline: "none", background: "#fff", color: "#9a9088" };
  const COLS = "32px minmax(180px,220px) 1fr 60px minmax(70px,120px) 80px 120px 90px 80px 36px 36px 36px 36px";

  const subTabStyle = (id) => ({
    padding: "6px 14px", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase",
    background: drawingSubTab === id ? DESIGN_TEXT : "transparent",
    color: drawingSubTab === id ? "#fff" : "#9a9088",
    border: `1px solid ${drawingSubTab === id ? DESIGN_TEXT : "#ddd8d0"}`,
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
        <button className="btn" style={subTabStyle("search")} onClick={() => setDrawingSubTab("search")}>
          Content Search
        </button>
      </div>

      {/* Register sub-tab */}
      {drawingSubTab === "register" && (
        <div>
          {/* Section header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <h3 style={{ fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.1em", textTransform: "uppercase" }}>Drawing Register</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button className="btn" onClick={handleReindexAll}
                style={{ fontSize: 11, color: "#9a9088", background: "none", border: "1px solid #e4e4e8", padding: "4px 12px", fontWeight: 600, letterSpacing: "0.04em" }}>
                ↺ Re-index All
              </button>
              {isAdmin && !showUpload && (
                <button className="btn" onClick={() => setShowUpload(true)}
                  style={{ fontSize: 11, color: PROJECTS_FULL, background: "none", border: `1px solid ${PROJECTS_FULL}`, padding: "4px 12px", fontWeight: 600, letterSpacing: "0.04em" }}>
                  + Upload Drawing
                </button>
              )}
            </div>
          </div>

          {/* Upload panel */}
          {showUpload && (
            <div style={{ background: "#fff", border: `1px solid ${PROJECTS_FULL}`, padding: "20px 24px", marginBottom: 20 }}>
              <h4 style={{ fontSize: 12, fontWeight: 600, color: DESIGN_TEXT, marginBottom: 16, letterSpacing: "0.04em", textTransform: "uppercase" }}>Upload Drawing</h4>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>File (PDF or DWG)</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input ref={fileInputRef} type="file" accept=".pdf,.dwg" onChange={handleFileChange}
                    style={{ fontSize: 12, color: DESIGN_TEXT, fontFamily: "Inter, Arial, sans-serif", flex: 1 }} />
                  {selectedFile && <span style={{ fontSize: 11, color: "#9a9088", whiteSpace: "nowrap" }}>{(selectedFile.size / 1024 / 1024).toFixed(1)} MB</span>}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "0 16px" }}>
                <div style={{ marginBottom: 14 }}><label style={labelStyle}>Title *</label><input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Ground Floor Plan" style={inputStyle} /></div>
                <div style={{ marginBottom: 14 }}><label style={labelStyle}>Drawing No.</label><input value={form.drawing_number} onChange={e => setForm(f => ({ ...f, drawing_number: e.target.value }))} placeholder="e.g. A-001" style={inputStyle} /></div>
                <div style={{ marginBottom: 14 }}><label style={labelStyle}>Revision</label><input value={form.revision} onChange={e => setForm(f => ({ ...f, revision: e.target.value }))} placeholder="e.g. P1" style={inputStyle} /></div>
                <div style={{ marginBottom: 14 }}><label style={labelStyle}>Status</label><input value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} placeholder="e.g. Preliminary" style={inputStyle} /></div>
              </div>
              {uploadError && <p style={{ fontSize: 12, color: COMPARE_FULL, marginBottom: 12 }}>{uploadError}</p>}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={handleUpload} disabled={!selectedFile || !form.title.trim() || uploading}
                  style={{ background: selectedFile && form.title.trim() && !uploading ? PROJECTS_FULL : "#c8c0b8", color: "#fff", padding: "8px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {uploading ? <><Spinner size={12} /> &nbsp;Uploading…</> : "Upload"}
                </button>
                <button className="btn" onClick={cancelUpload} disabled={uploading} style={{ background: "none", color: "#9a9088", padding: "8px 14px", fontSize: 11, border: "1px solid #e4e4e8" }}>Cancel</button>
              </div>
            </div>
          )}

          {/* Filter bar */}
          {drawings.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              <input value={filterText} onChange={e => { setFilterText(e.target.value); setSelectedIds(new Set()); }}
                placeholder="Search no. or title…"
                style={{ flex: "1 1 180px", minWidth: 140, border: "1px solid #e4e4e8", padding: "6px 10px", fontSize: 11, fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, outline: "none", background: "#fff" }} />
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
                  style={{ fontSize: 11, color: "#9a9088", background: "none", border: "1px solid #e4e4e8", padding: "5px 10px" }}>
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
              <span style={{ fontSize: 11, fontWeight: 600, color: DESIGN_TEXT }}>{selectedIds.size} selected</span>
              <button className="btn" onClick={downloadSelected} disabled={downloadingSelected}
                style={{ fontSize: 11, fontWeight: 600, color: DESIGN_TEXT, background: "#fff", border: `1px solid ${DESIGN_TEXT}`, padding: "4px 12px", display: "flex", alignItems: "center", gap: 5 }}>
                {downloadingSelected ? <><Spinner size={10} /> Downloading…</> : "↓ Download Selected"}
              </button>
              {isAdmin && (
                <button className="btn" onClick={deleteSelected} disabled={deletingSelected}
                  style={{ fontSize: 11, fontWeight: 600, color: "#fff", background: COMPARE_FULL, border: `1px solid ${COMPARE_FULL}`, padding: "4px 12px", display: "flex", alignItems: "center", gap: 5 }}>
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
              <p style={{ fontSize: 14, color: DESIGN_TEXT, fontWeight: 300, fontFamily: "Inter, Arial, sans-serif", marginBottom: 6 }}>No drawings uploaded yet</p>
              {isAdmin && <p style={{ fontSize: 12, color: "#9a9088" }}>Click + Upload Drawing to add the first one, or use Archimind Sync.</p>}
            </div>
          ) : filteredDrawings.length === 0 ? (
            <div style={{ background: "#fff", border: "1px solid #e8e0d5", padding: "32px", textAlign: "center" }}>
              <p style={{ fontSize: 13, color: "#9a9088", fontStyle: "italic" }}>No drawings match the current filters.</p>
            </div>
          ) : (
            <div style={{ background: "#fff", border: "1px solid #e8e0d5", overflowX: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: COLS, gap: "0 10px", padding: "8px 16px", background: DESIGN_TEXT, minWidth: 900 }}>
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                    style={{ cursor: "pointer", width: 14, height: 14, accentColor: "#fff" }} />
                </div>
                {["Drawing No.", "Title", "Rev.", "Status", "Scale", "Type", "Volume", "Level", "", "", "", ""].map((h, i) => (
                  <div key={i} style={{ fontSize: 10, fontWeight: 500, color: "#fff", letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</div>
                ))}
              </div>
              {filteredDrawings.map((d, i) => (
                <div key={d.id} style={{ background: selectedIds.has(d.id) ? "#eef6ff" : i % 2 === 0 ? "#f8f8fa" : "#fff", minWidth: 900 }}>
                  <DrawingRow d={d} projectId={projectId} isAdmin={isAdmin}
                    onUpdate={updateField} onDelete={handleDelete}
                    onView={setViewingDrawing} downloadingId={downloadingId} onDownload={handleDownload}
                    onReindex={handleReindex}
                    selectable={true} selected={selectedIds.has(d.id)} onSelect={toggleSelect}
                    typeOptions={allDrawingTypeOptions} isIndexing={indexingIds.has(d.id)} />
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

      {/* Content Search sub-tab */}
      {drawingSubTab === "search" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleDrawingSearch()}
              placeholder="e.g. fire escape routes, external doors, structural columns…"
              style={{ flex: 1, border: "1px solid #e4e4e8", padding: "9px 12px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, outline: "none", background: "#fff" }}
            />
            <button className="btn" onClick={handleDrawingSearch} disabled={!searchQuery.trim() || searching}
              style={{ background: searchQuery.trim() && !searching ? DESIGN_TEXT : "#b0a8a0", color: "#fff", padding: "9px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", border: "none", cursor: searchQuery.trim() && !searching ? "pointer" : "default" }}>
              {searching ? <><Spinner size={11} />&nbsp;Searching…</> : "Search"}
            </button>
          </div>

          {searchError && <p style={{ fontSize: 12, color: COMPARE_FULL, marginBottom: 16 }}>{searchError}</p>}

          {!searchDone && !searching && (
            <div style={{ background: "#fff", border: "1px solid #e8e0d5", padding: "48px", textAlign: "center" }}>
              <p style={{ fontSize: 14, color: DESIGN_TEXT, fontWeight: 300, fontFamily: "Inter, Arial, sans-serif" }}>Search across drawing contents</p>
              <p style={{ fontSize: 12, color: "#9a9088", marginTop: 6 }}>Type a description of what you're looking for — rooms, materials, notes, or anything visible on the drawings.</p>
            </div>
          )}

          {searchDone && !searching && searchResults.length === 0 && (
            <div style={{ background: "#fff", border: "1px solid #e8e0d5", padding: "48px", textAlign: "center" }}>
              <p style={{ fontSize: 14, color: DESIGN_TEXT, fontWeight: 300, fontFamily: "Inter, Arial, sans-serif" }}>No drawings matched your search.</p>
              <p style={{ fontSize: 12, color: "#9a9088", marginTop: 6 }}>Try different keywords, or note that drawings without indexed content won't appear yet.</p>
            </div>
          )}

          {searchDone && !searching && searchResults.length > 0 && (() => {
            const typeOpts   = [...new Set(searchResults.map(r => r.drawing_type).filter(Boolean))].sort();
            const levelOpts  = [...new Set(searchResults.map(r => r.level).filter(Boolean))].sort();
            const volumeOpts = [...new Set(searchResults.map(r => r.volume).filter(Boolean))].sort();
            const statusOpts = [...new Set(searchResults.map(r => r.status).filter(Boolean))].sort();
            const filtered = searchResults.filter(r => {
              if (searchFilterType   && r.drawing_type !== searchFilterType)   return false;
              if (searchFilterLevel  && r.level        !== searchFilterLevel)  return false;
              if (searchFilterVolume && r.volume       !== searchFilterVolume) return false;
              if (searchFilterStatus && r.status       !== searchFilterStatus) return false;
              return true;
            });
            const chipStyle = (active) => ({
              fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase",
              padding: "3px 10px", cursor: "pointer",
              border: `1px solid ${active ? DESIGN_TEXT : "#ddd8d0"}`,
              background: active ? DESIGN_TEXT : "#fff",
              color: active ? "#fff" : "#9a9088",
              fontFamily: "Inter, Arial, sans-serif",
            });
            const hasActiveFilter = searchFilterType || searchFilterLevel || searchFilterVolume || searchFilterStatus;
            return (
              <div>
                {(typeOpts.length > 0 || levelOpts.length > 0 || volumeOpts.length > 0 || statusOpts.length > 0) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, color: "#9a9088", textTransform: "uppercase", letterSpacing: "0.06em" }}>Filter:</span>
                    {typeOpts.map(t   => <button key={t} className="btn" style={chipStyle(searchFilterType   === t)} onClick={() => setSearchFilterType(searchFilterType     === t ? "" : t)}>{t}</button>)}
                    {levelOpts.map(l  => <button key={l} className="btn" style={chipStyle(searchFilterLevel  === l)} onClick={() => setSearchFilterLevel(searchFilterLevel   === l ? "" : l)}>{l}</button>)}
                    {volumeOpts.map(v => <button key={v} className="btn" style={chipStyle(searchFilterVolume === v)} onClick={() => setSearchFilterVolume(searchFilterVolume === v ? "" : v)}>{v}</button>)}
                    {statusOpts.map(s => <button key={s} className="btn" style={chipStyle(searchFilterStatus === s)} onClick={() => setSearchFilterStatus(searchFilterStatus === s ? "" : s)}>{s}</button>)}
                    {hasActiveFilter && (
                      <button className="btn" style={{ ...chipStyle(false), color: COMPARE_FULL, borderColor: COMPARE_FULL }}
                        onClick={() => { setSearchFilterType(""); setSearchFilterLevel(""); setSearchFilterVolume(""); setSearchFilterStatus(""); }}>
                        Clear filters
                      </button>
                    )}
                  </div>
                )}

                {searchTermsUsed.length > 0 && (
                  <p style={{ fontSize: 11, color: "#9a9088", marginBottom: 8 }}>
                    Searched for: {searchTermsUsed.map((t, i) => <span key={i} style={{ background: "#f8f8fa", padding: "1px 6px", marginRight: 4, borderRadius: 2 }}>{t}</span>)}
                  </p>
                )}

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <p style={{ fontSize: 11, color: "#9a9088" }}>
                    {filtered.length} result{filtered.length !== 1 ? "s" : ""}
                    {filtered.length < searchResults.length ? ` (filtered from ${searchResults.length})` : ""}
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {searchSelectedIds.size > 0 && (
                      <>
                        <span style={{ fontSize: 11, color: "#9a9088" }}>{searchSelectedIds.size} selected</span>
                        <button className="btn" onClick={() => setSearchViewingDrawing(filtered.find(r => searchSelectedIds.has(r.id)))}
                          style={{ fontSize: 11, color: DESIGN_TEXT, background: "none", border: `1px solid ${DESIGN_TEXT}`, padding: "4px 12px", fontWeight: 600, letterSpacing: "0.04em" }}>
                          Open Selected
                        </button>
                        <button className="btn" onClick={() => handleSearchDownloadSelected(filtered.filter(r => searchSelectedIds.has(r.id)))} disabled={searchDownloading}
                          style={{ fontSize: 11, color: PROJECTS_FULL, background: "none", border: `1px solid ${PROJECTS_FULL}`, padding: "4px 12px", fontWeight: 600, letterSpacing: "0.04em" }}>
                          {searchDownloading ? "Downloading…" : "↓ Download Selected"}
                        </button>
                        <button className="btn" onClick={() => setSearchSelectedIds(new Set())}
                          style={{ fontSize: 11, color: "#9a9088", background: "none", border: "1px solid #e4e4e8", padding: "4px 8px" }}>
                          Clear
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {filtered.map(r => {
                    const isSelected = searchSelectedIds.has(r.id);
                    return (
                      <div key={r.id}
                        style={{ background: isSelected ? "#eef6ff" : "#fff", border: `1px solid ${isSelected ? "#2a6496" : "#e4e4e8"}`, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                        <input type="checkbox" checked={isSelected}
                          onChange={() => setSearchSelectedIds(prev => { const n = new Set(prev); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}
                          style={{ cursor: "pointer", width: 14, height: 14, flexShrink: 0, accentColor: DESIGN_TEXT }} />
                        <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setSearchViewingDrawing(r)}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: DESIGN_TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</div>
                          <div style={{ fontSize: 11, color: "#9a9088", marginTop: 2 }}>{r.drawing_number || "—"}</div>
                        </div>
                        {r.drawing_type && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "#2a6496", background: "#e8f0f8", padding: "2px 7px", flexShrink: 0 }}>{r.drawing_type}</span>}
                        {r.level        && <span style={{ fontSize: 10, color: "#9a9088", flexShrink: 0 }}>{r.level}</span>}
                        {r.revision     && <span style={{ fontSize: 10, fontWeight: 700, color: DESIGN_TEXT, flexShrink: 0 }}>Rev. {r.revision}</span>}
                        {r.status       && <span style={{ fontSize: 10, color: "#9a9088", flexShrink: 0 }}>{r.status}</span>}
                        <span style={{ fontSize: 16, color: "#ddd8d0", flexShrink: 0, cursor: "pointer" }} onClick={() => setSearchViewingDrawing(r)}>›</span>
                      </div>
                    );
                  })}
                </div>

                {searchViewingDrawing && (() => {
                  const viewList = searchSelectedIds.size > 0
                    ? filtered.filter(r => searchSelectedIds.has(r.id))
                    : filtered;
                  return (
                    <PdfViewerModal
                      drawing={searchViewingDrawing}
                      projectId={projectId}
                      onClose={() => setSearchViewingDrawing(null)}
                      drawings={viewList}
                      currentIndex={viewList.findIndex(r => r.id === searchViewingDrawing.id)}
                    />
                  );
                })()}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

