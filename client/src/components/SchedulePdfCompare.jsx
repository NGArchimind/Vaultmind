import { useState, useRef } from "react";
import { api, apiBlob, fileToBase64 } from "../api/client";
import { SCHEDULE_FULL } from "../constants";

// ── Component palette ─────────────────────────────────────────────────────────
const STATUS_ADDED_BG    = "#e8f5e9";
const STATUS_ADDED_TEXT  = "#2e7d32";
const STATUS_CHANGED_BG  = "#fff8e1";
const STATUS_CHANGED_TEXT= "#e65100";
const STATUS_REMOVED_BG  = "#ffebee";
const STATUS_REMOVED_TEXT= "#c62828";
const MUTED_TEXT         = "#9a9aa0";
const ZONE_BG            = "#faf8ff";
const ZONE_BORDER_EMPTY  = "#c8b8e8";
const TABLE_HEAD_BG      = "#f5f3fa";
const TABLE_BORDER       = "#e8e0f0";
const TABLE_ROW_BORDER   = "#f0ecf8";

const STATUS_ROW_STYLE = {
  added:     { background: STATUS_ADDED_BG },
  changed:   { background: STATUS_CHANGED_BG },
  removed:   { background: STATUS_REMOVED_BG },
  unchanged: { background: "#fff", opacity: 0.65 },
};

