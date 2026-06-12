import React, { useState, useEffect, useCallback } from "react";
import { api, apiBlob } from "../api/client";
import { DESIGN_TEXT, TIMESHEETS_FULL, COMPARE_FULL } from "../constants";

const EXPENSE_TYPES = [
  { value: "train",   label: "Train" },
  { value: "mileage", label: "Car Mileage" },
  { value: "meals",   label: "Meals" },
  { value: "taxi",    label: "Taxi" },
  { value: "parking", label: "Parking" },
];

function typeLabel(v) { return EXPENSE_TYPES.find(t => t.value === v)?.label || v; }

// Today's date as YYYY-MM-DD from the LOCAL calendar — never via UTC.
// toISOString() converts to UTC first, which can show yesterday's date
// in the early hours when the UK is on British Summer Time.
function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatAmount(expense) {
  const pounds = (expense.amount_pence / 100).toFixed(2);
  if (expense.expense_type === "mileage") return `£${pounds} (${expense.miles} mi)`;
  return `£${pounds}`;
}

function formatDate(d) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function StatusBadge({ status }) {
  const map = {
    pending:  { label: "Pending",  bg: "#fff8e1", color: "#b07800" },
    approved: { label: "Approved", bg: "#e8f5e9", color: "#2e7d32" },
    rejected: { label: "Rejected", bg: "#fdf0ee", color: "#9e4a3a" },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}44`, padding: "2px 8px", fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0 }}>
      {s.label}
    </span>
  );
}

export default function ExpensesTab({ projects }) {
  const [expenses,    setExpenses]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [filter,      setFilter]      = useState("all");
  const [mileageRate, setMileageRate] = useState(45);
  const [showForm,    setShowForm]    = useState(false);
  const [editingId,   setEditingId]   = useState(null);
  const [toast,       setToast]       = useState(null);
  const [confirmDel,  setConfirmDel]  = useState(null);

  // Form fields
  const [fType,    setFType]    = useState("train");
  const [fProject, setFProject] = useState("");
  const [fDate,    setFDate]    = useState(todayLocal());
  const [fAmount,  setFAmount]  = useState("");
  const [fMiles,   setFMiles]   = useState("");
  const [fDesc,    setFDesc]    = useState("");
  const [fFile,    setFFile]    = useState(null); // { name, base64, mimeType }
  const [saving,   setSaving]   = useState(false);

  const showToast = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); }, []);

  useEffect(() => {
    Promise.all([api("/api/expenses"), api("/api/expenses/settings")])
      .then(([exp, settings]) => {
        setExpenses(exp || []);
        setMileageRate(settings?.mileage_rate_ppm || 45);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const resetForm = useCallback(() => {
    setEditingId(null); setFType("train"); setFProject(""); setFDate(todayLocal());
    setFAmount(""); setFMiles(""); setFDesc(""); setFFile(null); setShowForm(false);
  }, []);

  const openEdit = useCallback((exp) => {
    setEditingId(exp.id);
    setFType(exp.expense_type);
    setFProject(exp.project_id);
    setFDate(exp.expense_date);
    if (exp.expense_type === "mileage") { setFMiles(String(exp.miles)); setFAmount(""); }
    else { setFAmount(String(exp.amount_pence / 100)); setFMiles(""); }
    setFDesc(exp.description);
    setFFile(null);
    setShowForm(true);
  }, []);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) { setFFile(null); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setFFile({ name: file.name, base64: ev.target.result, mimeType: file.type });
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!fProject) return showToast("Please select a project.");
    if (!fDesc.trim()) return showToast("Please enter a description.");
    if (fType === "mileage" && (!fMiles || Number(fMiles) <= 0)) return showToast("Please enter miles.");
    if (fType !== "mileage" && (!fAmount || Number(fAmount) <= 0)) return showToast("Please enter an amount.");

    setSaving(true);
    try {
      const body = {
        project_id: fProject, expense_type: fType, expense_date: fDate, description: fDesc.trim(),
        ...(fType === "mileage"
          ? { miles: Number(fMiles) }
          : { amount_pence: Math.round(Number(fAmount) * 100) }),
      };
      let saved;
      if (editingId) {
        saved = await api(`/api/expenses/${editingId}`, { method: "PUT", body });
        setExpenses(prev => prev.map(e => e.id === editingId ? saved : e));
      } else {
        saved = await api("/api/expenses", { method: "POST", body });
        setExpenses(prev => [saved, ...prev]);
      }
      if (fFile) {
        await api(`/api/expenses/${saved.id}/receipt`, {
          method: "POST",
          body: { content: fFile.base64, filename: fFile.name, mimeType: fFile.mimeType },
        });
        setExpenses(prev => prev.map(e => e.id === saved.id ? { ...e, receipt_key: saved.id } : e));
      }
      showToast(editingId ? "Expense updated." : "Expense submitted.");
      resetForm();
    } catch {
      showToast("Could not save expense.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api(`/api/expenses/${id}`, { method: "DELETE" });
      setExpenses(prev => prev.filter(e => e.id !== id));
      showToast("Expense deleted.");
    } catch { showToast("Could not delete expense."); }
    finally { setConfirmDel(null); }
  };

  const openReceipt = async (id) => {
    try {
      const res = await apiBlob(`/api/expenses/${id}/receipt`, null, "GET");
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank");
    } catch { showToast("Could not open receipt."); }
  };

  const filtered = filter === "all" ? expenses : expenses.filter(e => e.status === filter);
  const isMileage = fType === "mileage";
  const calcAmt   = isMileage && fMiles ? `= £${(Number(fMiles) * mileageRate / 100).toFixed(2)}` : "";

  const ss = { padding: "6px 8px", fontSize: 12, border: "1px solid #d0d8de", background: "#fff", color: DESIGN_TEXT, fontFamily: "Inter, Arial, sans-serif" };

  return (
    <div style={{ padding: "24px 32px" }}>
      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, background: DESIGN_TEXT, color: "#fff", padding: "10px 20px", fontSize: 13, zIndex: 9999 }}>{toast}</div>}

      {confirmDel && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9998 }}>
          <div style={{ background: "#fff", padding: 28, maxWidth: 400, width: "90%", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 600, color: DESIGN_TEXT }}>Delete expense?</h3>
            <p style={{ margin: "0 0 22px", fontSize: 13, color: "#4a5a6a" }}>This expense will be permanently deleted.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setConfirmDel(null)} style={{ background: "#fff", border: "1px solid #e4e4e8", color: "#666", padding: "7px 18px", fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => handleDelete(confirmDel)} style={{ background: COMPARE_FULL, border: "none", color: "#fff", padding: "7px 18px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div style={{ background: "#fff", border: "1px solid #dde4e8", padding: "18px 20px", marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 12, fontWeight: 700, color: DESIGN_TEXT, textTransform: "uppercase", letterSpacing: ".06em" }}>
            {editingId ? "Edit Expense" : "Add Expense"}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>Type</div>
              <select value={fType} onChange={e => setFType(e.target.value)} style={{ ...ss, width: "100%" }}>
                {EXPENSE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>Project</div>
              <select value={fProject} onChange={e => setFProject(e.target.value)} style={{ ...ss, width: "100%" }}>
                <option value="">— Select —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.job_number ? `${p.job_number} — ${p.name}` : p.name}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>Date</div>
              <input type="date" value={fDate} onChange={e => setFDate(e.target.value)} style={{ ...ss, width: "100%", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>
                {isMileage ? "Miles" : "Amount (£)"}
              </div>
              <input type="number" min="0" step={isMileage ? "1" : "0.01"}
                value={isMileage ? fMiles : fAmount}
                onChange={e => isMileage ? setFMiles(e.target.value) : setFAmount(e.target.value)}
                placeholder={isMileage ? "e.g. 42" : "e.g. 24.50"}
                style={{ ...ss, width: "100%", boxSizing: "border-box" }}
              />
              {isMileage && calcAmt && (
                <div style={{ fontSize: 10, color: TIMESHEETS_FULL, marginTop: 3, fontWeight: 600 }}>{calcAmt} @ {mileageRate}p/mi</div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>Description</div>
              <input type="text" value={fDesc} onChange={e => setFDesc(e.target.value)}
                placeholder="What was it for?"
                style={{ ...ss, width: "100%", boxSizing: "border-box" }}
              />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6a8a9a", textTransform: "uppercase", letterSpacing: ".06em" }}>Receipt (optional)</div>
              <label style={{ fontSize: 11, border: "1px dashed #d0d8de", color: "#8a9aa8", padding: "3px 10px", cursor: "pointer" }}>
                📎 {fFile ? fFile.name : "Attach file"}
                <input type="file" accept="image/*,.pdf" onChange={handleFileChange} style={{ display: "none" }} />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={resetForm} style={{ ...ss, background: "#fff", color: "#6a8a9a", cursor: "pointer" }}>Cancel</button>
              <button onClick={handleSubmit} disabled={saving}
                style={{ background: TIMESHEETS_FULL, color: "#fff", border: "none", padding: "6px 20px", fontSize: 12, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}>
                {saving ? "Saving…" : editingId ? "Save Changes" : "Submit Expense"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#6a8a9a", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>Filter:</span>
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{ ...ss, fontSize: 11 }}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        {!showForm && (
          <button onClick={() => { resetForm(); setShowForm(true); }}
            style={{ background: TIMESHEETS_FULL, color: "#fff", border: "none", padding: "6px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            + Add Expense
          </button>
        )}
      </div>

      {loading && <p style={{ color: "#6a8a9a", fontSize: 13 }}>Loading…</p>}
      {!loading && filtered.length === 0 && (
        <p style={{ color: "#6a8a9a", fontSize: 13 }}>
          {filter === "all" ? "No expenses yet. Click “+ Add Expense” to submit one." : `No ${filter} expenses.`}
        </p>
      )}

      {filtered.map(expense => (
        <div key={expense.id} style={{ background: "#fff", border: "1px solid #dde4e8", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: expense.status === "approved" ? "#2e7d32" : expense.status === "rejected" ? "#9e4a3a" : "#b07800", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: DESIGN_TEXT }}>{typeLabel(expense.expense_type)}</span>
                <span style={{ fontSize: 11, color: "#6a8a9a" }}>{formatDate(expense.expense_date)}</span>
                <span style={{ fontSize: 12, color: TIMESHEETS_FULL, fontWeight: 600 }}>{formatAmount(expense)}</span>
                <span style={{ fontSize: 11, color: "#6a8a9a", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{expense.description}</span>
              </div>
              <div style={{ fontSize: 10, color: "#8a9aa8" }}>
                {expense.projects?.job_number ? `${expense.projects.job_number} — ${expense.projects.name}` : expense.projects?.name || "—"}
              </div>
            </div>
            <StatusBadge status={expense.status} />
            {expense.receipt_key && (
              <button onClick={() => openReceipt(expense.id)} title="View receipt"
                style={{ fontSize: 14, color: "#8a9aa8", background: "none", border: "none", cursor: "pointer", padding: "0 2px" }}>📎</button>
            )}
            {expense.status === "pending" && (
              <>
                <button onClick={() => openEdit(expense)}
                  style={{ fontSize: 11, color: TIMESHEETS_FULL, background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: "0 4px" }}>
                  Edit
                </button>
                <button onClick={() => setConfirmDel(expense.id)}
                  style={{ fontSize: 18, color: "#bbb", background: "none", border: "none", cursor: "pointer", lineHeight: 1, padding: "0 4px", width: 28, flexShrink: 0 }}>
                  ×
                </button>
              </>
            )}
            {expense.status !== "pending" && <div style={{ width: 28 }} />}
          </div>
          {expense.status === "rejected" && expense.rejection_reason && (
            <div style={{ padding: "0 14px 10px 34px" }}>
              <div style={{ padding: "6px 10px", background: "#fdf0ee", borderLeft: "3px solid #9e4a3a", fontSize: 12, color: "#9e4a3a" }}>
                <strong>Reason: </strong>{expense.rejection_reason}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
