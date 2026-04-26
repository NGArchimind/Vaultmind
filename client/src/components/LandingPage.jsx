import { useState } from "react";
import { AD_GREEN, AD_GREEN_MID, ARC_NAVY, ARC_TERRACOTTA, ARC_STONE } from "../constants";

export default function LandingPage({ onSelect, isAdmin }) {
  const [hoverVault, setHoverVault] = useState(false);
  const [hoverCompare, setHoverCompare] = useState(false);
  const [hoverLibrary, setHoverLibrary] = useState(false);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: ARC_STONE, padding: "40px 24px" }}>
      <div style={{ marginBottom: 48, textAlign: "center" }}>
        <p style={{ fontSize: 13, color: "#9a9088", letterSpacing: "0.1em", textTransform: "uppercase" }}>Select a tool to get started</p>
      </div>

      <div style={{ display: "flex", gap: 24, width: "100%", maxWidth: 1200 }}>

        {/* Vault tile */}
        <button className="btn" onClick={() => onSelect("vault")}
          onMouseEnter={() => setHoverVault(true)}
          onMouseLeave={() => setHoverVault(false)}
          style={{
            flex: 1, background: hoverVault ? ARC_NAVY : "#ffffff",
            border: `2px solid ${hoverVault ? ARC_NAVY : "#ddd8d0"}`,
            padding: "48px 32px", textAlign: "left", cursor: "pointer",
            transition: "all 0.2s", display: "flex", flexDirection: "column", gap: 16,
          }}>
          <div style={{ fontSize: 40 }}>🗄️</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 300, color: hoverVault ? "#ffffff" : ARC_NAVY, letterSpacing: "0.01em", fontFamily: "Inter, Arial, sans-serif", marginBottom: 8 }}>
              Vault
            </div>
            <div style={{ fontSize: 13, color: hoverVault ? "#b8d4da" : "#9a9088", lineHeight: 1.7, fontFamily: "Inter, Arial, sans-serif" }}>
              Query your building regulations documents. Upload PDFs, index vaults, and ask natural language questions across Approved Documents, British Standards, and NHBC guidance.
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: hoverVault ? AD_GREEN_MID : AD_GREEN, display: "flex", alignItems: "center", gap: 6 }}>
              Open Vault →
            </span>
          </div>
        </button>

        {/* Compare tile */}
        <button className="btn" onClick={() => onSelect("compare")}
          onMouseEnter={() => setHoverCompare(true)}
          onMouseLeave={() => setHoverCompare(false)}
          style={{
            flex: 1, background: hoverCompare ? ARC_TERRACOTTA : "#ffffff",
            border: `2px solid ${hoverCompare ? ARC_TERRACOTTA : "#ddd8d0"}`,
            padding: "48px 32px", textAlign: "left", cursor: "pointer",
            transition: "all 0.2s", display: "flex", flexDirection: "column", gap: 16,
          }}>
          <div style={{ fontSize: 40 }}>⚖️</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 300, color: hoverCompare ? "#ffffff" : ARC_NAVY, letterSpacing: "0.01em", fontFamily: "Inter, Arial, sans-serif", marginBottom: 8 }}>
              Compare
            </div>
            <div style={{ fontSize: 13, color: hoverCompare ? "#f0d0cb" : "#9a9088", lineHeight: 1.7, fontFamily: "Inter, Arial, sans-serif" }}>
              Upload two product datasheets or technical documents. Get a detailed AI comparison of key differences, then check both products against your vault documents for compliance.
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: hoverCompare ? "#f0d0cb" : ARC_TERRACOTTA, display: "flex", alignItems: "center", gap: 6 }}>
              Open Compare →
            </span>
          </div>
        </button>

        {/* Library tile */}
        <button className="btn" onClick={() => onSelect("library")}
          onMouseEnter={() => setHoverLibrary(true)}
          onMouseLeave={() => setHoverLibrary(false)}
          style={{
            flex: 1, background: hoverLibrary ? "#2a6496" : "#ffffff",
            border: `2px solid ${hoverLibrary ? "#2a6496" : "#ddd8d0"}`,
            padding: "48px 32px", textAlign: "left", cursor: "pointer",
            transition: "all 0.2s", display: "flex", flexDirection: "column", gap: 16,
          }}>
          <div style={{ fontSize: 40 }}>📋</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 300, color: hoverLibrary ? "#ffffff" : ARC_NAVY, letterSpacing: "0.01em", fontFamily: "Inter, Arial, sans-serif", marginBottom: 8 }}>
              Library
            </div>
            <div style={{ fontSize: 13, color: hoverLibrary ? "#c8dce8" : "#9a9088", lineHeight: 1.7, fontFamily: "Inter, Arial, sans-serif" }}>
              Upload product datasheets and build a searchable library. Filter by manufacturer and type, check compliance against your vaults, and download datasheets on demand.
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: hoverLibrary ? "#c8dce8" : "#2a6496", display: "flex", alignItems: "center", gap: 6 }}>
              Open Library →
            </span>
          </div>
        </button>

      </div>
    </div>
  );
}
