-- 0016_track_link_lifetime — customer tracking links (/track/<token>) live:
--   1 day from issue while nobody has opened them, then
--   15 minutes from the first customer open (staff previews do not count).
-- job.track_token_at (Thai wall-clock `timestamp`, set by the app) is the issue time;
-- track_opened_at is new and is a real instant (timestamptz).
-- Idempotent.
ALTER TABLE job ADD COLUMN IF NOT EXISTS track_opened_at timestamptz;
