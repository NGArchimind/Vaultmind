import { useState } from "react";
import { api } from "../api/client";
import { Spinner } from "./common/Spinner";
import { ARC_NAVY, ARC_TERRACOTTA, ARC_STONE } from "../constants";

function MenuOption({ icon, title, desc, onClick, disabled, danger }) {
  return (
    <button className="btn" onClick={onClick} disabled={disabled}
      style={{
        background: "transparent", border: `1px solid ${disabled ? "#eee" : danger ? "#f0d0cb" : ARC_STONE}`,
        padding: "12px 16px", textAlign: "left", width: "100%",
        opacity: disabled ? 0.4 : 1, cursor: disabled ? "not-allowed" : "pointer",
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: danger ? ARC_TERRACOTTA : ARC_NAVY, letterSpacing: "0.01em" }}>{title}</div>
          <div style={{ fontSize: 11, color: "#9a9088", marginTop: 2 }}>{desc}</div>
        </div>
      </div>
    </button>
  );
}

export default function VaultManagementModal({ vaults, onClose, onRefresh, isAdmin }) {
  const [mode, setMode] = useState("menu");
  const [targetVault, setTargetVault] = useState(null);
  const [inputName, setInputName] = useState("");
  const [selectedParent, setSelectedParent] = useState("");
  const [selectedSource, setSelectedSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const masterVaults = vaults.filter(v => v.type === "master");
  const flatVaults = vaults.filter(v => v.type === "vault");

  const reset = () => { setMode("menu"); setTargetVault(null); setInputName(""); setSelectedParent(""); setSelectedSource(""); setError(""); };

  const doCreateMaster = async () => {
    if (!inputName.trim()) return;
    setBusy(true); setError("");
    try {
      await api("/api/vaults", { method: "POST", body: { name: inputName.trim(), type: "master" } });
      await onRefresh(); reset();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const doCreateSub = async () => {
    if (!inputName.trim() || !selectedParent) return;
    setBusy(true); setError("");
    try {
      await api("/api/vaults", { method: "POST", body: { name: inputName.trim(), parentVault: selectedParent } });
      await onRefresh(); reset();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const doAdopt = async () => {
    if (!selectedSource || !selectedParent) return;
    setBusy(true); setError("");
    try {
      await api(`/api/vaults/${encodeURIComponent(selectedParent)}/adopt`, { method: "POST", body: { sourceVault: selectedSource } });
      await onRefresh(); reset();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const doRename = async () => {
    if (!inputName.trim() || !targetVault) return;
    setBusy(true); setError("");
    try {
      await api(`/api/vaults/${encodeURIComponent(targetVault.id)}`, { method: "PATCH", body: { name: inputName.trim() } });
      await onRefresh(); reset();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const doDelete = async () => {
    if (!targetVault) return;
    setBusy(true); setError("");
    try {
      await api(`/api/vaults/${encodeURIComponent(targetVault.id)}`, { method: "DELETE" });
      await onRefresh(); reset();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const modalStyle = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex",
    alignItems: "center", justifyContent: "center", zIndex: 1000,
  };
  const cardStyle = {
    background: "#fff", width: 480, maxHeight: "80vh", overflow: "auto",
    borderTop: `3px solid ${ARC_TERRACOTTA}`, padding: "32px 36px",
    fontFamily: "Inter, Arial, sans-serif",
  };
  const label = (txt) => (
    <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", display: "block", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>{txt}</label>
  );
  const inputEl = (val, set, placeholder, autoFocus = false) => (
    <input value={val} onChange={e => set(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
      className="arc-input"
      style={{ width: "100%", border: `1px solid #ccc`, padding: "9px 12px", fontSize: 13, color: ARC_NAVY, marginBottom: 14, outline: "none", background: "#fff", fontFamily: "Inter, Arial, sans-serif" }} />
  );
  const selectEl = (val, set, options, placeholder) => (
    <select value={val} onChange={e => set(e.target.value)}
      style={{ width: "100%", border: `1px solid #ccc`, padding: "9px 12px", fontSize: 13, color: val ? ARC_NAVY : "#9a9088", marginBottom: 14, outline: "none", background: "#fff", fontFamily: "Inter, Arial, sans-serif" }}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
  const btn = (label, onClick, variant = "primary") => (
    <button className="btn" onClick={onClick} disabled={busy}
      style={{
        background: variant === "primary" ? ARC_NAVY : variant === "danger" ? ARC_TERRACOTTA : "transparent",
        color: variant === "ghost" ? "#9a9088" : "#fff",
        border: variant === "ghost" ? "1px solid #ccc" : "none",
        padding: "8px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginRight: 8,
      }}>{busy ? <Spinner size={12} /> : label}</button>
  );

  const allVaultOptions = [];
  vaults.forEach(v => {
    allVaultOptions.push({ id: v.id, label: v.name });
    if (v.type === "master") {
      (v.subVaults || []).forEach(sv => {
        allVaultOptions.push({ id: sv.id, label: `  ↳ ${sv.name} (in ${v.name})` });
      });
    }
  });

  return (
    <div style={modalStyle} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 500, color: ARC_NAVY, letterSpacing: "0.02em" }}>
            {mode === "menu" ? "Manage Vaults" :
             mode === "createMaster" ? "New Master Vault" :
             mode === "createSub" ? "New Sub-Vault" :
             mode === "adopt" ? "Adopt Vault into Master" :
             mode === "rename" ? "Rename Vault" :
             mode === "delete" ? "Delete Vault" : "Manage Vaults"}
          </h2>
          <button className="btn" onClick={onClose} style={{ background: "none", color: "#9a9088", fontSize: 20, padding: "0 4px" }}>×</button>
        </div>

        {error && <div style={{ background: "#fdf5f3", border: `1px solid ${ARC_TERRACOTTA}`, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: ARC_TERRACOTTA }}>{error}</div>}

        {mode === "menu" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <MenuOption icon="📁" title="New Master Vault" desc="Create a top-level folder to organise sub-vaults" onClick={() => setMode("createMaster")} />
            <MenuOption icon="📂" title="New Sub-Vault" desc="Add a sub-vault inside an existing master vault" onClick={() => setMode("createSub")} disabled={masterVaults.length === 0} />
            <MenuOption icon="📥" title="Adopt Vault into Master" desc="Move an existing flat vault inside a master vault" onClick={() => setMode("adopt")} disabled={masterVaults.length === 0 || flatVaults.length === 0} />
            <MenuOption icon="✏️" title="Rename Vault" desc="Rename any vault or sub-vault" onClick={() => setMode("rename")} disabled={vaults.length === 0} />
            <MenuOption icon="🗑" title="Delete Vault" desc="Permanently delete a vault and all its documents" onClick={() => setMode("delete")} disabled={vaults.length === 0} danger />
          </div>
        )}

        {mode === "createMaster" && (
          <>
            {label("Master vault name")}
            {inputEl(inputName, setInputName, "e.g. British Standards", true)}
            <div style={{ display: "flex" }}>
              {btn("Create", doCreateMaster)}
              {btn("Cancel", reset, "ghost")}
            </div>
          </>
        )}

        {mode === "createSub" && (
          <>
            {label("Parent master vault")}
            {selectEl(selectedParent, setSelectedParent, masterVaults.map(v => ({ id: v.id, label: v.name })), "Select master vault…")}
            {label("Sub-vault name")}
            {inputEl(inputName, setInputName, "e.g. BS 9991:2021")}
            <div style={{ display: "flex" }}>
              {btn("Create", doCreateSub)}
              {btn("Cancel", reset, "ghost")}
            </div>
          </>
        )}

        {mode === "adopt" && (
          <>
            <p style={{ fontSize: 12, color: "#9a9088", marginBottom: 16, lineHeight: 1.6 }}>
              This will move all documents and the index from the flat vault into the master vault. The original vault will be removed.
            </p>
            {label("Vault to adopt")}
            {selectEl(selectedSource, setSelectedSource, flatVaults.map(v => ({ id: v.id, label: v.name })), "Select flat vault to move…")}
            {label("Move into master vault")}
            {selectEl(selectedParent, setSelectedParent, masterVaults.map(v => ({ id: v.id, label: v.name })), "Select master vault…")}
            <div style={{ display: "flex" }}>
              {btn("Adopt", doAdopt)}
              {btn("Cancel", reset, "ghost")}
            </div>
          </>
        )}

        {mode === "rename" && (
          <>
            {label("Select vault to rename")}
            {selectEl(
              targetVault?.id || "",
              (id) => setTargetVault(allVaultOptions.find(o => o.id === id)),
              allVaultOptions,
              "Select vault…"
            )}
            {targetVault && (
              <>
                {label("New name")}
                {inputEl(inputName, setInputName, "Enter new name…", true)}
              </>
            )}
            <div style={{ display: "flex" }}>
              {btn("Rename", doRename)}
              {btn("Cancel", reset, "ghost")}
            </div>
          </>
        )}

        {mode === "delete" && (
          <>
            <p style={{ fontSize: 12, color: "#9a9088", marginBottom: 16, lineHeight: 1.6 }}>
              This permanently deletes the vault and <strong>all documents inside it</strong>. This cannot be undone.
            </p>
            {label("Select vault to delete")}
            {selectEl(
              targetVault?.id || "",
              (id) => setTargetVault(allVaultOptions.find(o => o.id === id)),
              allVaultOptions,
              "Select vault…"
            )}
            {targetVault && (
              <div style={{ background: "#fdf5f3", border: `1px solid ${ARC_TERRACOTTA}`, padding: "12px 16px", marginBottom: 16 }}>
                <p style={{ fontSize: 12, color: ARC_TERRACOTTA, fontWeight: 600 }}>
                  Delete "{targetVault.label.trim()}"? This cannot be undone.
                </p>
              </div>
            )}
            <div style={{ display: "flex" }}>
              {btn("Delete permanently", doDelete, "danger")}
              {btn("Cancel", reset, "ghost")}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
