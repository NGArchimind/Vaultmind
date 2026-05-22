import React, { useState, useEffect } from "react";
import { api } from "../api/client";
import { DESIGN_GROUND, DESIGN_TEXT, TIMESHEETS_FULL, COMPARE_FULL } from "../constants";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function getMonday(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoDate(d) { return d.toISOString().split("T")[0]; }

function dateForDay(mondayStr, di) {
  const d = new Date(mondayStr);
  d.setDate(d.getDate() + di);
  return isoDate(d);
}

function formatMins(m) {
  if (!m) return "—";
  const h = Math.floor(m / 60), mins = m % 60;
  if (mins === 0) return `${h}h`;
  if (h === 0) return `${mins}m`;
  return `${h}h ${mins}m`;
}

function entryMins(e) { return (e.hours || 0) * 60 + (e.minutes || 0); }

function formatWeek(mondayStr) {
  const mon = new Date(mondayStr);
  const fri = new Date(mon); fri.setDate(fri.getDate() + 4);
  const o = { day: "numeric", month: "short" };
  return `${mon.toLocaleDateString("en-GB", o)} – ${fri.toLocaleDateString("en-GB", { ...o, year: "numeric" })}`;
}

function StatusBadge({ status }) {
  const map = {
    draft:     { label: "Draft",     bg: "#f0f0f0", color: "#666" },
    submitted: { label: "Submitted", bg: "#fff8e1", color: "#b07800" },
    approved:  { label: "Approved",  bg: "#e8f5e9", color: "#2e7d32" },
  };
  const s = map[status] || map.draft;
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}44`, padding: "2px 8px", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
      {s.label}
    </span>
  );
}

export default function TimesheetHistory({ onBack }) {
  const [weeks,     setWeeks]     = useState([]); // [{ mondayStr, entries, status, total }]
  const [loading,   setLoading]   = useState(true);
  const [expanded,  setExpanded]  = useState(null);

  useEffect(() => {
    api("/api/timesheets/history").then(({ entries, submissions }) => {
      // Group entries by their Monday
      const byWeek = {};
      (entries || []).forEach(e => {
        const mon = isoDate(getMonday(e.entry_date));
        if (!byWeek[mon]) byWeek[mon] = [];
        byWeek[mon].push(e);
      });

      const subMap = {};
      (submissions || []).forEach(s => { subMap[s.week_start] = s.status; });

      const sorted = Object.keys(byWeek)
        .sort((a, b) => b.localeCompare(a))
        .map(mon => ({
          mondayStr: mon,
          entries:   byWeek[mon],
          status:    subMap[mon] || "draft",
          total:     byWeek[mon].reduce((s, e) => s + entryMins(e), 0),
        }));

      setWeeks(sorted);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const thStyle = { padding: "10px 14px", fontSize: 11, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: "0.07em", textAlign: "left", borderBottom: "2px solid #dde4e8", whiteSpace: "nowrap" };
  const tdStyle = { padding: "11px 14px", fontSize: 13, color: DESIGN_TEXT, borderBottom: "1px solid #eef2f4", verticalAlign: "middle" };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: DESIGN_GROUND }}>
      <div style={{ background: TIMESHEETS_FULL, padding:"12px 40px", display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
        <span style={{ fontSize:11, fontWeight:500, color:"#fff", letterSpacing:".16em", textTransform:"uppercase" }}>Timesheets</span>
        <span style={{ fontSize:9, fontWeight:500, color:"rgba(255,255,255,0.45)", letterSpacing:".14em", textTransform:"uppercase" }}>— History</span>
      </div>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #dde4e8", padding: "16px 32px", flexShrink: 0, display: "flex", alignItems: "center", gap: 20 }}>
        <button onClick={onBack}
          style={{ background: "none", border: "none", color: TIMESHEETS_FULL, fontSize: 13, cursor: "pointer", fontWeight: 600, padding: 0, display: "flex", alignItems: "center", gap: 6 }}>
          ← Back
        </button>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 300, color: DESIGN_TEXT, letterSpacing: "0.02em" }}>My Timesheet History</h2>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "28px 32px" }}>
        {loading && <p style={{ color: "#6a8a9a", fontSize: 13 }}>Loading…</p>}

        {!loading && weeks.length === 0 && (
          <p style={{ color: "#6a8a9a", fontSize: 13 }}>No timesheet history found.</p>
        )}

        {!loading && weeks.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid #dde4e8" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: DESIGN_GROUND }}>
                  <th style={thStyle}>Week</th>
                  {DAYS.map(d => <th key={d} style={{ ...thStyle, textAlign: "center" }}>{d.slice(0, 3)}</th>)}
                  <th style={{ ...thStyle, textAlign: "center" }}>Total</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Status</th>
                  <th style={{ ...thStyle, width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {weeks.map(({ mondayStr, entries, status, total }) => {
                  const isOpen = expanded === mondayStr;

                  // Daily totals
                  const dayTotals = DAYS.map((_, di) => {
                    const date = dateForDay(mondayStr, di);
                    const dayEntries = entries.filter(e => e.entry_date === date);
                    return dayEntries.reduce((s, e) => s + entryMins(e), 0);
                  });

                  return (
                    <React.Fragment key={mondayStr}>
                      <tr
                        onClick={() => setExpanded(isOpen ? null : mondayStr)}
                        style={{ cursor: "pointer", background: isOpen ? "#f0f7f9" : "#fff", transition: "background 0.1s" }}>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{formatWeek(mondayStr)}</td>
                        {dayTotals.map((m, di) => (
                          <td key={di} style={{ ...tdStyle, textAlign: "center", color: m ? DESIGN_TEXT : "#ccc" }}>
                            {formatMins(m)}
                          </td>
                        ))}
                        <td style={{ ...tdStyle, textAlign: "center", fontWeight: 700, color: total >= 37.5 * 60 ? TIMESHEETS_FULL : COMPARE_FULL }}>
                          {formatMins(total)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <StatusBadge status={status} />
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center", color: "#aaa", fontSize: 13 }}>
                          {isOpen ? "▲" : "▼"}
                        </td>
                      </tr>

                      {/* Expanded detail rows */}
                      {isOpen && DAYS.map((dayName, di) => {
                        const date = dateForDay(mondayStr, di);
                        const dayEntries = entries.filter(e => e.entry_date === date);
                        if (!dayEntries.length) return null;
                        return (
                          <tr key={`${mondayStr}-${di}`} style={{ background: "#f8fbfc" }}>
                            <td style={{ ...tdStyle, paddingLeft: 28, color: "#6a8a9a", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                              {dayName}
                            </td>
                            <td colSpan={7} style={{ ...tdStyle, padding: "6px 14px" }}>
                              {dayEntries.map((e, i) => {
                                const label = e.project_id
                                  ? (e.projects?.job_number ? `${e.projects.job_number} — ${e.projects.name}` : e.projects?.name || "Unknown project")
                                  : (e.category ? e.category.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "—");
                                return (
                                  <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "4px 0", borderTop: i > 0 ? "1px solid #eef2f4" : "none" }}>
                                    <span style={{ flex: 1, fontSize: 13, color: DESIGN_TEXT }}>{label}</span>
                                    <span style={{ fontSize: 13, color: TIMESHEETS_FULL, fontWeight: 600, minWidth: 56, textAlign: "right" }}>{formatMins(entryMins(e))}</span>
                                    {e.notes && <span style={{ fontSize: 12, color: "#8a9aa8", fontStyle: "italic" }}>{e.notes}</span>}
                                  </div>
                                );
                              })}
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>

              {/* Summary footer */}
              <tfoot>
                <tr style={{ background: DESIGN_GROUND }}>
                  <td style={{ ...tdStyle, fontWeight: 700, color: DESIGN_TEXT }}>All time total</td>
                  {DAYS.map((_, di) => {
                    const colTotal = weeks.reduce((sum, { mondayStr, entries }) => {
                      const date = dateForDay(mondayStr, di);
                      return sum + entries.filter(e => e.entry_date === date).reduce((s, e) => s + entryMins(e), 0);
                    }, 0);
                    return <td key={di} style={{ ...tdStyle, textAlign: "center", fontWeight: 600, color: "#6a8a9a" }}>{formatMins(colTotal)}</td>;
                  })}
                  <td style={{ ...tdStyle, textAlign: "center", fontWeight: 700, color: TIMESHEETS_FULL }}>
                    {formatMins(weeks.reduce((s, w) => s + w.total, 0))}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
