/**
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-fixes-c.mts
 * QA findings 2026-10-29 (reports, sale orders, audit, /track documents, ops): the close-job KPIs count what the table
 * shows (net payments, the dashboard's TAT), a denied sale order's audit line is no APPROVE, the unpaged product list
 * needs a product right and keeps to its limit, the /track customer copy carries no staff notes, merge_legacy_users()
 * is its owner's alone. (The return note's courier line is a server component importing client parts — not rendered
 * here: return-note.tsx reads it from getShippingProfile(return.shipperId).) Its own fixtures (ids 996x, codes QFC*, users qfc-*).
 */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.SESSION_SECRET = 'unit-test-session-secret-0123456789abcdef';

const { pool } = await import('@/db/client');
const { signSession, SESSION_COOKIE } = await import('@/lib/session');
const { jobReportSummary } = await import('@/server/services/reports');
const { approveSaleOrder } = await import('@/server/services/sale-orders');
const { getJob } = await import('@/server/services/jobs');
const { jobForCustomer, quotationForCustomer } = await import('@/server/services/tracking');
const dataRoute = await import('@/app/api/data/[resource]/route');
type QuotationDetail = import('@/server/services/quotations').QuotationDetail;

const U = {
  admin: { id: 9961, email: 'qfc-admin@example.invalid', type: 'System Admin' },
  seller: { id: 9962, email: 'qfc-seller@example.invalid', type: 'QFC Seller' },
  manager: { id: 9963, email: 'qfc-manager@example.invalid', type: 'QFC Manager' }, // no product / stock right
  stock: { id: 9964, email: 'qfc-stock@example.invalid', type: 'QFC Stock' }, // Product Onhand view
} as const;
const SV = 3;
const SO = 'QFCSO0001';
await pool.query(`
  INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
    SELECT 8, 'ปิดงาน', 8, 'Finished', true WHERE NOT EXISTS (SELECT 1 FROM job_status WHERE job_status_id = 8);
  DELETE FROM role_permission WHERE user_type IN ('QFC Seller', 'QFC Manager', 'QFC Stock');
  INSERT INTO role_permission (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
    ('QFC Seller', 'Sale Order', true, true, false, true),
    ('QFC Manager', 'Job Management', false, false, false, true),
    ('QFC Stock', 'Product Onhand', false, false, false, true);
  INSERT INTO approve_status (approve_status_id, approve_name_th)
    SELECT * FROM (VALUES (2, 'รออนุมัติ'), (3, 'แก้ไขข้อมูล'), (4, 'อนุมัติแล้ว'), (5, 'ปฏิเสธ')) v(id, name)
     WHERE NOT EXISTS (SELECT 1 FROM approve_status s WHERE s.approve_status_id = v.id);
  -- the users stay (audit_log, append-only, points at them): reset in place
  INSERT INTO app_user (pk, first_name, last_name, email_address, user_type, record_status, session_version)
  OVERRIDING SYSTEM VALUE VALUES
    ${Object.values(U)
      .map((u) => `(${u.id}, 'QFC', '${u.email.split('@')[0]}', '${u.email}', '${u.type}', 'ACTIVE', ${SV})`)
      .join(', ')}
  ON CONFLICT (pk) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
    email_address = excluded.email_address, user_type = excluded.user_type, record_status = excluded.record_status,
    session_version = excluded.session_version, last_login = DEFAULT;
  DELETE FROM job WHERE job_no LIKE 'QFCJ%';
  DELETE FROM shipping_profile WHERE pk = 9961 OR code = 'QFC';
  INSERT INTO shipping_profile (pk, code, name_th) OVERRIDING SYSTEM VALUE VALUES (9961, 'QFC', 'ขนส่ง QFC');
  -- A: opened 09-01, closed 09-20, returned 10-10 → TAT 39 (the close alone says 19); paid 500
  -- B: opened 10-01, closed 10-05, not returned → TAT 4; the deposit given back: -200
  INSERT INTO model (model_code, model_name, record_status)
    SELECT 'TST-M', 'Test model', 'ACTIVE' WHERE NOT EXISTS (SELECT 1 FROM model WHERE model_code = 'TST-M');
  INSERT INTO job (job_no, job_status_id, record_status, model_pk, job_create_date, job_closed_date, job_return_date,
                   job_payment_amount, job_payment_detail, return_customer_detail, return_customer_tracking_no, return_shipping_profile_pk)
    VALUES ('QFCJ0001', 8, 'ACTIVE', (SELECT pk FROM model WHERE model_code = 'TST-M'), '2026-09-01 10:00', '2026-09-20 10:00', '2026-10-10 10:00',
            500, 'ชำระ 2026-09-20 · โอนเข้าบัญชีส่วนตัวพนักงาน', 'ขนส่ง QFC · ลูกค้าโทรตามบ่อย', 'QFC123456TH', 9961),
           ('QFCJ0002', 8, 'ACTIVE', (SELECT pk FROM model WHERE model_code = 'TST-M'), '2026-10-01 10:00', '2026-10-05 10:00', '1900-01-01',
            -200, 'คืนมัดจำ 2026-10-05', '', '', null);
  DELETE FROM sale_order_line WHERE sale_order_pk IN (SELECT pk FROM sale_order WHERE sale_order_no LIKE 'QFCSO%');
  DELETE FROM sale_order WHERE sale_order_no LIKE 'QFCSO%';
  INSERT INTO sale_order (sale_order_no, approve_status_id, record_status, created_by_app_user_pk, sale_out_by_app_user_pk, customer_name)
    VALUES ('${SO}', 2, 'ACTIVE', ${U.seller.id}, ${U.seller.id}, 'ลูกค้า QFC');
  DELETE FROM product_stock WHERE product_pk IN (SELECT pk FROM product WHERE pk BETWEEN 9961 AND 9963 OR product_code LIKE 'QFCP%');
  DELETE FROM product WHERE pk BETWEEN 9961 AND 9963 OR product_code LIKE 'QFCP%';
  INSERT INTO product (pk, product_code, product_name) OVERRIDING SYSTEM VALUE VALUES
    (9961, 'QFCP1', 'อะไหล่ QFC 1'), (9962, 'QFCP2', 'อะไหล่ QFC 2'), (9963, 'QFCP3', 'อะไหล่ QFC 3');
  INSERT INTO product_stock (pk, product_pk, quantity_available, quantity_used, quantity_booking, quantity_remain, retail_price)
    OVERRIDING SYSTEM VALUE VALUES (9961, 9961, 5, 0, 0, 5, 100), (9962, 9962, 5, 0, 0, 5, 100), (9963, 9963, 5, 0, 0, 5, 100);
`);

