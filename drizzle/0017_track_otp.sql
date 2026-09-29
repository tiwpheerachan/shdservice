-- 0017_track_otp — /track lookup by phone number + SMS OTP (replaces "job no. + last 4 digits").
--
--   phone → (captcha) → OTP by SMS → customer session → that customer's jobs
--
-- Rules the code relies on:
--  - no raw phone number, OTP code or session token is stored: phone → HMAC, code → HMAC
--    bound to its request, token → sha256
--  - an OTP is consumed by ONE atomic UPDATE … RETURNING (5 wrong tries burn it)
--  - a session lives 15 min, activity keeps ≥ 5 min left, never past 60 min from sign-in;
--    the token lives only in the page's memory (leaving the page = a new OTP)
-- RLS on, no policies: only the app (postgres, BYPASSRLS) can touch them. Idempotent.

CREATE TABLE IF NOT EXISTS track_otp (
    request_hash  bytea        PRIMARY KEY,           -- sha256(opaque request id held by the page)
    phone_hash    varchar(64)  NOT NULL,              -- HMAC of the normalized phone
    customer_ids  integer[]    NOT NULL,              -- customers with that phone, resolved at request
    code_hash     bytea        NOT NULL,              -- HMAC(request id + code)
    attempts      integer      NOT NULL DEFAULT 0,
    issued_ip     inet         NOT NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    expires_at    timestamptz  NOT NULL,
    consumed_at   timestamptz
);
CREATE INDEX IF NOT EXISTS ix_track_otp_expires ON track_otp (expires_at);
CREATE INDEX IF NOT EXISTS ix_track_otp_phone ON track_otp (phone_hash);

CREATE TABLE IF NOT EXISTS track_session (
    token_hash    bytea        PRIMARY KEY,           -- sha256(raw session token)
    customer_ids  integer[]    NOT NULL,
    phone_hash    varchar(64)  NOT NULL,
    issued_ip     inet         NOT NULL,
    ua_hash       bytea        NOT NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    expires_at    timestamptz  NOT NULL,
    max_expires_at timestamptz NOT NULL               -- created_at + 60 min, never extended
);
CREATE INDEX IF NOT EXISTS ix_track_session_expires ON track_session (expires_at);

ALTER TABLE track_otp     ENABLE ROW LEVEL SECURITY;
ALTER TABLE track_session ENABLE ROW LEVEL SECURITY;
