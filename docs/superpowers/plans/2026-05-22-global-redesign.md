# Implementation Plan — Global Redesign
**Spec:** `docs/superpowers/specs/2026-05-22-global-redesign.md`
**Date:** 2026-05-22

---

## Execution order

Task 1 must complete before all others — every subsequent task imports the new constants.
Tasks 2–8 are independent of each other and can run in any order after Task 1.

---

## Task 1 — Design tokens (constants.js)

**File:** `client/src/constants.js`

Add the following exports at the top of the UI colour palette block, before the existing constants:

```js
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
```

Do NOT remove existing constants — other components still import them and will be updated in later tasks. Do NOT change `BOILERPLATE_HEADINGS`, `isBoilerplate`, or any non-colour exports.

**Verification:** `client/src/constants.js` exports all 15 new constants and all existing ones are still present.

---

## Task 2 — Landing page (LandingPage.jsx)

**File:** `client/src/components/LandingPage.jsx`

Complete rewrite. The new component must:

1. Import from constants: `DESIGN_GROUND`, `DESIGN_MUTED`, `VAULT_FULL`, `VAULT_WASH`, `COMPARE_FULL`, `COMPARE_WASH`, `LIBRARY_FULL`, `LIBRARY_WASH`, `PROJECTS_FULL`, `PROJECTS_WASH`, `TIMESHEETS_FULL`, `TIMESHEETS_WASH`

2. Define a `Tile` component with `useState(hover)` for the hover effect:
   - Outer div: `onMouseEnter={() => setHover(true)}`, `onMouseLeave={() => setHover(false)}`
   - Header band background: hover ? fullColor : washColor (transition: "background 0.22s ease")
   - Tile box-shadow: hover ? "0 6px 20px rgba(0,0,0,0.12)" : "0 1px 4px rgba(0,0,0,0.06)"
   - Tile transform: hover ? "translateY(-2px)" : "none" (transition: "all 0.22s ease")
   - CTA text colour: hover ? fullColor : washColor (transition: "color 0.22s ease")

3. Tile data arrays:
   ```js
   const DOCUMENT_TILES = [
     { id:"vault",   label:"Vault",              category:"Document Intelligence", washColor:VAULT_WASH,      fullColor:VAULT_FULL,      cta:"Open Vault →",    description:"Query your building regulations documents with natural language. Get precise answers with clause references." },
     { id:"compare", label:"Data Sheet Compare", category:"Document Intelligence", washColor:COMPARE_WASH,    fullColor:COMPARE_FULL,    cta:"Open Compare →",  description:"Upload two product datasheets and compare them against your specification requirements for compliance." },
     { id:"library", label:"Product Library",    category:"Document Intelligence", washColor:LIBRARY_WASH,    fullColor:LIBRARY_FULL,    cta:"Open Library →",  description:"Build a searchable library of product datasheets. Query across all your uploaded products at once." },
   ];
   const PRACTICE_TILES = [
     { id:"projects",   label:"Projects",   category:"Practice Management", washColor:PROJECTS_WASH,   fullColor:PROJECTS_FULL,   cta:"Open Projects →",   description:"Manage projects, tasks, drawing reviews, and client email correspondence in one place." },
     { id:"timesheets", label:"Timesheets", category:"Practice Management", washColor:TIMESHEETS_WASH, fullColor:TIMESHEETS_FULL, cta:"Open Timesheets →", description:"Log time against projects, track fees, and monitor budget against programme across the practice." },
   ];
   ```

4. Layout:
   ```
   Outer: flex:1, display:flex, flexDirection:column, alignItems:center,
          background:DESIGN_GROUND, padding:"40px 40px", gap:32, overflowY:auto

   Each group:
     width:"100%", maxWidth:1200
     Group label: fontSize:9, fontWeight:500, letterSpacing:".22em", textTransform:"uppercase",
                  color:DESIGN_MUTED, marginBottom:14, fontFamily:"Inter, Arial, sans-serif"
     Tile row: display:flex, gap:20

   Coming soon placeholder (in Practice row):
     flex:1, background:DESIGN_GROUND, border:"1px dashed #c8c8cc",
     display:flex, alignItems:center, justifyContent:center, minHeight:180
     Label: "Coming soon" — fontSize:8, fontWeight:500, color:"#c0c0c6",
            letterSpacing:".18em", textTransform:uppercase
   ```

