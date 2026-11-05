-- 0009_job_engineer_symptom — อาการเสียที่ตรวจพบ may be several: job.engineer_symptom_pk stays the first, this table holds
-- the others (a separate table: every job_symptom row is read as a symptom the customer reported). Additive and no
-- backfill: no existing row is touched, and code that knows only the column keeps working beside it. Idempotent.
CREATE TABLE IF NOT EXISTS job_engineer_symptom (
  pk bigint GENERATED ALWAYS AS IDENTITY,
  id uuid NOT NULL DEFAULT uuid_generate_v7(),
  job_pk bigint NOT NULL,
  symptom_pk bigint NOT NULL,
  CONSTRAINT job_engineer_symptom_pkey PRIMARY KEY (pk),
  CONSTRAINT fk_job_engineer_symptom_job_pk FOREIGN KEY (job_pk) REFERENCES job (pk) ON DELETE RESTRICT,
  CONSTRAINT fk_job_engineer_symptom_symptom_pk FOREIGN KEY (symptom_pk) REFERENCES symptom (pk) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ux_job_engineer_symptom_id ON job_engineer_symptom (id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ux_job_engineer_symptom_job_pk_symptom_pk ON job_engineer_symptom (job_pk, symptom_pk);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_job_engineer_symptom_symptom ON job_engineer_symptom (symptom_pk);
--> statement-breakpoint
ALTER TABLE job_engineer_symptom ENABLE ROW LEVEL SECURITY;
