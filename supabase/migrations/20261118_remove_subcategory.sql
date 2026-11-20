-- SAIPHER CG DSS — category-only product classification.
-- Apply manually in the CLONED Supabase project SQL Editor.
-- This permanently removes the old subcategory values from all three tables.
-- Does not delete any transaction rows, product mappings or preparation runs.
-- Take a database backup first; DROP COLUMN is destructive and cannot recover values afterward.
BEGIN;

ALTER TABLE public.master_transactions
    DROP COLUMN IF EXISTS subcategory;

ALTER TABLE public.product_mapping
    DROP COLUMN IF EXISTS subcategory;

ALTER TABLE public.saipher_master_stage
    DROP COLUMN IF EXISTS subcategory;

COMMIT;
