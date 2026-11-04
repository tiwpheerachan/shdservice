-- 0013_move_open_items_to_active_accounts — what is still open under a person's legacy account moves to their SSO
-- account (owner confirmed each pair): part requests waiting on stock, outsource sends not yet back, quotations not
-- answered, sale orders not decided. Finished rows keep the account that acted. Only these who-columns change: no
-- money, quantity, status or date. account_move_log keeps every row's old account, so it can be moved back. A no-op
-- where an account is missing, its username is not unique or the SSO account is not active, and on a second run.
CREATE TABLE IF NOT EXISTS account_move_log (
  pk bigint GENERATED ALWAYS AS IDENTITY,
  id uuid NOT NULL DEFAULT uuid_generate_v7(),
  table_name text NOT NULL,
  column_name text NOT NULL,
  row_ref bigint NOT NULL,
  old_app_user_pk bigint NOT NULL,
  new_app_user_pk bigint NOT NULL,
  moved_at timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Bangkok'),
  CONSTRAINT account_move_log_pkey PRIMARY KEY (pk),
  CONSTRAINT fk_account_move_log_old_app_user_pk FOREIGN KEY (old_app_user_pk) REFERENCES app_user (pk) ON DELETE RESTRICT,
  CONSTRAINT fk_account_move_log_new_app_user_pk FOREIGN KEY (new_app_user_pk) REFERENCES app_user (pk) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ux_account_move_log_id ON account_move_log (id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ux_account_move_log_row ON account_move_log (table_name, column_name, row_ref);
--> statement-breakpoint
ALTER TABLE account_move_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
WITH pairs (old_username, new_username) AS (
  VALUES
    ('Klam250338', 'kham.tawatchai'),
    ('ponpat1978', 'nat.ponpat'),
    ('Poppop', 'pop.nattagan'),
    ('Ying', 'ying.thanyakarn'),
    ('tonton', 'ton.mongkolchai'),
    ('Nong', 'nong.supinya'),
    ('Siriporn20', 'baitoey.siriporn'),
    ('Bonus', 'bonut.nuttaphong'),
    ('Titima', 'yui.thitima'),
    ('nuy', 'nuy.lawan')
), accounts AS (
  SELECT o.pk AS old_pk, t.pk AS new_pk
  FROM pairs p
  JOIN app_user o ON o.username = p.old_username
  JOIN app_user t ON t.username = p.new_username
  WHERE (SELECT count(*) FROM app_user x WHERE x.username = p.old_username) = 1
    AND (SELECT count(*) FROM app_user x WHERE x.username = p.new_username) = 1
    AND t.record_status = 'ACTIVE'
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
)
INSERT INTO account_move_log (table_name, column_name, row_ref, old_app_user_pk, new_app_user_pk)
SELECT t, c, row_ref, old_pk, new_pk FROM targets
ON CONFLICT (table_name, column_name, row_ref) DO NOTHING;
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
--> statement-breakpoint
INSERT INTO audit_log (action, module, entity, entity_key, summary, reason, changes, actor_name, at)
SELECT 'MOVE', 'User Management', 'app_user', o.username, 'ย้ายรายการค้างไปบัญชีใหม่: ' || o.username || ' → ' || t.username || ' · ' || count(*) || ' รายการ',
  'รวมบัญชีที่ซ้ำกัน (migration 0013) — รายละเอียดอยู่ใน account_move_log', jsonb_build_object('rows', count(*)), 'migration 0013', now() AT TIME ZONE 'Asia/Bangkok'
FROM account_move_log l JOIN app_user o ON o.pk = l.old_app_user_pk JOIN app_user t ON t.pk = l.new_app_user_pk
WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.actor_name = 'migration 0013' AND a.entity_key = o.username)
GROUP BY o.username, t.username;
