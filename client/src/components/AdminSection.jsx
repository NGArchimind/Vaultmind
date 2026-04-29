import { useState, useEffect } from "react";
import { api } from "../api/client";
import { Spinner } from "./common/Spinner";
import { ARC_NAVY, ARC_TERRACOTTA, ARC_STONE } from "../constants";

const AD_GREEN = "#2e7d4f";

export default function AdminSection() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Add user form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  // Inline role change tracking
  const [updatingRole, setUpdatingRole] = useState(null); // uid being updated
  const [deletingId, setDeletingId] = useState(null);

  const loadUsers = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/admin/users");
      setUsers(data.users || []);
    } catch (e) {
      setError("Failed to load users: " + e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleAddUser = async () => {
    if (!newEmail.trim() || !newPassword.trim()) {
      setAddError("Email and password are required.");
      return;
    }
    setAdding(true);
    setAddError("");
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: { email: newEmail.trim(), password: newPassword, role: newRole },
      });
      setNewEmail("");
      setNewPassword("");
      setNewRole("user");
      setShowAddForm(false);
      await loadUsers();
    } catch (e) {
      setAddError(e.message);
    }
    setAdding(false);
  };

  const handleChangeRole = async (uid, role) => {
    setUpdatingRole(uid);
    try {
      await api(`/api/admin/users/${uid}`, { method: "PATCH", body: { role } });
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, role } : u));
    } catch (e) {
      alert("Failed to update role: " + e.message);
    }
    setUpdatingRole(null);
  };

  const handleDeleteUser = async (uid, email) => {
    if (!window.confirm(`Delete user "${email}"? This cannot be undone.`)) return;
    setDeletingId(uid);
    try {
      await api(`/api/admin/users/${uid}`, { method: "DELETE" });
      setUsers(prev => prev.filter(u => u.id !== uid));
    } catch (e) {
      alert("Failed to delete user: " + e.message);
    }
    setDeletingId(null);
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "#faf8f5", padding: "32px 40px" }}>

      {/* Header */}
      <div style={{ marginBottom: 28, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 300, color: ARC_NAVY, letterSpacing: "0.01em", fontFamily: "Inter, Arial, sans-serif", marginBottom: 4 }}>
            User Management
          </h1>
          <p style={{ fontSize: 12, color: "#9a9088", letterSpacing: "0.04em" }}>
            Create and manage Archimind user accounts
          </p>
        </div>
        <button
          onClick={() => { setShowAddForm(v => !v); setAddError(""); }}
          style={{
            background: showAddForm ? "transparent" : ARC_NAVY,
            color: showAddForm ? "#9a9088" : "#fff",
            border: `1px solid ${showAddForm ? "#ccc" : ARC_NAVY}`,
            padding: "9px 20px",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            cursor: "pointer",
            fontFamily: "Inter, Arial, sans-serif",
          }}
        >
          {showAddForm ? "Cancel" : "+ Add User"}
        </button>
      </div>

      {/* Add user form */}
      {showAddForm && (
        <div style={{
          background: "#ffffff",
          border: `1px solid #e0dbd4`,
          borderTop: `3px solid ${ARC_TERRACOTTA}`,
          padding: "24px 28px",
          marginBottom: 24,
          maxWidth: 480,
        }}>
          <p style={{ fontSize: 10, color: "#9a9088", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 20 }}>
            New User
          </p>

          <label style={labelStyle}>Email</label>
          <input
            type="email"
            value={newEmail}
            onChange={e => { setNewEmail(e.target.value); setAddError(""); }}
            onKeyDown={e => e.key === "Enter" && handleAddUser()}
            autoFocus
            style={inputStyle(!!addError)}
          />

          <label style={labelStyle}>Password</label>
          <input
            type="password"
            value={newPassword}
            onChange={e => { setNewPassword(e.target.value); setAddError(""); }}
            onKeyDown={e => e.key === "Enter" && handleAddUser()}
            style={inputStyle(!!addError)}
          />

          <label style={labelStyle}>Role</label>
          <select
            value={newRole}
            onChange={e => setNewRole(e.target.value)}
            style={{ ...inputStyle(false), cursor: "pointer" }}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>

          {addError && (
            <p style={{ color: ARC_TERRACOTTA, fontSize: 12, marginBottom: 12, letterSpacing: "0.02em" }}>{addError}</p>
          )}

          <button
            onClick={handleAddUser}
            disabled={adding}
            style={{
              marginTop: 8,
              background: ARC_NAVY,
              color: "#fff",
              border: "none",
              padding: "10px 24px",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: adding ? "not-allowed" : "pointer",
              opacity: adding ? 0.6 : 1,
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "Inter, Arial, sans-serif",
            }}
          >
            {adding ? <><Spinner size={12} /> Creating…</> : "Create User"}
          </button>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div style={{ background: "#fdf5f3", border: `1px solid ${ARC_TERRACOTTA}`, borderLeft: `3px solid ${ARC_TERRACOTTA}`, padding: "12px 16px", marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: ARC_TERRACOTTA }}>{error}</p>
        </div>
      )}

      {/* Users table */}
      <div style={{ background: "#ffffff", border: "1px solid #e0dbd4" }}>

        {/* Table header */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 120px 160px 80px",
          padding: "10px 20px",
          borderBottom: "1px solid #e8e0d5",
          background: ARC_STONE,
        }}>
          {["Email", "Role", "Created", ""].map(h => (
            <span key={h} style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</span>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: "24px 20px", display: "flex", alignItems: "center", gap: 10, color: "#9a9088", fontSize: 13 }}>
            <Spinner size={14} /> Loading users…
          </div>
        ) : users.length === 0 ? (
          <div style={{ padding: "24px 20px", fontSize: 13, color: "#9a9088" }}>No users found.</div>
        ) : users.map(u => (
          <div
            key={u.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 120px 160px 80px",
              padding: "12px 20px",
              borderBottom: "1px solid #f0ede8",
              alignItems: "center",
            }}
          >
            {/* Email */}
            <span style={{ fontSize: 13, color: ARC_NAVY, letterSpacing: "0.01em" }}>{u.email}</span>

            {/* Role selector */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <select
                value={u.role}
                onChange={e => handleChangeRole(u.id, e.target.value)}
                disabled={updatingRole === u.id}
                style={{
                  fontSize: 11,
                  padding: "3px 6px",
                  border: `1px solid ${u.role === "admin" ? ARC_TERRACOTTA : "#ccc"}`,
                  color: u.role === "admin" ? ARC_TERRACOTTA : "#505a5f",
                  background: "#fff",
                  cursor: "pointer",
                  fontFamily: "Inter, Arial, sans-serif",
                  fontWeight: u.role === "admin" ? 600 : 400,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              {updatingRole === u.id && <Spinner size={11} />}
            </div>

            {/* Created date */}
            <span style={{ fontSize: 12, color: "#9a9088" }}>
              {u.created_at ? new Date(u.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
            </span>

            {/* Delete */}
            <button
              onClick={() => handleDeleteUser(u.id, u.email)}
              disabled={deletingId === u.id}
              title="Delete user"
              style={{
                background: "none",
                border: "none",
                color: "#c0b8b0",
                fontSize: 14,
                cursor: deletingId === u.id ? "not-allowed" : "pointer",
                padding: "2px 6px",
                fontFamily: "Inter, Arial, sans-serif",
                transition: "color 0.15s",
              }}
              onMouseEnter={e => e.target.style.color = ARC_TERRACOTTA}
              onMouseLeave={e => e.target.style.color = "#c0b8b0"}
            >
              {deletingId === u.id ? <Spinner size={12} /> : "×"}
            </button>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 11, color: "#b0a8a0", marginTop: 16, letterSpacing: "0.03em" }}>
        {users.length} user{users.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const labelStyle = {
  fontSize: 11,
  fontWeight: 600,
  color: ARC_NAVY,
  display: "block",
  marginBottom: 6,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
};

const inputStyle = (hasError) => ({
  width: "100%",
  border: hasError ? `1px solid ${ARC_TERRACOTTA}` : "1px solid #ccc",
  padding: "10px 12px",
  fontSize: 13,
  marginBottom: 14,
  outline: "none",
  fontFamily: "Inter, Arial, sans-serif",
  color: ARC_NAVY,
  background: "#fff",
  boxSizing: "border-box",
});
