-- 0001_app — everything this application adds on top of the legacy schema.
-- Idempotent: safe to re-run after a re-dump/reload of the legacy tables.

-- ---------------------------------------------------------------------------
-- 1. app_user: SSO profile columns (login is Central SSO; app_user is the ONLY
--    user table — every legacy FK (job.engineer_id, job_log.job_action_by, …)
--    points at app_user.user_id).
-- ---------------------------------------------------------------------------
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS lark_id    varchar(50);
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS department varchar(100);
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS title      varchar(100);
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS avatar     text;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS last_login timestamp;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS deleted    boolean NOT NULL DEFAULT false;

-- legacy emails carry stray spaces; match on lower(trim(email))
CREATE UNIQUE INDEX IF NOT EXISTS ux_app_user_email
  ON app_user (lower(trim(email_address)))
  WHERE email_address IS NOT NULL AND trim(email_address) <> '';

-- ---------------------------------------------------------------------------
-- 2. One-time carry-over from the old camelCase `users` table (SSO-provisioned
--    people + their approved role) into app_user, then drop the mock tables.
--    Old UI roles → legacy user_type.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  ut text;
  fn text;
  ln text;
  existing_id integer;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT * FROM "users"
    WHERE coalesce("email", '') <> ''
    ORDER BY (coalesce("role", '') NOT IN ('', 'รออนุมัติ')) DESC, "lastLogin" DESC NULLS LAST
  LOOP
    ut := CASE r."role"
            WHEN 'System Admin'     THEN 'System Admin'
            WHEN 'Service Manager'  THEN 'Manager'
            WHEN 'ช่างเทคนิค'         THEN 'Engineer'
            WHEN 'เจ้าหน้าที่รับงาน'    THEN 'Customer Service'
            WHEN 'คลังอะไหล่'          THEN 'Stock'
            WHEN 'พนักงานขาย'         THEN 'Salesman'
            WHEN 'รออนุมัติ'           THEN NULL
            ELSE NULLIF(r."role", '')
          END;
    fn := split_part(coalesce(r."name", ''), ' ', 1);
    ln := NULLIF(trim(substr(coalesce(r."name", ''), length(fn) + 1)), '');

    SELECT user_id INTO existing_id FROM app_user
      WHERE lower(trim(email_address)) = lower(trim(r."email")) LIMIT 1;

    IF existing_id IS NULL THEN
      INSERT INTO app_user (username, password, first_name, last_name, user_type, is_active,
                            phone_no, email_address, lark_id, department, title, avatar, last_login, deleted)
      VALUES (left(coalesce(NULLIF(r."username", ''), split_part(r."email", '@', 1)), 50), '',
              left(fn, 50), left(coalesce(ln, ''), 50), ut,
              coalesce(lower(r."status") = 'active', true),
              left(coalesce(r."phone", ''), 50), lower(trim(r."email")),
              NULLIF(r."code", ''), NULLIF(r."branch", ''), NULLIF(r."title", ''), NULLIF(r."avatar", ''),
              CASE WHEN coalesce(r."lastLogin", '') ~ '^\d{4}-\d{2}-\d{2}' THEN r."lastLogin"::timestamp END,
              coalesce(r."deleted", false));
    ELSE
      -- keep the legacy row; only fill the SSO profile and (if the old app had
      -- approved a role and the legacy row has none) the role
      UPDATE app_user SET
        lark_id    = coalesce(NULLIF(r."code", ''), lark_id),
        department = coalesce(NULLIF(r."branch", ''), department),
        title      = coalesce(NULLIF(r."title", ''), title),
        avatar     = coalesce(NULLIF(r."avatar", ''), avatar),
        last_login = coalesce(CASE WHEN coalesce(r."lastLogin", '') ~ '^\d{4}-\d{2}-\d{2}' THEN r."lastLogin"::timestamp END, last_login),
        user_type  = coalesce(user_type, ut)
      WHERE user_id = existing_id;
    END IF;
  END LOOP;
