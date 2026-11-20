-- SAIPHER CG DSS: atomic publication timeout performance fix.
-- Run on the intended CLONED Supabase project only.
-- This only updates the existing publication FUNCTION; it does not publish or delete any rows.
-- Uses TRUNCATE within the function's PostgreSQL transaction. A failure rolls back the replacement.
BEGIN;
DO $saipher_patch$
DECLARE
    function_sql text;
BEGIN
    SELECT pg_catalog.pg_get_functiondef(
        'public.saipher_publish_master(uuid,integer)'::pg_catalog.regprocedure
    ) INTO function_sql;

    IF pg_catalog.strpos(function_sql, 'TRUNCATE TABLE public.master_transactions;') > 0 THEN
        -- Already optimized: safe to reapply this migration.
        NULL;
    ELSIF pg_catalog.strpos(function_sql, 'DELETE FROM public.master_transactions WHERE id IS NOT NULL;') > 0 THEN
        function_sql := pg_catalog.replace(
            function_sql,
            'DELETE FROM public.master_transactions WHERE id IS NOT NULL;',
            'TRUNCATE TABLE public.master_transactions;'
        );
        EXECUTE function_sql;
    ELSE
        RAISE EXCEPTION 'Unrecognized saipher_publish_master implementation; no changes applied';
    END IF;
END
$saipher_patch$;

-- Supabase PostgREST's default session timeout can be too short for a dataset replacement.
-- Supabase documentation recommends function-level settings for RPC calls.
-- Keep the time limit bounded; PostgREST has a maximum configurable runtime of 60s.
ALTER FUNCTION public.saipher_publish_master(uuid, integer)
    SET statement_timeout = '60s';

-- Keep access restricted to the privileged server connection.
REVOKE ALL ON FUNCTION public.saipher_publish_master(uuid, integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saipher_publish_master(uuid, integer)
    TO service_role;
COMMIT;
