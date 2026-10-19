-- 0035_audit_log_no_truncate — audit_log stays append-only against TRUNCATE too.
--
-- 0006's row trigger (trg_audit_log_readonly, BEFORE UPDATE OR DELETE … FOR EACH ROW) never fires on
-- TRUNCATE, which empties the table in one statement. A statement-level BEFORE TRUNCATE trigger with the
-- same function closes that: `TRUNCATE audit_log` (or a CASCADE reaching it) raises 'audit_log is
-- append-only'. Nothing in the app or the test seed truncates it (no foreign key points at it).
-- Idempotent.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_log_no_truncate') THEN
    CREATE TRIGGER trg_audit_log_no_truncate BEFORE TRUNCATE ON audit_log
      FOR EACH STATEMENT EXECUTE FUNCTION audit_log_readonly();
  END IF;
END $$;
