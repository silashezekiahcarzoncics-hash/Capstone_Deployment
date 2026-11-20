# SAIPHER — Client User Reset Feature (review copy)

The reset feature is in the existing **Client User** dropdown. Click **Reset** to open a password-confirmation modal containing two options: **Clear Local Database** and **Clear Local Database + Supabase**. Both use the project's current hardcoded login password; no authentication system changes were made.

## Modified files

- `src/components/Topbar.jsx`: dropdown Reset button and modal (radio choices, current-password input, Cancel and OK).
- `src/styles/topbar.css`: UI styling consistent with the existing theme.
- `server/server.js`: `POST /api/application/reset`; validates password and selected mode, clears only application-owned local data, and optionally calls a dedicated Supabase RPC.

## New SQL (only for this feature)

- `SAIPHER_Reset_Business_Data_ONLY.sql`: installs `public.saipher_reset_business_data()` with service-role-only permissions and atomic deletion of SAIPHER Supabase business records. Installing the function itself deletes **nothing**. Do not run the function until you intend to reset the live database.

The new SQL is independent of the earlier, unexecuted atomic-publishing SQL. No older SQL files are provided as a separate installation step for this feature.

## Reset behavior

- **Local only:** Clears local uploaded Excel files, dataset registrations, prepared output, preparation state, upload state, local mapping overrides, and category customizations. Does not touch Supabase.
- **Local + Supabase:** First calls `saipher_reset_business_data` to delete Supabase `master_transactions`, `product_mapping`, `geographic_mapping`, `etl_runs`, `data_adjustments` (and optional staging records if the earlier publishing staging table exists), in one database transaction; then performs local cleanup. Without the new SQL, this mode fails and local data remains unchanged.
- Password check uses the exact existing static login password (`saiphercg123`) in the server handler. This does **not** improve existing authentication/security and is suitable only within the explicitly accepted current security model.
- The backend does not invoke either reset mode automatically. No live data was deleted by preparing this project.
- If Supabase cleanup succeeds but local filesystem cleanup fails, the response explicitly reports the partial outcome so the user can retry Local Only.

## Review considerations

- This operation is destructive and intentionally has no undo. Back up local and Supabase data before eventually using it.
- The reset endpoint follows the current application's hardcoded authentication model; this is **not** an independently authenticated session mechanism. Strengthening it is deferred as instructed.
- Clearing data while other data-entry actions are running is not fully serialized; review operations and avoid simultaneous imports/preparation during reset.
- The revised backend still needs to be run and tested later. No tests, builds, database migrations, or live Supabase mutations were executed for this delivery.
