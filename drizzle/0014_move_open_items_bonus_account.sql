-- 0014_move_open_items_bonus_account — the pair 0013 skipped because its SSO account was restored but not yet active.
-- Same rule as 0013: open rows only, who-columns only, each old value kept in account_move_log. A no-op where an
-- account is missing, its username is not unique or the SSO account is not active, and on a second run.
WITH accounts AS (
  SELECT o.pk AS old_pk, t.pk AS new_pk
  FROM app_user o
  JOIN app_user t ON t.username = 'bonut.nuttaphong'
  WHERE o.username = 'Bonus'
    AND t.record_status = 'ACTIVE'
    AND (SELECT count(*) FROM app_user x WHERE x.username = 'Bonus') = 1
    AND (SELECT count(*) FROM app_user x WHERE x.username = 'bonut.nuttaphong') = 1
), open_job AS (
  SELECT pk FROM job WHERE job_closed_date <= '1901-01-01' AND record_status = 'ACTIVE'
), targets AS (
  SELECT 'job_part' AS t, 'requested_by_app_user_pk' AS c, r.pk AS row_ref, a.old_pk, a.new_pk
    FROM job_part r JOIN accounts a ON a.old_pk = r.requested_by_app_user_pk
   WHERE r.job_part_status_id IN (1, 2) AND r.job_pk IN (SELECT pk FROM open_job)
  UNION ALL
  SELECT 'job_outsource', 'sent_by_app_user_pk', r.pk, a.old_pk, a.new_pk
    FROM job_outsource r JOIN accounts a ON a.old_pk = r.sent_by_app_user_pk
   WHERE (r.receive_date IS NULL OR r.receive_date <= '1901-01-01') AND r.job_pk IN (SELECT pk FROM open_job)
  UNION ALL
  SELECT 'quotation', 'created_by_app_user_pk', r.pk, a.old_pk, a.new_pk
    FROM quotation r JOIN accounts a ON a.old_pk = r.created_by_app_user_pk
   WHERE r.quotation_status_id IN (1, 2) AND r.record_status <> 'DELETED'
  UNION ALL
  SELECT 'sale_order', 'created_by_app_user_pk', r.pk, a.old_pk, a.new_pk
    FROM sale_order r JOIN accounts a ON a.old_pk = r.created_by_app_user_pk
   WHERE r.approve_status_id IN (1, 2) AND r.record_status <> 'DELETED'
  UNION ALL
  SELECT 'sale_order', 'sale_out_by_app_user_pk', r.pk, a.old_pk, a.new_pk
    FROM sale_order r JOIN accounts a ON a.old_pk = r.sale_out_by_app_user_pk
   WHERE r.approve_status_id IN (1, 2) AND r.record_status <> 'DELETED'
), logged AS (
  INSERT INTO account_move_log (table_name, column_name, row_ref, old_app_user_pk, new_app_user_pk)
  SELECT t, c, row_ref, old_pk, new_pk FROM targets
  ON CONFLICT (table_name, column_name, row_ref) DO NOTHING
  RETURNING old_app_user_pk, new_app_user_pk
)
-- from logged, not the whole log: 0013's rows are not this migration's moves
INSERT INTO audit_log (action, module, entity, entity_key, summary, reason, changes, actor_name, at)
SELECT 'MOVE', 'User Management', 'app_user', o.username, 'ย้ายรายการค้างไปบัญชีใหม่: ' || o.username || ' → ' || t.username || ' · ' || count(*) || ' รายการ',
  'รวมบัญชีที่ซ้ำกัน (migration 0014) — รายละเอียดอยู่ใน account_move_log', jsonb_build_object('rows', count(*)), 'migration 0014', now() AT TIME ZONE 'Asia/Bangkok'
FROM logged l JOIN app_user o ON o.pk = l.old_app_user_pk JOIN app_user t ON t.pk = l.new_app_user_pk
GROUP BY o.username, t.username;
--> statement-breakpoint
UPDATE job_part r SET requested_by_app_user_pk = l.new_app_user_pk FROM account_move_log l
 WHERE l.table_name = 'job_part' AND l.column_name = 'requested_by_app_user_pk' AND l.row_ref = r.pk AND r.requested_by_app_user_pk = l.old_app_user_pk;
--> statement-breakpoint
UPDATE job_outsource r SET sent_by_app_user_pk = l.new_app_user_pk FROM account_move_log l
 WHERE l.table_name = 'job_outsource' AND l.column_name = 'sent_by_app_user_pk' AND l.row_ref = r.pk AND r.sent_by_app_user_pk = l.old_app_user_pk;
--> statement-breakpoint
UPDATE quotation r SET created_by_app_user_pk = l.new_app_user_pk FROM account_move_log l
 WHERE l.table_name = 'quotation' AND l.column_name = 'created_by_app_user_pk' AND l.row_ref = r.pk AND r.created_by_app_user_pk = l.old_app_user_pk;
--> statement-breakpoint
UPDATE sale_order r SET created_by_app_user_pk = l.new_app_user_pk FROM account_move_log l
 WHERE l.table_name = 'sale_order' AND l.column_name = 'created_by_app_user_pk' AND l.row_ref = r.pk AND r.created_by_app_user_pk = l.old_app_user_pk;
--> statement-breakpoint
UPDATE sale_order r SET sale_out_by_app_user_pk = l.new_app_user_pk FROM account_move_log l
 WHERE l.table_name = 'sale_order' AND l.column_name = 'sale_out_by_app_user_pk' AND l.row_ref = r.pk AND r.sale_out_by_app_user_pk = l.old_app_user_pk;
