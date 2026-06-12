import { useState } from "react";
import { api } from "../api/client";
import { PROJECTS_FULL, DESIGN_TEXT } from "../constants";
import { Spinner } from "./common/Spinner";

export default function AgreementsReviewModal({ projectId, candidates, sourceLabel, sourceType, onSave, onClose }) {
  const [decisions, setDecisions] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  function decide(idx, choice) {
    setDecisions(prev => ({ ...prev, [idx]: prev[idx] === choice ? null : choice }));
  }

  const agreedItems = candidates.filter((_, i) => decisions[i] === "agreed");
  const discardedCount = candidates.filter((_, i) => decisions[i] === "discarded").length;
  const pendingCount = candidates.filter((_, i) => !decisions[i]).length;

  async function save() {
    if (agreedItems.length === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      for (const c of agreedItems) {
        if (c.possible_match_id) {
          await api(`/api/projects/${projectId}/agreements/${c.possible_match_id}/entries`, {
            method: "POST",
            body: { text: c.text, date_agreed: c.date_agreed, confirmed_by: c.confirmed_by, others_present: c.others_present, source_type: sourceType, source_label: sourceLabel },
          });
        } else {
          await api(`/api/projects/${projectId}/agreements`, {
            method: "POST",
            body: { current_text: c.text, date_agreed: c.date_agreed, confirmed_by: c.confirmed_by, others_present: c.others_present, source_type: sourceType, source_label: sourceLabel },
          });
        }
      }
      onSave();
    } catch (e) {
      console.error(e);
      setSaveError("Failed to save — check your connection and try again.");
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 6, width: "min(780px, 95vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.22)" }}>

        <div style={{ background: PROJECTS_FULL, padding: "14px 24px", flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.65)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>Agreements & Confirmations Found</div>
          <div style={{ fontSize: 14, color: "#fff", fontWeight: 600 }}>{candidates.length} item{candidates.length !== 1 ? "s" : ""} extracted — review each one</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", marginTop: 3 }}>{sourceLabel} · Agree to save, disagree to discard</div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px", background: "#f8f8fa", display: "flex", flexDirection: "column", gap: 8 }}>
          {candidates.map((c, i) => {
            const state = decisions[i];
            const isAgreed = state === "agreed";
            const isDiscarded = state === "discarded";
            return (
              <div key={i} style={{ background: "#fff", border: `1px solid ${isAgreed ? "#c8e6d4" : c.possible_match_id ? "#f0c060" : "#e4e4e8"}`, borderRadius: 5, padding: "12px 16px", opacity: isDiscarded ? 0.55 : 1, display: "flex", alignItems: "flex-start", gap: 14 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, color: DESIGN_TEXT, marginBottom: 4, textDecoration: isDiscarded ? "line-through" : "none", fontSize: 13 }}>{c.text}</div>
                  <div style={{ fontSize: 11, color: "#9a9088", marginBottom: c.possible_match_id ? 6 : 0 }}>
                    {c.confirmed_by && `Confirmed by ${c.confirmed_by}`}{c.others_present && ` · Others: ${c.others_present}`}
                  </div>
                  {c.possible_match_id && (
                    <div style={{ fontSize: 11, background: "#fef9ec", color: "#a06020", padding: "4px 8px", borderRadius: 3, border: "1px solid #f0e0a0", display: "inline-block" }}>
                      ⚠ Possible update to an existing agreement — will be added to its timeline if agreed
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                  {isAgreed && <span style={{ fontSize: 10, color: PROJECTS_FULL, fontWeight: 600, background: "#e8f4ee", padding: "2px 8px", borderRadius: 3, letterSpacing: "0.05em" }}>AGREED</span>}
                  {isDiscarded && <span style={{ fontSize: 10, color: "#9a9088", fontWeight: 600, background: "#f0ede8", padding: "2px 8px", borderRadius: 3, letterSpacing: "0.05em" }}>DISCARDED</span>}
                  <button onClick={() => decide(i, "agreed")} style={{ background: isAgreed ? PROJECTS_FULL : "#f0ede8", color: isAgreed ? "#fff" : "#6a5a48", border: isAgreed ? "none" : "1px solid #e4e4e8", padding: "6px 14px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>✓{!isAgreed && " Agree"}</button>
                  <button onClick={() => decide(i, "discarded")} style={{ background: isDiscarded ? "#c0392b" : "#f0ede8", color: isDiscarded ? "#fff" : "#6a5a48", border: isDiscarded ? "none" : "1px solid #e4e4e8", padding: "6px 14px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>✕{!isDiscarded && " Disagree"}</button>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ background: "#fff", borderTop: "1px solid #e4e4e8", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: "#9a9088" }}>{agreedItems.length} agreed · {discardedCount} discarded · {pendingCount} pending</span>
          {saveError && <span style={{ fontSize: 11, color: "#c0392b" }}>{saveError}</span>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ background: "#f0ede8", color: "#6a5a48", border: "1px solid #e4e4e8", padding: "7px 18px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            <button onClick={save} disabled={agreedItems.length === 0 || saving}
              style={{ background: agreedItems.length > 0 ? PROJECTS_FULL : "#f8f8fa", color: agreedItems.length > 0 ? "#fff" : "#9a9088", border: "none", padding: "7px 18px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: agreedItems.length > 0 ? "pointer" : "default" }}>
              {saving ? <Spinner size={11} /> : `Save agreed (${agreedItems.length})`}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
