import { useState, useEffect, useRef } from "react";
import { api } from "../api/client";
import { Spinner } from "./common/Spinner";
import { ARC_NAVY, ARC_TERRACOTTA, ARC_STONE } from "../constants";

const AD_GREEN = "#2e7d4f";

const DEFAULT_COLOURS = {
  header:      "#1a2332",
  groupRow:    "#f0ede8",
  bforward:    "#2e5e8e",
  latestIssue: "#c25a45",
  rowEven:     "#ffffff",
  rowOdd:      "#faf8f5",
  headerText:  "#ffffff",
  bodyText:    "#1a2332",
};

const COLOUR_LABELS = {
  header:      "Column Header Background",
  headerText:  "Column Header Text",
  groupRow:    "Group Row Background",
  bforward:    "B' Forward Column",
  latestIssue: "Latest Issue Column",
  rowEven:     "Alternating Row (Even)",
  rowOdd:      "Alternating Row (Odd)",
  bodyText:    "Body Text",
};

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

  const [updatingRole, setUpdatingRole] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Logo
  const [logo, setLogo] = useState(null);       // { base64, mimeType } | null
  const [logoLoading, setLogoLoading] = useState(true);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoDeleting, setLogoDeleting] = useState(false);
  const [logoMsg, setLogoMsg] = useState(null);
  const logoInputRef = useRef(null);

  // Colours
  const [colours, setColours] = useState(DEFAULT_COLOURS);
  const [coloursLoading, setColoursLoading] = useState(true);
  const [coloursDraft, setColoursDraft] = useState(DEFAULT_COLOURS);
  const [editingColours, setEditingColours] = useState(false);
  const [savingColours, setSavingColours] = useState(false);
  const [coloursMsg, setColoursMsg] = useState(null);

  function showMsg(setter, type, text) {
    setter({ type, text });
    setTimeout(() => setter(null), 6000);
  }

  useEffect(() => { loadUsers(); loadLogo(); loadColours(); }, []);

  // ── Users ──────────────────────────────────────────────────────────────────
  const loadUsers = async () => {
    setLoading(true); setError("");
    try {
      const data = await api("/api/admin/users");
      setUsers(data.users || []);
    } catch (e) { setError("Failed to load users: " + e.message); }
    setLoading(false);
  };

  const handleAddUser = async () => {
    if (!newEmail.trim() || !newPassword.trim()) { setAddError("Email and password are required."); return; }
    setAdding(true); setAddError("");
    try {
      await api("/api/admin/users", { method: "POST", body: { email: newEmail.trim(), password: newPassword, role: newRole } });
      setNewEmail(""); setNewPassword(""); setNewRole("user"); setShowAddForm(false);
      await loadUsers();
    } catch (e) { setAddError(e.message); }
    setAdding(false);
  };

  const handleChangeRole = async (uid, role) => {
    setUpdatingRole(uid);
    try {
      await api(`/api/admin/users/${uid}`, { method: "PATCH", body: { role } });
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, role } : u));
    } catch (e) { alert("Failed to update role: " + e.message); }
    setUpdatingRole(null);
  };

  const handleDeleteUser = async (uid, email) => {
    if (!window.confirm(`Delete user "${email}"? This cannot be undone.`)) return;
    setDeletingId(uid);
    try {
      await api(`/api/admin/users/${uid}`, { method: "DELETE" });
      setUsers(prev => prev.filter(u => u.id !== uid));
    } catch (e) { alert("Failed to delete user: " + e.message); }
    setDeletingId(null);
  };

  // ── Logo ───────────────────────────────────────────────────────────────────
  async function loadLogo() {
    setLogoLoading(true);
    try {
      const data = await api("/api/admin/logo");
      setLogo(data.logo ? data : null);
    } catch (e) { /* no logo */ }
    setLogoLoading(false);
  }

  async function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const allowed = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
    if (!allowed.includes(file.type)) {
      showMsg(setLogoMsg, "err", "Please upload a PNG, JPG, SVG or WebP image.");
      e.target.value = ""; return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showMsg(setLogoMsg, "err", "Logo must be under 2 MB.");
      e.target.value = ""; return;
    }
    setLogoUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(",")[1];
        try {
          await api("/api/admin/logo", { method: "POST", body: { base64, mimeType: file.type } });
          await loadLogo();
          showMsg(setLogoMsg, "ok", "Logo uploaded. It will appear on all drawing schedules.");
        } catch (err) { showMsg(setLogoMsg, "err", "Upload failed: " + err.message); }
        setLogoUploading(false);
      };
      reader.onerror = () => { showMsg(setLogoMsg, "err", "Failed to read file."); setLogoUploading(false); };
      reader.readAsDataURL(file);
    } catch (e) { showMsg(setLogoMsg, "err", e.message); setLogoUploading(false); }
    e.target.value = "";
  }

  async function handleLogoDelete() {
    if (!window.confirm("Remove the practice logo? This will affect all drawing schedules.")) return;
    setLogoDeleting(true);
    try {
      await api("/api/admin/logo", { method: "DELETE" });
      setLogo(null);
      showMsg(setLogoMsg, "ok", "Logo removed.");
    } catch (e) { showMsg(setLogoMsg, "err", "Failed to remove logo: " + e.message); }
    setLogoDeleting(false);
  }

  // ── Colours ────────────────────────────────────────────────────────────────
  async function loadColours() {
    setColoursLoading(true);
    try {
      const data = await api("/api/admin/colours");
      setColours(data);
      setColoursDraft(data);
    } catch (e) { /* use defaults */ }
    setColoursLoading(false);
  }

  async function saveColours() {
    setSavingColours(true);
    try {
      await api("/api/admin/colours", { method: "POST", body: coloursDraft });
      setColours(coloursDraft);
      setEditingColours(false);
      showMsg(setColoursMsg, "ok", "Colour scheme saved. Drawing schedules will update immediately.");
    } catch (e) { showMsg(setColoursMsg, "err", "Failed to save colours: " + e.message); }
    setSavingColours(false);
  }

  function resetColours() {
    setColoursDraft({ ...DEFAULT_COLOURS });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const sectionHeader = (title, subtitle) => (
    <div style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 16, fontWeight: 300, color: ARC_NAVY, fontFamily: "Inter, Arial, sans-serif", marginBottom: 4 }}>{title}</h2>
      {subtitle && <p style={{ fontSize: 12, color: "#9a9088" }}>{subtitle}</p>}
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "#faf8f5", padding: "32px 40px" }}>

      {/* ── User Management ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: 8, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 300, color: ARC_NAVY, letterSpacing: "0.01em", fontFamily: "Inter, Arial, sans-serif", marginBottom: 4 }}>
            User Management
          </h1>
          <p style={{ fontSize: 12, color: "#9a9088", letterSpacing: "0.04em", marginBottom: 28 }}>
            Create and manage Archimind user accounts
          </p>
        </div>
        <button onClick={() => { setShowAddForm(v => !v); setAddError(""); }}
          style={{
            background: showAddForm ? "transparent" : ARC_NAVY,
            color: showAddForm ? "#9a9088" : "#fff",
            border: `1px solid ${showAddForm ? "#ccc" : ARC_NAVY}`,
            padding: "9px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
            textTransform: "uppercase", cursor: "pointer", fontFamily: "Inter, Arial, sans-serif",
          }}>
          {showAddForm ? "Cancel" : "+ Add User"}
        </button>
      </div>

      {showAddForm && (
        <div style={{ background: "#fff", border: `1px solid #e0dbd4`, borderTop: `3px solid ${ARC_TERRACOTTA}`, padding: "24px 28px", marginBottom: 24, maxWidth: 480 }}>
          <p style={{ fontSize: 10, color: "#9a9088", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 20 }}>New User</p>
          <label style={labelStyle}>Email</label>
          <input type="email" value={newEmail} onChange={e => { setNewEmail(e.target.value); setAddError(""); }}
            onKeyDown={e => e.key === "Enter" && handleAddUser()} autoFocus style={inputStyle(!!addError)} />
          <label style={labelStyle}>Password</label>
          <input type="password" value={newPassword} onChange={e => { setNewPassword(e.target.value); setAddError(""); }}
            onKeyDown={e => e.key === "Enter" && handleAddUser()} style={inputStyle(!!addError)} />
          <label style={labelStyle}>Role</label>
          <select value={newRole} onChange={e => setNewRole(e.target.value)}
            style={{ ...inputStyle(false), cursor: "pointer" }}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          {addError && <p style={{ color: ARC_TERRACOTTA, fontSize: 12, marginBottom: 12 }}>{addError}</p>}
          <button onClick={handleAddUser} disabled={adding}
            style={{ marginTop: 8, background: ARC_NAVY, color: "#fff", border: "none", padding: "10px 24px", fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", cursor: adding ? "not-allowed" : "pointer", opacity: adding ? 0.6 : 1, display: "flex", alignItems: "center", gap: 8, fontFamily: "Inter, Arial, sans-serif" }}>
            {adding ? <><Spinner size={12} /> Creating…</> : "Create User"}
          </button>
        </div>
      )}

      {error && (
        <div style={{ background: "#fdf5f3", border: `1px solid ${ARC_TERRACOTTA}`, borderLeft: `3px solid ${ARC_TERRACOTTA}`, padding: "12px 16px", marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: ARC_TERRACOTTA }}>{error}</p>
        </div>
      )}

      <div style={{ background: "#fff", border: "1px solid #e0dbd4", marginBottom: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 160px 80px", padding: "10px 20px", borderBottom: "1px solid #e8e0d5", background: ARC_STONE }}>
          {["Email", "Role", "Created", ""].map(h => (
            <span key={h} style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</span>
          ))}
        </div>
        {loading ? (
          <div style={{ padding: "24px 20px", display: "flex", alignItems: "center", gap: 10, color: "#9a9088", fontSize: 13 }}><Spinner size={14} /> Loading users…</div>
        ) : users.length === 0 ? (
          <div style={{ padding: "24px 20px", fontSize: 13, color: "#9a9088" }}>No users found.</div>
        ) : users.map(u => (
          <div key={u.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px 160px 80px", padding: "12px 20px", borderBottom: "1px solid #f0ede8", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: ARC_NAVY, letterSpacing: "0.01em" }}>{u.email}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <select value={u.role} onChange={e => handleChangeRole(u.id, e.target.value)} disabled={updatingRole === u.id}
                style={{ fontSize: 11, padding: "3px 6px", border: `1px solid ${u.role === "admin" ? ARC_TERRACOTTA : "#ccc"}`, color: u.role === "admin" ? ARC_TERRACOTTA : "#505a5f", background: "#fff", cursor: "pointer", fontFamily: "Inter, Arial, sans-serif", fontWeight: u.role === "admin" ? 600 : 400, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              {updatingRole === u.id && <Spinner size={11} />}
            </div>
            <span style={{ fontSize: 12, color: "#9a9088" }}>
              {u.created_at ? new Date(u.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
            </span>
            <button onClick={() => handleDeleteUser(u.id, u.email)} disabled={deletingId === u.id} title="Delete user"
              style={{ background: "none", border: "none", color: "#c0b8b0", fontSize: 14, cursor: deletingId === u.id ? "not-allowed" : "pointer", padding: "2px 6px", fontFamily: "Inter, Arial, sans-serif", transition: "color 0.15s" }}
              onMouseEnter={e => e.target.style.color = ARC_TERRACOTTA} onMouseLeave={e => e.target.style.color = "#c0b8b0"}>
              {deletingId === u.id ? <Spinner size={12} /> : "×"}
            </button>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11, color: "#b0a8a0", marginBottom: 48, letterSpacing: "0.03em" }}>
        {users.length} user{users.length !== 1 ? "s" : ""}
      </p>

      {/* ── Practice Logo ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 48 }}>
        {sectionHeader("Practice Logo", "Appears in the header of all drawing schedules. PNG, JPG, SVG or WebP, max 2 MB.")}
        <div style={{ background: "#fff", border: "1px solid #e0dbd4", borderTop: `3px solid ${ARC_NAVY}`, padding: "24px 28px", maxWidth: 560 }}>

          {logoMsg && (
            <div style={{ padding: "10px 14px", marginBottom: 16, fontSize: 12, background: logoMsg.type === "ok" ? "#eef6ee" : "#fdf0f0", border: `1px solid ${logoMsg.type === "ok" ? "#a8d4a8" : "#f0b8b8"}`, color: logoMsg.type === "ok" ? "#2e7d4f" : ARC_TERRACOTTA }}>
              {logoMsg.text}
            </div>
          )}

          {logoLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9a9088", fontSize: 13 }}><Spinner size={13} /> Loading…</div>
          ) : logo?.base64 ? (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Current Logo</p>
              <div style={{ background: "#faf8f5", border: "1px solid #e8e0d5", padding: "16px 20px", display: "inline-flex", alignItems: "center", gap: 20, marginBottom: 16 }}>
                <img
                  src={`data:${logo.mimeType};base64,${logo.base64}`}
                  alt="Practice logo"
                  style={{ maxHeight: 60, maxWidth: 200, objectFit: "contain" }}
                />
                <button onClick={handleLogoDelete} disabled={logoDeleting}
                  style={{ fontSize: 11, color: ARC_TERRACOTTA, background: "none", border: `1px solid ${ARC_TERRACOTTA}`, padding: "5px 14px", fontWeight: 600, letterSpacing: "0.04em", cursor: "pointer", fontFamily: "Inter, Arial, sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
                  {logoDeleting ? <><Spinner size={10} /> Removing…</> : "× Remove"}
                </button>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "#9a9088", fontStyle: "italic", marginBottom: 16 }}>No logo uploaded yet.</p>
          )}

          <label style={{ background: ARC_NAVY, color: "#fff", border: "none", padding: "10px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", cursor: logoUploading ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "Inter, Arial, sans-serif", opacity: logoUploading ? 0.6 : 1 }}>
            {logoUploading ? <><Spinner size={11} /> Uploading…</> : (logo?.base64 ? "↑ Replace Logo" : "↑ Upload Logo")}
            <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={handleLogoUpload} disabled={logoUploading} style={{ display: "none" }} />
          </label>
        </div>
      </div>

      {/* ── Drawing Schedule Colours ──────────────────────────────────────── */}
      <div style={{ marginBottom: 48 }}>
        {sectionHeader("Drawing Schedule Colours", "Customise the colour scheme used in all drawing schedules and exports.")}
        <div style={{ background: "#fff", border: "1px solid #e0dbd4", borderTop: `3px solid ${ARC_NAVY}`, padding: "24px 28px", maxWidth: 560 }}>

          {coloursMsg && (
            <div style={{ padding: "10px 14px", marginBottom: 16, fontSize: 12, background: coloursMsg.type === "ok" ? "#eef6ee" : "#fdf0f0", border: `1px solid ${coloursMsg.type === "ok" ? "#a8d4a8" : "#f0b8b8"}`, color: coloursMsg.type === "ok" ? "#2e7d4f" : ARC_TERRACOTTA }}>
              {coloursMsg.text}
            </div>
          )}

          {coloursLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9a9088", fontSize: 13 }}><Spinner size={13} /> Loading…</div>
          ) : editingColours ? (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px", marginBottom: 20 }}>
                {Object.entries(COLOUR_LABELS).map(([key, label]) => (
                  <div key={key}>
                    <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>{label}</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="color"
                        value={coloursDraft[key] || DEFAULT_COLOURS[key]}
                        onChange={e => setColoursDraft(prev => ({ ...prev, [key]: e.target.value }))}
                        style={{ width: 40, height: 32, border: "1px solid #ddd8d0", cursor: "pointer", padding: 2 }}
                      />
                      <input
                        type="text"
                        value={coloursDraft[key] || ""}
                        onChange={e => setColoursDraft(prev => ({ ...prev, [key]: e.target.value }))}
                        style={{ width: 80, border: "1px solid #ddd8d0", padding: "5px 8px", fontSize: 12, fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, outline: "none" }}
                      />
                      <div style={{ width: 20, height: 20, background: coloursDraft[key], border: "1px solid #ddd8d0", flexShrink: 0 }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Live preview strip */}
              <div style={{ marginBottom: 20 }}>
                <p style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Preview</p>
                <div style={{ border: "1px solid #e0dbd4", overflow: "hidden", fontSize: 11, fontFamily: "Inter, Arial, sans-serif" }}>
                  <div style={{ display: "flex" }}>
                    <div style={{ flex: 3, padding: "6px 10px", background: coloursDraft.header, color: coloursDraft.headerText, fontWeight: 600, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase" }}>Drawing Title</div>
                    <div style={{ width: 90, padding: "6px 8px", background: coloursDraft.header, color: coloursDraft.headerText, fontWeight: 600, fontSize: 10, textTransform: "uppercase", textAlign: "center" }}>Drawing No.</div>
                    <div style={{ width: 60, padding: "6px 8px", background: coloursDraft.bforward, color: coloursDraft.headerText, fontWeight: 600, fontSize: 10, textTransform: "uppercase", textAlign: "center" }}>B' Fwd</div>
                    <div style={{ width: 50, padding: "6px 8px", background: coloursDraft.latestIssue, color: coloursDraft.headerText, fontWeight: 600, fontSize: 10, textAlign: "center" }}>01/04</div>
                  </div>
                  <div style={{ display: "flex", background: coloursDraft.groupRow }}>
                    <div style={{ flex: 1, padding: "5px 10px", color: coloursDraft.bodyText, fontWeight: 700, fontSize: 10, textTransform: "uppercase" }}>GA Plans</div>
                  </div>
                  <div style={{ display: "flex", background: coloursDraft.rowEven }}>
                    <div style={{ flex: 3, padding: "5px 10px", color: coloursDraft.bodyText }}>Ground Floor Plan</div>
                    <div style={{ width: 90, padding: "5px 8px", color: coloursDraft.bodyText, textAlign: "center" }}>XX-GA-001</div>
                    <div style={{ width: 60, padding: "5px 8px", background: coloursDraft.bforward + "22", color: coloursDraft.bodyText, textAlign: "center", fontWeight: 700 }}>P02</div>
                    <div style={{ width: 50, padding: "5px 8px", background: coloursDraft.latestIssue + "22", color: coloursDraft.bodyText, textAlign: "center" }}>P02</div>
                  </div>
                  <div style={{ display: "flex", background: coloursDraft.rowOdd }}>
                    <div style={{ flex: 3, padding: "5px 10px", color: coloursDraft.bodyText }}>First Floor Plan</div>
                    <div style={{ width: 90, padding: "5px 8px", color: coloursDraft.bodyText, textAlign: "center" }}>XX-GA-002</div>
                    <div style={{ width: 60, padding: "5px 8px", background: coloursDraft.bforward + "22", color: coloursDraft.bodyText, textAlign: "center" }}>—</div>
                    <div style={{ width: 50, padding: "5px 8px", background: coloursDraft.latestIssue + "22", color: coloursDraft.bodyText, textAlign: "center" }}></div>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={saveColours} disabled={savingColours}
                  style={{ background: ARC_NAVY, color: "#fff", border: "none", padding: "9px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", cursor: savingColours ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 8, fontFamily: "Inter, Arial, sans-serif" }}>
                  {savingColours ? <><Spinner size={11} /> Saving…</> : "Save Colours"}
                </button>
                <button onClick={resetColours}
                  style={{ background: "none", color: "#9a9088", border: "1px solid #ddd8d0", padding: "8px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}>
                  Reset to Default
                </button>
                <button onClick={() => { setColoursDraft({ ...colours }); setEditingColours(false); }}
                  style={{ background: "none", color: "#9a9088", border: "none", padding: "8px 12px", fontSize: 11, cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              {/* Colour swatches summary */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
                {Object.entries(COLOUR_LABELS).map(([key, label]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 18, height: 18, background: colours[key], border: "1px solid #e0dbd4", flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: "#6a6058" }}>{label}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => { setColoursDraft({ ...colours }); setEditingColours(true); }}
                style={{ background: ARC_NAVY, color: "#fff", border: "none", padding: "9px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}>
                Edit Colours
              </button>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const labelStyle = {
  fontSize: 11, fontWeight: 600, color: ARC_NAVY, display: "block",
  marginBottom: 6, letterSpacing: "0.05em", textTransform: "uppercase",
};

const inputStyle = (hasError) => ({
  width: "100%", border: hasError ? `1px solid ${ARC_TERRACOTTA}` : "1px solid #ccc",
  padding: "10px 12px", fontSize: 13, marginBottom: 14, outline: "none",
  fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY, background: "#fff", boxSizing: "border-box",
});