5. Tile header internal layout:
   ```
   padding: "20px 18px 16px"
   Title: fontSize:14, fontWeight:500, color:#fff, letterSpacing:".04em", marginBottom:4
   Category: fontSize:8, fontWeight:500, color:"rgba(255,255,255,0.55)", letterSpacing:".14em", textTransform:uppercase
   ```

6. Tile body:
   ```
   padding: 18px, display:flex, flexDirection:column, flex:1
   Description: fontSize:9, color:DESIGN_MUTED, lineHeight:1.8, marginBottom:14
   CTA: marginTop:auto, fontSize:8, fontWeight:500, letterSpacing:".16em", textTransform:uppercase
   ```

7. Props: `LandingPage({ onSelect })` — call `onSelect(tile.id)` on tile click.

**Verification:** All 5 tiles render. Hover changes tile header colour and lifts card. Clicking a tile calls `onSelect`. Coming soon placeholder visible.

---

## Task 3 — Nav bar, login screen, Vault section (App.js)

**File:** `client/src/App.js`

This is the most complex task. Do NOT touch `answerPrompt` or any pipeline logic.

### 3a — Imports
Add to the import from `./constants`:
`DESIGN_SHELL`, `DESIGN_GROUND`, `DESIGN_GOLD`, `DESIGN_TEXT`, `DESIGN_MUTED`, `VAULT_FULL`

### 3b — Nav bar (~line 1239)
Replace the existing nav `<div>` with:
```
background: DESIGN_SHELL
height: 56px (keep as-is)
padding: "0 40px"
border-bottom: "1px solid #1e2028"

Logo button: "ARCHIMIND"
  color: #fff, fontSize:14, fontWeight:500, letterSpacing:".22em", textTransform:uppercase

Divider: width:1, height:20, background:"#3a3c40", display:inline-block

Nav section buttons (inactive): color:#9a9aa0, fontSize:9, fontWeight:500, letterSpacing:".18em", textTransform:uppercase, background:transparent, border:none
Nav section button (active = current section): color:#fff, borderBottom:"1px solid "+DESIGN_GOLD, paddingBottom:3

User area (right): display flex, alignItems center, gap 10
  - user email/name: fontSize:9, color:#666, letterSpacing:".1em", uppercase (show first name if available, or email)
  - Avatar circle: 28×28, borderRadius:50%, background:DESIGN_GOLD, color:DESIGN_SHELL, fontSize:9, fontWeight:500
    (use first 2 chars of email/name uppercased as initials)
  - Logout button: fontSize:8, color:#666, letterSpacing:".1em", uppercase, background:transparent, border:none
```

Active section detection: the current `appSection` state determines which nav item is active.

### 3c — Login screen (~line 1179)
```
Outer wrapper background: DESIGN_SHELL
"ARCHIMIND" heading: color:#fff, fontWeight:500, letterSpacing:".22em", uppercase

Form inputs: border:"1px solid #e4e4e8", background:"#f8f8fa", color:DESIGN_TEXT
Input labels: color:DESIGN_MUTED, fontSize:9, fontWeight:500, letterSpacing:".16em", uppercase
Error border: COMPARE_FULL (not ARC_TERRACOTTA)
Submit button: background:DESIGN_SHELL, color:#fff
```

### 3d — App background
Wherever the app outer wrapper has `background: ARC_STONE` or `background: "#e8e0d5"`, replace with `background: DESIGN_GROUND`.

### 3e — Vault section header strip
Add a section header strip div immediately when `appSection === "vault"` renders, before the vault content area:
```jsx
<div style={{ background: VAULT_FULL, padding: "12px 40px", display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
  <span style={{ fontSize:11, fontWeight:500, color:"#fff", letterSpacing:".16em", textTransform:"uppercase" }}>Vault</span>
  <span style={{ fontSize:9, fontWeight:500, color:"rgba(255,255,255,0.45)", letterSpacing:".14em", textTransform:"uppercase" }}>— Document Intelligence</span>
</div>
```

### 3f — Vault content colours
Within the Vault rendering block, replace:
- `AD_GREEN` → `VAULT_FULL` (buttons, borders, accents, progress bar colour)
- `ARC_NAVY` → `DESIGN_TEXT` for text; `DESIGN_SHELL` for any dark backgrounds
- `ARC_STONE` → `DESIGN_GROUND` for backgrounds
- `AD_GREEN_MID` → remove/replace with `DESIGN_GROUND` or `#e8eaea`
- Input borders `#ddd8d0` or `#ccc` → `#e4e4e8`
- Input backgrounds `#faf8f5` → `#f8f8fa`

