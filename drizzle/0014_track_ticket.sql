-- 0014_track_ticket — secure public tracking (/track): one-time tickets, DB-backed
-- rate limits, abuse blocks and a 30-day security event log.
--
--   linkToken (job.track_token) → Turnstile → one-time ticket → PublicJob
--
-- Rules the code relies on:
--  - track_ticket never holds a raw ticket: token_hash = sha256(ticket)
--  - a ticket is consumed by ONE atomic DELETE … RETURNING (no select-then-delete)
--  - these tables are new, so they use timestamptz (the legacy tables keep their
--    Thai wall-clock `timestamp` convention; nothing here is compared with them)
-- Idempotent.

CREATE TABLE IF NOT EXISTS track_ticket (
    token_hash  bytea        PRIMARY KEY,           -- sha256(raw ticket)
    job_no      varchar(20)  NOT NULL,
    issued_ip   inet         NOT NULL,
    ua_hash     bytea        NOT NULL,              -- sha256(normalized User-Agent)
    created_at  timestamptz  NOT NULL DEFAULT now(),
    expires_at  timestamptz  NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_track_ticket_expires ON track_ticket (expires_at);

-- fixed-window counters: one row per (bucket, key, window start); key is always a hash, never a raw token
CREATE TABLE IF NOT EXISTS track_rate (
    bucket        varchar(40)  NOT NULL,
    key           varchar(128) NOT NULL,
    window_start  timestamptz  NOT NULL,
    hits          integer      NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, key, window_start)
);
CREATE INDEX IF NOT EXISTS ix_track_rate_window ON track_rate (window_start);

-- temporary blocks (invalid-ticket abuse, form lockout); key is a hash
CREATE TABLE IF NOT EXISTS track_block (
    key            varchar(160) PRIMARY KEY,
    blocked_until  timestamptz  NOT NULL
);

-- security events, kept 30 days; ip / link are HMACs, never raw values
CREATE TABLE IF NOT EXISTS track_event (
    id          bigserial    PRIMARY KEY,
    at          timestamptz  NOT NULL DEFAULT now(),
    event       varchar(40)  NOT NULL,
    result      varchar(20)  NOT NULL DEFAULT '',
    ip_hash     varchar(64),
    link_hash   varchar(64),
    job_no      varchar(20),
    request_id  varchar(40)
);
CREATE INDEX IF NOT EXISTS ix_track_event_at ON track_event (at);
