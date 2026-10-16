-- 0003_record_status — one soft-delete convention for every table the app can
-- "delete" from. record_status = ACTIVE | INACTIVE | DELETED (lookup table
-- record_status). The legacy flags (is_active, document_status, app_user.deleted)
-- are kept in sync by the app so old reports keep working. Idempotent; the
-- backfill only touches rows still at the default ACTIVE, so re-running after a
-- reload never overwrites a status the new app has set.
CREATE TABLE IF NOT EXISTS record_status (
    code        varchar(10) PRIMARY KEY,
    name_th     varchar(50) NOT NULL,
    name_en     varchar(50) NOT NULL,
    sort_order  integer     NOT NULL
);
ALTER TABLE record_status ENABLE ROW LEVEL SECURITY;
INSERT INTO record_status (code, name_th, name_en, sort_order) VALUES
  ('ACTIVE',   'ใช้งาน',      'Active',   1),
  ('INACTIVE', 'ปิดใช้งาน',   'Inactive', 2),
  ('DELETED',  'ลบแล้ว',      'Deleted',  3)
ON CONFLICT (code) DO NOTHING;


-- category
ALTER TABLE category ADD COLUMN IF NOT EXISTS record_status     varchar(10) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE category ADD COLUMN IF NOT EXISTS status_changed_at timestamp;
ALTER TABLE category ADD COLUMN IF NOT EXISTS status_changed_by integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_category_record_status') THEN
    ALTER TABLE category ADD CONSTRAINT fk_category_record_status FOREIGN KEY (record_status) REFERENCES record_status (code);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_category_record_status ON category (record_status);

-- manufacturer
ALTER TABLE manufacturer ADD COLUMN IF NOT EXISTS record_status     varchar(10) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE manufacturer ADD COLUMN IF NOT EXISTS status_changed_at timestamp;
ALTER TABLE manufacturer ADD COLUMN IF NOT EXISTS status_changed_by integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_manufacturer_record_status') THEN
    ALTER TABLE manufacturer ADD CONSTRAINT fk_manufacturer_record_status FOREIGN KEY (record_status) REFERENCES record_status (code);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_manufacturer_record_status ON manufacturer (record_status);

-- color
ALTER TABLE color ADD COLUMN IF NOT EXISTS record_status     varchar(10) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE color ADD COLUMN IF NOT EXISTS status_changed_at timestamp;
ALTER TABLE color ADD COLUMN IF NOT EXISTS status_changed_by integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_color_record_status') THEN
    ALTER TABLE color ADD CONSTRAINT fk_color_record_status FOREIGN KEY (record_status) REFERENCES record_status (code);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_color_record_status ON color (record_status);

-- job_type
ALTER TABLE job_type ADD COLUMN IF NOT EXISTS record_status     varchar(10) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE job_type ADD COLUMN IF NOT EXISTS status_changed_at timestamp;
ALTER TABLE job_type ADD COLUMN IF NOT EXISTS status_changed_by integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_job_type_record_status') THEN
    ALTER TABLE job_type ADD CONSTRAINT fk_job_type_record_status FOREIGN KEY (record_status) REFERENCES record_status (code);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_job_type_record_status ON job_type (record_status);

-- product_type
ALTER TABLE product_type ADD COLUMN IF NOT EXISTS record_status     varchar(10) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE product_type ADD COLUMN IF NOT EXISTS status_changed_at timestamp;
ALTER TABLE product_type ADD COLUMN IF NOT EXISTS status_changed_by integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_product_type_record_status') THEN
    ALTER TABLE product_type ADD CONSTRAINT fk_product_type_record_status FOREIGN KEY (record_status) REFERENCES record_status (code);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_product_type_record_status ON product_type (record_status);

-- symptom
ALTER TABLE symptom ADD COLUMN IF NOT EXISTS record_status     varchar(10) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE symptom ADD COLUMN IF NOT EXISTS status_changed_at timestamp;
ALTER TABLE symptom ADD COLUMN IF NOT EXISTS status_changed_by integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_symptom_record_status') THEN
    ALTER TABLE symptom ADD CONSTRAINT fk_symptom_record_status FOREIGN KEY (record_status) REFERENCES record_status (code);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_symptom_record_status ON symptom (record_status);

-- model
ALTER TABLE model ADD COLUMN IF NOT EXISTS record_status     varchar(10) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE model ADD COLUMN IF NOT EXISTS status_changed_at timestamp;
ALTER TABLE model ADD COLUMN IF NOT EXISTS status_changed_by integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_model_record_status') THEN
    ALTER TABLE model ADD CONSTRAINT fk_model_record_status FOREIGN KEY (record_status) REFERENCES record_status (code);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_model_record_status ON model (record_status);

-- product
ALTER TABLE product ADD COLUMN IF NOT EXISTS record_status     varchar(10) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE product ADD COLUMN IF NOT EXISTS status_changed_at timestamp;
ALTER TABLE product ADD COLUMN IF NOT EXISTS status_changed_by integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_product_record_status') THEN
    ALTER TABLE product ADD CONSTRAINT fk_product_record_status FOREIGN KEY (record_status) REFERENCES record_status (code);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_product_record_status ON product (record_status);

