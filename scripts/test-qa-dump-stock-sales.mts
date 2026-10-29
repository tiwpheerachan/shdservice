/**
 * scripts/test-qa-dump-stock-sales.mts — stock / sales regressions from the QA on the legacy data dump (2026-10-28):
 * a return from a job counts in like legacy (quantity_available += qty, quantity_used kept — all 76 legacy parts with
 * returns hold that rule), an issue still moves used / booking only, a denied sale order (legacy SO2401274) is final.
 *
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-dump-stock-sales.mts
 * Seeds its own fixtures (ids 996x, codes QDS*, users qa-dump-ss-*) and resets them at every start. ONLY a local *_test database.
 */
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
Object.assign(process.env, { SESSION_SECRET: 'unit-test-session-secret-0123456789abcdef' });

const { db, pool } = await import('@/db/client');
const { HttpError } = await import('@/server/auth');
const { nextRunningNo } = await import('@/db/running-no');
const { issueForJob, returnFromJob, productStockCard } = await import('@/server/services/stock');
const { setRecordStatus } = await import('@/server/services/records');

const ADMIN = { id: 9960, email: 'qa-dump-ss-admin@example.invalid' };
const PART = 'QDSP1';
const JOB = 'QDSJ0001';
const SO = 'QDSSO0001';

await pool.query(`
  INSERT INTO inventory_type (inventory_type_id, inventory_type_name, movement_action_type, movement_action, is_active)
    SELECT * FROM (VALUES (1, 'รับเข้า', 'รับเข้า', 1, true), (2, 'รับคืนจากการเบิก', 'รับเข้า', 1, true),
                          (3, 'จ่ายออกตามงานซ่อม', 'จ่ายออก', -1, true), (4, 'จ่ายออกตามใบสั่งขาย', 'จ่ายออก', -1, true),
                          (5, 'จ่ายออกอื่นๆ', 'จ่ายออก', -1, true)) v(id, name, kind, act, on_)
     WHERE NOT EXISTS (SELECT 1 FROM inventory_type t WHERE t.inventory_type_id = v.id);
  INSERT INTO store_location (store_location_id, store_location_name, is_active)
    SELECT * FROM (VALUES (1, 'คลังสินค้าดี', true), (2, 'คลังสินค้าเสีย', true)) v(id, name, on_)
     WHERE NOT EXISTS (SELECT 1 FROM store_location s WHERE s.store_location_id = v.id);
  INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
    SELECT * FROM (VALUES (10, 'อยู่ระหว่างการซ่อม - เบิกจ่ายอะไหล่ครบแล้ว', 34, 'Pending', true),
                          (11, 'อยู่ระหว่างการซ่อม - เริ่มเบิกอะไหล่', 33, 'Pending', true)) v(id, name, ord, grp, act)
     WHERE NOT EXISTS (SELECT 1 FROM job_status s WHERE s.job_status_id = v.id);
  DELETE FROM job_log WHERE job_no = '${JOB}';
  DELETE FROM job_order_spare_part_log WHERE job_no = '${JOB}';
  DELETE FROM job WHERE job_no = '${JOB}' OR customer_id = 9960;
  DELETE FROM inventory_dt WHERE item_code = '${PART}';
  DELETE FROM inventory_hd WHERE reference_document_no = '${JOB}';
  DELETE FROM sale_out_hd WHERE sale_out_hd_no = '${SO}';
  DELETE FROM app_user WHERE user_id BETWEEN 9960 AND 9969 OR email_address LIKE 'qa-dump-ss-%@example.invalid';
  INSERT INTO app_user (user_id, first_name, last_name, email_address, user_type, record_status)
    VALUES (${ADMIN.id}, 'QA', 'qa-dump-ss-admin', '${ADMIN.email}', 'System Admin', 'ACTIVE');
  DELETE FROM customer WHERE customer_id = 9960 OR customer_code = 'QDSC001';
  INSERT INTO customer (customer_id, customer_code, customer_name, phone_number) VALUES (9960, 'QDSC001', 'ลูกค้า QDS', '02-996-0001');
  DELETE FROM product_none_serial WHERE product_id = 9960 OR item_id = 9960;
  DELETE FROM product WHERE product_id = 9960 OR product_code = '${PART}';
  INSERT INTO product (product_id, product_code, product_name, record_status) VALUES (9960, '${PART}', 'อะไหล่ QDS', 'ACTIVE');
  INSERT INTO product_none_serial (item_id, product_id, quantity_available, quantity_used, quantity_booking, quantity_remain, retail_price)
    VALUES (9960, 9960, 10, 0, 2, 10, 100.00);
  INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date,
                   job_closed_date, job_repaired_date, record_status)
    VALUES ('${JOB}', 11, 9960, 'QDSC001 ลูกค้า QDS', 'Model QDS', now(), current_date, '1900-01-01', '1900-01-01', 'ACTIVE');
  -- เบิก 2 (charged 100 each), booked as saveRepair would have booked it
  INSERT INTO job_order_spare_part_log (job_no, spare_part_code, spare_part_serial_no, stock_id, is_quotation, is_special, request_qty,
                                        spare_part_unit_price, spare_part_total_price, order_status_id, request_date, request_by, grant_qty, return_qty)
    VALUES ('${JOB}', '${PART}', '', 1, true, true, 2, 100, 200, 1, now(), ${ADMIN.id}, 0, 0);
  -- a legacy order already denied (as SO2401274): approve status 5, still ACTIVE
  INSERT INTO sale_out_hd (sale_out_hd_no, approve_status_id, document_create_by, record_status)
    VALUES ('${SO}', 5, ${ADMIN.id}, 'ACTIVE');
`);
// as test-domain: this year's Inventory series past the numbers other suites already used
for (const t of ['Inventory-In', 'Inventory-Out'] as const) await db.transaction((tx) => nextRunningNo(tx, t));
await pool.query(`
  UPDATE running_no r SET number = greatest(r.number, coalesce((
    SELECT max(substring(h.inventory_no FROM length(r.prefix) + 3)::int) FROM inventory_hd h
     WHERE h.inventory_no ~ ('^' || r.prefix || right(r.pyear::text, 2) || '[0-9]+$')), 0))
   WHERE r.running_type IN ('Inventory-In', 'Inventory-Out') AND r.length_year = 2`);

