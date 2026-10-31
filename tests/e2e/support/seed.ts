import { Pool } from 'pg';
import {
  CLOSER_EMAIL,
  DATABASE_URL,
  E2E_ROLE,
  ENGINEER_EMAIL,
  MANAGER_EMAIL,
  SELLER_EMAIL,
  STAFF_EMAIL,
  STOCK_EMAIL,
  E2E_SHOP,
} from './env';

/** one row, unless a row with the first column's value exists; pk = max + 1 (the other seeds insert
 * explicit pks without moving the identity sequence, so a default pk could collide). SQL literals.
 * The sequence is then moved past it — or the next app insert (test:domain's saveModel) collides. */
function ensure(table: string, row: Record<string, string>): string {
  const [first] = Object.entries(row);
  if (!first) throw new Error(`ensure(${table}): empty row`);
  const [key, value] = first;
  return `INSERT INTO ${table} (pk, ${Object.keys(row).join(', ')}) OVERRIDING SYSTEM VALUE
    SELECT n.pk, ${Object.values(row).join(', ')} FROM (SELECT coalesce(max(pk), 0) + 1 AS pk FROM ${table}) n
    WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${key} = ${value});
    SELECT setval(pg_get_serial_sequence('${table}', 'pk'), (SELECT max(pk) FROM ${table}));`;
}

/** [role, [module, can_insert, can_edit][]] — view is always granted; a special right is view only */
const MONEY_ROLES: [string, [string, boolean, boolean][]][] = [
  [
    'E2E Closer',
    [
      ['Job Management', false, false],
      ['Job Closing', false, true],
    ],
  ],
  [
    'E2E Engineer',
    [
      ['Job Management', false, false],
      ['Job Repair', false, true],
    ],
  ],
  ['E2E Stock', [['Product Pick Stock', true, false]]],
  ['E2E Seller', [['Sale Order', true, true]]],
  [
    'E2E Manager',
    [
      ['Sale Order', true, true],
      ['SO Approve', false, false],
    ],
  ],
];
const MONEY_USERS: [string, string][] = [
  [CLOSER_EMAIL, 'E2E Closer'],
  [ENGINEER_EMAIL, 'E2E Engineer'],
  [STOCK_EMAIL, 'E2E Stock'],
  [SELLER_EMAIL, 'E2E Seller'],
  [MANAGER_EMAIL, 'E2E Manager'],
];
/** the tables the seeds or the specs insert into (identity column `pk`) */
const SEQUENCES = [
  'app_user',
  'role_permission',
  'customer',
  'product',
  'product_stock',
  'job_part',
  'job_status_log',
  'sale_order_line',
] as const;
/** the year the app numbers documents by (src/server/mappers/format.ts thaiYear — Bangkok, not UTC) */
const YEAR = "extract(year FROM now() AT TIME ZONE 'Asia/Bangkok')::int";

/**
 * Playwright globalSetup: the rows the specs need, on the test database (`npm run db:test:up &&
 * npm run db:test:prepare`). Idempotent and additive — it never truncates, so it coexists with
 * `npm run test:db` (tests/seed.mts) on the same database. Master rows are found by their name/code,
 * not a fixed id: the other seeds insert explicit ids.
 * Runs after the servers start but before any test (the app reads the DB per request).
 */
