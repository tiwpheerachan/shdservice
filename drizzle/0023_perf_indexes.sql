-- 0023_perf_indexes — indexes for three lookups that still scanned their whole table:
--  - job_call_log (job_no): the call log of one job (listCallLogs, job detail page)
--  - job (product_model_id): "อาการที่พบบ่อยของรุ่นนี้" joins model → job by id (modelSymptoms)
--  - job_order_spare_part_log (job_no) WHERE order_status_id = 1: jobs with parts still
--    waiting to be issued (jobsWithPendingParts, stock pick dropdown) — partial, so it stays
--    as small as the open requests instead of the whole history
-- Idempotent (the legacy tables can be reloaded and every migration re-run).

CREATE INDEX IF NOT EXISTS ix_job_call_log_job_no ON job_call_log (job_no);
CREATE INDEX IF NOT EXISTS ix_job_product_model   ON job (product_model_id);
CREATE INDEX IF NOT EXISTS ix_spare_part_log_pending ON job_order_spare_part_log (job_no) WHERE order_status_id = 1;
