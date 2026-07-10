import React, { useState, useEffect, useCallback, useRef } from "react";
import { api, apiBlob } from "../api/client";
import { DESIGN_GROUND, DESIGN_TEXT, TIMESHEETS_FULL, COMPARE_FULL } from "../constants";
import TimesheetHistory from "./TimesheetHistory";
import TimesheetReport from "./TimesheetReport";
import FeeReview from "./FeeReview";
import ExpensesTab from "./ExpensesTab";
import { CATEGORIES } from "../categories";
import ProjectPicker from "./ProjectPicker";

const HOUR_OPTIONS   = Array.from({ length: 17 }, (_, i) => i);
const MINUTE_OPTIONS = [0, 15, 30, 45];
const DAYS           = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const FULL_DAY       = { hours: 7, minutes: 30 };
const HALF_DAY       = { hours: 3, minutes: 45 };
const DAY_CAP_MINS   = 7 * 60 + 30;  // 450 — max "time worked" (overtime excluded) per day
const MIN_WEEK_MINS  = 37.5 * 60;  // 2250
const OVER_WEEK_MINS = 45 * 60;    // 2700
const LAUNCH_DATE    = "2026-07-01";  // timesheets go live — days before this are locked, and the launch week is exempt from the 37.5h minimum
const isBeforeLaunch = (date) => date < LAUNCH_DATE;  // ISO YYYY-MM-DD strings compare lexically

// ── Utilities ─────────────────────────────────────────────────────────────────

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

// Build YYYY-MM-DD from the LOCAL calendar date — never via UTC.
// toISOString() converts to UTC first, which shifts the date back a day
// when the UK is on British Summer Time (midnight Mon local = 23:00 Sun UTC).
function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

function formatMins(totalMins) {
  if (totalMins === 0) return "—";
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (m === 0) return `${h}h`;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function dayName(isoDate) {
  return new Date(isoDate + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long" });
}

function entryMins(e) { return (e.hours || 0) * 60 + (e.minutes || 0); }
function totalMins(entries) { return entries.reduce((s, e) => s + entryMins(e), 0); }
// Overtime is tracked separately — never added into the normal totals above.
function entryOtMins(e) { return (e.overtime_hours || 0) * 60 + (e.overtime_minutes || 0); }
function totalOtMins(entries) { return entries.reduce((s, e) => s + entryOtMins(e), 0); }

// ── Confirm dialog ─────────────────────────────────────────────────────────────

function ConfirmDialog({ title, message, confirmLabel = "Submit anyway", onConfirm, onCancel, hideCancel }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9998 }}>
      <div style={{ background: "#fff", padding: 28, maxWidth: 420, width: "90%", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
        <h3 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 600, color: DESIGN_TEXT }}>{title}</h3>
        <p style={{ margin: "0 0 22px", fontSize: 13, color: "#4a5a6a", lineHeight: 1.6 }}>{message}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          {!hideCancel && (
            <button onClick={onCancel}
              style={{ background: "#fff", border: "1px solid #e4e4e8", color: "#666", padding: "7px 18px", fontSize: 13, cursor: "pointer" }}>
              Cancel
            </button>
          )}
          <button onClick={onConfirm}
            style={{ background: COMPARE_FULL, border: "none", color: "#fff", padding: "7px 18px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
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
    background: locked ? "#f5f5f5" : "#fff", color: DESIGN_TEXT,
    fontFamily: "Inter, Arial, sans-serif", cursor: locked ? "default" : "pointer",
  };
}

// ── Project/category dropdown options ─────────────────────────────────────────

// (ProjectPicker replaces the old ProjectOptions <select> dropdown)

// Per-row Full day / Half day shortcut button
function DayShortcut({ label, active, disabled, onClick }) {
  return (
    <button onClick={() => !disabled && onClick()} disabled={disabled}
      style={{
        border: `1px solid ${active ? TIMESHEETS_FULL : "#cdd6dd"}`,
        background: active ? TIMESHEETS_FULL : "#fff",
        color: active ? "#fff" : "#6a8a9a",
        padding: "4px 8px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
        fontFamily: "Inter, Arial, sans-serif",
      }}>
      {label}
    </button>
  );
}

// ── Draft entry row (unsaved, shown on empty days) ────────────────────────────

function DraftRow({ projects, recentIds = [], onCreate }) {
  const [sel,     setSel]     = useState("");
  const [hours,   setHours]   = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [notes,   setNotes]   = useState("");
  const [saving,  setSaving]  = useState(false);
  const saveTimerRef = useRef(null);

  const save = useCallback((selVal, h, m, n) => {
    const isDefault = !selVal && h === 0 && m === 0;
    if (isDefault) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (saving) return;
      setSaving(true);
      const project_id = selVal && !selVal.startsWith("cat:") ? selVal : null;
      const category   = selVal && selVal.startsWith("cat:") ? selVal.replace("cat:", "") : (!selVal ? "internal" : null);
      await onCreate({ project_id, category, hours: h, minutes: m, notes: n || null });
    }, 300);
  }, [saving, onCreate]);

  const ss = selStyle(false);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #eef2f4" }}>
      <ProjectPicker
        value={sel}
        onChange={(val) => { setSel(val); save(val, hours, minutes, notes); }}
        projects={projects}
        recentIds={recentIds}
        disabled={saving}
        style={{ flex: 1, minWidth: 0 }}
      />
      <div style={{ display: "flex", gap: 4 }}>
        <DayShortcut label="Full day" active={hours === FULL_DAY.hours && minutes === FULL_DAY.minutes} disabled={saving}
          onClick={() => { setHours(FULL_DAY.hours); setMinutes(FULL_DAY.minutes); save(sel, FULL_DAY.hours, FULL_DAY.minutes, notes); }} />
        <DayShortcut label="Half day" active={hours === HALF_DAY.hours && minutes === HALF_DAY.minutes} disabled={saving}
          onClick={() => { setHours(HALF_DAY.hours); setMinutes(HALF_DAY.minutes); save(sel, HALF_DAY.hours, HALF_DAY.minutes, notes); }} />
      </div>
      <div style={{ width: 132, display: "flex", gap: 8 }}>
        <select value={hours} disabled={saving}
          onChange={e => { const v = parseInt(e.target.value); setHours(v); save(sel, v, minutes, notes); }}
          style={{ ...ss, flex: 1, minWidth: 0 }}>
          {HOUR_OPTIONS.map(h => <option key={h} value={h}>{h}h</option>)}
        </select>
        <select value={minutes} disabled={saving}
          onChange={e => { const v = parseInt(e.target.value); setMinutes(v); save(sel, hours, v, notes); }}
          style={{ ...ss, flex: 1, minWidth: 0 }}>
          {MINUTE_OPTIONS.map(m => <option key={m} value={m}>{m}m</option>)}
        </select>
      </div>
      <div style={{ width: 132 }} />
      <input placeholder="Notes (optional)" value={notes}
        onChange={e => setNotes(e.target.value)}
        onBlur={() => save(sel, hours, minutes, notes)}
        disabled={saving}
        style={{ ...ss, flex: 1, minWidth: 0 }} />
      <div style={{ width: 28 }} />
    </div>
  );
}

// ── Unpriced-extra control (project rows only) ────────────────────────────────
// A tick that flags a line as work not covered by the current fee, plus a
// per-project, grow-on-the-fly dropdown of "extra-types". Counts as normal time —
// this is purely a billing/tracking tag. Only rendered when the parent passes the
// extra-type props (i.e. the staff "My Timesheet" view, never Admin Review).

