// Shared constants + pure helpers for the Projects feature. Extracted verbatim
// from ProjectsSection.jsx.
import { AD_GREEN } from "../../constants";

export const DRAWING_TYPE_OPTIONS = [
  'Plan', 'Floor Plan', 'Roof Plan', 'Reflected Ceiling Plan', 'Site Plan',
  'Elevation', 'Section', 'Detail', 'GA', 'Setting Out',
  'Schedule', 'Specification', 'Diagram', 'Survey', 'Other'
];

export const RIBA_STAGES = [
  "Stage 0 — Strategic Definition",
  "Stage 1 — Preparation & Briefing",
  "Stage 2 — Concept Design",
  "Stage 3 — Spatial Coordination",
  "Stage 4 — Technical Design",
  "Stage 5 — Manufacturing & Construction",
  "Stage 6 — Handover",
  "Stage 7 — Use",
];

export const STAGE_COLORS = {
  "Stage 0": "#9a9088", "Stage 1": "#7a6aaa", "Stage 2": "#2a6496",
  "Stage 3": AD_GREEN,  "Stage 4": "#c25a45", "Stage 5": "#c28a20",
  "Stage 6": "#4a7c20", "Stage 7": "#505a5f",
};

export function stageColor(stage) {
  if (!stage) return "#9a9088";
  const key = Object.keys(STAGE_COLORS).find(k => stage.startsWith(k));
  return key ? STAGE_COLORS[key] : "#9a9088";
}

export function stageShort(stage) {
  if (!stage) return "—";
  const m = stage.match(/Stage (\d)/);
  return m ? `S${m[1]}` : stage;
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
