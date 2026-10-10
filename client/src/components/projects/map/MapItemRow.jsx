import { useState } from "react";
import { api } from "../../../api/client";
import { DESIGN_TEXT, DESIGN_MUTED, DESIGN_GOLD, PROJECTS_FULL, COMPARE_FULL } from "../../../constants";
import { showToast } from "../toast";
import { formatMapDate, pendingEntries, sortedHistory } from "./mapHelpers";

const STATE_LABELS = {
  current: "Current",
  superseded: "Replaced",
  supporting: "Also stated",
  pending: "Change raised — awaiting sign-off",
  rejected: "Raised, not adopted",
};

const smallBtn = {
  background: "transparent", border: "1px solid #e4e4e8", padding: "4px 10px", fontSize: 11,
  color: "#666", cursor: "pointer", fontFamily: "Inter, Arial, sans-serif",
};
const inputStyle = {
  border: "1px solid #e4e4e8", padding: "6px 10px", fontSize: 12, color: DESIGN_TEXT,
  fontFamily: "Inter, Arial, sans-serif", outline: "none", width: "100%", boxSizing: "border-box",
};

// One map item: title + current value, dropping open to show its history tree.
// Admins also get sign-off buttons on pending changes and the edit tools.
export default function MapItemRow({ projectId, item, categories, mergeTargets, isAdmin, showCategory, defaultOpen, onChanged, onOpenSource }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: item.title, value: item.current_value, category: item.category });
  const [merging, setMerging] = useState(false);
  const [mergeInto, setMergeInto] = useState("");

  const pending = pendingEntries(item);
  const history = sortedHistory(item);
  const categoryLabel = (categories.find(c => c.id === item.category) || {}).label || item.category;

  async function run(action, failMessage) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await onChanged();
    } catch (e) {
      console.error(e);
      showToast(`${failMessage}: ${e.message}`);
    }
    setBusy(false);
  }

  const decide = (entry, decision) => run(
    () => api(`/api/projects/${projectId}/map/entries/${entry.id}/decide`, { method: "POST", body: { decision } }),
    "Could not save the decision");

  const confirmItem = () => run(
    () => api(`/api/projects/${projectId}/map/items/${item.id}`, { method: "PATCH", body: { status: "confirmed" } }),
    "Could not confirm");

  const saveEdit = () => {
    if (!form.title.trim() || !form.value.trim()) return;
    run(async () => {
      await api(`/api/projects/${projectId}/map/items/${item.id}`, {
        method: "PATCH", body: { title: form.title, value: form.value, category: form.category },
      });
      setEditing(false);
    }, "Could not save the edit");
  };

  const merge = () => {
    if (!mergeInto) return;
    const target = mergeTargets.find(t => t.id === mergeInto);
    if (!window.confirm(`Merge "${item.title}" into "${target?.title}"? Its history moves across and "${target?.title}" keeps its current value. This cannot be undone.`)) return;
    run(() => api(`/api/projects/${projectId}/map/items/${item.id}/merge`, { method: "POST", body: { into_item_id: mergeInto } }),
      "Could not merge");
  };

  const remove = () => {
    if (!window.confirm(`Delete "${item.title}" and all its history from the map? The source emails are not deleted. This cannot be undone.`)) return;
    run(() => api(`/api/projects/${projectId}/map/items/${item.id}`, { method: "DELETE" }), "Could not delete");
  };

  return (
    <div style={{ border: `1px solid ${pending.length ? DESIGN_GOLD : "#e4e4e8"}`, background: "#fff", marginBottom: 6, fontFamily: "Inter, Arial, sans-serif" }}>

      {/* Header row */}
      <div onClick={() => setOpen(o => !o)} style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: DESIGN_TEXT }}>{item.title}</span>
            {showCategory && <span style={{ fontSize: 10, color: DESIGN_MUTED, textTransform: "uppercase", letterSpacing: "0.06em" }}>{categoryLabel}</span>}
            {pending.length > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#fff", background: DESIGN_GOLD, padding: "1px 6px" }}>
                {pending.length > 1 ? `${pending.length} changes pending` : "Change pending"}
              </span>
            )}
            {item.status !== "confirmed" && (
              <span style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: DESIGN_MUTED, border: "1px solid #e4e4e8", padding: "0 6px" }}>Unconfirmed</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#444", lineHeight: 1.55, overflowWrap: "anywhere" }}>{item.current_value}</div>
        </div>
        <span style={{ fontSize: 11, color: PROJECTS_FULL, whiteSpace: "nowrap", flexShrink: 0, paddingTop: 2 }}>
          {open ? "▾" : "▸"} History ({history.length})
        </span>
      </div>

      {open && (
        <div style={{ padding: "0 14px 12px 14px" }}>

          {/* History tree */}
          <div style={{ borderLeft: "2px solid #e4e4e8", marginLeft: 4, paddingLeft: 14 }}>
            {history.map(entry => {
              const isPending = entry.state === "pending";
              const faded = entry.state === "superseded" || entry.state === "rejected";
              return (
                <div key={entry.id} style={{ padding: "8px 10px", marginBottom: 4, background: isPending ? "#faf6ea" : "transparent", border: isPending ? `1px solid ${DESIGN_GOLD}` : "1px solid transparent" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: isPending ? "#8a6d1c" : entry.state === "current" ? PROJECTS_FULL : DESIGN_MUTED, marginBottom: 2 }}>
                    {formatMapDate(entry.entry_date)} · {STATE_LABELS[entry.state] || entry.state}
                  </div>
                  <div style={{ fontSize: 12, color: faded ? DESIGN_MUTED : DESIGN_TEXT, lineHeight: 1.55, textDecoration: entry.state === "superseded" ? "line-through" : "none", overflowWrap: "anywhere" }}>
                    {entry.value}
                  </div>
                  <div style={{ fontSize: 11, color: DESIGN_MUTED, marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    {entry.stated_by && <span>{entry.stated_by}</span>}
                    <button onClick={() => onOpenSource(entry)} style={{ background: "none", border: "none", padding: 0, fontSize: 11, color: PROJECTS_FULL, textDecoration: "underline", cursor: "pointer", fontFamily: "Inter, Arial, sans-serif", textAlign: "left" }}>
                      {entry.source_type === "email" ? "Email" : entry.source_type === "manual" ? "Manual" : "Source"}: {entry.source_label || "open"}
                    </button>
                  </div>
                  {isPending && isAdmin && (
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      <button disabled={busy} onClick={() => decide(entry, "accept")} title="This becomes the current value" style={{ ...smallBtn, background: PROJECTS_FULL, borderColor: PROJECTS_FULL, color: "#fff", fontWeight: 600 }}>Accept change</button>
                      <button disabled={busy} onClick={() => decide(entry, "reject")} title="Keep the current value; this stays in the history as raised, not adopted" style={smallBtn}>Reject</button>
                      <button disabled={busy} onClick={() => decide(entry, "split")} title="This is about something else — make it its own item" style={smallBtn}>Different topic</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Admin tools */}
          {isAdmin && !editing && !merging && (
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              {item.status !== "confirmed" && <button disabled={busy} onClick={confirmItem} style={smallBtn}>Mark confirmed</button>}
              <button disabled={busy} onClick={() => { setForm({ title: item.title, value: item.current_value, category: item.category }); setEditing(true); }} style={smallBtn}>Edit</button>
              {mergeTargets.length > 0 && <button disabled={busy} onClick={() => setMerging(true)} style={smallBtn}>Merge into…</button>}
              <button disabled={busy} onClick={remove} style={{ ...smallBtn, color: COMPARE_FULL, marginLeft: "auto" }}>Delete</button>
            </div>
          )}

          {isAdmin && editing && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Title" style={inputStyle} />
              <textarea value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} rows={3} placeholder="Current value" style={{ ...inputStyle, resize: "vertical" }} />
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={inputStyle}>
                {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <div style={{ fontSize: 11, color: DESIGN_MUTED }}>Changing the value keeps the previous wording in the history and marks the item confirmed.</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button disabled={busy || !form.title.trim() || !form.value.trim()} onClick={saveEdit} style={{ ...smallBtn, background: PROJECTS_FULL, borderColor: PROJECTS_FULL, color: "#fff", fontWeight: 600 }}>Save</button>
                <button disabled={busy} onClick={() => setEditing(false)} style={smallBtn}>Cancel</button>
              </div>
            </div>
          )}

          {isAdmin && merging && (
            <div style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <select value={mergeInto} onChange={e => setMergeInto(e.target.value)} style={{ ...inputStyle, width: "auto", flex: 1, minWidth: 200 }}>
                <option value="">Merge this item into…</option>
                {mergeTargets.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
              <button disabled={busy || !mergeInto} onClick={merge} style={{ ...smallBtn, background: PROJECTS_FULL, borderColor: PROJECTS_FULL, color: "#fff", fontWeight: 600 }}>Merge</button>
              <button disabled={busy} onClick={() => { setMerging(false); setMergeInto(""); }} style={smallBtn}>Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
