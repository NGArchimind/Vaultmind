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

const HOUR_OPTIONS   = Array.from({ length: 17 }, (_, i) => i); // 0–16
const MINUTE_OPTIONS = [0, 15, 30, 45];
const DAYS           = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoDate(d) {
  return d.toISOString().split("T")[0];
}

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

function formatMinutes(h, m) {
  if (h === 0 && m === 0) return "—";
  if (m === 0) return `${h}h`;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function totalForEntries(entries) {
  const totalMins = entries.reduce((sum, e) => sum + (e.hours || 0) * 60 + (e.minutes || 0), 0);
  return { h: Math.floor(totalMins / 60), m: totalMins % 60 };
}

function StatusBadge({ status }) {
  const map = {
    draft:     { label: "Draft",     bg: "#f0f0f0",   color: "#666" },
    submitted: { label: "Submitted", bg: "#fff8e1",   color: "#b07800" },
    approved:  { label: "Approved",  bg: "#e8f5e9",   color: "#2e7d32" },
  };
  const s = map[status] || map.draft;
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}33`, padding: "2px 10px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
      {s.label}
    </span>
  );
}

// ── Single entry row ──────────────────────────────────────────────────────────
function EntryRow({ entry, projects, locked, onUpdate, onDelete }) {
  const [notes, setNotes] = useState(entry.notes || "");

  useEffect(() => { setNotes(entry.notes || ""); }, [entry.notes]);

  const currentValue = entry.project_id
    ? entry.project_id
    : entry.category ? `cat:${entry.category}` : "";

  const handleProjectChange = (e) => {
    const val = e.target.value;
    if (val.startsWith("cat:")) {
      onUpdate(entry.id, { project_id: null, category: val.replace("cat:", "") });
    } else {
      onUpdate(entry.id, { project_id: val || null, category: null });
    }
  };

  const sel = {
    padding: "5px 8px", fontSize: 13, border: "1px solid #d0d8de",
    background: locked ? "#f5f5f5" : "#fff", color: ARC_NAVY,
    fontFamily: "Inter, Arial, sans-serif", cursor: locked ? "default" : "pointer",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #eef2f4" }}>
      <select value={currentValue} onChange={handleProjectChange} disabled={locked}
        style={{ ...sel, flex: 1, minWidth: 0 }}>
        <option value="">— Select —</option>
        <optgroup label="Projects">
          {projects.map(p => (
            <option key={p.id} value={p.id}>
              {p.job_number ? `${p.job_number} — ${p.name}` : p.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="Other">
          {CATEGORIES.map(c => (
            <option key={c.value} value={`cat:${c.value}`}>{c.label}</option>
          ))}
        </optgroup>
      </select>

      <select value={entry.hours ?? 0} onChange={e => onUpdate(entry.id, { hours: parseInt(e.target.value) })}
        disabled={locked} style={{ ...sel, width: 62 }}>
        {HOUR_OPTIONS.map(h => <option key={h} value={h}>{h}h</option>)}
      </select>

      <select value={entry.minutes ?? 0} onChange={e => onUpdate(entry.id, { minutes: parseInt(e.target.value) })}
        disabled={locked} style={{ ...sel, width: 62 }}>
        {MINUTE_OPTIONS.map(m => <option key={m} value={m}>{m}m</option>)}
      </select>

      <input
        placeholder="Notes (optional)"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        onBlur={() => { if (notes !== (entry.notes || "")) onUpdate(entry.id, { notes: notes || null }); }}
        disabled={locked}
        style={{ ...sel, flex: 1, minWidth: 0, padding: "5px 8px" }}
      />

      {!locked && (
        <button onClick={() => onDelete(entry.id)}
          style={{ background: "none", border: "none", color: "#aaa", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: "0 4px", flexShrink: 0 }}
          title="Remove">×</button>
      )}
    </div>
  );
}

// ── Single day card ───────────────────────────────────────────────────────────
function DayCard({ dayLabel, entries, projects, locked, onAdd, onUpdate, onDelete }) {
  const total = totalForEntries(entries);
  const hasEntries = entries.length > 0;

  return (
    <div style={{ border: "1px solid #dde4e8", background: "#fff", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", background: ARC_STONE, borderBottom: hasEntries ? "1px solid #dde4e8" : "none" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: ARC_NAVY, letterSpacing: "0.02em" }}>{dayLabel}</span>
        {hasEntries && (
          <span style={{ fontSize: 12, color: "#6a8a9a", fontWeight: 500 }}>{formatMinutes(total.h, total.m)}</span>
        )}
      </div>
      {hasEntries && (
        <div style={{ padding: "4px 14px 0" }}>
          {entries.map(e => (
            <EntryRow key={e.id} entry={e} projects={projects} locked={locked}
              onUpdate={onUpdate} onDelete={onDelete} />
          ))}
        </div>
      )}
      {!locked && (
        <div style={{ padding: "8px 14px" }}>
          <button onClick={onAdd}
            style={{ background: "none", border: `1px dashed ${AD_GREEN}`, color: AD_GREEN, fontSize: 12, padding: "4px 12px", cursor: "pointer", letterSpacing: "0.04em" }}>
            + Add
          </button>
        </div>
      )}
    </div>
  );
}

// ── Admin review panel ────────────────────────────────────────────────────────
function AdminPanel({ projects }) {
  const [submissions, setSubmissions]   = useState([]);
  const [users, setUsers]               = useState([]);
  const [expanded, setExpanded]         = useState(null); // "userId|weekStart"
  const [expandedEntries, setExpandedEntries] = useState({});
  const [filterUser, setFilterUser]     = useState("");
  const [filterFrom, setFilterFrom]     = useState("");
  const [filterTo, setFilterTo]         = useState("");
  const [loading, setLoading]           = useState(false);
  const [toast, setToast]               = useState(null);

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

  const filteredSubs = submissions.filter(s => {
    if (filterUser && s.user_id !== filterUser) return false;
    if (filterFrom && s.week_start < filterFrom) return false;
    if (filterTo && s.week_start > filterTo) return false;
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

  const handleAdminUpdate = async (key, entryId, changes) => {
    setExpandedEntries(prev => ({
      ...prev,
      [key]: prev[key].map(e => e.id === entryId ? { ...e, ...changes } : e),
    }));
    await api(`/api/admin/timesheets/${entryId}`, { method: "PATCH", body: changes });
  };

  const handleApprove = async (sub) => {
    await api("/api/admin/timesheets/approve", {
      method: "POST",
      body: { week: sub.week_start, user_id: sub.user_id },
    });
    setSubmissions(prev => prev.map(s =>
      s.user_id === sub.user_id && s.week_start === sub.week_start
        ? { ...s, status: "approved" } : s
    ));
    showToast("Timesheet approved.");
  };

  const sel = { padding: "5px 10px", fontSize: 12, border: "1px solid #d0d8de", background: "#fff", color: ARC_NAVY, fontFamily: "Inter, Arial, sans-serif" };

  return (
    <div style={{ padding: "0 32px 32px" }}>
      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: ARC_NAVY, color: "#fff", padding: "10px 20px", fontSize: 13, zIndex: 9999 }}>{toast}</div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20, padding: "14px 16px", background: ARC_STONE, border: "1px solid #dde4e8" }}>
        <span style={{ fontSize: 12, color: "#6a8a9a", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Filter</span>
        <select value={filterUser} onChange={e => setFilterUser(e.target.value)} style={sel}>
          <option value="">All staff</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
        </select>
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={sel} placeholder="From" />
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={sel} placeholder="To" />
        {(filterUser || filterFrom || filterTo) && (
          <button onClick={() => { setFilterUser(""); setFilterFrom(""); setFilterTo(""); }}
            style={{ background: "none", border: "none", color: ARC_TERRACOTTA, fontSize: 12, cursor: "pointer" }}>Clear</button>
        )}
      </div>

      {loading && <p style={{ color: "#6a8a9a", fontSize: 13 }}>Loading…</p>}

      {!loading && filteredSubs.length === 0 && (
        <p style={{ color: "#6a8a9a", fontSize: 13 }}>No submissions found.</p>
      )}

      {filteredSubs.map(sub => {
        const key = `${sub.user_id}|${sub.week_start}`;
        const isOpen = expanded === key;
        const entries = expandedEntries[key] || [];
        const total = totalForEntries(entries);

        return (
          <div key={key} style={{ border: "1px solid #dde4e8", marginBottom: 8, background: "#fff" }}>
            <div
              onClick={() => toggleExpand(key, sub.user_id, sub.week_start)}
              style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 16px", cursor: "pointer", background: isOpen ? ARC_STONE : "#fff" }}>
              <span style={{ fontSize: 13, color: ARC_NAVY, fontWeight: 600, minWidth: 200 }}>{userEmail(sub.user_id)}</span>
              <span style={{ fontSize: 13, color: "#6a8a9a", minWidth: 180 }}>
                {(() => {
                  const mon = new Date(sub.week_start);
                  const fri = new Date(mon); fri.setDate(fri.getDate() + 4);
                  const o = { day: "numeric", month: "short" };
                  return `${mon.toLocaleDateString("en-GB", o)} – ${fri.toLocaleDateString("en-GB", { ...o, year: "numeric" })}`;
                })()}
              </span>
              {isOpen && entries.length > 0 && (
                <span style={{ fontSize: 12, color: AD_GREEN, fontWeight: 500 }}>{formatMinutes(total.h, total.m)} total</span>
              )}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                <StatusBadge status={sub.status} />
                {sub.status === "submitted" && (
                  <button
                    onClick={e => { e.stopPropagation(); handleApprove(sub); }}
                    style={{ background: AD_GREEN, color: "#fff", border: "none", padding: "4px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600, letterSpacing: "0.04em" }}>
                    Approve
                  </button>
                )}
                <span style={{ color: "#aaa", fontSize: 16 }}>{isOpen ? "▲" : "▼"}</span>
              </div>
            </div>

            {isOpen && (
              <div style={{ padding: "12px 16px", borderTop: "1px solid #eef2f4" }}>
                {entries.length === 0 && <p style={{ color: "#aaa", fontSize: 13 }}>No entries.</p>}
                {DAYS.map((day, di) => {
                  const date = dateForDay(new Date(sub.week_start), di);
                  const dayEntries = entries.filter(e => e.entry_date === date);
                  if (dayEntries.length === 0) return null;
                  const dt = totalForEntries(dayEntries);
                  return (
                    <div key={day} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          {formatDayLabel(new Date(sub.week_start), di)}
                        </span>
                        <span style={{ fontSize: 12, color: AD_GREEN }}>{formatMinutes(dt.h, dt.m)}</span>
                      </div>
                      {dayEntries.map(e => (
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
  const [view, setView]           = useState("mine");
  const [monday, setMonday]       = useState(getMonday(new Date()));
  const [projects, setProjects]   = useState([]);
  const [entries, setEntries]     = useState([]);
  const [submission, setSubmission] = useState(null);
  const [loading, setLoading]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast]         = useState(null);

  const weekKey  = isoDate(monday);
  const isLocked = submission?.status === "submitted" || submission?.status === "approved";

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
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

  const dayEntries = (dayIndex) => {
    const date = dateForDay(monday, dayIndex);
    return entries.filter(e => e.entry_date === date);
  };

  const handleAdd = async (dayIndex) => {
    const entry_date = dateForDay(monday, dayIndex);
    try {
      const data = await api("/api/timesheets", { method: "POST", body: { entry_date, hours: 0, minutes: 0, category: "internal" } });
      if (data?.id) setEntries(prev => [...prev, data]);
    } catch (err) { showToast("Could not add entry."); }
  };

  const handleUpdate = useCallback(async (id, changes) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...changes } : e));
    try {
      const updated = await api(`/api/timesheets/${id}`, { method: "PUT", body: changes });
      if (updated?.id) setEntries(prev => prev.map(e => e.id === id ? updated : e));
    } catch (err) { showToast("Could not save change."); }
  }, [showToast]);

  const handleDelete = useCallback(async (id) => {
    setEntries(prev => prev.filter(e => e.id !== id));
    try { await api(`/api/timesheets/${id}`, { method: "DELETE" }); }
    catch (err) { showToast("Could not delete entry."); }
  }, [showToast]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const data = await api("/api/timesheets/submit", { method: "POST", body: { week: weekKey } });
      setSubmission(data);
      showToast("Timesheet submitted for approval.");
    } catch (err) { showToast("Could not submit timesheet."); }
    finally { setSubmitting(false); }
  };

  const weekTotal = totalForEntries(entries);

  const btnBase = { fontSize: 12, padding: "5px 16px", cursor: "pointer", letterSpacing: "0.04em", fontFamily: "Inter, Arial, sans-serif", fontWeight: 600, border: "none" };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7f8" }}>
      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: ARC_NAVY, color: "#fff", padding: "10px 20px", fontSize: 13, zIndex: 9999 }}>{toast}</div>
      )}

      {/* Section header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #dde4e8", padding: "16px 32px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 300, color: ARC_NAVY, letterSpacing: "0.02em" }}>Timesheets</h2>
          {isAdmin && (
            <div style={{ display: "flex", gap: 0, border: `1px solid ${AD_GREEN}` }}>
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
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6a8a9a" }}>Review and approve submitted timesheets. You can amend entries directly.</p>
            </div>
            <AdminPanel projects={projects} />
          </>
        ) : (
          <div style={{ padding: "24px 32px" }}>

            {/* Week navigator */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
              <button onClick={prevWeek} style={{ ...btnBase, background: "#fff", color: ARC_NAVY, border: "1px solid #dde4e8", padding: "5px 12px" }}>‹</button>
              <span style={{ fontSize: 15, fontWeight: 500, color: ARC_NAVY, minWidth: 220, textAlign: "center" }}>{formatWeekLabel(monday)}</span>
              <button onClick={nextWeek} style={{ ...btnBase, background: "#fff", color: ARC_NAVY, border: "1px solid #dde4e8", padding: "5px 12px" }}>›</button>
              <StatusBadge status={submission?.status || "draft"} />
            </div>

            {loading && <p style={{ color: "#6a8a9a", fontSize: 13 }}>Loading…</p>}

            {!loading && (
              <>
                {/* Column headers */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 62px 62px 1fr 28px", gap: 8, padding: "0 14px 6px", fontSize: 11, color: "#8a9aa8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  <span>Project / Category</span>
                  <span>Hours</span>
                  <span>Mins</span>
                  <span>Notes</span>
                  <span />
                </div>

                {/* Day cards */}
                {DAYS.map((day, di) => (
                  <DayCard
                    key={day}
                    dayLabel={formatDayLabel(monday, di)}
                    entries={dayEntries(di)}
                    projects={projects}
                    locked={isLocked}
                    onAdd={() => handleAdd(di)}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                  />
                ))}

                {/* Footer: total + submit */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, padding: "14px 16px", background: "#fff", border: "1px solid #dde4e8" }}>
                  <span style={{ fontSize: 14, color: ARC_NAVY, fontWeight: 600 }}>
                    Week total: <span style={{ color: AD_GREEN }}>{formatMinutes(weekTotal.h, weekTotal.m)}</span>
                  </span>
                  {!isLocked && (
                    <button
                      onClick={handleSubmit}
                      disabled={submitting || entries.length === 0}
                      style={{ ...btnBase, background: entries.length === 0 ? "#ccc" : AD_GREEN, color: "#fff", padding: "8px 24px", fontSize: 13, cursor: entries.length === 0 ? "default" : "pointer" }}>
                      {submitting ? "Submitting…" : "Submit for Approval"}
                    </button>
                  )}
                  {submission?.status === "submitted" && (
                    <span style={{ fontSize: 13, color: "#b07800" }}>Awaiting approval</span>
                  )}
                  {submission?.status === "approved" && (
                    <span style={{ fontSize: 13, color: "#2e7d32", fontWeight: 600 }}>✓ Approved</span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
