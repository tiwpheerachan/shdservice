-- 0003_merge_legacy_users_grant — merge_legacy_users() (0002) kept the default EXECUTE grant to PUBLIC, so any role
-- (Supabase anon / authenticated through the Data API included) could run it. Only its owner calls it: this
-- migration and seed.sql (scripts/seed-export.mts), both as postgres. Idempotent; the Supabase roles are skipped on a
-- plain Postgres (local docker, CI).
REVOKE EXECUTE ON FUNCTION merge_legacy_users() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION merge_legacy_users() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION merge_legacy_users() FROM authenticated';
  END IF;
END $$;
