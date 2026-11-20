-- SAIPHER CG DSS: correction for safeupdate-enabled Supabase databases.
-- This migration REPLACES ONLY the publication function.
-- Running this script does not publish, delete or alter any transaction rows.
-- Execute ONLY on the chosen Supabase project after review.
BEGIN;
CREATE OR REPLACE FUNCTION public.saipher_publish_master(
  p_stage_token uuid,
  p_expected_count integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count bigint;
  v_run_count integer;
  v_run_id text;
  v_columns text;
  v_final_count bigint;
BEGIN
  -- Function EXECUTE is granted only to service_role below.
  -- The privileged function must never be called from browser/client code.
  IF p_stage_token IS NULL OR p_expected_count IS NULL OR p_expected_count <= 0 THEN
    RAISE EXCEPTION 'Invalid staging token or expected record count';
  END IF;

  -- Prevent overlapping publications, including from different backend instances.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(781612, 20261117) THEN
    RAISE EXCEPTION 'Another dataset publication is in progress';
  END IF;

  SELECT count(*), count(DISTINCT etl_run_id), min(etl_run_id)
    INTO v_count, v_run_count, v_run_id
  FROM public.saipher_master_stage
  WHERE stage_token = p_stage_token;
  IF v_count <> p_expected_count THEN
    RAISE EXCEPTION 'Staging incomplete: expected %, found %', p_expected_count, v_count;
  END IF;
  IF v_run_count <> 1 OR EXISTS (
    SELECT 1 FROM public.saipher_master_stage
    WHERE stage_token = p_stage_token AND etl_run_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Staging must contain exactly one non-null ETL run ID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.etl_runs WHERE run_id = v_run_id) THEN
    RAISE EXCEPTION 'ETL run % is missing; register it before publishing', v_run_id;
  END IF;

  -- Validate all existing master_transactions foreign-key dependencies BEFORE DELETE.
  IF EXISTS (
    SELECT 1 FROM public.saipher_master_stage s
    WHERE s.stage_token = p_stage_token
      AND s.raw_product_name IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.product_mapping m
        WHERE m.raw_product_name = s.raw_product_name
      )
  ) THEN
    RAISE EXCEPTION 'Some staged products are missing from product_mapping';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.saipher_master_stage s
    WHERE s.stage_token = p_stage_token
      AND s.raw_province IS NOT NULL AND s.raw_city IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.geographic_mapping g
        WHERE g.raw_province = s.raw_province
          AND g.raw_city = s.raw_city
      )
  ) THEN
    RAISE EXCEPTION 'Some staged geographic pairs are missing from geographic_mapping';
  END IF;

  -- Generate columns shared by live and staging tables; do not copy generated
  -- primary key/timestamp columns, whose defaults are assigned at insertion.
  SELECT pg_catalog.string_agg(pg_catalog.format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO v_columns
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_attribute b
    ON b.attrelid = 'public.saipher_master_stage'::pg_catalog.regclass
   AND b.attname = a.attname AND b.attnum > 0 AND NOT b.attisdropped
  WHERE a.attrelid = 'public.master_transactions'::pg_catalog.regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attname NOT IN ('id', 'created_at')
    AND a.attgenerated = '';
  IF v_columns IS NULL THEN
    RAISE EXCEPTION 'No compatible master transaction columns found';
  END IF;

  -- The WHERE clause is required by PostgreSQL safeupdate and targets every live row.
  -- DELETE and INSERT execute inside the SAME PostgreSQL transaction.
  -- If either operation, a foreign key, or the count check fails, the whole
  -- transaction rolls back and the previously committed rows remain live.
  DELETE FROM public.master_transactions WHERE id IS NOT NULL;
  EXECUTE pg_catalog.format(
    'INSERT INTO public.master_transactions (%s) SELECT %s FROM public.saipher_master_stage WHERE stage_token = $1',
    v_columns, v_columns
  ) USING p_stage_token;

  SELECT count(*) INTO v_final_count FROM public.master_transactions;
  IF v_final_count <> p_expected_count THEN
    RAISE EXCEPTION 'Published count mismatch: expected %, got %', p_expected_count, v_final_count;
  END IF;

  DELETE FROM public.saipher_master_stage WHERE stage_token = p_stage_token;
  RETURN pg_catalog.jsonb_build_object('published_count', v_final_count);
END;
$function$;

REVOKE ALL ON FUNCTION public.saipher_publish_master(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saipher_publish_master(uuid, integer) TO service_role;
COMMIT;