function UnpricedExtraControl({ entry, locked, extraTypes, onEnsureTypes, onAddType, onUpdate }) {
  const checked = !!entry.unpriced_extra;
  const [adding, setAdding] = useState(false);
  const [draft,  setDraft]  = useState("");
  const [busy,   setBusy]   = useState(false);

  // Make sure this project's type list is loaded whenever the row is an extra.
  useEffect(() => { if (checked && entry.project_id) onEnsureTypes(entry.project_id); }, [checked, entry.project_id]);

  // Options: the loaded list, plus the currently-selected type if it isn't in the
  // list yet (so the saved label shows immediately, before the list finishes loading).
  const list = extraTypes || [];
  const options = (entry.extra_type_id && !list.some(t => t.id === entry.extra_type_id))
    ? [{ id: entry.extra_type_id, label: entry.project_extra_types?.label || "…" }, ...list]
    : list;

  const toggle = (on) => {
    if (locked) return;
    if (on) { onEnsureTypes(entry.project_id); onUpdate(entry.id, { unpriced_extra: true }); }
    else    { setAdding(false); setDraft(""); onUpdate(entry.id, { unpriced_extra: false, extra_type_id: null }); }
  };

  const onSelect = (val) => {
    if (val === "__add__") { setAdding(true); return; }
    onUpdate(entry.id, { extra_type_id: val || null });
  };

  const saveNew = async () => {
    const label = draft.trim();
    if (!label) { setAdding(false); return; }
    setBusy(true);
    try {
      const t = await onAddType(entry.project_id, label);
      if (t?.id) onUpdate(entry.id, { extra_type_id: t.id });
      setAdding(false); setDraft("");
    } finally { setBusy(false); }
  };

  const missing = checked && !entry.extra_type_id;
  const ss = selStyle(locked);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 0 6px 2px", flexWrap: "wrap" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#6a8a9a", cursor: locked ? "default" : "pointer" }}>
        <input type="checkbox" checked={checked} disabled={locked}
          onChange={e => toggle(e.target.checked)} />
        Unpriced extra
      </label>

      {checked && !adding && (
        <select value={entry.extra_type_id || ""} disabled={locked}
          onChange={e => onSelect(e.target.value)}
          style={{ ...ss, minWidth: 200, borderColor: missing ? COMPARE_FULL : "#d0d8de" }}>
          <option value="">— Choose type —</option>
          {options.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          <option value="__add__">+ Add new type…</option>
        </select>
      )}

      {checked && adding && (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input autoFocus value={draft} disabled={busy}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") saveNew(); if (e.key === "Escape") { setAdding(false); setDraft(""); } }}
            placeholder="New extra-type…"
            style={{ ...ss, minWidth: 180 }} />
          <button onClick={saveNew} disabled={busy || !draft.trim()}
            style={{ background: draft.trim() ? TIMESHEETS_FULL : "#ccc", color: "#fff", border: "none", padding: "5px 12px", fontSize: 12, cursor: draft.trim() ? "pointer" : "default", fontWeight: 600 }}>
            {busy ? "Saving…" : "Add"}
          </button>
          <button onClick={() => { setAdding(false); setDraft(""); }}
            style={{ background: "none", border: "none", color: "#aaa", fontSize: 16, cursor: "pointer" }}>×</button>
        </span>
      )}

      {missing && !adding && (
        <span style={{ fontSize: 11, color: COMPARE_FULL }}>Choose a type before submitting</span>
      )}
    </div>
  );
}

// ── Saved entry row ────────────────────────────────────────────────────────────

