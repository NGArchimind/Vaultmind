import { DESIGN_TEXT } from "../../constants";
import { stageColor, stageShort } from "./projectHelpers";

// ── Project card ──────────────────────────────────────────────────────────────
export default function ProjectCard({ project, onClick }) {
  const color = stageColor(project.stage);
  return (
    <div className="btn" onClick={onClick}
      style={{ background: "#fff", border: "1px solid #e8e0d5", borderLeft: `4px solid ${color}`, padding: "18px 24px", cursor: "pointer", display: "flex", alignItems: "center", gap: 20, transition: "all 0.15s" }}>
      <div style={{ width: 44, height: 44, background: color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", letterSpacing: "0.04em" }}>{stageShort(project.stage)}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: DESIGN_TEXT, marginBottom: 3, fontFamily: "Inter, Arial, sans-serif" }}>{project.name}</div>
        <div style={{ fontSize: 12, color: "#9a9088", display: "flex", gap: 16, flexWrap: "wrap" }}>
          {project.job_number && <span>#{project.job_number}</span>}
          {project.client && <span>👤 {project.client}</span>}
          {project.location && <span>📍 {project.location}</span>}
          {project.project_lead && <span>🧑‍💼 {project.project_lead}</span>}
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>
        {project.stage && (
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color, background: `${color}18`, padding: "3px 8px" }}>
            {project.stage.split("—")[0].trim()}
          </span>
        )}
      </div>
    </div>
  );
}

