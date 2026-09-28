-- 0018_track_link_keepalive — /track/<token> gets the same "extend while in use" rule as the
-- phone + OTP session: the first customer open gives 15 minutes; while the page is in use
-- the expiry is kept ≥ 5 minutes ahead, never past 60 minutes from that first open.
-- track_link_expires_at is set on the first open and moved only by the keepalive.
-- Idempotent.
ALTER TABLE job ADD COLUMN IF NOT EXISTS track_link_expires_at timestamptz;
UPDATE job SET track_link_expires_at = track_opened_at + interval '15 minutes'
 WHERE track_opened_at IS NOT NULL AND track_link_expires_at IS NULL;
