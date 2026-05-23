import { useState, useEffect } from "react";
import { api } from "../api/client";
import { PROJECTS_FULL, DESIGN_TEXT, DESIGN_MUTED } from "../constants";
import { Spinner } from "./common/Spinner";
import AgreementsReviewModal from "./AgreementsReviewModal";

function formatDateStr(str) {
  if (!str) return "";
  const [y, m, d] = str.split("-");
  return new Date(Number(y), Number(m) - 1, Number(d))
    .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function AgreementsTab({ projectId }) {
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  const [filterSource, setFilterSource] = useState("all");
  const [filterPerson, setFilterPerson] = useState("all");
  const [filterKeyword, setFilterKeyword] = useState("");

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newText, setNewText] = useState("");
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [newConfirmedBy, setNewConfirmedBy] = useState("");
  const [newOthers, setNewOthers] = useState("");
  const [saving, setSaving] = useState(false);

  const [showExtractInput, setShowExtractInput] = useState(false);
  const [extractText, setExtractText] = useState("");
  const [extractLabel, setExtractLabel] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [showReview, setShowReview] = useState(false);

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    try {
      const { agreements: data } = await api(`/api/projects/${projectId}/agreements`);
      setAgreements(data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function ask() {
    if (!question.trim() || asking) return;
    setAsking(true); setAnswer(null);
    try {
      const { answer: a } = await api(`/api/projects/${projectId}/agreements/ask`, {
        method: "POST", body: { question: question.trim() },
      });
      setAnswer(a);
    } catch (e) { setAnswer("Error: " + e.message); }
    setAsking(false);
  }

  async function addManual() {
    if (!newText.trim() || !newDate || saving) return;
    setSaving(true);
    try {
      await api(`/api/projects/${projectId}/agreements`, {
        method: "POST",
        body: { current_text: newText.trim(), date_agreed: newDate, confirmed_by: newConfirmedBy.trim(), others_present: newOthers.trim(), source_type: "manual" },
      });
      setNewText(""); setNewDate(new Date().toISOString().slice(0, 10)); setNewConfirmedBy(""); setNewOthers(""); setShowAddForm(false);
      await load();
    } catch (e) { console.error(e); }
    setSaving(false);
  }

  async function extract() {
    if (!extractText.trim() || extracting) return;
    setExtracting(true);
    try {
      const { candidates: c } = await api(`/api/projects/${projectId}/agreements/extract`, {
        method: "POST",
        body: { text: extractText.trim(), source_label: extractLabel.trim() || "Minutes", source_type: "minutes" },
      });
      if ((c || []).length > 0) {
        setCandidates(c); setShowReview(true); setShowExtractInput(false); setExtractText(""); setExtractLabel("");
      } else {
        alert("No agreements found in this text — try pasting more of the minutes.");
      }
    } catch (e) { console.error(e); }
    setExtracting(false);
  }

  async function deleteAgreement(id) {
    if (!window.confirm("Delete this agreement and all its history?")) return;
    try {
      await api(`/api/projects/${projectId}/agreements/${id}`, { method: "DELETE" });
      setAgreements(prev => prev.filter(a => a.id !== id));
    } catch (e) { console.error(e); }
  }

  const people = [...new Set(agreements.map(a => a.confirmed_by).filter(Boolean))].sort();

  const filtered = agreements.filter(a => {
    if (filterSource !== "all" && a.source_type !== filterSource) return false;
    if (filterPerson !== "all" && a.confirmed_by !== filterPerson) return false;
    if (filterKeyword.trim() && !a.current_text.toLowerCase().includes(filterKeyword.toLowerCase())) return false;
    return true;
  });

  const selectStyle = { border: "1px solid #e4e4e8", borderRadius: 4, padding: "5px 10px", fontSize: 11, color: "#6a5a48", background: "#fff", fontFamily: "Inter, Arial, sans-serif" };
  const inputStyle = { border: "1px solid #e4e4e8", borderRadius: 4, padding: "5px 10px", fontSize: 11, color: "#3a3632", background: "#fff", fontFamily: "Inter, Arial, sans-serif", outline: "none" };

  if (loading) return <div style={{ display: "flex", alignItems: "center", gap: 8, color: DESIGN_MUTED, fontSize: 13, padding: 24 }}><Spinner size={13} /> Loading agreements…</div>;

  return (
    <div style={{ fontFamily: "Inter, Arial, sans-serif" }}>

      {/* Q&A bar */}
      <div style={{ background: PROJECTS_FULL, padding: "12px 20px", display: "flex", alignItems: "center", gap: 10, marginBottom: 0 }}>
        <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", flexShrink: 0 }}>Ask</span>
        <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === "Enter" && ask()}
          placeholder="Ask anything about agreements on this project…"
          style={{ flex: 1, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 4, padding: "7px 12px", color: "#fff", fontSize: 12, outline: "none", fontFamily: "Inter, Arial, sans-serif" }} />
        <button onClick={ask} disabled={!question.trim() || asking}
          style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", padding: "6px 16px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: question.trim() && !asking ? "pointer" : "default", flexShrink: 0 }}>
          {asking ? <Spinner size={11} /> : "Ask"}
        </button>
        {answer && <button onClick={() => { setAnswer(null); setQuestion(""); }} style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.8)", padding: "6px 12px", borderRadius: 4, fontSize: 11, cursor: "pointer", flexShrink: 0 }}>Clear</button>}
      </div>

      {/* Inline answer */}
      {answer && (
        <div style={{ background: "#f0f7f4", border: "1px solid #c8e6d4", borderTop: "none", padding: "14px 20px" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: PROJECTS_FULL, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Answer</div>
          <div style={{ fontSize: 13, color: "#3a3632", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{answer}</div>
        </div>
      )}

      {/* Filter bar */}
      <div style={{ background: "#f8f8fa", borderBottom: "1px solid #e4e4e8", padding: "10px 20px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: DESIGN_MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginRight: 4 }}>Filter</span>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)} style={selectStyle}>
          <option value="all">All sources</option>
          <option value="minutes">Minutes</option>
          <option value="email">Email</option>
          <option value="manual">Manual</option>
        </select>
        <select value={filterPerson} onChange={e => setFilterPerson(e.target.value)} style={selectStyle}>
          <option value="all">All people</option>
          {people.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <input value={filterKeyword} onChange={e => setFilterKeyword(e.target.value)} placeholder="Keyword…" style={{ ...inputStyle, width: 130 }} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={() => { setShowExtractInput(v => !v); setShowAddForm(false); }}
            style={{ background: PROJECTS_FULL, color: "#fff", border: "none", padding: "5px 14px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            ✎ Review Minutes
          </button>
          <button onClick={() => { setShowAddForm(v => !v); setShowExtractInput(false); }}
            style={{ background: "#f0ede8", color: "#6a5a48", border: "1px solid #e4e4e8", padding: "5px 14px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            + Add Agreement
          </button>
        </div>
      </div>

      {/* Extract input panel */}
      {showExtractInput && (
        <div style={{ background: "#fff", border: "1px solid #e4e4e8", borderTop: "none", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: "#6a5a48", fontWeight: 500 }}>Paste meeting minutes or email text below. The AI will extract agreements for you to review.</div>
          <input value={extractLabel} onChange={e => setExtractLabel(e.target.value)} placeholder="Source name (e.g. Design Team Meeting 14 May 2026)" style={{ ...inputStyle, width: "100%" }} />
          <textarea value={extractText} onChange={e => setExtractText(e.target.value)} placeholder="Paste minutes or email text here…"
            style={{ ...inputStyle, width: "100%", minHeight: 120, resize: "vertical", padding: "8px 12px", fontSize: 12 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={extract} disabled={!extractText.trim() || extracting}
              style={{ background: extractText.trim() ? PROJECTS_FULL : "#f8f8fa", color: extractText.trim() ? "#fff" : DESIGN_MUTED, border: "none", padding: "7px 18px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: extractText.trim() ? "pointer" : "default" }}>
              {extracting ? <><Spinner size={11} /> Extracting…</> : "Extract Agreements"}
            </button>
            <button onClick={() => setShowExtractInput(false)} style={{ background: "#f0ede8", color: "#6a5a48", border: "1px solid #e4e4e8", padding: "7px 14px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Manual add form */}
      {showAddForm && (
        <div style={{ background: "#fff", border: "1px solid #e4e4e8", borderTop: "none", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: "#6a5a48", fontWeight: 500 }}>Add an agreement manually</div>
          <textarea value={newText} onChange={e => setNewText(e.target.value)} placeholder="Agreement text…"
            style={{ ...inputStyle, width: "100%", minHeight: 72, resize: "vertical", padding: "8px 12px", fontSize: 12 }} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} style={{ ...inputStyle, width: 160 }} />
            <input value={newConfirmedBy} onChange={e => setNewConfirmedBy(e.target.value)} placeholder="Confirmed by…" style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
            <input value={newOthers} onChange={e => setNewOthers(e.target.value)} placeholder="Others present (comma-separated)…" style={{ ...inputStyle, flex: 2, minWidth: 180 }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={addManual} disabled={!newText.trim() || !newDate || saving}
              style={{ background: newText.trim() ? PROJECTS_FULL : "#f8f8fa", color: newText.trim() ? "#fff" : DESIGN_MUTED, border: "none", padding: "7px 18px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: newText.trim() ? "pointer" : "default" }}>
              {saving ? <Spinner size={11} /> : "Save Agreement"}
            </button>
            <button onClick={() => setShowAddForm(false)} style={{ background: "#f0ede8", color: "#6a5a48", border: "1px solid #e4e4e8", padding: "7px 14px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Agreement cards */}
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.length === 0 && (
          <div style={{ color: DESIGN_MUTED, fontSize: 13, padding: "24px 0", textAlign: "center" }}>
            {agreements.length === 0 ? "No agreements recorded yet. Use \"Review Minutes\" to extract from minutes or \"+ Add Agreement\" to add one manually." : "No agreements match the current filters."}
          </div>
        )}
        {filtered.map(a => {
          const isExpanded = expandedId === a.id;
          const sourceBadgeStyle = { padding: "1px 7px", borderRadius: 10, fontWeight: 600, fontSize: 10 };
          const sourceBadge = a.source_type === "minutes"
            ? <span style={{ ...sourceBadgeStyle, background: "#e8f0f8", color: "#2a6496" }}>📝 Minutes</span>
            : a.source_type === "email"
            ? <span style={{ ...sourceBadgeStyle, background: "#fef3e8", color: "#a06020" }}>📧 Email</span>
            : <span style={{ ...sourceBadgeStyle, background: "#f0ede8", color: "#6a5a48" }}>✎ Manual</span>;
          return (
            <div key={a.id} style={{ border: "1px solid #e4e4e8", borderRadius: 5, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <div style={{ background: "#fff", padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: DESIGN_TEXT, marginBottom: 5, fontSize: 13 }}>{a.current_text}</div>
                    <div style={{ fontSize: 11, color: DESIGN_MUTED, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                      <span>📅 {formatDateStr(a.date_agreed)}</span>
                      {a.confirmed_by && <span>👤 {a.confirmed_by}</span>}
                      {a.others_present && <span>👥 {a.others_present}</span>}
                      {sourceBadge}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                    {a.source_type !== "manual" && (
                      <button disabled={a.source_type === "minutes"}
                        style={{ fontSize: 11, color: a.source_type === "minutes" ? "#b0a8a0" : "#2a6496", background: "none", border: `1px solid ${a.source_type === "minutes" ? "#e4e4e8" : "#b8d0e8"}`, padding: "3px 10px", borderRadius: 3, cursor: a.source_type === "minutes" ? "not-allowed" : "pointer", fontWeight: 500 }}>
                        Open source
                      </button>
                    )}
                    <button onClick={() => setExpandedId(isExpanded ? null : a.id)}
                      style={{ background: "none", border: "none", color: DESIGN_MUTED, fontSize: 16, cursor: "pointer", padding: "0 4px" }}>
                      {isExpanded ? "▲" : "▼"}
                    </button>
                    <button onClick={() => deleteAgreement(a.id)}
                      style={{ background: "none", border: "none", color: "#c0a8a0", fontSize: 13, cursor: "pointer", padding: "0 4px" }}>✕</button>
                  </div>
                </div>
              </div>
              {isExpanded && a.entries && a.entries.length > 1 && (
                <div style={{ background: "#f8f8fa", borderTop: "1px solid #e4e4e8", padding: "10px 16px 10px 32px" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: DESIGN_MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Update history</div>
                  <div style={{ borderLeft: "2px solid #e4e4e8", paddingLeft: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                    {a.entries.slice(0, -1).reverse().map((e, i) => (
                      <div key={e.id || i}>
                        <div style={{ fontSize: 11, color: "#6a5a48" }}>"{e.text}"</div>
                        <div style={{ fontSize: 10, color: "#b0a8a0", marginTop: 2 }}>{formatDateStr(e.date_agreed)} · {e.confirmed_by || "unknown"}{e.source_label ? ` · ${e.source_label}` : ""}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {isExpanded && (!a.entries || a.entries.length <= 1) && (
                <div style={{ background: "#f8f8fa", borderTop: "1px solid #e4e4e8", padding: "10px 16px 10px 32px" }}>
                  <div style={{ fontSize: 11, color: "#b0a8a0" }}>No update history — this is the original agreement.</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showReview && (
        <AgreementsReviewModal
          projectId={projectId}
          candidates={candidates}
          sourceLabel={extractLabel || "Minutes"}
          sourceType="minutes"
          onSave={async () => { setShowReview(false); setCandidates([]); await load(); }}
          onClose={() => { setShowReview(false); setCandidates([]); }}
        />
      )}
    </div>
  );
}
