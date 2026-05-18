import React, { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import { ARC_NAVY, ARC_TERRACOTTA, ARC_STONE, AD_GREEN } from "../constants";

const CATEGORIES = [
  { value: "holiday",      label: "Holiday" },
  { value: "sickness",     label: "Sickness" },
  { value: "bank_holiday", label: "Bank Holiday" },
  { value: "training",     label: "Training / CPD" },
  { value: "internal",     label: "Internal / Non-billable" },
];

const HOUR_OPTIONS   = Array.from({ length: 17 }, (_, i) => i);
const MINUTE_OPTIONS = [0, 15, 30, 45];
const DAYS           = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const FULL_DAY       = { hours: 7, minutes: 30 };
const HALF_DAY       = { hours: 3, minutes: 45 };
const MIN_WEEK_MINS  = 37.5 * 60;  // 2250
const OVER_WEEK_MINS = 45 * 60;    // 2700

// ── Utilities ─────────────────────────────────────────────────────────────────

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoDate(d) { return d.toISOString().split("T")[0]; }

function dateForDay(monday, dayIndex) {
  const d = new Date(monday);
  d.setDate(d.getDate() + dayIndex);
  return isoDate(d);
}

function formatWeekLabel(monday) {
  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 4);
  const o = { day: "numeric", month: "short" };
  return `${monday.toLocaleDateString("en-GB", o)} – ${friday.toLocaleDateString("en-GB", { ...o, year: "numeric" })}`;
}

function formatDayLabel(monday, dayIndex) {
  const d = new Date(monday);
  d.setDate(d.getDate() + dayIndex);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
}

