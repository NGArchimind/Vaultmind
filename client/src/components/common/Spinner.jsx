import { AD_GREEN } from "../../constants";

export function Spinner({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
    </svg>
  );
}

export function ProgressBar({ label, pct, color = AD_GREEN }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9a9088", marginBottom: 4, letterSpacing: "0.04em" }}>
        <span style={{ fontWeight: 500 }}>{label}</span><span>{Math.round(pct)}%</span>
      </div>
      <div style={{ height: 3, background: "#e8e0d5" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}
