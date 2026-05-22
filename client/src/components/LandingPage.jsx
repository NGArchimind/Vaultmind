import { useState } from "react";
import {
  DESIGN_GROUND, DESIGN_MUTED,
  DESIGN_PLACEHOLDER_BORDER, DESIGN_PLACEHOLDER_TEXT,
  VAULT_FULL, VAULT_WASH,
  COMPARE_FULL, COMPARE_WASH,
  LIBRARY_FULL, LIBRARY_WASH,
  PROJECTS_FULL, PROJECTS_WASH,
  TIMESHEETS_FULL, TIMESHEETS_WASH,
} from "../constants";

function Tile({ id, label, category, washColor, fullColor, cta, description, onSelect }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onSelect(id)}
      style={{
        flex: 1,
        background: "#fff",
        overflow: "hidden",
        cursor: "pointer",
        boxShadow: hover ? "0 6px 20px rgba(0,0,0,0.12)" : "0 1px 4px rgba(0,0,0,0.06)",
        transform: hover ? "translateY(-2px)" : "none",
        transition: "box-shadow 0.22s ease, transform 0.22s ease",
      }}
    >
      <div
        style={{
          padding: "20px 18px 16px",
          background: hover ? fullColor : washColor,
          transition: "background 0.22s ease",
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "#fff",
            letterSpacing: ".04em",
            display: "block",
            marginBottom: 4,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 8,
            fontWeight: 500,
            color: "rgba(255,255,255,0.55)",
            letterSpacing: ".14em",
            textTransform: "uppercase",
          }}
        >
          {category}
        </span>
      </div>

      <div
        style={{
          padding: 18,
          display: "flex",
          flexDirection: "column",
          flex: 1,
        }}
      >
        <p
          style={{
            fontSize: 9,
            color: DESIGN_MUTED,
            lineHeight: 1.8,
            margin: "0 0 14px",
          }}
        >
          {description}
        </p>
        <div
          style={{
            marginTop: "auto",
            fontSize: 8,
            fontWeight: 500,
            letterSpacing: ".16em",
            textTransform: "uppercase",
            color: hover ? fullColor : washColor,
            transition: "color 0.22s ease",
          }}
        >
          {cta}
        </div>
      </div>
    </div>
  );
}

const DOCUMENT_TILES = [
  { id: "vault",   label: "Vault",              category: "Document Intelligence", washColor: VAULT_WASH,      fullColor: VAULT_FULL,      cta: "Open Vault →",    description: "Query your building regulations documents with natural language. Get precise answers with clause references." },
  { id: "compare", label: "Data Sheet Compare", category: "Document Intelligence", washColor: COMPARE_WASH,    fullColor: COMPARE_FULL,    cta: "Open Compare →",  description: "Upload two product datasheets and compare them against your specification requirements for compliance." },
  { id: "library", label: "Product Library",    category: "Document Intelligence", washColor: LIBRARY_WASH,    fullColor: LIBRARY_FULL,    cta: "Open Library →",  description: "Build a searchable library of product datasheets. Query across all your uploaded products at once." },
];

const PRACTICE_TILES = [
  { id: "projects",   label: "Projects",   category: "Practice Management", washColor: PROJECTS_WASH,   fullColor: PROJECTS_FULL,   cta: "Open Projects →",   description: "Manage projects, tasks, drawing reviews, and client email correspondence in one place." },
  { id: "timesheets", label: "Timesheets", category: "Practice Management", washColor: TIMESHEETS_WASH, fullColor: TIMESHEETS_FULL, cta: "Open Timesheets →", description: "Log time against projects, track fees, and monitor budget against programme across the practice." },
];

const GROUP_LABEL = {
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: ".22em",
  textTransform: "uppercase",
  color: DESIGN_MUTED,
  margin: "0 0 14px",
  fontFamily: "Inter, Arial, sans-serif",
};

export default function LandingPage({ onSelect }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        background: DESIGN_GROUND,
        padding: "40px",
        gap: 32,
        overflowY: "auto",
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >

      {/* Document Intelligence group */}
      <div style={{ width: "100%", maxWidth: 1200 }}>
        <p style={GROUP_LABEL}>Document Intelligence</p>
        <div style={{ display: "flex", gap: 20 }}>
          {DOCUMENT_TILES.map(t => <Tile key={t.id} {...t} onSelect={onSelect} />)}
        </div>
      </div>

      {/* Practice Management group */}
      <div style={{ width: "100%", maxWidth: 1200 }}>
        <p style={GROUP_LABEL}>Practice Management</p>
        <div style={{ display: "flex", gap: 20 }}>
          {PRACTICE_TILES.map(t => <Tile key={t.id} {...t} onSelect={onSelect} />)}
          {/* Coming soon placeholder */}
          <div
            style={{
              flex: 1,
              background: DESIGN_GROUND,
              border: `1px dashed ${DESIGN_PLACEHOLDER_BORDER}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 180,
            }}
          >
            <span
              style={{
                fontSize: 8,
                fontWeight: 500,
                color: DESIGN_PLACEHOLDER_TEXT,
                letterSpacing: ".18em",
                textTransform: "uppercase",
              }}
            >
              Coming soon
            </span>
          </div>
        </div>
      </div>

    </div>
  );
}