### 3g — Vault sidebar
Vault list sidebar:
```
background: #fff
border-right: 1px solid #e8e8ea
```
Selected vault item: `background: DESIGN_GROUND`, left border `3px solid VAULT_FULL`

**Verification:** Nav renders with dark shell, gold underline on active item. Login screen uses dark shell header. Vault section has teal header strip. All vault buttons/borders are teal. App background is cool grey.

---

## Task 4 — CompareSection.jsx

**File:** `client/src/components/CompareSection.jsx`

### Imports
Remove: `AD_GREEN`, `AD_GREEN_MID`, `ARC_NAVY`, `ARC_TERRACOTTA`
Add: `DESIGN_GROUND`, `DESIGN_TEXT`, `DESIGN_MUTED`, `COMPARE_FULL`

### Section header strip
Wrap the component return in a fragment. Add as the **first element**:
```jsx
<div style={{ background: COMPARE_FULL, padding:"12px 40px", display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
  <span style={{ fontSize:11, fontWeight:500, color:"#fff", letterSpacing:".16em", textTransform:"uppercase" }}>Data Sheet Compare</span>
  <span style={{ fontSize:9, fontWeight:500, color:"rgba(255,255,255,0.45)", letterSpacing:".14em", textTransform:"uppercase" }}>— Document Intelligence</span>
</div>
```

### Colour replacements
- `AD_GREEN` → `COMPARE_FULL`
- `AD_GREEN_MID` → `DESIGN_GROUND` or `"#e8eaea"`
- `ARC_TERRACOTTA` → `COMPARE_FULL`
- `ARC_NAVY` → `DESIGN_TEXT` (for text) or `DESIGN_SHELL` (for dark backgrounds)
- Input borders `#ddd` / `#ccc` → `"#e4e4e8"`
- Backgrounds `#f8f8f8` / `#fafafa` → `"#f8f8fa"`
- Drop zone background → `DESIGN_GROUND`

**Verification:** Compare section has terracotta header strip. Upload boxes, buttons, and borders use terracotta. No old constants remain in this file.

---

## Task 5 — DatasheetsLibrarySection.jsx

**File:** `client/src/components/DatasheetsLibrarySection.jsx`

### Imports
Remove: `ARC_NAVY`, `ARC_TERRACOTTA`, `LIBRARY_BLUE`, `LIBRARY_BLUE_LIGHT`, `AD_GREEN_FOREST`
Add: `DESIGN_GROUND`, `DESIGN_TEXT`, `DESIGN_MUTED`, `LIBRARY_FULL`

### Section header strip
Add as first element:
```jsx
<div style={{ background: LIBRARY_FULL, padding:"12px 40px", display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
  <span style={{ fontSize:11, fontWeight:500, color:"#fff", letterSpacing:".16em", textTransform:"uppercase" }}>Product Library</span>
  <span style={{ fontSize:9, fontWeight:500, color:"rgba(255,255,255,0.45)", letterSpacing:".14em", textTransform:"uppercase" }}>— Document Intelligence</span>
</div>
```

### Colour replacements
- `LIBRARY_BLUE` → `LIBRARY_FULL`
- `LIBRARY_BLUE_LIGHT` → `DESIGN_GROUND`
- `AD_GREEN_FOREST` → `LIBRARY_FULL`
- `ARC_NAVY` → `DESIGN_TEXT`
- `ARC_TERRACOTTA` → `COMPARE_FULL` (if used for errors only; import `COMPARE_FULL` if needed)

**Verification:** Library section has steel blue header strip. All product tiles, buttons, borders use steel blue.

---

## Task 6 — ProjectsSection.jsx (+ TaskBoard.jsx + DrawingReview.jsx)

**Files:** `client/src/components/ProjectsSection.jsx`, `TaskBoard.jsx`, `DrawingReview.jsx`

### Imports (ProjectsSection.jsx)
Remove: `ARC_NAVY`, `ARC_TERRACOTTA`, `ARC_STONE`, `AD_GREEN`
Add: `DESIGN_GROUND`, `DESIGN_TEXT`, `DESIGN_MUTED`, `DESIGN_SHELL`, `PROJECTS_FULL`

