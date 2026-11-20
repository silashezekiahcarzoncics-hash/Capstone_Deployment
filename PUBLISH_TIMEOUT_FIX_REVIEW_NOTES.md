# Atomic publication timeout fix — November 18, 2026

## Cause
The Supabase publishing RPC was running a row-by-row `DELETE ... WHERE id IS NOT NULL` followed by an `INSERT ... SELECT` inside one transaction. On a larger live dataset, the request exceeded the database's statement timeout. The previous transaction rolled back, preserving the live data.

## Changes
- `SAIPHER_PUBLISH_TIMEOUT_FIX.sql` and `supabase/migrations/20261118_publish_timeout_fast_replace.sql`: replace the expensive whole-table DELETE in the existing publication function with transaction-safe `TRUNCATE TABLE public.master_transactions;` and set the function's statement timeout to `60s` (bounded). Existing foreign-key checks, staging count validation, single-run validation, advisory publication lock, transaction atomicity, and service-role execution grants are retained.
- `server/server.js`: give a targeted configuration hint when the publishing RPC reports a statement timeout.

## Clone verification
- Clone project `capstone 2` (`pvtuadggojkofbklejgc`) received the SQL migration. No other project was modified.
- A full 60,457-row staging and publication cycle succeeded inside `BEGIN ... ROLLBACK`; the test transaction was rolled back.
- Follow-up check confirmed exactly 60,457 live rows and 0 staging rows, with the optimized function installed.
- Backend `server/server.js` passed `node --check`. 53 existing tests passed; two workbook-dependent tests were blocked because the extracted test directory did not contain the `xlsx` dependency.

## Deployment
- On the **clone only**, this SQL migration was already applied. Do not reapply unless needed.
- Restore the clone's server-side `.env` (excluded from ZIP). Run the frontend and backend as you normally do, then retry publication.
- Keep a database backup. `TRUNCATE` is transactional on PostgreSQL, but it takes an ACCESS EXCLUSIVE lock; other readers may briefly block during publish.
- If publication still times out despite the fix, profile the clone's database operations/locks and consider direct-database publication via a trusted server rather than indefinitely raising the API timeout.
- No complete frontend production build or full application end-to-end publish with your local private credentials was performed here.
