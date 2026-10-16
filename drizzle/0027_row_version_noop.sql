-- 0027_row_version_noop — a save that changes nothing must not move row_version.
--
-- 0026's bump_row_version() already compares the row minus row_version and the trigger's argument
-- columns, but every save of the customer / quotation forms (statusStamp in
-- src/server/record-status.ts) and the record-status API rewrite status_changed_at = now() and
-- status_changed_by = the saver. So an unchanged save still bumped the version and every other open
-- tab got a false 409. Those two are bookkeeping, never an edit by themselves: a real status change
-- also changes record_status / is_active, which still count. Same signature, the 0026 triggers and
-- their argument lists stay as they are. Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION bump_row_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  -- TG_ARGV is NULL when the trigger has no arguments
  ignored text[] := coalesce(TG_ARGV, '{}') || ARRAY['row_version', 'status_changed_at', 'status_changed_by'];
BEGIN
  IF (to_jsonb(NEW) - ignored) IS DISTINCT FROM (to_jsonb(OLD) - ignored) THEN
    NEW.row_version := OLD.row_version + 1;
  ELSE
    NEW.row_version := OLD.row_version; -- only ignored columns changed (or nothing): not an edit
  END IF;
  RETURN NEW;
END $$;
