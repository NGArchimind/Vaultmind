import React, { useState, useEffect, useRef } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { api } from "../api/client";
import { ARC_NAVY, ARC_TERRACOTTA, AD_GREEN } from "../constants";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const TOOL_COLORS  = ["#e53935", "#1e88e5", "#43a047", "#fb8c00", "#000000", "#ffffff"];
const STROKE_WIDTHS = [2, 4, 7];
const TOOL_LABELS  = { select:"↖", pen:"✏", rect:"▭", ellipse:"◯", arrow:"→", text:"T", leader:"↗T" };
const TOOL_TITLES  = { select:"Select & edit", pen:"Freehand pen", rect:"Rectangle", ellipse:"Ellipse", arrow:"Arrow", text:"Text label", leader:"Leader callout" };
const HANDLE_R     = 6;

// ── Pure utility functions ────────────────────────────────────────────────────

function distToSegment(pt, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (!dx && !dy) return Math.hypot(pt.x - a.x, pt.y - a.y);
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy));
}

// Returns consistent box geometry for a leader annotation.
// tx,ty is the text baseline origin (bottom-left of first line).
// Box top-left is (tx-pad, ty-fs-pad); tbw/tbh are explicit overrides.
function leaderBoxDims(ann) {
  const fs = ann.fs || 14, pad = 5;
  return {
    bx: ann.tx - pad,
    by: ann.ty - fs - pad,
    bw: ann.tbw || 160,
    bh: ann.tbh || (fs + pad * 2),
    fs, pad,
  };
}

function wrapText(ctx, text, maxWidth) {
  if (!text) return [""];
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function getHandles(ann) {
  switch (ann.type) {
    case "leader": {
      const { bx, by, bw, bh } = leaderBoxDims(ann);
      return [
        { id:"arrow",  x:ann.ax,      y:ann.ay      },
        { id:"box_tr", x:bx+bw,       y:by          },
        { id:"box_mr", x:bx+bw,       y:by+bh/2     },
        { id:"box_br", x:bx+bw,       y:by+bh       },
        { id:"box_bm", x:bx+bw/2,     y:by+bh       },
      ];
    }
    case "arrow":  return [{ id:"p1", x:ann.x1, y:ann.y1 }, { id:"p2", x:ann.x2, y:ann.y2 }];
    case "rect":   return [
      { id:"tl", x:ann.x,           y:ann.y           }, { id:"tr", x:ann.x+ann.w, y:ann.y           },
      { id:"bl", x:ann.x,           y:ann.y+ann.h      }, { id:"br", x:ann.x+ann.w, y:ann.y+ann.h     },
      { id:"tm", x:ann.x+ann.w/2,   y:ann.y           }, { id:"bm", x:ann.x+ann.w/2, y:ann.y+ann.h   },
      { id:"ml", x:ann.x,           y:ann.y+ann.h/2   }, { id:"mr", x:ann.x+ann.w,   y:ann.y+ann.h/2 },
    ];
    case "ellipse": return [
      { id:"tl", x:ann.x,          y:ann.y          }, { id:"tr", x:ann.x+ann.w, y:ann.y          },
      { id:"bl", x:ann.x,          y:ann.y+ann.h    }, { id:"br", x:ann.x+ann.w, y:ann.y+ann.h    },
    ];
    case "text": return [{ id:"move", x:ann.x, y:ann.y - 14 }];
    case "pen": {
      const xs = ann.pts.map(p => p.x), ys = ann.pts.map(p => p.y);
      return [{ id:"move", x:(Math.min(...xs)+Math.max(...xs))/2, y:(Math.min(...ys)+Math.max(...ys))/2 }];
    }
    default: return [];
  }
}

function hitTestHandle(handles, pt) {
  return handles.find(h => Math.hypot(h.x - pt.x, h.y - pt.y) <= HANDLE_R + 3) || null;
}

function hitTestAnnotation(ann, pt) {
  const T = 8;
  switch (ann.type) {
    case "pen":    return ann.pts.some(p => Math.hypot(p.x-pt.x, p.y-pt.y) < T*2);
    case "rect":   return pt.x>=ann.x-T && pt.x<=ann.x+ann.w+T && pt.y>=ann.y-T && pt.y<=ann.y+ann.h+T;
    case "ellipse": {
      if (!ann.w || !ann.h) return false;
      const cx=ann.x+ann.w/2, cy=ann.y+ann.h/2, rx=Math.abs(ann.w/2)+T, ry=Math.abs(ann.h/2)+T;
      return ((pt.x-cx)/rx)**2 + ((pt.y-cy)/ry)**2 <= 1;
    }
    case "arrow":  return distToSegment(pt, {x:ann.x1,y:ann.y1}, {x:ann.x2,y:ann.y2}) < T;
    case "text":   return Math.abs(pt.x-ann.x) < 100 && Math.abs(pt.y-ann.y) < 22;
    case "leader": {
      const { bx, by, bw, bh } = leaderBoxDims(ann);
      if (pt.x >= bx && pt.x <= bx+bw && pt.y >= by && pt.y <= by+bh) return true;
      return distToSegment(pt, {x:ann.tx, y:ann.ty}, {x:ann.ax, y:ann.ay}) < T;
    }
    default: return false;
  }
}

function applyHandleDrag(ann, handleId, dx, dy) {
  const a = JSON.parse(JSON.stringify(ann));
  switch (ann.type) {
    case "leader": {
      const fs = a.fs || 14, pad = 5;
      const initW = a.tbw || 160;
      const initH = a.tbh || (fs + pad * 2);
      if (handleId === "arrow")        { a.ax += dx; a.ay += dy; }
      else if (handleId === "box_tr")  { a.tbw = Math.max(40, initW + dx); }
      else if (handleId === "box_mr")  { a.tbw = Math.max(40, initW + dx); }
      else if (handleId === "box_br")  { a.tbw = Math.max(40, initW + dx); a.tbh = Math.max(fs + pad*2, initH + dy); }
      else if (handleId === "box_bm")  { a.tbh = Math.max(fs + pad*2, initH + dy); }
      else                             { a.ax += dx; a.ay += dy; a.tx += dx; a.ty += dy; }
      break;
    }
    case "arrow":
      if (handleId==="p1")         { a.x1+=dx; a.y1+=dy; }
      else if (handleId==="p2")    { a.x2+=dx; a.y2+=dy; }
      else                         { a.x1+=dx; a.y1+=dy; a.x2+=dx; a.y2+=dy; }
      break;
    case "rect":
      if      (handleId==="tl")    { a.x+=dx; a.y+=dy; a.w-=dx; a.h-=dy; }
      else if (handleId==="tr")    { a.y+=dy; a.w+=dx; a.h-=dy; }
      else if (handleId==="bl")    { a.x+=dx; a.w-=dx; a.h+=dy; }
      else if (handleId==="br")    { a.w+=dx; a.h+=dy; }
      else if (handleId==="tm")    { a.y+=dy; a.h-=dy; }
      else if (handleId==="bm")    { a.h+=dy; }
      else if (handleId==="ml")    { a.x+=dx; a.w-=dx; }
      else if (handleId==="mr")    { a.w+=dx; }
      else                         { a.x+=dx; a.y+=dy; }
      break;
    case "ellipse":
      if      (handleId==="tl")    { a.x+=dx; a.y+=dy; a.w-=dx; a.h-=dy; }
      else if (handleId==="tr")    { a.w+=dx; a.y+=dy; a.h-=dy; }
      else if (handleId==="bl")    { a.x+=dx; a.w-=dx; a.h+=dy; }
      else if (handleId==="br")    { a.w+=dx; a.h+=dy; }
      else                         { a.x+=dx; a.y+=dy; }
      break;
    case "text": a.x+=dx; a.y+=dy; break;
    case "pen":  a.pts = ann.pts.map(p => ({ x:p.x+dx, y:p.y+dy })); break;
  }
  return a;
}

// ── Drawing helpers ───────────────────────────────────────────────────────────

function drawArrow(ctx, x1, y1, x2, y2) {
  const hLen = 14, angle = Math.atan2(y2-y1, x2-x1);
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2,y2); ctx.lineTo(x2-hLen*Math.cos(angle-Math.PI/6), y2-hLen*Math.sin(angle-Math.PI/6));
  ctx.moveTo(x2,y2); ctx.lineTo(x2-hLen*Math.cos(angle+Math.PI/6), y2-hLen*Math.sin(angle+Math.PI/6));
  ctx.stroke();
}

