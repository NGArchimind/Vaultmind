import React, { useState, useEffect, useRef } from "react";
import { api } from "../api/client";
import { DESIGN_TEXT, PROJECTS_FULL, COMPARE_FULL } from "../constants";
import PDFAnnotator from "./PDFAnnotator";

const STATUS_STYLE = {
  in_review: { bg: "#fff8e6", color: "#b07800", border: "#f0d080", label: "In Review" },
  reviewed:  { bg: "#f0faf2", color: "#2a7a3a", border: "#90d0a0", label: "Reviewed"  },
};

function RoundBadge({ status }) {
  const s = STATUS_STYLE[status] || { bg: "#f5f5f5", color: "#7a8a9a", border: "#ddd", label: status };
  return (
    <span style={{ fontSize:11, fontWeight:600, padding:"3px 10px", background:s.bg, color:s.color, border:`1px solid ${s.border}` }}>
      {s.label}
    </span>
  );
}

export default function DrawingReview({ taskId, taskTitle, onClose, onStatusChange }) {
  const [rounds,      setRounds]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [uploading,   setUploading]   = useState(false);
  const [files,       setFiles]       = useState([]); // {name, base64}[]
  const [annotator,   setAnnotator]   = useState(null); // { roundId, roundNumber }
  const [dragOver,    setDragOver]    = useState(false);
  const [expandedRound, setExpandedRound] = useState(null);
  const [roundComments, setRoundComments] = useState({});
  const fileInputRef = useRef();

  useEffect(() => { loadRounds(); }, [taskId]);

  async function loadRounds() {
    setLoading(true);
    const data = await api(`/api/tasks/${taskId}/review-rounds`).catch(() => []);
    setRounds(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  async function readFiles(fileList) {
    const results = [];
    for (const f of fileList) {
      if (!f.type.includes("pdf")) continue;
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload  = e => res(e.target.result.split(",")[1]);
        reader.onerror = rej;
        reader.readAsDataURL(f);
      });
      results.push({ name: f.name, base64 });
    }
    setFiles(prev => [...prev, ...results]);
  }

  function handleFileInput(e) { readFiles(e.target.files); e.target.value = ""; }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    readFiles(e.dataTransfer.files);
  }

  async function handleUpload() {
    if (!files.length) return;
    setUploading(true);
    const round = await api(`/api/tasks/${taskId}/review-rounds`, {
      method: "POST", body: { pdfs: files },
    }).catch(() => null);
    if (round) {
      setRounds(prev => [...prev, round]);
      setFiles([]);
      onStatusChange?.({ status: "in_review", round_number: round.round_number });
    }
    setUploading(false);
  }

  async function expandRound(roundId) {
    if (expandedRound === roundId) { setExpandedRound(null); return; }
    setExpandedRound(roundId);
    if (!roundComments[roundId]) {
      const comms = await api(`/api/review-rounds/${roundId}/comments`).catch(() => []);
      setRoundComments(prev => ({ ...prev, [roundId]: Array.isArray(comms) ? comms : [] }));
    }
  }

  function handleAnnotatorClose() {
    setAnnotator(null);
    loadRounds(); // refresh after annotation session
  }

  function handleAnnotatorComplete() {
    onStatusChange?.({ status: "reviewed" });
  }

  const latestRound = rounds[rounds.length - 1];
  const canUploadNew = !latestRound || latestRound.status === "reviewed";

  const dropZoneStyle = {
    border: `2px dashed ${dragOver ? PROJECTS_FULL : "#c8d4da"}`,
    background: dragOver ? "#f0faf2" : "#f8f8fa",
    padding: "28px 20px", textAlign:"center", cursor:"pointer",
    transition:"all 0.15s", marginBottom:16,
  };

  if (annotator) {
    return (
      <PDFAnnotator
        roundId={annotator.roundId}
        taskTitle={taskTitle}
        roundNumber={annotator.roundNumber}
        onClose={handleAnnotatorClose}
        onComplete={handleAnnotatorComplete}
      />
    );
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background:"#fff", width:600, maxHeight:"88vh", overflowY:"auto", borderTop:`3px solid ${DESIGN_TEXT}`, fontFamily:"Inter, Arial, sans-serif" }}>

        {/* Header */}
        <div style={{ background:"#fff", padding:"20px 28px 16px", borderBottom:"1px solid #e4e4e8", display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:"#9a9088", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:4 }}>Drawing Review</div>
            <div style={{ fontSize:16, fontWeight:500, color:DESIGN_TEXT }}>{taskTitle}</div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:22, color:"#9a9088", cursor:"pointer" }}>×</button>
        </div>

        <div style={{ padding:"24px 28px" }}>

          {/* Existing rounds */}
          {loading ? (
            <div style={{ color:"#9a9088", fontSize:13, padding:"16px 0" }}>Loading…</div>
          ) : rounds.length > 0 ? (
            <div style={{ marginBottom:24 }}>
              <div style={{ fontSize:11, fontWeight:600, color:"#9a9088", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:12 }}>Review Rounds</div>
              {rounds.map(r => (
                <div key={r.id} style={{ border:"1px solid #e4e4e8", marginBottom:8 }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 16px", background:"#f8f8fa", cursor:"pointer" }}
                    onClick={() => expandRound(r.id)}>
                    <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                      <span style={{ fontSize:13, fontWeight:600, color:DESIGN_TEXT }}>Round {r.round_number}</span>
                      <RoundBadge status={r.status} />
                      <span style={{ fontSize:11, color:"#9a9088" }}>
                        {new Date(r.created_at).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" })}
                      </span>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <button
                        onClick={e => { e.stopPropagation(); setAnnotator({ roundId: r.id, roundNumber: r.round_number }); }}
                        style={{ fontSize:11, fontWeight:700, padding:"5px 14px", background: r.status === "in_review" ? COMPARE_FULL : DESIGN_TEXT, color:"#fff", border:"none", cursor:"pointer", fontFamily:"Inter, Arial, sans-serif" }}>
                        {r.status === "in_review" ? "Open for Review" : "View / Annotate"}
                      </button>
                      <span style={{ fontSize:13, color:"#9a9088" }}>{expandedRound === r.id ? "▲" : "▼"}</span>
                    </div>
                  </div>

                  {expandedRound === r.id && (
                    <div style={{ padding:"12px 16px", borderTop:"1px solid #e4e4e8" }}>
                      {r.completed_at && (
                        <div style={{ fontSize:12, color:"#9a9088", marginBottom:8 }}>
                          Reviewed: {new Date(r.completed_at).toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" })}
                        </div>
                      )}
                      {roundComments[r.id]?.length ? (
                        <div>
                          <div style={{ fontSize:11, fontWeight:600, color:"#9a9088", letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:8 }}>Comments ({roundComments[r.id].length})</div>
                          {roundComments[r.id].map(c => (
                            <div key={c.id} style={{ display:"flex", gap:10, padding:"8px 10px", background:"#f8f5f0", marginBottom:4, borderLeft:`3px solid ${COMPARE_FULL}` }}>
                              <span style={{ fontSize:10, color:"#9a9088", whiteSpace:"nowrap", paddingTop:2 }}>Pg {c.page_number}</span>
                              <span style={{ fontSize:12, color:DESIGN_TEXT }}>{c.comment_text}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize:12, color:"#9a9088" }}>No comments on this round.</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          {/* Upload new round */}
          {canUploadNew && (
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:"#9a9088", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:12 }}>
                {rounds.length === 0 ? "Upload Drawings" : `Upload Round ${rounds.length + 1}`}
              </div>

              {/* Drop zone */}
              <div
                style={dropZoneStyle}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div style={{ fontSize:28, marginBottom:8 }}>📄</div>
                <div style={{ fontSize:13, color:DESIGN_TEXT, fontWeight:500 }}>Drop PDF files here or click to browse</div>
                <div style={{ fontSize:11, color:"#9a9088", marginTop:4 }}>PDFs only — all files will be merged into a single review pack</div>
              </div>
              <input ref={fileInputRef} type="file" accept=".pdf" multiple style={{ display:"none" }} onChange={handleFileInput} />

              {/* File list */}
              {files.length > 0 && (
                <div style={{ border:"1px solid #e4e4e8", marginBottom:16 }}>
                  {files.map((f, i) => (
                    <div key={i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 14px", borderBottom: i < files.length-1 ? "1px solid #f0f0f4" : "none", background: i%2===0 ? "#fff" : "#f8f8fa" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <span style={{ fontSize:16 }}>📄</span>
                        <span style={{ fontSize:12, color:DESIGN_TEXT }}>{f.name}</span>
                      </div>
                      <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                        style={{ background:"none", border:"none", color:"#b0b8c0", fontSize:16, cursor:"pointer", padding:"0 4px" }}
                        onMouseEnter={e => e.currentTarget.style.color = COMPARE_FULL}
                        onMouseLeave={e => e.currentTarget.style.color = "#b0b8c0"}>×</button>
                    </div>
                  ))}
                  <div style={{ padding:"8px 14px", background:"#f5f8fa", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:11, color:"#9a9088" }}>{files.length} file{files.length !== 1 ? "s" : ""} — will be merged in order shown</span>
                    <button onClick={() => fileInputRef.current?.click()}
                      style={{ fontSize:11, color:PROJECTS_FULL, background:"none", border:`1px solid ${PROJECTS_FULL}`, padding:"3px 10px", cursor:"pointer", fontFamily:"Inter, Arial, sans-serif" }}>
                      + Add more
                    </button>
                  </div>
                </div>
              )}

              <div style={{ display:"flex", gap:10 }}>
                <button onClick={handleUpload} disabled={!files.length || uploading}
                  style={{ background: files.length ? DESIGN_TEXT : "#ccc", color:"#fff", border:"none", padding:"9px 24px", fontSize:11, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", cursor: files.length ? "pointer" : "default", fontFamily:"Inter, Arial, sans-serif" }}>
                  {uploading ? "Merging & uploading…" : "Submit for Review"}
                </button>
                <button onClick={onClose}
                  style={{ background:"none", border:"1px solid #dde4e8", color:"#9a9088", padding:"9px 16px", fontSize:11, cursor:"pointer", fontFamily:"Inter, Arial, sans-serif" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Latest round in review — prompt reviewer */}
          {!canUploadNew && latestRound?.status === "in_review" && (
            <div style={{ background:"#fff8e6", border:"1px solid #f0d080", padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:"#b07800" }}>Round {latestRound.round_number} is awaiting review</div>
                <div style={{ fontSize:12, color:"#b07800", marginTop:3 }}>Open the reviewer to annotate and leave comments.</div>
              </div>
              <button onClick={() => setAnnotator({ roundId: latestRound.id, roundNumber: latestRound.round_number })}
                style={{ background:COMPARE_FULL, color:"#fff", border:"none", padding:"8px 20px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"Inter, Arial, sans-serif", flexShrink:0 }}>
                Open Reviewer →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
