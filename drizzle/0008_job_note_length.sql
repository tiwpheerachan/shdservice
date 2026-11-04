-- 0008_job_note_length — อาการเสีย (อื่นๆ) / วิธีการซ่อม / หมายเหตุช่าง: varchar(200) → varchar(2000), JOB_NOTE_MAX in
-- src/lib/validation/job.ts. Raising a varchar's length changes the catalog only: no table rewrite, no value touched.
-- Idempotent: the same type again changes nothing.
ALTER TABLE job
  ALTER COLUMN product_symptom_other TYPE varchar(2000),
  ALTER COLUMN engineer_repair_detail TYPE varchar(2000),
  ALTER COLUMN engineer_remark TYPE varchar(2000);
