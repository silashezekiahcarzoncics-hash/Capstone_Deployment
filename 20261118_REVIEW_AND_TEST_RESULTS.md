# SAIPHER CG DSS — November 18, 2026 Data Preparation Fixes

## Changed
- `src/pages/DataPreparation.jsx`: Full Live Data (Supabase) read-only overview with the same four section families as Staging, read-only product/geographic/status/return/month detail modals, and immediate local category count update after a successful category edit.
- `src/styles/data-preparation.css`: Styles for live-data read-only mode and detail lists.
- `server/livePreparation.js` (new): Paginated published-data report derived from Supabase `master_transactions` and completed `etl_runs`, never local staged files. The report is briefly cached and invalidated on successful publish.
- `server/server.js`: Read-only `/api/preparation/live-report` endpoint and live cache invalidation.
- `server/analytics.test.js`: Updated one outdated regression assertion. Failed atomic publishing should preserve valid live analytics reads rather than poisoning the cache.
- `server/livePreparation.test.js` (new): Report paging, mapping/fallback, counters, refresh, empty database, partial read and configuration failure coverage.
- `supabase/migrations/20261117_saipher_atomic_publish.sql`: Added a qualifying condition to the master deletion to satisfy the database safeupdate extension. Preserved transaction semantics.
- `supabase/migrations/20261118_safeupdate_publish_patch.sql` (new): Narrow function-only SQL patch for databases where the older publishing function has already been installed.
- `SAIPHER_Reset_Business_Data_ONLY.sql`: Added WHERE predicates to the reset SQL for future manual use where safeupdate is enabled. The reset feature was **not** executed or tested on any live database.

## Supabase clone testing
- Target: `capstone 2` (ref `pvtuadggojkofbklejgc`). The original project was NOT modified or tested.
- Applied a function-only migration to the clone: `saipher_clone_safeupdate_publish_fix_20261118`.
- Published a 60,457-row copy inside an explicit SQL transaction and immediately issued `ROLLBACK`.
- Observed function result `published_count=60457` during the rolled-back transaction.
- Verified afterwards: 60,457 live rows, zero staged rows, four ETL run records.
- Verified incomplete staging is rejected without changing live records.
- The clone function patch remains installed; the test transaction did not publish any lasting transaction data.

## Local testing
- 49 existing analytics and forecasting regression tests passed after correcting the obsolete failed-sync expectation.
- 4 new Live Data reporting tests passed. Overall: 53/53 tests passing.
- Babel parsing succeeded for both pages and the new/modified backend files.
- HTTP API smoke tests used disposable local working copies, never the packaged project data.
- Corrupt Excel and invalid `orders` worksheet rejected.
- Structurally valid Excel accepted, including a cancelled row with a missing price.
- Duplicate filename upload returned `Already Imported`.
- Product mapping edit immediately changed `/api/preparation/products` and invalidated preparation freshness.
- Valid small local dataset prepared and successfully rebuilt after a mapping change.
- An invalid Deal Price in a Completed order stopped preparation, preserving the SHA-256 of the previously prepared dataset.
- Live endpoint returned an appropriate 503 error without a Supabase configuration.

## Limits and review requirements
- A Vite production build could not complete in this Linux environment because the supplied Windows-based dependency bundle lacks Rollup's Linux native optional package; npm install was unavailable. JSX and JS syntax were parsed instead. Run `npm ci` and `npm run build` in your normal development environment.
- A full-preparation test using the bundled large source dataset exceeded its local timeout. This suggests a potential performance concern; no performance fix was made to the calculation algorithms. Test full-size processing on your own machine or a controlled environment.
- Live Data reconstructs available published metrics from master transactions and ETL metadata. It cannot reproduce local-only import validations or arbitrary locally saved manual review acknowledgments that were not published.
- The read-only Live Data report is calculated server-side. It is more expensive than a count-only status fetch and may take time on very large datasets.
- Your backend `.env` must point only to the intended clone while experimenting. This zip does not include `.env`.
- To use the fixed publication function in a project that already has the previous publishing SQL, manually apply **only** `supabase/migrations/20261118_safeupdate_publish_patch.sql`. It is already installed on the tested clone.
- No production Supabase database was modified.
