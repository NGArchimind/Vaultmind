import { SCHEDULE_FULL, DESIGN_GROUND } from "../constants";
import SchedulePdfCompare from "./SchedulePdfCompare";
import ScheduleCsvExcel from "./ScheduleCsvExcel";

export default function ScheduleSection() {
  return (
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      background: DESIGN_GROUND,
      overflowY: "auto",
      fontFamily: "Inter, Arial, sans-serif",
    }}>
      {/* Header strip */}
      <div style={{ background: SCHEDULE_FULL, padding: "14px 32px", flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: "#fff", letterSpacing: ".04em" }}>
          Schedule
        </span>
      </div>

      {/* Two tool cards side by side */}
      <div style={{ padding: 32, display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SchedulePdfCompare />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ScheduleCsvExcel />
        </div>
      </div>
    </div>
  );
}
