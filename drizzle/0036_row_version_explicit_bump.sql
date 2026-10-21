-- 0036_row_version_explicit_bump — a write may move row_version on purpose without changing another column.
--
-- Issuing part of a job's request or taking parts back changes job_order_spare_part_log and stock, not the job
-- row, so a repair page opened before it still saved with its old version (QA 2026-10-21). Those paths now run
-- `UPDATE job SET row_version = row_version + 1`; until now the trigger put the version back (0027: "only
-- ignored columns changed — not an edit"). An explicit increase is kept; a save that changes nothing still
-- leaves the version where it was. Same signature, the 0026 triggers stay as they are. Idempotent.

CREATE OR REPLACE FUNCTION bump_row_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  -- TG_ARGV is NULL when the trigger has no arguments
  ignored text[] := coalesce(TG_ARGV, '{}') || ARRAY['row_version', 'status_changed_at', 'status_changed_by'];
BEGIN
  IF (to_jsonb(NEW) - ignored) IS DISTINCT FROM (to_jsonb(OLD) - ignored) THEN
    NEW.row_version := OLD.row_version + 1;
  ELSIF NEW.row_version IS DISTINCT FROM OLD.row_version AND NEW.row_version > OLD.row_version THEN
    NEW.row_version := OLD.row_version + 1; -- asked for: another table's change is an edit of this row
  ELSE
    NEW.row_version := OLD.row_version; -- only ignored columns changed (or nothing): not an edit
  END IF;
  RETURN NEW;
END $$;
