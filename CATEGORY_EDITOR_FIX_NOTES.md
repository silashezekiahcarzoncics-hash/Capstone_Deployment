# SAIPHER CG DSS — Local Staging Product Category Editor Fix

## Root cause
The existing **Sync from Supabase** workflow sets `sourceMode: "supabase_snapshot"` and `readOnlySnapshot: true` in `server/data/preparation_state.json`. The frontend disabled both the **Review / Edit** and **Manage Product Mapping** controls for that state, and the backend rejected all category writes. The synchronized dataset in the supplied project has **60,457 prepared rows** and **641 product listings**, so the restriction affects the uploaded staging state directly.

## Changes
- `src/pages/DataPreparation.jsx`: Enables product category editing and category management for synchronized staging; keeps full source-workbook preparation disabled; clarifies messages.
- `server/preparation.js`: Allows category-only edits to synchronized staging, writing updated `category` fields to the **local prepared dataset** and keeping its local mapping metadata consistent. Supports add/rename/delete of categories with existing assignment restrictions, preserves the fallback category, and uses backups/temporary files for recoverable local writes. It does **not** modify financial, geographic, date, order, or duplicate calculations.
- `server/preparationSnapshot.test.js`: Adds checks for Mapped/Needs Review transitions, add/rename/delete, preservation of local prepared rows, persistence after restart, and continued prohibition on rerunning raw-source preparation without workbooks.

## Boundaries and safety
- Category-only edits to a synchronized staging snapshot update **local data only**; Supabase is never written by these edits.
- A synchronized snapshot is **not** automatically eligible for full preparation or publishing merely because its categories were edited. The published data lacks original Shopee source columns needed by the full ETL. Reimport the actual workbooks to rerun complete preparation and publish through the existing workflow.
- If you later sync again from Supabase, it replaces local staging and will overwrite these unpublished category edits. That overwrite is already part of the Sync workflow.
- No Supabase SQL modification is needed.

## Tests performed
- All **84/84** backend test cases passed using restored dependencies from the uploaded ZIP.
- A real-data isolated copy of the synced staging file with **60,457 rows / 641 products** passed product reclassification to Other / Unclassified, immediate updated status, persistence after reopening, unchanged row counts, and local-only safety. The tested edit took approximately 1 second.
- All **25** frontend JavaScript and JSX source files passed parsing.
- A production Vite build could not execute in this Linux container because the uploaded `node_modules/.bin/vite` file has Windows-oriented permissions. Run `npm install` and `npm run build` on your development machine to verify the build.
- No live Supabase writes, migrations, resets, or database operations were performed.

## Setup
1. Extract the ZIP and restore your original backend `.env` (the ZIP excludes the secret file).
2. Install platform-specific dependencies if needed, then start frontend and backend.
3. Open **Data Preparation → Staging Data → Review Product Categorization**. All, Mapped and Needs Review now support **Review / Edit** and **Manage Product Mapping**, even after Sync from Supabase.
4. For a complete Data Preparation rerun, import original source workbooks in Data Management.
