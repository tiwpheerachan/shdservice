-- 0015_security_hardening — security audit 2026-09-25.
--
-- 1. Supabase Data API lockdown. The app never uses PostgREST (it talks to Postgres
--    as `postgres`, which has BYPASSRLS, and to Storage as service_role), so the
--    browser-facing roles `anon` / `authenticated` get NO access to schema public:
--      - RLS on the tables that were created without it (no policies = deny all
--        for every role that does not bypass RLS)
--      - view_customer runs with the caller's rights instead of its owner's
--      - privileges revoked now and for tables / sequences / functions created later
--    Also turn the Data API off in the dashboard (Settings → Data API).
--    New tables: always `ENABLE ROW LEVEL SECURITY` in their migration.
--
-- 2. app_user.session_version — part of every session cookie; logout bumps it, so
--    every cookie that user holds (all devices) stops working at once.
--
-- Idempotent; the Supabase-role parts are skipped on a plain Postgres (local docker).

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;

ALTER TABLE document_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE track_ticket     ENABLE ROW LEVEL SECURITY;
ALTER TABLE track_rate       ENABLE ROW LEVEL SECURITY;
ALTER TABLE track_block      ENABLE ROW LEVEL SECURITY;
ALTER TABLE track_event      ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- security_invoker views need PostgreSQL 15+ (Supabase is 15+)
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'ALTER VIEW view_customer SET (security_invoker = true)';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated';
  END IF;
END $$;
