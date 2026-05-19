import React, { useState, useEffect, useCallback } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Legend,
} from "recharts";
import { api } from "../api/client";
import { ARC_NAVY, ARC_TERRACOTTA, ARC_STONE, AD_GREEN } from "../constants";

// ── Utilities ──────────────────────────────────────────────────────────────────

function isoDate(d) { return d.toISOString().split("T")[0]; }

function getMonday(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekShort(mondayStr) {
  const d = new Date(mondayStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function fmtGBP(n) {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
}

function entryHours(e) { return (e.hours || 0) + (e.minutes || 0) / 60; }

function pctColor(pct) {
  if (pct >= 90) return ARC_TERRACOTTA;
  if (pct >= 70) return "#c28a20";
  return AD_GREEN;
}

// ── Fee progress bar ───────────────────────────────────────────────────────────

function FeeBar({ pct }) {
  const color = pctColor(pct);
  return (
    <div style={{ height: 8, background: "#eef2f4", borderRadius: 4, overflow: "hidden", marginTop: 8 }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.4s" }} />
    </div>
  );
}

// ── Editable fee / rate field ──────────────────────────────────────────────────

function EditableAmount({ value, onSave, prefix = "£", placeholder = "Set amount" }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value != null ? String(value) : "");

  const commit = () => {
    setEditing(false);
    const n = parseFloat(draft.replace(/[^0-9.]/g, ""));
    if (!isNaN(n) && n !== value) onSave(n);
    else if (draft === "" && value != null) onSave(null);
  };

  if (editing) {
    return (
      <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value != null ? String(value) : ""); setEditing(false); } }}
        style={{ width: 120, padding: "3px 8px", fontSize: 13, border: `1px solid ${AD_GREEN}`, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY }} />
    );
  }
  return (
    <span onClick={() => setEditing(true)} title="Click to edit"
      style={{ cursor: "pointer", borderBottom: `1px dashed ${AD_GREEN}`, color: value != null ? ARC_NAVY : "#aaa", fontSize: 13 }}>
      {value != null ? `${prefix}${Number(value).toLocaleString("en-GB")}` : placeholder}
    </span>
  );
}

// ── Burn chart tooltip ─────────────────────────────────────────────────────────

function BurnTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #dde4e8", padding: "10px 14px", fontSize: 12, boxShadow: "0 2px 8px rgba(0,0,0,.1)" }}>
      <p style={{ margin: "0 0 6px", fontWeight: 700, color: ARC_NAVY }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ margin: "2px 0", color: p.color }}>
          {p.name}: <strong>{fmtGBP(p.value)}</strong>
        </p>
      ))}
    </div>
  );
}

// ── Project detail drill-down ──────────────────────────────────────────────────

