# Admin Tabs & Notification Routing — Implementation Plan

> No automated tests in this project — verify by build + staging visual check. Nathan commits/deploys. Server (Railway) + client (Vercel); no SQL.

**Goal:** Tab the Admin section; move notification settings into it with per-event Admin/HR routing.

**Build check:** `cd client; node .\node_modules\react-scripts\bin\react-scripts.js build` → "Compiled successfully".

---

## Task 1: Server — getHrEmails + notificationRecipients + backward-compat read

**File:** `server/index.js`

- [ ] **Step 1: Extend `getNotificationSettings()` to normalise to per-role shape.** Replace the body so each key returns `{ admin, hr }`, accepting old boolean / missing values. Defaults: 3 manager alerts → `{admin:true,hr:false}`; `expense_decided`/`timesheet_rejected` → `{admin:false,hr:false}`.
- [ ] **Step 2: Add `getHrEmails()`** mirroring `getAdminEmails()` with `role === "hr"`.
- [ ] **Step 3: Add `notificationRecipients(key)`** → builds deduped email list from settings[key].admin/hr using getAdminEmails/getHrEmails; `[]` if both off.
- [ ] **Step 4: Update the five send sites** to use `notificationRecipients(key)` and skip when empty; `expense_decided` + `timesheet_rejected` stop emailing the submitter.
- [ ] **Step 5: Build server smoke** — `node -e "require('./server/index.js')"` not run (needs env); rely on client build + staging.

## Task 2: Client — notification settings component with Admin/HR toggles

**File:** `client/src/components/AdminSection.jsx` (new local component) + remove from `TimesheetsSection.jsx`.

- [ ] **Step 1:** Add `NotificationSettings` to AdminSection: fetch `/api/admin/notification-settings`, render 5 rows each with Admin + HR toggle, PUT on change (sends full per-role object).
- [ ] **Step 2:** Remove `NotificationSettings` + its render from `TimesheetsSection.jsx`.

## Task 3: Client — tab the Admin section

**File:** `client/src/components/AdminSection.jsx`

- [ ] **Step 1:** Add `const [adminTab, setAdminTab] = useState("users")`.
- [ ] **Step 2:** Add a tab bar below the Admin banner (Users / Notifications / Quiz / Branding / ArchiSync), styled like TimesheetsSection tabs.
- [ ] **Step 3:** Wrap each existing group in `{adminTab === "x" && (...)}`; Branding = Logo + Colours together; Notifications = the new component.

## Task 4: Verify

- [ ] Build passes. Staging: tabs switch; each control still works; notifications appear in Admin not Timesheets; toggles save; (optional) trigger a timesheet submit and confirm the right role is emailed.

## Deployment
Server first (Railway), then client (Vercel). No SQL. Backward-compatible read. Verify staging → merge develop→main.
