-- SAIPHER CG DSS: NEW reset feature only. Does not require executing earlier publish SQL.
-- Manual installation in Supabase SQL Editor; installing does not delete any data.
-- On manual user confirmation, the backend calls this as a single transaction.
BEGIN;

CREATE OR REPLACE FUNCTION public.saipher_reset_business_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    deleted_master bigint;
BEGIN
    -- Only backend service-role JWTs may perform this destructive operation.
    IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service-role access required';
    END IF;
    -- PostgreSQL executes this function atomically; any failure rolls back ALL deletes.
    PERFORM pg_catalog.pg_advisory_xact_lock(781612, 20261117);

    -- If atomic publishing staging was previously installed, clear staged drafts too.
    IF pg_catalog.to_regclass('public.saipher_master_stage') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.saipher_master_stage WHERE stage_token IS NOT NULL';
    END IF;

    DELETE FROM public.master_transactions WHERE id IS NOT NULL;
    GET DIAGNOSTICS deleted_master = ROW_COUNT;
    DELETE FROM public.product_mapping WHERE id IS NOT NULL;
    DELETE FROM public.geographic_mapping WHERE id IS NOT NULL;
    DELETE FROM public.etl_runs WHERE id IS NOT NULL;
    DELETE FROM public.data_adjustments WHERE id IS NOT NULL;

    RETURN pg_catalog.jsonb_build_object('cleared', true, 'master_records_deleted', deleted_master);
END;
$$;

REVOKE ALL ON FUNCTION public.saipher_reset_business_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saipher_reset_business_data() TO service_role;
COMMIT;
