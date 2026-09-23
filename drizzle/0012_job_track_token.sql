-- 0012_job_track_token — public tracking link for customers (/t/<token>).
-- One token per job, generated for every job; the PAGE is only reachable once the
-- job has a quotation (that rule lives in the service, not here, so it can change
-- without a migration). Tokens expire 90 days after the job is closed.
-- Idempotent — re-run safe, and re-creates tokens after a legacy reload.
ALTER TABLE job ADD COLUMN IF NOT EXISTS track_token    varchar(43);
ALTER TABLE job ADD COLUMN IF NOT EXISTS track_token_at timestamp;

CREATE UNIQUE INDEX IF NOT EXISTS ux_job_track_token ON job (track_token) WHERE track_token IS NOT NULL;

-- backfill: 32 random bytes → base64url (43 chars, no padding), one per job
UPDATE job
   SET track_token = translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_'),
       track_token_at = now()
 WHERE track_token IS NULL;
