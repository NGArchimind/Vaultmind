// Shared, read-only timesheet drill-downs used by both Reports & Analytics
// (TimesheetReport.jsx) and Fee Review (FeeReview.jsx).
//
// Everything here works off entries already loaded by the host page (the
// /api/admin/timesheets data) — there are NO new server calls. A small
// breadcrumb stack (useDrillStack) lets you keep drilling and step back up;
// DrillView renders the right summary for the current frame.
//
// Frame kinds:
//   person        { userId }                 — one person, across everything in scope
//   project       { projectId }              — one project, who worked on it
//   personProject { userId, projectId }      — one person's work on one project
//   personWeek    { userId, weekStart }      — one person, one week, day by day
import React, { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { DESIGN_GROUND, DESIGN_TEXT, TIMESHEETS_FULL, COMPARE_FULL } from "../constants";

// ── Pure helpers ────────────────────────────────────────────────────────────────
const mins   = (e) => (e.hours || 0) * 60 + (e.minutes || 0);
const otMins = (e) => (e.overtime_hours || 0) * 60 + (e.overtime_minutes || 0);
const toH    = (m) => Math.round((m / 60) * 100) / 100;

function fmtMins(m) {
  if (!m) return "—";
  const h = Math.floor(m / 60), mm = m % 60;
  if (mm === 0) return `${h}h`;
  if (h === 0) return `${mm}m`;
  return `${h}h ${mm}m`;
}

// Local-safe Monday (never via toISOString — UTC would shift the day in BST).
function isoMonday(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, "0"), da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}
function weekLabel(monStr) {
  const mon = new Date(monStr + "T12:00:00"), fri = new Date(mon); fri.setDate(fri.getDate() + 4);
  const o = { day: "numeric", month: "short" };
  return `${mon.toLocaleDateString("en-GB", o)} – ${fri.toLocaleDateString("en-GB", { ...o, year: "numeric" })}`;
}
function dayLabel(dateStr) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
function projectLabel(e) {
  if (e.project_id) return e.projects?.job_number ? `${e.projects.job_number} — ${e.projects.name}` : (e.projects?.name || "Project");
  return e.category ? e.category.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "Other";
}

// ── Drill stack (breadcrumb navigation) ─────────────────────────────────────────
export function useDrillStack() {
  const [stack, setStack] = useState([]);            // [{ kind, userId?, projectId?, weekStart?, title }]
  const push  = (frame) => setStack(s => [...s, frame]);
  const popTo = (i) => setStack(s => i < 0 ? [] : s.slice(0, i + 1)); // i = -1 → back to host root
  const reset = () => setStack([]);
  return { stack, push, popTo, reset };
}

