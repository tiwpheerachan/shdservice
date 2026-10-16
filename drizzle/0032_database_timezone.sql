-- 0032_database_timezone — the database's own timezone is Asia/Bangkok (DB-1 in docs/production-readiness.md
-- "โครงสร้าง DB"; same as OneLink's 0032_database_timezone).
--
-- Why: the Supabase pooler drops the startup `options` src/db/client.ts sends (-c TimeZone=Asia/Bangkok),
-- so production sessions ran in UTC (measured 2026-10-16). A database default applies to every session,
-- whatever the pooler mode.
--
-- What this changes, and what it does not:
--   * Legacy `timestamp` columns hold Thai wall-clock text written from JS (adr/0001) — they do not move.
--   * `timestamptz` columns (track_*, idempotency_key, job.track_*) are instants — they do not move either;
--     only how a session prints them changes.
--   * `now()` defaults into `timestamp` columns (document_profile / shipping_profile created_at, updated_at)
--     now get Thai time instead of UTC.
--
-- Applies to sessions opened after it (on a pooled connection: as the pool turns over). The database name
-- differs per environment (postgres on Supabase, shd_oneservice_dev_db locally), so it is read, not written.
-- statement_timeout is NOT set here: it would also cut migrations and the SQL editor — the reports set their
-- own with SET LOCAL (withStatementTimeout, src/db/client.ts).
-- Idempotent. To undo: ALTER DATABASE <name> RESET timezone;

DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Bangkok');
END $$;
