# Global Redesign Spec — Archimind Web App
**Date:** 2026-05-22
**Scope:** `client/` only. ArchiSync (separate Electron repo) is explicitly excluded.

---

## Design decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Aesthetic direction | D — Technical Precision |
| Colour palette | D3 — Slate + Gold |
| Typography | A — Swiss Precision (medium weight, wide letter-spacing) |
| Navigation | A — Top bar, refined |
| Tile style | B — Per-module colour bands |
| Tile interaction | Washed colour at rest → full colour on hover |

---

## Design system tokens

All colours must be exported from `client/src/constants.js`. Never hardcode hex values in components.

### New constants to add

```js
// ── Global design shell ───────────────────────────────────────────────────────
export const DESIGN_SHELL  = "#262830";   // nav bar background
export const DESIGN_GROUND = "#f1f2f4";   // app background / page ground
export const DESIGN_GOLD   = "#c8a84a";   // gold accent (active nav, avatars, CTAs)
export const DESIGN_TEXT   = "#262830";   // primary text (same as shell)
export const DESIGN_MUTED  = "#9a9aa0";   // muted labels, section group headings

// ── Per-module: full colour (used inside section, hover state on landing tile) ─
export const VAULT_FULL      = "#2e9088";  // teal
export const COMPARE_FULL    = "#9e4a3a";  // terracotta
export const LIBRARY_FULL    = "#3a6e9a";  // steel blue
export const PROJECTS_FULL   = "#3e7e58";  // forest green
export const TIMESHEETS_FULL = "#4c6278";  // slate

// ── Per-module: washed colour (landing tile rest state) ───────────────────────
export const VAULT_WASH      = "#7da8a2";
export const COMPARE_WASH    = "#a09090";
export const LIBRARY_WASH    = "#7e94a8";
export const PROJECTS_WASH   = "#8ea09a";
export const TIMESHEETS_WASH = "#8898a8";
```

### Existing constants — keep as-is
`BOILERPLATE_HEADINGS`, `isBoilerplate`, `AD_GREEN_FOREST`, `AD_GREEN_GRASS`, `AD_GREEN_GRASS` — these are used in logic/data, not UI. Do not remove them.

### Existing constants — deprecate in UI (replace with new ones)
The following are still exported but components should stop referencing them for UI styling. Replace usages as follows:

| Old constant | Replace with |
|---|---|
| `ARC_NAVY` | `DESIGN_SHELL` for dark backgrounds/nav; `DESIGN_TEXT` for text |
| `AD_GREEN` | `VAULT_FULL` inside Vault section; `DESIGN_GOLD` for generic accents |
| `AD_GREEN_MID` | Remove usage — no direct replacement needed |
| `ARC_TERRACOTTA` | `COMPARE_FULL` inside Compare section |
| `ARC_STONE` | `DESIGN_GROUND` |
| `LIBRARY_BLUE` | `LIBRARY_FULL` |
| `LIBRARY_BLUE_LIGHT` | `DESIGN_GROUND` |
| `ARC_SLATE` | `TIMESHEETS_FULL` |

---

## Typography — Swiss Precision

Do not change the font family (`Inter, Arial, sans-serif` is already correct). Apply these rules:

| Element | `fontWeight` | `letterSpacing` | `textTransform` | Notes |
|---|---|---|---|---|
| Nav logo (ARCHIMIND) | 500 | `.22em` | `uppercase` | |
| Nav items | 500 | `.18em` | `uppercase` | |
| Section group labels ("Document Intelligence") | 500 | `.22em` | `uppercase` | `fontSize: 9px`, `color: DESIGN_MUTED` |
| Section header strip name | 500 | `.16em` | `uppercase` | `fontSize: 11px`, `color: #fff` |
| Tile / card headings | 500 | `.04em` | none | `fontSize: 14–16px` |
| CTA labels ("Open Vault →") | 500 | `.16em` | `uppercase` | |
| Body text | 400 | `.01em` | none | `fontSize: 13px`, `lineHeight: 1.7` |
| Input labels | 500 | `.16em` | `uppercase` | `fontSize: 9px`, `color: DESIGN_MUTED` |

---

## Component patterns

### Nav bar (App.js ~line 1239)

```
background: DESIGN_SHELL
height: 56px
padding: 0 40px
border-bottom: 1px solid #1e2028

Logo: "ARCHIMIND"
  color: #fff, fontWeight: 500, letterSpacing: .22em, textTransform: uppercase, fontSize: 14px
  onClick → navigate("home")

Divider: 1px solid #3a3c40, height 20px

Nav items (sections):
  inactive: color #9a9aa0, fontWeight 500, letterSpacing .18em, textTransform uppercase, fontSize 9px
  active:   color #fff, border-bottom: 1px solid DESIGN_GOLD, paddingBottom: 3px
  no background change on active — only the underline and colour change

User avatar (right):
  28×28 circle, background: DESIGN_GOLD, initials in DESIGN_SHELL colour
  user display name to the left in #666, fontSize 9px, letterSpacing .12em, uppercase
```

