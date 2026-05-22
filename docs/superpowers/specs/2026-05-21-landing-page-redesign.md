# Landing Page Redesign — Design Spec
**Date:** 2026-05-21
**Status:** Approved

---

## Overview

Redesign the Archimind landing page to:
1. Add two new feature tiles (Projects, Timesheets) with a placeholder for future tools
2. Rename "Compare" → "Data Sheet Compare" and "Library" → "Product Library" everywhere they appear (tiles + nav bar)
3. Replace emoji icons with a coloured header-band + blueprint grid + SVG icon visual style
4. Organise tiles into two labelled rows by function

---

## Layout

Two grouped rows, each with a section label above:

**Row 1 — "Document Intelligence"** (3 tiles):
Vault · Data Sheet Compare · Product Library

**Row 2 — "Practice Management"** (3 tiles):
Projects · Timesheets · Coming soon (placeholder, not clickable)

All tiles use equal `flex: 1` width within each row. Row gap and tile gap remain 24px (existing value). The placeholder tile has a dashed border and no hover/click behaviour.

---

## Tile Visual Style

Each tile has two zones:

**Header band** (~120px tall):
- Solid accent colour background
- Blueprint grid overlay (subtle white SVG lines, ~15% opacity) — evenly spaced horizontal and vertical lines across the full band
- White SVG icon (stroke-based, 40×40) centred in the band

**Body** (below the band):
- White background
- Title: 22px, font-weight 300, ARC_NAVY colour
- Description: 13px, #9a9088, line-height 1.7
- CTA: `Open [Name] →` — 11px, uppercase, 0.08em letter-spacing, accent colour

**Hover state:**
- Header band darkens (use `filter: brightness(0.88)` on the band div)
- Tile border picks up the accent colour
- CTA text lightens slightly (existing mid-tone pattern)
- Transition: `all 0.2s`

Hover state is managed with individual `useState` hooks per tile (matching the existing pattern).

---

## Tile Specifications

| Tile | `onSelect` key | Header colour | CTA |
|------|---------------|---------------|-----|
| Vault | `"vault"` | `AD_GREEN` (#0d6478) | Open Vault → |
| Data Sheet Compare | `"compare"` | `ARC_TERRACOTTA` (#c25a45) | Open Compare → |
| Product Library | `"library"` | `LIBRARY_BLUE` (#2a6496) | Open Library → |
| Projects | `"projects"` | `AD_GREEN_FOREST` (#2e7d4f) | Open Projects → |
| Timesheets | `"timesheets"` | `ARC_SLATE` (#5a6a7a) | Open Timesheets → |
| Coming soon | — | `#c8c0b5` (stone, not a constant) | No CTA |

### SVG Icons (stroke-based, 40×40 viewBox 0 0 24 24, stroke-width 1.5)

- **Vault**: monitor with document lines (`<rect x="2" y="3" width="20" height="14" rx="2"/>` + horizontal lines)
- **Data Sheet Compare**: split-page (`<path d="M9 3H5a2 2 0 0 0-2 2v14..."/>` vertical split)
- **Product Library**: open book (`<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>` + book outline)
- **Projects**: building/house (`<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5..."/>`)
- **Timesheets**: calendar (`<rect x="3" y="4" width="18" height="18" rx="2"/>` + date lines)

### Tile Descriptions

- **Vault**: "Query your building regulations documents. Upload PDFs, index vaults, and ask natural language questions across Approved Documents, British Standards, and NHBC guidance."
- **Data Sheet Compare**: "Upload two product datasheets or technical documents. Get a detailed AI comparison of key differences, then check both products against your vault documents for compliance."
- **Product Library**: "Upload product datasheets and build a searchable library. Filter by manufacturer and type, check compliance against your vaults, and download datasheets on demand."
- **Projects**: "Manage projects, tasks, drawing reviews, and client emails in one place. Track progress and keep your team aligned."
- **Timesheets**: "Log time against projects, track fees, and generate timesheet reports for the practice."

---

## Colour Constants

### New constant to add — `client/src/constants.js`

```js
export const ARC_SLATE = "#5a6a7a";
```

A cool grey-blue used for the Timesheets tile. Sits naturally alongside the existing palette.

---

## Nav Bar Update — `client/src/App.js`

The nav bar currently renders labels by auto-capitalising the section key:
```js
section.charAt(0).toUpperCase() + section.slice(1)
```

Replace with a label map so renamed tools display their full names:

```js
const NAV_LABELS = {
  vault: "Vault",
  compare: "Data Sheet Compare",
  library: "Product Library",
  projects: "Projects",
  timesheets: "Timesheets",
};
```

Use `NAV_LABELS[section] ?? section` in the nav button render.

---

## Files Changed

| File | Change |
|------|--------|
| `client/src/constants.js` | Add `ARC_SLATE = "#5a6a7a"` |
| `client/src/components/LandingPage.jsx` | Full rewrite — new layout, all 5 tiles + placeholder, style C visuals, 5 hover state hooks. Add `AD_GREEN_FOREST` and `ARC_SLATE` to imports. |
| `client/src/App.js` | Add `NAV_LABELS` map; replace auto-capitalise with map lookup in nav render |

---

## Out of Scope

- No changes to routing logic (`appSection` keys remain unchanged)
- No changes to any section components
- No mobile/responsive changes (existing behaviour preserved)
- Admin tile not added to landing page (admin access remains via nav only)
