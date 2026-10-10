import { useState, useEffect, useCallback } from "react";
import { api } from "../../../api/client";
import { DESIGN_TEXT, DESIGN_MUTED, DESIGN_GOLD, PROJECTS_FULL } from "../../../constants";
import { Spinner } from "../../common/Spinner";
import { showToast } from "../toast";
import MapItemRow from "./MapItemRow";
import MapSourceModal from "./MapSourceModal";
import { pendingEntries, itemMatchesSearch, sortItems } from "./mapHelpers";

const POLL_MS = 5000;
const RECENT_COUNT = 8;

const sectionLabel = { fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: DESIGN_MUTED, margin: "20px 0 8px" };
const linkBtn = { background: "none", border: "none", padding: 0, fontSize: 12, color: PROJECTS_FULL, cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" };
const outlineBtn = { background: "transparent", border: "1px solid #e4e4e8", padding: "5px 12px", fontSize: 11, color: "#666", cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" };

// ── Project Map tab ───────────────────────────────────────────────────────────
// Overview tiles → category list → items that drop open to show their history.
export default function ProjectMapTab({ projectId, isAdmin }) {
  const [map, setMap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [view, setView] = useState({ type: "overview" }); // overview | category | review
  const [search, setSearch] = useState("");
  const [source, setSource] = useState(null);
  const [starting, setStarting] = useState(false);

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    try {
      setMap(await api(`/api/projects/${projectId}/map`));
      setLoadError(null);
    } catch (e) {
      console.error(e);
      setLoadError(e.message);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    setLoading(true); setMap(null); setView({ type: "overview" }); setResult(null); setSearch("");
    load();
  }, [load]);

  // While emails are being read in the background, keep the page up to date.
  useEffect(() => {
    if (!map?.running) return;
    const timer = setTimeout(load, POLL_MS);
    return () => clearTimeout(timer);
  }, [map, load]);

  async function startRun(retryFailed) {
    setStarting(true);
    try {
      await api(`/api/projects/${projectId}/map/process`, { method: "POST", body: { retryFailed } });
      await load();
    } catch (e) {
      showToast(`Could not start: ${e.message}`);
    }
    setStarting(false);
  }

  async function ask() {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true); setResult(null);
    try {
      const mapAnswer = await api(`/api/projects/${projectId}/map/ask`, { method: "POST", body: { question: q } });
      if (mapAnswer.found) {
        setResult({ kind: "map", answer: mapAnswer.answer, itemIds: mapAnswer.itemIds });
      } else {
        // Nothing in the map — fall back to searching the stored emails directly.
        const emailAnswer = await api(`/api/projects/${projectId}/emails/ask`, { method: "POST", body: { question: q, filters: {}, limit: 20 } });
        const ids = emailAnswer.supportingEmailIds || [];
        const fetched = await Promise.allSettled(ids.map(id => api(`/api/projects/${projectId}/emails/${id}`)));
        setResult({
          kind: "emails",
          answer: emailAnswer.summary || "Nothing relevant was found in the map or in the stored emails.",
          emails: fetched.filter(r => r.status === "fulfilled").map(r => r.value.email),
        });
      }
    } catch (e) {
      setResult({ kind: "error", answer: e.message });
    }
    setAsking(false);
  }

  if (loading) return <div style={{ display: "flex", alignItems: "center", gap: 8, color: DESIGN_MUTED, fontSize: 13, padding: 24 }}><Spinner size={13} /> Loading project map…</div>;
  if (!map) return <div style={{ color: DESIGN_MUTED, fontSize: 13, padding: 24 }}>The project map could not be loaded{loadError ? `: ${loadError}` : "."}</div>;

  const { categories, items } = map;
  const pendingItems = items.filter(it => pendingEntries(it).length > 0);
  const pendingCount = pendingItems.reduce((n, it) => n + pendingEntries(it).length, 0);
  const searching = search.trim().length > 0;

  const rows = (list, { showCategory = false, defaultOpen = false } = {}) => list.map(item => (
    <MapItemRow
      key={item.id}
      projectId={projectId}
      item={item}
      categories={categories}
      mergeTargets={items.filter(t => t.category === item.category && t.id !== item.id)}
      isAdmin={isAdmin}
      showCategory={showCategory}
      defaultOpen={defaultOpen}
      onChanged={load}
      onOpenSource={setSource}
    />
  ));

  const empty = text => <div style={{ color: DESIGN_MUTED, fontSize: 12, padding: "12px 0" }}>{text}</div>;
  const crumb = label => (
    <div style={{ fontSize: 12, color: DESIGN_MUTED, margin: "16px 0 10px" }}>
      <button onClick={() => setView({ type: "overview" })} style={linkBtn}>Project Map</button> › <span style={{ color: DESIGN_TEXT, fontWeight: 600 }}>{label}</span>
    </div>
  );

  let body;
  if (searching) {
    const found = sortItems(items.filter(it => itemMatchesSearch(it, search)));
    body = <>
      <div style={sectionLabel}>{found.length} result{found.length !== 1 ? "s" : ""} for “{search.trim()}”</div>
      {found.length ? rows(found, { showCategory: true }) : empty("Nothing in the map matches. Try the Ask bar — it also searches the stored emails.")}
    </>;
  } else if (view.type === "category") {
    const category = categories.find(c => c.id === view.id);
    const list = sortItems(items.filter(it => it.category === view.id));
    body = <>
      {crumb(`${category?.label} (${list.length})`)}
      {list.length ? rows(list) : empty("Nothing recorded in this category yet.")}
    </>;
  } else if (view.type === "review") {
    body = <>
      {crumb(`Awaiting sign-off (${pendingCount})`)}
      {pendingItems.length ? rows(sortItems(pendingItems), { showCategory: true, defaultOpen: true }) : empty("Nothing is waiting for sign-off.")}
    </>;
  } else {
    const recent = [...items].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, RECENT_COUNT);
    body = <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10, marginTop: 16 }}>
        {categories.map(c => {
          const inCategory = items.filter(it => it.category === c.id);
          const pendingHere = inCategory.filter(it => pendingEntries(it).length > 0).length;
          return (
            <button key={c.id} onClick={() => setView({ type: "category", id: c.id })}
              style={{ background: "#fff", border: `1px solid ${pendingHere ? DESIGN_GOLD : "#e4e4e8"}`, borderTop: `3px solid ${PROJECTS_FULL}`, padding: "14px 14px 12px", textAlign: "left", cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: DESIGN_TEXT, marginBottom: 6 }}>{c.label}</div>
              <div style={{ fontSize: 11, color: DESIGN_MUTED }}>
                {inCategory.length} item{inCategory.length !== 1 ? "s" : ""}
                {pendingHere > 0 && <span style={{ color: "#8a6d1c", fontWeight: 600 }}> · {pendingHere} pending</span>}
              </div>
            </button>
          );
        })}
      </div>
      <div style={sectionLabel}>Recently updated</div>
      {recent.length ? rows(recent, { showCategory: true }) : empty(
        map.unreadEmails > 0 || map.running
          ? "The map is empty until the synced emails have been read into it."
          : "The map is empty. Sync this project's emails with ArchiSync to start building it.")}
    </>;
  }

  return (
    <div style={{ fontFamily: "Inter, Arial, sans-serif" }}>

      {/* Ask bar */}
      <div style={{ background: PROJECTS_FULL, padding: "12px 20px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", flexShrink: 0 }}>Ask</span>
        <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === "Enter" && ask()}
          placeholder="Ask anything about this project…"
          style={{ flex: 1, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 4, padding: "7px 12px", color: "#fff", fontSize: 12, outline: "none", fontFamily: "Inter, Arial, sans-serif" }} />
        <button onClick={ask} disabled={!question.trim() || asking}
          style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", padding: "6px 16px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: question.trim() && !asking ? "pointer" : "default", flexShrink: 0 }}>
          {asking ? <Spinner size={11} /> : "Ask"}
        </button>
        {result && <button onClick={() => { setResult(null); setQuestion(""); }} style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.8)", padding: "6px 12px", borderRadius: 4, fontSize: 11, cursor: "pointer", flexShrink: 0 }}>Clear</button>}
      </div>

      {/* Answer */}
      {result && (
        <div style={{ background: "#f0f7f4", border: "1px solid #c8e6d4", borderTop: "none", padding: "14px 20px" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: PROJECTS_FULL, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            {result.kind === "map" ? "Answer from the project map" : result.kind === "emails" ? "Not in the map — searched the stored emails directly" : "Error"}
          </div>
          <div style={{ fontSize: 13, color: "#3a3632", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{result.answer}</div>
          {result.kind === "map" && (
            <div style={{ marginTop: 12 }}>
              <div style={{ ...sectionLabel, margin: "0 0 6px" }}>Based on — open an item to see its sources</div>
              {rows(items.filter(it => result.itemIds.includes(it.id)), { showCategory: true })}
            </div>
          )}
          {result.kind === "emails" && result.emails.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ ...sectionLabel, margin: "0 0 6px" }}>Emails searched — click to open</div>
              {result.emails.map(email => (
                <button key={email.id} onClick={() => setSource({ source_type: "email", source_id: email.id, source_label: email.subject, quote: "" })}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "#fff", border: "1px solid #e4e4e8", padding: "7px 12px", marginBottom: 4, cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: DESIGN_TEXT }}>{email.subject || "(no subject)"}</span>
                  <span style={{ fontSize: 11, color: DESIGN_MUTED }}> — {email.from_name || email.from_address || "Unknown"}{email.sent_at ? `, ${new Date(email.sent_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Search + build status */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search the map…"
          style={{ border: "1px solid #e4e4e8", padding: "7px 12px", fontSize: 12, color: DESIGN_TEXT, outline: "none", background: "#fff", fontFamily: "Inter, Arial, sans-serif", width: 260 }} />
        {searching && <button onClick={() => setSearch("")} style={linkBtn}>Clear search</button>}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: DESIGN_MUTED, flexWrap: "wrap" }}>
          {map.running ? (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Spinner size={11} /> Reading emails into the map… {map.unreadEmails} to go</span>
          ) : map.unreadEmails > 0 ? (
            <>
              <span>{map.unreadEmails} email{map.unreadEmails !== 1 ? "s" : ""} not yet read into the map</span>
              {isAdmin && <button disabled={starting} onClick={() => startRun(false)} style={outlineBtn}>{starting ? "Starting…" : "Update map"}</button>}
            </>
          ) : (
            <span>Map is up to date with the synced emails</span>
          )}
          {!map.running && map.failedEmails > 0 && (
            <>
              <span style={{ color: "#8a6d1c" }}>{map.failedEmails} email{map.failedEmails !== 1 ? "s" : ""} could not be read</span>
              {isAdmin && <button disabled={starting} onClick={() => startRun(true)} style={outlineBtn}>Retry</button>}
            </>
          )}
        </div>
      </div>

      {/* Sign-off banner */}
      {pendingCount > 0 && view.type !== "review" && !searching && (
        <div style={{ marginTop: 14, border: `1px solid ${DESIGN_GOLD}`, background: "#faf6ea", padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#8a6d1c", flex: 1 }}>
            {pendingCount} change{pendingCount !== 1 ? "s" : ""} awaiting sign-off
            {!isAdmin && <span style={{ fontWeight: 400 }}> — the current values stay in force until an admin decides</span>}
          </span>
          <button onClick={() => setView({ type: "review" })} style={{ ...outlineBtn, borderColor: DESIGN_GOLD, color: "#8a6d1c", fontWeight: 600 }}>{isAdmin ? "Review" : "View"}</button>
        </div>
      )}

      {body}

      {source && <MapSourceModal projectId={projectId} source={source} onClose={() => setSource(null)} />}
    </div>
  );
}
