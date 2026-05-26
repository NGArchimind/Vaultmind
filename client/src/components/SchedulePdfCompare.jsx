import { SCHEDULE_FULL } from "../constants";

export default function SchedulePdfCompare() {
  return (
    <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 4, overflow: "hidden", fontFamily: "Inter, Arial, sans-serif" }}>
      <div style={{ background: SCHEDULE_FULL, padding: "10px 14px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", letterSpacing: ".04em" }}>PDF Compare</div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.65)", marginTop: 2 }}>Upload two PDF schedules to compare revisions</div>
      </div>
      <div style={{ padding: 16, fontSize: 11, color: "#9a9aa0" }}>Coming soon…</div>
    </div>
  );
}