export default async function seed(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1, options: '-c TimeZone=Asia/Bangkok' });
  try {
    await pool.query(`
      -- other seeds insert explicit ids without moving the identity sequences (tests/seed.mts, test-domain):
      -- move them past the rows first, so the inserts below and the app's own (job_status_log, part lines…) never collide
      ${SEQUENCES.map((t) => `SELECT setval(pg_get_serial_sequence('${t}', 'pk'), (SELECT max(pk) FROM ${t}));`).join('\n      ')}

      -- every status a flow moves a job to (job.job_status_id has a foreign key) — as scripts/test-domain.mts seeds them
      INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active) VALUES
        (0, 'ยกเลิก', 0, 'Cancel', true), (1, 'รับงานใหม่', 1, 'Open', true), (2, 'กำลังดำเนินการ', 2, 'Open', true),
        (3, 'อยู่ระหว่างการซ่อม - รออะไหล่', 35, 'Pending', true),
        (4, 'อยู่ระหว่างการซ่อม - เสนอราคาลูกค้า', 37, 'Pending', true),
        (5, 'ซ่อมเสร็จ', 5, 'Repaired', true), (6, 'ยกเลิกซ่อม (ลูกค้าไม่ตกลงซ่อม)', 6, 'Repaired', true),
        (7, 'ปิดงาน-ส่งคืนสินค้า (รอลงเลขที่พัสดุ)', 50, 'Finished', true),
        (8, 'ปิดงาน-ส่งคืนสินค้า (ลงเลขที่พัสดุแล้ว)', 51, 'Finished', true),
        (9, 'ซ่อมเสร็จ (ชำระเงินแล้ว)', 45, 'Repaired', true),
        (10, 'อยู่ระหว่างการซ่อม - เบิกจ่ายอะไหล่ครบแล้ว', 34, 'Pending', true),
        (11, 'อยู่ระหว่างการซ่อม - เริ่มเบิกอะไหล่', 33, 'Pending', true),
        (12, 'อยู่ระหว่างการซ่อม - ลูกค้าตกลงซ่อม', 38, 'Pending', true),
        (13, 'อยู่ระหว่างการซ่อม - รอเสนอราคา', 36, 'Pending', true),
        (14, 'อยู่ระหว่างการซ่อม - ส่งซ่อม Out-Source แล้ว', 14, 'Pending', true),
        (15, 'อยู่ระหว่างการซ่อม - รับคืนจาก Out-Source แล้ว', 15, 'Pending', true),
        (16, 'อยู่ระหว่างการซ่อม - พ้นกำหนดเสนอราคา', 39, 'Pending', true),
        (17, 'อยู่ระหว่างดำเนินการ - รับคืนเข้าสต๊อกแล้ว', 40, 'Pending', true),
        (18, 'อยู่ระหว่างดำเนินการ - เบิกสินค้าใหม่แล้ว', 42, 'Repaired', true),
        (19, 'อยู่ระหว่างดำเนินการ - เบิกจ่ายเงินแล้ว', 43, 'Repaired', true),
        (20, 'ปิดงาน (Complete)', 20, 'Finished', true),
        (21, 'ปิดงานซ่อม (Refund : คืนเงินลูกค้า)', 53, 'Finished', false),
        (22, 'ซ่อมเสร็จ (ไม่พบอาการเสีย ขอส่งคืน)', 46, 'Repaired', true),
        (23, 'ปิดงานซ่อม (Out-Source)', 54, 'Finished', false),
        (24, 'ปิดงาน-รอลูกค้ามารับที่ศูนย์บริการ', 24, 'Finished', true)
      ON CONFLICT DO NOTHING;
      -- stock movements point at these (foreign keys, drizzle/0031): src/lib/status-ids.ts INV / STORE_LOCATION_ID
      INSERT INTO stock_move_type (stock_move_type_id, stock_move_type_name, movement_action_type, movement_action, is_active)
        SELECT * FROM (VALUES (1, 'รับเข้า', 'รับเข้า', 1, true), (2, 'รับคืนจากการเบิก', 'รับเข้า', 1, true),
                              (3, 'จ่ายออกตามงานซ่อม', 'จ่ายออก', -1, true), (4, 'จ่ายออกตามใบสั่งขาย', 'จ่ายออก', -1, true),
                              (5, 'จ่ายออกอื่นๆ', 'จ่ายออก', -1, true)) v(id, name, kind, act, on_)
         WHERE NOT EXISTS (SELECT 1 FROM stock_move_type t WHERE t.stock_move_type_id = v.id);
      INSERT INTO store_location (store_location_id, store_location_name, is_active)
        SELECT * FROM (VALUES (1, 'คลังสินค้าดี', true), (2, 'คลังสินค้าเสีย', true)) v(id, name, on_)
         WHERE NOT EXISTS (SELECT 1 FROM store_location s WHERE s.store_location_id = v.id);
      -- quotation.quotation_status_id has a foreign key (drizzle/0006): the statuses a tour's quotation is in
      INSERT INTO quotation_status (quotation_status_id, quotation_status_name)
        SELECT * FROM (VALUES (1, 'รอเสนอราคา'), (2, 'เสนอราคาแล้ว'), (3, 'ลูกค้าตกลงซ่อม'), (4, 'ลูกค้าไม่ตกลงซ่อม'),
                              (5, 'ยกเลิกใบเสนอราคา')) v(id, name)
         WHERE NOT EXISTS (SELECT 1 FROM quotation_status s WHERE s.quotation_status_id = v.id);
      -- and a part line's (job_part.job_part_status_id): src/lib/status-ids.ts
      INSERT INTO job_part_status (job_part_status_id, job_part_status_name)
        SELECT * FROM (VALUES (1, 'เบิก'), (2, 'ขอคืน'), (3, 'จ่ายแล้ว'), (4, 'ยกเลิก'), (5, 'คืนแล้ว')) v(id, name)
         WHERE NOT EXISTS (SELECT 1 FROM job_part_status s WHERE s.job_part_status_id = v.id);
      -- a sale order's status badge reads its name from here (src/lib/status-ids.ts AS)
      INSERT INTO approve_status (approve_status_id, approve_name_th, approve_name_en, is_can_edit, is_can_revise)
        SELECT * FROM (VALUES (1, 'กำลังดำเนินการจัดทำ', 'In Progess', true, true), (2, 'รออนุมัติ', 'Wait Approve', true, true),
                              (3, 'แก้ไขข้อมูล', 'Reject', true, true), (4, 'อนุมัติแล้ว', 'Approved', false, false),
                              (5, 'ปฏิเสธ', 'Deny', false, false)) v(id, th, en, ed, rv)
         WHERE NOT EXISTS (SELECT 1 FROM approve_status s WHERE s.approve_status_id = v.id);
      -- every stock / sale line's condition_id (src/lib/status-ids.ts CONDITION_ID) has a foreign key (drizzle/0006)
      INSERT INTO condition (condition_id, condition_name, is_active)
        SELECT 1, 'สินค้าดี', true WHERE NOT EXISTS (SELECT 1 FROM condition WHERE condition_id = 1);

      ${ensure('customer', { customer_code: "'CE2E01'", customer_name: "'ลูกค้า E2E'", phone_number: "'081-000-9001'" })}
      ${ensure('job_type', { job_type_name: "'E2E ซ่อม'", record_status: "'ACTIVE'" })}
      ${ensure('brand', { brand_name: "'E2E Brand'", record_status: "'ACTIVE'" })}
      ${ensure('model', {
        model_code: "'E2E-M1'",
        model_name: "'E2E Model 1'",
        brand_pk: "(SELECT pk FROM brand WHERE brand_name = 'E2E Brand')",
        record_status: "'ACTIVE'",
      })}
      -- a shop name typed on an earlier job, there before the server first reads the names (it keeps them 5 min)
      INSERT INTO job (job_no, job_status_id, customer_pk, customer_detail, model_pk, product_model_name, product_serial,
                       product_sale_out_shop_name, job_create_date, job_reception_date, job_closed_date, job_repaired_date)
        SELECT 'E2ESHOP1', 9, c.pk, c.customer_code || ' ' || c.customer_name,
               (SELECT pk FROM model WHERE model_code = 'E2E-M1'), 'E2E Model 1', 'SN-E2ESHOP1',
               '${E2E_SHOP}', now(), current_date, '1900-01-01', now()
          FROM customer c WHERE c.customer_code = 'CE2E01'
        ON CONFLICT (job_no) DO NOTHING;
      ${ensure('symptom', { symptom_name: "'E2E เปิดไม่ติด'", record_status: "'ACTIVE'" })}

      -- the non-admin role: Job Management view only — no Customer
      DELETE FROM role_permission WHERE user_type = '${E2E_ROLE}';
      INSERT INTO role_permission (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
        ('${E2E_ROLE}', 'Job Management', false, false, false, true);

      -- the money flows (close / repair / stock / sale order): one role per desk, only what its screen needs
      DELETE FROM role_permission WHERE user_type IN (${MONEY_ROLES.map(([r]) => `'${r}'`).join(', ')});
      INSERT INTO role_permission (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
        ${MONEY_ROLES.flatMap(([role, grants]) =>
          grants.map(([module, add, edit]) => `('${role}', '${module}', ${add}, ${edit}, false, true)`),
        ).join(',\n        ')};

      -- every e2e person starts over: the owner and strangers are provisioned by their first sign-in. A row that jobs /
      -- logs / audit_log point at (RESTRICT, drizzle/0006) cannot go: it is retired under another e-mail, login and name
      DELETE FROM app_user_tour WHERE app_user_pk IN (SELECT pk FROM app_user WHERE email_address LIKE '%@e2e.test');
      DO $$ DECLARE u bigint; BEGIN
        FOR u IN SELECT pk FROM app_user WHERE email_address LIKE '%@e2e.test' LOOP
          BEGIN
            DELETE FROM app_user WHERE pk = u;
          EXCEPTION WHEN foreign_key_violation THEN
            UPDATE app_user SET email_address = 'gone' || pk || '.' || email_address || '.invalid',
                   username = left('gone' || pk || '.' || username, 50), first_name = 'gone ' || first_name,
                   record_status = 'INACTIVE'
             WHERE pk = u;
          END;
        END LOOP;
      END $$;
      INSERT INTO app_user (username, first_name, user_type, email_address, record_status) VALUES
        ('e2e-staff', 'E2E Staff', '${E2E_ROLE}', '${STAFF_EMAIL}', 'ACTIVE'),
        ${MONEY_USERS.map(([email, role]) => `('${email.split('@')[0]}', '${role}', '${role}', '${email}', 'ACTIVE')`).join(',\n        ')};

      -- document numbers: test:running-no restarts series and earlier runs left WHI / WHO / SO rows behind —
      -- this year's row exists and starts past the highest number already used (unique stock_move_no / SO no)
      INSERT INTO running_no (running_type, company_id, branch_id, prefix, pyear, pmonth, pday, number, length_year, length_month, length_number)
        SELECT v.t, v.c, 0, v.p, ${YEAR}, 0, 0, 0, 2, 0, 5
          FROM (VALUES ('Inventory-In', 0, 'WHI'), ('Inventory-Out', 0, 'WHO'), ('SaleOrder', 1, 'SO')) v(t, c, p)
         WHERE NOT EXISTS (SELECT 1 FROM running_no r WHERE r.running_type = v.t AND r.pyear = ${YEAR});
      UPDATE running_no r SET number = greatest(r.number, coalesce((
        SELECT max(substring(d.no FROM length(r.prefix) + 3)::int)
          FROM (SELECT stock_move_no AS no FROM stock_move UNION ALL SELECT sale_order_no FROM sale_order) d
         WHERE d.no ~ ('^' || r.prefix || right(r.pyear::text, 2) || '[0-9]+$')), 0))
       WHERE r.running_type IN ('Inventory-In', 'Inventory-Out', 'SaleOrder') AND r.length_year = 2 AND r.pyear = ${YEAR};
    `);
  } finally {
    await pool.end();
  }
}
