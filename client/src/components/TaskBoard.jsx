import React, { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api/client";
import { ARC_NAVY, ARC_TERRACOTTA, ARC_STONE, AD_GREEN } from "../constants";

const PRIORITY_COLOR = { high: ARC_TERRACOTTA, medium: "#b07800", low: "#7a8a9a" };
const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" };

function initials(name) {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function isOverdue(due_date) {
  if (!due_date) return false;
  return new Date(due_date) < new Date(new Date().toDateString());
}

function fmtDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ── Priority badge ────────────────────────────────────────────────────────────
function PriorityBadge({ priority }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase",
      padding: "2px 6px", background: `${PRIORITY_COLOR[priority]}22`,
      color: PRIORITY_COLOR[priority], border: `1px solid ${PRIORITY_COLOR[priority]}44`,
    }}>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

// ── User avatar chip ──────────────────────────────────────────────────────────
function UserChip({ userId, users, size = 22 }) {
  const user = users.find(u => u.id === userId);
  if (!user) return null;
  return (
    <div title={user.full_name} style={{
      width: size, height: size, borderRadius: "50%",
      background: AD_GREEN, color: "#fff",
      fontSize: size * 0.38, fontWeight: 700,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>
      {initials(user.full_name)}
    </div>
  );
}

// ── Task card ─────────────────────────────────────────────────────────────────
function TaskCard({ task, users, onClick }) {
  const overdue = isOverdue(task.due_date);
  return (
    <div
      onClick={() => onClick(task)}
      style={{
        background: "#fff", border: "1px solid #e8e0d5", padding: "10px 12px",
        marginBottom: 8, cursor: "pointer",
        borderLeft: `3px solid ${PRIORITY_COLOR[task.priority] || PRIORITY_COLOR.medium}`,
        transition: "box-shadow 0.15s",
      }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)"}
      onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}
    >
      <div style={{ fontSize: 13, color: ARC_NAVY, fontWeight: 500, marginBottom: 6, lineHeight: 1.3 }}>
        {task.title}
      </div>
      {task.description && (
        <div style={{ fontSize: 11, color: "#9a9088", marginBottom: 6, lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          {task.description}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <PriorityBadge priority={task.priority || "medium"} />
          {task.due_date && (
            <span style={{ fontSize: 10, color: overdue ? ARC_TERRACOTTA : "#7a8a9a", fontWeight: overdue ? 600 : 400 }}>
              {overdue ? "⚠ " : ""}{fmtDate(task.due_date)}
            </span>
          )}
        </div>
        {task.assignee_id && <UserChip userId={task.assignee_id} users={users} />}
      </div>
    </div>
  );
}

// ── Inline add-task form ──────────────────────────────────────────────────────
function AddTaskForm({ columnId, users, onSave, onCancel }) {
  const [title, setTitle]     = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState("medium");
  const [saving, setSaving]   = useState(false);
  const inputRef = useRef();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    await onSave({ column_id: columnId, title, assignee_id: assignee || null, priority });
    setSaving(false);
  };

  const inputStyle = { width: "100%", border: "1px solid #dde4e8", padding: "6px 8px", fontSize: 12, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none", marginBottom: 6, boxSizing: "border-box" };
  const selectStyle = { ...inputStyle, marginBottom: 0, background: "#fff" };

  return (
    <div style={{ background: "#f5f8fa", border: `1px solid ${AD_GREEN}`, padding: 10, marginBottom: 8 }}>
      <input ref={inputRef} value={title} onChange={e => setTitle(e.target.value)} placeholder="Task title…" style={inputStyle}
        onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onCancel(); }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
        <select value={assignee} onChange={e => setAssignee(e.target.value)} style={selectStyle}>
          <option value="">Unassigned</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <select value={priority} onChange={e => setPriority(e.target.value)} style={selectStyle}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={handleSave} disabled={!title.trim() || saving}
          style={{ flex: 1, background: title.trim() ? AD_GREEN : "#ccc", color: "#fff", border: "none", padding: "6px 0", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", cursor: title.trim() ? "pointer" : "default", fontFamily: "Inter, Arial, sans-serif" }}>
          {saving ? "…" : "Add Task"}
        </button>
        <button onClick={onCancel} style={{ background: "none", border: "1px solid #dde4e8", color: "#9a9088", padding: "6px 12px", fontSize: 11, cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}>
          ✕
        </button>
      </div>
    </div>
  );
}

// ── Task detail modal ─────────────────────────────────────────────────────────
function TaskModal({ task, columns, users, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({
    title:       task.title || "",
    description: task.description || "",
    assignee_id: task.assignee_id || "",
    column_id:   task.column_id || "",
    priority:    task.priority || "medium",
    due_date:    task.due_date || "",
  });
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  const labelStyle = { fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 4 };
  const inputStyle = { width: "100%", border: "1px solid #dde4e8", padding: "8px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none", boxSizing: "border-box", marginBottom: 14 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", width: 520, maxHeight: "90vh", overflowY: "auto", borderTop: `3px solid ${ARC_NAVY}`, padding: "28px 32px", fontFamily: "Inter, Arial, sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 500, color: ARC_NAVY, margin: 0 }}>Task Details</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#9a9088", cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <label style={labelStyle}>Title *</label>
        <input value={form.title} onChange={e => set("title", e.target.value)} style={inputStyle} autoFocus />

        <label style={labelStyle}>Description</label>
        <textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3}
          style={{ ...inputStyle, resize: "vertical" }} placeholder="Additional details…" />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
          <div>
            <label style={labelStyle}>Assignee</label>
            <select value={form.assignee_id} onChange={e => set("assignee_id", e.target.value)} style={inputStyle}>
              <option value="">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Priority</label>
            <select value={form.priority} onChange={e => set("priority", e.target.value)} style={inputStyle}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Column</label>
            <select value={form.column_id} onChange={e => set("column_id", e.target.value)} style={inputStyle}>
              {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Due Date</label>
            <input type="date" value={form.due_date} onChange={e => set("due_date", e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleSave} disabled={!form.title.trim() || saving}
              style={{ background: form.title.trim() ? ARC_NAVY : "#ccc", color: "#fff", border: "none", padding: "9px 22px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: form.title.trim() ? "pointer" : "default", fontFamily: "Inter, Arial, sans-serif" }}>
              {saving ? "Saving…" : "Save Changes"}
            </button>
            <button onClick={onClose} style={{ background: "none", border: "1px solid #dde4e8", color: "#9a9088", padding: "9px 16px", fontSize: 11, cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}>
              Cancel
            </button>
          </div>
          {!confirmDel ? (
            <button onClick={() => setConfirmDel(true)}
              style={{ background: "none", border: `1px solid ${ARC_TERRACOTTA}`, color: ARC_TERRACOTTA, padding: "9px 14px", fontSize: 11, cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}>
              Delete task
            </button>
          ) : (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#9a9088" }}>Confirm delete?</span>
              <button onClick={handleDelete} disabled={deleting}
                style={{ background: ARC_TERRACOTTA, color: "#fff", border: "none", padding: "7px 14px", fontSize: 11, cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}>
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
  );
}

// ── Column header ─────────────────────────────────────────────────────────────
function ColumnHeader({ column, taskCount, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(column.name);
  const [showMenu, setShowMenu] = useState(false);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft !== column.name) onRename(column.id, draft.trim());
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, position: "relative" }}>
      {editing ? (
        <input value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} autoFocus
          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(column.name); setEditing(false); } }}
          style={{ flex: 1, border: `1px solid ${AD_GREEN}`, padding: "3px 6px", fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: ARC_NAVY, outline: "none", fontFamily: "Inter, Arial, sans-serif", background: "#fff" }} />
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#7a8a9a" }}>{column.name}</span>
          <span style={{ fontSize: 11, color: "#b0b8c0", fontWeight: 400 }}>{taskCount}</span>
        </div>
      )}
      <div style={{ position: "relative" }}>
        <button onClick={() => setShowMenu(m => !m)}
          style={{ background: "none", border: "none", color: "#b0b8c0", fontSize: 16, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}
          onMouseEnter={e => e.currentTarget.style.color = ARC_NAVY} onMouseLeave={e => e.currentTarget.style.color = "#b0b8c0"}>
          ⋯
        </button>
        {showMenu && (
          <div style={{ position: "absolute", right: 0, top: 22, background: "#fff", border: "1px solid #e8e0d5", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 100, minWidth: 130 }}>
            <button onClick={() => { setEditing(true); setShowMenu(false); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 14px", fontSize: 12, background: "none", border: "none", cursor: "pointer", color: ARC_NAVY, fontFamily: "Inter, Arial, sans-serif" }}>
              Rename
            </button>
            <button onClick={() => { setShowMenu(false); onDelete(column.id); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 14px", fontSize: 12, background: "none", border: "none", cursor: "pointer", color: ARC_TERRACOTTA, fontFamily: "Inter, Arial, sans-serif" }}>
              Delete column
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main TaskBoard ─────────────────────────────────────────────────────────────
export default function TaskBoard({ projectId }) {
  const [columns,      setColumns]     = useState([]);
  const [tasks,        setTasks]       = useState([]);
  const [users,        setUsers]       = useState([]);
  const [loading,      setLoading]     = useState(true);
  const [addingCol,    setAddingCol]   = useState(false);
  const [newColName,   setNewColName]  = useState("");
  const [addingTask,   setAddingTask]  = useState(null); // columnId | null
  const [modal,        setModal]       = useState(null); // task | null

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

  // Close column menus on outside click
  useEffect(() => {
    const handler = () => setModal(m => m); // noop — menus manage themselves
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  async function handleAddTask(colId, taskData) {
    const created = await api(`/api/projects/${projectId}/tasks`, { method: "POST", body: taskData }).catch(() => null);
    if (created) { setTasks(t => [...t, created]); setAddingTask(null); }
  }

  async function handleSaveTask(taskId, updates) {
    const saved = await api(`/api/tasks/${taskId}`, { method: "PUT", body: updates }).catch(() => null);
    if (saved) setTasks(t => t.map(x => x.id === taskId ? saved : x));
  }

  async function handleDeleteTask(taskId) {
    await api(`/api/tasks/${taskId}`, { method: "DELETE" }).catch(() => null);
    setTasks(t => t.filter(x => x.id !== taskId));
  }

  async function handleRenameColumn(colId, name) {
    const saved = await api(`/api/task-columns/${colId}`, { method: "PUT", body: { name } }).catch(() => null);
    if (saved) setColumns(c => c.map(x => x.id === colId ? saved : x));
  }

  async function handleDeleteColumn(colId) {
    if (tasks.filter(t => t.column_id === colId).length > 0) {
      if (!window.confirm("Tasks in this column will be moved to the first other column. Continue?")) return;
    }
    await api(`/api/task-columns/${colId}`, { method: "DELETE" }).catch(() => null);
    await load();
  }

  async function handleAddColumn() {
    if (!newColName.trim()) return;
    const created = await api(`/api/projects/${projectId}/task-columns`, { method: "POST", body: { name: newColName.trim() } }).catch(() => null);
    if (created) { setColumns(c => [...c, created]); setNewColName(""); setAddingCol(false); }
  }

  if (loading) {
    return <div style={{ padding: 40, color: "#9a9088", fontSize: 13, fontFamily: "Inter, Arial, sans-serif" }}>Loading tasks…</div>;
  }

  return (
    <div style={{ fontFamily: "Inter, Arial, sans-serif" }}>
      {/* Board */}
      <div style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 16, alignItems: "flex-start" }}>
        {columns.map(col => {
          const colTasks = tasks.filter(t => t.column_id === col.id);
          return (
            <div key={col.id} style={{ minWidth: 270, maxWidth: 270, flexShrink: 0, background: "#f5f8fa", padding: "14px 12px", border: "1px solid #e8e0d5" }}>
              <ColumnHeader column={col} taskCount={colTasks.length} onRename={handleRenameColumn} onDelete={handleDeleteColumn} />
              <div>
                {colTasks.map(task => (
                  <TaskCard key={task.id} task={task} users={users} onClick={setModal} />
                ))}
              </div>
              {addingTask === col.id ? (
                <AddTaskForm columnId={col.id} users={users} onSave={d => handleAddTask(col.id, d)} onCancel={() => setAddingTask(null)} />
              ) : (
                <button onClick={() => setAddingTask(col.id)}
                  style={{ width: "100%", background: "none", border: "1px dashed #c8d4da", color: "#9a9088", padding: "7px 0", fontSize: 12, cursor: "pointer", fontFamily: "Inter, Arial, sans-serif", textAlign: "center" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = AD_GREEN; e.currentTarget.style.color = AD_GREEN; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#c8d4da"; e.currentTarget.style.color = "#9a9088"; }}>
                  + Add task
                </button>
              )}
            </div>
          );
        })}

        {/* Add column */}
        <div style={{ minWidth: 220, flexShrink: 0 }}>
          {addingCol ? (
            <div style={{ background: "#f5f8fa", border: "1px solid #e8e0d5", padding: 12 }}>
              <input value={newColName} onChange={e => setNewColName(e.target.value)} autoFocus placeholder="Column name…"
                onKeyDown={e => { if (e.key === "Enter") handleAddColumn(); if (e.key === "Escape") { setAddingCol(false); setNewColName(""); } }}
                style={{ width: "100%", border: "1px solid #dde4e8", padding: "6px 8px", fontSize: 12, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none", boxSizing: "border-box", marginBottom: 8 }} />
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={handleAddColumn} disabled={!newColName.trim()}
                  style={{ flex: 1, background: newColName.trim() ? AD_GREEN : "#ccc", color: "#fff", border: "none", padding: "6px 0", fontSize: 11, fontWeight: 700, cursor: newColName.trim() ? "pointer" : "default", fontFamily: "Inter, Arial, sans-serif" }}>
                  Add
                </button>
                <button onClick={() => { setAddingCol(false); setNewColName(""); }}
                  style={{ background: "none", border: "1px solid #dde4e8", color: "#9a9088", padding: "6px 12px", fontSize: 11, cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}>
                  ✕
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingCol(true)}
              style={{ width: "100%", background: "none", border: "2px dashed #c8d4da", color: "#9a9088", padding: "12px 0", fontSize: 12, cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = AD_GREEN; e.currentTarget.style.color = AD_GREEN; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#c8d4da"; e.currentTarget.style.color = "#9a9088"; }}>
              + Add column
            </button>
          )}
        </div>
      </div>

      {/* Task modal */}
      {modal && (
        <TaskModal
          task={modal}
          columns={columns}
          users={users}
          onSave={handleSaveTask}
          onDelete={handleDeleteTask}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
