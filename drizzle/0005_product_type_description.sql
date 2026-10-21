-- 0005_product_type_description — the "ประเภทเครื่องซ่อม" screen has a
-- รายละเอียด field like the other masters, but legacy product_type had no
-- description column. Added by this app (same shape as job_type_description).
-- Idempotent.
ALTER TABLE product_type
    ADD COLUMN IF NOT EXISTS product_type_description varchar(100) NOT NULL DEFAULT '';
