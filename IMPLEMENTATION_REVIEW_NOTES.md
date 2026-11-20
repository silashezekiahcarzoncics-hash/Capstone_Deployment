# SAIPHER CG DSS — Data Preparation improvements (review only)

## Scope
This package contains source changes based on `backend.pdf` and `frontend.pdf`.
No automated tests, build, deployment, live Supabase modifications, or production migration execution were performed.

## Before activating Supabase publishing

1. Review `supabase/migrations/20261117_saipher_atomic_publish.sql` against your actual existing `public.master_transactions` schema, permissions, triggers and foreign keys.
2. Back up the existing Supabase database through your normal administration process.
3. When you approve the migration, paste its complete contents into the Supabase SQL Editor and run it manually.
4. The application uses a server-side Supabase service-role credential. The migration exposes `public.saipher_publish_master(uuid, integer)` **only to service_role**.
5. Until the migration is applied, the new Publish operation deliberately fails without deleting the live master dataset. There is **no unsafe delete/insert fallback**.
6. After your review, separately authorize tests and build verification before production use.

**No SQL was executed against your Supabase project.**

## Existing analytical rules preserved
Revenue, Deals, quantity calculations, return/refund options, dates, eligibility, exact duplicate treatment, Others / Unclassified, forecasting and prescriptive scoring were not intentionally changed.

## Updated frontend
- Data Preparation: Staging (Local) and Live (Supabase) tabs, existing four sections retained, summary and pending-change dialogs, explanatory publish controls, informational fallback categorization.
- Data Management: per-file upload results, accepted vs rejected feedback, independent file validation.

## Updated backend
- Excel imports reject structurally unreadable/empty files while allowing recoverable row-level issues to reach the existing ETL.
- Local ETL writes data and state through temporary files and restore copies, preserving previous successful file output if writing fails.
- Fingerprint of imported-file metadata and category mappings identifies input changes without forcing automatic full preparation on each product edit. Geographic mapping is defined by current ETL rules and has no editable override system.
- Server checks the prepared run identity, current input fingerprint and explicit runId confirmation before publication.
- The new publisher stages all rows in `saipher_master_stage` and calls the atomic `saipher_publish_master` function. Staging errors do not touch live data.
- Analytics cache is not poisoned by a staging/publishing failure.

## Deliberately deferred / limitations
- **No test/build verification was performed** per your instruction. Functional behavior must be reviewed and subsequently tested.
- The existing local files and imported Shopee workbook data are retained inside the package. Treat them as private client data.
- The original `.env` was omitted from the deliverable ZIP to avoid distributing credentials. Recreate/restore your own `.env` privately before using the project.
- Migration SQL has not been checked against a live Supabase catalog. Confirm compatibility with the actual schema before applying.
- Post-publish dimension sync and ETL-run logging remain separate from the atomic master replacement; errors in those secondary steps are returned as warnings and must be reviewed.
- Current live publication timestamp is from local successful-upload metadata; the live count is fetched directly from Supabase. An external publication may not have a locally recorded timestamp.
- Existing source ETL business validation for financially invalid Completed transactions remains deliberately strict, even if the workbook was accepted at the upload stage.
