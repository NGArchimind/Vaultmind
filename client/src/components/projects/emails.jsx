import { useState, useEffect } from "react";
import { api } from "../../api/client";
import { DESIGN_TEXT, COMPARE_FULL, PROJECTS_FULL } from "../../constants";
import { Spinner } from "../common/Spinner";

// ── Emails tab ────────────────────────────────────────────────────────────────
export default function EmailsTab({ projectId }) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [emails, setEmails] = useState([]);
  const [totalEmails, setTotalEmails] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingEmails, setLoadingEmails] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selectedEmail, setSelectedEmail] = useState(null);
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [emailBody, setEmailBody] = useState(null);

  // Q&A mode
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [qaMode, setQaMode] = useState(false);
  const [aiSummary, setAiSummary] = useState(null);
  const [supportingEmailIds, setSupportingEmailIds] = useState([]);
  const [qaMessage, setQaMessage] = useState(null);
  const [qaError, setQaError] = useState(null);

  // Filters
  const [filterFrom, setFilterFrom] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterSubject, setFilterSubject] = useState("");
  const [filterHasAttachments, setFilterHasAttachments] = useState("");
  const [filterEmailType, setFilterEmailType] = useState("");

  // Admin
  const [reembedding, setReembedding] = useState(false);
  const [reembedResult, setReembedResult] = useState(null);

  const PAGE_SIZE = 50;

  function buildFilterParams() {
    const p = {};
    if (filterFrom.trim()) p.from = filterFrom.trim();
    if (filterDateFrom) p.date_from = filterDateFrom;
    if (filterDateTo) p.date_to = filterDateTo;
    if (filterSubject.trim()) p.subject = filterSubject.trim();
    if (filterHasAttachments === "yes") p.has_attachments = "true";
    if (filterEmailType) p.email_type = filterEmailType;
    return p;
  }

  async function loadEmails(pageNum, append = false) {
    if (append) setLoadingMore(true);
    else setLoadingEmails(true);
    try {
      const params = new URLSearchParams({ page: pageNum, limit: PAGE_SIZE, ...buildFilterParams() });
      const data = await api(`/api/projects/${projectId}/emails?${params}`);
      if (append) {
        setEmails(prev => [...prev, ...(data.emails || [])]);
      } else {
        setEmails(data.emails || []);
      }
      setTotalEmails(data.total || 0);
      setPage(pageNum);
    } catch (err) {
      console.error("loadEmails error:", err);
    } finally {
      setLoadingEmails(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    loadEmails(1);
  }, [projectId]); // eslint-disable-line

  useEffect(() => {
    if (!qaMode) loadEmails(1);
  }, [filterFrom, filterDateFrom, filterDateTo, filterSubject, filterHasAttachments, filterEmailType]); // eslint-disable-line

  async function handleAsk() {
    if (!question.trim()) return;
    setAsking(true);
    setQaMode(false);
    setAiSummary(null);
    setSupportingEmailIds([]);
    setQaMessage(null);
    setQaError(null);
    setSelectedEmail(null);
    setEmailBody(null);
    try {
      const filters = {};
      if (filterFrom.trim()) filters.from = filterFrom.trim();
      if (filterDateFrom) filters.date_from = filterDateFrom;
      if (filterDateTo) filters.date_to = filterDateTo;
      if (filterSubject.trim()) filters.subject = filterSubject.trim();
      if (filterHasAttachments === "yes") filters.has_attachments = true;
      if (filterEmailType) filters.email_type = filterEmailType;

      const result = await api(`/api/projects/${projectId}/emails/ask`, {
        method: "POST",
        body: { question: question.trim(), filters, limit: 20 },
      });

      if (result.message && (!result.supportingEmailIds || result.supportingEmailIds.length === 0)) {
        setQaMessage(result.message);
        setQaMode(true);
        return;
      }

      const supportIds = new Set(result.supportingEmailIds || []);
      const params = new URLSearchParams({ page: 1, limit: 100 });
      const allData = await api(`/api/projects/${projectId}/emails?${params}`);
      const supportEmails = (allData.emails || []).filter(e => supportIds.has(e.id));

      setEmails(supportEmails);
      setAiSummary(result.summary);
      setSupportingEmailIds(result.supportingEmailIds || []);
      setQaMode(true);
    } catch (err) {
      setQaError(err.message);
    } finally {
      setAsking(false);
    }
  }

  function handleClearResults() {
    setQaMode(false);
    setAiSummary(null);
    setSupportingEmailIds([]);
    setQaMessage(null);
    setQaError(null);
    setQuestion("");
    setSelectedEmail(null);
    setEmailBody(null);
    loadEmails(1);
  }

  function clearFilters() {
    setFilterFrom("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterSubject("");
    setFilterHasAttachments("");
    setFilterEmailType("");
  }

  async function handleSelectEmail(email) {
    setSelectedEmail(email);
    setEmailBody(null);
    setLoadingEmail(true);
    try {
      const { email: full } = await api(`/api/projects/${projectId}/emails/${email.id}`);
      setEmailBody(full);
    } catch (err) {
      setEmailBody({ error: err.message });
    } finally {
      setLoadingEmail(false);
    }
  }

  async function handleDeleteEmail(id) {
    if (!window.confirm("Delete this email from the project? This cannot be undone.")) return;
    try {
      await api(`/api/projects/${projectId}/emails/${id}`, { method: "DELETE" });
      setEmails(prev => prev.filter(e => e.id !== id));
      setTotalEmails(prev => Math.max(0, prev - 1));
      if (selectedEmail?.id === id) {
        setSelectedEmail(null);
        setEmailBody(null);
      }
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  async function handleDeleteAll() {
    if (!window.confirm(`Delete all emails from this project? This cannot be undone.`)) return;
    try {
      await api(`/api/projects/${projectId}/emails`, { method: "DELETE" });
      setEmails([]);
      setTotalEmails(0);
      setSelectedEmail(null);
      setEmailBody(null);
      setQaMode(false);
      setAiSummary(null);
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  async function handleReembed() {
    setReembedding(true);
    setReembedResult(null);
    try {
      const result = await api(`/api/projects/${projectId}/emails/reembed`, { method: "POST", body: {} });
      setReembedResult(`Done — ${result.updated} of ${result.total} emails re-indexed${result.errors.length ? `, ${result.errors.length} failed` : ""}.`);
    } catch (err) {
      setReembedResult(`Error: ${err.message}`);
    } finally {
      setReembedding(false);
    }
  }

  const hasActiveFilters = filterFrom || filterDateFrom || filterDateTo || filterSubject || filterHasAttachments || filterEmailType;
  const emailTypeOptions = ["confirmation","query","instruction","information","objection","other"];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>

      {/* ── Question input bar ── */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #e8e2d9", background: "#f8f8fa", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: PROJECTS_FULL, textTransform: "uppercase", whiteSpace: "nowrap" }}>✦ Ask</span>
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAsk()}
            placeholder="Ask a question about your emails…"
            style={{ flex: 1, border: "1px solid #e4e4e8", padding: "7px 10px", fontSize: 12, color: DESIGN_TEXT, outline: "none", background: "#fff", fontFamily: "Inter, Arial, sans-serif" }}
          />
          <button
            onClick={handleAsk}
            disabled={asking || !question.trim()}
            style={{ background: asking ? "#999" : PROJECTS_FULL, color: "#fff", border: "none", padding: "8px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", cursor: asking ? "default" : "pointer", whiteSpace: "nowrap" }}
          >
            {asking ? "Asking…" : "Ask"}
          </button>
          {qaMode && (
            <button
              onClick={handleClearResults}
              style={{ background: "transparent", border: "1px solid #e4e4e8", padding: "7px 12px", fontSize: 11, color: "#666", cursor: "pointer" }}
            >
              Clear
            </button>
          )}
        </div>

        {/* ── Filter row ── */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input value={filterFrom} onChange={e => setFilterFrom(e.target.value)} placeholder="From…" style={{ border: "1px solid #e4e4e8", padding: "4px 8px", fontSize: 11, width: 120, color: DESIGN_TEXT, fontFamily: "Inter, Arial, sans-serif", outline: "none" }} />
          <input value={filterSubject} onChange={e => setFilterSubject(e.target.value)} placeholder="Subject…" style={{ border: "1px solid #e4e4e8", padding: "4px 8px", fontSize: 11, width: 140, color: DESIGN_TEXT, fontFamily: "Inter, Arial, sans-serif", outline: "none" }} />
          <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} style={{ border: "1px solid #e4e4e8", padding: "4px 8px", fontSize: 11, color: DESIGN_TEXT }} />
          <span style={{ fontSize: 10, color: "#999" }}>to</span>
          <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} style={{ border: "1px solid #e4e4e8", padding: "4px 8px", fontSize: 11, color: DESIGN_TEXT }} />
          <select value={filterHasAttachments} onChange={e => setFilterHasAttachments(e.target.value)} style={{ border: "1px solid #e4e4e8", padding: "4px 8px", fontSize: 11, color: DESIGN_TEXT }}>
            <option value="">Attachments: any</option>
            <option value="yes">Has attachments</option>
          </select>
          <select value={filterEmailType} onChange={e => setFilterEmailType(e.target.value)} style={{ border: "1px solid #e4e4e8", padding: "4px 8px", fontSize: 11, color: DESIGN_TEXT }}>
            <option value="">Type: any</option>
            {emailTypeOptions.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
          {hasActiveFilters && (
            <button onClick={clearFilters} style={{ background: "transparent", border: "none", fontSize: 11, color: PROJECTS_FULL, cursor: "pointer", padding: "4px 6px" }}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* ── Main body: list + preview pane ── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>

        {/* ── Left: summary + email list ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid #e8e2d9" }}>

          {/* Q&A summary */}
          {qaMode && aiSummary && (
            <div style={{ padding: "12px 16px", background: "#f0f7f9", borderBottom: "1px solid #c5dde4", flexShrink: 0 }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: PROJECTS_FULL, textTransform: "uppercase", marginBottom: 4 }}>AI Summary</div>
              <p style={{ margin: 0, fontSize: 12, color: DESIGN_TEXT, lineHeight: 1.6 }}>{aiSummary}</p>
            </div>
          )}
          {qaMode && qaMessage && !aiSummary && (
            <div style={{ padding: "12px 16px", background: "#fff8f0", borderBottom: "1px solid #e8d8c0", flexShrink: 0 }}>
              <p style={{ margin: 0, fontSize: 12, color: "#8a6040" }}>{qaMessage}</p>
            </div>
          )}
          {qaError && (
            <div style={{ padding: "12px 16px", background: "#fff0f0", borderBottom: "1px solid #e8c0c0", flexShrink: 0 }}>
              <p style={{ margin: 0, fontSize: 12, color: "#c04040" }}>Error: {qaError}</p>
            </div>
          )}

          {/* Email count row */}
          <div style={{ padding: "6px 16px", fontSize: 10, color: "#999", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid #eee", background: "#f8f8fa", flexShrink: 0 }}>
            {qaMode
              ? `${emails.length} supporting email${emails.length !== 1 ? "s" : ""}`
              : loadingEmails ? "Loading…" : `${totalEmails.toLocaleString()} email${totalEmails !== 1 ? "s" : ""}`}
          </div>

          {/* Email list */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loadingEmails ? (
              <div style={{ padding: 24, textAlign: "center", color: "#999", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Spinner size={12} /> Loading emails…
              </div>
            ) : emails.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "#999", fontSize: 12 }}>No emails found.</div>
            ) : (
              <>
                {emails.map(email => (
                  <EmailRow
                    key={email.id}
                    email={email}
                    selected={selectedEmail?.id === email.id}
                    onClick={() => handleSelectEmail(email)}
                    onDelete={() => handleDeleteEmail(email.id)}
                  />
                ))}
                {!qaMode && emails.length < totalEmails && (
                  <div style={{ padding: "12px 16px", textAlign: "center" }}>
                    <button
                      onClick={() => loadEmails(page + 1, true)}
                      disabled={loadingMore}
                      style={{ background: "transparent", border: "1px solid #e4e4e8", padding: "6px 16px", fontSize: 11, color: PROJECTS_FULL, cursor: "pointer" }}
                    >
                      {loadingMore ? "Loading…" : `Load more (${totalEmails - emails.length} remaining)`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Right: preview pane ── */}
        <div style={{ width: 380, flexShrink: 0, overflowY: "auto", background: "#fff" }}>
          {selectedEmail ? (
            <EmailPreview
              email={selectedEmail}
              body={emailBody}
              loading={loadingEmail}
            />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#bbb", fontSize: 12 }}>
              Select an email to preview it
            </div>
          )}
        </div>

      </div>

      {/* ── Re-embed admin row ── */}
      <div style={{ padding: "8px 16px", borderTop: "1px solid #e8e2d9", background: "#f8f8fa", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button
          onClick={handleReembed}
          disabled={reembedding}
          style={{ background: "transparent", border: "1px solid #e4e4e8", padding: "4px 12px", fontSize: 10, color: "#888", cursor: reembedding ? "default" : "pointer", textTransform: "uppercase", letterSpacing: "0.06em" }}
        >
          {reembedding ? "Re-indexing…" : "Re-index emails"}
        </button>
        {reembedResult && <span style={{ fontSize: 11, color: "#888" }}>{reembedResult}</span>}
        <button
          onClick={handleDeleteAll}
          style={{ marginLeft: "auto", background: "transparent", border: "none", fontSize: 10, color: "#c04040", cursor: "pointer" }}
        >
          Delete all emails
        </button>
      </div>

    </div>
  );
}

function EmailRow({ email, selected, onClick, onDelete }) {
  const [hovered, setHovered] = useState(false);
  const typeColors = {
    confirmation: PROJECTS_FULL, query: "#8a6040", instruction: "#5a4080",
    information: "#4a6040", objection: COMPARE_FULL, other: "#888",
  };
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "10px 16px",
        borderBottom: "1px solid #eee",
        cursor: "pointer",
        background: selected ? "#e8f4f7" : hovered ? "#f8f8fa" : "#fff",
        borderLeft: selected ? `3px solid ${PROJECTS_FULL}` : "3px solid transparent",
        transition: "background 0.1s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 2 }}>
        <span style={{ fontWeight: 600, fontSize: 12, color: DESIGN_TEXT }}>{email.from_name || email.from_address || "Unknown"}</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          {email.email_type && (
            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: typeColors[email.email_type] || "#888", border: `1px solid ${typeColors[email.email_type] || "#888"}`, padding: "1px 5px", borderRadius: 2 }}>
              {email.email_type}
            </span>
          )}
          {email.has_attachments && <span style={{ fontSize: 10, color: "#888" }} title="Has attachments">📎</span>}
          <span style={{ fontSize: 10, color: "#999" }}>{email.sent_at ? new Date(email.sent_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}</span>
          {hovered && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(); }}
              style={{ background: "transparent", border: "none", fontSize: 12, color: COMPARE_FULL, cursor: "pointer", padding: "0 2px", fontWeight: 700 }}
              title="Delete email"
            >×</button>
          )}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#555", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email.subject || "(no subject)"}</div>
      <div style={{ fontSize: 10, color: "#999" }}>{email.from_address || ""}</div>
    </div>
  );
}

function EmailPreview({ email, body, loading }) {
  const metaStyle = { fontSize: 11, color: "#9a9088", marginBottom: 4, lineHeight: 1.8 };
  const metaLabelStyle = { fontWeight: 600, color: DESIGN_TEXT, marginRight: 6, display: "inline-block", width: 32 };
  const sentDate = email.sent_at ? new Date(email.sent_at).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  }) : "—";

  return (
    <div style={{ padding: 16, height: "100%", boxSizing: "border-box" }}>
      <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #eee" }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: DESIGN_TEXT, marginBottom: 8 }}>{email.subject || "(no subject)"}</div>
        <div style={metaStyle}><span style={metaLabelStyle}>From</span>{email.from_name ? `${email.from_name} <${email.from_address}>` : email.from_address}</div>
        {(email.to_addresses || []).length > 0 && (
          <div style={metaStyle}><span style={metaLabelStyle}>To</span>{email.to_addresses.join(", ")}</div>
        )}
        {(email.cc_addresses || []).length > 0 && (
          <div style={metaStyle}><span style={metaLabelStyle}>CC</span>{email.cc_addresses.join(", ")}</div>
        )}
        <div style={metaStyle}><span style={metaLabelStyle}>Date</span>{sentDate}</div>
      </div>
      {loading ? (
        <div style={{ color: "#999", fontSize: 12 }}>Loading…</div>
      ) : body?.error ? (
        <div style={{ color: "#c04040", fontSize: 12 }}>Could not load email body.</div>
      ) : body?.body_text ? (
        <pre style={{ fontSize: 11, color: "#444", whiteSpace: "pre-wrap", fontFamily: "Inter, Arial, sans-serif", lineHeight: 1.7, margin: 0 }}>
          {body.body_text}
        </pre>
      ) : (
        <div style={{ color: "#999", fontSize: 12 }}>No body content.</div>
      )}
    </div>
  );
}

