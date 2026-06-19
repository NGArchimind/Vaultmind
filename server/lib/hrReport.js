"use strict";

function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }

function statusLabel(s) {
  if (s === "approved") return "Approved";
  if (s === "submitted") return "Submitted";
  if (s === "draft") return "Draft";
  return "Not started";
}

// entries: [{ userId, name, projectLabel, hours, overtime }] (decimal hours)
// expected: [{ userId, name }] — always-included staff (zero-loggers show 0)
// statusByUser: { [userId]: "approved"|"submitted"|"draft" }
function buildHrReportModel({ entries, expected, statusByUser }) {
  const byUser = new Map();
  const ensure = (userId, name) => {
    if (!byUser.has(userId)) byUser.set(userId, { userId, name: name || "Unknown", hours: 0, overtime: 0, projects: new Map() });
    const row = byUser.get(userId);
    if (name && (!row.name || row.name === "Unknown")) row.name = name;
    return row;
  };
  for (const p of expected || []) ensure(p.userId, p.name);

  const projects = new Map();
  for (const e of entries || []) {
    const row = ensure(e.userId, e.name);
    const h = Number(e.hours) || 0, ot = Number(e.overtime) || 0;
    row.hours += h;
    row.overtime += ot;
    const label = e.projectLabel || "Unassigned";
    const pr = row.projects.get(label) || { hours: 0, overtime: 0 };
    pr.hours += h; pr.overtime += ot;
    row.projects.set(label, pr);
    projects.set(label, (projects.get(label) || 0) + h);
  }

  const people = [...byUser.values()]
    .map((r) => ({
      userId: r.userId, name: r.name, hours: round1(r.hours), overtime: round1(r.overtime),
      status: statusLabel((statusByUser || {})[r.userId]),
      projects: [...r.projects.entries()]
        .map(([label, v]) => ({ label, hours: round1(v.hours), overtime: round1(v.overtime) }))
        .sort((a, b) => b.hours - a.hours || a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const byProject = [...projects.entries()]
    .map(([label, hours]) => ({ label, hours: round1(hours) }))
    .sort((a, b) => b.hours - a.hours || a.label.localeCompare(b.label));

  const totals = {
    hours: round1(people.reduce((s, p) => s + p.hours, 0)),
    overtime: round1(people.reduce((s, p) => s + p.overtime, 0)),
  };

  return { people, byProject, totals };
}

module.exports = { round1, statusLabel, buildHrReportModel };
