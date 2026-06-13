import React, { useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { api } from "../api/client";
import { datePreset, toCsv, downloadCsv, filterSummary } from "../utils/reportExport";
import { DESIGN_GROUND, DESIGN_TEXT, TIMESHEETS_FULL, COMPARE_FULL } from "../constants";

const CHART_COLORS = [
  TIMESHEETS_FULL, "#2a6496", COMPARE_FULL, "#7a6aaa", "#c28a20",
  "#4a7c20", "#505a5f", "#0d8a78", "#6a4a20", "#3a5aaa",
];

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

const CATEGORY_LABELS = {
  holiday: "Holiday", sickness: "Sickness", bank_holiday: "Bank Holiday",
  training: "Training / CPD", internal: "Internal / Non-billable",
};

function getMonday(dateStr) {
  const d = new Date(dateStr);
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
function entryMins(e) { return (e.hours || 0) * 60 + (e.minutes || 0); }
function entryOtMins(e) { return (e.overtime_hours || 0) * 60 + (e.overtime_minutes || 0); }
function minsToHours(m) { return Math.round((m / 60) * 100) / 100; }

function formatMins(m) {
  if (!m) return "—";
  const h = Math.floor(m / 60), mins = m % 60;
  if (mins === 0) return `${h}h`;
  if (h === 0) return `${mins}m`;
  return `${h}h ${mins}m`;
}

function formatWeekShort(mondayStr) {
  const d = new Date(mondayStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatWeekFull(mondayStr) {
  const mon = new Date(mondayStr); const fri = new Date(mon);
  fri.setDate(fri.getDate() + 4);
  const o = { day: "numeric", month: "short" };
  return `${mon.toLocaleDateString("en-GB", o)} – ${fri.toLocaleDateString("en-GB", { ...o, year: "numeric" })}`;
}

function SummaryCard({ label, value, sub, color }) {
  return (
    <div style={{ flex: 1, minWidth: 160, background: "#fff", border: "1px solid #dde4e8", padding: "18px 22px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#8a9aa8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 300, color: color || DESIGN_TEXT, letterSpacing: "0.01em" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#8a9aa8", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #dde4e8", padding: "10px 14px", fontSize: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
      <p style={{ margin: "0 0 6px", fontWeight: 700, color: DESIGN_TEXT }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ margin: "2px 0", color: p.color }}>
          {p.name}: <strong>{p.value}h</strong>
        </p>
      ))}
    </div>
  );
};

export default function TimesheetReport({ onBack }) {
  const [users,     setUsers]     = useState([]);
  const [projects,  setProjects]  = useState([]);
  const [entries,   setEntries]   = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [filterUser,    setFilterUser]    = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [filterFrom,    setFilterFrom]    = useState(() => datePreset("quarter").from);
  const [filterTo,      setFilterTo]      = useState(() => datePreset("quarter").to);
  const [filterCategory, setFilterCategory] = useState(""); // "" = all, or a category value
  const [filterBillable, setFilterBillable] = useState(""); // "", "billable", "nonbillable"
  const [groupBy,        setGroupBy]        = useState("week"); // week | project | person | category

  // Load users and projects on mount
  useEffect(() => {
    Promise.all([
      api("/api/admin/users"),
      api("/api/projects"),
    ]).then(([usersRes, projRes]) => {
      setUsers(usersRes?.users || []);
      setProjects(projRes?.projects || []);
    }).catch(() => {});
  }, []);

  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterUser)    params.set("user_id",    filterUser);
    if (filterProject) params.set("project_id", filterProject);
    if (filterFrom)    params.set("from",        filterFrom);
    if (filterTo)      params.set("to",          filterTo);
    api(`/api/admin/timesheets?${params}`)
      .then(data => setEntries(data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterUser, filterProject, filterFrom, filterTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Client-side filters (category + billable) ──────────────────────────────
  const fEntries = entries.filter(e => {
    if (filterBillable === "billable"    && !e.project_id) return false;
    if (filterBillable === "nonbillable" &&  e.project_id) return false;
    if (filterCategory && e.category !== filterCategory)   return false;
    return true;
  });

  // ── Aggregations ──────────────────────────────────────────────────────────

  const totalMins = fEntries.reduce((s, e) => s + entryMins(e), 0);
  const totalOt   = fEntries.reduce((s, e) => s + entryOtMins(e), 0);

  // Billable share (utilisation) — project entries count as billable.
  const billableMins   = fEntries.reduce((s, e) => s + (e.project_id ? entryMins(e) : 0), 0);
  const utilisationPct = totalMins > 0 ? Math.round((billableMins / totalMins) * 100) : 0;

  // Hours by week (for the "Weeks covered" card)
  const byWeek = {};
  fEntries.forEach(e => {
    const mon = isoDate(getMonday(e.entry_date));
    if (!byWeek[mon]) byWeek[mon] = 0;
    byWeek[mon] += entryMins(e);
  });

  // Hours by project (for bar + pie)
  const byProject = {};
  fEntries.forEach(e => {
    const key = e.project_id
      ? (e.projects?.job_number ? `${e.projects.job_number} — ${e.projects.name}` : e.projects?.name || "Unknown")
      : (e.category ? e.category.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "Other");
    if (!byProject[key]) byProject[key] = 0;
    byProject[key] += entryMins(e);
  });
  const projectChartData = Object.entries(byProject)
    .sort((a, b) => b[1] - a[1])
    .map(([name, mins]) => ({ name, hours: minsToHours(mins) }));

  // Hours by person (for bar chart)
  const byPerson = {};
  fEntries.forEach(e => {
    const email = users.find(u => u.id === e.user_id)?.email || e.user_id?.slice(0, 8) + "…";
    const key = email.split("@")[0]; // Use name part of email for chart label
    if (!byPerson[key]) byPerson[key] = { fullEmail: email, mins: 0 };
    byPerson[key].mins += entryMins(e);
  });
  const personChartData = Object.entries(byPerson)
    .sort((a, b) => b[1].mins - a[1].mins)
    .map(([name, { mins, fullEmail }]) => ({ name, hours: minsToHours(mins), fullEmail }));

  // ── Group-by dataset (drives the primary chart) ────────────────────────────
  const groupKey = (e) => {
    if (groupBy === "project")  return e.project_id
      ? (e.projects?.job_number ? `${e.projects.job_number} — ${e.projects.name}` : e.projects?.name || "Unknown")
      : (e.category ? (CATEGORY_LABELS[e.category] || e.category) : "Other");
    if (groupBy === "person")   return users.find(u => u.id === e.user_id)?.email || (e.user_id?.slice(0, 8) + "…");
    if (groupBy === "category") return e.project_id ? "Project work" : (CATEGORY_LABELS[e.category] || e.category || "Other");
    return isoDate(getMonday(e.entry_date)); // default: week
  };

  const grouped = {};
  fEntries.forEach(e => {
    const k = groupKey(e);
    if (!grouped[k]) grouped[k] = 0;
    grouped[k] += entryMins(e);
  });
  const groupedData = Object.entries(grouped)
    .map(([k, mins]) => ({ key: k, label: groupBy === "week" ? formatWeekShort(k) : k, hours: minsToHours(mins) }))
    .sort((a, b) => groupBy === "week" ? a.key.localeCompare(b.key) : b.hours - a.hours);

  // Unique staff and projects in the filtered data
  const activeStaff    = new Set(fEntries.map(e => e.user_id)).size;
  const activeProjects = new Set(fEntries.filter(e => e.project_id).map(e => e.project_id)).size;

  // ── Detailed table: rows per week per person ──────────────────────────────
  const tableRows = [];
  const weekPersonMap = {};
  fEntries.forEach(e => {
    const mon   = isoDate(getMonday(e.entry_date));
    const email = users.find(u => u.id === e.user_id)?.email || e.user_id?.slice(0, 8) + "…";
    const key   = `${mon}|${e.user_id}`;
    if (!weekPersonMap[key]) weekPersonMap[key] = { mon, email, mins: 0, otMins: 0, projects: new Set() };
    weekPersonMap[key].mins += entryMins(e);
    weekPersonMap[key].otMins += entryOtMins(e);
    if (e.project_id && e.projects?.name) weekPersonMap[key].projects.add(e.projects.name);
  });
  Object.values(weekPersonMap)
    .sort((a, b) => b.mon.localeCompare(a.mon) || a.email.localeCompare(b.email))
    .forEach(r => tableRows.push(r));

  // ── Filter summary + export handlers ───────────────────────────────────────
  const summaryText = filterSummary([
    filterUser ? (users.find(u => u.id === filterUser)?.email) : "All staff",
    filterProject ? (projects.find(p => String(p.id) === String(filterProject))?.name) : "All projects",
    filterCategory ? CATEGORY_LABELS[filterCategory] : null,
    filterBillable === "billable" ? "Billable only" : filterBillable === "nonbillable" ? "Non-billable only" : null,
    (filterFrom && filterTo) ? `${filterFrom} → ${filterTo}` : null,
  ]);

  const handlePrint = () => window.print();

  const handleCsv = () => {
    const rows = fEntries.map(e => ({
      Date: e.entry_date,
      Person: users.find(u => u.id === e.user_id)?.email || e.user_id,
      "Project / Category": e.project_id
        ? (e.projects?.job_number ? `${e.projects.job_number} — ${e.projects.name}` : e.projects?.name || "")
        : (e.category ? (CATEGORY_LABELS[e.category] || e.category) : ""),
      Hours: minsToHours(entryMins(e)),
      Overtime: minsToHours(entryOtMins(e)),
      Notes: e.notes || "",
    }));
    downloadCsv(`timesheet-report-${isoDate(new Date())}.csv`, toCsv(rows));
  };

  // ── Styles ────────────────────────────────────────────────────────────────
  const selStyle = { padding: "6px 10px", fontSize: 12, border: "1px solid #d0d8de", background: "#fff", color: DESIGN_TEXT, fontFamily: "Inter, Arial, sans-serif" };
  const thStyle  = { padding: "10px 14px", fontSize: 11, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: "0.07em", textAlign: "left", borderBottom: "2px solid #dde4e8", background: DESIGN_GROUND };
  const tdStyle  = { padding: "10px 14px", fontSize: 13, color: DESIGN_TEXT, borderBottom: "1px solid #eef2f4" };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: DESIGN_GROUND }}>
      <div className="no-print" style={{ background: TIMESHEETS_FULL, padding:"12px 40px", display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
        <span style={{ fontSize:11, fontWeight:500, color:"#fff", letterSpacing:".16em", textTransform:"uppercase" }}>Timesheets</span>
        <span style={{ fontSize:9, fontWeight:500, color:"rgba(255,255,255,0.45)", letterSpacing:".14em", textTransform:"uppercase" }}>— Report</span>
      </div>
      {/* Header */}
      <div className="no-print" style={{ background: "#fff", borderBottom: "1px solid #dde4e8", padding: "16px 32px", flexShrink: 0, display: "flex", alignItems: "center", gap: 20 }}>
        <button onClick={onBack}
          style={{ background: "none", border: "none", color: TIMESHEETS_FULL, fontSize: 13, cursor: "pointer", fontWeight: 600, padding: 0 }}>
          ← Back
        </button>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 300, color: DESIGN_TEXT }}>Reports &amp; Analytics</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={handleCsv} style={{ ...selStyle, cursor: "pointer", background: "#fff" }}>Download CSV</button>
          <button onClick={handlePrint} style={{ ...selStyle, cursor: "pointer", background: DESIGN_TEXT, color: "#fff", border: "none" }}>Export PDF</button>
        </div>
      </div>

      <div className="print-area" style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}>

        {/* Print-only report header (hidden on screen) */}
        <div style={{ display: "none" }} className="print-only-header">
          <h1 style={{ fontSize: 20, margin: "0 0 4px", color: DESIGN_TEXT }}>Archimind — Timesheet Report</h1>
          <p style={{ fontSize: 12, color: "#6a8a9a", margin: "0 0 16px" }}>{summaryText} · Generated {isoDate(new Date())}</p>
        </div>

        {/* Filters */}
        <div className="no-print" style={{ background: "#fff", border: "1px solid #dde4e8", padding: "16px 20px", marginBottom: 24, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#6a8a9a", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Filters</span>

          <select value={filterUser} onChange={e => setFilterUser(e.target.value)} style={selStyle}>
            <option value="">All staff</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
          </select>

          <select value={filterProject} onChange={e => setFilterProject(e.target.value)} style={selStyle}>
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.job_number ? `${p.job_number} — ${p.name}` : p.name}</option>)}
          </select>

          <div style={{ display: "flex", gap: 4 }}>
            {[["This week","week"],["Month","month"],["Quarter","quarter"],["Year","year"]].map(([label, key]) => (
              <button key={key} type="button"
                onClick={() => { const p = datePreset(key); setFilterFrom(p.from); setFilterTo(p.to); }}
                style={{ ...selStyle, cursor: "pointer", background: "#f4f7f9" }}>
                {label}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#8a9aa8" }}>From</span>
            <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={selStyle} />
            <span style={{ fontSize: 12, color: "#8a9aa8" }}>to</span>
            <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={selStyle} />
          </div>

          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={selStyle}>
            <option value="">All types</option>
            {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>

          <select value={filterBillable} onChange={e => setFilterBillable(e.target.value)} style={selStyle}>
            <option value="">Billable + non-billable</option>
            <option value="billable">Billable (project work)</option>
            <option value="nonbillable">Non-billable (categories)</option>
          </select>

          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
            <span style={{ fontSize: 12, color: "#8a9aa8" }}>Group by</span>
            <select value={groupBy} onChange={e => setGroupBy(e.target.value)} style={selStyle}>
              <option value="week">Week</option>
              <option value="project">Project</option>
              <option value="person">Person</option>
              <option value="category">Category</option>
            </select>
          </div>

          {(filterUser || filterProject || filterCategory || filterBillable) && (
            <button onClick={() => { setFilterUser(""); setFilterProject(""); setFilterCategory(""); setFilterBillable(""); }}
              style={{ background: "none", border: "none", color: COMPARE_FULL, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
              Clear filters
            </button>
          )}

          {loading && <span style={{ fontSize: 12, color: "#8a9aa8", fontStyle: "italic" }}>Loading…</span>}
        </div>

        {/* Summary cards */}
        <div style={{ display: "flex", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
          <SummaryCard label="Total hours" value={formatMins(totalMins)} sub={`${fEntries.length} entries`} color={TIMESHEETS_FULL} />
          <SummaryCard label="Overtime" value={formatMins(totalOt)} sub="logged separately" color="#8a6a3a" />
          <SummaryCard label="Utilisation" value={`${utilisationPct}%`} sub="billable share of hours" color={TIMESHEETS_FULL} />
          <SummaryCard label="Active projects" value={activeProjects} sub="with logged time" />
          <SummaryCard label="Staff" value={activeStaff} sub="with logged time" />
          <SummaryCard label="Weeks covered" value={Object.keys(byWeek).length} sub={filterFrom && filterTo ? `${filterFrom} → ${filterTo}` : "all time"} />
        </div>

        {fEntries.length === 0 && !loading && (
          <p style={{ color: "#6a8a9a", fontSize: 13 }}>No data for the selected filters.</p>
        )}

        {fEntries.length > 0 && (
          <>
            {/* Charts row 1 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>

              {/* Primary chart — driven by Group by */}
              <div style={{ background: "#fff", border: "1px solid #dde4e8", padding: "20px 20px 12px" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 13, fontWeight: 700, color: DESIGN_TEXT, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Hours by {groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={groupedData} margin={{ top: 0, right: 8, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f4" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8a9aa8" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#8a9aa8" }} unit="h" />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="hours" fill={TIMESHEETS_FULL} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Hours by project */}
              <div style={{ background: "#fff", border: "1px solid #dde4e8", padding: "20px 20px 12px" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 13, fontWeight: 700, color: DESIGN_TEXT, textTransform: "uppercase", letterSpacing: "0.06em" }}>Hours by Project</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={projectChartData.slice(0, 10)} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f4" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#8a9aa8" }} unit="h" />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#6a8a9a" }} width={140} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="hours" radius={[0, 2, 2, 0]}>
                      {projectChartData.slice(0, 10).map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Hours by person */}
            {personChartData.length > 1 && (
              <div style={{ background: "#fff", border: "1px solid #dde4e8", padding: "20px 20px 12px", marginBottom: 20 }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 13, fontWeight: 700, color: DESIGN_TEXT, textTransform: "uppercase", letterSpacing: "0.06em" }}>Hours by Person</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={personChartData} margin={{ top: 0, right: 8, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f4" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#8a9aa8" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#8a9aa8" }} unit="h" />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div style={{ background: "#fff", border: "1px solid #dde4e8", padding: "10px 14px", fontSize: 12 }}>
                            <p style={{ margin: "0 0 4px", fontWeight: 700, color: DESIGN_TEXT }}>{payload[0].payload.fullEmail}</p>
                            <p style={{ margin: 0, color: TIMESHEETS_FULL }}>{payload[0].value}h</p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="hours" radius={[2, 2, 0, 0]}>
                      {personChartData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Project breakdown pie + table side by side */}
            {projectChartData.length > 1 && (
              <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20, marginBottom: 20 }}>
                <div style={{ background: "#fff", border: "1px solid #dde4e8", padding: "20px" }}>
                  <h3 style={{ margin: "0 0 16px", fontSize: 13, fontWeight: 700, color: DESIGN_TEXT, textTransform: "uppercase", letterSpacing: "0.06em" }}>Project Split</h3>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={projectChartData} dataKey="hours" nameKey="name" cx="50%" cy="50%" outerRadius={90} labelLine={false}
                        label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
                          if (percent < 0.05) return null;
                          const RADIAN = Math.PI / 180;
                          const r = innerRadius + (outerRadius - innerRadius) * 0.5;
                          const x = cx + r * Math.cos(-midAngle * RADIAN);
                          const y = cy + r * Math.sin(-midAngle * RADIAN);
                          return <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>{`${(percent * 100).toFixed(0)}%`}</text>;
                        }}>
                        {projectChartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v) => [`${v}h`, "Hours"]} />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Legend */}
                  <div style={{ marginTop: 8 }}>
                    {projectChartData.slice(0, 8).map((p, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: "#6a8a9a", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: DESIGN_TEXT }}>{p.hours}h</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Project totals table */}
                <div style={{ background: "#fff", border: "1px solid #dde4e8", overflow: "hidden" }}>
                  <h3 style={{ margin: 0, padding: "16px 20px", fontSize: 13, fontWeight: 700, color: DESIGN_TEXT, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #eef2f4" }}>Project Totals</h3>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Project</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Hours</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>% of total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectChartData.map((p, i) => (
                        <tr key={i}>
                          <td style={{ ...tdStyle, display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                            {p.name}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: TIMESHEETS_FULL }}>{p.hours}h</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: "#8a9aa8" }}>
                            {totalMins ? `${((p.hours / minsToHours(totalMins)) * 100).toFixed(1)}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: DESIGN_GROUND }}>
                        <td style={{ ...tdStyle, fontWeight: 700 }}>Total</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: TIMESHEETS_FULL }}>{minsToHours(totalMins)}h</td>
                        <td style={{ ...tdStyle, textAlign: "right", color: "#8a9aa8" }}>100%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* Detailed breakdown table */}
            <div style={{ background: "#fff", border: "1px solid #dde4e8" }}>
              <h3 style={{ margin: 0, padding: "16px 20px", fontSize: 13, fontWeight: 700, color: DESIGN_TEXT, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #eef2f4" }}>
                Weekly Breakdown by Staff Member
              </h3>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Week</th>
                    <th style={thStyle}>Person</th>
                    <th style={thStyle}>Projects worked on</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Overtime</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Total hours</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{formatWeekFull(r.mon)}</td>
                      <td style={{ ...tdStyle, color: "#6a8a9a" }}>{r.email}</td>
                      <td style={{ ...tdStyle, color: "#6a8a9a", fontSize: 12 }}>
                        {r.projects.size > 0 ? [...r.projects].join(", ") : "—"}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: r.otMins > 0 ? 600 : 400, color: r.otMins > 0 ? "#8a6a3a" : "#c0ccd4" }}>
                        {r.otMins > 0 ? formatMins(r.otMins) : "—"}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: r.mins >= 37.5 * 60 ? TIMESHEETS_FULL : COMPARE_FULL }}>
                        {formatMins(r.mins)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: DESIGN_GROUND }}>
                    <td colSpan={3} style={{ ...tdStyle, fontWeight: 700 }}>Grand total</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#8a6a3a" }}>{totalOt > 0 ? formatMins(totalOt) : "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: TIMESHEETS_FULL }}>{formatMins(totalMins)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