const qty = async () =>
  (
    await db.execute<{ available: number; used: number; booking: number; remain: number }>(sql`
      SELECT quantity_available AS available, quantity_used AS used, quantity_booking AS booking, quantity_remain AS remain
        FROM product_none_serial WHERE product_id = 9960`)
  ).rows[0]!;
const logId = async () =>
  (
    await db.execute<{ id: number }>(
      sql`SELECT job_order_log_id AS id FROM job_order_spare_part_log WHERE job_no = ${JOB}`,
    )
  ).rows[0]!.id;
/** the error of a rejected call ({ status: 200 } when it resolved); anything but an HttpError is re-thrown */
async function err(p: Promise<unknown>) {
  try {
    await p;
    return { status: 200, message: '' };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, message: e.message };
    throw e;
  }
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
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message.replace(/\n/g, '\n      ') : e}`);
  }
}

try {
  console.log('\n1. a return from a job counts in like legacy (P01109: รับเข้า 21 / จ่ายออก 12, not 20 / 11)');
  await test('issue 2: used += 2, booking -= 2, available kept (unchanged rule)', async () => {
    await issueForJob({ jobNo: JOB, lines: [{ logId: await logId(), qty: 2 }] }, ADMIN.id);
    assert.deepEqual(await qty(), { available: 10, used: 2, booking: 0, remain: 8 });
  });
  await test('return 1: available += 1, used kept, remain += 1', async () => {
    await returnFromJob({ jobNo: JOB, lines: [{ logId: await logId(), qty: 1 }] }, ADMIN.id);
    assert.deepEqual(await qty(), { available: 11, used: 2, booking: 0, remain: 9 });
  });
  await test('the stock card agrees: the return is รับเข้า 1, the issue จ่ายออก 2, the balance moves by +1', async () => {
    const card = await productStockCard(PART); // newest first
    assert.deepEqual(
      card.map((r) => [r.income, r.outcome]),
      [
        [1, 0],
        [0, 2],
      ],
    );
    assert.equal(card[0].after - card[1].after, 1);
  });

  console.log('\n2. a denied sale order is final (legacy SO2401274)');
  await test('cancelling it is a 409 — even for System Admin; it stays ACTIVE', async () => {
    const r = await err(setRecordStatus('sale_orders', SO, 'DELETED', ADMIN.id, true, true, 'QA'));
    assert.equal(r.status, 409, r.message);
    const [row] = (
      await db.execute<{ rs: string }>(sql`SELECT record_status AS rs FROM sale_out_hd WHERE sale_out_hd_no = ${SO}`)
    ).rows;
    assert.equal(row.rs, 'ACTIVE');
  });
} finally {
  await pool.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
