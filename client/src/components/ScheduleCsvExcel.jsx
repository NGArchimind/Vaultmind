import { useState, useEffect, useRef } from "react";
import { api, apiBlob } from "../api/client";
import { SCHEDULE_FULL } from "../constants";

// ── Component palette ─────────────────────────────────────────────────────────
const STATUS_ADDED_BG    = "#e8f5e9";
const STATUS_ADDED_TEXT  = "#2e7d32";
const STATUS_CHANGED_BG  = "#fff8e1";
const STATUS_CHANGED_TEXT= "#e65100";
const STATUS_REMOVED_BG  = "#ffebee";
const STATUS_REMOVED_TEXT= "#c62828";
const MUTED_TEXT         = "#9a9aa0";
const LATEST_BADGE_BG    = SCHEDULE_FULL;
const HISTORY_LATEST_BG  = "#faf8ff";
const BORDER_LIGHT       = "#e8e0f0";
const BORDER_HISTORY     = "#f0ecf8";
const RESULT_CARD_BG     = "#f5f3fa";
const RESULT_CARD_BORDER = "#e0d8f0";

export default function ScheduleCsvExcel() {
  const [projects,       setProjects]       = useState([]);
  const [projectId,      setProjectId]      = useState("");
  const [scheduleTypes,  setScheduleTypes]  = useState([]);
  const [typeId,         setTypeId]         = useState("");
  const [csvFile,        setCsvFile]        = useState(null);  // { name, text }
  const [generating,     setGenerating]     = useState(false);
  const [result,         setResult]         = useState(null);
  const [error,          setError]          = useState("");
  const [revisions,      setRevisions]      = useState([]);
  const [loadingRevs,    setLoadingRevs]    = useState(false);
  const [addingType,     setAddingType]     = useState(false);
  const [newTypeName,    setNewTypeName]    = useState("");
  const [savingType,     setSavingType]     = useState(false);
  const [editingTypeId,  setEditingTypeId]  = useState(null);
  const [editName,       setEditName]       = useState("");
  const [lastBlob,       setLastBlob]       = useState(null);
  const [lastFilename,   setLastFilename]   = useState("");
  const csvRef = useRef();

  // Load projects once on mount
  useEffect(() => {
    api("/api/projects")
      .then(d => setProjects(Array.isArray(d) ? d : (d.projects || [])))
      .catch(() => {});
  }, []);

  // Load schedule types when project changes
  useEffect(() => {
    if (!projectId) { setScheduleTypes([]); setTypeId(""); return; }
    api(`/api/projects/${projectId}/schedule-types`).then(setScheduleTypes).catch(() => {});
  }, [projectId]);

  // Load revisions when schedule type changes
  useEffect(() => {
    if (!typeId) { setRevisions([]); return; }
    setLoadingRevs(true);
    api(`/api/schedule-types/${typeId}/revisions`)
      .then(setRevisions).catch(() => {}).finally(() => setLoadingRevs(false));
  }, [typeId]);

  async function handleCsvFile(file) {
    if (!file?.name?.endsWith(".csv")) return;
    const text = await file.text();
    setCsvFile({ name: file.name, text });
    if (csvRef.current) csvRef.current.value = "";
  }

  async function addType() {
    if (!newTypeName.trim()) return;
    setSavingType(true);
    try {
      const t = await api(`/api/projects/${projectId}/schedule-types`, {
        method: "POST", body: { name: newTypeName.trim() },
      });
      setScheduleTypes(prev => [...prev, t]);
      setTypeId(t.id);
      setAddingType(false); setNewTypeName("");
    } catch (e) { setError(e.message); }
    finally { setSavingType(false); }
  }

  async function saveRename(tid) {
    if (!editName.trim()) return;
    try {
      const t = await api(`/api/projects/${projectId}/schedule-types/${tid}`, {
        method: "PATCH", body: { name: editName.trim() },
      });
      setScheduleTypes(prev => prev.map(s => s.id === tid ? t : s));
      setEditingTypeId(null);
    } catch (e) { setError(e.message); }
  }

  async function deleteType(tid) {
    if (!window.confirm("Delete this schedule type and all its stored revisions?")) return;
    try {
      await api(`/api/projects/${projectId}/schedule-types/${tid}`, { method: "DELETE" });
      setScheduleTypes(prev => prev.filter(s => s.id !== tid));
      if (typeId === tid) { setTypeId(""); setRevisions([]); }
    } catch (e) { setError(e.message); }
  }

  async function deleteRevision(rid) {
    if (!window.confirm("Delete this revision? This cannot be undone.")) return;
    try {
      await api(`/api/schedule-revisions/${rid}`, { method: "DELETE" });
      setRevisions(prev => prev.filter(r => r.id !== rid));
    } catch (e) { setError(e.message); }
  }

  async function downloadRevisionCsv(rid) {
    try {
      const res = await apiBlob(`/api/schedule-revisions/${rid}/csv`, null, "GET");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "revision.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); }
  }

  async function generate() {
    if (!projectId || !typeId || !csvFile) return;
    const hadPrevRevision = revisions.length > 0;
    setGenerating(true); setError(""); setResult(null); setLastBlob(null);
    try {
      const res = await apiBlob("/api/schedule/csv-to-excel", {
        projectId, scheduleTypeId: typeId, csvText: csvFile.text,
      });
      const added   = parseInt(res.headers.get("X-Schedule-Added")   || "0");
      const changed = parseInt(res.headers.get("X-Schedule-Changed") || "0");
      const removed = parseInt(res.headers.get("X-Schedule-Removed") || "0");
      const rows    = parseInt(res.headers.get("X-Schedule-Rows")    || "0");
      const blob = await res.blob();
      const typeName = scheduleTypes.find(t => t.id === typeId)?.name || "Schedule";
      setLastBlob(blob);
      setLastFilename(`${typeName}.xlsx`);
      setResult({ added, changed, removed, rows, isFirst: !hadPrevRevision, filename: `${typeName}.xlsx` });
      // Refresh revision history
      api(`/api/schedule-types/${typeId}/revisions`).then(setRevisions).catch(() => {});
    } catch (e) { setError(e.message); }
    finally { setGenerating(false); }
  }

  function downloadLastExcel() {
    if (!lastBlob) return;
    const url = URL.createObjectURL(lastBlob);
    const a = document.createElement("a"); a.href = url; a.download = lastFilename; a.click();
    URL.revokeObjectURL(url);
  }

  const canGenerate = projectId && typeId && csvFile && !generating;

  return (
    <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 4, overflow: "hidden", fontFamily: "Inter, Arial, sans-serif" }}>
      {/* Card header */}
      <div style={{ background: SCHEDULE_FULL, padding: "10px 14px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", letterSpacing: ".04em" }}>CSV to Excel</div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.65)", marginTop: 2 }}>Import a Revit schedule export and generate a formatted Excel</div>
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>

        {/* Project selector */}
        <div>
          <div style={{ fontSize: 9, fontWeight: 600, color: SCHEDULE_FULL, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 5 }}>Project</div>
          <select
            value={projectId}
            onChange={e => { setProjectId(e.target.value); setTypeId(""); setCsvFile(null); setResult(null); }}
            style={{ width: "100%", padding: "7px 10px", border: "1px solid #d0d0d8", borderRadius: 3, fontSize: 11, color: "#444", fontFamily: "Inter, Arial, sans-serif" }}
          >
            <option value="">Select a project...</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {/* Schedule Type selector */}
        {projectId && (
          <div>
            <div style={{ fontSize: 9, fontWeight: 600, color: SCHEDULE_FULL, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 5 }}>Schedule Type</div>
            {addingType ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  value={newTypeName}
                  onChange={e => setNewTypeName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addType()}
                  placeholder="e.g. Sanitary Ware Schedule"
                  autoFocus
                  style={{ flex: 1, padding: "7px 10px", border: `1px solid ${SCHEDULE_FULL}`, borderRadius: 3, fontSize: 11, fontFamily: "Inter, Arial, sans-serif" }}
                />
                <button onClick={addType} disabled={savingType} style={{ background: SCHEDULE_FULL, color: "#fff", border: "none", padding: "7px 14px", borderRadius: 3, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
                  {savingType ? "Adding…" : "Add"}
                </button>
                <button onClick={() => { setAddingType(false); setNewTypeName(""); }} style={{ background: "none", border: "none", color: "#888", fontSize: 10, cursor: "pointer" }}>Cancel</button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select
                    value={typeId}
                    onChange={e => {
                      if (e.target.value === "__add__") { setAddingType(true); }
                      else { setTypeId(e.target.value); setResult(null); }
                    }}
                    style={{ flex: 1, padding: "7px 10px", border: "1px solid #d0d0d8", borderRadius: 3, fontSize: 11, color: "#444", fontFamily: "Inter, Arial, sans-serif" }}
                  >
                    <option value="">Select a schedule type...</option>
                    {scheduleTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    <option value="__add__" style={{ color: SCHEDULE_FULL, fontWeight: 600 }}>+ Add new type for this project...</option>
                  </select>
                  {typeId && (
                    <>
                      <button
                        title="Rename"
                        onClick={() => { setEditingTypeId(typeId); setEditName(scheduleTypes.find(t => t.id === typeId)?.name || ""); }}
                        style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 3, padding: "5px 8px", cursor: "pointer", fontSize: 12 }}
                      >{"✏️"}</button>
                      <button
                        title="Delete type"
                        onClick={() => deleteType(typeId)}
                        style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 3, padding: "5px 8px", cursor: "pointer", fontSize: 12 }}
                      >{"🗑️"}</button>
                    </>
                  )}
                </div>
                {editingTypeId === typeId && (
                  <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && saveRename(typeId)}
                      style={{ flex: 1, padding: "5px 8px", border: `1px solid ${SCHEDULE_FULL}`, borderRadius: 3, fontSize: 11, fontFamily: "Inter, Arial, sans-serif" }}
                    />
                    <button onClick={() => saveRename(typeId)} style={{ background: SCHEDULE_FULL, color: "#fff", border: "none", padding: "5px 12px", borderRadius: 3, fontSize: 10, cursor: "pointer" }}>Save</button>
                    <button onClick={() => setEditingTypeId(null)} style={{ background: "none", border: "none", color: "#888", fontSize: 10, cursor: "pointer" }}>Cancel</button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* CSV Upload */}
        {projectId && typeId && (
          <div>
            <div style={{ fontSize: 9, fontWeight: 600, color: SCHEDULE_FULL, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 5 }}>Revit Schedule Export (CSV)</div>
            <div
              onClick={() => csvRef.current.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleCsvFile(e.dataTransfer.files[0]); }}
              style={{ border: `2px dashed ${csvFile ? SCHEDULE_FULL : "#c8b8e8"}`, borderRadius: 4, padding: "18px 12px", textAlign: "center", background: "#faf8ff", cursor: "pointer" }}
            >
              <div style={{ fontSize: 22, marginBottom: 4 }}>📋</div>
              <div style={{ fontSize: 9, color: csvFile ? "#444" : MUTED_TEXT, wordBreak: "break-all" }}>
                {csvFile ? csvFile.name : "Drop CSV here or click to browse"}
              </div>
              {csvFile && (
                <div style={{ fontSize: 8, color: SCHEDULE_FULL, marginTop: 4, cursor: "pointer" }}
                  onClick={e => { e.stopPropagation(); setCsvFile(null); }}>{"✕"} Remove</div>
              )}
            </div>
            <input ref={csvRef} type="file" accept=".csv" style={{ display: "none" }}
              onChange={e => handleCsvFile(e.target.files[0])} />
          </div>
        )}

        {/* Error */}
        {error && <div style={{ fontSize: 10, color: STATUS_REMOVED_TEXT }}>{error}</div>}

        {/* Generate button */}
        {projectId && typeId && (
          <div style={{ textAlign: "right" }}>
            <button
              onClick={generate}
              disabled={!canGenerate}
              style={{
                background: canGenerate ? SCHEDULE_FULL : "#d0c8e0",
                color: "#fff", border: "none", padding: "7px 18px", borderRadius: 3,
                fontSize: 10, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase",
                cursor: canGenerate ? "pointer" : "default",
              }}
            >{generating ? "Generating…" : "Generate Excel"}</button>
          </div>
        )}

        {/* Result card */}
        {result && (
          <div style={{ padding: 12, background: RESULT_CARD_BG, borderRadius: 4, border: `1px solid ${RESULT_CARD_BORDER}` }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              {result.isFirst ? (
                <span style={{ fontSize: 9, color: "#888", fontStyle: "italic" }}>First revision — saved as baseline for future comparisons</span>
              ) : (
                <>
                  <span style={{ fontSize: 9, background: STATUS_ADDED_BG,   color: STATUS_ADDED_TEXT,   padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{result.added} added</span>
                  <span style={{ fontSize: 9, background: STATUS_CHANGED_BG, color: STATUS_CHANGED_TEXT, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{result.changed} changed</span>
                  <span style={{ fontSize: 9, background: STATUS_REMOVED_BG, color: STATUS_REMOVED_TEXT, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{result.removed} removed</span>
                </>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 26 }}>📊</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#333" }}>{result.filename}</div>
                <div style={{ fontSize: 9, color: "#888", marginTop: 2 }}>{result.rows} rows · Saved as latest revision</div>
              </div>
              <button onClick={downloadLastExcel} style={{ background: SCHEDULE_FULL, color: "#fff", border: "none", padding: "6px 14px", borderRadius: 3, fontSize: 9, fontWeight: 600, cursor: "pointer" }}>{"⬇"} Download</button>
            </div>
          </div>
        )}

        {/* Revision history */}
        {typeId && (
          <div>
            <div style={{ fontSize: 9, fontWeight: 600, color: SCHEDULE_FULL, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 6 }}>Revision History</div>
            {loadingRevs ? (
              <div style={{ fontSize: 9, color: MUTED_TEXT }}>Loading…</div>
            ) : revisions.length === 0 ? (
              <div style={{ fontSize: 9, color: MUTED_TEXT, fontStyle: "italic" }}>No revisions yet — upload a CSV to create the first one.</div>
            ) : (
              <div style={{ border: `1px solid ${BORDER_LIGHT}`, borderRadius: 3, overflow: "hidden" }}>
                {revisions.map((rev, i) => (
                  <div key={rev.id} style={{ display: "flex", alignItems: "center", padding: "7px 10px", borderBottom: i < revisions.length - 1 ? `1px solid ${BORDER_HISTORY}` : "none", background: i === 0 ? HISTORY_LATEST_BG : "#fff" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, fontWeight: i === 0 ? 600 : 400, color: "#333" }}>
                        {new Date(rev.uploaded_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        {i === 0 && <span style={{ fontSize: 8, marginLeft: 6, background: LATEST_BADGE_BG, color: "#fff", padding: "1px 5px", borderRadius: 2 }}>Latest</span>}
                      </div>
                      <div style={{ fontSize: 9, color: MUTED_TEXT }}>{rev.row_count} rows</div>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button title="Download CSV" onClick={() => downloadRevisionCsv(rev.id)}
                        style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 3, padding: "4px 7px", cursor: "pointer", fontSize: 11 }}>{"⬇"}</button>
                      <button title="Delete revision" onClick={() => deleteRevision(rev.id)}
                        style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 3, padding: "4px 7px", cursor: "pointer", fontSize: 11, color: STATUS_REMOVED_TEXT }}>{"🗑️"}</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