function drawAnnotation(ctx, ann) {
  ctx.strokeStyle = ann.color || "#e53935";
  ctx.fillStyle   = ann.color || "#e53935";
  ctx.lineWidth   = ann.sw    || 2;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  switch (ann.type) {
    case "pen":
      if (!ann.pts?.length) return;
      ctx.beginPath(); ctx.moveTo(ann.pts[0].x, ann.pts[0].y);
      ann.pts.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke(); break;
    case "rect":
      ctx.strokeRect(ann.x, ann.y, ann.w, ann.h); break;
    case "ellipse":
      if (!ann.w || !ann.h) return;
      ctx.beginPath();
      ctx.ellipse(ann.x+ann.w/2, ann.y+ann.h/2, Math.abs(ann.w/2), Math.abs(ann.h/2), 0, 0, 2*Math.PI);
      ctx.stroke(); break;
    case "arrow":
      drawArrow(ctx, ann.x1, ann.y1, ann.x2, ann.y2); break;
    case "text": {
      const tfs = ann.fs || (11+(ann.sw-1)*3);
      ctx.font = `bold ${tfs}px Inter, Arial, sans-serif`;
      ctx.fillText(ann.text, ann.x, ann.y); break;
    }
    case "leader": {
      drawArrow(ctx, ann.tx, ann.ty, ann.ax, ann.ay);
      if (!ann.text) break;
      const lfs = ann.fs || 14, pad = 5;
      ctx.font = `bold ${lfs}px Inter, Arial, sans-serif`;

      // Compute box dimensions — tbw/tbh are explicit overrides
      const innerW = (ann.tbw || 160) - pad * 2;
      const lines = wrapText(ctx, ann.text, innerW);
      const lineH = lfs * 1.3;
      const bw = ann.tbw || (ctx.measureText(ann.text).width + pad * 2);
      const bh = ann.tbh || (lines.length * lineH + pad * 2);
      const bx = ann.tx - pad, by = ann.ty - lfs - pad;

      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = ann.color || "#e53935"; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, bw, bh);
      ctx.restore();

      ctx.fillStyle = ann.color || "#e53935";
      ctx.font = `bold ${lfs}px Inter, Arial, sans-serif`;
      lines.forEach((l, i) => ctx.fillText(l, ann.tx, ann.ty - pad + i * lineH));
      break;
    }
    default: break;
  }
}

