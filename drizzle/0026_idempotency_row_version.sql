-- 0026_idempotency_row_version — no duplicate creates, no silent overwrites.
--
-- 1. idempotency_key: a create POST that carries an `Idempotency-Key` header is run once per
--    (user, key); a retry / double-click / resend gets the stored answer back instead of a second
--    document (src/server/idempotency.ts). response NULL = that request is still running.
--    Rows older than 24 h are purged by the app as it goes.
--
-- 2. row_version on job / quotation_hd / sale_out_hd / customer (optimistic locking): the edit
--    forms send the version they loaded and the save answers 409 when it moved
--    (assertVersion in src/server/http-error.ts). A trigger bumps it on EVERY update — this app, the legacy
--    system and hand-run SQL alike — so no write path can forget it. The trigger's arguments are
--    columns that do NOT count as an edit: saved on the spot elsewhere and never written by the
--    edit form (document profile, slips) or the public tracking link's own bookkeeping.
--
-- RLS on, no policies (0015). Idempotent (the legacy tables can be reloaded and every migration re-run).

CREATE TABLE IF NOT EXISTS idempotency_key (
    user_id     integer      NOT NULL,
    key         varchar(100) NOT NULL,
    route       varchar(200) NOT NULL,
    status      smallint,                       -- HTTP status of the stored answer
    response    jsonb,                          -- NULL while the first request runs
    created_at  timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS ix_idempotency_key_created ON idempotency_key (created_at);
ALTER TABLE idempotency_key ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION bump_row_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ignored text[] := array_append(coalesce(TG_ARGV, '{}'), 'row_version'); -- TG_ARGV is NULL when the trigger has no arguments
BEGIN
  IF (to_jsonb(NEW) - ignored) IS DISTINCT FROM (to_jsonb(OLD) - ignored) THEN
    NEW.row_version := OLD.row_version + 1;
  ELSE
    NEW.row_version := OLD.row_version; -- only ignored columns changed (or nothing): not an edit
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE job          ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 0;
ALTER TABLE quotation_hd ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 0;
ALTER TABLE sale_out_hd  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 0;
ALTER TABLE customer     ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 0;

DROP TRIGGER IF EXISTS tr_job_row_version ON job;
CREATE TRIGGER tr_job_row_version BEFORE UPDATE ON job FOR EACH ROW EXECUTE FUNCTION bump_row_version(
  'document_profile_id', 'job_payment_slip_file_name', 'track_token', 'track_token_hash', 'track_token_at', 'track_opened_at', 'track_link_expires_at');
DROP TRIGGER IF EXISTS tr_quotation_hd_row_version ON quotation_hd;
CREATE TRIGGER tr_quotation_hd_row_version BEFORE UPDATE ON quotation_hd FOR EACH ROW EXECUTE FUNCTION bump_row_version('document_profile_id');
DROP TRIGGER IF EXISTS tr_sale_out_hd_row_version ON sale_out_hd;
CREATE TRIGGER tr_sale_out_hd_row_version BEFORE UPDATE ON sale_out_hd FOR EACH ROW EXECUTE FUNCTION bump_row_version('document_profile_id', 'slip_file_name');
DROP TRIGGER IF EXISTS tr_customer_row_version ON customer;
CREATE TRIGGER tr_customer_row_version BEFORE UPDATE ON customer FOR EACH ROW EXECUTE FUNCTION bump_row_version();