END $$;

DROP TABLE IF EXISTS "users" CASCADE;
DROP TABLE IF EXISTS "permissions" CASCADE;
DROP TABLE IF EXISTS "categories" CASCADE;
DROP TABLE IF EXISTS "manufacturers" CASCADE;
DROP TABLE IF EXISTS "colors" CASCADE;
DROP TABLE IF EXISTS "job_types" CASCADE;
DROP TABLE IF EXISTS "product_types" CASCADE;
DROP TABLE IF EXISTS "symptoms" CASCADE;
DROP TABLE IF EXISTS "models" CASCADE;
DROP TABLE IF EXISTS "products" CASCADE;
DROP TABLE IF EXISTS "movements" CASCADE;
DROP TABLE IF EXISTS "customers" CASCADE;
DROP TABLE IF EXISTS "jobs" CASCADE;
DROP TABLE IF EXISTS "quotations" CASCADE;
DROP TABLE IF EXISTS "sale_orders" CASCADE;
DROP TABLE IF EXISTS "dash_groups" CASCADE;
DROP TABLE IF EXISTS "tat_rows" CASCADE;
DROP TABLE IF EXISTS "monthly" CASCADE;
DROP TABLE IF EXISTS "top_symptoms" CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Indexes the new app relies on (the legacy DB only indexed a handful).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_job_create_date        ON job (job_create_date);
CREATE INDEX IF NOT EXISTS ix_job_status             ON job (job_status_id);
CREATE INDEX IF NOT EXISTS ix_job_customer           ON job (customer_id);
CREATE INDEX IF NOT EXISTS ix_job_engineer           ON job (engineer_id);
CREATE INDEX IF NOT EXISTS ix_job_log_job_no         ON job_log (job_no, job_log_date);
CREATE INDEX IF NOT EXISTS ix_job_send_forward_job   ON job_send_forward_dt (job_no);
CREATE INDEX IF NOT EXISTS ix_inventory_dt_no        ON inventory_dt (inventory_no);
CREATE INDEX IF NOT EXISTS ix_inventory_dt_item      ON inventory_dt (item_code);
CREATE INDEX IF NOT EXISTS ix_inventory_hd_no        ON inventory_hd (inventory_no);
CREATE INDEX IF NOT EXISTS ix_inventory_hd_ref       ON inventory_hd (reference_document_no);
CREATE INDEX IF NOT EXISTS ix_inventory_hd_date      ON inventory_hd (create_date);
CREATE INDEX IF NOT EXISTS ix_product_none_serial_p  ON product_none_serial (product_id);
CREATE INDEX IF NOT EXISTS ix_product_code           ON product (product_code);
CREATE INDEX IF NOT EXISTS ix_product_model_product  ON product_model (product_id);
CREATE INDEX IF NOT EXISTS ix_product_model_code     ON product_model (model_code);
CREATE INDEX IF NOT EXISTS ix_customer_name          ON customer (customer_name);
CREATE INDEX IF NOT EXISTS ix_customer_phone         ON customer (phone_number);
CREATE INDEX IF NOT EXISTS ix_sale_out_dt_hd         ON sale_out_dt (sale_out_hd_no);
CREATE INDEX IF NOT EXISTS ix_sale_out_hd_no         ON sale_out_hd (sale_out_hd_no);
CREATE INDEX IF NOT EXISTS ix_sale_out_hd_date       ON sale_out_hd (document_create_date);
CREATE INDEX IF NOT EXISTS ix_quotation_hd_no        ON quotation_hd (quotation_no);
CREATE INDEX IF NOT EXISTS ix_document_attach_ref    ON document_attach (reference_topic, reference_item_code);
CREATE INDEX IF NOT EXISTS ix_app_user_type          ON app_user (user_type);
CREATE INDEX IF NOT EXISTS ix_model_code             ON model (model_code);
CREATE INDEX IF NOT EXISTS ix_running_no_key         ON running_no (running_type, pyear);
