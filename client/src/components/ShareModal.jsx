import { useState } from "react";
import { api } from "../api/client";
import { VAULT_FULL, DESIGN_MUTED } from "../constants";

export default function ShareModal({ question, answer, vaultName, shareId, setShareId, onClose }) {
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function getOrCreateLink() {
    if (shareId) return `${window.location.origin}/share/${shareId}`;
    setLoading(true);
    try {
      const { id } = await api("/api/shared-answers", {
        method: "POST",
        body: { question, answer, vault_name: vaultName }
      });
      setShareId(id);
      return `${window.location.origin}/share/${id}`;
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyLink() {
    setError(null);
    try {
      const link = await getOrCreateLink();
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        // Clipboard blocked — show the link as fallback
        setError(`Copy failed. Link: ${link}`);
        return;
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(err.message || "Could not generate link. Please try again.");
    }
  }

  async function handleEmail() {
    setError(null);
    try {
      const link = await getOrCreateLink();
      const subject = encodeURIComponent(`Archimind: ${question}`);
      const body = encodeURIComponent(
        `I used Archimind to look this up — see the full formatted answer here:\n\n${link}`
      );
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
    } catch (err) {
      setError(err.message || "Could not generate link. Please try again.");
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center"
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#ffffff", borderTop: `4px solid ${VAULT_FULL}`,
          padding: "28px 32px", width: 360, position: "relative",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)"
        }}
      >
        <button
          onClick={onClose}
          style={{ position: "absolute", top: 12, right: 16, background: "none", border: "none", fontSize: 18, color: "#9a9aa0", cursor: "pointer", lineHeight: 1 }}
        >×</button>

        <p style={{ fontSize: 11, fontWeight: 700, color: DESIGN_MUTED, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 20 }}>
          Share Answer
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={handleCopyLink}
            disabled={loading}
            style={{
              background: copied ? "#e8f5f0" : VAULT_FULL,
              color: copied ? VAULT_FULL : "#ffffff",
              border: `1px solid ${VAULT_FULL}`,
              padding: "10px 16px", fontSize: 12, fontWeight: 600,
              letterSpacing: "0.06em", cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "Inter, Arial, sans-serif", textAlign: "left",
              opacity: loading ? 0.6 : 1
            }}
          >
            {copied ? "✓ Copied" : loading ? "Generating link…" : "Copy Link"}
          </button>

          <button
            onClick={handleEmail}
            disabled={loading}
            style={{
              background: "none", border: "1px solid #d0ccc8", color: "#7a7a80",
              padding: "10px 16px", fontSize: 12, fontWeight: 600,
              letterSpacing: "0.06em", cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "Inter, Arial, sans-serif", textAlign: "left",
              opacity: loading ? 0.6 : 1
            }}
          >
            {loading ? "Generating link…" : "Open in Email"}
          </button>
        </div>

        {error && (
          <p style={{ fontSize: 11, color: "#c25a45", marginTop: 8, lineHeight: 1.4 }}>{error}</p>
        )}

        <p style={{ fontSize: 10, color: "#c0c0c8", marginTop: 16, letterSpacing: "0.04em" }}>
          Links expire after 7 days.
        </p>
      </div>
    </div>
  );
}
