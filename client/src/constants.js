// ── UI colour palette ─────────────────────────────────────────────────────────

// ── Global design shell ───────────────────────────────────────────────────────
export const DESIGN_SHELL  = "#262830";
export const DESIGN_GROUND = "#f1f2f4";
export const DESIGN_GOLD   = "#c8a84a";
export const DESIGN_TEXT   = "#262830";
export const DESIGN_MUTED  = "#9a9aa0";

// ── Per-module full colours (section interiors + tile hover) ──────────────────
export const VAULT_FULL      = "#2e9088";
export const COMPARE_FULL    = "#9e4a3a";
export const LIBRARY_FULL    = "#3a6e9a";
export const PROJECTS_FULL   = "#3e7e58";
export const TIMESHEETS_FULL = "#4c6278";

// ── Per-module washed colours (landing tile rest state) ───────────────────────
export const VAULT_WASH      = "#7da8a2";
export const COMPARE_WASH    = "#a09090";
export const LIBRARY_WASH    = "#7e94a8";
export const PROJECTS_WASH   = "#8ea09a";
export const TIMESHEETS_WASH = "#8898a8";

export const AD_GREEN = "#0d6478";
export const AD_GREEN_LIGHT = "#f0f5f6";
export const AD_GREEN_MID = "#b8d4da";
export const AD_GREEN_FOREST = "#2e7d4f";
export const AD_GREEN_GRASS = "#4a7c20";
export const ARC_NAVY = "#1e2a35";
export const ARC_TERRACOTTA = "#c25a45";
export const ARC_STONE = "#e8e0d5";
export const LIBRARY_BLUE = "#2a6496";
export const LIBRARY_BLUE_LIGHT = "#eef4f8";
export const ARC_SLATE = "#5a6a7a";

// ── Document pipeline ─────────────────────────────────────────────────────────
export const BOILERPLATE_HEADINGS = [
  "the approved documents", "what is an approved document", "approved documents",
  "list of approved documents", "use of guidance", "how to use this approved document",
  "other guidance", "the building regulations", "online version", "hm government",
  "main changes", "approved document", "list of approved documents"
];
export const isBoilerplate = (title) => {
  const t = title.toLowerCase().trim();
  return BOILERPLATE_HEADINGS.some(b => t === b || t === b + "s");
};
