import { Pool } from 'pg';
import { DATABASE_URL, E2E_ROLE, STAFF_EMAIL } from './env';

/** one row, unless a row with the first column's value exists; id = max + 1 (the other seeds insert
 * explicit ids without moving the identity sequence, so a default id could collide). SQL literals.
 * The sequence is then moved past it — or the next app insert (test:domain's saveModel) collides. */
function ensure(table: string, id: string, row: Record<string, string>): string {
  const [first] = Object.entries(row);
  if (!first) throw new Error(`ensure(${table}): empty row`);
  const [key, value] = first;
  return `INSERT INTO ${table} (${id}, ${Object.keys(row).join(', ')})
    SELECT n.id, ${Object.values(row).join(', ')} FROM (SELECT coalesce(max(${id}), 0) + 1 AS id FROM ${table}) n
    WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${key} = ${value});
    SELECT setval(pg_get_serial_sequence('${table}', '${id}'), (SELECT max(${id}) FROM ${table}));`;
}

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
      INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active) VALUES
        (0, 'ยกเลิก', 0, 'Cancel', true),
        (1, 'รับงานใหม่', 1, 'Open', true),
        (2, 'กำลังดำเนินการ', 2, 'Open', true),
        (20, 'เสร็จสมบูรณ์', 20, 'Finished', true)
      ON CONFLICT DO NOTHING;

      ${ensure('customer', 'customer_id', { customer_code: "'CE2E01'", customer_name: "'ลูกค้า E2E'", phone_number: "'081-000-9001'" })}
      ${ensure('job_type', 'job_type_id', { job_type_name: "'E2E ซ่อม'", is_active: 'true' })}
      ${ensure('manufacturer', 'manufacturer_id', { manufacturer_name: "'E2E Brand'", is_active: 'true' })}
      ${ensure('model', 'model_id', {
        model_code: "'E2E-M1'",
        model_name: "'E2E Model 1'",
        manufacturer_id: "(SELECT manufacturer_id FROM manufacturer WHERE manufacturer_name = 'E2E Brand')",
        is_active: 'true',
      })}
      ${ensure('symptom', 'symptom_id', { symptom_name: "'E2E เปิดไม่ติด'", is_active: 'true' })}

      -- the non-admin role: Job Management view only — no Customer
      DELETE FROM app_config WHERE user_type = '${E2E_ROLE}';
      INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
        ('${E2E_ROLE}', 'Job Management', false, false, false, true);

      -- every e2e person starts over: the owner and strangers are provisioned by their first sign-in
      DELETE FROM app_user WHERE email_address LIKE '%@e2e.test';
      INSERT INTO app_user (username, password, first_name, user_type, is_active, email_address, record_status)
        VALUES ('e2e-staff', '', 'E2E Staff', '${E2E_ROLE}', true, '${STAFF_EMAIL}', 'ACTIVE');
    `);
  } finally {
    await pool.end();
  }
}
