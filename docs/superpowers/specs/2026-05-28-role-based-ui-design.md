# Role-Based UI — Staff Rollout
**Date:** 2026-05-28

## Goal
Roll out Vaultmind to the wider office with a controlled, limited interface. Staff see only Vault and Timesheets. Nathan (admin) continues to see the full interface unchanged.

---

## Current State
- `isAdmin` is already computed in `App.js` from Supabase user metadata (`role === "admin"`).
- The Admin panel is already gated on `isAdmin`.
- All other sections (Vault, Compare, Library, Projects, Timesheets, Schedule) are currently visible to every authenticated user.

---

## Role Definitions
| Role | Visible modules |
|------|----------------|
| `admin` | All: Vault, Compare, Library, Projects, Timesheets, Schedule, Admin |
| `user` (everyone else) | Vault, Timesheets only |

Role is set in Supabase user metadata (`user_metadata.role`). No database changes required.

---

## Changes

### 1. `client/src/App.js`

**Nav bar filtering**
Replace the hard-coded nav array with a role-filtered version:
```js
const NAV_SECTIONS = isAdmin
  ? ["vault", "compare", "library", "projects", "timesheets"]
  : ["vault", "timesheets"];
```
Use `NAV_SECTIONS` in the `.map()` that renders nav buttons.

**LandingPage prop**
Pass `isAdmin` to LandingPage:
```jsx
<LandingPage onSelect={navigate} isAdmin={isAdmin} />
```

**Section render guards**
Add `isAdmin &&` to the compare, library, projects, and schedule section renders. These sections cannot be reached via UI once nav and tiles are filtered, but this prevents any edge-case direct access:
```jsx
{appSection === "compare"   && isAdmin && <CompareSection ... />}
{appSection === "library"   && isAdmin && <DatasheetsLibrarySection ... />}
{appSection === "projects"  && isAdmin && <ProjectsSection ... />}
{appSection === "schedule"  && isAdmin && <ScheduleSection ... />}
```
(Timesheets and Vault render for all authenticated users — no guard needed.)

---

### 2. `client/src/components/LandingPage.jsx`

**Accept `isAdmin` prop.**

**Admin view:** Existing two-group layout unchanged (Document Intelligence + Practice Management, six tiles).

**Staff view:** Single centred row with just Vault and Timesheets tiles side-by-side. No group headers — two tiles don't need category labels. Both tiles use `flex: 1`.

Implementation: conditional render at the top level of the component — if `!isAdmin`, render the two-tile row; otherwise render the existing group structure.

---

## What Does Not Change
- Server endpoints — all protected by `requireAuth`; role filtering is UI-only.
- Admin panel gating — already uses `isAdmin`, no change.
- The `isAdmin` computation itself — already correct.
- Any section component internals.

---

## Deployment
- **Client (Vercel)** — the only deploy needed.
- Server unchanged.
