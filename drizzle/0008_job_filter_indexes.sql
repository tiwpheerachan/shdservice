-- 0008_job_filter_indexes — indexes for the extra filters on the job list
-- (ยี่ห้อ / รุ่น / งานย่อย / เปิดงานโดย / วันที่รับเครื่อง / warranty / งานเด้ง /
-- เลขพัสดุจากลูกค้า). Idempotent — re-created automatically after a legacy reload.
CREATE INDEX IF NOT EXISTS ix_job_brand            ON job (product_brand_id);
CREATE INDEX IF NOT EXISTS ix_job_model_name       ON job (product_model_name);
CREATE INDEX IF NOT EXISTS ix_job_type_detail      ON job (job_type_detail);
CREATE INDEX IF NOT EXISTS ix_job_create_by        ON job (job_create_by);
CREATE INDEX IF NOT EXISTS ix_job_reception_date   ON job (job_reception_date);
CREATE INDEX IF NOT EXISTS ix_job_warranty         ON job (product_warranty);
-- only ~16% of jobs are bounces: a partial index is small and exactly what the filter needs
CREATE INDEX IF NOT EXISTS ix_job_bounce           ON job (job_no) WHERE is_job_bounce = true;
-- free-text (ILIKE '%…%') on the customer's inbound tracking number
CREATE INDEX IF NOT EXISTS gin_job_reception_tracking ON job USING gin (job_reception_tracking_no gin_trgm_ops);
