# SAIPHER CG DSS — Manage Product Mapping update

## Changes

- Added **Manage Product Mapping** button to the **Review Product Mapping** modal header.
- Added a category-management lightbox with Add, Rename, Delete; responsive 2-column layout and 10 categories per page.
- Displayed distinct source-product counts (not transaction counts). Prevented deletion when a category has assigned products, including automatic assignments. The fallback `Other / Unclassified` category cannot be renamed or deleted.
- Category definitions are saved in the **local backend** file `server/data/product_categories.json`, created on the first change. The existing product mapping overrides remain in `server/data/product_mapping_overrides.json`.
- Added GET/POST/PATCH/DELETE `/api/preparation/categories` endpoints. No Supabase schema changes are needed.
- Built-in keyword rules remain unchanged: built-in categories have stable internal names and configurable display names, so renames persist through future preparations. Newly added categories have no automatic keyword rules; use the existing Review/Edit dropdown to assign their products.
- **Superseded (November 18, 2026):** Product categorization now has categories only; the former subcategory field and rules have been removed.
- Editing categories marks the previously prepared dataset as stale; **run Data Preparation again** before uploading updated analytics data to Supabase. Category editing does not automatically upload anything to Supabase.

## Modified files

- `server/preparation.js`
- `server/server.js`
- `src/pages/DataPreparation.jsx`
- `src/styles/data-preparation.css`

## Verification

- `node --test server/*.test.js`: **49 passed / 49 total**.
- Direct integration test with a real imported source workbook: **passed** for add, manual assignment, blocked deletion, rename, persistence after service recreation, and removal after reassignment.
- `DataPreparation.jsx` parsed with Babel JSX parser: **passed**.
- Frontend Vite production build: **not verified**. The preinstalled dependency directory available for inspection contains Windows Rollup native binaries and lacks `@rollup/rollup-linux-x64-gnu`. On the developer machine run `npm install` followed by `npm run build`.

## Deploying

1. Unzip the project and run `npm install` if dependencies are not installed.
2. Start Express and Vite normally.
3. Open Data Preparation → Review Product Mapping → Manage Product Mapping.
4. Add/rename/delete categories; changes persist locally in `server/data/product_categories.json`.
5. Review/edit individual product mappings in the existing product editor.
6. Run Data Preparation again, review the generated outputs, and only then explicitly upload the prepared data to Supabase if desired.

**No SQL migration is needed.** This feature stores editable category definitions in the backend's local JSON-based preparation persistence, not in new Supabase tables.

**Deployment caveat:** If running the backend on ephemeral or read-only infrastructure, persist/backup `server/data/product_categories.json` along with `server/data/product_mapping_overrides.json`. Category changes are local to the backend instance until prepared data is manually uploaded to Supabase.
