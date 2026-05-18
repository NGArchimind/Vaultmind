import React, { useState, useEffect, useRef, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { api } from "../api/client";
import { ARC_NAVY, ARC_TERRACOTTA, AD_GREEN } from "../constants";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

const TOOL_COLORS = ["#e53935", "#1e88e5", "#43a047", "#fb8c00", "#000000", "#ffffff"];
const STROKE_WIDTHS = [2, 4, 7];
const TOOL_LABELS = { select: "↖", pen: "✏", rect: "▭", ellipse: "◯", arrow: "→", text: "T" };

function drawArrow(ctx, x1, y1, x2, y2) {
  const headLen = 14;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

function drawAnnotation(ctx, ann) {
  ctx.strokeStyle = ann.color || "#e53935";
  ctx.fillStyle   = ann.color || "#e53935";
  ctx.lineWidth   = ann.sw    || 2;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";
  switch (ann.type) {
    case "pen":
      if (!ann.pts?.length) return;
      ctx.beginPath();
      ctx.moveTo(ann.pts[0].x, ann.pts[0].y);
      ann.pts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
      break;
    case "rect":
      ctx.strokeRect(ann.x, ann.y, ann.w, ann.h);
      break;
    case "ellipse":
      if (!ann.w || !ann.h) return;
      ctx.beginPath();
      ctx.ellipse(ann.x + ann.w / 2, ann.y + ann.h / 2, Math.abs(ann.w / 2), Math.abs(ann.h / 2), 0, 0, 2 * Math.PI);
      ctx.stroke();
      break;
    case "arrow":
      drawArrow(ctx, ann.x1, ann.y1, ann.x2, ann.y2);
      break;
    case "text":
      ctx.font      = `bold ${11 + (ann.sw - 1) * 3}px Inter, Arial, sans-serif`;
      ctx.fillText(ann.text, ann.x, ann.y);
      break;
    default: break;
  }
}

function redrawCanvas(canvas, anns, preview = null) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  (anns || []).forEach(a => drawAnnotation(ctx, a));
  if (preview) drawAnnotation(ctx, preview);
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function PDFAnnotator({ roundId, taskTitle, roundNumber, onClose, onComplete }) {
  const [pdfUrl,      setPdfUrl]      = useState(null);
  const [numPages,    setNumPages]    = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageHeight,  setPageHeight]  = useState(0);
  const [tool,        setTool]        = useState("pen");
  const [color,       setColor]       = useState("#e53935");
  const [sw,          setSw]          = useState(2);
  const [annotations, setAnnotations] = useState({});
  const [comments,    setComments]    = useState([]);
  const [newComment,  setNewComment]  = useState("");
  const [addingComment, setAddingComment] = useState(false);
  const [textInput,   setTextInput]   = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [completing,  setCompleting]  = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);

  const canvasRef   = useRef();
  const isDrawing   = useRef(false);
  const startPt     = useRef(null);
  const currentPts  = useRef([]);
  const PAGE_WIDTH  = 820;

  // Load PDF URL + existing annotations + comments
  useEffect(() => {
    async function load() {
      const [urlRes, rounds, comms] = await Promise.all([
        api(`/api/review-rounds/${roundId}/pdf-url`).catch(() => null),
        api(`/api/tasks/${roundId}/review-rounds`).catch(() => []),  // won't work — we need the round directly
        api(`/api/review-rounds/${roundId}/comments`).catch(() => []),
      ]);
      if (urlRes?.url) setPdfUrl(urlRes.url);
      if (Array.isArray(comms)) setComments(comms);
    }
    async function loadRound() {
      const [urlRes, comms] = await Promise.all([
        api(`/api/review-rounds/${roundId}/pdf-url`).catch(() => null),
        api(`/api/review-rounds/${roundId}/comments`).catch(() => []),
      ]);
      if (urlRes?.url) setPdfUrl(urlRes.url);
      if (Array.isArray(comms)) setComments(comms);
    }
    loadRound();
  }, [roundId]);

  // Redraw canvas whenever page/annotations change
  useEffect(() => {
    if (pageHeight > 0) redrawCanvas(canvasRef.current, annotations[currentPage]);
  }, [annotations, currentPage, pageHeight]);

  function getCanvasPt(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onMouseDown(e) {
    if (tool === "select") return;
    const pt = getCanvasPt(e);
    if (tool === "text") {
      setTextInput({ x: pt.x, y: pt.y });
      return;
    }
    isDrawing.current = true;
    startPt.current   = pt;
    currentPts.current = [pt];
  }

  function onMouseMove(e) {
    if (!isDrawing.current) return;
    const pt = getCanvasPt(e);
    if (tool === "pen") {
      currentPts.current.push(pt);
      const preview = { type: "pen", pts: [...currentPts.current], color, sw };
      redrawCanvas(canvasRef.current, annotations[currentPage], preview);
    } else {
      const sp = startPt.current;
      let preview;
      if (tool === "rect")    preview = { type:"rect",    x:Math.min(sp.x,pt.x), y:Math.min(sp.y,pt.y), w:Math.abs(pt.x-sp.x), h:Math.abs(pt.y-sp.y), color, sw };
      if (tool === "ellipse") preview = { type:"ellipse", x:Math.min(sp.x,pt.x), y:Math.min(sp.y,pt.y), w:Math.abs(pt.x-sp.x), h:Math.abs(pt.y-sp.y), color, sw };
      if (tool === "arrow")   preview = { type:"arrow",   x1:sp.x, y1:sp.y, x2:pt.x, y2:pt.y, color, sw };
      if (preview) redrawCanvas(canvasRef.current, annotations[currentPage], preview);
    }
  }

  function onMouseUp(e) {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    const pt = getCanvasPt(e);
    const sp = startPt.current;
    let ann;
    if (tool === "pen") {
      if (currentPts.current.length < 2) { startPt.current = null; return; }
      ann = { type:"pen", pts:[...currentPts.current], color, sw };
    } else if (tool === "rect") {
      if (Math.abs(pt.x - sp.x) < 3 || Math.abs(pt.y - sp.y) < 3) return;
      ann = { type:"rect", x:Math.min(sp.x,pt.x), y:Math.min(sp.y,pt.y), w:Math.abs(pt.x-sp.x), h:Math.abs(pt.y-sp.y), color, sw };
    } else if (tool === "ellipse") {
      if (Math.abs(pt.x - sp.x) < 3 || Math.abs(pt.y - sp.y) < 3) return;
      ann = { type:"ellipse", x:Math.min(sp.x,pt.x), y:Math.min(sp.y,pt.y), w:Math.abs(pt.x-sp.x), h:Math.abs(pt.y-sp.y), color, sw };
    } else if (tool === "arrow") {
      if (Math.abs(pt.x - sp.x) < 3 && Math.abs(pt.y - sp.y) < 3) return;
      ann = { type:"arrow", x1:sp.x, y1:sp.y, x2:pt.x, y2:pt.y, color, sw };
    }
    if (ann) {
      setAnnotations(prev => ({ ...prev, [currentPage]: [...(prev[currentPage] || []), ann] }));
    }
    currentPts.current = [];
    startPt.current    = null;
  }

  function commitText(text) {
    if (!text?.trim() || !textInput) return;
    const ann = { type:"text", x:textInput.x, y:textInput.y + 14, text:text.trim(), color, sw };
    setAnnotations(prev => ({ ...prev, [currentPage]: [...(prev[currentPage] || []), ann] }));
    setTextInput(null);
  }

  function undoLast() {
    setAnnotations(prev => {
      const arr = [...(prev[currentPage] || [])];
      arr.pop();
      return { ...prev, [currentPage]: arr };
    });
  }

  async function saveAnnotations(final = false) {
    setSaving(true);
    await api(`/api/review-rounds/${roundId}`, { method: "PATCH", body: { annotations } }).catch(() => null);
    setSaving(false);
  }

  async function addComment() {
    if (!newComment.trim()) return;
    setAddingComment(true);
    const created = await api(`/api/review-rounds/${roundId}/comments`, {
      method: "POST", body: { comment_text: newComment.trim(), page_number: currentPage },
    }).catch(() => null);
    if (created) setComments(c => [...c, created]);
    setNewComment("");
    setAddingComment(false);
  }

  async function deleteComment(id) {
    await api(`/api/review-comments/${id}`, { method: "DELETE" }).catch(() => null);
    setComments(c => c.filter(x => x.id !== id));
  }

  async function handleComplete() {
    setCompleting(true);
    await api(`/api/review-rounds/${roundId}`, { method: "PATCH", body: { annotations } }).catch(() => null);
    await api(`/api/review-rounds/${roundId}/complete`, { method: "POST", body: { annotations } }).catch(() => null);
    setCompleting(false);
    onComplete?.();
    onClose();
  }

  // ── Styles ──────────────────────────────────────────────────────────────────
  const toolBtn = (t) => ({
    padding: "5px 10px", fontSize: 14, fontWeight: 700, border: "none", cursor: "pointer",
    background: tool === t ? "#fff" : "transparent", color: tool === t ? ARC_NAVY : "#aab8c0",
    borderRadius: 2, fontFamily: "Inter, Arial, sans-serif", transition: "all 0.1s",
    minWidth: 34,
  });

  return (
    <div style={{ position:"fixed", inset:0, zIndex:3000, background:"#1a242e", display:"flex", flexDirection:"column", fontFamily:"Inter, Arial, sans-serif" }}>

      {/* ── Top toolbar ────────────────────────────────────────────────────── */}
      <div style={{ background:"#1e2a35", borderBottom:"1px solid #2a3a4a", padding:"0 20px", height:52, display:"flex", alignItems:"center", gap:20, flexShrink:0 }}>

        {/* Title */}
        <div style={{ display:"flex", flexDirection:"column", marginRight:8 }}>
          <span style={{ fontSize:11, color:"#7a9aaa", fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase" }}>Review — Round {roundNumber}</span>
          <span style={{ fontSize:13, color:"#fff", fontWeight:500, maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{taskTitle}</span>
        </div>

        <div style={{ width:1, height:32, background:"#2a3a4a" }} />

        {/* Drawing tools */}
        <div style={{ display:"flex", gap:2 }}>
          {Object.entries(TOOL_LABELS).map(([t, icon]) => (
            <button key={t} onClick={() => setTool(t)} style={toolBtn(t)} title={t.charAt(0).toUpperCase() + t.slice(1)}>
              {icon}
            </button>
          ))}
        </div>

        <div style={{ width:1, height:32, background:"#2a3a4a" }} />

        {/* Colors */}
        <div style={{ display:"flex", gap:5, alignItems:"center" }}>
          {TOOL_COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)} style={{
              width:20, height:20, borderRadius:"50%", background:c, border: color===c ? "2px solid #fff" : "2px solid transparent",
              cursor:"pointer", padding:0, outline: c==="#ffffff" ? "1px solid #555" : "none",
            }} />
          ))}
        </div>

        <div style={{ width:1, height:32, background:"#2a3a4a" }} />

        {/* Stroke width */}
        <div style={{ display:"flex", gap:5, alignItems:"center" }}>
          {STROKE_WIDTHS.map(w => (
            <button key={w} onClick={() => setSw(w)} style={{
              width:28, height:28, border: sw===w ? "2px solid #fff" : "2px solid #2a3a4a",
              background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
            }}>
              <div style={{ width:16, height:w, background:"#fff", borderRadius:w }} />
            </button>
          ))}
        </div>

        <div style={{ width:1, height:32, background:"#2a3a4a" }} />

        {/* Page navigation */}
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <button onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage <= 1}
            style={{ background:"none", border:"1px solid #2a3a4a", color: currentPage<=1 ? "#3a5060" : "#fff", padding:"3px 10px", cursor: currentPage<=1 ? "default" : "pointer", fontSize:14 }}>‹</button>
          <span style={{ color:"#aab8c0", fontSize:12, minWidth:70, textAlign:"center" }}>Page {currentPage} / {numPages || "?"}</span>
          <button onClick={() => setCurrentPage(p => Math.min(numPages, p+1))} disabled={currentPage >= numPages}
            style={{ background:"none", border:"1px solid #2a3a4a", color: currentPage>=numPages ? "#3a5060" : "#fff", padding:"3px 10px", cursor: currentPage>=numPages ? "default" : "pointer", fontSize:14 }}>›</button>
        </div>

        {/* Right side actions */}
        <div style={{ marginLeft:"auto", display:"flex", gap:10, alignItems:"center" }}>
          <button onClick={undoLast} title="Undo last annotation"
            style={{ background:"none", border:"1px solid #2a3a4a", color:"#aab8c0", padding:"5px 12px", fontSize:12, cursor:"pointer" }}>
            ↩ Undo
          </button>
          <button onClick={() => saveAnnotations()} disabled={saving}
            style={{ background:"#2a3a4a", border:"1px solid #3a5060", color:"#fff", padding:"5px 14px", fontSize:12, cursor:"pointer", fontWeight:600 }}>
            {saving ? "Saving…" : "Save"}
          </button>
          {!confirmComplete ? (
            <button onClick={() => setConfirmComplete(true)}
              style={{ background:AD_GREEN, border:"none", color:"#fff", padding:"5px 16px", fontSize:12, cursor:"pointer", fontWeight:700, letterSpacing:"0.04em" }}>
              Complete Review ✓
            </button>
          ) : (
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              <span style={{ color:"#aab8c0", fontSize:11 }}>Mark as reviewed?</span>
              <button onClick={handleComplete} disabled={completing}
                style={{ background:AD_GREEN, border:"none", color:"#fff", padding:"5px 14px", fontSize:12, cursor:"pointer", fontWeight:700 }}>
                {completing ? "…" : "Yes"}
              </button>
              <button onClick={() => setConfirmComplete(false)}
                style={{ background:"none", border:"1px solid #2a3a4a", color:"#aab8c0", padding:"5px 10px", fontSize:12, cursor:"pointer" }}>
                No
              </button>
            </div>
          )}
          <button onClick={onClose}
            style={{ background:"none", border:"none", color:"#aab8c0", fontSize:22, cursor:"pointer", lineHeight:1, padding:"0 4px" }}>×</button>
        </div>
      </div>

      {/* ── Main area ───────────────────────────────────────────────────────── */}
      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>

        {/* PDF + canvas */}
        <div style={{ flex:1, overflowY:"auto", display:"flex", justifyContent:"center", alignItems:"flex-start", padding:"24px 24px 48px", background:"#1a242e" }}>
          <div style={{ position:"relative", userSelect:"none" }}>
            {pdfUrl ? (
              <Document file={pdfUrl} onLoadSuccess={({ numPages }) => setNumPages(numPages)} loading={
                <div style={{ color:"#7a9aaa", padding:60, fontSize:13 }}>Loading PDF…</div>
              }>
                <Page
                  pageNumber={currentPage}
                  width={PAGE_WIDTH}
                  onRenderSuccess={({ height }) => setPageHeight(height)}
                  renderAnnotationLayer={false}
                  renderTextLayer={false}
                />
              </Document>
            ) : (
              <div style={{ width:PAGE_WIDTH, height:600, background:"#243040", display:"flex", alignItems:"center", justifyContent:"center", color:"#7a9aaa" }}>
                Loading…
              </div>
            )}

            {/* Annotation canvas overlay */}
            {pageHeight > 0 && (
              <canvas
                ref={canvasRef}
                width={PAGE_WIDTH}
                height={pageHeight}
                style={{ position:"absolute", top:0, left:0, cursor: tool === "select" ? "default" : tool === "text" ? "text" : "crosshair" }}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={e => { if (isDrawing.current) onMouseUp(e); }}
              />
            )}

            {/* Inline text input */}
            {textInput && (
              <input
                autoFocus
                onBlur={e => commitText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") commitText(e.target.value);
                  if (e.key === "Escape") setTextInput(null);
                }}
                style={{
                  position:"absolute", left:textInput.x, top:textInput.y,
                  background:"rgba(0,0,0,0.6)", color, border:`1px solid ${color}`,
                  fontSize:13, fontWeight:700, outline:"none", padding:"2px 6px",
                  minWidth:120, fontFamily:"Inter, Arial, sans-serif",
                }}
              />
            )}
          </div>
        </div>

        {/* ── Comment panel ───────────────────────────────────────────────── */}
        <div style={{ width:300, background:"#1e2a35", borderLeft:"1px solid #2a3a4a", display:"flex", flexDirection:"column", flexShrink:0 }}>
          <div style={{ padding:"14px 16px", borderBottom:"1px solid #2a3a4a" }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#7a9aaa", letterSpacing:"0.08em", textTransform:"uppercase" }}>
              Comments
            </div>
          </div>

          {/* Comment list */}
          <div style={{ flex:1, overflowY:"auto", padding:"8px 0" }}>
            {comments.length === 0 && (
              <div style={{ padding:"24px 16px", color:"#5a6a7a", fontSize:12, textAlign:"center" }}>No comments yet</div>
            )}
            {comments.map(c => (
              <div key={c.id} style={{ padding:"10px 16px", borderBottom:"1px solid #253545" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
                  <span style={{ fontSize:10, color:"#5a7a8a", fontWeight:600 }}>
                    Page {c.page_number}
                  </span>
                  <button onClick={() => deleteComment(c.id)}
                    style={{ background:"none", border:"none", color:"#3a5060", fontSize:14, cursor:"pointer", lineHeight:1, padding:0 }}
                    onMouseEnter={e => e.currentTarget.style.color = ARC_TERRACOTTA}
                    onMouseLeave={e => e.currentTarget.style.color = "#3a5060"}>×</button>
                </div>
                <div style={{ fontSize:13, color:"#d0dce4", lineHeight:1.4 }}>{c.comment_text}</div>
                <div style={{ fontSize:10, color:"#3a5060", marginTop:4 }}>
                  {new Date(c.created_at).toLocaleDateString("en-GB", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" })}
                </div>
              </div>
            ))}
          </div>

          {/* Add comment */}
          <div style={{ padding:"12px 16px", borderTop:"1px solid #2a3a4a" }}>
            <div style={{ fontSize:10, color:"#5a7a8a", marginBottom:6, fontWeight:600 }}>
              ADD COMMENT — PAGE {currentPage}
            </div>
            <textarea
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              placeholder="Type a comment…"
              rows={3}
              style={{ width:"100%", background:"#253545", border:"1px solid #2a3a4a", color:"#d0dce4", fontSize:12, padding:"8px 10px", outline:"none", resize:"none", fontFamily:"Inter, Arial, sans-serif", boxSizing:"border-box" }}
              onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey) addComment(); }}
            />
            <button onClick={addComment} disabled={!newComment.trim() || addingComment}
              style={{ width:"100%", marginTop:6, background: newComment.trim() ? AD_GREEN : "#2a3a4a", color:"#fff", border:"none", padding:"7px 0", fontSize:11, fontWeight:700, letterSpacing:"0.05em", cursor: newComment.trim() ? "pointer" : "default", fontFamily:"Inter, Arial, sans-serif" }}>
              {addingComment ? "Adding…" : "Add Comment (Ctrl+Enter)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
