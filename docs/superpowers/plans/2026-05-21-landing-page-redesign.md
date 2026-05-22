# Landing Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Archimind landing page with a two-row grouped layout, coloured header-band tiles with blueprint grid + SVG icons, rename Compare → Data Sheet Compare and Library → Product Library, and add Projects and Timesheets tiles.

**Architecture:** Three isolated file changes — add a constant, update the nav label map in App.js, and rewrite LandingPage.jsx. No routing or section component changes. LandingPage.jsx is extracted into a reusable `Tile` sub-component plus a `BlueprintGrid` helper to keep the file clean.

**Tech Stack:** React (CRA), inline styles, existing constants from `constants.js`, inline SVG icons.

---

## File Map

| File | Change |
|------|--------|
| `client/src/constants.js` | Add `ARC_SLATE` |
| `client/src/App.js` | Add `NAV_LABELS` map; use it in nav render |
| `client/src/components/LandingPage.jsx` | Full rewrite — `BlueprintGrid`, `Tile`, tile data arrays, grouped layout |

---

### Task 1: Add ARC_SLATE colour constant

**Files:**
- Modify: `client/src/constants.js`

- [ ] **Step 1: Open `client/src/constants.js` and add the new constant after the existing palette block**

  Find the line:
  ```js
  export const LIBRARY_BLUE_LIGHT = "#eef4f8";
  ```
  Add immediately after it:
  ```js
  export const ARC_SLATE = "#5a6a7a";
  ```

- [ ] **Step 2: Verify the file looks right**

  The top of the file should now read:
  ```js
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
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add client/src/constants.js
  git commit -m "feat: add ARC_SLATE colour constant for Timesheets tile"
  ```

---

### Task 2: Update nav bar labels in App.js

**Files:**
- Modify: `client/src/App.js` (~line 1237)

The nav currently renders labels by auto-capitalising section keys. We need a label map so "compare" shows "Data Sheet Compare" and "library" shows "Product Library".

- [ ] **Step 1: Add the `NAV_LABELS` map**

  Find the top-nav `div` block (around line 1230). Just above the `{["vault", "compare", ...].map(...)` line, add:

  ```js
  const NAV_LABELS = {
    vault: "Vault",
    compare: "Data Sheet Compare",
    library: "Product Library",
    projects: "Projects",
    timesheets: "Timesheets",
  };
  ```

  This can live inside the JSX return block, immediately before the `.map(...)` call.

- [ ] **Step 2: Replace the auto-capitalise expression**

  Find this line inside the `.map()`:
  ```js
  {section.charAt(0).toUpperCase() + section.slice(1)}
  ```
  Replace with:
  ```js
  {NAV_LABELS[section] ?? section}
  ```

- [ ] **Step 3: Verify the nav block looks like this**

  ```jsx
  const NAV_LABELS = {
    vault: "Vault",
    compare: "Data Sheet Compare",
    library: "Product Library",
    projects: "Projects",
    timesheets: "Timesheets",
  };
  {["vault", "compare", "library", "projects", "timesheets"].map(section => (
    <button key={section} className="btn" onClick={() => navigate(section)}
      style={{ background: appSection === section ? "rgba(255,255,255,0.12)" : "none", color: appSection === section ? "#ffffff" : "#7a9aaa", padding: "6px 14px", fontSize: 12, fontWeight: appSection === section ? 600 : 400, letterSpacing: "0.06em", textTransform: "uppercase", border: "none" }}>
      {NAV_LABELS[section] ?? section}
    </button>
  ))}
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add client/src/App.js
  git commit -m "feat: rename Compare and Library in nav bar to full display names"
  ```

---

### Task 3: Rewrite LandingPage.jsx

**Files:**
- Modify: `client/src/components/LandingPage.jsx`

Replace the entire file with the code below. Key structural decisions:
- `BlueprintGrid` — pure SVG component, renders the grid overlay inside each tile header band
- `Tile` — self-contained tile component with its own hover state, avoids repeating 40+ lines of JSX five times
- `TILES` / `PRACTICE_TILES` — plain data arrays; separating data from markup makes adding future tiles trivial
- `ICONS` — keyed object of JSX SVG elements, one per section

