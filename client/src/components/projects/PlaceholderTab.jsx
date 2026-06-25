import { DESIGN_TEXT } from "../../constants";

// ── Placeholder tab ───────────────────────────────────────────────────────────
export default function PlaceholderTab({ icon, title, description }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 40px", textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
      <p style={{ fontSize: 16, color: DESIGN_TEXT, fontWeight: 300, fontFamily: "Inter, Arial, sans-serif", marginBottom: 8 }}>{title}</p>
      <p style={{ fontSize: 12, color: "#9a9088", maxWidth: 360, lineHeight: 1.7 }}>{description}</p>
      <div style={{ marginTop: 20, fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#b0a8a0", border: "1px solid #e8e0d5", padding: "4px 12px" }}>Coming Soon</div>
    </div>
  );
}