export default function SchedulePdfCompare() {
  const [pdfA, setPdfA] = useState(null);      // { name, base64 }
  const [pdfB, setPdfB] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [diff, setDiff] = useState(null);
  const [filter, setFilter] = useState("all"); // "all" | "changed"
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const refA = useRef();
  const refB = useRef();

  async function handleFile(file, setter) {
    if (!file?.type?.includes("pdf")) return;
    const base64 = await fileToBase64(file);
    setter({ name: file.name, base64 });
  }

  async function compare() {
    if (!pdfA || !pdfB) return;
    setComparing(true); setError(""); setDiff(null);
    try {
      const { diff: d } = await api("/api/schedule/compare-pdfs", {
        method: "POST",
        body: { pdfABase64: pdfA.base64, pdfBBase64: pdfB.base64 },
      });
      setDiff(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setComparing(false);
    }
  }

  async function downloadExcel() {
    if (!diff) return;
    setDownloading(true);
    try {
      const res = await apiBlob("/api/schedule/compare-pdfs/excel", { diff });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "Schedule_Compare.xlsx"; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setDownloading(false);
    }
  }

  function reset() {
    setDiff(null); setPdfA(null); setPdfB(null); setFilter("all"); setError("");
  }

  const visible = diff
    ? (filter === "changed" ? diff.filter(r => r.status === "changed") : diff)
    : [];

  const summary = diff && {
    added:   diff.filter(r => r.status === "added").length,
    changed: diff.filter(r => r.status === "changed").length,
    removed: diff.filter(r => r.status === "removed").length,
  };

  // All field column names, preserving order of first appearance
  const fieldCols = diff
    ? Array.from(new Set(diff.flatMap(r => Object.keys(r.fields || {}))))
    : [];

  return (
    <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 4, overflow: "hidden", fontFamily: "Inter, Arial, sans-serif" }}>
      {/* Card header */}
      <div style={{ background: SCHEDULE_FULL, padding: "10px 14px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", letterSpacing: ".04em" }}>PDF Compare</div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.65)", marginTop: 2 }}>Upload two PDF schedules to compare revisions</div>
      </div>

      <div style={{ padding: 16 }}>

        {/* ── Upload state ── */}
        {!diff && (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
              {[
                { label: "Revision A (Previous)", val: pdfA, set: setPdfA, ref: refA },
                { label: "Revision B (Current)",  val: pdfB, set: setPdfB, ref: refB },
              ].map(({ label, val, set, ref }, idx) => (
                <div key={idx} style={{ flex: 1 }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: SCHEDULE_FULL, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 5 }}>{label}</div>
                  <div
                    onClick={() => ref.current.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0], set); }}
                    style={{ border: `2px dashed ${val ? SCHEDULE_FULL : ZONE_BORDER_EMPTY}`, borderRadius: 4, padding: "18px 12px", textAlign: "center", background: ZONE_BG, cursor: "pointer" }}
                  >
                    <div style={{ fontSize: 22, marginBottom: 4 }}>📄</div>
                    <div style={{ fontSize: 9, color: val ? "#444" : MUTED_TEXT, wordBreak: "break-all" }}>{val ? val.name : "Drop PDF or click to browse"}</div>
                    {val && (
                      <div
                        style={{ fontSize: 8, color: SCHEDULE_FULL, marginTop: 4, cursor: "pointer" }}
                        onClick={e => { e.stopPropagation(); set(null); }}
                      >✕ Remove</div>
                    )}
                  </div>
                  <input ref={ref} type="file" accept="application/pdf" style={{ display: "none" }}
                    onChange={e => handleFile(e.target.files[0], set)} />
                </div>
              ))}
            </div>

            {error && <div style={{ fontSize: 10, color: STATUS_REMOVED_TEXT, marginBottom: 8 }}>{error}</div>}

            <div style={{ textAlign: "right" }}>
              <button
                onClick={compare}
                disabled={!pdfA || !pdfB || comparing}
                style={{
                  background: pdfA && pdfB && !comparing ? SCHEDULE_FULL : "#d0c8e0",
                  color: "#fff", border: "none", padding: "7px 18px", borderRadius: 3,
                  fontSize: 10, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase",
                  cursor: pdfA && pdfB && !comparing ? "pointer" : "default",
                }}
              >
                {comparing ? "Comparing…" : "Compare Schedules"}
              </button>
            </div>
          </>
        )}

        {/* ── Results state ── */}
        {diff && (
          <>
            {/* Summary + controls */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 9, background: STATUS_ADDED_BG, color: STATUS_ADDED_TEXT, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{summary.added} added</span>
              <span style={{ fontSize: 9, background: STATUS_CHANGED_BG, color: STATUS_CHANGED_TEXT, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{summary.changed} changed</span>
              <span style={{ fontSize: 9, background: STATUS_REMOVED_BG, color: STATUS_REMOVED_TEXT, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{summary.removed} removed</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                {["all", "changed"].map(f => (
                  <button key={f} onClick={() => setFilter(f)} style={{
                    fontSize: 9, padding: "4px 10px",
                    border: `1px solid ${filter === f ? SCHEDULE_FULL : "#e0e0e0"}`,
                    color: filter === f ? SCHEDULE_FULL : "#888",
                    borderRadius: 3, background: "#fff", cursor: "pointer",
                    fontWeight: filter === f ? 600 : 400,
                  }}>{f === "all" ? "All changes" : "Modified only"}</button>
                ))}
                <button
                  onClick={downloadExcel}
                  disabled={downloading}
                  style={{ background: SCHEDULE_FULL, color: "#fff", border: "none", padding: "5px 12px", borderRadius: 3, fontSize: 9, fontWeight: 600, cursor: "pointer" }}
                >{downloading ? "Downloading…" : "⬇ Download Excel"}</button>
                <button
                  onClick={reset}
                  style={{ background: "#fff", color: SCHEDULE_FULL, border: `1px solid ${SCHEDULE_FULL}`, padding: "5px 10px", borderRadius: 3, fontSize: 9, cursor: "pointer" }}
                >New Compare</button>
              </div>
            </div>

            {error && <div style={{ fontSize: 10, color: STATUS_REMOVED_TEXT, marginBottom: 8 }}>{error}</div>}

            {/* Diff table */}
            <div style={{ overflowX: "auto", border: `1px solid ${TABLE_BORDER}`, borderRadius: 3, maxHeight: 480, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9 }}>
                <thead style={{ position: "sticky", top: 0 }}>
                  <tr style={{ background: TABLE_HEAD_BG }}>
                    <th style={{ padding: "6px 8px", textAlign: "left", color: SCHEDULE_FULL, fontWeight: 600, borderBottom: `1px solid ${TABLE_BORDER}`, whiteSpace: "nowrap" }}>Mark</th>
                    {fieldCols.map(col => (
                      <th key={col} style={{ padding: "6px 8px", textAlign: "left", color: SCHEDULE_FULL, fontWeight: 600, borderBottom: `1px solid ${TABLE_BORDER}`, whiteSpace: "nowrap" }}>{col}</th>
                    ))}
                    <th style={{ padding: "6px 8px", color: SCHEDULE_FULL, fontWeight: 600, borderBottom: `1px solid ${TABLE_BORDER}` }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${TABLE_ROW_BORDER}`, ...STATUS_ROW_STYLE[row.status] }}>
                      <td style={{ padding: "5px 8px", fontWeight: 600, color: row.status === "removed" ? STATUS_REMOVED_TEXT : "#333" }}>{row.mark}</td>
                      {fieldCols.map(col => {
                        const field = row.fields?.[col];
                        const isChanged = row.status === "changed" && field?.old !== undefined && field?.new !== undefined;
                        return (
                          <td key={col} style={{ padding: "5px 8px", color: row.status === "removed" ? STATUS_REMOVED_TEXT : row.status === "unchanged" ? "#aaa" : "#333" }}>
                            {field ? (field.new ?? field.old ?? "") : ""}
                            {isChanged && <span style={{ color: "#888", marginLeft: 4 }}>(was {field.old})</span>}
                          </td>
                        );
                      })}
                      <td style={{ padding: "5px 8px" }}>
                        <span style={{
                          fontSize: 8, padding: "1px 6px", borderRadius: 2, fontWeight: 600,
                          background: row.status === "added" ? STATUS_ADDED_TEXT : row.status === "changed" ? STATUS_CHANGED_TEXT : row.status === "removed" ? STATUS_REMOVED_TEXT : "#e0e0e0",
                          color: row.status === "unchanged" ? "#888" : "#fff",
                        }}>
                          {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
