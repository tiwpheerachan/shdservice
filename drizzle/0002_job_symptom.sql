-- 0002_job_symptom — a job can have several standard symptoms in the new UI,
-- while the legacy job.product_symptom_id holds exactly one. We keep writing
-- the FIRST symptom there (legacy reports still work) and store the full set
-- here. Idempotent.
CREATE TABLE IF NOT EXISTS job_symptom (
    job_no      varchar(50) NOT NULL,
    symptom_id  integer     NOT NULL,
    PRIMARY KEY (job_no, symptom_id)
);
CREATE INDEX IF NOT EXISTS ix_job_symptom_symptom ON job_symptom (symptom_id);
ALTER TABLE job_symptom ENABLE ROW LEVEL SECURITY;