function formatMins(totalMins) {
  if (totalMins === 0) return "—";
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (m === 0) return `${h}h`;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function entryMins(e) { return (e.hours || 0) * 60 + (e.minutes || 0); }
function totalMins(entries) { return entries.reduce((s, e) => s + entryMins(e), 0); }

// ── Confirm dialog ─────────────────────────────────────────────────────────────

function ConfirmDialog({ title, message, confirmLabel = "Submit anyway", onConfirm, onCancel }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9998 }}>
      <div style={{ background: "#fff", padding: 28, maxWidth: 420, width: "90%", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
        <h3 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 600, color: ARC_NAVY }}>{title}</h3>
        <p style={{ margin: "0 0 22px", fontSize: 13, color: "#4a5a6a", lineHeight: 1.6 }}>{message}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onCancel}
            style={{ background: "#fff", border: "1px solid #ccc", color: "#666", padding: "7px 18px", fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={onConfirm}
            style={{ background: ARC_TERRACOTTA, border: "none", color: "#fff", padding: "7px 18px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Status badge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const map = {
    draft:     { label: "Draft",     bg: "#f0f0f0", color: "#666" },
    submitted: { label: "Submitted", bg: "#fff8e1", color: "#b07800" },
    approved:  { label: "Approved",  bg: "#e8f5e9", color: "#2e7d32" },
  };
  const s = map[status] || map.draft;
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}44`, padding: "2px 10px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
      {s.label}
    </span>
  );
}

// ── Shared select style ────────────────────────────────────────────────────────

function selStyle(locked) {
  return {
    padding: "5px 8px", fontSize: 13, border: "1px solid #d0d8de",
    background: locked ? "#f5f5f5" : "#fff", color: ARC_NAVY,
    fontFamily: "Inter, Arial, sans-serif", cursor: locked ? "default" : "pointer",
  };
}

// ── Project/category dropdown options ─────────────────────────────────────────

function ProjectOptions({ projects }) {
  return (
    <>
      <option value="">— Select —</option>
      <optgroup label="Projects">
        {projects.map(p => (
          <option key={p.id} value={p.id}>
            {p.job_number ? `${p.job_number} — ${p.name}` : p.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Other">
        {CATEGORIES.map(c => <option key={c.value} value={`cat:${c.value}`}>{c.label}</option>)}
      </optgroup>
    </>
  );
}

// ── Draft entry row (unsaved, shown on empty days) ────────────────────────────

function DraftRow({ projects, onCreate }) {
  const [sel,     setSel]     = useState("");
  const [hours,   setHours]   = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [notes,   setNotes]   = useState("");
  const [saving,  setSaving]  = useState(false);

  const save = useCallback(async (selVal, h, m, n) => {
    if (saving) return;
    const isDefault = !selVal && h === 0 && m === 0;
    if (isDefault) return;
    setSaving(true);
    const project_id = selVal && !selVal.startsWith("cat:") ? selVal : null;
    const category   = selVal && selVal.startsWith("cat:") ? selVal.replace("cat:", "") : (!selVal ? "internal" : null);
    await onCreate({ project_id, category, hours: h, minutes: m, notes: n || null });
  }, [saving, onCreate]);

  const ss = selStyle(false);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #eef2f4" }}>
      <select value={sel} disabled={saving}
        onChange={e => { setSel(e.target.value); save(e.target.value, hours, minutes, notes); }}
        style={{ ...ss, flex: 1, minWidth: 0 }}>
        <ProjectOptions projects={projects} />
      </select>
      <select value={hours} disabled={saving}
        onChange={e => { const v = parseInt(e.target.value); setHours(v); save(sel, v, minutes, notes); }}
        style={{ ...ss, width: 62 }}>
        {HOUR_OPTIONS.map(h => <option key={h} value={h}>{h}h</option>)}
      </select>
      <select value={minutes} disabled={saving}
        onChange={e => { const v = parseInt(e.target.value); setMinutes(v); save(sel, hours, v, notes); }}
        style={{ ...ss, width: 62 }}>
        {MINUTE_OPTIONS.map(m => <option key={m} value={m}>{m}m</option>)}
      </select>
      <input placeholder="Notes (optional)" value={notes}
        onChange={e => setNotes(e.target.value)}
        onBlur={() => save(sel, hours, minutes, notes)}
        disabled={saving}
        style={{ ...ss, flex: 1, minWidth: 0 }} />
      <div style={{ width: 28 }} />
    </div>
  );
}

// ── Saved entry row ────────────────────────────────────────────────────────────

function EntryRow({ entry, projects, locked, onUpdate, onDelete }) {
  const [notes, setNotes] = useState(entry.notes || "");
  useEffect(() => { setNotes(entry.notes || ""); }, [entry.notes]);

  const currentValue = entry.project_id
    ? entry.project_id
    : entry.category ? `cat:${entry.category}` : "";

  const handleProjectChange = (e) => {
    const val = e.target.value;
    if (val.startsWith("cat:")) onUpdate(entry.id, { project_id: null,  category: val.replace("cat:", "") });
    else                        onUpdate(entry.id, { project_id: val || null, category: null });
  };

  const ss = selStyle(locked);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #eef2f4" }}>
      <select value={currentValue} onChange={handleProjectChange} disabled={locked} style={{ ...ss, flex: 1, minWidth: 0 }}>
        <ProjectOptions projects={projects} />
      </select>
      <select value={entry.hours ?? 0}
        onChange={e => onUpdate(entry.id, { hours: parseInt(e.target.value) })}
        disabled={locked} style={{ ...ss, width: 62 }}>
        {HOUR_OPTIONS.map(h => <option key={h} value={h}>{h}h</option>)}
      </select>
      <select value={entry.minutes ?? 0}
        onChange={e => onUpdate(entry.id, { minutes: parseInt(e.target.value) })}
        disabled={locked} style={{ ...ss, width: 62 }}>
        {MINUTE_OPTIONS.map(m => <option key={m} value={m}>{m}m</option>)}
      </select>
      <input placeholder="Notes (optional)" value={notes}
        onChange={e => setNotes(e.target.value)}
        onBlur={() => { if (notes !== (entry.notes || "")) onUpdate(entry.id, { notes: notes || null }); }}
        disabled={locked}
        style={{ ...ss, flex: 1, minWidth: 0 }} />
      {!locked && (
        <button onClick={() => onDelete(entry.id)}
          style={{ background: "none", border: "none", color: "#bbb", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: "0 4px", width: 28, flexShrink: 0 }}
          title="Remove">×</button>
      )}
      {locked && <div style={{ width: 28 }} />}
    </div>
  );
}

// ── Day card ───────────────────────────────────────────────────────────────────

function DayCard({ dayLabel, date, entries, projects, locked, onAdd, onUpdate, onDelete, onQuickFill, onDraftCreate }) {
  const dayTotal  = totalMins(entries);
  const hasReal   = entries.length > 0;
  const showDraft = !hasReal && !locked;
  const single    = entries.length === 1;

  const isFullDay = single && entries[0].hours === FULL_DAY.hours && entries[0].minutes === FULL_DAY.minutes;
  const isHalfDay = single && entries[0].hours === HALF_DAY.hours && entries[0].minutes === HALF_DAY.minutes;

  const quickFillStyle = (active) => ({
    fontSize: 11, padding: "2px 10px", cursor: locked || entries.length > 1 ? "default" : "pointer",
    border: `1px solid ${active ? AD_GREEN : "#c0ccd4"}`,
    background: active ? AD_GREEN : "#fff",
    color: active ? "#fff" : "#6a8a9a",
    opacity: (locked || entries.length > 1) ? 0.4 : 1,
    fontWeight: active ? 600 : 400,
    letterSpacing: "0.03em",
  });

  return (
    <div style={{ border: "1px solid #dde4e8", background: "#fff", marginBottom: 10 }}>
      {/* Day header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", background: ARC_STONE, borderBottom: (hasReal || showDraft) ? "1px solid #dde4e8" : "none" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: ARC_NAVY, flex: 1 }}>{dayLabel}</span>
        {/* Quick-fill buttons */}
        {!locked && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "#8a9aa8" }}>Quick fill:</span>
            <button style={quickFillStyle(isFullDay)} disabled={locked || entries.length > 1}
              onClick={() => !locked && entries.length <= 1 && onQuickFill(date, FULL_DAY)}>
              Full day
            </button>
            <button style={quickFillStyle(isHalfDay)} disabled={locked || entries.length > 1}
              onClick={() => !locked && entries.length <= 1 && onQuickFill(date, HALF_DAY)}>
              Half day
            </button>
          </div>
        )}
        {hasReal && <span style={{ fontSize: 12, color: AD_GREEN, fontWeight: 500, minWidth: 40, textAlign: "right" }}>{formatMins(dayTotal)}</span>}
      </div>

      {/* Entries */}
      {(hasReal || showDraft) && (
        <div style={{ padding: "4px 14px 0" }}>
          {showDraft
            ? <DraftRow projects={projects} onCreate={(data) => onDraftCreate(date, data)} />
            : entries.map(e => (
                <EntryRow key={e.id} entry={e} projects={projects} locked={locked}
                  onUpdate={onUpdate} onDelete={onDelete} />
              ))
          }
        </div>
      )}

      {/* Add more button */}
      {!locked && hasReal && (
        <div style={{ padding: "8px 14px" }}>
          <button onClick={() => onAdd(date)}
            style={{ background: "none", border: `1px dashed ${AD_GREEN}`, color: AD_GREEN, fontSize: 12, padding: "4px 12px", cursor: "pointer" }}>
            + Add
          </button>
        </div>
      )}
    </div>
  );
}

// ── Admin review panel ────────────────────────────────────────────────────────

function AdminPanel({ projects }) {
  const [submissions,     setSubmissions]     = useState([]);
  const [users,           setUsers]           = useState([]);
  const [expanded,        setExpanded]        = useState(null);
  const [expandedEntries, setExpandedEntries] = useState({});
  const [filterUser,      setFilterUser]      = useState("");
  const [filterFrom,      setFilterFrom]      = useState("");
  const [filterTo,        setFilterTo]        = useState("");
  const [loading,         setLoading]         = useState(false);
  const [toast,           setToast]           = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api("/api/admin/timesheets/submissions"),
      api("/api/admin/users"),
    ]).then(([subs, usersRes]) => {
      setSubmissions(subs || []);
      setUsers(usersRes?.users || []);
    }).finally(() => setLoading(false));
  }, []);

  const userEmail = (uid) => users.find(u => u.id === uid)?.email || uid.slice(0, 8) + "…";

  const filtered = submissions.filter(s => {
    if (filterUser && s.user_id !== filterUser) return false;
    if (filterFrom && s.week_start < filterFrom) return false;
    if (filterTo   && s.week_start > filterTo)   return false;
    return true;
  });

  const toggleExpand = async (key, userId, weekStart) => {
    if (expanded === key) { setExpanded(null); return; }
    setExpanded(key);
    if (!expandedEntries[key]) {
      const data = await api(`/api/admin/timesheets?user_id=${userId}&week=${weekStart}`);
      setExpandedEntries(prev => ({ ...prev, [key]: data || [] }));
    }
  };

  const handleAdminUpdate = async (key, id, changes) => {
    setExpandedEntries(prev => ({ ...prev, [key]: prev[key].map(e => e.id === id ? { ...e, ...changes } : e) }));
    await api(`/api/admin/timesheets/${id}`, { method: "PATCH", body: changes });
  };

  const handleApprove = async (sub) => {
    await api("/api/admin/timesheets/approve", { method: "POST", body: { week: sub.week_start, user_id: sub.user_id } });
    setSubmissions(prev => prev.map(s =>
      s.user_id === sub.user_id && s.week_start === sub.week_start ? { ...s, status: "approved" } : s
    ));
    showToast("Timesheet approved.");
  };

  const ss = { padding: "5px 10px", fontSize: 12, border: "1px solid #d0d8de", background: "#fff", color: ARC_NAVY, fontFamily: "Inter, Arial, sans-serif" };

  return (
    <div style={{ padding: "0 32px 32px" }}>
      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, background: ARC_NAVY, color: "#fff", padding: "10px 20px", fontSize: 13, zIndex: 9999 }}>{toast}</div>}

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20, padding: "14px 16px", background: ARC_STONE, border: "1px solid #dde4e8" }}>
        <span style={{ fontSize: 12, color: "#6a8a9a", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Filter</span>
        <select value={filterUser} onChange={e => setFilterUser(e.target.value)} style={ss}>
          <option value="">All staff</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
        </select>
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={ss} />
        <span style={{ fontSize: 12, color: "#8a9aa8" }}>to</span>
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={ss} />
        {(filterUser || filterFrom || filterTo) && (
          <button onClick={() => { setFilterUser(""); setFilterFrom(""); setFilterTo(""); }}
            style={{ background: "none", border: "none", color: ARC_TERRACOTTA, fontSize: 12, cursor: "pointer" }}>Clear</button>
        )}
      </div>

      {loading && <p style={{ color: "#6a8a9a", fontSize: 13 }}>Loading…</p>}
      {!loading && filtered.length === 0 && <p style={{ color: "#6a8a9a", fontSize: 13 }}>No submissions found.</p>}

      {filtered.map(sub => {
        const key     = `${sub.user_id}|${sub.week_start}`;
        const isOpen  = expanded === key;
        const entries = expandedEntries[key] || [];
        const wTotal  = totalMins(entries);
        const mon     = new Date(sub.week_start);
        const fri     = new Date(mon); fri.setDate(fri.getDate() + 4);
        const o       = { day: "numeric", month: "short" };
        const weekStr = `${mon.toLocaleDateString("en-GB", o)} – ${fri.toLocaleDateString("en-GB", { ...o, year: "numeric" })}`;

        return (
          <div key={key} style={{ border: "1px solid #dde4e8", marginBottom: 8, background: "#fff" }}>
            <div onClick={() => toggleExpand(key, sub.user_id, sub.week_start)}
              style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 16px", cursor: "pointer", background: isOpen ? ARC_STONE : "#fff" }}>
              <span style={{ fontSize: 13, color: ARC_NAVY, fontWeight: 600, minWidth: 200 }}>{userEmail(sub.user_id)}</span>
              <span style={{ fontSize: 13, color: "#6a8a9a", minWidth: 180 }}>{weekStr}</span>
              {isOpen && entries.length > 0 && (
                <span style={{ fontSize: 12, color: AD_GREEN, fontWeight: 500 }}>{formatMins(wTotal)}</span>
              )}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                <StatusBadge status={sub.status} />
                {sub.status === "submitted" && (
                  <button onClick={e => { e.stopPropagation(); handleApprove(sub); }}
                    style={{ background: AD_GREEN, color: "#fff", border: "none", padding: "4px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                    Approve
                  </button>
                )}
                <span style={{ color: "#aaa", fontSize: 14 }}>{isOpen ? "▲" : "▼"}</span>
              </div>
            </div>

            {isOpen && (
              <div style={{ padding: "12px 16px", borderTop: "1px solid #eef2f4" }}>
                {entries.length === 0 && <p style={{ color: "#aaa", fontSize: 13 }}>No entries.</p>}
                {DAYS.map((day, di) => {
                  const date   = dateForDay(new Date(sub.week_start), di);
                  const dEntries = entries.filter(e => e.entry_date === date);
                  if (!dEntries.length) return null;
                  const dTotal = totalMins(dEntries);
                  return (
                    <div key={day} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          {formatDayLabel(new Date(sub.week_start), di)}
                        </span>
                        <span style={{ fontSize: 12, color: AD_GREEN }}>{formatMins(dTotal)}</span>
                      </div>
                      {dEntries.map(e => (
                        <EntryRow key={e.id} entry={e} projects={projects} locked={false}
                          onUpdate={(id, changes) => handleAdminUpdate(key, id, changes)}
                          onDelete={() => {}} />
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TimesheetsSection({ isAdmin }) {
  const [view,       setView]       = useState("mine");
  const [monday,     setMonday]     = useState(getMonday(new Date()));
  const [projects,   setProjects]   = useState([]);
  const [entries,    setEntries]    = useState([]);
  const [submission, setSubmission] = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast,      setToast]      = useState(null);
  const [dialog,     setDialog]     = useState(null); // { title, message, onConfirm }

  const weekKey  = isoDate(monday);
  const isLocked = submission?.status === "submitted" || submission?.status === "approved";

  const showToast = useCallback((msg) => {
    setToast(msg); setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    api("/api/projects").then(data => setProjects(data?.projects || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (view !== "mine") return;
    setLoading(true);
    Promise.all([
      api(`/api/timesheets?week=${weekKey}`),
      api(`/api/timesheets/submission?week=${weekKey}`),
    ]).then(([ents, sub]) => {
      setEntries(ents || []);
      setSubmission(sub);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [weekKey, view]);

  const prevWeek = () => { const d = new Date(monday); d.setDate(d.getDate() - 7); setMonday(d); };
  const nextWeek = () => { const d = new Date(monday); d.setDate(d.getDate() + 7); setMonday(d); };

  const dayEntries = (date) => entries.filter(e => e.entry_date === date);

  // Create a new entry for a day (from "+ Add" button on existing entries)
  const handleAdd = useCallback(async (date) => {
    try {
      const data = await api("/api/timesheets", { method: "POST", body: { entry_date: date, hours: 0, minutes: 0, category: "internal" } });
      if (data?.id) setEntries(prev => [...prev, data]);
    } catch { showToast("Could not add entry."); }
  }, [showToast]);

  // Create entry from the draft row (first row on an empty day)
  const handleDraftCreate = useCallback(async (date, body) => {
    try {
      const data = await api("/api/timesheets", { method: "POST", body: { entry_date: date, ...body } });
      if (data?.id) setEntries(prev => [...prev, data]);
    } catch { showToast("Could not save entry."); }
  }, [showToast]);

  // Update a saved entry
  const handleUpdate = useCallback(async (id, changes) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...changes } : e));
    try {
      const updated = await api(`/api/timesheets/${id}`, { method: "PUT", body: changes });
      if (updated?.id) setEntries(prev => prev.map(e => e.id === id ? updated : e));
    } catch { showToast("Could not save change."); }
  }, [showToast]);

  // Delete a saved entry
  const handleDelete = useCallback(async (id) => {
    setEntries(prev => prev.filter(e => e.id !== id));
    try { await api(`/api/timesheets/${id}`, { method: "DELETE" }); }
    catch { showToast("Could not delete entry."); }
  }, [showToast]);

  // Quick fill full/half day
  const handleQuickFill = useCallback(async (date, { hours, minutes }) => {
    const existing = entries.filter(e => e.entry_date === date);
    if (existing.length === 1) {
      // Update existing single entry
      handleUpdate(existing[0].id, { hours, minutes });
    } else if (existing.length === 0) {
      // Create new entry with these hours
      try {
        const data = await api("/api/timesheets", { method: "POST", body: { entry_date: date, hours, minutes, category: "internal" } });
        if (data?.id) setEntries(prev => [...prev, data]);
      } catch { showToast("Could not create entry."); }
    }
  }, [entries, handleUpdate, showToast]);

  // Submit with validation
  const doSubmit = useCallback(async () => {
    setDialog(null);
    setSubmitting(true);
    try {
      const data = await api("/api/timesheets/submit", { method: "POST", body: { week: weekKey } });
      setSubmission(data);
      showToast("Timesheet submitted for approval.");
    } catch { showToast("Could not submit timesheet."); }
    finally { setSubmitting(false); }
  }, [weekKey, showToast]);

  const handleSubmitClick = () => {
    const total = totalMins(entries);
    if (total > OVER_WEEK_MINS) {
      setDialog({
        title: "Over standard hours",
        message: `Your total for this week is ${formatMins(total)}, which is above 45 hours. Are you sure you want to submit?`,
        onConfirm: doSubmit,
      });
    } else if (total < MIN_WEEK_MINS) {
      setDialog({
        title: "Below minimum hours",
        message: `Your total for this week is ${formatMins(total)}, which is below the standard 37.5 hours. Are you sure you want to submit?`,
        onConfirm: doSubmit,
      });
    } else {
      doSubmit();
    }
  };

  const weekTotal  = totalMins(entries);
  const underMin   = weekTotal < MIN_WEEK_MINS && weekTotal > 0;
  const btnBase    = { fontSize: 12, padding: "5px 16px", cursor: "pointer", fontFamily: "Inter, Arial, sans-serif", fontWeight: 600, border: "none" };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7f8" }}>
      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: ARC_NAVY, color: "#fff", padding: "10px 20px", fontSize: 13, zIndex: 9999 }}>{toast}</div>
      )}
      {dialog && (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          onConfirm={dialog.onConfirm}
          onCancel={() => setDialog(null)}
        />
      )}

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #dde4e8", padding: "16px 32px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 300, color: ARC_NAVY, letterSpacing: "0.02em" }}>Timesheets</h2>
          {isAdmin && (
            <div style={{ display: "flex", border: `1px solid ${AD_GREEN}` }}>
              {["mine", "admin"].map(v => (
                <button key={v} onClick={() => setView(v)}
                  style={{ ...btnBase, background: view === v ? AD_GREEN : "#fff", color: view === v ? "#fff" : AD_GREEN, padding: "5px 20px" }}>
                  {v === "mine" ? "My Timesheets" : "Admin Review"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {view === "admin" ? (
          <>
            <div style={{ padding: "24px 32px 8px" }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: ARC_NAVY, letterSpacing: "0.04em", textTransform: "uppercase" }}>Staff Timesheets</h3>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6a8a9a" }}>Review and approve submitted timesheets. Click a row to expand and amend entries.</p>
            </div>
            <AdminPanel projects={projects} />
          </>
        ) : (
          <div style={{ padding: "24px 32px" }}>

            {/* Week navigator */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
              <button onClick={prevWeek} style={{ ...btnBase, background: "#fff", color: ARC_NAVY, border: "1px solid #dde4e8", padding: "5px 12px", fontSize: 16 }}>‹</button>
              <span style={{ fontSize: 15, fontWeight: 500, color: ARC_NAVY, minWidth: 220, textAlign: "center" }}>{formatWeekLabel(monday)}</span>
              <button onClick={nextWeek} style={{ ...btnBase, background: "#fff", color: ARC_NAVY, border: "1px solid #dde4e8", padding: "5px 12px", fontSize: 16 }}>›</button>
              <StatusBadge status={submission?.status || "draft"} />
            </div>

            {loading && <p style={{ color: "#6a8a9a", fontSize: 13 }}>Loading…</p>}

            {!loading && (
              <>
                {/* Column headers */}
                <div style={{ display: "flex", gap: 8, padding: "0 14px 6px", fontSize: 11, color: "#8a9aa8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  <span style={{ flex: 1 }}>Project / Category</span>
                  <span style={{ width: 62 }}>Hours</span>
                  <span style={{ width: 62 }}>Mins</span>
                  <span style={{ flex: 1 }}>Notes</span>
                  <span style={{ width: 28 }} />
                </div>

                {/* Day cards */}
                {DAYS.map((day, di) => {
                  const date = dateForDay(monday, di);
                  return (
                    <DayCard
                      key={day}
                      dayLabel={formatDayLabel(monday, di)}
                      date={date}
                      entries={dayEntries(date)}
                      projects={projects}
                      locked={isLocked}
                      onAdd={handleAdd}
                      onUpdate={handleUpdate}
                      onDelete={handleDelete}
                      onQuickFill={handleQuickFill}
                      onDraftCreate={handleDraftCreate}
                    />
                  );
                })}

                {/* Footer */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, padding: "14px 16px", background: "#fff", border: "1px solid #dde4e8" }}>
                  <div>
                    <span style={{ fontSize: 14, color: ARC_NAVY, fontWeight: 600 }}>
                      Week total: <span style={{ color: underMin && !isLocked ? ARC_TERRACOTTA : AD_GREEN }}>{formatMins(weekTotal)}</span>
                    </span>
                    {underMin && !isLocked && (
                      <span style={{ marginLeft: 12, fontSize: 12, color: ARC_TERRACOTTA }}>
                        ⚠ Below 37.5h minimum
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {!isLocked && (
                      <button onClick={handleSubmitClick} disabled={submitting || entries.length === 0}
                        style={{ ...btnBase, background: entries.length === 0 ? "#ccc" : AD_GREEN, color: "#fff", padding: "8px 24px", fontSize: 13, cursor: entries.length === 0 ? "default" : "pointer" }}>
                        {submitting ? "Submitting…" : "Submit for Approval"}
                      </button>
                    )}
                    {submission?.status === "submitted" && (
                      <>
                        <span style={{ fontSize: 13, color: "#b07800" }}>Awaiting approval</span>
                        <button onClick={nextWeek}
                          style={{ ...btnBase, background: "#fff", color: AD_GREEN, border: `1px solid ${AD_GREEN}`, padding: "6px 16px", fontSize: 12 }}>
                          Next week →
                        </button>
                      </>
                    )}
                    {submission?.status === "approved" && (
                      <>
                        <span style={{ fontSize: 13, color: "#2e7d32", fontWeight: 600 }}>✓ Approved</span>
                        <button onClick={nextWeek}
                          style={{ ...btnBase, background: "#fff", color: AD_GREEN, border: `1px solid ${AD_GREEN}`, padding: "6px 16px", fontSize: 12 }}>
                          Next week →
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
