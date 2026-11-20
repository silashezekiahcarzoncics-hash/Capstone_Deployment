# SAIPHER CG DSS — Subcategory removal (November 18, 2026)

## Included changes
- Removed Subcategory column, dropdown, hierarchy, prompts, validation and mapping payloads from Data Preparation.
- Category-only classification in backend preparation and prepared-master generation; no subcategory upload to Supabase.
- Updated Live Data reporting to request category without subcategory.
- Removed subcategory keys from the included local prepared rows, overrides and preparation state, preserving the other values.
- Preserved all existing category names, product classification heuristics, analytics calculations, geographic preparation, published-data API and reset features.
- The previous `product_categories.json` now keeps category renames/additions/deletions only.

## Manual database migration (clone only)
Run `supabase/migrations/20261118_remove_subcategory.sql` in the clone's SQL Editor **after taking a backup**. It removes `subcategory` from `public.master_transactions`, `public.product_mapping`, and `public.saipher_master_stage`, including their former contents. It does not delete transaction rows. Do not execute on the original database unless separately authorized.

## Deployment notes
1. Replace project source with this updated ZIP, keeping your own private `.env` settings (not included in ZIP).
2. Apply the one new SQL migration to the cloned Supabase database.
3. Restart backend and frontend. Your next preparation/publish will only use category data.
4. Run fresh Data Preparation before publishing if local input fingerprints or category mappings changed.
5. Keep a backup of the database and prior project ZIP if historical subcategory values may be needed later. SQL DROP COLUMN is destructive.

## Validation
- Node syntax checks for modified server files passed.
- JSX parsed successfully with Babel parser.
- 55 backend tests passed in total: 53 existing tests (including a new Live Data field assertion) plus 2 new category-only preparation and real-workbook smoke tests.
- Included local JSON files parsed successfully after removing obsolete fields.
- Supabase migration was NOT executed; database remains unchanged.
- Full UI build, browser interaction and publish have not been run in this turn.
