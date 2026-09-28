-- 0019_track_doc_ticket — customer document downloads on /track (ใบรับงานซ่อม / ใบเสนอราคา / ใบส่งคืนสินค้า).
--
--   job on screen (phone + OTP session, or a live /track/<token> link)
--     → POST /api/track/doc { kind, ref } → one-time ticket → /track/doc/<ticket> (print view)
--
-- Rules the code relies on:
--  - the ticket is 32 random bytes; only sha256(ticket) is stored
--  - it opens ONE document (job + kind + ref fixed by the server), once, within 60 seconds,
--    from the IP + browser it was issued to — consumed by one atomic DELETE … RETURNING
-- RLS on, no policies: only the app (postgres, BYPASSRLS) can touch it. Idempotent.

CREATE TABLE IF NOT EXISTS track_doc_ticket (
    token_hash  bytea        PRIMARY KEY,           -- sha256(raw ticket)
    job_no      varchar(50)  NOT NULL,
    kind        varchar(16)  NOT NULL,              -- job | quotation | return
    ref         varchar(50)  NOT NULL,              -- job no, or the quotation no
    issued_ip   inet         NOT NULL,
    ua_hash     bytea        NOT NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    expires_at  timestamptz  NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_track_doc_ticket_expires ON track_doc_ticket (expires_at);

ALTER TABLE track_doc_ticket ENABLE ROW LEVEL SECURITY;
