# Timesheets Analytics & Export — Design

> Status: drafted 2026-06-13, awaiting Nathan's review. Then implementation plan.

## Purpose

Let HR and admins filter the timesheet data to exactly the view they want, and export that filtered view as a consistent-format report (PDF primary, CSV secondary). Add richer filtering and a "group by" cut to the existing **Reports & Analytics** screen, and give the admin-only **Fee Review** screen the same filtering so fee/spend can be sliced the same way. Filtering and export are kept on two separate screens (Plan A), preserving the existing role wall — HR never sees fee data.

Informed by competitor research (Harvest, BQE Core, Monograph): the recurring pattern is *one dataset re-grouped many ways*, a common filter set (date / project / person / category / billable), and detailed views that export to PDF + CSV.

## Key decisions

- **Two screens, not merged.** `TimesheetReport` (hours, HR + admin) and `FeeReview` (money, admin only) each gain filters + export independently. No risk of leaking fee data to HR — HR cannot load fee data server-side at all.
- **Export = "print what this screen is filtered to".** The content varies with the filters; the page layout (header/footer template) stays constant.
- **PDF via the browser's print-to-PDF**, not a JS library. A print-only stylesheet (`@media print`) restyles the on-screen report for paper; the user picks "Save as PDF" in the browser print dialog. No new dependencies, charts/text stay crisp and selectable, cannot break the running app.
- **CSV is a direct download** of the underlying rows, generated client-side (no library) — for opening in Excel.
- **Role wall unchanged.** Fee filters/columns/export live only inside `FeeReview`, which is already admin-gated client- and server-side.

## Screen 1 — Reports & Analytics (`client/src/components/TimesheetReport.jsx`)

Audience: HR + admin. Hours only, no money.

### Filters (extends the existing person / project / date-range bar)
- **Date range with quick presets:** This week / This month / This quarter / This year / Custom. Selecting a preset sets the from/to dates.
- **Default range fix:** the "to" date defaults to the **end of the current week** (Sunday), not today. (Current bug: default `filterTo = isoDate(new Date())` hides the current week and any time logged ahead — see the overtime false alarm, 2026-06-13.)
- **Person** and **Project** filters: keep as-is (single-select "All …" dropdowns).
- **Category / entry-type** filter: All / a specific category (Holiday, Sickness, Bank Holiday, Training, Internal) / project work only.
- **Billable vs non-billable toggle:** All / Billable (project entries) / Non-billable (category entries). "Billable" = `project_id` set; "non-billable" = category entries.

### Group by
A single **Group by** selector: **Week / Project / Person / Category**. The primary bar chart and the main breakdown table re-pivot to the chosen grouping. Other charts (split pie, etc.) follow the same grouping where sensible. This replaces the need for separate report types.

### New summary card
- **Utilisation %** = billable hours ÷ total hours, over the filtered set. Derived from existing data (project vs category), no new storage.

### Export
- **Export PDF** button → triggers `window.print()`; a print stylesheet renders a clean report (template header: practice name, "Timesheet Report", filter-summary line, date generated; the cards, charts and grouped table; footer with page info). Filters/buttons/nav are hidden in print.
- **Download CSV** button → client-side CSV of the underlying entry rows (date, person, project/category, hours, overtime, notes) for the current filters. Plain string build + Blob download, no library.

## Screen 2 — Fee Review (`client/src/components/FeeReview.jsx`)

Audience: admin only. Adds filtering + export to the existing fee screen; keeps all current behaviour (project fee cards, burn-down chart, % consumed, remaining, per-person cost, overrun flag, drill-down, fee/rate setup panel).

### Filters (new — currently it loads everything unfiltered)
- **Date range** (with the same presets as Screen 1) — scopes the spend/burn calculations to a period.
- **Project** filter — focus on one project (or all).
- **Person** filter — focus one person's cost contribution (or all).

Filters apply to the entries used in the spend/burn/cost aggregations. The fee total itself is the project's full agreed fee (unchanged); spend reflects the filtered entries, with the filter summary shown so a partial-period view is not mistaken for total spend.

### Export
- **Export PDF** button → `window.print()` with the same shared template (practice name, "Fee Review", filter-summary line, date generated). On the project drill-down, the printed report is that project's fee detail (cards, burn chart, staff cost table).
- **Download CSV** button → rows behind the current fee view (project, person, hours, rate, cost), for Excel.

## Shared pieces

- **Print stylesheet / template:** one shared approach so both screens print with the same header/footer and the same "hide the chrome" rules. Implemented as print CSS plus a small reusable report-header element (practice name, title, filter summary, generated date).
- **Filter-summary line:** a human-readable one-liner ("All staff · Woolwich Central · 1 Apr – 30 Jun 2026") shown on screen and carried into both the PDF and CSV header so an exported file is self-describing.
- **CSV helper:** a tiny shared `toCsv(rows)` + download utility (no dependency).
- **Date presets helper:** shared function returning {from, to} for week/month/quarter/year and end-of-current-week default.

## Out of scope (deferred)

- Auto-derived overtime (overtime stays manually entered per the 2026-06-12 overtime spec).
- Budget/assigned-hours variance and forecasting (Monograph-style) — fee burn-down already gives the headline picture.
- Emailed/scheduled reports (BQE-style automation).
- Multi-select people/projects — single-select "All …" is enough for now.
- Custom column picker on export — fixed CSV columns for now.

## Testing notes

- Filters combine correctly (e.g. person + project + date preset) and the cards/charts/table all reflect the same filtered set.
- Default date range includes the current week (the bug that started this work).
- Group-by re-pivots chart + table without losing totals; grand total constant across groupings.
- Utilisation % = billable ÷ total; sane when there are zero non-billable hours.
- Billable/non-billable toggle matches project vs category entries.
- PDF (browser print) shows the template header + filtered content, hides nav/buttons/filters, and breaks across pages without clipping charts/rows.
- CSV opens in Excel with correct columns and the filter-summary header; values match the on-screen totals.
- **Role wall:** HR cannot reach Fee Review or its export; the fee CSV/PDF are only reachable from the admin-only screen. No fee data path is added to `TimesheetReport`.

## Deployment

**Client only → push to Vercel.** No database changes, no server changes (existing `GET /api/admin/timesheets`, `/api/projects`, `/api/admin/users`, `/api/admin/staff-rates` already return everything needed). Verify on staging first, then merge `develop` → `main` for production.