function EntryRow({ entry, projects, recentIds = [], locked, onUpdate, onDelete, extraTypes, onEnsureTypes, onAddType }) {
  const [notes, setNotes] = useState(entry.notes || "");
  useEffect(() => { setNotes(entry.notes || ""); }, [entry.notes]);

  const currentValue = entry.project_id
    ? entry.project_id
    : entry.category ? `cat:${entry.category}` : "";

  const isFull = entry.hours === FULL_DAY.hours && entry.minutes === FULL_DAY.minutes;
  const isHalf = entry.hours === HALF_DAY.hours && entry.minutes === HALF_DAY.minutes;

  const handleProjectChange = (e) => {
    const val = e.target.value;
    // Overtime can be logged on any row (project or category), so it is not cleared here.
    if (val.startsWith("cat:")) onUpdate(entry.id, { project_id: null, category: val.replace("cat:", "") });
    else                        onUpdate(entry.id, { project_id: val || null, category: null });
  };

  const ss = selStyle(locked);
  // The unpriced-extra control is only available in the staff view (where the
  // parent threads onEnsureTypes) and only on project (job) rows.
  const showExtra = !!onEnsureTypes && !!entry.project_id;

  return (
    <div style={{ borderBottom: "1px solid #eef2f4" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
      <ProjectPicker
        value={currentValue}
        onChange={(val) => handleProjectChange({ target: { value: val } })}
        projects={projects}
        recentIds={recentIds}
        disabled={locked}
        style={{ flex: 1, minWidth: 0 }}
      />
      <div style={{ display: "flex", gap: 4 }}>
        <DayShortcut label="Full day" active={isFull} disabled={locked}
          onClick={() => onUpdate(entry.id, { hours: FULL_DAY.hours, minutes: FULL_DAY.minutes })} />
        <DayShortcut label="Half day" active={isHalf} disabled={locked}
          onClick={() => onUpdate(entry.id, { hours: HALF_DAY.hours, minutes: HALF_DAY.minutes })} />
      </div>
      {/* Time worked */}
      <div style={{ width: 132, display: "flex", gap: 8 }}>
        <select value={entry.hours ?? 0}
          onChange={e => onUpdate(entry.id, { hours: parseInt(e.target.value) })}
          disabled={locked} style={{ ...ss, flex: 1, minWidth: 0 }}>
          {HOUR_OPTIONS.map(h => <option key={h} value={h}>{h}h</option>)}
        </select>
        <select value={entry.minutes ?? 0}
          onChange={e => onUpdate(entry.id, { minutes: parseInt(e.target.value) })}
          disabled={locked} style={{ ...ss, flex: 1, minWidth: 0 }}>
          {MINUTE_OPTIONS.map(m => <option key={m} value={m}>{m}m</option>)}
        </select>
      </div>
      {/* Overtime — available on any row (project or category) */}
      <div style={{ width: 132, display: "flex", gap: 8 }}>
        <select value={entry.overtime_hours ?? 0}
          onChange={e => onUpdate(entry.id, { overtime_hours: parseInt(e.target.value) })}
          disabled={locked} title="Overtime hours"
          style={{ ...ss, flex: 1, minWidth: 0, background: "#fbf3e6", borderColor: "#e3cfa6", color: "#8a6a3a" }}>
          {HOUR_OPTIONS.map(h => <option key={h} value={h}>{h}h</option>)}
        </select>
        <select value={entry.overtime_minutes ?? 0}
          onChange={e => onUpdate(entry.id, { overtime_minutes: parseInt(e.target.value) })}
          disabled={locked} title="Overtime minutes"
          style={{ ...ss, flex: 1, minWidth: 0, background: "#fbf3e6", borderColor: "#e3cfa6", color: "#8a6a3a" }}>
          {MINUTE_OPTIONS.map(m => <option key={m} value={m}>{m}m</option>)}
        </select>
      </div>
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
    {showExtra && (
      <UnpricedExtraControl
        entry={entry}
        locked={locked}
        extraTypes={extraTypes}
        onEnsureTypes={onEnsureTypes}
        onAddType={onAddType}
        onUpdate={onUpdate}
      />
    )}
    </div>
  );
}

// ── Day card ───────────────────────────────────────────────────────────────────

function DayCard({ dayLabel, date, entries, projects, recentIds, locked, preLaunch, onAdd, onUpdate, onDelete, onQuickFill, onDraftCreate, extraTypesByProject, onEnsureTypes, onAddType }) {
  const dayTotal  = totalMins(entries);
  const hasReal   = entries.length > 0;
  const showDraft = !hasReal && !locked;
  const single    = entries.length === 1;

  const isFullDay = single && entries[0].hours === FULL_DAY.hours && entries[0].minutes === FULL_DAY.minutes;
  const isHalfDay = single && entries[0].hours === HALF_DAY.hours && entries[0].minutes === HALF_DAY.minutes;

  const quickFillStyle = (active) => ({
    fontSize: 11, padding: "2px 10px", cursor: locked || entries.length > 1 ? "default" : "pointer",
    border: `1px solid ${active ? TIMESHEETS_FULL : "#c0ccd4"}`,
    background: active ? TIMESHEETS_FULL : "#fff",
    color: active ? "#fff" : "#6a8a9a",
    opacity: (locked || entries.length > 1) ? 0.4 : 1,
    fontWeight: active ? 600 : 400,
    letterSpacing: "0.03em",
  });

  return (
    <div style={{ border: "1px solid #dde4e8", background: preLaunch ? "#f3f5f6" : "#fff", marginBottom: 10, opacity: preLaunch ? 0.7 : 1 }}>
      {/* Day header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", background: DESIGN_GROUND, borderBottom: (hasReal || showDraft) ? "1px solid #dde4e8" : "none" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: preLaunch ? "#8a9aa8" : DESIGN_TEXT, flex: 1 }}>{dayLabel}</span>
        {preLaunch && (
          <span style={{ fontSize: 11, color: "#8a9aa8", fontStyle: "italic", letterSpacing: "0.04em" }}>
            Before launch · 1 Jul 2026
          </span>
        )}
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
        {hasReal && <span style={{ fontSize: 12, color: TIMESHEETS_FULL, fontWeight: 500, minWidth: 40, textAlign: "right" }}>{formatMins(dayTotal)}</span>}
      </div>

      {/* Entries */}
      {(hasReal || showDraft) && (
        <div style={{ padding: "4px 14px 0" }}>
          {showDraft
            ? <DraftRow projects={projects} recentIds={recentIds} onCreate={(data) => onDraftCreate(date, data)} />
            : entries.map(e => (
                <EntryRow key={e.id} entry={e} projects={projects} recentIds={recentIds} locked={locked}
                  onUpdate={onUpdate} onDelete={onDelete}
                  extraTypes={extraTypesByProject?.[e.project_id]}
                  onEnsureTypes={onEnsureTypes} onAddType={onAddType} />
              ))
          }
        </div>
      )}

      {dayTotal > DAY_CAP_MINS && (
        <div style={{ padding: "0 14px 10px" }}>
          <div style={{ background: "#fdf0ee", borderLeft: "3px solid #c0392b", padding: "6px 10px", fontSize: 12, color: "#9e2d1e" }}>
            {formatMins(dayTotal)} of time worked — {formatMins(dayTotal - DAY_CAP_MINS)} over the 7h 30m daily limit. Log the extra as Overtime.
          </div>
        </div>
      )}

      {/* Add more button */}
      {!locked && hasReal && (
        <div style={{ padding: "8px 14px" }}>
          <button onClick={() => onAdd(date)}
            style={{ background: "none", border: `1px dashed ${TIMESHEETS_FULL}`, color: TIMESHEETS_FULL, fontSize: 12, padding: "4px 12px", cursor: "pointer" }}>
            + Add
          </button>
        </div>
      )}
    </div>
  );
}

// ── Admin expenses panel ──────────────────────────────────────────────────────

function AdminExpensesPanel({ users }) {
  const [claims,        setClaims]        = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [mileageRate,   setMileageRate]   = useState(45);
  const [editingRate,   setEditingRate]   = useState(false);
  const [newRate,       setNewRate]       = useState("");
  const [filterStatus,  setFilterStatus]  = useState("submitted");
  const [expanded,      setExpanded]      = useState(null);
  const [rejectingId,   setRejectingId]   = useState(null);
  const [rejectReason,  setRejectReason]  = useState("");
  const [toast,         setToast]         = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const userEmail = (uid) => users.find(u => u.id === uid)?.email || (uid ? uid.slice(0, 8) + "…" : "—");
  const fmtMoney = (pence) => `£${((pence || 0) / 100).toFixed(2)}`;

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api(`/api/admin/expense-claims?status=${filterStatus}`),
      api("/api/admin/expenses/settings"),
    ]).then(([cl, settings]) => {
      setClaims(cl || []);
      setMileageRate(settings?.mileage_rate_ppm || 45);
      setNewRate(String(settings?.mileage_rate_ppm || 45));
    }).catch(() => {}).finally(() => setLoading(false));
  }, [filterStatus]);

  const refresh = () => api(`/api/admin/expense-claims?status=${filterStatus}`).then(cl => setClaims(cl || [])).catch(() => {});

  const handleApprove = async (claim) => {
    await api(`/api/admin/expense-claims/${claim.id}/approve`, { method: "POST" });
    await refresh();
    showToast("Claim approved.");
  };

  const handleReject = async (claim) => {
    if (!rejectReason.trim()) return;
    await api(`/api/admin/expense-claims/${claim.id}/reject`, { method: "POST", body: { reason: rejectReason.trim() } });
    setRejectingId(null);
    setRejectReason("");
    await refresh();
    showToast("Claim returned.");
  };

  const handleSaveRate = async () => {
    const rate = parseInt(newRate);
    if (!rate || rate < 1) return;
    await api("/api/admin/expenses/settings", { method: "PUT", body: { mileage_rate_ppm: rate } });
    setMileageRate(rate);
    setEditingRate(false);
    showToast("Mileage rate updated.");
  };

  const openReceipt = async (expId) => {
    try {
      const res = await apiBlob(`/api/expenses/${expId}/receipt`, null, "GET");
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank");
    } catch {}
  };

  const openClaimPdf = async (claimId) => {
    try {
      const res = await apiBlob(`/api/admin/expense-claims/${claimId}/pdf`, null, "GET");
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank");
    } catch { showToast("Could not open the claim PDF."); }
  };

  const formatAmt = (exp) => {
    const p = `£${(exp.amount_pence / 100).toFixed(2)}`;
    return exp.expense_type === "mileage" ? `${p} (${exp.miles} mi)` : p;
  };
  const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const typeLbl = { train:"Train", mileage:"Car Mileage", meals:"Meals", taxi:"Taxi", parking:"Parking" };

  const ss = { padding: "5px 10px", fontSize: 12, border: "1px solid #d0d8de", background: "#fff", color: DESIGN_TEXT, fontFamily: "Inter, Arial, sans-serif" };

  return (
    <div style={{ padding: "0 32px 32px" }}>
      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, background: DESIGN_TEXT, color: "#fff", padding: "10px 20px", fontSize: 13, zIndex: 9999 }}>{toast}</div>}

      {/* Mileage rate setting */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: DESIGN_GROUND, border: "1px solid #dde4e8", marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: "#6a8a9a", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>Mileage Rate</span>
        {!editingRate ? (
          <>
            <span style={{ fontSize: 13, color: DESIGN_TEXT, fontWeight: 600 }}>{mileageRate}p / mile (£{(mileageRate / 100).toFixed(2)})</span>
            <button onClick={() => setEditingRate(true)} style={{ background: "none", border: "none", color: TIMESHEETS_FULL, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Edit</button>
          </>
        ) : (
          <>
            <input type="number" value={newRate} onChange={e => setNewRate(e.target.value)} min="1" max="200"
              style={{ ...ss, width: 80 }} />
            <span style={{ fontSize: 12, color: "#6a8a9a" }}>p/mile</span>
            <button onClick={handleSaveRate} style={{ background: TIMESHEETS_FULL, color: "#fff", border: "none", padding: "4px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Save</button>
            <button onClick={() => setEditingRate(false)} style={{ background: "none", border: "none", color: "#aaa", fontSize: 12, cursor: "pointer" }}>Cancel</button>
          </>
        )}
      </div>

      {/* Filter */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: "#6a8a9a", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>Filter:</span>
        {["submitted", "approved", "rejected", "all"].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            style={{ fontSize: 11, padding: "3px 12px", border: `1px solid ${filterStatus === s ? TIMESHEETS_FULL : "#d0d8de"}`, background: filterStatus === s ? TIMESHEETS_FULL : "#fff", color: filterStatus === s ? "#fff" : "#6a8a9a", cursor: "pointer", textTransform: "capitalize" }}>
            {s}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: "#6a8a9a", fontSize: 13 }}>Loading…</p>}
      {!loading && claims.length === 0 && <p style={{ color: "#6a8a9a", fontSize: 13 }}>No claims found.</p>}

      {claims.map(claim => {
        const items = claim.project_expenses || [];
        const isOpen = expanded === claim.id;
        return (
        <div key={claim.id} style={{ background: "#fff", border: "1px solid #dde4e8", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 16px" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: DESIGN_TEXT, minWidth: 140 }}>{userEmail(claim.user_id)}</span>
            <span style={{ fontSize: 12, color: "#6a8a9a" }}>{items.length} item(s)</span>
            <span style={{ fontSize: 12, color: "#6a8a9a" }}>{claim.submitted_at ? fmtDate(claim.submitted_at.slice(0, 10)) : ""}</span>
            <span style={{ fontSize: 13, color: TIMESHEETS_FULL, fontWeight: 700 }}>{fmtMoney(claim.total_pence)}</span>
            <button onClick={() => setExpanded(isOpen ? null : claim.id)}
              style={{ fontSize: 11, color: "#6a8a9a", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
              {isOpen ? "Hide items" : "View items"}
            </button>
            <button onClick={() => openClaimPdf(claim.id)}
              style={{ fontSize: 11, color: TIMESHEETS_FULL, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
              📄 PDF
            </button>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
              {claim.status === "submitted" && rejectingId !== claim.id && (
                <>
                  <button onClick={() => handleApprove(claim)}
                    style={{ background: TIMESHEETS_FULL, color: "#fff", border: "none", padding: "4px 12px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                    Approve
                  </button>
                  <button onClick={() => { setRejectingId(claim.id); setRejectReason(""); }}
                    style={{ background: "#fff", border: `1px solid ${COMPARE_FULL}`, color: COMPARE_FULL, padding: "4px 12px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                    Reject
                  </button>
                </>
              )}
              {claim.status === "submitted" && rejectingId === claim.id && (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input autoFocus value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                    placeholder="Reason…"
                    style={{ fontSize: 11, padding: "3px 8px", border: "1px solid #d0d8de", width: 180 }}
                  />
                  <button onClick={() => handleReject(claim)} disabled={!rejectReason.trim()}
                    style={{ background: rejectReason.trim() ? COMPARE_FULL : "#ccc", color: "#fff", border: "none", padding: "3px 10px", fontSize: 11, cursor: rejectReason.trim() ? "pointer" : "default", fontWeight: 600 }}>
                    Send
                  </button>
                  <button onClick={() => setRejectingId(null)}
                    style={{ background: "none", border: "none", color: "#aaa", fontSize: 16, cursor: "pointer" }}>×</button>
                </div>
              )}
              {claim.status !== "submitted" && (
                <span style={{ fontSize: 11, fontWeight: 600, color: claim.status === "approved" ? "#2e7d32" : "#9e4a3a", textTransform: "uppercase" }}>
                  {claim.status === "rejected" ? "returned" : claim.status}
                </span>
              )}
            </div>
          </div>
          {claim.status === "rejected" && claim.rejection_reason && (
            <div style={{ margin: "0 16px 10px", padding: "5px 10px", background: "#fdf0ee", borderLeft: "3px solid #9e4a3a", fontSize: 11, color: "#9e4a3a" }}>
              <strong>Returned: </strong>{claim.rejection_reason}
            </div>
          )}
          {isOpen && items.map(item => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "8px 16px", borderTop: "1px solid #eef2f4" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: DESIGN_TEXT, minWidth: 90 }}>{typeLbl[item.expense_type] || item.expense_type}</span>
              <span style={{ fontSize: 11, color: "#6a8a9a" }}>{fmtDate(item.expense_date)}</span>
              <span style={{ fontSize: 12, color: TIMESHEETS_FULL, fontWeight: 600 }}>{formatAmt(item)}</span>
              <span style={{ fontSize: 11, color: "#8a9aa8", minWidth: 120 }}>
                {item.projects?.job_number ? `${item.projects.job_number} — ${item.projects.name}` : item.projects?.name}
              </span>
              <span style={{ fontSize: 11, color: "#6a8a9a", flex: 1, fontStyle: "italic" }}>{item.description}</span>
              {item.receipt_key && (
                <button onClick={() => openReceipt(item.id)}
                  style={{ fontSize: 12, color: TIMESHEETS_FULL, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  📎 receipt
                </button>
              )}
            </div>
          ))}
        </div>
        );
      })}
    </div>
  );
}

// ── Admin review panel ────────────────────────────────────────────────────────

function AdminPanel({ projects, isAdmin }) {
  const [submissions,     setSubmissions]     = useState([]);
  const [users,           setUsers]           = useState([]);
  const [expanded,        setExpanded]        = useState(null);
  const [expandedEntries, setExpandedEntries] = useState({});
  const [filterUser,      setFilterUser]      = useState("");
  const [filterFrom,      setFilterFrom]      = useState("");
  const [filterTo,        setFilterTo]        = useState("");
  const [loading,         setLoading]         = useState(false);
  const [toast,           setToast]           = useState(null);
  const [rejectingKey,    setRejectingKey]    = useState(null);
  const [rejectReason,    setRejectReason]    = useState("");
  const [adminView,       setAdminView]       = useState("timesheets"); // "timesheets" | "expenses"
  const [outstanding,     setOutstanding]     = useState(null); // { currentWeek, trackFrom, weeks: [{week, expected, outstanding}] }
  const [openWeeks,       setOpenWeeks]       = useState({});   // { [week_start]: true }
  const [remindingWeek,   setRemindingWeek]   = useState(null); // week awaiting reminder confirm
  const [sendingWeek,     setSendingWeek]     = useState(null); // week with a reminder send in flight
  const openInitRef = useRef(false);

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
    // Tallies degrade gracefully: on failure the weeks still render from submissions alone.
    api("/api/admin/timesheets/outstanding").then(setOutstanding).catch(() => setOutstanding(null));
  }, []);

  // Once data arrives, open the weeks that need attention (submitted / unlock requested).
  useEffect(() => {
    if (openInitRef.current || (!submissions.length && !outstanding)) return;
    openInitRef.current = true;
    const open = {};
    for (const s of submissions) if (s.status === "submitted" || s.unlock_requested) open[s.week_start] = true;
    setOpenWeeks(open);
  }, [submissions, outstanding]);

  const userEmail = (uid) => users.find(u => u.id === uid)?.email || uid.slice(0, 8) + "…";

  const filtered = submissions.filter(s => {
    if (filterUser && s.user_id !== filterUser) return false;
    if (filterFrom && s.week_start < filterFrom) return false;
    if (filterTo   && s.week_start > filterTo)   return false;
    return true;
  });

  // Group rows by week, newest first. Tracked weeks (from the outstanding endpoint)
  // always appear — even with no rows; older weeks with submissions render without
  // a tally. The staff filter narrows rows but the tally stays office-wide.
  const weekInfoMap = {};
  for (const w of outstanding?.weeks || []) weekInfoMap[w.week] = w;
  const subsByWeek = {};
  for (const s of filtered) (subsByWeek[s.week_start] ||= []).push(s);
  const weekGroups = [...new Set([...Object.keys(weekInfoMap), ...Object.keys(subsByWeek)])]
    .filter(w => (!filterFrom || w >= filterFrom) && (!filterTo || w <= filterTo))
    .sort((a, b) => b.localeCompare(a))
    .map(week => ({ week, weekSubs: subsByWeek[week] || [], info: weekInfoMap[week] }));

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

  const handleReject = async (sub) => {
    if (!rejectReason.trim()) return;
    await api("/api/admin/timesheets/reject", { method: "POST", body: { week: sub.week_start, user_id: sub.user_id, reason: rejectReason.trim() } });
    setSubmissions(prev => prev.map(s =>
      s.user_id === sub.user_id && s.week_start === sub.week_start ? { ...s, status: "draft" } : s
    ));
    setRejectingKey(null);
    setRejectReason("");
    showToast("Timesheet returned to staff for correction.");
  };

  const handleUnlock = async (sub) => {
    await api("/api/admin/timesheets/unlock", { method: "POST", body: { week: sub.week_start, user_id: sub.user_id } });
    setSubmissions(prev => prev.map(s =>
      s.user_id === sub.user_id && s.week_start === sub.week_start
        ? { ...s, status: "draft", unlock_requested: false, unlock_reason: null }
        : s
    ));
    showToast("Timesheet unlocked for editing.");
  };

  const handleRemind = async (week, count) => {
    setSendingWeek(week);
    try {
      const resp = await api("/api/admin/timesheets/remind", { method: "POST", body: { week } });
      const n = resp?.sent ?? count;
      showToast(`Reminder sent to ${n} staff member${n === 1 ? "" : "s"}.`);
    } catch {
      showToast("Could not send reminders — please try again.");
    } finally {
      setSendingWeek(null);
      setRemindingWeek(null);
    }
  };

  const ss = { padding: "5px 10px", fontSize: 12, border: "1px solid #d0d8de", background: "#fff", color: DESIGN_TEXT, fontFamily: "Inter, Arial, sans-serif" };

  return (
    <div style={{ padding: "0 32px 32px" }}>
      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, background: DESIGN_TEXT, color: "#fff", padding: "10px 20px", fontSize: 13, zIndex: 9999 }}>{toast}</div>}

      {/* Admin-only: view toggle (timesheets/expenses). HR sees timesheets only. Notification settings moved to Admin → Notifications. */}
      {isAdmin && (
        <div style={{ padding: "16px 0 0", display: "flex", gap: 0, marginBottom: 16 }}>
          {["timesheets", "expenses"].map(v => (
            <button key={v} onClick={() => setAdminView(v)}
              style={{
                fontSize: 12, padding: "7px 20px", border: `1px solid ${TIMESHEETS_FULL}`,
                background: adminView === v ? TIMESHEETS_FULL : "#fff",
                color: adminView === v ? "#fff" : TIMESHEETS_FULL,
                cursor: "pointer", fontWeight: 600, textTransform: "capitalize",
                marginRight: v === "timesheets" ? -1 : 0,
              }}>
              {v}
            </button>
          ))}
        </div>
      )}

      {adminView === "timesheets" && (
        <>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20, padding: "14px 16px", background: DESIGN_GROUND, border: "1px solid #dde4e8" }}>
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
                style={{ background: "none", border: "none", color: COMPARE_FULL, fontSize: 12, cursor: "pointer" }}>Clear</button>
            )}
          </div>

          {loading && <p style={{ color: "#6a8a9a", fontSize: 13 }}>Loading…</p>}
          {!loading && weekGroups.length === 0 && <p style={{ color: "#6a8a9a", fontSize: 13 }}>No submissions found.</p>}

          {!loading && weekGroups.map(({ week, weekSubs, info }) => {
            const isWkOpen = !!openWeeks[week];
            const mon      = new Date(week);
            const fri      = new Date(mon); fri.setDate(fri.getDate() + 4);
            const o        = { day: "numeric", month: "short" };
            const weekStr  = `${mon.toLocaleDateString("en-GB", o)} – ${fri.toLocaleDateString("en-GB", { ...o, year: "numeric" })}`;
            const missing  = info ? info.outstanding : [];
            const allIn    = info && missing.length === 0;
            const isCurrent = outstanding && week === outstanding.currentWeek;

            return (
              <div key={week} style={{ marginBottom: 12 }}>
                <div onClick={() => setOpenWeeks(p => ({ ...p, [week]: !p[week] }))}
                  style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 16px", cursor: "pointer", border: "1px solid #dde4e8", background: isWkOpen ? DESIGN_GROUND : "#fff" }}>
                  <span style={{ fontSize: 14, color: DESIGN_TEXT, fontWeight: 700 }}>{weekStr}</span>
                  {isCurrent && (
                    <span style={{ fontSize: 10, color: "#8a9aa8", fontWeight: 600, letterSpacing: "0.06em" }}>IN PROGRESS</span>
                  )}
                  {info && (
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "3px 10px",
                      color: allIn ? "#2e7d32" : COMPARE_FULL,
                      background: allIn ? "#e8f5e9" : "#fdeeec",
                      border: `1px solid ${allIn ? "#2e7d32" : COMPARE_FULL}44`,
                    }}>
                      {info.expected - missing.length} of {info.expected} submitted
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", color: "#aaa", fontSize: 14 }}>{isWkOpen ? "▲" : "▼"}</span>
                </div>

                {isWkOpen && weekSubs.length === 0 && (
                  <p style={{ color: "#8a9aa8", fontSize: 12, margin: 0, padding: "10px 16px", border: "1px solid #dde4e8", borderTop: "none", background: "#fff" }}>
                    No timesheets saved for this week yet.
                  </p>
                )}

                {isWkOpen && weekSubs.map(sub => {
            const key     = `${sub.user_id}|${sub.week_start}`;
            const isOpen  = expanded === key;
            const entries = expandedEntries[key] || [];
            const wTotal  = totalMins(entries);

            return (
              <div key={key} style={{ border: "1px solid #dde4e8", borderTop: "none", background: "#fff" }}>
                <div onClick={() => toggleExpand(key, sub.user_id, sub.week_start)}
                  style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 16px", cursor: "pointer", background: isOpen ? DESIGN_GROUND : "#fff" }}>
                  <span style={{ fontSize: 13, color: DESIGN_TEXT, fontWeight: 600, minWidth: 200 }}>{userEmail(sub.user_id)}</span>
                  {isOpen && entries.length > 0 && (
                    <span style={{ fontSize: 12, color: TIMESHEETS_FULL, fontWeight: 500 }}>{formatMins(wTotal)}</span>
                  )}
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                    <StatusBadge status={sub.status} />
                    {sub.status === "submitted" && rejectingKey !== key && (
                      <>
                        <button onClick={e => { e.stopPropagation(); handleApprove(sub); }}
                          style={{ background: TIMESHEETS_FULL, color: "#fff", border: "none", padding: "4px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                          Approve
                        </button>
                        <button onClick={e => { e.stopPropagation(); setRejectingKey(key); setRejectReason(""); }}
                          style={{ background: "#fff", border: `1px solid ${COMPARE_FULL}`, color: COMPARE_FULL, padding: "4px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                          Reject
                        </button>
                      </>
                    )}
                    {sub.status === "submitted" && rejectingKey === key && (
                      <div onClick={e => e.stopPropagation()} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                          autoFocus
                          value={rejectReason}
                          onChange={e => setRejectReason(e.target.value)}
                          placeholder="Reason for rejection…"
                          style={{ fontSize: 12, padding: "3px 8px", border: "1px solid #d0d8de", width: 200 }}
                        />
                        <button onClick={() => handleReject(sub)} disabled={!rejectReason.trim()}
                          style={{ background: rejectReason.trim() ? COMPARE_FULL : "#ccc", color: "#fff", border: "none", padding: "4px 10px", fontSize: 12, cursor: rejectReason.trim() ? "pointer" : "default", fontWeight: 600 }}>
                          Send
                        </button>
                        <button onClick={() => setRejectingKey(null)}
                          style={{ background: "none", border: "none", color: "#aaa", fontSize: 16, cursor: "pointer", padding: "0 4px" }}>×</button>
                      </div>
                    )}
                    {sub.unlock_requested && (
                      <>
                        <span style={{ fontSize: 10, background: "#fff8e1", color: "#b07800", border: "1px solid #b0780044", padding: "2px 8px", letterSpacing: ".05em", fontWeight: 600 }}>
                          EDIT REQUESTED
                        </span>
                        <button onClick={e => { e.stopPropagation(); handleUnlock(sub); }}
                          style={{ background: TIMESHEETS_FULL, color: "#fff", border: "none", padding: "4px 12px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                          Unlock
                        </button>
                      </>
                    )}
                    <span style={{ color: "#aaa", fontSize: 14 }}>{isOpen ? "▲" : "▼"}</span>
                  </div>
                </div>

                {isOpen && (
                  <div style={{ padding: "12px 16px", borderTop: "1px solid #eef2f4" }}>
                    {sub.unlock_reason && (
                      <div style={{ marginBottom: 10, padding: "8px 12px", background: "#fff8e1", borderLeft: "3px solid #b07800", fontSize: 12 }}>
                        <strong style={{ color: "#b07800" }}>Edit request: </strong>
                        <span style={{ color: "#4a5a6a" }}>{sub.unlock_reason}</span>
                      </div>
                    )}
                    {totalOtMins(entries) > 0 && (
                      <div style={{ marginBottom: 10, fontSize: 12, fontWeight: 600, color: "#8a6a3a" }}>
                        Overtime this week: {formatMins(totalOtMins(entries))}
                      </div>
                    )}
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
                            <span style={{ fontSize: 12, color: TIMESHEETS_FULL }}>{formatMins(dTotal)}</span>
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

                {isWkOpen && missing.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 16px", background: "#fdf6f5", border: "1px solid #dde4e8", borderTop: `1px dashed ${COMPARE_FULL}66` }}>
                    <strong style={{ fontSize: 12, color: COMPARE_FULL }}>Not submitted ({missing.length}):</strong>
                    {missing.map(m => (
                      <span key={m.id} style={{ fontSize: 11, fontWeight: 600, color: COMPARE_FULL, background: "#fdeeec", border: `1px solid ${COMPARE_FULL}44`, padding: "2px 10px" }}>
                        {m.name}
                      </span>
                    ))}
                    <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                      {remindingWeek !== week && (
                        <button onClick={() => setRemindingWeek(week)} disabled={sendingWeek === week}
                          style={{ background: COMPARE_FULL, color: "#fff", border: "none", padding: "4px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                          {sendingWeek === week ? "Sending…" : `Send reminder to ${missing.length} staff`}
                        </button>
                      )}
                      {remindingWeek === week && (
                        <>
                          <button onClick={() => handleRemind(week, missing.length)} disabled={sendingWeek === week}
                            style={{ background: COMPARE_FULL, color: "#fff", border: "none", padding: "4px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                            {sendingWeek === week ? "Sending…" : `Confirm — email ${missing.length} staff`}
                          </button>
                          <button onClick={() => setRemindingWeek(null)}
                            style={{ background: "none", border: "none", color: "#aaa", fontSize: 16, cursor: "pointer", padding: "0 4px" }}>×</button>
                        </>
                      )}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {isAdmin && adminView === "expenses" && <AdminExpensesPanel users={users} />}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TimesheetsSection({ isAdmin, isHr }) {
  const canReview = isAdmin || isHr; // admin or HR can review all staff timesheets
  const [subView,    setSubView]    = useState(null); // null | "history" | "report" | "fee"
  const [view,       setView]       = useState("mine");
  const [monday,     setMonday]     = useState(getMonday(new Date()));
  const [projects,   setProjects]   = useState([]);
  const [recentIds,  setRecentIds]  = useState([]);
  const [extraTypesByProject, setExtraTypesByProject] = useState({}); // projectId → [{ id, label }]
  const extraLoadRef = useRef({}); // projectId → true once a fetch has started (dedupe)
  const [entries,    setEntries]    = useState([]);
  const [submission, setSubmission] = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [toast,         setToast]         = useState(null);
  const [dialog,        setDialog]        = useState(null); // { title, message, onConfirm }
  const [fillProject,   setFillProject]   = useState("");
  const [fillOpen,      setFillOpen]      = useState(false);
  const [filling,       setFilling]       = useState(false);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [unlockReason,     setUnlockReason]     = useState("");
  const [unlocking,        setUnlocking]        = useState(false);
  const [activeTab,        setActiveTab]        = useState("timesheet"); // "timesheet" | "expenses"

  const weekKey  = isoDate(monday);
  const isLocked = submission?.status === "submitted" || submission?.status === "approved";

  const showToast = useCallback((msg) => {
    setToast(msg); setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    api("/api/projects").then(data => setProjects(data?.projects || [])).catch(() => {});
    api("/api/timesheets/recent-projects").then(r => setRecentIds(r?.project_ids || [])).catch(() => {});
    // Open on the earliest unsubmitted week (or the next week if all are done) —
    // once, on page open; the arrows navigate freely afterwards.
    api("/api/timesheets/first-outstanding").then(r => {
      if (r?.week) setMonday(getMonday(new Date(r.week + "T12:00:00")));
    }).catch(() => {});
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

  // Lazy-load a project's unpriced-extra types once, caching by project id.
  const ensureExtraTypes = useCallback(async (projectId) => {
    if (!projectId || extraLoadRef.current[projectId]) return;
    extraLoadRef.current[projectId] = true;
    try {
      const res = await api(`/api/projects/${projectId}/extra-types`);
      setExtraTypesByProject(prev => ({ ...prev, [projectId]: res?.extra_types || [] }));
    } catch { extraLoadRef.current[projectId] = false; }
  }, []);

  // Add a new extra-type to a project (server dedupes), update the cache, return the row.
  const addExtraType = useCallback(async (projectId, label) => {
    try {
      const res = await api(`/api/projects/${projectId}/extra-types`, { method: "POST", body: { label } });
      const t = res?.extra_type;
      if (t?.id) {
        extraLoadRef.current[projectId] = true;
        setExtraTypesByProject(prev => {
          const listForProject = prev[projectId] || [];
          if (listForProject.some(x => x.id === t.id)) return prev;
          return { ...prev, [projectId]: [...listForProject, t].sort((a, b) => a.label.localeCompare(b.label)) };
        });
      }
      return t;
    } catch { showToast("Could not add extra-type."); return null; }
  }, [showToast]);

  // Delete with confirmation dialog
  const handleDeleteWithConfirm = useCallback((id) => {
    setDialog({
      title: "Remove entry?",
      message: "This entry will be permanently deleted and cannot be undone.",
      confirmLabel: "Remove",
      onConfirm: () => { setDialog(null); handleDelete(id); },
    });
  }, [handleDelete]);

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

  // Apply one project across all empty days in the week
  const handleFillWeek = useCallback(async () => {
    if (!fillProject) return;
    const project_id = fillProject.startsWith("cat:") ? null : fillProject;
    const category   = fillProject.startsWith("cat:") ? fillProject.replace("cat:", "") : null;
    setFilling(true);
    try {
      for (let di = 0; di < 5; di++) {
        const date = dateForDay(monday, di);
        if (isBeforeLaunch(date)) continue; // never write to pre-launch (locked) days
        if (entries.some(e => e.entry_date === date)) continue; // skip days already filled
        const data = await api("/api/timesheets", {
          method: "POST",
          body: { entry_date: date, project_id, category, hours: FULL_DAY.hours, minutes: FULL_DAY.minutes },
        });
        if (data?.id) setEntries(prev => [...prev, data]);
      }
    } catch { showToast("Could not apply to all days."); }
    finally { setFilling(false); setFillOpen(false); setFillProject(""); }
  }, [fillProject, monday, entries, showToast]);

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

  const handleUnlockRequest = useCallback(async () => {
    if (!unlockReason.trim()) return;
    setUnlocking(true);
    try {
      await api("/api/timesheets/unlock-request", { method: "POST", body: { week: weekKey, reason: unlockReason.trim() } });
      setSubmission(prev => ({ ...prev, unlock_requested: true }));
      setShowUnlockDialog(false);
      setUnlockReason("");
      showToast("Edit request sent to admin.");
    } catch {
      showToast("Could not send request.");
    } finally {
      setUnlocking(false);
    }
  }, [unlockReason, weekKey, showToast]);

  const overCapDays = (() => {
    const byDay = {};
    entries.forEach(e => { byDay[e.entry_date] = (byDay[e.entry_date] || 0) + entryMins(e); });
    return Object.keys(byDay).filter(d => byDay[d] > DAY_CAP_MINS).sort();
  })();

  // Lines ticked as an unpriced extra but with no extra-type chosen — blocks submit.
  const extrasNeedType = entries.filter(e => e.unpriced_extra && !e.extra_type_id);

  // The launch week (and any fully-past week) contains days before go-live, so it
  // physically can't reach 37.5h — exempt it from the minimum-hours warning.
  const weekHasPreLaunch = isoDate(monday) < LAUNCH_DATE;

  // The over-hours warning (soft confirm), run after any earlier gates.
  const proceedToSubmit = () => {
    const total = totalMins(entries);
    if (total > OVER_WEEK_MINS) {
      setDialog({
        title: "Over standard hours",
        message: `Your total for this week is ${formatMins(total)}, which is above 45 hours. Are you sure you want to submit?`,
        onConfirm: doSubmit,
      });
    } else {
      doSubmit();
    }
  };

  const handleSubmitClick = () => {
    if (overCapDays.length) {
      showToast("Some days are over the 7h 30m daily limit — move the extra to Overtime.");
      return;
    }
    if (extrasNeedType.length) {
      showToast("Some 'unpriced extra' lines have no type selected — choose one before submitting.");
      return;
    }
    // HARD BLOCK: a week under 37.5h cannot be submitted (the server rejects it too).
    // The launch week is exempt — it contains locked pre-launch days.
    {
      const total = totalMins(entries);
      if (total < MIN_WEEK_MINS && !weekHasPreLaunch) {
        setDialog({
          title: "Week not complete",
          message: `Your week totals ${formatMins(total)} — a full week of 37.5 hours must be accounted for before it can be submitted. Remember that holiday, sickness and other leave all count: add a line for any day you weren't working, then submit.`,
          confirmLabel: "I understand",
          hideCancel: true,
          onConfirm: () => setDialog(null),
        });
        return;
      }
    }
    // Reminder (non-blocking) shown only when the week contains unpriced extras —
    // detailed notes are what get used to raise the fee variation.
    if (entries.some(e => e.unpriced_extra)) {
      setDialog({
        title: "Unpriced extras logged this week",
        message: "You've marked some time as unpriced extras. Please make sure the note on each extra describes the work as fully as possible — these notes are used to raise the fee variation. Go back to check, or submit now.",
        confirmLabel: "Submit anyway",
        onConfirm: proceedToSubmit,
      });
      return;
    }
    proceedToSubmit();
  };

  const weekTotal  = totalMins(entries);
  const weekOt     = totalOtMins(entries);
  const underMin   = weekTotal < MIN_WEEK_MINS && weekTotal > 0 && !weekHasPreLaunch;
  const btnBase    = { fontSize: 12, padding: "5px 16px", cursor: "pointer", fontFamily: "Inter, Arial, sans-serif", fontWeight: 600, border: "none" };

  // Render sub-views first
  if (subView === "history") return <TimesheetHistory onBack={() => setSubView(null)} />;
  if (subView === "report")  return <TimesheetReport  onBack={() => setSubView(null)} />;
  if (subView === "fee" && isAdmin) return <FeeReview onBack={() => setSubView(null)} />;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: DESIGN_GROUND }}>
      <div style={{ background: TIMESHEETS_FULL, padding:"12px 40px", display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
        <span style={{ fontSize:11, fontWeight:500, color:"#fff", letterSpacing:".16em", textTransform:"uppercase" }}>Timesheets</span>
        <span style={{ fontSize:9, fontWeight:500, color:"rgba(255,255,255,0.45)", letterSpacing:".14em", textTransform:"uppercase" }}>— Practice Management</span>
      </div>
      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: DESIGN_TEXT, color: "#fff", padding: "10px 20px", fontSize: 13, zIndex: 9999 }}>{toast}</div>
      )}
      {dialog && (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          onConfirm={dialog.onConfirm}
          onCancel={() => setDialog(null)}
          hideCancel={dialog.hideCancel}
        />
      )}
      {showUnlockDialog && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9998 }}>
          <div style={{ background: "#fff", padding: 28, maxWidth: 440, width: "90%", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 600, color: DESIGN_TEXT }}>Request to Edit Timesheet</h3>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "#4a5a6a", lineHeight: 1.6 }}>
              Explain why you need to edit this week. Your request will be sent to the admin for approval.
            </p>
            <textarea value={unlockReason} onChange={e => setUnlockReason(e.target.value)}
              placeholder="e.g. I put the wrong project on Tuesday"
              rows={3}
              style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #d0d8de", resize: "vertical", fontFamily: "Inter, Arial, sans-serif", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button onClick={() => { setShowUnlockDialog(false); setUnlockReason(""); }}
                style={{ background: "#fff", border: "1px solid #e4e4e8", color: "#666", padding: "7px 18px", fontSize: 13, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={handleUnlockRequest} disabled={!unlockReason.trim() || unlocking}
                style={{ background: unlockReason.trim() ? TIMESHEETS_FULL : "#ccc", border: "none", color: "#fff", padding: "7px 18px", fontSize: 13, cursor: unlockReason.trim() ? "pointer" : "default", fontWeight: 600 }}>
                {unlocking ? "Sending…" : "Send Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #dde4e8", padding: "16px 32px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 300, color: DESIGN_TEXT, letterSpacing: "0.02em" }}>Timesheets</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* View History button — visible to all users */}
            <button onClick={() => setSubView("history")}
              style={{ ...btnBase, background: "#fff", color: TIMESHEETS_FULL, border: `1px solid ${TIMESHEETS_FULL}`, padding: "5px 16px", fontSize: 12 }}>
              View History
            </button>
            {/* Admin/HR: Reports button + My/Admin toggle (Fee Review is admin-only) */}
            {canReview && (
              <>
                <button onClick={() => setSubView("report")}
                  style={{ ...btnBase, background: DESIGN_TEXT, color: "#fff", border: "none", padding: "5px 16px", fontSize: 12 }}>
                  Reports & Analytics
                </button>
                {isAdmin && (
                  <button onClick={() => setSubView("fee")}
                    style={{ ...btnBase, background: COMPARE_FULL, color: "#fff", border: "none", padding: "5px 16px", fontSize: 12 }}>
                    Fee Review
                  </button>
                )}
                <div style={{ display: "flex", border: `1px solid ${TIMESHEETS_FULL}` }}>
                  {["mine", "admin"].map(v => (
                    <button key={v} onClick={() => setView(v)}
                      style={{ ...btnBase, background: view === v ? TIMESHEETS_FULL : "#fff", color: view === v ? "#fff" : TIMESHEETS_FULL, padding: "5px 20px" }}>
                      {v === "mine" ? "My Timesheets" : "Admin Review"}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {view === "mine" && (
        <div style={{ background: "#fff", display: "flex", borderBottom: "2px solid #e0e4e8", flexShrink: 0 }}>
          {[{ key: "timesheet", label: "My Timesheet" }, { key: "expenses", label: "My Expenses" }].map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              style={{
                fontSize: 12, padding: "9px 20px", border: "none", background: "none", cursor: "pointer",
                color: activeTab === tab.key ? TIMESHEETS_FULL : "#8a9aa8",
                fontWeight: activeTab === tab.key ? 700 : 500,
                borderBottom: activeTab === tab.key ? `2px solid ${TIMESHEETS_FULL}` : "2px solid transparent",
                marginBottom: -2, fontFamily: "Inter, Arial, sans-serif",
              }}>
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {view === "admin" ? (
          <>
            <div style={{ padding: "24px 32px 8px" }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: DESIGN_TEXT, letterSpacing: "0.04em", textTransform: "uppercase" }}>Staff Timesheets</h3>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6a8a9a" }}>Review and approve submitted timesheets. Click a row to expand and amend entries.</p>
            </div>
            <AdminPanel projects={projects} isAdmin={isAdmin} />
          </>
        ) : (
          <>
          {activeTab === "timesheet" && (
          <div style={{ padding: "24px 32px" }}>

            {submission?.status === "draft" && submission?.rejection_reason && (
              <div style={{ marginBottom: 16, padding: "10px 16px", background: "#fdf0ee", borderLeft: `4px solid ${COMPARE_FULL}` }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: COMPARE_FULL }}>Timesheet returned for correction — </span>
                <span style={{ fontSize: 13, color: "#4a5a6a" }}>{submission.rejection_reason}</span>
              </div>
            )}

            {/* Week navigator */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
              <button onClick={prevWeek} style={{ ...btnBase, background: "#fff", color: DESIGN_TEXT, border: "1px solid #dde4e8", padding: "5px 12px", fontSize: 16 }}>‹</button>
              <span style={{ fontSize: 15, fontWeight: 500, color: DESIGN_TEXT, minWidth: 220, textAlign: "center" }}>{formatWeekLabel(monday)}</span>
              <button onClick={nextWeek} style={{ ...btnBase, background: "#fff", color: DESIGN_TEXT, border: "1px solid #dde4e8", padding: "5px 12px", fontSize: 16 }}>›</button>
              <StatusBadge status={submission?.status || "draft"} />
            </div>

            {loading && <p style={{ color: "#6a8a9a", fontSize: 13 }}>Loading…</p>}

            {!loading && (
              <>
                {/* Column headers */}
                <div style={{ display: "flex", gap: 8, padding: "0 14px 6px", fontSize: 11, color: "#8a9aa8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  <span style={{ flex: 1 }}>Project / Category</span>
                  <span style={{ width: 132, textAlign: "center" }}>Time worked</span>
                  <span style={{ width: 132, textAlign: "center", color: "#8a6a3a" }}>Overtime</span>
                  <span style={{ flex: 1 }}>Notes</span>
                  <span style={{ width: 28 }} />
                </div>

                {/* Apply to whole week */}
                {!isLocked && (
                  <div style={{ marginBottom: 12, border: "1px solid #dde4e8", background: "#fff" }}>
                    <button
                      onClick={() => setFillOpen(o => !o)}
                      style={{ ...btnBase, width: "100%", textAlign: "left", background: "none", color: "#6a8a9a", padding: "9px 14px", fontSize: 12, display: "flex", alignItems: "center", gap: 8, border: "none" }}>
                      <span style={{ fontSize: 14 }}>{fillOpen ? "▲" : "▼"}</span>
                      Apply one project to whole week
                    </button>
                    {fillOpen && (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px 12px", borderTop: "1px solid #eef2f4", flexWrap: "wrap" }}>
                        <ProjectPicker
                          value={fillProject}
                          onChange={setFillProject}
                          projects={projects}
                          recentIds={recentIds}
                          style={{ flex: 1, minWidth: 220 }}
                        />
                        <span style={{ fontSize: 12, color: "#8a9aa8" }}>Full day (7h 30m) on empty days only</span>
                        <button
                          onClick={handleFillWeek}
                          disabled={!fillProject || filling}
                          style={{ ...btnBase, background: fillProject ? TIMESHEETS_FULL : "#ccc", color: "#fff", padding: "6px 18px", fontSize: 12, cursor: fillProject ? "pointer" : "default" }}>
                          {filling ? "Applying…" : "Apply to all days"}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Day cards */}
                {DAYS.map((day, di) => {
                  const date = dateForDay(monday, di);
                  const dayPreLaunch = isBeforeLaunch(date);
                  return (
                    <DayCard
                      key={day}
                      dayLabel={formatDayLabel(monday, di)}
                      date={date}
                      entries={dayEntries(date)}
                      projects={projects}
                      recentIds={recentIds}
                      locked={isLocked || dayPreLaunch}
                      preLaunch={dayPreLaunch}
                      onAdd={handleAdd}
                      onUpdate={handleUpdate}
                      onDelete={handleDeleteWithConfirm}
                      onQuickFill={handleQuickFill}
                      onDraftCreate={handleDraftCreate}
                      extraTypesByProject={extraTypesByProject}
                      onEnsureTypes={ensureExtraTypes}
                      onAddType={addExtraType}
                    />
                  );
                })}

                {/* Footer */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, padding: "14px 16px", background: "#fff", border: "1px solid #dde4e8" }}>
                  <div>
                    <span style={{ fontSize: 14, color: DESIGN_TEXT, fontWeight: 600 }}>
                      Week total: <span style={{ color: underMin && !isLocked ? COMPARE_FULL : TIMESHEETS_FULL }}>{formatMins(weekTotal)}</span>
                    </span>
                    {weekOt > 0 && (
                      <span style={{ marginLeft: 16, fontSize: 13, color: "#8a6a3a", fontWeight: 600 }}>
                        Overtime: {formatMins(weekOt)}
                      </span>
                    )}
                    {underMin && !isLocked && (
                      <span style={{ marginLeft: 12, fontSize: 12, color: COMPARE_FULL }}>
                        ⚠ Below 37.5h minimum
                      </span>
                    )}
                    {overCapDays.length > 0 && !isLocked && (
                      <span style={{ marginLeft: 12, fontSize: 12, color: "#c0392b", fontWeight: 600 }}>
                        ⚠ {overCapDays.map(dayName).join(", ")} over the 7h 30m daily limit — move extra to Overtime
                      </span>
                    )}
                    {extrasNeedType.length > 0 && !isLocked && (
                      <span style={{ marginLeft: 12, fontSize: 12, color: COMPARE_FULL, fontWeight: 600 }}>
                        ⚠ {extrasNeedType.length} unpriced-extra line{extrasNeedType.length !== 1 ? "s" : ""} need a type selected
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {!isLocked && (
                      <button onClick={handleSubmitClick} disabled={submitting || entries.length === 0 || overCapDays.length > 0 || extrasNeedType.length > 0}
                        style={{ ...btnBase, background: (entries.length === 0 || overCapDays.length > 0 || extrasNeedType.length > 0) ? "#ccc" : TIMESHEETS_FULL, color: "#fff", padding: "8px 24px", fontSize: 13, cursor: (entries.length === 0 || overCapDays.length > 0 || extrasNeedType.length > 0) ? "default" : "pointer" }}>
                        {submitting ? "Submitting…" : "Submit for Approval"}
                      </button>
                    )}
                    {submission?.status === "submitted" && (
                      <>
                        <span style={{ fontSize: 13, color: "#b07800" }}>Awaiting approval</span>
                        {!submission?.unlock_requested
                          ? <button onClick={() => setShowUnlockDialog(true)}
                              style={{ background: "#fff", color: "#8a9aa8", border: "1px solid #dde4e8", padding: "5px 12px", fontSize: 11, cursor: "pointer" }}>
                              Request to Edit
                            </button>
                          : <span style={{ fontSize: 12, color: "#8a9aa8", fontStyle: "italic" }}>Edit request pending…</span>
                        }
                        <button onClick={nextWeek}
                          style={{ ...btnBase, background: "#fff", color: TIMESHEETS_FULL, border: `1px solid ${TIMESHEETS_FULL}`, padding: "6px 16px", fontSize: 12 }}>
                          Next week →
                        </button>
                      </>
                    )}
                    {submission?.status === "approved" && (
                      <>
                        <span style={{ fontSize: 13, color: "#2e7d32", fontWeight: 600 }}>✓ Approved</span>
                        {!submission?.unlock_requested
                          ? <button onClick={() => setShowUnlockDialog(true)}
                              style={{ background: "#fff", color: "#8a9aa8", border: "1px solid #dde4e8", padding: "5px 12px", fontSize: 11, cursor: "pointer" }}>
                              Request to Edit
                            </button>
                          : <span style={{ fontSize: 12, color: "#8a9aa8", fontStyle: "italic" }}>Edit request pending…</span>
                        }
                        <button onClick={nextWeek}
                          style={{ ...btnBase, background: "#fff", color: TIMESHEETS_FULL, border: `1px solid ${TIMESHEETS_FULL}`, padding: "6px 16px", fontSize: 12 }}>
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
          {activeTab === "expenses" && (
            <ExpensesTab projects={projects} recentIds={recentIds} />
          )}
          </>
        )}
      </div>
    </div>
  );
}