- [ ] **Step 1: Replace the entire contents of `client/src/components/LandingPage.jsx` with:**

  ```jsx
  import { useState } from "react";
  import {
    AD_GREEN, AD_GREEN_FOREST, ARC_NAVY, ARC_TERRACOTTA,
    ARC_STONE, LIBRARY_BLUE, ARC_SLATE,
  } from "../constants";

  function BlueprintGrid() {
    return (
      <svg
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.15 }}
        viewBox="0 0 300 120"
        preserveAspectRatio="none"
      >
        <line x1="0" y1="30" x2="300" y2="30" stroke="white" strokeWidth="0.8" />
        <line x1="0" y1="60" x2="300" y2="60" stroke="white" strokeWidth="0.8" />
        <line x1="0" y1="90" x2="300" y2="90" stroke="white" strokeWidth="0.8" />
        <line x1="75"  y1="0" x2="75"  y2="120" stroke="white" strokeWidth="0.8" />
        <line x1="150" y1="0" x2="150" y2="120" stroke="white" strokeWidth="0.8" />
        <line x1="225" y1="0" x2="225" y2="120" stroke="white" strokeWidth="0.8" />
      </svg>
    );
  }

  function Tile({ id, label, description, color, icon, ctaLabel, onSelect }) {
    const [hover, setHover] = useState(false);
    return (
      <button
        className="btn"
        onClick={() => onSelect(id)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          flex: 1,
          background: "#ffffff",
          border: `2px solid ${hover ? color : "#ddd8d0"}`,
          padding: 0,
          textAlign: "left",
          cursor: "pointer",
          transition: "all 0.2s",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{
          background: color,
          height: 120,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          filter: hover ? "brightness(0.88)" : "none",
          transition: "filter 0.2s",
        }}>
          <BlueprintGrid />
          <div style={{ position: "relative", zIndex: 1 }}>{icon}</div>
        </div>
        <div style={{ padding: "24px 28px 28px", display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 300, color: ARC_NAVY, letterSpacing: "0.01em", fontFamily: "Inter, Arial, sans-serif" }}>
            {label}
          </div>
          <div style={{ fontSize: 13, color: "#9a9088", lineHeight: 1.7, fontFamily: "Inter, Arial, sans-serif" }}>
            {description}
          </div>
          <div style={{ marginTop: "auto", paddingTop: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color }}>
              {ctaLabel} →
            </span>
          </div>
        </div>
      </button>
    );
  }

  const ICONS = {
    vault: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
        <path d="M7 8h10M7 11h6" />
      </svg>
    ),
    compare: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
        <line x1="12" y1="3" x2="12" y2="21" />
      </svg>
    ),
    library: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        <line x1="9" y1="7" x2="15" y2="7" />
        <line x1="9" y1="11" x2="13" y2="11" />
      </svg>
    ),
    projects: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    timesheets: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8"  y1="2" x2="8"  y2="6" />
        <line x1="3"  y1="10" x2="21" y2="10" />
        <line x1="8"  y1="14" x2="16" y2="14" />
        <line x1="8"  y1="18" x2="12" y2="18" />
      </svg>
    ),
  };

  const DOCUMENT_TILES = [
    {
      id: "vault",
      label: "Vault",
      color: AD_GREEN,
      ctaLabel: "Open Vault",
      description: "Query your building regulations documents. Upload PDFs, index vaults, and ask natural language questions across Approved Documents, British Standards, and NHBC guidance.",
    },
    {
      id: "compare",
      label: "Data Sheet Compare",
      color: ARC_TERRACOTTA,
      ctaLabel: "Open Compare",
      description: "Upload two product datasheets or technical documents. Get a detailed AI comparison of key differences, then check both products against your vault documents for compliance.",
    },
    {
      id: "library",
      label: "Product Library",
      color: LIBRARY_BLUE,
      ctaLabel: "Open Library",
      description: "Upload product datasheets and build a searchable library. Filter by manufacturer and type, check compliance against your vaults, and download datasheets on demand.",
    },
  ];

  const PRACTICE_TILES = [
    {
      id: "projects",
      label: "Projects",
      color: AD_GREEN_FOREST,
      ctaLabel: "Open Projects",
      description: "Manage projects, tasks, drawing reviews, and client emails in one place. Track progress and keep your team aligned.",
    },
    {
      id: "timesheets",
      label: "Timesheets",
      color: ARC_SLATE,
      ctaLabel: "Open Timesheets",
      description: "Log time against projects, track fees, and generate timesheet reports for the practice.",
    },
  ];

  const GROUP_LABEL_STYLE = {
    fontSize: 11,
    color: "#9a9088",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    marginBottom: 16,
    fontFamily: "Inter, Arial, sans-serif",
  };

  export default function LandingPage({ onSelect }) {
    return (
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", background: ARC_STONE, padding: "40px 24px",
        gap: 32, overflowY: "auto",
      }}>

        <div style={{ width: "100%", maxWidth: 1200 }}>
          <p style={GROUP_LABEL_STYLE}>Document Intelligence</p>
          <div style={{ display: "flex", gap: 24 }}>
            {DOCUMENT_TILES.map(t => (
              <Tile key={t.id} {...t} icon={ICONS[t.id]} onSelect={onSelect} />
            ))}
          </div>
        </div>

        <div style={{ width: "100%", maxWidth: 1200 }}>
          <p style={GROUP_LABEL_STYLE}>Practice Management</p>
          <div style={{ display: "flex", gap: 24 }}>
            {PRACTICE_TILES.map(t => (
              <Tile key={t.id} {...t} icon={ICONS[t.id]} onSelect={onSelect} />
            ))}
            <div style={{
              flex: 1,
              background: ARC_STONE,
              border: "2px dashed #c8c0b5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 220,
            }}>
              <span style={{ fontSize: 11, color: "#b8b0a5", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "Inter, Arial, sans-serif" }}>
                Coming soon
              </span>
            </div>
          </div>
        </div>

      </div>
    );
  }
  ```

- [ ] **Step 2: Start the dev server and verify in the browser**

  ```bash
  cd client && npm start
  ```

  Check at `http://localhost:3000`:
  - Two labelled rows visible: "Document Intelligence" and "Practice Management"
  - Row 1: Vault (teal band), Data Sheet Compare (terracotta band), Product Library (blue band)
  - Row 2: Projects (green band), Timesheets (slate band), Coming soon placeholder (dashed border)
  - Blueprint grid lines visible in each header band
  - Hovering a tile: band darkens, border picks up accent colour
  - Clicking each tile navigates to the correct section

- [ ] **Step 3: Verify nav bar labels**

  The top nav should show: **Vault · Data Sheet Compare · Product Library · Projects · Timesheets**
  (not "Compare" or "Library")

- [ ] **Step 4: Commit**

  ```bash
  git add client/src/components/LandingPage.jsx
  git commit -m "feat: redesign landing page — grouped rows, blueprint tile style, Projects and Timesheets tiles"
  ```

---

## Deployment

All changes are client-only (`client/src/`). Push to Vercel.

```bash
git push
```
