-- 0016_drop_product_type — ประเภทเครื่องซ่อม is retired: legacy filled it with "ตัวเครื่องสินค้า / อุปกรณ์เสริม" and later with
-- staff names, neither of which is a device type. Nothing else references it (one FK, no view or function). The values
-- are gone for good: export job_no + product_type_name before running this on production. Idempotent.
ALTER TABLE job DROP CONSTRAINT IF EXISTS fk_job_product_type_pk;
DROP INDEX IF EXISTS ix_job_product_type_pk;
ALTER TABLE job DROP COLUMN IF EXISTS product_type_pk;
DROP TABLE IF EXISTS product_type;
