-- 0033_clear_raw_track_token — CONTRACT step of 0025: no raw customer tracking token stays in the database.
--
-- 0025 (expand) moved link lookups to job.track_token_hash and stopped writing job.track_token, but kept
-- the raw values for the deploy overlap. That deploy has long been live, yet prod on 2026-10-19 still held
-- 48,620 raw tokens — each a working customer link for anyone who can read the DB or a backup.
-- Live links keep working: they are looked up by the hash, which 0025 backfilled (checked: every
-- sha256(track_token) = track_token_hash).
--
-- The column itself stays for now (src/db/schema/legacy.ts still declares it; dropping it needs the schema
-- line removed in the same deploy). The 0025 trigger stays too: it is harmless with nothing writing raw tokens.
-- A legacy reload re-runs 0012 (raw tokens again) and 0025 (hashes them); this runs after both and empties
-- them again. Idempotent.

UPDATE job SET track_token = NULL WHERE track_token IS NOT NULL;