function ProjectDrillDown({ project, entries, rates, userMap, onBack }) {
  const fee = project.fee || 0;

  // Build week-by-week spend
  const byWeek = {};
  entries.forEach(e => {
    const mon = isoDate(getMonday(e.entry_date));
    if (!byWeek[mon]) byWeek[mon] = 0;
    const rate = rates[e.user_id] || 0;
    byWeek[mon] += entryHours(e) * rate;
  });

  const weeks = Object.keys(byWeek).sort();
  let cumulative = 0;
  const chartData = weeks.map(mon => {
    const weekly = Math.round(byWeek[mon] * 100) / 100;
    cumulative += weekly;
    return { week: formatWeekShort(mon), weekly, cumulative: Math.round(cumulative * 100) / 100 };
  });

  const totalSpent = cumulative;
  const remaining  = fee - totalSpent;
  const pct        = fee > 0 ? (totalSpent / fee) * 100 : 0;

  // Per-person breakdown
  const byPerson = {};
  entries.forEach(e => {
    const email = userMap[e.user_id] || e.user_id?.slice(0, 8) + "…";
    if (!byPerson[email]) byPerson[email] = { hours: 0, cost: 0 };
    byPerson[email].hours += entryHours(e);
    byPerson[email].cost  += entryHours(e) * (rates[e.user_id] || 0);
  });

  // Projected weeks to fee exhaustion at current burn rate
  const avgWeeklyBurn = weeks.length > 0 ? totalSpent / weeks.length : 0;
  const weeksLeft     = avgWeeklyBurn > 0 ? Math.ceil(remaining / avgWeeklyBurn) : null;

  const thStyle = { padding: "9px 14px", fontSize: 11, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: "0.07em", textAlign: "left", borderBottom: "2px solid #dde4e8", background: ARC_STONE };
  const tdStyle = { padding: "10px 14px", fontSize: 13, color: ARC_NAVY, borderBottom: "1px solid #eef2f4" };

  return (
    <div>
      <button onClick={onBack}
        style={{ background: "none", border: "none", color: AD_GREEN, fontSize: 13, cursor: "pointer", fontWeight: 600, padding: "0 0 20px", display: "flex", alignItems: "center", gap: 6 }}>
        ← All projects
      </button>

      <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 400, color: ARC_NAVY }}>
        {project.job_number ? `${project.job_number} — ` : ""}{project.name}
      </h3>
      <p style={{ margin: "0 0 24px", fontSize: 13, color: "#6a8a9a" }}>Fee review</p>

      {/* Summary cards */}
      <div style={{ display: "flex", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
        {[
          { label: "Total fee",    value: fmtGBP(fee),         color: ARC_NAVY },
          { label: "Spent to date", value: fmtGBP(totalSpent), color: pctColor(pct) },
          { label: "Remaining",    value: fmtGBP(remaining),   color: remaining >= 0 ? AD_GREEN : ARC_TERRACOTTA },
          { label: "% consumed",   value: `${pct.toFixed(1)}%`, color: pctColor(pct) },
          ...(weeksLeft != null && remaining > 0 ? [{ label: "Est. weeks remaining", value: weeksLeft, color: "#6a8a9a" }] : []),
        ].map(c => (
          <div key={c.label} style={{ flex: "1 1 140px", background: "#fff", border: "1px solid #dde4e8", padding: "16px 20px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#8a9aa8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{c.label}</div>
            <div style={{ fontSize: 26, fontWeight: 300, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ background: "#fff", border: "1px solid #dde4e8", padding: "16px 20px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: "#6a8a9a" }}>Fee consumed</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: pctColor(pct) }}>{pct.toFixed(1)}%</span>
        </div>
        <div style={{ height: 12, background: "#eef2f4", borderRadius: 6, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: pctColor(pct), borderRadius: 6, transition: "width 0.5s" }} />
        </div>
        {pct > 100 && (
          <p style={{ margin: "8px 0 0", fontSize: 12, color: ARC_TERRACOTTA, fontWeight: 600 }}>
            ⚠ Fee overrun — {fmtGBP(Math.abs(remaining))} over budget
          </p>
        )}
      </div>

      {/* Burn chart */}
      {chartData.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #dde4e8", padding: "20px 20px 12px", marginBottom: 20 }}>
          <h4 style={{ margin: "0 0 16px", fontSize: 13, fontWeight: 700, color: ARC_NAVY, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Week-by-week burn
          </h4>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f4" />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#8a9aa8" }} />
              <YAxis tick={{ fontSize: 11, fill: "#8a9aa8" }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<BurnTooltip />} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="weekly" name="Weekly spend" fill={`${AD_GREEN}66`} radius={[2, 2, 0, 0]} />
              <Line dataKey="cumulative" name="Cumulative spend" stroke={AD_GREEN} strokeWidth={2} dot={{ r: 3, fill: AD_GREEN }} />
              {fee > 0 && (
                <ReferenceLine y={fee} stroke={ARC_TERRACOTTA} strokeDasharray="6 3"
                  label={{ value: "Total fee", position: "insideTopRight", fill: ARC_TERRACOTTA, fontSize: 11 }} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Per-person breakdown */}
      {Object.keys(byPerson).length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #dde4e8" }}>
          <h4 style={{ margin: 0, padding: "14px 20px", fontSize: 13, fontWeight: 700, color: ARC_NAVY, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #eef2f4" }}>
            Staff breakdown
          </h4>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Person</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Hours</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Rate</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Cost</th>
                <th style={{ ...thStyle, textAlign: "right" }}>% of spend</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byPerson).sort((a, b) => b[1].cost - a[1].cost).map(([email, { hours, cost }]) => (
                <tr key={email}>
                  <td style={tdStyle}>{email}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: "#6a8a9a" }}>{hours.toFixed(1)}h</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: "#6a8a9a" }}>
                    {fmtGBP(rates[Object.keys(byPerson).find(k => k === email)] || 0)}/h
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: AD_GREEN }}>{fmtGBP(cost)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: "#8a9aa8" }}>
                    {totalSpent > 0 ? `${((cost / totalSpent) * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: ARC_STONE }}>
                <td style={{ ...tdStyle, fontWeight: 700 }}>Total</td>
                <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>
                  {Object.values(byPerson).reduce((s, p) => s + p.hours, 0).toFixed(1)}h
                </td>
                <td style={tdStyle} />
                <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: AD_GREEN }}>{fmtGBP(totalSpent)}</td>
                <td style={{ ...tdStyle, textAlign: "right", color: "#8a9aa8" }}>100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {entries.length === 0 && (
        <p style={{ color: "#6a8a9a", fontSize: 13 }}>No timesheet entries recorded for this project yet.</p>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function FeeReview({ onBack }) {
  const [projects,    setProjects]    = useState([]);
  const [users,       setUsers]       = useState([]);
  const [rates,       setRates]       = useState({}); // user_id → rate
  const [allEntries,  setAllEntries]  = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [drillProject, setDrillProject] = useState(null); // project object
  const [setupOpen,   setSetupOpen]   = useState(false);
  const [toast,       setToast]       = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const userMap = Object.fromEntries(users.map(u => [u.id, u.email]));

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api("/api/projects"),
      api("/api/admin/users"),
      api("/api/admin/staff-rates"),
      api("/api/admin/timesheets"),          // all entries, no date filter
    ]).then(([projRes, usersRes, ratesRes, entriesRes]) => {
      setProjects(projRes?.projects || []);
      setUsers(usersRes?.users || []);
      const rateMap = {};
      (ratesRes || []).forEach(r => { rateMap[r.user_id] = parseFloat(r.rate); });
      setRates(rateMap);
      setAllEntries(entriesRes || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSaveFee = useCallback(async (project, fee) => {
    const updated = await api(`/api/admin/projects/${project.id}/fee`, { method: "PATCH", body: { fee } });
    setProjects(prev => prev.map(p => p.id === project.id ? { ...p, fee: updated.fee } : p));
    showToast("Fee saved.");
  }, []);

  const handleSaveRate = useCallback(async (userId, rate) => {
    await api("/api/admin/staff-rates", { method: "POST", body: { user_id: userId, rate } });
    setRates(prev => ({ ...prev, [userId]: rate }));
    showToast("Rate saved.");
  }, []);

  // If drilled into a project, show detail view
  if (drillProject) {
    const projectEntries = allEntries.filter(e => e.project_id === drillProject.id);
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7f8" }}>
        <div style={{ background: "#fff", borderBottom: "1px solid #dde4e8", padding: "16px 32px", flexShrink: 0, display: "flex", alignItems: "center", gap: 20 }}>
          <button onClick={onBack} style={{ background: "none", border: "none", color: AD_GREEN, fontSize: 13, cursor: "pointer", fontWeight: 600, padding: 0 }}>← Back</button>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 300, color: ARC_NAVY }}>Fee Review</h2>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "28px 32px" }}>
          <ProjectDrillDown
            project={drillProject}
            entries={projectEntries}
            rates={rates}
            userMap={userMap}
            onBack={() => setDrillProject(null)}
          />
        </div>
      </div>
    );
  }

  // Projects that have a fee set, with spend calculated
  const projectsWithFee = projects
    .filter(p => p.fee != null && p.fee > 0)
    .map(p => {
      const pEntries = allEntries.filter(e => e.project_id === p.id);
      const spent = pEntries.reduce((s, e) => s + entryHours(e) * (rates[e.user_id] || 0), 0);
      const pct   = (spent / p.fee) * 100;
      return { ...p, spent, pct };
    })
    .sort((a, b) => b.pct - a.pct);

  const projectsNoFee = projects.filter(p => !p.fee);

  const selStyle = { padding: "6px 10px", fontSize: 13, border: "1px solid #d0d8de", fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, background: "#fff" };
  const thStyle  = { padding: "9px 14px", fontSize: 11, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: "0.07em", textAlign: "left", borderBottom: "1px solid #dde4e8", background: ARC_STONE };
  const tdStyle  = { padding: "11px 14px", fontSize: 13, color: ARC_NAVY, borderBottom: "1px solid #eef2f4", verticalAlign: "middle" };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7f8" }}>
      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, background: ARC_NAVY, color: "#fff", padding: "10px 20px", fontSize: 13, zIndex: 9999 }}>{toast}</div>}

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #dde4e8", padding: "16px 32px", flexShrink: 0, display: "flex", alignItems: "center", gap: 20 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: AD_GREEN, fontSize: 13, cursor: "pointer", fontWeight: 600, padding: 0 }}>← Back</button>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 300, color: ARC_NAVY }}>Fee Review</h2>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}>
        {loading && <p style={{ color: "#6a8a9a", fontSize: 13 }}>Loading…</p>}

        {!loading && (
          <>
            {/* Setup panel */}
            <div style={{ background: "#fff", border: "1px solid #dde4e8", marginBottom: 24 }}>
              <button onClick={() => setSetupOpen(o => !o)}
                style={{ width: "100%", background: "none", border: "none", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", textAlign: "left" }}>
                <span style={{ fontSize: 14 }}>{setupOpen ? "▲" : "▼"}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: ARC_NAVY }}>Setup — project fees & staff rates</span>
                <span style={{ fontSize: 12, color: "#8a9aa8", marginLeft: 8 }}>Click to expand</span>
              </button>

              {setupOpen && (
                <div style={{ borderTop: "1px solid #eef2f4", padding: "20px 20px 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>

                  {/* Project fees */}
                  <div>
                    <h4 style={{ margin: "0 0 12px", fontSize: 12, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: "0.07em" }}>Project fees</h4>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Project</th>
                          <th style={{ ...thStyle, textAlign: "right" }}>Total fee</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projects.map(p => (
                          <tr key={p.id}>
                            <td style={tdStyle}>{p.job_number ? `${p.job_number} — ${p.name}` : p.name}</td>
                            <td style={{ ...tdStyle, textAlign: "right" }}>
                              <EditableAmount
                                value={p.fee}
                                onSave={(fee) => handleSaveFee(p, fee)}
                                placeholder="Set fee"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Staff rates */}
                  <div>
                    <h4 style={{ margin: "0 0 12px", fontSize: 12, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: "0.07em" }}>Staff hourly rates</h4>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Staff member</th>
                          <th style={{ ...thStyle, textAlign: "right" }}>Rate (£/hr)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map(u => (
                          <tr key={u.id}>
                            <td style={tdStyle}>{u.email}</td>
                            <td style={{ ...tdStyle, textAlign: "right" }}>
                              <EditableAmount
                                value={rates[u.id] != null ? rates[u.id] : null}
                                onSave={(rate) => handleSaveRate(u.id, rate)}
                                placeholder="Set rate"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p style={{ margin: "10px 0 0", fontSize: 11, color: "#aaa", fontStyle: "italic" }}>Click any value to edit. Press Enter or click away to save.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Project cards */}
            {projectsWithFee.length === 0 && (
              <div style={{ background: "#fff", border: "1px solid #dde4e8", padding: "32px", textAlign: "center" }}>
                <p style={{ color: "#8a9aa8", fontSize: 14, margin: 0 }}>No project fees set yet.</p>
                <p style={{ color: "#aaa", fontSize: 13, margin: "8px 0 0" }}>Open the Setup panel above to assign fees to projects.</p>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16, marginBottom: 24 }}>
              {projectsWithFee.map(p => (
                <div key={p.id}
                  onClick={() => setDrillProject(p)}
                  style={{ background: "#fff", border: "1px solid #dde4e8", padding: "20px 22px", cursor: "pointer", transition: "box-shadow 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.08)"}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      {p.job_number && <div style={{ fontSize: 11, color: "#8a9aa8", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>{p.job_number}</div>}
                      <div style={{ fontSize: 15, fontWeight: 600, color: ARC_NAVY }}>{p.name}</div>
                    </div>
                    <span style={{ fontSize: 11, color: AD_GREEN, fontWeight: 700, border: `1px solid ${AD_GREEN}33`, background: `${AD_GREEN}0d`, padding: "2px 8px" }}>View detail →</span>
                  </div>

                  <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: "#8a9aa8", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>Total fee</div>
                      <div style={{ fontSize: 18, fontWeight: 300, color: ARC_NAVY }}>{fmtGBP(p.fee)}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: "#8a9aa8", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>Spent</div>
                      <div style={{ fontSize: 18, fontWeight: 300, color: pctColor(p.pct) }}>{fmtGBP(p.spent)}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: "#8a9aa8", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>Remaining</div>
                      <div style={{ fontSize: 18, fontWeight: 300, color: p.fee - p.spent >= 0 ? AD_GREEN : ARC_TERRACOTTA }}>
                        {fmtGBP(p.fee - p.spent)}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: "#8a9aa8" }}>Fee consumed</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: pctColor(p.pct) }}>{Math.min(p.pct, 999).toFixed(1)}%</span>
                  </div>
                  <FeeBar pct={p.pct} />
                </div>
              ))}
            </div>

            {/* Projects without fees */}
            {projectsNoFee.length > 0 && (
              <div style={{ background: "#fff", border: "1px solid #eef2f4", padding: "14px 20px" }}>
                <p style={{ margin: 0, fontSize: 12, color: "#aaa" }}>
                  {projectsNoFee.length} project{projectsNoFee.length !== 1 ? "s" : ""} without a fee set:{" "}
                  {projectsNoFee.map(p => p.job_number || p.name).join(", ")}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
