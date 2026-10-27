-- 0039_app_user_tour — the step-by-step tutorials (บทสอน, src/components/tour) each user has been offered.
--
-- One row per user who has been asked: `seen` = the page paths whose "ดูวิธีใช้หน้านี้ไหม?" was answered
-- (started, "ไม่ใช่ตอนนี้" or closed), `off` = "ไม่ต้องถามอีก" for every page. A table of its own, not columns
-- on app_user: a tour answer is never an edit of the user (the admin's users page compares app_user rows).
-- RLS on with no policy, like the app's other tables: only the app role reads / writes it. Idempotent.

CREATE TABLE IF NOT EXISTS app_user_tour (
  user_id    integer     PRIMARY KEY REFERENCES app_user (user_id) ON DELETE CASCADE,
  seen       text[]      NOT NULL DEFAULT '{}',
  off        boolean     NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_user_tour ENABLE ROW LEVEL SECURITY;
