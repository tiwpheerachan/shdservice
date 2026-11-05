-- db-wipe.sql — empties the database before a full load of the legacy dump (setupdata/load_supabase.sh,
-- npm run db:dev:load): every table, view, sequence and function in schema public — the dump's and the app's
-- (audit_log, job_symptom, track_*, profiles …) — and drizzle's journal, so the migration then runs from scratch
-- and nothing from testing is left to collide with the real job / document numbers. What the new app set up is
-- put back by the seed (scripts/seed-export.mts). Extensions (pg_trgm, pgcrypto), the schema itself, its grants
-- and Supabase's own schemas (auth, storage — the bucket files) are not touched.
SET client_min_messages = warning; -- one NOTICE per cascaded constraint otherwise
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname, CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
                                     WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END AS kind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
     ORDER BY c.relkind IN ('r', 'p') DESC -- tables first: their views and owned sequences go with them
  LOOP
    EXECUTE format('DROP %s IF EXISTS public.%I CASCADE', r.kind, r.relname);
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP ROUTINE IF EXISTS %s CASCADE', r.sig);
  END LOOP;
END $$;
DROP SCHEMA IF EXISTS drizzle CASCADE;