export function DrillBreadcrumb({ rootLabel, stack, onNavigate }) {
  const crumb = { color: TIMESHEETS_FULL, textDecoration: "underline", cursor: "pointer" };
  return (
    <div style={{ background: "#fff", borderBottom: "1px solid #dde4e8", padding: "11px 18px", fontSize: 13 }}>
      <span style={crumb} onClick={() => onNavigate(-1)}>← {rootLabel}</span>
      {stack.map((f, i) => (
        <React.Fragment key={i}>
          <span style={{ color: "#8a9aa8" }}> › </span>
          {i === stack.length - 1
            ? <span style={{ color: DESIGN_TEXT, fontWeight: 600 }}>{f.title}</span>
            : <span style={crumb} onClick={() => onNavigate(i)}>{f.title}</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Building blocks ──────────────────────────────────────────────────────────────
const card = { flex: 1, minWidth: 120, background: "#fff", border: "1px solid #dde4e8", padding: "14px 18px" };
const cardLbl = { fontSize: 10, letterSpacing: ".08em", color: "#8a9aa8", textTransform: "uppercase", marginBottom: 6 };
const cardVal = { fontSize: 24, fontWeight: 300 };
const thStyle = { padding: "9px 14px", fontSize: 11, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", borderBottom: "1px solid #dde4e8", background: DESIGN_GROUND };
const tdStyle = { padding: "9px 14px", fontSize: 13, color: DESIGN_TEXT, borderBottom: "1px solid #eef2f4" };

function SummaryCards({ entries, rates }) {
  const total = entries.reduce((s, e) => s + mins(e), 0);
  const ot    = entries.reduce((s, e) => s + otMins(e), 0);
  const bill  = entries.reduce((s, e) => s + (e.project_id ? mins(e) : 0), 0);
  const billPct = total ? Math.round((bill / total) * 100) : 0;
  const weeks = new Set(entries.map(e => isoMonday(e.entry_date))).size;
  const cost  = rates ? entries.reduce((s, e) => s + toH(mins(e)) * (rates[e.user_id] || 0), 0) : null;
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
      <div style={card}><div style={cardLbl}>Total hours</div><div style={{ ...cardVal, color: TIMESHEETS_FULL }}>{fmtMins(total)}</div></div>
      <div style={card}><div style={cardLbl}>Overtime</div><div style={{ ...cardVal, color: "#8a6a3a" }}>{fmtMins(ot)}</div></div>
      <div style={card}><div style={cardLbl}>Billable</div><div style={{ ...cardVal, color: DESIGN_TEXT }}>{billPct}%</div><div style={{ fontSize: 11, color: "#8a9aa8", marginTop: 4 }}>{fmtMins(bill)} of {fmtMins(total)}</div></div>
      <div style={card}><div style={cardLbl}>Weeks active</div><div style={{ ...cardVal, color: DESIGN_TEXT }}>{weeks}</div></div>
      {cost != null && <div style={card}><div style={cardLbl}>Cost</div><div style={{ ...cardVal, color: DESIGN_TEXT }}>{`£${Math.round(cost).toLocaleString("en-GB")}`}</div></div>}
    </div>
  );
}

function MiniWeekChart({ entries }) {
  const byWeek = {};
  entries.forEach(e => { const m = isoMonday(e.entry_date); byWeek[m] = (byWeek[m] || 0) + mins(e); });
  const data = Object.keys(byWeek).sort().map(m => ({ label: weekLabel(m).split(" – ")[0], hours: toH(byWeek[m]) }));
  if (data.length < 2) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #dde4e8", padding: "16px 16px 8px", marginBottom: 18 }}>
      <h4 style={{ margin: "0 0 12px", fontSize: 12, fontWeight: 700, color: DESIGN_TEXT, textTransform: "uppercase", letterSpacing: "0.06em" }}>Hours by week</h4>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 0, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f4" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8a9aa8" }} />
          <YAxis tick={{ fontSize: 11, fill: "#8a9aa8" }} unit="h" />
          <Tooltip formatter={(v) => [`${v}h`, "Hours"]} />
          <Bar dataKey="hours" fill={TIMESHEETS_FULL} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// A grouped, optionally-clickable totals table (by project, or by person).
function GroupTable({ title, rows, onRowClick }) {
  if (!rows.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #dde4e8", marginBottom: 18 }}>
      <h4 style={{ margin: 0, padding: "12px 16px", fontSize: 12, fontWeight: 700, color: DESIGN_TEXT, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #eef2f4" }}>{title}</h4>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th style={thStyle}>{title.includes("person") || title.includes("Staff") ? "Person" : "Project"}</th>
          <th style={{ ...thStyle, textAlign: "right" }}>Overtime</th>
          <th style={{ ...thStyle, textAlign: "right" }}>Hours</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const clickable = onRowClick && r.clickKey;
            return (
              <tr key={i}
                onClick={clickable ? () => onRowClick(r) : undefined}
                style={{ cursor: clickable ? "pointer" : "default" }}
                onMouseEnter={clickable ? (e) => e.currentTarget.style.background = "#f7f9fa" : undefined}
                onMouseLeave={clickable ? (e) => e.currentTarget.style.background = "transparent" : undefined}>
                <td style={{ ...tdStyle, color: clickable ? TIMESHEETS_FULL : DESIGN_TEXT, fontWeight: clickable ? 600 : 400 }}>
                  {r.label}{clickable && <span style={{ color: "#8a9aa8", fontWeight: 400 }}> ›</span>}
                </td>
                <td style={{ ...tdStyle, textAlign: "right", color: r.otMins ? "#8a6a3a" : "#c0ccd4" }}>{r.otMins ? fmtMins(r.otMins) : "—"}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: TIMESHEETS_FULL }}>{fmtMins(r.mins)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Weeks → day-by-day entries (used by personProject, personWeek, and person views).
function WeekDayTable({ entries }) {
  const byWeek = {};
  entries.forEach(e => { const m = isoMonday(e.entry_date); (byWeek[m] = byWeek[m] || []).push(e); });
  const weeks = Object.keys(byWeek).sort((a, b) => b.localeCompare(a)); // newest first
  if (!weeks.length) return <p style={{ color: "#6a8a9a", fontSize: 13 }}>No entries.</p>;
  return (
    <div style={{ background: "#fff", border: "1px solid #dde4e8" }}>
      {weeks.map(m => {
        const dayEntries = byWeek[m].slice().sort((a, b) => a.entry_date.localeCompare(b.entry_date));
        const wTotal = dayEntries.reduce((s, e) => s + mins(e), 0);
        return (
          <div key={m}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 16px", background: DESIGN_GROUND, borderTop: "1px solid #dde4e8", borderBottom: "1px solid #dde4e8", fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: DESIGN_TEXT }}>Week of {weekLabel(m).split(" – ")[0]}</span>
              <span style={{ color: TIMESHEETS_FULL, fontWeight: 600 }}>{fmtMins(wTotal)}</span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {dayEntries.map(e => (
                  <tr key={e.id}>
                    <td style={{ ...tdStyle, width: 150, color: "#6a8a9a" }}>{dayLabel(e.entry_date)}</td>
                    <td style={{ ...tdStyle, width: 130 }}>{projectLabel(e)}</td>
                    <td style={{ ...tdStyle, width: 120 }}>
                      {fmtMins(mins(e))}
                      {otMins(e) > 0 && <span style={{ color: "#8a6a3a", fontSize: 11 }}> +{fmtMins(otMins(e))} OT</span>}
                    </td>
                    <td style={{ ...tdStyle, color: "#8a9aa8" }}>
                      {e.notes || "—"}
                      {e.unpriced_extra && (
                        <span style={{ background: "#fdebe7", color: COMPARE_FULL, fontSize: 10, padding: "1px 6px", marginLeft: 6, whiteSpace: "nowrap" }}>
                          UNPRICED EXTRA{e.project_extra_types?.label ? ` · ${e.project_extra_types.label}` : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// ── DrillView — renders the current frame ────────────────────────────────────────
// Props: frame, entries (full host dataset), users, projects, rates (optional),
//        onPush(frame), filterChip (string|null), onClearDates (fn|null)
export function DrillView({ frame, entries, users, projects, rates, onPush, filterChip, onClearDates }) {
  const userMap = Object.fromEntries((users || []).map(u => [u.id, u.email]));
  const personName = (uid) => userMap[uid] || (uid ? uid.slice(0, 8) + "…" : "—");
  const projName = (pid) => {
    const p = (projects || []).find(p => String(p.id) === String(pid));
    return p ? (p.job_number ? `${p.job_number} — ${p.name}` : p.name) : "Project";
  };

  // Scope the entries to this frame.
  let scoped = entries, title = "", subtitle = null, nameLink = null;
  if (frame.kind === "person") {
    scoped = entries.filter(e => e.user_id === frame.userId);
    title = personName(frame.userId);
  } else if (frame.kind === "project") {
    scoped = entries.filter(e => String(e.project_id) === String(frame.projectId));
    title = projName(frame.projectId);
  } else if (frame.kind === "personProject") {
    scoped = entries.filter(e => e.user_id === frame.userId && String(e.project_id) === String(frame.projectId));
    title = personName(frame.userId);
    subtitle = `— on ${projName(frame.projectId)}`;
    nameLink = { kind: "person", userId: frame.userId, title: personName(frame.userId) };
  } else if (frame.kind === "personWeek") {
    scoped = entries.filter(e => e.user_id === frame.userId && isoMonday(e.entry_date) === frame.weekStart);
    title = personName(frame.userId);
    subtitle = `— week of ${weekLabel(frame.weekStart)}`;
    nameLink = { kind: "person", userId: frame.userId, title: personName(frame.userId) };
  }

  // Group helpers for the body tables.
  const byProjectRows = () => {
    const g = {};
    scoped.forEach(e => {
      const key = e.project_id ? `p:${e.project_id}` : `c:${e.category || "other"}`;
      if (!g[key]) g[key] = { label: projectLabel(e), mins: 0, otMins: 0, clickKey: e.project_id ? { projectId: e.project_id } : null };
      g[key].mins += mins(e); g[key].otMins += otMins(e);
    });
    return Object.values(g).sort((a, b) => b.mins - a.mins);
  };
  const byPersonRows = () => {
    const g = {};
    scoped.forEach(e => {
      if (!g[e.user_id]) g[e.user_id] = { label: personName(e.user_id), mins: 0, otMins: 0, clickKey: { userId: e.user_id } };
      g[e.user_id].mins += mins(e); g[e.user_id].otMins += otMins(e);
    });
    return Object.values(g).sort((a, b) => b.mins - a.mins);
  };

  return (
    <div>
      <h3 style={{ margin: "0 0 2px", fontSize: 18, fontWeight: 400, color: DESIGN_TEXT }}>
        {nameLink
          ? <span style={{ color: TIMESHEETS_FULL, textDecoration: "underline", cursor: "pointer" }}
                  onClick={() => onPush(nameLink)}>{title}</span>
          : title}
        {subtitle && <span style={{ fontSize: 13, color: "#6a8a9a" }}> {subtitle}</span>}
      </h3>
      {filterChip && (
        <div style={{ fontSize: 12, color: "#8a9aa8", marginBottom: 16 }}>
          Within current filter: {filterChip}
          {onClearDates && <button onClick={onClearDates} style={{ marginLeft: 10, background: "none", border: "none", color: TIMESHEETS_FULL, fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: 0 }}>view all dates</button>}
        </div>
      )}
      {!filterChip && <div style={{ marginBottom: 16 }} />}

      {scoped.length === 0 ? (
        <p style={{ color: "#6a8a9a", fontSize: 13 }}>No entries for this selection.</p>
      ) : (
        <>
          <SummaryCards entries={scoped} rates={rates} />
          <MiniWeekChart entries={scoped} />
          {frame.kind === "person" && (
            <GroupTable title="By project" rows={byProjectRows()}
              onRowClick={(r) => onPush({ kind: "personProject", userId: frame.userId, projectId: r.clickKey.projectId, title: `${personName(frame.userId)} · ${projName(r.clickKey.projectId)}` })} />
          )}
          {frame.kind === "project" && (
            <GroupTable title="By person" rows={byPersonRows()}
              onRowClick={(r) => onPush({ kind: "personProject", userId: r.clickKey.userId, projectId: frame.projectId, title: `${personName(r.clickKey.userId)} · ${projName(frame.projectId)}` })} />
          )}
          <WeekDayTable entries={scoped} />
        </>
      )}
    </div>
  );
}
