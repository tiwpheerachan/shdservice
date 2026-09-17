-- 0006_audit_log — application audit trail: one append-only row per write the
-- app performs (create / update / delete / status change / approve / stock
-- issue / login …), written inside the same transaction as the data change.
-- `changes` holds only the fields that changed: {"field": [old, new]}.
-- Legacy job_log keeps being written as before (old reports); this is a layer
-- on top. Rows edited directly in SQL are NOT recorded here (agreed 2026-09-17).
-- Idempotent.
CREATE TABLE IF NOT EXISTS audit_log (
    id          bigserial     PRIMARY KEY,
    at          timestamp     NOT NULL,
    user_id     integer       NOT NULL DEFAULT 0,
    user_name   varchar(100)  NOT NULL DEFAULT '',
    action      varchar(20)   NOT NULL,
    module      varchar(50)   NOT NULL DEFAULT '',
    entity      varchar(50)   NOT NULL,
    entity_key  varchar(100)  NOT NULL DEFAULT '',
    summary     varchar(200)  NOT NULL DEFAULT '',
    changes     jsonb,
    meta        jsonb
);
CREATE INDEX IF NOT EXISTS ix_audit_log_entity ON audit_log (entity, entity_key, at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_log_user   ON audit_log (user_id, at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_log_at     ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_log_module ON audit_log (module, at DESC);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- append-only: nobody (not even the app role) can rewrite history
CREATE OR REPLACE FUNCTION audit_log_readonly() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END $$ LANGUAGE plpgsql;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_log_readonly') THEN
    CREATE TRIGGER trg_audit_log_readonly BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_readonly();
  END IF;
END $$;
