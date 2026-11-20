# SAIPHER CG DSS — Analytics Scope and Filter Consistency Update

## Baseline and scope
Source: user-uploaded `SAIPHER_CG_Final.zip` (latest upload in this conversation). This update changes application code only. It does not execute SQL, publish data, delete data, or contact the original Supabase project. The project `.env` and `.git` history are intentionally not included in the deliverable.

## Changes
1. **Global scope is the upper bound:** A reusable `narrowScope()` utility intersects per-module category and province-key selections with the active global category/province restrictions. Predictive comparison no longer replaces the global category restriction.
2. **Descriptive multi-province totals:** The analytics API now accepts a list of full `(region, province)` keys, and the existing row filter uses these to scope all Descriptive metrics, trends, category bars, rankings, and geographic summaries to the same local selection. Global restrictions remain in force. Unique-order counts are preserved by the existing aggregation code.
3. **Descriptive filter summary:** The active summary now states when multiple provinces were applied. Applied selections are also held in `App.jsx` so Executive Overview and the Descriptive page use the same module filters.
4. **Predictive comparison:** Both category and province selections constrain the aggregate analysis population. Each selected category or province still receives its own independently calculated series using the existing forecast model. The filters remain separate from Descriptive and Prescriptive.
5. **Prescriptive Province filter:** A local Province dropdown filters displayed province–category opportunity rows and the CSV export. It does not change the scoring population, scoring weights, or forecasting methodology. Selected ranks remain global rankings. The selected Province and Category are synchronized with the Executive Overview.
6. **Returns-only guidance:** In `Returned / Refunded Only` global scope, the Prescriptive engine returns an explicit unavailable status with no ordinary sales-growth recommendations. The Executive Overview and Prescriptive page display the explanation. Descriptive returns analysis remains available.
7. **Executive Overview:** Descriptive KPIs and trend/YoY charts now use the applied Descriptive selections. The predictive overview uses the active local category/province selection and forecasts each series independently when comparison mode is active. Prescriptive opportunities follow the active local Category/Province display filters while retaining global-scored ranks. Dataset import/source counts remain global and are explicitly labeled as such.
8. **Select all:** Both existing multi-select checklists (Product Category and Compare Provinces) now include a Select All / Deselect All checkbox, distinct from the existing aggregate “All Categories / All Provinces” choice. Global Analysis Scope already had its own Select all control.
9. **Responsive adjustments:** The Prescriptive filter toolbar can wrap when two dropdowns are shown.

## Files modified
- `src/App.jsx`
- `src/components/CategoryMultiSelect.jsx`
- `src/data/analyticsApi.js`
- `src/hooks/useAnalytics.js`
- `src/pages/DescriptiveAnalytics.jsx`
- `src/pages/PredictiveAnalytics.jsx`
- `src/pages/PrescriptiveAnalytics.jsx`
- `src/pages/ExecutiveOverview.jsx`
- `src/styles/category-multi-select.css`
- `src/styles/prescriptive.css`
- `src/styles/executive-overview.css`
- `server/analytics.js`
- `server/server.js`
- `server/forecasting.js`

## Files added
- `src/utils/analyticsFilterScope.js` — pure scope-intersection and summary helpers
- `server/analyticsScopeConsistency.test.js` — focused regression tests

## Test scenarios and observed results
### New regression checks — all passed
1. Global Beauty-only scope intersected with local Beauty+Fashion returns Beauty only.
2. An entirely out-of-scope local category selection returns zero records and does not widen global scope.
3. Global region restriction and local multiple-province selection use an intersection.
4. Descriptive selected province(s) constrain KPI totals and retain unique-order deduplication.
5. Identically named provinces in different regions are not conflated.
6. Returns-only scope emits no ordinary Prescriptive growth recommendations; Descriptive return analysis remains available.
7. Scope summaries describe selected categories and provinces.

### Existing project test suite — all passed
`node --test server/*.test.js`: **84 tests passed, 0 failed**. The suite includes analytics aggregation and return handling, forecasting/model consistency, province comparison series, local Excel import workflows, ETL preparation snapshots, corrupt file detection, local reset paths, and regression checks.

### Real prepared-data scope check — passed
- Source prepared-data snapshot: 60,457 transaction records.
- Category selection: Bottle / Container and Label / Sticker.
- Geography: two provinces in Visayas.
- Net Revenue via restricted global scope: PHP 3,502.
- Net Revenue via equivalent Descriptive filters: PHP 3,502.
- Distinct orders: 9 under both paths.
- The independent totals matched.

### Syntax verification — passed
TypeScript's parser processed **44 JS/JSX source files** in `src/` and `server/` with **0 syntax errors**.

### Not fully verified
- Interactive browser UI behavior, responsive rendering, and cross-page clicks were not exercised in a browser automation environment. Please review the checklist controls and Executive Overview manually.
- `vite build` could not finish in this Linux container because the user-uploaded Windows `node_modules` lacks the Linux optional Rollup package `@rollup/rollup-linux-x64-gnu`. `npm install` in the intended development environment should restore platform-appropriate optional dependencies.
- The new API filters were tested via backend calculation tests; a live Supabase HTTP/API end-to-end test was not performed in this turn. No Supabase project was changed.
- The original Descriptive/Predictive/Prescriptive calculations, model choices, scoring weights and prepared dataset were not intentionally changed; the new module filter logic changes which rows enter those existing calculations.

## Installation
1. Extract the updated project ZIP to a new folder; retain your original project as a backup.
2. Restore your own `.env` in the project root, pointing to your intended Supabase **clone**, not the original live project.
3. Run `npm install` (or `npm ci`, if using your lockfile) to obtain correct native dependencies for your platform.
4. Start backend and frontend using the existing scripts.
5. Open Global Analysis Scope, choose restrictive categories/regions, then verify Descriptive, Predictive and Prescriptive selections cannot widen them.
6. Check Executive Overview after changing the filters in each analytics module.

**Supabase SQL:** No SQL script or schema modification is required for this feature.
