-- 0021_track_otp_provider — the /track OTP is sent and checked by ThaiBulkSMS's OTP service.
--
-- ThaiBulkSMS makes the code, sends the SMS and answers a `token`; checking a code sends that token
-- + the code back to them. The row keeps the token instead of a hash of the code:
--  - track_otp.provider_token: ThaiBulkSMS's token for this request (useless without the code in the
--    SMS; our 5-try cap still applies). NULL for the development `log` mode.
--  - track_otp.code_hash: only the development `log` mode makes its own code now → nullable.
-- Additive only: code from before this migration still inserts code_hash and keeps working.
-- Idempotent (the legacy tables can be reloaded and every migration re-run).

ALTER TABLE track_otp ADD COLUMN IF NOT EXISTS provider_token varchar(128);
ALTER TABLE track_otp ALTER COLUMN code_hash DROP NOT NULL;
