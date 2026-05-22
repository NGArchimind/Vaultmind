import React, { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import { DESIGN_TEXT, PROJECTS_FULL, COMPARE_FULL } from "../constants";
import DrawingReview from "./DrawingReview";

const PRIORITY_COLOR = { high: COMPARE_FULL, medium: "#b07800", low: "#5a7a9a" };
const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" };

function isOverdue(due_date) {
  if (!due_date) return false;
  return new Date(due_date) < new Date(new Date().toDateString());
}

function isDueThisWeek(due_date) {
  if (!due_date) return false;
  const d = new Date(due_date);
  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setDate(now.getDate() + (7 - now.getDay()));
  return d >= new Date(now.toDateString()) && d <= weekEnd;
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDateShort(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function initials(name) {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

// ── Badges ────────────────────────────────────────────────────────────────────
const REVIEW_STATUS = {
  in_review: { label: "In Review",  bg: "#fff8e6", color: "#b07800", border: "#f0d080" },
  reviewed:  { label: "Reviewed",   bg: "#f0faf2", color: "#2a7a3a", border: "#90d0a0" },
};

function ReviewBadge({ review }) {
  if (!review) return null;
  const s = REVIEW_STATUS[review.status];
  if (!s) return null;
  return (
    <span style={{ fontSize:10, fontWeight:600, padding:"2px 7px", background:s.bg, color:s.color, border:`1px solid ${s.border}`, whiteSpace:"nowrap" }}>
      {s.label} R{review.round_number}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const color = PRIORITY_COLOR[priority] || PRIORITY_COLOR.medium;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
      padding: "3px 8px", background: `${color}18`, color, border: `1px solid ${color}33`,
      whiteSpace: "nowrap",
    }}>
      {PRIORITY_LABEL[priority] || priority}
    </span>
  );
}

function StatusBadge({ name }) {
  const colors = {
    "To Do":       { bg: "#f0f4f8", color: "#5a7a9a", border: "#c8d4da" },
    "In Progress": { bg: "#fff8e6", color: "#b07800", border: "#f0d080" },
    "Review":      { bg: "#f0f5ff", color: "#4a5aaa", border: "#b0bce8" },
    "Done":        { bg: "#f0faf2", color: "#2a7a3a", border: "#90d0a0" },
  };
  const s = colors[name] || { bg: "#f5f5f5", color: "#7a8a9a", border: "#ddd" };
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: "3px 10px", whiteSpace: "nowrap",
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>
      {name}
    </span>
  );
}

function UserChip({ userId, users }) {
  const user = users.find(u => u.id === userId);
  if (!user) return <span style={{ color: "#b0b8c0", fontSize: 12 }}>—</span>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <div style={{
        width: 24, height: 24, borderRadius: "50%", background: PROJECTS_FULL,
        color: "#fff", fontSize: 9, fontWeight: 700,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        {initials(user.full_name)}
      </div>
      <span style={{ fontSize: 12, color: DESIGN_TEXT }}>{user.full_name}</span>
    </div>
  );
}

// ── Task detail modal ─────────────────────────────────────────────────────────
function TaskModal({ task, columns, users, createdByUser, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({
    title:       task.title || "",
    description: task.description || "",
    assignee_id: task.assignee_id || "",
    column_id:   task.column_id || "",
    priority:    task.priority || "medium",
    due_date:    task.due_date || "",
  });
  const [saving,     setSaving]     = useState(false);
  const [deleting,   setDeleting]   = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    await onSave(task.id, {
      title:       form.title.trim(),
      description: form.description || null,
      assignee_id: form.assignee_id || null,
      column_id:   form.column_id,
      priority:    form.priority,
      due_date:    form.due_date || null,
    });
    setSaving(false);
    onClose();
  };

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete(task.id);
    setDeleting(false);
    onClose();
  };

  const label = { fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 };
  const input = { width: "100%", border: "1px solid #dde4e8", padding: "8px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, outline: "none", boxSizing: "border-box", marginBottom: 16, background: "#fff" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#f8f8fa", width: 560, maxHeight: "90vh", overflowY: "auto", borderTop: `3px solid ${DESIGN_TEXT}`, fontFamily: "Inter, Arial, sans-serif" }}>

        {/* Modal header */}
        <div style={{ background: "#fff", padding: "20px 28px", borderBottom: "1px solid #e4e4e8", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Task</div>
            <input value={form.title} onChange={e => set("title", e.target.value)}
              style={{ fontSize: 16, fontWeight: 500, color: DESIGN_TEXT, border: "none", outline: "none", background: "transparent", width: 400, fontFamily: "Inter, Arial, sans-serif", padding: 0 }} />
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: "#9a9088", cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        <div style={{ padding: "24px 28px" }}>
          {/* Meta grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px", background: "#fff", border: "1px solid #e4e4e8", padding: "16px 20px", marginBottom: 20 }}>
            {[
              ["Status", <select value={form.column_id} onChange={e => set("column_id", e.target.value)} style={{ ...input, margin: 0, fontSize: 12 }}>
                {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>],
              ["Priority", <select value={form.priority} onChange={e => set("priority", e.target.value)} style={{ ...input, margin: 0, fontSize: 12 }}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>],
              ["Assigned to", <select value={form.assignee_id} onChange={e => set("assignee_id", e.target.value)} style={{ ...input, margin: 0, fontSize: 12 }}>
                <option value="">Unassigned</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>],
              ["Due Date", <input type="date" value={form.due_date} onChange={e => set("due_date", e.target.value)} style={{ ...input, margin: 0, fontSize: 12 }} />],
              ["Created by", <div style={{ fontSize: 12, color: DESIGN_TEXT, padding: "8px 0" }}>{createdByUser?.full_name || "—"}</div>],
              ["Created", <div style={{ fontSize: 12, color: DESIGN_TEXT, padding: "8px 0" }}>{fmtDate(task.created_at)}</div>],
            ].map(([k, v]) => (
              <div key={k} style={{ marginBottom: 12 }}>
                <div style={label}>{k}</div>
                {v}
              </div>
            ))}
          </div>

          {/* Description */}
          <div style={{ marginBottom: 20 }}>
            <label style={label}>Notes / Description</label>
            <textarea value={form.description} onChange={e => set("description", e.target.value)} rows={4}
              style={{ ...input, resize: "vertical", marginBottom: 0 }} placeholder="Add any additional detail…" />
          </div>

          {/* Actions */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleSave} disabled={!form.title.trim() || saving}
                style={{ background: form.title.trim() ? DESIGN_TEXT : "#ccc", color: "#fff", border: "none", padding: "9px 22px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: form.title.trim() ? "pointer" : "default", fontFamily: "Inter, Arial, sans-serif" }}>
                {saving ? "Saving…" : "Save Changes"}
              </button>
              <button onClick={onClose} style={{ background: "none", border: "1px solid #dde4e8", color: "#9a9088", padding: "9px 16px", fontSize: 11, cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}>
                Cancel
              </button>
            </div>
            {!confirmDel ? (
              <button onClick={() => setConfirmDel(true)}
                style={{ background: "none", border: `1px solid ${COMPARE_FULL}`, color: COMPARE_FULL, padding: "9px 14px", fontSize: 11, cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}>
                Delete task
              </button>
            ) : (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#9a9088" }}>Confirm?</span>
                <button onClick={handleDelete} disabled={deleting}
                  style={{ background: COMPARE_FULL, color: "#fff", border: "none", padding: "7px 14px", fontSize: 11, cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}>
                  {deleting ? "…" : "Yes, delete"}
                </button>
                <button onClick={() => setConfirmDel(false)}
                  style={{ background: "none", border: "1px solid #dde4e8", color: "#9a9088", padding: "7px 10px", fontSize: 11, cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}>
                  No
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Add task form (inline above table) ───────────────────────────────────────
function AddTaskForm({ columns, users, onSave, onCancel }) {
  const [form, setForm] = useState({ title: "", column_id: columns[0]?.id || "", assignee_id: "", priority: "medium", due_date: "" });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  const cellInput = { border: "1px solid #dde4e8", padding: "6px 8px", fontSize: 12, fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, outline: "none", width: "100%", background: "#fff", boxSizing: "border-box" };

  return (
    <tr style={{ background: "#f5fbf7" }}>
      <td style={{ padding: "8px 12px" }}>
        <input autoFocus value={form.title} onChange={e => set("title", e.target.value)} placeholder="Task title…" style={cellInput}
          onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onCancel(); }} />
      </td>
      <td style={{ padding: "8px 8px" }}>
        <select value={form.column_id} onChange={e => set("column_id", e.target.value)} style={cellInput}>
          {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </td>
      <td style={{ padding: "8px 8px" }}>
        <select value={form.priority} onChange={e => set("priority", e.target.value)} style={cellInput}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </td>
      <td style={{ padding: "8px 8px" }}>
        <select value={form.assignee_id} onChange={e => set("assignee_id", e.target.value)} style={cellInput}>
          <option value="">Unassigned</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
      </td>
      <td style={{ padding: "8px 8px" }}>
        <input type="date" value={form.due_date} onChange={e => set("due_date", e.target.value)} style={cellInput} />
      </td>
      <td style={{ padding: "8px 8px", whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={handleSave} disabled={!form.title.trim() || saving}
            style={{ background: form.title.trim() ? PROJECTS_FULL : "#ccc", color: "#fff", border: "none", padding: "5px 14px", fontSize: 11, fontWeight: 700, cursor: form.title.trim() ? "pointer" : "default", fontFamily: "Inter, Arial, sans-serif" }}>
            {saving ? "…" : "Add"}
          </button>
          <button onClick={onCancel}
            style={{ background: "none", border: "1px solid #dde4e8", color: "#9a9088", padding: "5px 10px", fontSize: 11, cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}>
            ✕
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Main TaskBoard ─────────────────────────────────────────────────────────────
export default function TaskBoard({ projectId }) {
  const [columns,   setColumns]   = useState([]);
  const [tasks,     setTasks]     = useState([]);
  const [users,     setUsers]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [addingTask, setAddingTask] = useState(false);
  const [modal,     setModal]     = useState(null);
  const [drawingReview, setDrawingReview] = useState(null); // { taskId, taskTitle, review }
  const [sortKey,   setSortKey]   = useState("created_at");
  const [sortDir,   setSortDir]   = useState("desc");

  // Filters
  const [fStatus,   setFStatus]   = useState("all");
  const [fPriority, setFPriority] = useState("all");
  const [fAssignee, setFAssignee] = useState("all");
  const [fDue,      setFDue]      = useState("all"); // all | overdue | this_week

  const load = useCallback(async () => {
    setLoading(true);
    const [cols, tks, members] = await Promise.all([
      api(`/api/projects/${projectId}/task-columns`).catch(() => []),
      api(`/api/projects/${projectId}/tasks`).catch(() => []),
      api("/api/team-members").catch(() => []),
    ]);
    setColumns(Array.isArray(cols) ? cols : []);
    setTasks(Array.isArray(tks) ? tks : []);
    setUsers(Array.isArray(members) ? members : []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function handleAddTask(formData) {
    const created = await api(`/api/projects/${projectId}/tasks`, { method: "POST", body: formData }).catch(() => null);
    if (created) { setTasks(t => [created, ...t]); setAddingTask(false); }
  }

  async function handleSaveTask(taskId, updates) {
    const saved = await api(`/api/tasks/${taskId}`, { method: "PUT", body: updates }).catch(() => null);
    if (saved) setTasks(t => t.map(x => x.id === taskId ? saved : x));
  }

  async function handleDeleteTask(taskId) {
    await api(`/api/tasks/${taskId}`, { method: "DELETE" }).catch(() => null);
    setTasks(t => t.filter(x => x.id !== taskId));
  }

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  // Filter + sort
  const columnMap = Object.fromEntries(columns.map(c => [c.id, c.name]));
  const priorityOrder = { high: 0, medium: 1, low: 2 };

  const visible = tasks
    .filter(t => fStatus === "all"   || t.column_id === fStatus)
    .filter(t => fPriority === "all" || t.priority === fPriority)
    .filter(t => fAssignee === "all" || t.assignee_id === fAssignee)
    .filter(t => {
      if (fDue === "overdue")   return isOverdue(t.due_date);
      if (fDue === "this_week") return isDueThisWeek(t.due_date);
      return true;
    })
    .sort((a, b) => {
      let av, bv;
      if (sortKey === "priority") { av = priorityOrder[a.priority ?? "medium"]; bv = priorityOrder[b.priority ?? "medium"]; }
      else if (sortKey === "due_date") { av = a.due_date || "9999"; bv = b.due_date || "9999"; }
      else if (sortKey === "status") { av = columnMap[a.column_id] || ""; bv = columnMap[b.column_id] || ""; }
      else if (sortKey === "assignee") { av = users.find(u => u.id === a.assignee_id)?.full_name || ""; bv = users.find(u => u.id === b.assignee_id)?.full_name || ""; }
      else { av = a[sortKey] || ""; bv = b[sortKey] || ""; }
      return sortDir === "asc" ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
    });

  const filterSelect = { fontSize: 12, border: "1px solid #dde4e8", padding: "5px 8px", fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, background: "#fff", outline: "none", cursor: "pointer" };
  const thStyle = (key) => ({
    padding: "10px 12px", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
    color: sortKey === key ? PROJECTS_FULL : "#fff", background: DESIGN_TEXT, textAlign: "left",
    cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
  });
  const sortArrow = (key) => sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  if (loading) return <div style={{ padding: 40, color: "#9a9088", fontSize: 13, fontFamily: "Inter, Arial, sans-serif" }}>Loading tasks…</div>;

  return (
    <div style={{ fontFamily: "Inter, Arial, sans-serif" }}>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.06em", textTransform: "uppercase" }}>Filter:</span>
          <select value={fStatus} onChange={e => setFStatus(e.target.value)} style={filterSelect}>
            <option value="all">All statuses</option>
            {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={fPriority} onChange={e => setFPriority(e.target.value)} style={filterSelect}>
            <option value="all">All priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select value={fAssignee} onChange={e => setFAssignee(e.target.value)} style={filterSelect}>
            <option value="all">All assignees</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <select value={fDue} onChange={e => setFDue(e.target.value)} style={filterSelect}>
            <option value="all">All due dates</option>
            <option value="overdue">Overdue</option>
            <option value="this_week">Due this week</option>
          </select>
          {(fStatus !== "all" || fPriority !== "all" || fAssignee !== "all" || fDue !== "all") && (
            <button onClick={() => { setFStatus("all"); setFPriority("all"); setFAssignee("all"); setFDue("all"); }}
              style={{ ...filterSelect, color: COMPARE_FULL, border: `1px solid ${COMPARE_FULL}`, background: "none", fontWeight: 600 }}>
              Clear filters
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "#9a9088" }}>{visible.length} task{visible.length !== 1 ? "s" : ""}</span>
          <button onClick={() => setAddingTask(true)} disabled={addingTask}
            style={{ background: PROJECTS_FULL, color: "#fff", border: "none", padding: "7px 18px", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}>
            + New Task
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ border: "1px solid #e4e4e8", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {[["title","Task"], ["status","Status"], ["priority","Priority"], ["assignee","Assigned to"], ["due_date","Due Date"], ["",""]].map(([key, label]) => (
                <th key={label} onClick={() => key && toggleSort(key)} style={thStyle(key)}>
                  {label}{sortArrow(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {addingTask && (
              <AddTaskForm columns={columns} users={users} onSave={handleAddTask} onCancel={() => setAddingTask(false)} />
            )}
            {visible.length === 0 && !addingTask && (
              <tr>
                <td colSpan={6} style={{ padding: "40px 20px", textAlign: "center", color: "#9a9088", fontSize: 13 }}>
                  {tasks.length === 0 ? "No tasks yet — add one above." : "No tasks match the current filters."}
                </td>
              </tr>
            )}
            {visible.map((task, i) => {
              const overdue = isOverdue(task.due_date);
              const colName = columnMap[task.column_id] || "—";
              return (
                <tr key={task.id}
                  onClick={() => setModal(task)}
                  style={{ background: i % 2 === 0 ? "#fff" : "#f8f8fa", borderBottom: "1px solid #f0f0f4", cursor: "pointer", transition: "background 0.1s" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#f0f8f4"}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "#fff" : "#f8f8fa"}
                >
                  <td style={{ padding: "12px 14px", color: DESIGN_TEXT, fontWeight: 500, maxWidth: 300 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</div>
                    {task.description && (
                      <div style={{ fontSize: 11, color: "#9a9088", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.description}</div>
                    )}
                  </td>
                  <td style={{ padding: "12px 10px" }}><StatusBadge name={colName} /></td>
                  <td style={{ padding: "12px 10px" }}><PriorityBadge priority={task.priority || "medium"} /></td>
                  <td style={{ padding: "12px 10px" }}><UserChip userId={task.assignee_id} users={users} /></td>
                  <td style={{ padding: "12px 10px", whiteSpace: "nowrap", color: overdue ? COMPARE_FULL : "#5a7a9a", fontWeight: overdue ? 600 : 400, fontSize: 12 }}>
                    {task.due_date ? (overdue ? `⚠ ${fmtDateShort(task.due_date)}` : fmtDateShort(task.due_date)) : "—"}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                      <ReviewBadge review={task._review} />
                      <button
                        onClick={e => { e.stopPropagation(); setDrawingReview({ taskId: task.id, taskTitle: task.title, review: task._review }); }}
                        style={{ fontSize: 11, fontWeight: 600, padding: "4px 12px", background: task._review?.status === "in_review" ? COMPARE_FULL : task._review?.status === "reviewed" ? "#e8f5e9" : "#f0f4f8", color: task._review?.status === "in_review" ? "#fff" : task._review?.status === "reviewed" ? "#2a7a3a" : "#5a7a9a", border: "none", cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}>
                        {task._review ? "Drawings" : "📄 Upload"}
                      </button>
                      <span style={{ fontSize: 11, color: "#b0b8c0" }}>View →</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Task modal */}
      {modal && (
        <TaskModal
          task={modal}
          columns={columns}
          users={users}
          createdByUser={users.find(u => u.id === modal.created_by)}
          onSave={handleSaveTask}
          onDelete={handleDeleteTask}
          onClose={() => setModal(null)}
        />
      )}

      {/* Drawing review */}
      {drawingReview && (
        <DrawingReview
          taskId={drawingReview.taskId}
          taskTitle={drawingReview.taskTitle}
          onClose={() => setDrawingReview(null)}
          onStatusChange={newReview => {
            setTasks(prev => prev.map(t =>
              t.id === drawingReview.taskId ? { ...t, _review: { ...t._review, ...newReview } } : t
            ));
          }}
        />
      )}
    </div>
  );
}
