// ── File type badge ───────────────────────────────────────────────────────────
export function FileTypeBadge({ fileName }) {
  const ext = (fileName || "").split(".").pop().toLowerCase();
  const isDwg = ext === "dwg";
  return (
    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 5px", marginLeft: 6, background: isDwg ? "#fff3e0" : "#e8f0f8", color: isDwg ? "#c25a45" : "#2a6496", border: `1px solid ${isDwg ? "#f5c89a" : "#b8d0e8"}` }}>
      {isDwg ? "DWG" : "PDF"}
    </span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
export function StatusBadge({ status }) {
  if (!status) return <span style={{ color: "#b0a8a0", fontSize: 11 }}>—</span>;
  return (
    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", padding: "2px 8px", background: "#f8f8fa", color: "#9a7060", whiteSpace: "nowrap" }}>
      {status}
    </span>
  );
}

