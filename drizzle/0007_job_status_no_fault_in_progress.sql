-- 0007_job_status_no_fault_in_progress — job_status 25 "อยู่ระหว่างดำเนินการ - ไม่พบอาการเสีย": an in-progress status
-- (Pending, listed after 19) offered on the Swap / Refund page. The legacy dump has no such row, so a reload (db-wipe +
-- every migration again) gets it back here. Idempotent: added only while no row has id 25.
INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
SELECT 25, 'อยู่ระหว่างดำเนินการ - ไม่พบอาการเสีย', 43, 'Pending', true
WHERE NOT EXISTS (SELECT 1 FROM job_status WHERE job_status_id = 25);
