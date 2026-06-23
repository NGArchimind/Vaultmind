import React, { useState, useEffect, useCallback } from "react";
import { api, apiBlob } from "../api/client";
import { DESIGN_TEXT, TIMESHEETS_FULL, COMPARE_FULL } from "../constants";
import ProjectPicker from "./ProjectPicker";

const EXPENSE_TYPES = [
  { value: "train",   label: "Train" },
  { value: "mileage", label: "Car Mileage" },
  { value: "meals",   label: "Meals" },
  { value: "taxi",    label: "Taxi" },
  { value: "parking", label: "Parking" },
];

function typeLabel(v) { return EXPENSE_TYPES.find(t => t.value === v)?.label || v; }

// Today's date as YYYY-MM-DD from the LOCAL calendar — never via UTC (BST guard).
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function poundAmount(item) {
  const pounds = (item.amount_pence / 100).toFixed(2);
  return item.expense_type === "mileage" ? `£${pounds} (${item.miles} mi)` : `£${pounds}`;
}

function formatDate(d) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function StatusBadge({ status }) {
  const map = {
    draft:     { label: "Draft",    bg: "#eef2f4", color: "#6a8a9a" },
    submitted: { label: "Submitted", bg: "#fff8e1", color: "#b07800" },
    approved:  { label: "Approved", bg: "#e8f5e9", color: "#2e7d32" },
    rejected:  { label: "Returned", bg: "#fdf0ee", color: "#9e4a3a" },
  };
  const s = map[status] || map.draft;
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}44`, padding: "2px 8px", fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0 }}>
      {s.label}
    </span>
  );
}

const fmtTotal = (pence) => `£${((pence || 0) / 100).toFixed(2)}`;

export default function ExpensesTab({ projects, recentIds = [] }) {
  const [claims,      setClaims]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [mileageRate, setMileageRate] = useState(45);
  const [toast,       setToast]       = useState(null);
  const [confirmDel,  setConfirmDel]  = useState(null);
  const [submittingId, setSubmittingId] = useState(null);

  // Add/edit-line form (targets one claim)
  const [formClaimId, setFormClaimId] = useState(null);
  const [editingId,   setEditingId]   = useState(null);
  const [fType,    setFType]    = useState("train");
  const [fProject, setFProject] = useState("");
  const [fDate,    setFDate]    = useState(todayLocal());
  const [fAmount,  setFAmount]  = useState("");
  const [fMiles,   setFMiles]   = useState("");
  const [fDesc,    setFDesc]    = useState("");
  const [fFile,    setFFile]    = useState(null);
  const [saving,   setSaving]   = useState(false);

  const showToast = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); }, []);

  const loadClaims = useCallback(() => api("/api/expense-claims").then(cs => setClaims(cs || [])).catch(() => {}), []);

  useEffect(() => {
    Promise.all([
      api("/api/expense-claims", { method: "POST" }),   // get-or-create this user's draft
      api("/api/expenses/settings"),
    ])
      .then(([, settings]) => { setMileageRate(settings?.mileage_rate_ppm || 45); })
      .then(loadClaims)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [loadClaims]);

  const editableClaims = claims.filter(c => c.status === "draft" || c.status === "rejected");
  const historyClaims  = claims.filter(c => c.status === "submitted" || c.status === "approved");

  const resetForm = useCallback(() => {
    setFormClaimId(null); setEditingId(null); setFType("train"); setFProject(""); setFDate(todayLocal());
    setFAmount(""); setFMiles(""); setFDesc(""); setFFile(null);
  }, []);

  const openAdd = (claimId) => { resetForm(); setFormClaimId(claimId); };

  const openEdit = (item) => {
    setFormClaimId(item.claim_id);
    setEditingId(item.id);
    setFType(item.expense_type);
    setFProject(item.project_id);
    setFDate(item.expense_date);
    if (item.expense_type === "mileage") { setFMiles(String(item.miles)); setFAmount(""); }
    else { setFAmount(String(item.amount_pence / 100)); setFMiles(""); }
    setFDesc(item.description);
    setFFile(null);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) { setFFile(null); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setFFile({ name: file.name, base64: ev.target.result, mimeType: file.type });
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!fProject) return showToast("Please select a project.");
    if (!fDesc.trim()) return showToast("Please enter a description / reason.");
    if (fType === "mileage" && (!fMiles || Number(fMiles) <= 0)) return showToast("Please enter miles.");
    if (fType !== "mileage" && (!fAmount || Number(fAmount) <= 0)) return showToast("Please enter an amount.");

    setSaving(true);
    try {
      const body = {
        project_id: fProject, expense_type: fType, expense_date: fDate, description: fDesc.trim(),
        ...(fType === "mileage" ? { miles: Number(fMiles) } : { amount_pence: Math.round(Number(fAmount) * 100) }),
      };
      let saved;
      if (editingId) {
        saved = await api(`/api/expenses/${editingId}`, { method: "PUT", body });
      } else {
        saved = await api("/api/expenses", { method: "POST", body: { ...body, claim_id: formClaimId } });
      }
      if (fFile) {
        await api(`/api/expenses/${saved.id}/receipt`, {
          method: "POST",
          body: { content: fFile.base64, filename: fFile.name, mimeType: fFile.mimeType },
        });
      }
      await loadClaims();
      showToast(editingId ? "Line updated." : "Line added.");
      resetForm();
    } catch {
      showToast("Could not save the line.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api(`/api/expenses/${id}`, { method: "DELETE" });
      await loadClaims();
      showToast("Line removed.");
    } catch { showToast("Could not remove the line."); }
    finally { setConfirmDel(null); }
  };

  const submitClaim = async (claimId) => {
    setSubmittingId(claimId);
    try {
      await api(`/api/expense-claims/${claimId}/submit`, { method: "POST" });
      await loadClaims();
      showToast("Claim submitted.");
    } catch (e) {
      showToast(e?.message || "Could not submit claim.");
    } finally { setSubmittingId(null); }
  };

  const startNewClaim = async () => {
    try { await api("/api/expense-claims", { method: "POST" }); await loadClaims(); }
    catch { showToast("Could not start a new claim."); }
  };

  const openReceipt = async (id) => {
    try {
      const res = await apiBlob(`/api/expenses/${id}/receipt`, null, "GET");
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank");
    } catch { showToast("Could not open receipt."); }
  };

  const isMileage = fType === "mileage";
  const calcAmt = isMileage && fMiles ? `= £${(Number(fMiles) * mileageRate / 100).toFixed(2)}` : "";
  const ss = { padding: "6px 8px", fontSize: 12, border: "1px solid #d0d8de", background: "#fff", color: DESIGN_TEXT, fontFamily: "Inter, Arial, sans-serif" };
  const lbl = { fontSize: 10, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 };

  const addForm = (claimId) => (
    <div style={{ background: "#f8fafb", border: "1px solid #dde4e8", padding: "16px 18px", marginTop: 10 }}>
      <h4 style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 700, color: DESIGN_TEXT, textTransform: "uppercase", letterSpacing: ".06em" }}>
        {editingId ? "Edit line" : "Add line"}
      </h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={lbl}>Type</div>
          <select value={fType} onChange={e => setFType(e.target.value)} style={{ ...ss, width: "100%" }}>
            {EXPENSE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <div style={lbl}>Project</div>
          <ProjectPicker value={fProject} onChange={setFProject} projects={projects} recentIds={recentIds} hideOther style={{ width: "100%" }} />
        </div>
        <div>
          <div style={lbl}>Date</div>
          <input type="date" value={fDate} onChange={e => setFDate(e.target.value)} style={{ ...ss, width: "100%", boxSizing: "border-box" }} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={lbl}>{isMileage ? "Miles" : "Amount (£)"}</div>
          <input type="number" min="0" step={isMileage ? "1" : "0.01"}
            value={isMileage ? fMiles : fAmount}
            onChange={e => isMileage ? setFMiles(e.target.value) : setFAmount(e.target.value)}
            placeholder={isMileage ? "e.g. 42" : "e.g. 24.50"}
            style={{ ...ss, width: "100%", boxSizing: "border-box" }} />
          {isMileage && calcAmt && <div style={{ fontSize: 10, color: TIMESHEETS_FULL, marginTop: 3, fontWeight: 600 }}>{calcAmt} @ {mileageRate}p/mi</div>}
        </div>
        <div>
          <div style={lbl}>Description / Reason</div>
          <input type="text" value={fDesc} onChange={e => setFDesc(e.target.value)} placeholder="What was it for?" style={{ ...ss, width: "100%", boxSizing: "border-box" }} />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={lbl}>Receipt</div>
          <label style={{ fontSize: 11, border: "1px dashed #d0d8de", color: "#8a9aa8", padding: "3px 10px", cursor: "pointer" }}>
            📎 {fFile ? fFile.name : "Attach file"}
            <input type="file" accept="image/*,.pdf" onChange={handleFileChange} style={{ display: "none" }} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={resetForm} style={{ ...ss, background: "#fff", color: "#6a8a9a", cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            style={{ background: TIMESHEETS_FULL, color: "#fff", border: "none", padding: "6px 20px", fontSize: 12, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving…" : editingId ? "Save line" : "Add line"}
          </button>
        </div>
      </div>
      {claimId /* keep linter happy: form is bound to this claim */ && null}
    </div>
  );

  const lineRow = (item, editable) => (
    <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderTop: "1px solid #eef2f4", flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: DESIGN_TEXT, minWidth: 90 }}>{typeLabel(item.expense_type)}</span>
      <span style={{ fontSize: 11, color: "#6a8a9a" }}>{formatDate(item.expense_date)}</span>
      <span style={{ fontSize: 12, color: TIMESHEETS_FULL, fontWeight: 600 }}>{poundAmount(item)}</span>
      <span style={{ fontSize: 11, color: "#8a9aa8", minWidth: 120 }}>
        {item.projects?.job_number ? `${item.projects.job_number} — ${item.projects.name}` : item.projects?.name || "—"}
      </span>
      <span style={{ fontSize: 11, color: "#6a8a9a", flex: 1 }}>{item.description}</span>
      {item.receipt_key && (
        <button onClick={() => openReceipt(item.id)} title="View receipt"
          style={{ fontSize: 14, color: "#8a9aa8", background: "none", border: "none", cursor: "pointer", padding: "0 2px" }}>📎</button>
      )}
      {editable && (
        <>
          <button onClick={() => openEdit(item)} style={{ fontSize: 11, color: TIMESHEETS_FULL, background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: "0 4px" }}>Edit</button>
          <button onClick={() => setConfirmDel(item.id)} style={{ fontSize: 18, color: "#bbb", background: "none", border: "none", cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>×</button>
        </>
      )}
    </div>
  );

  return (
    <div style={{ padding: "24px 32px" }}>
      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, background: DESIGN_TEXT, color: "#fff", padding: "10px 20px", fontSize: 13, zIndex: 9999 }}>{toast}</div>}

      {confirmDel && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9998 }}>
          <div style={{ background: "#fff", padding: 28, maxWidth: 400, width: "90%", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 600, color: DESIGN_TEXT }}>Remove line?</h3>
            <p style={{ margin: "0 0 22px", fontSize: 13, color: "#4a5a6a" }}>This expense line will be permanently removed from the claim.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setConfirmDel(null)} style={{ background: "#fff", border: "1px solid #e4e4e8", color: "#666", padding: "7px 18px", fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => handleDelete(confirmDel)} style={{ background: COMPARE_FULL, border: "none", color: "#fff", padding: "7px 18px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {loading && <p style={{ color: "#6a8a9a", fontSize: 13 }}>Loading…</p>}

      {!loading && !claims.some(c => c.status === "draft") && (
        <button onClick={startNewClaim}
          style={{ background: TIMESHEETS_FULL, color: "#fff", border: "none", padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 18 }}>
          + Start a new claim
        </button>
      )}

      {/* Editable claims (draft + any returned claim being fixed) */}
      {editableClaims.map(claim => {
        const items = claim.project_expenses || [];
        return (
          <div key={claim.id} style={{ background: "#fff", border: "1px solid #dde4e8", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "#f8fafb", borderBottom: "1px solid #dde4e8" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: DESIGN_TEXT, textTransform: "uppercase", letterSpacing: ".06em" }}>
                {claim.status === "rejected" ? "Returned claim — edit & resubmit" : "Current claim"}
              </span>
              <StatusBadge status={claim.status} />
              <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: DESIGN_TEXT }}>Total: {fmtTotal(claim.total_pence)}</span>
            </div>

            {claim.status === "rejected" && claim.rejection_reason && (
              <div style={{ padding: "10px 16px" }}>
                <div style={{ padding: "6px 10px", background: "#fdf0ee", borderLeft: "3px solid #9e4a3a", fontSize: 12, color: "#9e4a3a" }}>
                  <strong>Returned: </strong>{claim.rejection_reason}
                </div>
              </div>
            )}

            {items.length === 0 && (formClaimId !== claim.id) && (
              <p style={{ padding: "14px 16px", margin: 0, color: "#6a8a9a", fontSize: 13 }}>No lines yet. Add your first expense below.</p>
            )}
            {items.map(item => lineRow(item, true))}

            {formClaimId === claim.id
              ? <div style={{ padding: "0 12px 12px" }}>{addForm(claim.id)}</div>
              : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px" }}>
                  <button onClick={() => openAdd(claim.id)}
                    style={{ background: "none", border: `1px dashed ${TIMESHEETS_FULL}`, color: TIMESHEETS_FULL, fontSize: 12, padding: "5px 14px", cursor: "pointer", fontWeight: 600 }}>
                    + Add line
                  </button>
                  <button onClick={() => submitClaim(claim.id)} disabled={items.length === 0 || submittingId === claim.id}
                    style={{ background: items.length === 0 ? "#ccc" : TIMESHEETS_FULL, color: "#fff", border: "none", padding: "7px 22px", fontSize: 13, fontWeight: 600, cursor: items.length === 0 ? "default" : "pointer" }}>
                    {submittingId === claim.id ? "Submitting…" : claim.status === "rejected" ? "Resubmit claim" : "Submit claim"}
                  </button>
                </div>
              )}
          </div>
        );
      })}

      {/* History */}
      {historyClaims.length > 0 && (
        <h3 style={{ fontSize: 11, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: ".06em", margin: "24px 0 10px" }}>Past claims</h3>
      )}
      {historyClaims.map(claim => {
        const items = claim.project_expenses || [];
        return (
          <div key={claim.id} style={{ background: "#fff", border: "1px solid #dde4e8", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: items.length ? "1px solid #eef2f4" : "none" }}>
              <StatusBadge status={claim.status} />
              <span style={{ fontSize: 12, color: "#6a8a9a" }}>{claim.submitted_at ? formatDate(claim.submitted_at.slice(0, 10)) : ""}</span>
              <span style={{ fontSize: 11, color: "#8a9aa8" }}>{items.length} item(s)</span>
              <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: DESIGN_TEXT }}>{fmtTotal(claim.total_pence)}</span>
            </div>
            {items.map(item => lineRow(item, false))}
          </div>
        );
      })}

      {!loading && editableClaims.length === 0 && historyClaims.length === 0 && (
        <p style={{ color: "#6a8a9a", fontSize: 13 }}>No claims yet.</p>
      )}
    </div>
  );
}