function drawSelectionOverlay(ctx, ann) {
  ctx.save();
  ctx.setLineDash([4,3]); ctx.strokeStyle="#1e88e5"; ctx.lineWidth=1.5;
  switch (ann.type) {
    case "rect":    ctx.strokeRect(ann.x-4, ann.y-4, ann.w+8, ann.h+8); break;
    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(ann.x+ann.w/2, ann.y+ann.h/2, Math.abs(ann.w/2)+5, Math.abs(ann.h/2)+5, 0, 0, 2*Math.PI);
      ctx.stroke(); break;
    case "leader": {
      const { bx, by, bw, bh } = leaderBoxDims(ann);
      ctx.strokeRect(bx - 3, by - 3, bw + 6, bh + 6);
      break;
    }
    default: break;
  }
  ctx.setLineDash([]);
  getHandles(ann).forEach(h => {
    ctx.fillStyle="#fff"; ctx.strokeStyle="#1e88e5"; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(h.x, h.y, HANDLE_R, 0, 2*Math.PI); ctx.fill(); ctx.stroke();
  });
  ctx.restore();
}

function redrawCanvas(canvas, anns, preview=null, selectedIdx=-1) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  (anns||[]).forEach((a,i) => { drawAnnotation(ctx,a); if (i===selectedIdx) drawSelectionOverlay(ctx,a); });
  if (preview) drawAnnotation(ctx, preview);
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function PDFAnnotator({ roundId, taskTitle, roundNumber, onClose, onComplete }) {
  const [pdfUrl,        setPdfUrl]        = useState(null);
  const [numPages,      setNumPages]      = useState(0);
  const [currentPage,   setCurrentPage]   = useState(1);
  const [pageHeight,    setPageHeight]    = useState(0);
  const [tool,          setTool]          = useState("pen");
  const [color,         setColor]         = useState("#e53935");
  const [sw,            setSw]            = useState(2);
  const [fs,            setFs]            = useState(14);
  const [annotations,   setAnnotations]   = useState({});
  const [selected,      setSelected]      = useState(null); // { page, index } | null
  const [comments,      setComments]      = useState([]);
  const [newComment,    setNewComment]    = useState("");
  const [addingComment, setAddingComment] = useState(false);
  const [copiedComment, setCopiedComment] = useState(null); // { text } — persists across pages
  const [textInput,     setTextInput]     = useState(null); // { x, y, editingIndex? }
  const [saving,        setSaving]        = useState(false);
  const [completing,    setCompleting]    = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);

  const canvasRef        = useRef();
  const pageWrapperRef   = useRef();
  const isDrawing        = useRef(false);
  const startPt          = useRef(null);
  const currentPts       = useRef([]);
  const pendingLeaderRef = useRef(null);
  const dragStateRef     = useRef(null);
  const PAGE_WIDTH       = 820;

  const selectedAnn = (selected?.page === currentPage)
    ? (annotations[currentPage] || [])[selected.index]
    : null;

  // Load PDF + comments
  useEffect(() => {
    async function loadRound() {
      const [pdfRes, comms] = await Promise.all([
        api(`/api/review-rounds/${roundId}/pdf`).catch(() => null),
        api(`/api/review-rounds/${roundId}/comments`).catch(() => []),
      ]);
      if (pdfRes?.base64) setPdfUrl(`data:application/pdf;base64,${pdfRes.base64}`);
      if (Array.isArray(comms)) setComments(comms);
    }
    loadRound();
  }, [roundId]);

  // Redraw whenever annotations, selection, or page changes
  useEffect(() => {
    if (pageHeight > 0) {
      const selIdx = selected?.page === currentPage ? selected.index : -1;
      redrawCanvas(canvasRef.current, annotations[currentPage], null, selIdx);
    }
  }, [annotations, currentPage, pageHeight, selected]);

  // ESC = deselect / cancel
  useEffect(() => {
    const onKey = e => {
      if (e.key === "Escape") {
        setSelected(null); dragStateRef.current = null;
        setTextInput(null); pendingLeaderRef.current = null;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function handlePageRenderSuccess() {
    if (pageWrapperRef.current) {
      const canvas = pageWrapperRef.current.querySelector("canvas");
      if (canvas) setPageHeight(canvas.offsetHeight);
    }
  }

  function getCanvasPt(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ── Update property on selected annotation ──────────────────────────────────
  function setSelectedProp(key, value) {
    if (!selectedAnn || selected.page !== currentPage) return;
    setAnnotations(prev => {
      const pageAnns = [...(prev[currentPage] || [])];
      pageAnns[selected.index] = { ...pageAnns[selected.index], [key]: value };
      return { ...prev, [currentPage]: pageAnns };
    });
  }

  // ── Mouse handlers ──────────────────────────────────────────────────────────
  function onMouseDown(e) {
    const pt = getCanvasPt(e);

    if (tool === "select") {
      const pageAnns = annotations[currentPage] || [];
      if (selectedAnn) {
        const hitHandle = hitTestHandle(getHandles(selectedAnn), pt);
        if (hitHandle) {
          dragStateRef.current = { handleId: hitHandle.id, startPt: pt, origAnn: JSON.parse(JSON.stringify(selectedAnn)) };
          return;
        }
      }
      for (let i = pageAnns.length - 1; i >= 0; i--) {
        if (hitTestAnnotation(pageAnns[i], pt)) {
          setSelected({ page: currentPage, index: i });
          dragStateRef.current = { handleId: "body", startPt: pt, origAnn: JSON.parse(JSON.stringify(pageAnns[i])) };
          return;
        }
      }
      setSelected(null); dragStateRef.current = null;
      return;
    }

    if (tool === "text") { setTextInput({ x: pt.x, y: pt.y }); return; }
    isDrawing.current = true; startPt.current = pt; currentPts.current = [pt];
  }

  function onMouseMove(e) {
    const pt = getCanvasPt(e);

    if (tool === "select") {
      if (!dragStateRef.current || !selected) return;
      const ds = dragStateRef.current;
      const dx = pt.x - ds.startPt.x, dy = pt.y - ds.startPt.y;
      const updated = applyHandleDrag(ds.origAnn, ds.handleId, dx, dy);
      setAnnotations(prev => {
        const pageAnns = [...(prev[currentPage] || [])];
        pageAnns[selected.index] = updated;
        return { ...prev, [currentPage]: pageAnns };
      });
      return;
    }

    if (!isDrawing.current) return;
    const sp = startPt.current;
    if (tool === "pen") {
      currentPts.current.push(pt);
      redrawCanvas(canvasRef.current, annotations[currentPage], { type:"pen", pts:[...currentPts.current], color, sw });
    } else {
      let preview;
      if (tool==="rect")    preview={type:"rect",   x:Math.min(sp.x,pt.x),y:Math.min(sp.y,pt.y),w:Math.abs(pt.x-sp.x),h:Math.abs(pt.y-sp.y),color,sw};
      if (tool==="ellipse") preview={type:"ellipse",x:Math.min(sp.x,pt.x),y:Math.min(sp.y,pt.y),w:Math.abs(pt.x-sp.x),h:Math.abs(pt.y-sp.y),color,sw};
      if (tool==="arrow")   preview={type:"arrow",  x1:sp.x,y1:sp.y,x2:pt.x,y2:pt.y,color,sw};
      if (tool==="leader")  preview={type:"leader", ax:sp.x,ay:sp.y,tx:pt.x,ty:pt.y,color,sw,text:""};
      if (preview) redrawCanvas(canvasRef.current, annotations[currentPage], preview);
    }
  }

  function onMouseUp(e) {
    if (tool === "select") { dragStateRef.current = null; return; }
    if (!isDrawing.current) return;
    isDrawing.current = false;
    const pt = getCanvasPt(e), sp = startPt.current;
    let ann;
    if (tool==="pen") {
      if (currentPts.current.length < 2) { startPt.current=null; return; }
      ann = { type:"pen", pts:[...currentPts.current], color, sw };
    } else if (tool==="rect") {
      if (Math.abs(pt.x-sp.x)<3||Math.abs(pt.y-sp.y)<3) return;
      ann = { type:"rect",   x:Math.min(sp.x,pt.x),y:Math.min(sp.y,pt.y),w:Math.abs(pt.x-sp.x),h:Math.abs(pt.y-sp.y),color,sw };
    } else if (tool==="ellipse") {
      if (Math.abs(pt.x-sp.x)<3||Math.abs(pt.y-sp.y)<3) return;
      ann = { type:"ellipse",x:Math.min(sp.x,pt.x),y:Math.min(sp.y,pt.y),w:Math.abs(pt.x-sp.x),h:Math.abs(pt.y-sp.y),color,sw };
    } else if (tool==="arrow") {
      if (Math.abs(pt.x-sp.x)<3&&Math.abs(pt.y-sp.y)<3) return;
      ann = { type:"arrow",  x1:sp.x,y1:sp.y,x2:pt.x,y2:pt.y,color,sw };
    } else if (tool==="leader") {
      if (Math.abs(pt.x-sp.x)<5&&Math.abs(pt.y-sp.y)<5) return;
      pendingLeaderRef.current = { ax:sp.x, ay:sp.y, tx:pt.x, ty:pt.y };
      setTextInput({ x:pt.x, y:pt.y-22 });
      currentPts.current=[]; startPt.current=null; return;
    }
    if (ann) setAnnotations(prev => ({ ...prev, [currentPage]: [...(prev[currentPage]||[]), ann] }));
    currentPts.current=[]; startPt.current=null;
  }

  function onDoubleClick(e) {
    if (tool !== "select" || !selectedAnn) return;
    if (selectedAnn.type === "text") {
      setTextInput({ x:selectedAnn.x, y:selectedAnn.y-14, editingIndex:selected.index });
    } else if (selectedAnn.type === "leader") {
      pendingLeaderRef.current = { ax:selectedAnn.ax, ay:selectedAnn.ay, tx:selectedAnn.tx, ty:selectedAnn.ty };
      setTextInput({ x:selectedAnn.tx, y:selectedAnn.ty-22, editingIndex:selected.index });
    }
  }

  // ── Text commit ──────────────────────────────────────────────────────────────
  function commitText(text) {
    if (!textInput) return;
    if (!text?.trim()) { pendingLeaderRef.current=null; setTextInput(null); return; }

    if (textInput.editingIndex !== undefined) {
      setAnnotations(prev => {
        const pageAnns = [...(prev[currentPage]||[])];
        pageAnns[textInput.editingIndex] = { ...pageAnns[textInput.editingIndex], text:text.trim() };
        return { ...prev, [currentPage]: pageAnns };
      });
      pendingLeaderRef.current=null; setTextInput(null); return;
    }

    if (pendingLeaderRef.current) {
      const { ax, ay, tx, ty } = pendingLeaderRef.current;
      const lfs = fs, pad = 5;
      // Compute initial box size from canvas so handles align with the rendered text
      let initW = 160;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx.font = `bold ${lfs}px Inter, Arial, sans-serif`;
        initW = ctx.measureText(text.trim()).width + pad * 2;
      }
      const initH = lfs + pad * 2;
      const ann = { type:"leader", ax, ay, tx, ty, text:text.trim(), color, sw, fs, tbw:initW, tbh:initH };
      setAnnotations(prev => ({ ...prev, [currentPage]: [...(prev[currentPage]||[]), ann] }));
      pendingLeaderRef.current=null;
    } else {
      const ann = { type:"text", x:textInput.x, y:textInput.y+14, text:text.trim(), color, sw, fs };
      setAnnotations(prev => ({ ...prev, [currentPage]: [...(prev[currentPage]||[]), ann] }));
    }
    setTextInput(null);
  }

  // ── Other actions ─────────────────────────────────────────────────────────────
  function undoLast() {
    setAnnotations(prev => { const arr=[...(prev[currentPage]||[])]; arr.pop(); return {...prev,[currentPage]:arr}; });
    if (selected?.page===currentPage) setSelected(null);
  }

  function deleteSelected() {
    if (!selectedAnn) return;
    setAnnotations(prev => {
      const pageAnns=[...(prev[currentPage]||[])];
      pageAnns.splice(selected.index, 1);
      return { ...prev, [currentPage]: pageAnns };
    });
    setSelected(null);
  }

  async function saveAnnotations() {
    setSaving(true);
    await api(`/api/review-rounds/${roundId}`, { method:"PATCH", body:{ annotations } }).catch(()=>null);
    setSaving(false);
  }

  async function addComment() {
    if (!newComment.trim()) return;
    setAddingComment(true);
    const created = await api(`/api/review-rounds/${roundId}/comments`, {
      method:"POST", body:{ comment_text:newComment.trim(), page_number:currentPage },
    }).catch(()=>null);
    if (created) setComments(c=>[...c, created]);
    setNewComment(""); setAddingComment(false);
  }

  async function pasteComment() {
    if (!copiedComment) return;
    const created = await api(`/api/review-rounds/${roundId}/comments`, {
      method:"POST", body:{ comment_text:copiedComment.text, page_number:currentPage },
    }).catch(()=>null);
    if (created) setComments(c=>[...c, created]);
  }

  async function deleteComment(id) {
    await api(`/api/review-comments/${id}`, { method:"DELETE" }).catch(()=>null);
    setComments(c=>c.filter(x=>x.id!==id));
  }

  async function handleComplete() {
    setCompleting(true);
    await api(`/api/review-rounds/${roundId}`, { method:"PATCH", body:{ annotations } }).catch(()=>null);
    await api(`/api/review-rounds/${roundId}/complete`, { method:"POST", body:{ annotations } }).catch(()=>null);
    setCompleting(false); onComplete?.(); onClose();
  }

  // ── Toolbar helpers ──────────────────────────────────────────────────────────
  const toolBtn = t => ({
    padding:"5px 10px", fontSize:14, fontWeight:700, border:"none", cursor:"pointer",
    background: tool===t ? "#fff" : "transparent", color: tool===t ? ARC_NAVY : "#aab8c0",
    borderRadius:2, fontFamily:"Inter, Arial, sans-serif", transition:"all 0.1s", minWidth:34,
  });

  const showFsControl = tool==="text" || tool==="leader" ||
    (selectedAnn && (selectedAnn.type==="text" || selectedAnn.type==="leader"));

  const activeFontSize = selectedAnn?.fs || fs;

  function handleColorClick(c) {
    setColor(c);
    if (selectedAnn) setSelectedProp("color", c);
  }
  function handleSwClick(w) {
    setSw(w);
    if (selectedAnn) setSelectedProp("sw", w);
  }
  function handleFsChange(delta) {
    const nv = Math.max(8, Math.min(48, activeFontSize + delta));
    setFs(nv);
    if (selectedAnn) setSelectedProp("fs", nv);
  }

  const canvasCursor = tool==="select" ? (dragStateRef.current ? "grabbing" : "default")
    : tool==="text" ? "text" : "crosshair";

  // Input width for leader editing — match the current box width
  const textInputWidth = (() => {
    if (textInput?.editingIndex !== undefined && selectedAnn?.tbw) return selectedAnn.tbw;
    if (textInput?.editingIndex !== undefined && selectedAnn?.type === "leader") return 160;
    return undefined; // auto (minWidth applies)
  })();

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ position:"fixed", inset:0, zIndex:3000, background:"#1a242e", display:"flex", flexDirection:"column", fontFamily:"Inter, Arial, sans-serif" }}>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div style={{ background:"#1e2a35", borderBottom:"1px solid #2a3a4a", padding:"0 16px", height:54, display:"flex", alignItems:"center", gap:16, flexShrink:0, overflowX:"auto" }}>

        <div style={{ display:"flex", flexDirection:"column", marginRight:4, flexShrink:0 }}>
          <span style={{ fontSize:10, color:"#7a9aaa", fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase" }}>Round {roundNumber}</span>
          <span style={{ fontSize:12, color:"#fff", fontWeight:500, maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{taskTitle}</span>
        </div>

        <div style={{ width:1, height:32, background:"#2a3a4a", flexShrink:0 }} />

        {/* Tools */}
        <div style={{ display:"flex", gap:2, flexShrink:0 }}>
          {Object.entries(TOOL_LABELS).map(([t,icon]) => (
            <button key={t} onClick={()=>{ setTool(t); if(t!=="select") setSelected(null); }} style={toolBtn(t)} title={TOOL_TITLES[t]}>
              {icon}
            </button>
          ))}
        </div>

        <div style={{ width:1, height:32, background:"#2a3a4a", flexShrink:0 }} />

        {/* Colors */}
        <div style={{ display:"flex", gap:5, alignItems:"center", flexShrink:0 }}>
          {TOOL_COLORS.map(c => (
            <button key={c} onClick={()=>handleColorClick(c)} style={{
              width:20, height:20, borderRadius:"50%", background:c, padding:0, cursor:"pointer",
              border: (selectedAnn?.color||color)===c ? "2px solid #fff" : "2px solid transparent",
              outline: c==="#ffffff" ? "1px solid #555" : "none",
            }} />
          ))}
        </div>

        <div style={{ width:1, height:32, background:"#2a3a4a", flexShrink:0 }} />

        {/* Stroke width */}
        <div style={{ display:"flex", gap:5, alignItems:"center", flexShrink:0 }}>
          {STROKE_WIDTHS.map(w => (
            <button key={w} onClick={()=>handleSwClick(w)} style={{
              width:28, height:28, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
              border: (selectedAnn?.sw||sw)===w ? "2px solid #fff" : "2px solid #2a3a4a", background:"transparent",
            }}>
              <div style={{ width:14, height:w, background:"#fff", borderRadius:w }} />
            </button>
          ))}
        </div>

        {/* Font size — only for text / leader */}
        {showFsControl && (
          <>
            <div style={{ width:1, height:32, background:"#2a3a4a", flexShrink:0 }} />
            <div style={{ display:"flex", alignItems:"center", gap:5, flexShrink:0 }}>
              <span style={{ fontSize:10, color:"#7a9aaa", fontWeight:600 }}>Aa</span>
              <button onClick={()=>handleFsChange(-2)}
                style={{ background:"#2a3a4a", border:"none", color:"#fff", width:22, height:22, cursor:"pointer", fontSize:14, lineHeight:1 }}>−</button>
              <span style={{ fontSize:12, color:"#fff", minWidth:24, textAlign:"center" }}>{activeFontSize}</span>
              <button onClick={()=>handleFsChange(2)}
                style={{ background:"#2a3a4a", border:"none", color:"#fff", width:22, height:22, cursor:"pointer", fontSize:14, lineHeight:1 }}>+</button>
            </div>
          </>
        )}

        {/* Selected annotation actions */}
        {selectedAnn && (
          <>
            <div style={{ width:1, height:32, background:"#2a3a4a", flexShrink:0 }} />
            <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
              <span style={{ fontSize:10, color:"#7a9aaa", letterSpacing:"0.06em", textTransform:"uppercase" }}>
                {selectedAnn.type === "leader" ? "Leader" : selectedAnn.type}
                {(selectedAnn.type==="text"||selectedAnn.type==="leader") ? " — dbl-click to edit text" : ""}
              </span>
              <button onClick={deleteSelected}
                style={{ fontSize:11, padding:"3px 10px", background:"none", border:`1px solid ${ARC_TERRACOTTA}`, color:ARC_TERRACOTTA, cursor:"pointer", fontFamily:"Inter, Arial, sans-serif" }}>
                Delete
              </button>
            </div>
          </>
        )}

        <div style={{ width:1, height:32, background:"#2a3a4a", flexShrink:0 }} />

        {/* Page nav */}
        <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          <button onClick={()=>setCurrentPage(p=>Math.max(1,p-1))} disabled={currentPage<=1}
            style={{ background:"none", border:"1px solid #2a3a4a", color:currentPage<=1?"#3a5060":"#fff", padding:"3px 10px", cursor:currentPage<=1?"default":"pointer", fontSize:14 }}>‹</button>
          <span style={{ color:"#aab8c0", fontSize:12, minWidth:70, textAlign:"center" }}>Page {currentPage} / {numPages||"?"}</span>
          <button onClick={()=>setCurrentPage(p=>Math.min(numPages,p+1))} disabled={currentPage>=numPages}
            style={{ background:"none", border:"1px solid #2a3a4a", color:currentPage>=numPages?"#3a5060":"#fff", padding:"3px 10px", cursor:currentPage>=numPages?"default":"pointer", fontSize:14 }}>›</button>
        </div>

        {/* Right actions */}
        <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center", flexShrink:0 }}>
          <button onClick={undoLast} style={{ background:"none", border:"1px solid #2a3a4a", color:"#aab8c0", padding:"5px 12px", fontSize:12, cursor:"pointer" }}>↩ Undo</button>
          <button onClick={saveAnnotations} disabled={saving}
            style={{ background:"#2a3a4a", border:"1px solid #3a5060", color:"#fff", padding:"5px 14px", fontSize:12, cursor:"pointer", fontWeight:600 }}>
            {saving?"Saving…":"Save"}
          </button>
          {!confirmComplete ? (
            <button onClick={()=>setConfirmComplete(true)}
              style={{ background:AD_GREEN, border:"none", color:"#fff", padding:"5px 16px", fontSize:12, cursor:"pointer", fontWeight:700 }}>
              Complete Review ✓
            </button>
          ) : (
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              <span style={{ color:"#aab8c0", fontSize:11 }}>Mark reviewed?</span>
              <button onClick={handleComplete} disabled={completing}
                style={{ background:AD_GREEN, border:"none", color:"#fff", padding:"5px 14px", fontSize:12, cursor:"pointer", fontWeight:700 }}>
                {completing?"…":"Yes"}
              </button>
              <button onClick={()=>setConfirmComplete(false)}
                style={{ background:"none", border:"1px solid #2a3a4a", color:"#aab8c0", padding:"5px 10px", fontSize:12, cursor:"pointer" }}>No</button>
            </div>
          )}
          <button onClick={onClose} style={{ background:"none", border:"none", color:"#aab8c0", fontSize:22, cursor:"pointer", lineHeight:1, padding:"0 4px" }}>×</button>
        </div>
      </div>

      {/* ── Main area ────────────────────────────────────────────────────────── */}
      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>

        {/* PDF + annotation canvas */}
        <div style={{ flex:1, overflowY:"auto", display:"flex", justifyContent:"center", alignItems:"flex-start", padding:"24px 24px 48px", background:"#1a242e" }}>
          <div ref={pageWrapperRef} style={{ position:"relative", userSelect:"none" }}>
            {pdfUrl ? (
              <Document file={pdfUrl} onLoadSuccess={({numPages})=>setNumPages(numPages)}
                loading={<div style={{ color:"#7a9aaa", padding:60, fontSize:13 }}>Loading PDF…</div>}>
                <Page pageNumber={currentPage} width={PAGE_WIDTH} onRenderSuccess={handlePageRenderSuccess}
                  renderAnnotationLayer={false} renderTextLayer={false} />
              </Document>
            ) : (
              <div style={{ width:PAGE_WIDTH, height:600, background:"#243040", display:"flex", alignItems:"center", justifyContent:"center", color:"#7a9aaa" }}>
                Loading…
              </div>
            )}

            {pageHeight > 0 && (
              <canvas ref={canvasRef} width={PAGE_WIDTH} height={pageHeight}
                style={{ position:"absolute", top:0, left:0, cursor:canvasCursor }}
                onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
                onMouseLeave={e=>{ if(isDrawing.current) onMouseUp(e); dragStateRef.current=null; }}
                onDoubleClick={onDoubleClick}
              />
            )}

            {textInput && (
              <input autoFocus
                defaultValue={textInput.editingIndex!==undefined
                  ? ((annotations[currentPage]||[])[textInput.editingIndex]?.text||"")
                  : ""}
                onBlur={e=>commitText(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter") commitText(e.target.value); if(e.key==="Escape") { pendingLeaderRef.current=null; setTextInput(null); } }}
                style={{
                  position:"absolute", left:textInput.x, top:textInput.y,
                  background:"rgba(0,0,0,0.7)", color:selectedAnn?.color||color,
                  border:`1px solid ${selectedAnn?.color||color}`,
                  fontSize:activeFontSize, fontWeight:700, outline:"none", padding:"2px 6px",
                  width: textInputWidth, minWidth:140,
                  fontFamily:"Inter, Arial, sans-serif",
                }}
              />
            )}
          </div>
        </div>

        {/* Comments panel */}
        <div style={{ width:300, background:"#1e2a35", borderLeft:"1px solid #2a3a4a", display:"flex", flexDirection:"column", flexShrink:0 }}>
          <div style={{ padding:"14px 16px", borderBottom:"1px solid #2a3a4a" }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#7a9aaa", letterSpacing:"0.08em", textTransform:"uppercase" }}>Comments</div>
          </div>

          <div style={{ flex:1, overflowY:"auto", padding:"8px 0" }}>
            {comments.length===0 && (
              <div style={{ padding:"24px 16px", color:"#5a6a7a", fontSize:12, textAlign:"center" }}>No comments yet</div>
            )}
            {comments.map(c => (
              <div key={c.id} style={{ padding:"10px 16px", borderBottom:"1px solid #253545" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
                  <span style={{ fontSize:10, color:"#5a7a8a", fontWeight:600 }}>Page {c.page_number}</span>
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                    {/* Copy button */}
                    <button
                      onClick={() => setCopiedComment({ text: c.comment_text })}
                      title="Copy to another sheet"
                      style={{ background:"none", border:"none", color: copiedComment?.text===c.comment_text ? AD_GREEN : "#3a5060", fontSize:13, cursor:"pointer", lineHeight:1, padding:0 }}
                      onMouseEnter={e=>e.currentTarget.style.color=AD_GREEN}
                      onMouseLeave={e=>e.currentTarget.style.color=copiedComment?.text===c.comment_text?AD_GREEN:"#3a5060"}>
                      ⎘
                    </button>
                    <button onClick={()=>deleteComment(c.id)}
                      style={{ background:"none", border:"none", color:"#3a5060", fontSize:14, cursor:"pointer", lineHeight:1, padding:0 }}
                      onMouseEnter={e=>e.currentTarget.style.color=ARC_TERRACOTTA}
                      onMouseLeave={e=>e.currentTarget.style.color="#3a5060"}>×</button>
                  </div>
                </div>
                <div style={{ fontSize:13, color:"#d0dce4", lineHeight:1.4 }}>{c.comment_text}</div>
                <div style={{ fontSize:10, color:"#3a5060", marginTop:4 }}>
                  {new Date(c.created_at).toLocaleDateString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}
                </div>
              </div>
            ))}
          </div>

          <div style={{ padding:"12px 16px", borderTop:"1px solid #2a3a4a" }}>

            {/* Clipboard strip — shown when a comment has been copied */}
            {copiedComment && (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:"#1a3040", border:"1px solid #2a4a5a", padding:"6px 10px", marginBottom:8 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:9, color:AD_GREEN, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:2 }}>Copied</div>
                  <div style={{ fontSize:11, color:"#a0c8d8", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                    {copiedComment.text.length > 38 ? copiedComment.text.slice(0,38)+"…" : copiedComment.text}
                  </div>
                </div>
                <div style={{ display:"flex", gap:5, flexShrink:0, marginLeft:8 }}>
                  <button onClick={pasteComment}
                    style={{ fontSize:10, fontWeight:700, padding:"3px 10px", background:AD_GREEN, color:"#fff", border:"none", cursor:"pointer", fontFamily:"Inter, Arial, sans-serif" }}>
                    Paste p.{currentPage}
                  </button>
                  <button onClick={()=>setCopiedComment(null)}
                    style={{ background:"none", border:"none", color:"#5a7a8a", fontSize:14, cursor:"pointer", lineHeight:1, padding:0 }}>×</button>
                </div>
              </div>
            )}

            <div style={{ fontSize:10, color:"#5a7a8a", marginBottom:6, fontWeight:600 }}>ADD COMMENT — PAGE {currentPage}</div>
            <textarea value={newComment} onChange={e=>setNewComment(e.target.value)} placeholder="Type a comment…" rows={3}
              style={{ width:"100%", background:"#253545", border:"1px solid #2a3a4a", color:"#d0dce4", fontSize:12, padding:"8px 10px", outline:"none", resize:"none", fontFamily:"Inter, Arial, sans-serif", boxSizing:"border-box" }}
              onKeyDown={e=>{ if(e.key==="Enter"&&e.ctrlKey) addComment(); }} />
            <button onClick={addComment} disabled={!newComment.trim()||addingComment}
              style={{ width:"100%", marginTop:6, background:newComment.trim()?AD_GREEN:"#2a3a4a", color:"#fff", border:"none", padding:"7px 0", fontSize:11, fontWeight:700, cursor:newComment.trim()?"pointer":"default", fontFamily:"Inter, Arial, sans-serif" }}>
              {addingComment?"Adding…":"Add Comment (Ctrl+Enter)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
