-- 0015_move_history_to_active_accounts — the history still on a person's legacy account moves to their SSO account, so
-- reports show one name. Only pairs whose SSO account is active. Only who-columns change: no money, quantity, status
-- or date; row_version rises where a table has that trigger.
-- account_move_log keeps every row's old account, so it can be moved back. A no-op on a second run.
SET LOCAL statement_timeout = 0;
--> statement-breakpoint
DO $$
DECLARE
  fk record;
BEGIN
  CREATE TEMP TABLE m0015_pair ON COMMIT DROP AS
  SELECT o.pk AS old_pk, t.pk AS new_pk
  FROM (VALUES
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
  ) AS p (old_username, new_username)
  JOIN app_user o ON o.username = p.old_username
  JOIN app_user t ON t.username = p.new_username
  WHERE (SELECT count(*) FROM app_user x WHERE x.username = p.old_username) = 1
    AND (SELECT count(*) FROM app_user x WHERE x.username = p.new_username) = 1
    AND t.record_status = 'ACTIVE';

  CREATE TEMP TABLE m0015_moved (old_pk bigint, new_pk bigint, n bigint) ON COMMIT DROP;

  -- every foreign key to app_user, so no who-column is missed. Left out: audit_log and security_log record who really
  -- acted and are append-only; account_move_log is the undo record; app_back_up_db_log is a log of its own;
  -- app_user_tour and idempotency_key are unique per account, so a move could collide.
  FOR fk IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname::text AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = 'app_user'::regclass AND array_length(c.conkey, 1) = 1
      AND c.conrelid::regclass::text NOT IN ('audit_log', 'security_log', 'account_move_log', 'app_back_up_db_log', 'app_user_tour', 'idempotency_key')
    ORDER BY 1, 2
  LOOP
    -- a plain INSERT, no ON CONFLICT: a row already in the log must stop the run, not lose its original owner
    EXECUTE format(
      'WITH moved AS (UPDATE %1$s r SET %2$I = p.new_pk FROM m0015_pair p WHERE r.%2$I = p.old_pk RETURNING r.pk, p.old_pk, p.new_pk), '
      || 'logged AS (INSERT INTO account_move_log (table_name, column_name, row_ref, old_app_user_pk, new_app_user_pk) '
      || 'SELECT %3$L, %4$L, pk, old_pk, new_pk FROM moved RETURNING old_app_user_pk, new_app_user_pk) '
      || 'INSERT INTO m0015_moved SELECT old_app_user_pk, new_app_user_pk, count(*) FROM logged GROUP BY 1, 2',
      fk.tbl, fk.col, fk.tbl, fk.col
    );
  END LOOP;

  INSERT INTO audit_log (action, module, entity, entity_key, summary, reason, changes, actor_name, at)
  SELECT 'MOVE', 'User Management', 'app_user', o.username, 'ย้ายประวัติไปบัญชีใหม่: ' || o.username || ' → ' || t.username || ' · ' || sum(m.n) || ' จุด',
    'รวมบัญชีที่ซ้ำกัน (migration 0015) — รายละเอียดอยู่ใน account_move_log', jsonb_build_object('rows', sum(m.n)), 'migration 0015', now() AT TIME ZONE 'Asia/Bangkok'
  FROM m0015_moved m JOIN app_user o ON o.pk = m.old_pk JOIN app_user t ON t.pk = m.new_pk
  GROUP BY o.username, t.username;
END $$;
