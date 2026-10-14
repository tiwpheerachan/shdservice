-- 0025_track_token_hash — the customer tracking link is stored as sha256(token) only.
--
-- job.track_token (0012) held the raw bearer token: a read-only leak of the DB (backup, replica,
-- a stray SELECT) handed out every live customer link. The app now writes only the hash, looks
-- links up by it, and shows a raw token once — to the staff member who just generated it.
--
-- EXPAND step (Render runs this pre-deploy while the OLD code still serves):
--   - add track_token_hash + backfill it from the existing raw tokens → live links keep working
--   - a trigger hashes any raw token the old code still writes during the overlap
--   - track_token is NOT dropped or nulled here — the old code still reads it
--
-- FOLLOW-UP (CONTRACT) — a LATER migration, only once this deploy is live everywhere:
--   UPDATE job SET track_token = NULL WHERE track_token IS NOT NULL;
--   DROP TRIGGER IF EXISTS trg_job_track_token_hash ON job;
--   DROP FUNCTION IF EXISTS job_track_token_hash_sync();
--   DROP INDEX IF EXISTS ux_job_track_token;
--   ALTER TABLE job DROP COLUMN IF EXISTS track_token;
-- and remove `trackToken` from src/db/schema/legacy.ts + the `trackToken: null` in tracking.ts.
-- (A legacy reload re-runs 0012, which re-creates raw tokens; 0025 + the contract step clean them up again.)
-- Idempotent.

ALTER TABLE job ADD COLUMN IF NOT EXISTS track_token_hash varchar(64);

-- old code (deploy overlap) still issues raw tokens: hash them so those links survive the cutover.
-- New code writes track_token = NULL with the hash, which this leaves alone.
CREATE OR REPLACE FUNCTION job_track_token_hash_sync() RETURNS trigger AS $$
BEGIN
  IF NEW.track_token IS NOT NULL THEN
    NEW.track_token_hash := encode(sha256(convert_to(NEW.track_token, 'UTF8')), 'hex');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_job_track_token_hash ON job;
CREATE TRIGGER trg_job_track_token_hash BEFORE INSERT OR UPDATE OF track_token ON job
  FOR EACH ROW EXECUTE FUNCTION job_track_token_hash_sync();

-- backfill (same digest as src/server/track-guard.ts sha256(): sha256 of the UTF-8 token, hex)
UPDATE job
   SET track_token_hash = encode(sha256(convert_to(track_token, 'UTF8')), 'hex')
 WHERE track_token IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_job_track_token_hash ON job (track_token_hash) WHERE track_token_hash IS NOT NULL;
