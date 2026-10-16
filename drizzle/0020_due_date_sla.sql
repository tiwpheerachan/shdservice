-- 0020_due_date_sla — a real "due date" for every job (ISSUE-013).
--
-- The legacy system fills job.customer_due_date with "opened + 1 day" on EVERY job (not an
-- estimate: real repairs take 3–30 days), and this app left it empty — so the overdue bell either
-- flagged every open job or never flagged a new one. From now on:
--
--   effective due date = the date a user chose in this app      (job.due_date_set_by_user)
--                      | otherwise opened + the job type's SLA  (job_type.default_due_days)
--
--  - job_type.default_due_days: target turnaround per job type, editable on admin → ประเภทงานซ่อม.
--    Starting values = the 80th percentile of the real open → repaired time over the last 12 months.
--  - job.due_date_set_by_user: true only when a user picked / changed the date here. The legacy
--    system does not know the column, so its rows keep the default (false).
-- Idempotent (the legacy tables can be reloaded and every migration re-run).

ALTER TABLE job_type ADD COLUMN IF NOT EXISTS default_due_days integer NOT NULL DEFAULT 7;
DO $$ BEGIN
  ALTER TABLE job_type ADD CONSTRAINT ck_job_type_default_due_days CHECK (default_due_days BETWEEN 1 AND 365);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- starting values, only where still at the column default (never overwrite an admin's edit)
UPDATE job_type SET default_due_days = CASE job_type_name
    WHEN 'งานซ่อม'              THEN 8
    WHEN 'งานเปลี่ยนสินค้าใหม่'     THEN 7
    WHEN 'งานส่งต่อศูนย์บริการ'     THEN 30
    WHEN 'งานส่งสินค้าเพิ่มเติม'     THEN 4
    WHEN 'งานคืนเงินลูกค้า'        THEN 18
    ELSE default_due_days END
WHERE default_due_days = 7;

ALTER TABLE job ADD COLUMN IF NOT EXISTS due_date_set_by_user boolean NOT NULL DEFAULT false;
