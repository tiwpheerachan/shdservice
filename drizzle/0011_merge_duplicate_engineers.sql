-- 0011_merge_duplicate_engineers — technicians with two accounts, the legacy one and the SSO one (owner confirmed each
-- pair). Report filters read job.engineer_app_user_pk, so one person's work split across two names. Every job moves,
-- old ones too. Only the job's engineer changes: repaired_by, status logs, parts and stock keep the account that really
-- acted; no money, status or date column is written. row_version bumps through its trigger, so a tab open on one of
-- these jobs gets the usual 409. A no-op where an account is missing or its username is not unique, and on a second run.
WITH pairs (old_username, new_username) AS (
  VALUES
    ('Klam250338', 'kham.tawatchai'),
    ('ponpat1978', 'nat.ponpat'),
    ('tonton', 'ton.mongkolchai'),
    ('Poppop', 'pop.nattagan'),
    ('Ying', 'ying.thanyakarn')
), accounts AS (
  SELECT o.pk AS old_pk, t.pk AS new_pk,
    concat_ws(' ', nullif(trim(o.first_name), ''), nullif(trim(o.last_name), '')) AS old_name,
    concat_ws(' ', nullif(trim(t.first_name), ''), nullif(trim(t.last_name), '')) AS new_name
  FROM pairs p
  JOIN app_user o ON o.username = p.old_username
  JOIN app_user t ON t.username = p.new_username
  WHERE (SELECT count(*) FROM app_user x WHERE x.username = p.old_username) = 1
    AND (SELECT count(*) FROM app_user x WHERE x.username = p.new_username) = 1
), moved AS (
  UPDATE job SET engineer_app_user_pk = a.new_pk
  FROM accounts a
  WHERE job.engineer_app_user_pk = a.old_pk
  RETURNING job.id, job.job_no, a.old_name, a.new_name
)
INSERT INTO audit_log (action, module, entity, entity_key, entity_id, entity_no, summary, reason, changes, actor_name, at)
SELECT 'ASSIGN', 'Job Repair', 'job', job_no, id, job_no, 'ย้ายงานจากบัญชีซ้ำ: ' || old_name || ' → ' || new_name,
  'รวมบัญชีช่างที่ซ้ำกัน (migration 0011)', jsonb_build_object('engineerId', jsonb_build_array(old_name, new_name)),
  'migration 0011', now() AT TIME ZONE 'Asia/Bangkok'
FROM moved;