async function getData(resource: string, query: string, u: (typeof U)[keyof typeof U]) {
  const now = Date.now();
  const cookie = `${SESSION_COOKIE}=${await signSession({ email: u.email, name: 'QFC', exp: now + 600_000, iat: now, sv: SV })}`;
  const req = new NextRequest(`https://svc.example.test/api/data/${resource}?${query}`, {
    headers: { cookie, 'user-agent': 'qfc', host: 'svc.example.test' },
  });
  const res = await dataRoute.GET(req, { params: Promise.resolve({ resource }) } as never);
  return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
}
let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : e}`);
  }
}

console.log('\n/reports/close-job KPIs: the numbers the table adds up to');
await test('ยอดรับชำระรวม is net — a refund (คืนมัดจำ -200) counts, as in the rows', async () => {
  const s = await jobReportSummary({ statusGroup: 'Finished' }, 'QFCJ');
  assert.equal(s.total, 2);
  assert.equal(s.paid, 300);
});
await test('TAT เฉลี่ย / เกิน 30 วัน: opening → the return, else the close (the TAT column and its sort)', async () => {
  const s = await jobReportSummary({ statusGroup: 'Finished' }, 'QFCJ');
  assert.deepEqual([s.avgTat, s.over30], [21.5, 1]);
});

console.log('\nAudit log: a denied sale order is no อนุมัติ');
await test('ปฏิเสธ → audit action STATUS (เปลี่ยนสถานะ), not APPROVE', async () => {
  await approveSaleOrder(SO, 'deny', 'QFC ไม่ผ่าน', { pk: U.admin.id, isAdmin: true, userType: 'System Admin' });
  const { rows } = await pool.query(
    `SELECT action, summary FROM audit_log WHERE entity = 'sale_order' AND entity_key = $1 ORDER BY pk DESC LIMIT 1`,
    [SO],
  );
  assert.deepEqual(rows[0], { action: 'STATUS', summary: 'ปฏิเสธใบสั่งขาย · QFC ไม่ผ่าน' });
});

console.log('\n/api/data/products unpaged: the full rows need a product / stock right and keep to limit');
await test('a role without a product right → 403; the lite picker list stays open', async () => {
  assert.equal((await getData('products', 'q=QFCP', U.manager)).status, 403);
  assert.equal((await getData('products', 'fields=lite&q=QFCP', U.manager)).status, 200);
});
await test('Product Onhand view → 200, at most `limit` rows', async () => {
  const r = await getData('products', 'q=QFCP&limit=2', U.stock);
  assert.equal(r.status, 200);
  assert.equal((r.body as unknown[]).length, 2);
});

console.log('\n/track customer copy: no staff notes');
await test('jobForCustomer blanks payment.detail; a refund keeps only "คืนมัดจำ <date>"', async () => {
  const a = jobForCustomer((await getJob('QFCJ0001'))!);
  assert.equal(a.payment.detail, '');
  assert.equal(a.return.detail, '');
  assert.equal(jobForCustomer((await getJob('QFCJ0002'))!).payment.detail, 'คืนมัดจำ 2026-10-05');
});
await test('quotationForCustomer blanks the remark', async () => {
  const q = quotationForCustomer({ remark: 'ต้นทุนจริง 300 อย่าบอกลูกค้า', job: null } as unknown as QuotationDetail);
  assert.equal(q.remark, '');
});

console.log('\nmerge_legacy_users(): its owner runs it, nobody else');
await test('no EXECUTE through PUBLIC; postgres (migration, seed.sql) still runs it', async () => {
  await pool.query(`DROP ROLE IF EXISTS qfc_nobody; CREATE ROLE qfc_nobody`);
  const { rows } = await pool.query(
    `SELECT has_function_privilege('qfc_nobody', 'merge_legacy_users()', 'EXECUTE') AS other,
            has_function_privilege(current_user, 'merge_legacy_users()', 'EXECUTE') AS owner`,
  );
  await pool.query(`DROP ROLE qfc_nobody`);
  assert.deepEqual(rows[0], { other: false, owner: true });
  await pool.query(`SELECT merge_legacy_users()`);
});

await pool.end();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
