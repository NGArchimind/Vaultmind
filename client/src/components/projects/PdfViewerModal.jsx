import { useState, useEffect, useRef } from "react";
import { api } from "../../api/client";
import { DESIGN_TEXT, COMPARE_FULL } from "../../constants";
import { Spinner } from "../common/Spinner";

// ── PDF Viewer Modal — full screen ────────────────────────────────────────────
export default function PdfViewerModal({ drawing: initialDrawing, projectId, onClose, drawings: drawingsList = [], currentIndex: initialIndex = 0 }) {
  const [currentIdx, setCurrentIdx] = useState(initialIndex);
  const drawing = (drawingsList.length > 0 && drawingsList[currentIdx]) ? drawingsList[currentIdx] : initialDrawing;
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pdfUrlRef = useRef(null);

  useEffect(() => {
    async function load() {
      setLoading(true); setPdfUrl(null); setError("");
      try {
        const { base64 } = await api(`/api/projects/${projectId}/drawings/${drawing.id}/file`);
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        pdfUrlRef.current = url;
        setPdfUrl(url);
      } catch (e) { setError("Failed to load drawing: " + e.message); }
      setLoading(false);
    }
    load();
    return () => { if (pdfUrlRef.current) { URL.revokeObjectURL(pdfUrlRef.current); pdfUrlRef.current = null; } };
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
      <div style={{ background: DESIGN_TEXT, padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
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
        {error && <p style={{ fontSize: 13, color: COMPARE_FULL }}>{error}</p>}
        {pdfUrl && !loading && <iframe src={pdfUrl} style={{ width: "100%", height: "100%", border: "none" }} title={drawing.title} />}
      </div>
    </div>
  );
}

