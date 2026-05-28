# Role-Based UI — Staff Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show only Vault and Timesheets to regular staff; admin users (Nathan) continue to see the full interface.

**Architecture:** `isAdmin` is already computed in `App.js` from Supabase user metadata (`role === "admin"`). The change filters the nav array by role, passes `isAdmin` into `LandingPage`, and switches LandingPage to a two-tile layout for staff. Section render guards are added as a defensive backstop.

**Tech Stack:** React (CRA), inline styles, existing `isAdmin` boolean in App.js.

---

## Files

| File | Change |
|------|--------|
| `client/src/App.js` | Filter nav array; pass `isAdmin` to LandingPage; guard restricted section renders |
| `client/src/components/LandingPage.jsx` | Accept `isAdmin` prop; staff view = two-tile centred row |

---

### Task 1: Filter nav bar and guard section renders (`App.js`)

**Files:**
- Modify: `client/src/App.js`

- [ ] **Step 1: Add `NAV_SECTIONS` constant just below the existing `NAV_LABELS` constant (around line 1225)**

  Find:
  ```js
  const NAV_LABELS = {
    vault: "Vault",
    compare: "Data Sheet Compare",
    library: "Product Library",
    projects: "Projects",
    timesheets: "Timesheets",
  };
  ```

  Replace with:
  ```js
  const NAV_LABELS = {
    vault: "Vault",
    compare: "Data Sheet Compare",
    library: "Product Library",
    projects: "Projects",
    timesheets: "Timesheets",
  };

  const NAV_SECTIONS = isAdmin
    ? ["vault", "compare", "library", "projects", "timesheets"]
    : ["vault", "timesheets"];
  ```

- [ ] **Step 2: Use `NAV_SECTIONS` in the nav `.map()`**

  Find:
  ```jsx
  {["vault", "compare", "library", "projects", "timesheets"].map(section => (
  ```

  Replace with:
  ```jsx
  {NAV_SECTIONS.map(section => (
  ```

- [ ] **Step 3: Pass `isAdmin` into `LandingPage`**

  Find:
  ```jsx
  {appSection === "home" && <LandingPage onSelect={navigate} />}
  ```

  Replace with:
  ```jsx
  {appSection === "home" && <LandingPage onSelect={navigate} isAdmin={isAdmin} />}
  ```

- [ ] **Step 4: Add `isAdmin` guards to restricted section renders**

  Find:
  ```jsx
  {appSection === "compare" && <CompareSection key={sectionKey} vaults={vaults} isAdmin={isAdmin} />}
  {appSection === "library" && <DatasheetsLibrarySection key={sectionKey} vaults={vaults} isAdmin={isAdmin} />}
  {appSection === "projects" && <ProjectsSection key={sectionKey} isAdmin={isAdmin} />}
  {appSection === "timesheets" && <TimesheetsSection key={sectionKey} isAdmin={isAdmin} />}
  {appSection === "schedule" && <ScheduleSection key={sectionKey} />}
  ```

  Replace with:
  ```jsx
  {appSection === "compare"  && isAdmin && <CompareSection key={sectionKey} vaults={vaults} isAdmin={isAdmin} />}
  {appSection === "library"  && isAdmin && <DatasheetsLibrarySection key={sectionKey} vaults={vaults} isAdmin={isAdmin} />}
  {appSection === "projects" && isAdmin && <ProjectsSection key={sectionKey} isAdmin={isAdmin} />}
  {appSection === "timesheets" && <TimesheetsSection key={sectionKey} isAdmin={isAdmin} />}
  {appSection === "schedule" && isAdmin && <ScheduleSection key={sectionKey} />}
  ```

  Note: Timesheets has no `isAdmin` guard — staff can access it.

- [ ] **Step 5: Verify the build compiles**

  ```bash
  cd client && npm run build
  ```
  Expected: `Compiled successfully.` — no errors, no warnings about missing props.

- [ ] **Step 6: Commit**

  ```bash
  git add client/src/App.js
  git commit -m "feat: filter nav and section renders by role"
  ```

---

### Task 2: Role-conditional landing page (`LandingPage.jsx`)

**Files:**
- Modify: `client/src/components/LandingPage.jsx`

- [ ] **Step 1: Accept `isAdmin` prop in the component signature**

  Find:
  ```jsx
  export default function LandingPage({ onSelect }) {
  ```

  Replace with:
  ```jsx
  export default function LandingPage({ onSelect, isAdmin = false }) {
  ```

- [ ] **Step 2: Add the staff two-tile layout inside the component's return**

  Find:
  ```jsx
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
  ```

  Replace with:
  ```jsx
  if (!isAdmin) {
    const STAFF_TILES = [
      { id: "vault",       label: "Vault",      category: "Document Intelligence", washColor: VAULT_WASH,      fullColor: VAULT_FULL,      cta: "Open Vault →",        description: "Query your building regulations documents with natural language. Get precise answers with clause references." },
      { id: "timesheets",  label: "Timesheets", category: "Practice Management",  washColor: TIMESHEETS_WASH, fullColor: TIMESHEETS_FULL, cta: "Open Timesheets →",   description: "Log time against projects, track fees, and monitor budget against programme across the practice." },
    ];
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: DESIGN_GROUND,
          padding: "40px",
          fontFamily: "Inter, Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", gap: 20, width: "100%", maxWidth: 760 }}>
          {STAFF_TILES.map(t => <Tile key={t.id} {...t} onSelect={onSelect} />)}
        </div>
      </div>
    );
  }

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
  ```

- [ ] **Step 3: Verify the build compiles**

  ```bash
  cd client && npm run build
  ```
  Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

  ```bash
  git add client/src/components/LandingPage.jsx
  git commit -m "feat: staff landing page shows vault and timesheets only"
  ```

---

## Deploy

Client only (Vercel). Server is unchanged.

After deploying, verify:
- Sign in as a **staff user** (non-admin): nav shows only `Vault` and `Timesheets`; home screen shows two tiles centred; navigating directly to a hidden section shows blank content
- Sign in as **Nathan (admin)**: full interface unchanged — six tiles, all nav items, Admin button visible
