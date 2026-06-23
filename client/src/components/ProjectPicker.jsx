import React, { useState, useRef, useEffect, useMemo } from "react";
import { DESIGN_TEXT } from "../constants";
import { CATEGORIES } from "../categories";

// value: project id | `cat:<value>` | ""    onChange(newValue)
// projects: [{ id, name, job_number }]      recentIds: [projectId, ...]
export default function ProjectPicker({ value, onChange, projects, recentIds = [], disabled, style, hideOther }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode]   = useState("projects"); // "projects" | "other"
  const boxRef = useRef(null);

  function close() { setOpen(false); setQuery(""); setMode("projects"); }
  function pick(v) { onChange(v); close(); }

  useEffect(() => {
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) close(); }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const projLabel = (p) => (p.job_number ? `${p.job_number} — ${p.name}` : p.name);
  const currentLabel = useMemo(() => {
    if (!value) return "— Select —";
    if (value.startsWith("cat:")) return CATEGORIES.find(c => `cat:${c.value}` === value)?.label || "Other";
    const p = projects.find(p => p.id === value);
    return p ? projLabel(p) : "— Select —";
  }, [value, projects]);

  const q = query.trim().toLowerCase();
  const matches = (p) => projLabel(p).toLowerCase().includes(q);
  const recentProjects = recentIds.map(id => projects.find(p => p.id === id)).filter(Boolean).filter(matches);
  const recentSet = new Set(recentIds);
  const otherProjects = projects.filter(p => !recentSet.has(p.id)).filter(matches);
  const reasonMatches = (q && !hideOther) ? CATEGORIES.filter(c => c.label.toLowerCase().includes(q)) : [];

  const ss = { padding: "5px 8px", fontSize: 13, border: "1px solid #d0d8de", background: disabled ? "#f5f5f5" : "#fff",
    color: DESIGN_TEXT, fontFamily: "Inter, Arial, sans-serif", cursor: disabled ? "default" : "pointer" };
  const grpHdr = { padding: "4px 10px", fontSize: 9, fontWeight: 700, letterSpacing: ".08em", color: "#6a8a9a", background: "#f7f9fa" };
  const row    = { padding: "6px 10px", fontSize: 13, color: DESIGN_TEXT, cursor: "pointer" };

  return (
    <div ref={boxRef} style={{ position: "relative", ...style }}>
      <div onClick={() => !disabled && setOpen(o => !o)} style={{ ...ss, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentLabel}</span>
        <span style={{ color: "#8a9aa8" }}>▾</span>
      </div>

      {open && (
        <div style={{ position: "absolute", zIndex: 50, top: "calc(100% + 2px)", left: 0, right: 0, minWidth: 240,
          border: "1px solid #4c6278", background: "#fff", boxShadow: "0 6px 24px rgba(0,0,0,.12)" }}>

          {mode === "projects" ? (
            <>
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="🔍 Search projects…"
                style={{ width: "100%", boxSizing: "border-box", border: "none", borderBottom: "1px solid #eef2f4", padding: "8px 10px", fontSize: 13, outline: "none" }} />
              {!hideOther && (
                <div onClick={() => { setMode("other"); setQuery(""); }}
                  style={{ padding: "9px 10px", borderBottom: "1px solid #eef2f4", background: "#fff", color: DESIGN_TEXT, fontSize: 13, fontWeight: 600, display: "flex", justifyContent: "space-between", cursor: "pointer" }}>
                  <span>Other — non-project time</span><span style={{ color: "#8a9aa8" }}>›</span>
                </div>
              )}
              <div style={{ maxHeight: 240, overflowY: "auto" }}>
                {recentProjects.length > 0 && <div style={grpHdr}>RECENT</div>}
                {recentProjects.map(p => <div key={p.id} style={row} onClick={() => pick(p.id)}>{projLabel(p)}</div>)}
                {otherProjects.length > 0 && <div style={grpHdr}>ALL PROJECTS</div>}
                {otherProjects.map(p => <div key={p.id} style={row} onClick={() => pick(p.id)}>{projLabel(p)}</div>)}
                {reasonMatches.length > 0 && <div style={grpHdr}>OTHER</div>}
                {reasonMatches.map(c => <div key={c.value} style={row} onClick={() => pick(`cat:${c.value}`)}>{c.label}</div>)}
                {recentProjects.length + otherProjects.length + reasonMatches.length === 0 &&
                  <div style={{ ...row, color: "#8a9aa8", cursor: "default" }}>No matches</div>}
              </div>
            </>
          ) : (
            <>
              <div onClick={() => { setMode("projects"); setQuery(""); }}
                style={{ padding: "9px 10px", borderBottom: "1px solid #eef2f4", color: "#4c6278", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                ‹ Back to projects
              </div>
              <div style={{ maxHeight: 260, overflowY: "auto" }}>
                {[...CATEGORIES].sort((a, b) => a.label.localeCompare(b.label)).map(c =>
                  <div key={c.value} style={row} onClick={() => pick(`cat:${c.value}`)}>{c.label}</div>)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