-- customer
ALTER TABLE customer ADD COLUMN IF NOT EXISTS record_status     varchar(10) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE customer ADD COLUMN IF NOT EXISTS status_changed_at timestamp;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS status_changed_by integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_customer_record_status') THEN
    ALTER TABLE customer ADD CONSTRAINT fk_customer_record_status FOREIGN KEY (record_status) REFERENCES record_status (code);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_customer_record_status ON customer (record_status);

-- app_user
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS record_status     varchar(10) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS status_changed_at timestamp;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS status_changed_by integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_user_record_status') THEN
    ALTER TABLE app_user ADD CONSTRAINT fk_app_user_record_status FOREIGN KEY (record_status) REFERENCES record_status (code);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_app_user_record_status ON app_user (record_status);

-- job
ALTER TABLE job ADD COLUMN IF NOT EXISTS record_status     varchar(10) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE job ADD COLUMN IF NOT EXISTS status_changed_at timestamp;
ALTER TABLE job ADD COLUMN IF NOT EXISTS status_changed_by integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_job_record_status') THEN
    ALTER TABLE job ADD CONSTRAINT fk_job_record_status FOREIGN KEY (record_status) REFERENCES record_status (code);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_job_record_status ON job (record_status);

-- quotation_hd
ALTER TABLE quotation_hd ADD COLUMN IF NOT EXISTS record_status     varchar(10) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE quotation_hd ADD COLUMN IF NOT EXISTS status_changed_at timestamp;
ALTER TABLE quotation_hd ADD COLUMN IF NOT EXISTS status_changed_by integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_quotation_hd_record_status') THEN
    ALTER TABLE quotation_hd ADD CONSTRAINT fk_quotation_hd_record_status FOREIGN KEY (record_status) REFERENCES record_status (code);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_quotation_hd_record_status ON quotation_hd (record_status);

-- sale_out_hd
ALTER TABLE sale_out_hd ADD COLUMN IF NOT EXISTS record_status     varchar(10) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE sale_out_hd ADD COLUMN IF NOT EXISTS status_changed_at timestamp;
ALTER TABLE sale_out_hd ADD COLUMN IF NOT EXISTS status_changed_by integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sale_out_hd_record_status') THEN
    ALTER TABLE sale_out_hd ADD CONSTRAINT fk_sale_out_hd_record_status FOREIGN KEY (record_status) REFERENCES record_status (code);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_sale_out_hd_record_status ON sale_out_hd (record_status);

-- document_attach
ALTER TABLE document_attach ADD COLUMN IF NOT EXISTS record_status     varchar(10) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE document_attach ADD COLUMN IF NOT EXISTS status_changed_at timestamp;
ALTER TABLE document_attach ADD COLUMN IF NOT EXISTS status_changed_by integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_document_attach_record_status') THEN
    ALTER TABLE document_attach ADD CONSTRAINT fk_document_attach_record_status FOREIGN KEY (record_status) REFERENCES record_status (code);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_document_attach_record_status ON document_attach (record_status);

-- backfill from the legacy flags (only rows still at the default)
UPDATE category      SET record_status = 'INACTIVE' WHERE record_status = 'ACTIVE' AND is_active = false;
UPDATE manufacturer  SET record_status = 'INACTIVE' WHERE record_status = 'ACTIVE' AND is_active = false;
UPDATE color         SET record_status = 'INACTIVE' WHERE record_status = 'ACTIVE' AND is_active = false;
UPDATE job_type      SET record_status = 'INACTIVE' WHERE record_status = 'ACTIVE' AND is_active = false;
UPDATE product_type  SET record_status = 'INACTIVE' WHERE record_status = 'ACTIVE' AND is_active = false;
UPDATE symptom       SET record_status = 'INACTIVE' WHERE record_status = 'ACTIVE' AND is_active = false;
UPDATE model         SET record_status = 'INACTIVE' WHERE record_status = 'ACTIVE' AND is_active = false;
UPDATE product       SET record_status = 'INACTIVE' WHERE record_status = 'ACTIVE' AND is_active = false;
UPDATE customer      SET record_status = 'INACTIVE' WHERE record_status = 'ACTIVE' AND is_active = false;
UPDATE quotation_hd  SET record_status = 'INACTIVE' WHERE record_status = 'ACTIVE' AND is_active = false;
-- users: the old app's "deleted" flag = DELETED, plain inactive = INACTIVE
UPDATE app_user      SET record_status = 'DELETED'  WHERE record_status = 'ACTIVE' AND deleted = true;
UPDATE app_user      SET record_status = 'INACTIVE' WHERE record_status = 'ACTIVE' AND is_active = false;
-- jobs: status 0 "ยกเลิกข้อมูล" was the legacy delete
UPDATE job           SET record_status = 'DELETED'  WHERE record_status = 'ACTIVE' AND job_status_id = 0;
-- sale orders: cancelled document = deleted
UPDATE sale_out_hd   SET record_status = 'DELETED'  WHERE record_status = 'ACTIVE' AND document_status = false;
-- attachments: removed file = deleted
UPDATE document_attach SET record_status = 'DELETED' WHERE record_status = 'ACTIVE' AND is_active = false;