### App background
```
background: DESIGN_GROUND (#f1f2f4)
```
Replace any `ARC_STONE` or `#e8e0d5` used as page/app background.

### Section header strip
Every section (Vault, Compare, Library, Projects, Timesheets) should have a narrow strip immediately below the nav:

```
background: [MODULE_FULL colour]
padding: 12px 40px
display: flex, alignItems: center, gap: 12px

Left: module name — fontSize: 11px, fontWeight: 500, color: #fff, letterSpacing: .16em, textTransform: uppercase
Right of divider: category label — fontSize: 9px, fontWeight: 500, color: rgba(255,255,255,0.45), letterSpacing: .14em, textTransform: uppercase
  e.g. "Vault" + "— Document Intelligence"
       "Projects" + "— Practice Management"
```

Per-section strip colours:
- Vault → `VAULT_FULL` (#2e9088)
- Compare → `COMPARE_FULL` (#9e4a3a)
- Library → `LIBRARY_FULL` (#3a6e9a)
- Projects → `PROJECTS_FULL` (#3e7e58)
- Timesheets → `TIMESHEETS_FULL` (#4c6278)

### Cards / panels
```
background: #fff
border-left: 3px solid [MODULE_FULL]
box-shadow: 0 1px 4px rgba(0,0,0,0.06)
padding: 20px 24px
```

Secondary panels (no left border — informational only):
```
background: #fff
border-left: 3px solid #e4e4e8
box-shadow: 0 1px 4px rgba(0,0,0,0.06)
```

### Primary buttons
```
background: [MODULE_FULL]
color: #fff
padding: 10px 20px
fontWeight: 500
fontSize: 9px
letterSpacing: .16em
textTransform: uppercase
border: none
cursor: pointer
```

Disabled state:
```
background: #e8e8ea
color: #b0b0b6
```

### Secondary / outline buttons
```
background: transparent
border: 1px solid [MODULE_FULL]
color: [MODULE_FULL]
padding: 8px 18px
fontWeight: 500
fontSize: 9px
letterSpacing: .16em
textTransform: uppercase
```

### Text inputs
```
border: 1px solid #e4e4e8
background: #f8f8fa
color: DESIGN_TEXT
padding: 10px 14px
fontSize: 13px
fontFamily: Inter, Arial, sans-serif
outline: none
```
Focus state: `border-color: [MODULE_FULL]`

### Module labels / section group headings
```
fontSize: 9px
fontWeight: 500
letterSpacing: .22em
textTransform: uppercase
color: DESIGN_MUTED (#9a9aa0)
marginBottom: 14px
```

### Citation / tag chips
```
background: DESIGN_GROUND
padding: 6px 10px
fontSize: 8px
fontWeight: 500
color: [MODULE_FULL]
letterSpacing: .04em
```

### Spinner
Update `Spinner` and `ProgressBar` default colour from `AD_GREEN` to `DESIGN_GOLD`.

---

## Landing page (LandingPage.jsx) — full rewrite

### Structure
```
Outer wrapper: background DESIGN_GROUND, padding 40px, overflowY auto

Two groups:
  - "Document Intelligence" — Vault, Data Sheet Compare, Product Library
  - "Practice Management"  — Projects, Timesheets, [Coming Soon placeholder]

Each group:
  - Group label (9px, 500, .22em, uppercase, DESIGN_MUTED)
  - Row of tiles with gap: 20px
  - Groups separated by 32px gap
```

### Tile
```
Outer: flex:1, background #fff, overflow hidden, cursor pointer
  box-shadow: 0 1px 4px rgba(0,0,0,0.06)
  transition: box-shadow 0.22s, transform 0.22s
  :hover → box-shadow: 0 6px 20px rgba(0,0,0,0.12), transform: translateY(-2px)

Header band: padding 20px 18px 16px
  Rest state background: [MODULE_WASH]
  Hover state background: [MODULE_FULL]
  transition: background 0.22s

  Title: fontSize 14px, fontWeight 500, color #fff, letterSpacing .04em
  Category: fontSize 8px, fontWeight 500, color rgba(255,255,255,0.55), letterSpacing .14em, uppercase

Body: padding 18px
  Description: fontSize 9px, color DESIGN_MUTED, lineHeight 1.8
  CTA: fontSize 8px, fontWeight 500, letterSpacing .16em, uppercase
    Rest colour: [MODULE_WASH]
    Hover colour: [MODULE_FULL]
    transition: color 0.22s
```

Hover is triggered on the **whole tile**, not just the header. In React this means:
- Use a `useState(hover)` on each tile
- `onMouseEnter` / `onMouseLeave` on the outer div
- Pass `hover` down to header and CTA to switch between wash/full colour

### Tile data

| id | label | group | MODULE_WASH | MODULE_FULL | CTA |
|---|---|---|---|---|---|
| vault | Vault | Document Intelligence | VAULT_WASH | VAULT_FULL | Open Vault → |
| compare | Data Sheet Compare | Document Intelligence | COMPARE_WASH | COMPARE_FULL | Open Compare → |
| library | Product Library | Document Intelligence | LIBRARY_WASH | LIBRARY_FULL | Open Library → |
| projects | Projects | Practice Management | PROJECTS_WASH | PROJECTS_FULL | Open Projects → |
| timesheets | Timesheets | Practice Management | TIMESHEETS_WASH | TIMESHEETS_FULL | Open Timesheets → |

Coming soon placeholder:
```
flex: 1, background DESIGN_GROUND
border: 1px dashed #c8c8cc
display: flex, alignItems: center, justifyContent: center
minHeight: 180px
Label: "Coming soon" — fontSize 8px, fontWeight 500, color #c0c0c6, letterSpacing .18em, uppercase
```

---

## Login screen (App.js ~line 1179)

```
Outer: background DESIGN_SHELL, padding 20px 40px
  "ARCHIMIND" heading: color #fff, fontWeight 500, letterSpacing .22em, uppercase

Form panel: background #fff, padding 40px
Input labels: DESIGN_MUTED, 500, .16em, uppercase, 9px
Inputs: border 1px solid #e4e4e8, background #f8f8fa
Error border: COMPARE_FULL (#9e4a3a) — terracotta reads as "error"
Submit button: background DESIGN_SHELL, color #fff — login has no module context
```

---

## Vault section (App.js ~line 1272+)

The Vault UI lives directly in App.js (not a separate component). Replace all `AD_GREEN` and `ARC_NAVY` colour references in the Vault rendering block with:

- Section header strip: `VAULT_FULL`
- Card left borders: `VAULT_FULL`
- Primary buttons (Ask / Search): `background: VAULT_FULL`
- Active/selected states: `VAULT_FULL`
- Text that used `ARC_NAVY` for emphasis → `DESIGN_TEXT`
- Body/app background: `DESIGN_GROUND`
- Vault sidebar (vault list) background: `#fff` with `border-right: 1px solid #e8e8ea`

---

## Per-section implementation notes

### CompareSection.jsx
- Replace `AD_GREEN` → `COMPARE_FULL` for buttons, borders, accents
- Replace `ARC_NAVY` → `DESIGN_TEXT` for text, `DESIGN_SHELL` for dark backgrounds
- Replace `ARC_TERRACOTTA` → `COMPARE_FULL` (terracotta is the Compare colour)
- Add section header strip: `background: COMPARE_FULL`
- Drop zone background: `DESIGN_GROUND`; drop zone border active: `COMPARE_FULL`

### DatasheetsLibrarySection.jsx
- Replace `LIBRARY_BLUE` → `LIBRARY_FULL`
- Replace `LIBRARY_BLUE_LIGHT` → `DESIGN_GROUND`
- Replace `ARC_NAVY` → `DESIGN_TEXT`
- Add section header strip: `background: LIBRARY_FULL`

### ProjectsSection.jsx
- Replace `AD_GREEN` → `PROJECTS_FULL`
- Replace `ARC_NAVY` → `DESIGN_TEXT` or `DESIGN_SHELL`
- Replace `ARC_STONE` → `DESIGN_GROUND`
- Add section header strip: `background: PROJECTS_FULL`
- `STAGE_COLORS` map: keep as-is (these are semantic RIBA stage colours, not branding)

### TimesheetsSection.jsx + TimesheetHistory.jsx + TimesheetReport.jsx + FeeReview.jsx
- Replace `AD_GREEN` → `TIMESHEETS_FULL`
- Replace `ARC_NAVY` → `DESIGN_TEXT`
- Replace `ARC_STONE` → `DESIGN_GROUND`
- Add section header strip to `TimesheetsSection`: `background: TIMESHEETS_FULL`

### AdminSection.jsx
- Replace `ARC_NAVY` → `DESIGN_SHELL`
- Add minimal section header strip: `background: DESIGN_SHELL` (Admin has no module colour)

### AnswerRenderer.jsx
- Replace colour references: `ARC_NAVY` → `DESIGN_TEXT`, `AD_GREEN` → `VAULT_FULL`
- Note: AnswerRenderer is used in both Vault and Compare. It receives no colour prop currently. Consider adding an optional `accentColor` prop defaulting to `VAULT_FULL`.

### Spinner.jsx
- Default spinner/progress bar colour: change from `AD_GREEN` to `DESIGN_GOLD`
- Accept a `color` prop (already may have one — check). If not, add it.

### VaultManagementModal.jsx
- Replace `ARC_NAVY` → `DESIGN_SHELL` for header
- Replace `AD_GREEN` → `VAULT_FULL` for accents

---

## What does NOT change

- All logic, state management, API calls, prompts
- `answerPrompt` string in App.js
- `STAGE_COLORS` in ProjectsSection (semantic, not branding)
- `BOILERPLATE_HEADINGS`, `isBoilerplate`
- Server code
- ArchiSync
