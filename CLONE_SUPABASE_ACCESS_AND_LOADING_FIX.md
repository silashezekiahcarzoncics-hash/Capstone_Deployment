# SAIPHER CG DSS — ETL RLS / Live Data / Loading-State Fix

## What changed

- `server/server.js`: The publish and read-only live-report endpoints now require a backend Supabase **service-role/secret** credential and give a descriptive error if `SUPABASE_SECRET_KEY` is an anon/publishable credential. This prevents confusing `etl_runs` RLS failures and misleading empty Live Data when records exist but are not visible to the client role. The existing RLS policies and publishing SQL were not changed.
- `src/pages/DataPreparation.jsx`: Staging now shows an explicit loading state, rather than initial placeholder zeros; failures show a retry option. Live Data now shows a loading indicator while querying published rows, a retriable error state, and a manual Refresh action. Switching to Live does not repeatedly force a full rebuild of a cached report.
- `src/styles/data-preparation.css`: Matching load/error styling.
- `src/pages/DataManagement.jsx` and `src/styles/data-management.css`: Initial loading and API failure states show a spinner/message or retry action, rather than initial zeros. Removed the hardcoded data coverage date caption.

## Important: Configure the cloned project in your PRIVATE `.env`

Restore your server-only `.env` to the project root. Its two relevant settings should point to the **same cloned Supabase project**:

```
SUPABASE_URL=https://pvtuadggojkofbklejgc.supabase.co
SUPABASE_SECRET_KEY=<the cloned project's server-only service_role or sb_secret_ key>
```

Retrieve the key from the cloned project's Supabase Dashboard > Project Settings > API Keys. Do not copy a publishable/anon key into `SUPABASE_SECRET_KEY`; those cannot bypass RLS on the protected ETL-run table. Do not put this secret in `VITE_...` variables or frontend files. **Never paste a credential into a chat.** Restart the backend after editing `.env`.

This is a configuration requirement, not an invitation to disable RLS or add unrestricted public policies.

## Live Data

The Live Data tab reads only successfully published data in `public.master_transactions` via the backend. It does not sync local changes automatically. The connected clone was checked read-only during this task and contained 60,457 live transaction rows; staging was not modified.

## SQL

No new SQL is required for this credential/loading fix if the cloned project's existing atomic publication function has already been installed. The existing function and RLS were not modified by this task.

## Tests and limits

- Source parsing: `server/server.js` passed Node syntax check; modified JSX pages passed Babel parser checks.
- Existing automated backend tests: 53 passed, 0 failed.
- Full Vite build could not be completed in the available environment because the bundled dependency installation lacked `@rollup/rollup-linux-x64-gnu`. This does not establish a production build pass.
- A real browser-connected end-to-end test with your local `.env` was not possible because the private service credential was not provided. The RLS error will only be resolved on your machine once the backend uses the correct clone service credential.

## Scope

No changes were made to the clone or original Supabase database, analytics formulas, forecasting models, or ETL financial validation in this update. No SQL migrations were applied.