**Important:** `STAGE_COLORS` uses hardcoded hex values for RIBA stages — do NOT change these. They are semantic, not brand colours.

### Section header strip (ProjectsSection.jsx)
Add as first element:
```jsx
<div style={{ background: PROJECTS_FULL, padding:"12px 40px", display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
  <span style={{ fontSize:11, fontWeight:500, color:"#fff", letterSpacing:".16em", textTransform:"uppercase" }}>Projects</span>
  <span style={{ fontSize:9, fontWeight:500, color:"rgba(255,255,255,0.45)", letterSpacing:".14em", textTransform:"uppercase" }}>— Practice Management</span>
</div>
```

### Colour replacements (all three files)
- `AD_GREEN` → `PROJECTS_FULL`
- `ARC_NAVY` → `DESIGN_TEXT` (text) or `DESIGN_SHELL` (dark backgrounds)
- `ARC_TERRACOTTA` → `COMPARE_FULL` (used for error/warning states — import if needed)
- `ARC_STONE` → `DESIGN_GROUND`
- Input borders → `"#e4e4e8"`
- Backgrounds `#f8f8f8` / `#fafafa` → `"#f8f8fa"`

**Verification:** Projects section has forest green header strip. Task board, drawing review use forest green accents.

---

## Task 7 — TimesheetsSection.jsx + TimesheetHistory.jsx + TimesheetReport.jsx + FeeReview.jsx

**Files:** All four timesheet files.

### Imports (TimesheetsSection.jsx)
Remove: `ARC_NAVY`, `ARC_TERRACOTTA`, `ARC_STONE`, `AD_GREEN`
Add: `DESIGN_GROUND`, `DESIGN_TEXT`, `DESIGN_MUTED`, `TIMESHEETS_FULL`

### Section header strip (TimesheetsSection.jsx only)
Add as first element:
```jsx
<div style={{ background: TIMESHEETS_FULL, padding:"12px 40px", display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
  <span style={{ fontSize:11, fontWeight:500, color:"#fff", letterSpacing:".16em", textTransform:"uppercase" }}>Timesheets</span>
  <span style={{ fontSize:9, fontWeight:500, color:"rgba(255,255,255,0.45)", letterSpacing:".14em", textTransform:"uppercase" }}>— Practice Management</span>
</div>
```

### Colour replacements (all four files)
- `AD_GREEN` → `TIMESHEETS_FULL`
- `ARC_NAVY` → `DESIGN_TEXT`
- `ARC_TERRACOTTA` → `COMPARE_FULL` (if used for errors/warnings)
- `ARC_STONE` → `DESIGN_GROUND`
- Input borders → `"#e4e4e8"`

**Verification:** Timesheets section has slate header strip. Time entry form, history, and report views use slate accents.

---

## Task 8 — Shared components

### Spinner.jsx + ProgressBar
- Find any hardcoded `AD_GREEN` or `ARC_NAVY` colour in default prop values
- Replace with `DESIGN_GOLD` as the default colour
- Ensure `color` prop is accepted and forwarded (individual sections can still override)

### AnswerRenderer.jsx
- Replace `ARC_NAVY` → `DESIGN_TEXT`
- Replace `AD_GREEN` → `VAULT_FULL` in default styling
- Consider adding an optional `accentColor` prop (default: `VAULT_FULL`) — if adding the prop, update callers in CompareSection to pass `COMPARE_FULL`

### VaultManagementModal.jsx
- Replace `ARC_NAVY` → `DESIGN_SHELL` for header/dark areas
- Replace `AD_GREEN` → `VAULT_FULL` for buttons and accents
- Background: `DESIGN_GROUND`

### AdminSection.jsx
- Replace `ARC_NAVY` → `DESIGN_SHELL`
- No module header strip needed — add a minimal one: `background: DESIGN_SHELL`
- Replace any accent colours with `DESIGN_GOLD`

**Verification:** Spinner defaults to gold. AnswerRenderer looks correct in both Vault and Compare contexts.

---

## Commit strategy

One commit per task, clearly labelled:
- `Task 1: Add design system colour constants`
- `Task 2: Redesign LandingPage — washed/hover tiles`
- `Task 3: Redesign nav bar, login screen, Vault section`
- `Task 4: Apply Compare module theme`
- `Task 5: Apply Library module theme`
- `Task 6: Apply Projects module theme`
- `Task 7: Apply Timesheets module theme`
- `Task 8: Update shared components to new design system`
