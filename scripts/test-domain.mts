/**
 * npm run test:domain (scripts/test-domain.mts) — domain rules that must hold under real data:
 * the permission matrix (app_config → can / canViewAny / requireView / GET /api/data/:resource),
 * stock never going negative, the sale-order approve / pick / edit state machine, the two
 * row-lock regressions (lockStock: opposite-order movements deadlocked; lockJob: duplicate
 * job_log rows when two saves raced), Idempotency-Key on creates and row_version on edits.
 *
 * Runs ONLY against the throwaway local test database (npm run db:test:up && npm run db:test:prepare).
 * Seeds its own fixtures (ids 9xxx, codes TD*, roles "TD *") and resets them at every start, so it
 * does not depend on tests/seed.mts (test:track TRUNCATEs job / customer / app_user / app_config).
 * Rows it writes (movements, sale orders, job_log, audit) stay behind for inspection.
 */
import assert from 'node:assert/strict';
import { readFileSync as readFile } from 'node:fs';
import { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

// the app modules read DATABASE_URL when they are imported (below) — point it at the test DB first
assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
Object.assign(process.env, {
  SESSION_SECRET: 'unit-test-session-secret-0123456789abcdef', // ≥ 32 chars
  DB_POOL_MAX: '25', // the race tests need real concurrency, not 5 queued transactions
});

const { db, pool } = await import('@/db/client');
const { HttpError, userFromRequest, can, canViewAny, requireView, JOB_MODULES } = await import('@/server/auth');
const { signSession, SESSION_COOKIE } = await import('@/lib/session');
const { nextRunningNo } = await import('@/db/running-no');
const { issueOther, issueForJob, receiveStock, returnFromJob, listIssuedLines, pageIssuedLines, issuedStats } =
  await import('@/server/services/stock');
const {
  assignJobs,
  closeJob,
  createJob,
  getJob,
  saveRepair,
  updateJob,
  saveOutsource,
  dashboard,
  filtersFromQuery,
  pageJobs,
} = await import('@/server/services/jobs');
const { jobReportSummary, quotationReportSummary, saleOrderReportSummary } = await import('@/server/services/reports');
const { setRecordStatus } = await import('@/server/services/records');
const { setSimpleStatus } = await import('@/server/services/masters');
const { setUserDeleted } = await import('@/server/services/users');
const { setTracking } = await import('@/server/services/sale-orders');
const { OUTSOURCE_NOT_BACK } = await import('@/lib/validation/job');
const { addDays, today } = await import('@/lib/dates');
const { GET: dataGET } = await import('@/app/api/data/[resource]/route');
const { POST: soPOST } = await import('@/app/api/sale-orders/route');
const { POST: soApprovePOST } = await import('@/app/api/sale-orders/[no]/approve/route');
const { POST: stockIssuePOST } = await import('@/app/api/stock/issue/route');
const { POST: stockReceivePOST } = await import('@/app/api/stock/receive/route');
const { POST: customerPOST } = await import('@/app/api/customers/route');
const { saveQuotation } = await import('@/server/services/quotations');

// ---- fixtures ----
const U = {
  admin: { id: 9101, email: 'td-admin@example.invalid', type: 'System Admin', status: 'ACTIVE' },
  clerk: { id: 9102, email: 'td-clerk@example.invalid', type: 'TD Job Clerk', status: 'ACTIVE' },
  viewer: { id: 9103, email: 'td-viewer@example.invalid', type: 'TD Customer Viewer', status: 'ACTIVE' },
  picker: { id: 9104, email: 'td-picker@example.invalid', type: 'TD Picker', status: 'ACTIVE' },
  pending: { id: 9105, email: 'td-pending@example.invalid', type: null, status: 'ACTIVE' },
  inactive: { id: 9106, email: 'td-inactive@example.invalid', type: 'TD Customer Viewer', status: 'INACTIVE' },
  seller: { id: 9107, email: 'td-seller@example.invalid', type: 'TD Seller', status: 'ACTIVE' },
  manager: { id: 9108, email: 'td-manager@example.invalid', type: 'Manager', status: 'ACTIVE' }, // SO approver
  seller2: { id: 9109, email: 'td-seller2@example.invalid', type: 'TD Seller', status: 'ACTIVE' }, // another CS
  engineer: { id: 9110, email: 'td-engineer@example.invalid', type: 'Engineer', status: 'ACTIVE' }, // takes jobs (R4)
} as const;
type TestUser = (typeof U)[keyof typeof U];
const SV = 3; // every fixture user's session_version — a cookie must carry exactly this
const P = { a: { id: 9201, code: 'TDP1' }, b: { id: 9202, code: 'TDP2' }, c: { id: 9203, code: 'TDP3' } };
const CUSTOMER = 'TDC001';
const JOB_CLOSE = 'TDJ0001'; // closeJob race
const JOB_PARTS = 'TDJ0002'; // issueForJob over stock
const JOB_REPAIR = 'TDJ0003'; // saveRepair race
const JOB_EDIT = 'TDJ0004'; // row_version
const JOB_QUOTE = 'J9900005'; // a quotation's job (J + 7 digits — the quotation form's rule)
const JOB_BILL = 'TDJ0006'; // deposit + returned parts (amount due, parts cost)
const JOB_OUT = 'TDJ0007'; // out-source send → close refused → receive → close
const JOB_NOREPAIR = 'TDJ0008'; // closed with job_repaired_date still 1900
const JOB_OUT_CLOSED = 'TDJ0009'; // legacy: already closed with an open send row

async function seed() {
  const users = Object.values(U);
  await pool.query(`
    -- the Model series must start past the codes already in the table (a fresh or reused test DB may lag)
    INSERT INTO running_no (running_type, company_id, branch_id, prefix, pyear, pmonth, pday, number, length_year, length_month, length_number)
      SELECT 'Model', 0, 0, 'MD', 0, 0, 0, 0, 0, 0, 5 WHERE NOT EXISTS (SELECT 1 FROM running_no WHERE running_type = 'Model');
    UPDATE running_no SET number = greatest(number, coalesce((SELECT max(substring(model_code FROM 3)::int) FROM model WHERE model_code ~ '^MD[0-9]+$'), 0))
     WHERE running_type = 'Model';
    -- a fresh test DB has no job types; the job-creating tests take the first one
    INSERT INTO job_type (job_type_name, is_active) VALUES ('TD งานซ่อม', true) ON CONFLICT (job_type_name) DO NOTHING;
    -- stock movements point at these (foreign keys, drizzle/0031): the live rows, src/server/services/stock.ts INV / STORE_LOCATION_ID
    INSERT INTO inventory_type (inventory_type_id, inventory_type_name, movement_action_type, movement_action, is_active)
      SELECT * FROM (VALUES (1, 'รับเข้า', 'รับเข้า', 1, true), (2, 'รับคืนจากการเบิก', 'รับเข้า', 1, true),
                            (3, 'จ่ายออกตามงานซ่อม', 'จ่ายออก', -1, true), (4, 'จ่ายออกตามใบสั่งขาย', 'จ่ายออก', -1, true),
                            (5, 'จ่ายออกอื่นๆ', 'จ่ายออก', -1, true)) v(id, name, kind, act, on_)
       WHERE NOT EXISTS (SELECT 1 FROM inventory_type t WHERE t.inventory_type_id = v.id);
    INSERT INTO store_location (store_location_id, store_location_name, is_active)
      SELECT * FROM (VALUES (1, 'คลังสินค้าดี', true), (2, 'คลังสินค้าเสีย', true)) v(id, name, on_)
       WHERE NOT EXISTS (SELECT 1 FROM store_location s WHERE s.store_location_id = v.id);
    DELETE FROM app_config WHERE user_type LIKE 'TD %';
    INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
      ('TD Job Clerk', 'Job Management', false, true, false, true),
      ('TD Job Clerk', 'Customer', true, true, true, false),          -- every right but view: view is its own grant
      ('TD Customer Viewer', 'Customer', false, false, false, true),
      ('TD Picker', 'Product Pick Stock', true, false, false, true),
      ('TD Seller', 'Sale Order', true, true, false, true);
    INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view)
      VALUES ('Manager', 'Sale Order', true, true, true, true)  -- as in the live data (only Manager / System Admin approve)
      ON CONFLICT (user_type, module_name) DO UPDATE SET can_insert = true, can_edit = true, can_view = true;
    -- special rights as migration 0030 seeds them: only Manager approves, Engineers take jobs
    INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view)
      VALUES ('Manager', 'SO Approve', false, false, false, true), ('Engineer', 'Job Take', false, false, false, true)
      ON CONFLICT (user_type, module_name) DO UPDATE SET can_view = true;

    DELETE FROM app_user WHERE user_id BETWEEN 9100 AND 9199 OR email_address LIKE 'td-%@example.invalid';
    INSERT INTO app_user (user_id, first_name, last_name, email_address, user_type, record_status, session_version) VALUES
      ${users.map((u) => `(${u.id}, 'TD', '${u.email.split('@')[0]}', '${u.email}', ${u.type ? `'${u.type}'` : 'NULL'}, '${u.status}', ${SV})`).join(',\n      ')};

    -- every status a flow can move a job to: job.job_status_id has a foreign key (drizzle/0031)
    INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
      SELECT * FROM (VALUES (0, 'ยกเลิก', 0, 'Cancel', true), (1, 'รับงานใหม่', 1, 'Open', true), (2, 'กำลังดำเนินการ', 2, 'Open', true),
                            (3, 'อยู่ระหว่างการซ่อม - รออะไหล่', 35, 'Pending', true),
                            (4, 'อยู่ระหว่างการซ่อม - เสนอราคาลูกค้า', 37, 'Pending', true),
                            (5, 'ซ่อมเสร็จ', 5, 'Repaired', true), (20, 'เสร็จสมบูรณ์', 20, 'Finished', true),
                            (6, 'ยกเลิกซ่อม (ลูกค้าไม่ตกลงซ่อม)', 6, 'Repaired', true),
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
                            (21, 'ปิดงานซ่อม (Refund : คืนเงินลูกค้า)', 53, 'Finished', false),
                            (22, 'ซ่อมเสร็จ (ไม่พบอาการเสีย ขอส่งคืน)', 46, 'Repaired', true),
                            (23, 'ปิดงานซ่อม (Out-Source)', 54, 'Finished', false),
                            (24, 'ปิดงาน-รอลูกค้ามารับที่ศูนย์บริการ', 24, 'Finished', true)) v(id, name, ord, grp, act)
       WHERE NOT EXISTS (SELECT 1 FROM job_status s WHERE s.job_status_id = v.id);

    -- children before parents (foreign keys, drizzle/0031): the fixture jobs and every job a previous run
    -- created for the fixture customer
    DELETE FROM job_log WHERE job_no LIKE 'TDJ%' OR job_no = '${JOB_QUOTE}' OR job_no IN (SELECT job_no FROM job WHERE customer_id = 9001);
    DELETE FROM job_send_forward_dt WHERE job_no LIKE 'TDJ%' OR job_no = '${JOB_QUOTE}' OR job_no IN (SELECT job_no FROM job WHERE customer_id = 9001);
    DELETE FROM job_order_spare_part_log WHERE job_no LIKE 'TDJ%' OR job_no = '${JOB_QUOTE}' OR job_no IN (SELECT job_no FROM job WHERE customer_id = 9001);
    DELETE FROM job WHERE customer_id = 9001 OR job_no LIKE 'TDJ%' OR job_no = '${JOB_QUOTE}';

    DELETE FROM sale_out_dt WHERE sale_out_hd_no IN (SELECT sale_out_hd_no FROM sale_out_hd WHERE customer_code = '${CUSTOMER}');
    DELETE FROM sale_out_hd WHERE customer_code = '${CUSTOMER}';
    DELETE FROM customer WHERE customer_id = 9001 OR customer_code = '${CUSTOMER}';
    INSERT INTO customer (customer_id, customer_code, customer_name, phone_number) VALUES (9001, '${CUSTOMER}', 'ลูกค้า ทดสอบโดเมน', '02-000-0000');

    DELETE FROM product_none_serial WHERE product_id IN (9201, 9202, 9203) OR item_id IN (9201, 9202, 9203);
    DELETE FROM product WHERE product_id IN (9201, 9202, 9203) OR product_code IN ('TDP1', 'TDP2', 'TDP3');
    INSERT INTO product (product_id, product_code, product_name) VALUES (9201, 'TDP1', 'อะไหล่ทดสอบ 1'), (9202, 'TDP2', 'อะไหล่ทดสอบ 2'), (9203, 'TDP3', 'อะไหล่ทดสอบ 3');
    INSERT INTO product_none_serial (item_id, product_id, quantity_available, quantity_used, quantity_booking, quantity_remain, retail_price) VALUES
      (9201, 9201, 10, 0, 0, 10, 100.00), (9202, 9202, 10, 0, 0, 10, 200.00), (9203, 9203, 10, 0, 0, 10, 300.00);

    DELETE FROM quotation_dt WHERE quotation_no LIKE 'TDQ%';
    DELETE FROM quotation_hd WHERE quotation_no LIKE 'TDQ%';
    DELETE FROM inventory_dt WHERE inventory_no LIKE 'TDW%';
    DELETE FROM inventory_hd WHERE inventory_no LIKE 'TDW%';
    DELETE FROM color WHERE color_name = 'TD color';
    INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date) VALUES
      ('${JOB_CLOSE}', 2, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01'),
      ('${JOB_PARTS}', 11, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01'),
      ('${JOB_REPAIR}', 2, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01'),
      ('${JOB_EDIT}', 2, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01'),
      ('${JOB_QUOTE}', 2, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01');
    INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date, job_repaired_date) VALUES
      ('${JOB_OUT}', 2, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01', '1900-01-01'),
      ('${JOB_NOREPAIR}', 2, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01', '1900-01-01'),
      ('${JOB_OUT_CLOSED}', 20, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '2026-01-02', '2026-01-01');
    INSERT INTO job_send_forward_dt (job_no, send_to_name, send_date, send_by, receive_date, receive_by, receive_detail, send_status)
      VALUES ('${JOB_OUT_CLOSED}', 'TD Vendor', '2025-12-20', 9101, '1900-01-01', -1, '', 'ส่งเครื่องซ่อมแล้ว');
    DELETE FROM idempotency_key WHERE user_id BETWEEN 9100 AND 9199;
    -- 15 requested (booked) while only 10 are on hand
    UPDATE product_none_serial SET quantity_booking = 15 WHERE product_id = 9203;
    INSERT INTO job_order_spare_part_log (job_no, spare_part_code, spare_part_serial_no, stock_id, is_quotation, is_special, request_qty, order_status_id, request_date, request_by, grant_qty, return_qty)
      VALUES ('${JOB_PARTS}', 'TDP3', '', 1, false, true, 15, 1, now(), 9101, 0, 0);
  `);
  // the rest of 0030 (ส่งออก Excel for every role, the TD ones included — they were just inserted)
  await pool.query(readFile('drizzle/0030_special_rights.sql', 'utf8'));
  // test:running-no deletes the Inventory-In series and restarts it from 0 — the WHI numbers then
  // collide with the movements earlier runs of this script left in inventory_hd (unique inventory_no).
  // Make sure this year's rows exist, then move them past the highest number already used.
  for (const t of ['Inventory-In', 'Inventory-Out'] as const) await db.transaction((tx) => nextRunningNo(tx, t));
  await pool.query(`
    UPDATE running_no r SET number = greatest(r.number, coalesce((
      SELECT max(substring(h.inventory_no FROM length(r.prefix) + 3)::int) FROM inventory_hd h
       WHERE h.inventory_no ~ ('^' || r.prefix || right(r.pyear::text, 2) || '[0-9]+$')), 0))
     WHERE r.running_type IN ('Inventory-In', 'Inventory-Out') AND r.length_year = 2`);
}

// ---- helpers ----
type Qty = { available: number; used: number; booking: number; remain: number };
async function qty(code: string): Promise<Qty> {
  const r = await db.execute<Qty>(sql`
    SELECT s.quantity_available AS available, s.quantity_used AS used, s.quantity_booking AS booking, s.quantity_remain AS remain
      FROM product_none_serial s JOIN product p ON p.product_id = s.product_id WHERE p.product_code = ${code}`);
  assert.equal(r.rows.length, 1, `one stock row for ${code}`);
  return r.rows[0];
}
async function setStock(code: string, remain: number) {
  await db.execute(sql`
    UPDATE product_none_serial SET quantity_available = ${remain}, quantity_used = 0, quantity_remain = ${remain}
     WHERE product_id = (SELECT product_id FROM product WHERE product_code = ${code})`);
}
/** HttpError status of a rejected call, 200 when it resolved; anything else is re-thrown. */
async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
}

async function cookieFor(u: TestUser, sv = SV) {
  const now = Date.now();
  return `${SESSION_COOKIE}=${await signSession({ email: u.email, name: u.email, exp: now + 10 * 60_000, iat: now, sv })}`;
}
async function request(
  path: string,
  u: TestUser | null,
  init: { method?: string; body?: unknown; sv?: number; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { 'user-agent': 'test-domain', ...init.headers };
  if (u) headers.cookie = await cookieFor(u, init.sv);
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`https://svc.example.test${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
async function readData(resource: string, u: TestUser | null, sv?: number) {
  const r = await dataGET(await request(`/api/data/${resource}`, u, { sv }), { params: Promise.resolve({ resource }) });
  return r.status;
}
async function json(r: Response) {
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}
async function userOf(u: TestUser) {
  const cu = await userFromRequest(await request('/', u));
  assert.ok(cu, `${u.email} resolves to a user`);
  return cu;
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

await seed();
try {
  console.log('\nPermissions — app_config drives can() / canViewAny() / requireView()');
  await test('can() follows the seeded grant per action (clerk: Job Management view+edit, not add)', async () => {
    const clerk = await userOf(U.clerk);
    assert.equal(await can(clerk, 'Job Management', 'view'), true);
    assert.equal(await can(clerk, 'Job Management', 'edit'), true);
    assert.equal(await can(clerk, 'Job Management', 'add'), false);
    assert.equal(await can(clerk, 'Job Management', 'del'), false);
  });
  await test('a module with add/edit/del but view=false is not viewable; unlisted modules and null deny', async () => {
    const clerk = await userOf(U.clerk);
    assert.equal(await can(clerk, 'Customer', 'add'), true);
    assert.equal(await can(clerk, 'Customer', 'view'), false);
    assert.equal(await can(clerk, 'Quotation', 'view'), false);
    assert.equal(await can(clerk, null, 'view'), false);
  });
  await test('canViewAny(): true if any listed module has view, false otherwise', async () => {
    const clerk = await userOf(U.clerk);
    assert.equal(await canViewAny(clerk, JOB_MODULES), true);
    assert.equal(await canViewAny(clerk, ['Customer', 'Quotation', 'Sale Order']), false);
    assert.equal(await canViewAny(clerk, []), false);
  });
  await test('requireView(): 403 without view, resolves the user with it', async () => {
    assert.equal(await statusOf(requireView(await request('/', U.clerk), ['Customer'])), 403);
    const u = await requireView(await request('/', U.clerk), JOB_MODULES);
    assert.equal(u.userId, U.clerk.id);
  });
  await test('System Admin passes can() / canViewAny() with no app_config rows at all', async () => {
    const admin = await userOf(U.admin);
    assert.equal(await can(admin, 'Sale Order', 'del'), true);
    assert.equal(await can(admin, null, 'view'), true);
    assert.equal(await canViewAny(admin, ['Quotation']), true);
  });

  console.log('\nPermissions — GET /api/data/:resource (readResource)');
  await test('customers: 403 without Customer view, 200 with it', async () => {
    assert.equal(await readData('customers', U.clerk), 403);
    assert.equal(await readData('customers', U.picker), 403);
    assert.equal(await readData('customers', U.viewer), 200);
  });
  await test('admin-only resources (job_summary, issued_lines, sale_order_summary) → 403 for every non-admin', async () => {
    for (const r of ['job_summary', 'issued_lines', 'sale_order_summary']) {
      for (const u of [U.clerk, U.viewer, U.picker]) assert.equal(await readData(r, u), 403, `${r} as ${u.email}`);
    }
  });
  await test('cross-module read stays allowed: Product Pick Stock alone can read sale_orders', async () => {
    assert.equal(await readData('sale_orders', U.picker), 200);
    assert.equal(await readData('sale_orders', U.clerk), 403);
  });
  await test('pending user (user_type NULL) → 403 everywhere, lookups included', async () => {
    for (const r of ['customers', 'jobs', 'sale_orders', 'job_summary', 'job_statuses', 'products'])
      assert.equal(await readData(r, U.pending), 403, r);
  });
  await test('INACTIVE user → 403 even on a resource the role may view', async () => {
    for (const r of ['customers', 'job_statuses']) assert.equal(await readData(r, U.inactive), 403, r);
  });
  await test('no cookie → 401; a cookie with a stale session_version → 401', async () => {
    assert.equal(await readData('customers', null), 401);
    assert.equal(await readData('customers', U.viewer, SV - 1), 401);
  });
  await test('System Admin → 200 on customers, job_summary, sale_order_summary', async () => {
    for (const r of ['customers', 'job_summary', 'sale_order_summary'])
      assert.equal(await readData(r, U.admin), 200, r);
  });

  console.log('\nStock never goes negative (adjustQty: remain < 0 → 409, whole movement rolled back)');
  await test('issueOther of more than on hand → 409, quantities unchanged', async () => {
    await setStock(P.a.code, 10);
    const before = await qty(P.a.code);
    assert.equal(await statusOf(issueOther({ payTo: 'TD', lines: [{ code: P.a.code, qty: 11 }] }, U.admin.id)), 409);
    assert.deepEqual(await qty(P.a.code), before);
  });
  await test('the 409 names the part and what is left: "สต๊อก TDP1 ไม่พอ (คงเหลือ 10)"', async () => {
    await setStock(P.a.code, 10);
    await assert.rejects(issueOther({ payTo: 'TD', lines: [{ code: P.a.code, qty: 11 }] }, U.admin.id), {
      message: `สต๊อก ${P.a.code} ไม่พอ (คงเหลือ 10)`,
    });
  });
  await test('issueOther: one short line rolls back the good line before it (no partial movement)', async () => {
    await setStock(P.a.code, 10);
    await setStock(P.b.code, 10);
    const docs = async () =>
      (
        await db.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM inventory_hd WHERE reference_out_to = 'TD-rollback'`,
        )
      ).rows[0].n;
    const [a, b, n] = [await qty(P.a.code), await qty(P.b.code), await docs()];
    assert.equal(
      await statusOf(
        issueOther(
          {
            payTo: 'TD-rollback',
            lines: [
              { code: P.a.code, qty: 5 },
              { code: P.b.code, qty: 11 },
            ],
          },
          U.admin.id,
        ),
      ),
      409,
    );
    assert.deepEqual(await qty(P.a.code), a);
    assert.deepEqual(await qty(P.b.code), b);
    assert.equal(await docs(), n, 'no inventory_hd row');
  });
  await test('issueOther: the same part twice in one movement is summed (6 + 6 of 10 → 409)', async () => {
    await setStock(P.a.code, 10);
    const before = await qty(P.a.code);
    assert.equal(
      await statusOf(
        issueOther(
          {
            payTo: 'TD',
            lines: [
              { code: P.a.code, qty: 6 },
              { code: P.a.code, qty: 6 },
            ],
          },
          U.admin.id,
        ),
      ),
      409,
    );
    assert.deepEqual(await qty(P.a.code), before);
  });
  await test('issueOther of exactly what is on hand succeeds and leaves 0', async () => {
    await setStock(P.a.code, 10);
    await issueOther({ payTo: 'TD', lines: [{ code: P.a.code, qty: 10 }] }, U.admin.id);
    const q = await qty(P.a.code);
    assert.equal(q.remain, 0);
    assert.equal(q.used, 10);
  });
  await test('issueForJob of a 15-piece request with 10 on hand → 409; stock, booking and the request unchanged', async () => {
    const before = await qty(P.c.code);
    const [log] = (
      await db.execute<{ id: number }>(
        sql`SELECT job_order_log_id AS id FROM job_order_spare_part_log WHERE job_no = ${JOB_PARTS}`,
      )
    ).rows;
    assert.equal(
      await statusOf(issueForJob({ jobNo: JOB_PARTS, lines: [{ logId: log.id, qty: 15 }] }, U.admin.id)),
      409,
    );
    assert.deepEqual(await qty(P.c.code), before);
    const [after] = (
      await db.execute<{ g: number; s: number }>(
        sql`SELECT grant_qty AS g, order_status_id AS s FROM job_order_spare_part_log WHERE job_order_log_id = ${log.id}`,
      )
    ).rows;
    assert.deepEqual({ ...after }, { g: 0, s: 1 });
  });
  await test('issueForJob of more than was requested → 400 (before stock is touched)', async () => {
    const before = await qty(P.c.code);
    const [log] = (
      await db.execute<{ id: number }>(
        sql`SELECT job_order_log_id AS id FROM job_order_spare_part_log WHERE job_no = ${JOB_PARTS}`,
      )
    ).rows;
    assert.equal(
      await statusOf(issueForJob({ jobNo: JOB_PARTS, lines: [{ logId: log.id, qty: 16 }] }, U.admin.id)),
      400,
    );
    assert.deepEqual(await qty(P.c.code), before);
  });

  console.log('\nSale order — approve / pick / edit');
  let soNo = '';
  let soDtId = 0;
  await test('create (submit → waiting) via POST /api/sale-orders', async () => {
    await setStock(P.a.code, 10);
    const r = await json(
      await soPOST(
        await request('/api/sale-orders', U.admin, {
          method: 'POST',
          body: { customerCode: CUSTOMER, salesId: U.admin.id, submit: true, lines: [{ code: P.a.code, qty: 2 }] },
        }),
      ),
    );
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const order = r.body.order as { no: string; approveId: number; lines: { id: number }[] };
    assert.equal(order.approveId, 2);
    soNo = order.no;
    soDtId = order.lines[0].id;
  });
  await test('pick on a NOT approved order (POST /api/stock/issue type=sale) → 409, stock unchanged', async () => {
    assert.ok(soNo, 'needs the order above');
    const before = await qty(P.a.code);
    const r = await stockIssuePOST(
      await request('/api/stock/issue', U.admin, {
        method: 'POST',
        body: { type: 'sale', ref: soNo, payTo: 'คลังสินค้าดี', lines: [{ dtId: soDtId, qty: 2 }] },
      }),
    );
    assert.equal(r.status, 409);
    assert.deepEqual(await qty(P.a.code), before);
  });
  await test('approve → 200 and stock goes out once; approve again → 409 and stock does not move', async () => {
    assert.ok(soNo, 'needs the order above');
    const approve = async () =>
      soApprovePOST(
        await request(`/api/sale-orders/${soNo}/approve`, U.admin, { method: 'POST', body: { decision: 'approve' } }),
        { params: Promise.resolve({ no: soNo }) },
      );
    const first = await approve();
    assert.equal(first.status, 200, JSON.stringify(await first.json()));
    assert.equal((await qty(P.a.code)).remain, 8);
    assert.equal((await approve()).status, 409);
    assert.equal((await qty(P.a.code)).remain, 8);
  });
  await test('edit an approved order (POST /api/sale-orders with its no) → 409, lines untouched', async () => {
    assert.ok(soNo, 'needs the order above');
    const r = await soPOST(
      await request('/api/sale-orders', U.admin, {
        method: 'POST',
        body: { no: soNo, customerCode: CUSTOMER, salesId: U.admin.id, lines: [{ code: P.a.code, qty: 9 }] },
      }),
    );
    assert.equal(r.status, 409);
    const [dt] = (
      await db.execute<{ q: number; pick: string }>(
        sql`SELECT sale_out_quantity AS q, pick_inventory_no AS pick FROM sale_out_dt WHERE sale_out_hd_no = ${soNo}`,
      )
    ).rows;
    assert.equal(dt.q, 2);
    assert.ok(dt.pick, 'still picked');
  });

  console.log('\nDeadlock regression — lockStock');
  await test('20 concurrent receive / issue movements on 3 parts in opposite line order all commit; totals exact', async () => {
    const START = 1000;
    for (const p of [P.a, P.b, P.c]) await setStock(p.code, START);
    await db.execute(sql`UPDATE product_none_serial SET quantity_booking = 0 WHERE product_id IN (9201, 9202, 9203)`);
    const RECV = { [P.a.code]: 1, [P.b.code]: 2, [P.c.code]: 3 };
    const ISSUE = { [P.a.code]: 3, [P.b.code]: 1, [P.c.code]: 2 };
    const fwd = [P.a.code, P.b.code, P.c.code];
    const rev = [...fwd].reverse();
    const N = 20;
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) => {
        const order = i % 4 < 2 ? fwd : rev;
        return i % 2 === 0
          ? receiveStock({ supplier: 'TD-race', lines: order.map((code) => ({ code, qty: RECV[code] })) }, U.admin.id)
          : issueOther({ payTo: 'TD-race', lines: order.map((code) => ({ code, qty: ISSUE[code] })) }, U.admin.id);
      }),
    );
    const failed = results.flatMap((r) =>
      r.status === 'rejected' ? [String((r.reason as Error)?.cause ?? r.reason)] : [],
    );
    assert.equal(failed.length, 0, `${failed.length}/${N} failed: ${failed[0]}`);
    for (const code of fwd) {
      const q = await qty(code);
      const recv = (N / 2) * RECV[code];
      const issued = (N / 2) * ISSUE[code];
      assert.deepEqual(
        { ...q },
        { available: START + recv, used: issued, booking: 0, remain: START + recv - issued },
        code,
      );
    }
  });

  console.log('\nJob status race — lockJob');
  const logRows = async (jobNo: string) =>
    (
      await db.execute<{ s: number }>(
        sql`SELECT job_status_id AS s FROM job_log WHERE job_no = ${jobNo} ORDER BY job_log_id`,
      )
    ).rows.map((r) => r.s);
  await test('5 concurrent closeJob → all succeed, exactly one job_log row, job is Finished', async () => {
    const input = {
      status: 'เสร็จสมบูรณ์',
      payment: { type: 'เงินสด' },
      return: { type: 'รับเอง', date: '2026-10-01' },
    };
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => closeJob(JOB_CLOSE, input, U.admin.id)));
    const failed = results.flatMap((r) => (r.status === 'rejected' ? [String(r.reason)] : []));
    assert.equal(failed.length, 0, failed[0]);
    assert.deepEqual(await logRows(JOB_CLOSE), [20]);
    const [j] = (await db.execute<{ s: number }>(sql`SELECT job_status_id AS s FROM job WHERE job_no = ${JOB_CLOSE}`))
      .rows;
    assert.equal(j.s, 20);
  });
  await test('5 concurrent saveRepair to the same status → all succeed, exactly one job_log row', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        saveRepair(JOB_REPAIR, { status: 'ซ่อมเสร็จ', repairDetail: 'TD race' }, U.admin.id),
      ),
    );
    const failed = results.flatMap((r) => (r.status === 'rejected' ? [String(r.reason)] : []));
    assert.equal(failed.length, 0, failed[0]);
    assert.deepEqual(await logRows(JOB_REPAIR), [5]);
  });

  console.log('\nMoney — deposit and returned parts');
  // service 50 + 2 x TDP1 @ 100 issued and charged = 250; 100 deposit taken at reception
  const seedBillJob = () =>
    pool.query(`
      DELETE FROM job_order_spare_part_log WHERE job_no = '${JOB_BILL}';
      DELETE FROM job WHERE job_no = '${JOB_BILL}';
      INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date,
                       job_closed_date, deposit_cost, service_cost, service_tool_cost, delivery_cost, carton_box_cost,
                       spare_part_total_cost, job_total_cost)
        VALUES ('${JOB_BILL}', 5, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01',
                100, 50, 0, 0, 0, 200, 250);
      INSERT INTO job_order_spare_part_log (job_no, spare_part_code, spare_part_serial_no, stock_id, is_quotation, is_special,
                                            request_qty, spare_part_unit_price, spare_part_total_price, order_status_id,
                                            request_date, request_by, grant_qty, return_qty)
        VALUES ('${JOB_BILL}', '${P.a.code}', '', 1, true, true, 2, 100, 200, 3, now(), 9101, 2, 0);`);
  await test('amount due = job total - deposit (the close default and the return note grand total)', async () => {
    await seedBillJob();
    const j = await getJob(JOB_BILL);
    assert.equal(j?.totalCost, 250, 'job_total_cost keeps its meaning (no deposit)');
    assert.equal(j?.amountDue, 150);
  });
  await test('return 1 of 2 issued parts → parts cost, job total and amount due drop by one part', async () => {
    await seedBillJob();
    await setStock(P.a.code, 10);
    const [line] = (await getJob(JOB_BILL))!.parts;
    await returnFromJob({ jobNo: JOB_BILL, lines: [{ logId: line.logId, qty: 1 }] }, U.admin.id);
    const j = (await getJob(JOB_BILL))!;
    assert.equal(j.partsCost, 100);
    assert.equal(j.totalCost, 150);
    assert.equal(j.amountDue, 50);
    assert.equal(j.parts[0].granted - j.parts[0].returned, 1, 'net qty billed');
    assert.equal((await qty(P.a.code)).remain, 11, 'back on the shelf');
    // a later repair save without part lines sums the same lines again — no drift back to 200
    await saveRepair(JOB_BILL, { status: 'ซ่อมเสร็จ' }, U.admin.id);
    assert.equal((await getJob(JOB_BILL))!.partsCost, 100);
  });

  console.log('\nProduct-used report — Excel export = screen rows');
  await test('a search by document number gives the export the same rows as the screen', async () => {
    await setStock(P.b.code, 10);
    const { no } = await issueOther({ payTo: 'TD-report', lines: [{ code: P.b.code, qty: 2 }] }, U.admin.id);
    const screen = await pageIssuedLines({ page: 1, pageSize: 100, q: no, f: {} }, {});
    const exported = await listIssuedLines({ code: no });
    assert.ok(screen.rows.length > 0, 'the screen finds the document');
    assert.deepEqual(exported, screen.rows);
  });

  console.log('\nIdempotency-Key on creates (src/server/idempotency.ts)');
  const soCount = async (remark: string) =>
    (
      await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM sale_out_hd WHERE customer_code = ${CUSTOMER} AND remark_hd = ${remark}`,
      )
    ).rows[0].n;
  const createSO = async (u: TestUser, remark: string, key?: string) =>
    soPOST(
      await request('/api/sale-orders', u, {
        method: 'POST',
        headers: key ? { 'idempotency-key': key } : {},
        body: { customerCode: CUSTOMER, salesId: u.id, submit: false, remark, lines: [{ code: P.b.code, qty: 1 }] },
      }),
    );
  await test('same key twice (same user, same route) → one sale order, the second answer is the first one replayed', async () => {
    const key = `td-${crypto.randomUUID()}`;
    const a = await createSO(U.admin, 'TD-idem-1', key);
    const b = await createSO(U.admin, 'TD-idem-1', key);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(b.headers.get('idempotent-replayed'), 'true');
    assert.deepEqual(await b.json(), await a.json());
    assert.equal(await soCount('TD-idem-1'), 1);
  });
  await test('5 concurrent requests with one key → exactly one sale order (the others replay or 409)', async () => {
    const key = `td-${crypto.randomUUID()}`;
    const rs = await Promise.all(Array.from({ length: 5 }, () => createSO(U.admin, 'TD-idem-race', key)));
    assert.ok(
      rs.every((r) => r.status === 201 || r.status === 409),
      rs.map((r) => r.status).join(','),
    );
    assert.equal(await soCount('TD-idem-race'), 1);
  });
  await test('another user with the same key → a separate sale order', async () => {
    const key = `td-${crypto.randomUUID()}`;
    const a = await json(await createSO(U.admin, 'TD-idem-2', key));
    const b = await json(await createSO(U.seller, 'TD-idem-2', key));
    assert.equal(b.status, 201, JSON.stringify(b.body));
    assert.notEqual((a.body.order as { no: string }).no, (b.body.order as { no: string }).no);
    assert.equal(await soCount('TD-idem-2'), 2);
  });
  await test('a refused create releases its key: fix the input, same key → created once', async () => {
    const key = `td-${crypto.randomUUID()}`;
    const bad = await soPOST(
      await request('/api/sale-orders', U.admin, {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: {
          customerCode: 'TD-NOPE',
          salesId: U.admin.id,
          remark: 'TD-idem-3',
          lines: [{ code: P.b.code, qty: 1 }],
        },
      }),
    );
    assert.equal(bad.status, 400);
    assert.equal((await createSO(U.admin, 'TD-idem-3', key)).status, 201);
    assert.equal((await createSO(U.admin, 'TD-idem-3', key)).status, 201);
    assert.equal(await soCount('TD-idem-3'), 1);
  });
  await test('no header → old behaviour: the same body twice creates two sale orders', async () => {
    assert.equal((await createSO(U.admin, 'TD-idem-none')).status, 201);
    assert.equal((await createSO(U.admin, 'TD-idem-none')).status, 201);
    assert.equal(await soCount('TD-idem-none'), 2);
  });
  await test('stock receive with one key twice → stock goes in once (WHI created once)', async () => {
    await setStock(P.b.code, 10);
    const key = `td-${crypto.randomUUID()}`;
    const recv = async () =>
      json(
        await stockReceivePOST(
          await request('/api/stock/receive', U.admin, {
            method: 'POST',
            headers: { 'idempotency-key': key },
            body: { date: '2026-10-01', supplier: 'TD-idem', lines: [{ code: P.b.code, qty: 3 }] },
          }),
        ),
      );
    const a = await recv();
    const b = await recv();
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(b.body.no, a.body.no);
    assert.equal((await qty(P.b.code)).remain, 13);
  });

  console.log('\nrow_version on edits (optimistic locking)');
  const version = async (table: 'job' | 'customer' | 'sale_out_hd', where: ReturnType<typeof sql>) =>
    (await db.execute<{ v: number }>(sql`SELECT row_version AS v FROM ${sql.raw(table)} WHERE ${where}`)).rows[0].v;
  await test('trigger: any write to the row bumps row_version (legacy SQL too); tracking-link columns do not', async () => {
    const v0 = await version('job', sql`job_no = ${JOB_EDIT}`);
    await db.execute(
      sql`UPDATE job SET track_opened_at = now(), track_link_expires_at = now() WHERE job_no = ${JOB_EDIT}`,
    );
    assert.equal(await version('job', sql`job_no = ${JOB_EDIT}`), v0, 'tracking columns only');
    await db.execute(sql`UPDATE job SET job_remark = 'TD legacy write' WHERE job_no = ${JOB_EDIT}`);
    assert.equal(await version('job', sql`job_no = ${JOB_EDIT}`), v0 + 1);
  });
  // what an edit of this fixture must keep (a due date within a year of its open date = today; a listed channel)
  const jobEdit = {
    customerCode: CUSTOMER,
    jobType: '',
    dueDate: addDays(today(), 30),
    warrantyMonth: 0,
    channel: 'SHOPEE',
  };
  await test('job: save with the loaded version → OK (+1); a second save with that old version → 409, data unchanged', async () => {
    const v = await version('job', sql`job_no = ${JOB_EDIT}`);
    const saved = await updateJob(JOB_EDIT, { ...jobEdit, remark: 'TD first', version: v }, U.admin.id);
    assert.equal(saved.version, v + 1);
    assert.equal(await statusOf(updateJob(JOB_EDIT, { ...jobEdit, remark: 'TD stale', version: v }, U.admin.id)), 409);
    const [j] = (await db.execute<{ r: string }>(sql`SELECT job_remark AS r FROM job WHERE job_no = ${JOB_EDIT}`)).rows;
    assert.equal(j.r, 'TD first');
    // no version (older client / script) → last write wins as before
    await updateJob(JOB_EDIT, { ...jobEdit, remark: 'TD unversioned' }, U.admin.id);
  });
  await test('sale order: stale version → 409 with { stale }, lines unchanged; current version / no version → 200', async () => {
    const r = await json(await createSO(U.admin, 'TD-ver'));
    const order = r.body.order as { no: string; version: number };
    const edit = async (qty: number, v?: number) =>
      json(
        await soPOST(
          await request('/api/sale-orders', U.admin, {
            method: 'POST',
            body: {
              no: order.no,
              version: v,
              customerCode: CUSTOMER,
              salesId: U.admin.id,
              submit: false,
              remark: 'TD-ver',
              lines: [{ code: P.b.code, qty }],
            },
          }),
        ),
      );
    const ok = await edit(2, order.version);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const stale = await edit(5, order.version);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, 'มีผู้อื่นแก้ไขเอกสารนี้ไปแล้ว กรุณาโหลดใหม่');
    assert.deepEqual(stale.body.details, { stale: true });
    const [dt] = (
      await db.execute<{ q: number }>(
        sql`SELECT sale_out_quantity AS q FROM sale_out_dt WHERE sale_out_hd_no = ${order.no}`,
      )
    ).rows;
    assert.equal(dt.q, 2);
    assert.equal((await edit(3)).status, 200, 'no version = old behaviour');
  });
  await test('quotation: stale version → 409, remark unchanged', async () => {
    const base = {
      customerCode: CUSTOMER,
      jobNo: JOB_QUOTE,
      contactName: 'TD',
      lines: [
        {
          itemType: 'SparePart' as const,
          code: P.a.code,
          detail: 'TD',
          qty: 1,
          unit: 'ชิ้น',
          unitPrice: 100,
          discount: 0,
          discountPercent: 0,
        },
      ],
    };
    const q = await saveQuotation({ ...base, remark: 'TD q0' }, U.admin.id);
    const saved = await saveQuotation({ ...base, no: q.no, remark: 'TD q1', version: q.version }, U.admin.id);
    assert.equal(saved.version, q.version + 1);
    assert.equal(
      await statusOf(saveQuotation({ ...base, no: q.no, remark: 'TD q-stale', version: q.version }, U.admin.id)),
      409,
    );
    const [hd] = (
      await db.execute<{ r: string }>(sql`SELECT remark AS r FROM quotation_hd WHERE quotation_no = ${q.no}`)
    ).rows;
    assert.equal(hd.r, 'TD q1');
  });
  await test('customer: stale version → 409, name unchanged', async () => {
    const v = await version('customer', sql`customer_code = ${CUSTOMER}`);
    const save = async (name: string, ver: number, line = '') =>
      customerPOST(
        await request('/api/customers', U.admin, {
          method: 'POST',
          body: { code: CUSTOMER, name, phone: '02-000-0000', line, version: ver },
        }),
      );
    // a real change moves the version (a save that changes nothing keeps it — Round 6)
    assert.equal((await save('ลูกค้า ทดสอบโดเมน', v, `td-${crypto.randomUUID().slice(0, 8)}`)).status, 200);
    assert.equal((await save('TD ชื่อทับ', v)).status, 409);
    const [c] = (
      await db.execute<{ n: string }>(sql`SELECT customer_name AS n FROM customer WHERE customer_code = ${CUSTOMER}`)
    ).rows;
    assert.equal(c.n, 'ลูกค้า ทดสอบโดเมน');
  });

  console.log('\nValues the page cannot send are refused by the API (nothing saved)');
  const fieldsOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      if (e instanceof HttpError)
        return { status: e.status, fields: (e.details as { fields?: object })?.fields, message: e.message };
      throw e;
    }
    return { status: 200, fields: undefined };
  };
  await test('job create with an unknown brand / model / symptom → one 400 with all three fields, no job row', async () => {
    const r = await fieldsOf(
      createJob(
        {
          customerCode: CUSTOMER,
          jobType: 'งานซ่อม',
          so: 'TD-SO',
          channel: 'SHOPEE',
          saleOrderDate: '2026-10-01',
          warrantyMonth: 12,
          expireDate: '2027-10-01',
          serial: 'TD-UNKNOWN-LOOKUP',
          brand: 'TD-NOPE-BRAND',
          modelCode: 'TD-NOPE-MODEL',
          symptoms: ['TD-NOPE-SYMPTOM'],
          dueDate: addDays(today(), 5),
        },
        U.admin.id,
      ),
    );
    assert.equal(r.status, 400);
    assert.deepEqual(Object.keys(r.fields ?? {}).sort(), ['brand', 'modelCode', 'symptoms']);
    const [c] = (
      await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM job WHERE product_serial = 'TD-UNKNOWN-LOOKUP'`,
      )
    ).rows;
    assert.equal(c.n, 0);
  });
  await test('legacy master names with a trailing space / newline still match (brand "X ", symptom "Y\\n")', async () => {
    // 10 legacy symptoms end in " " or "\n" and 10 brands in " " — the form sends them trimmed
    await db.execute(sql`DELETE FROM manufacturer WHERE manufacturer_name LIKE 'TD Trail Brand%'`);
    await db.execute(sql`DELETE FROM symptom WHERE symptom_name LIKE 'TD trail sym%'`);
    await db.execute(sql`INSERT INTO manufacturer (manufacturer_id, manufacturer_name)
      VALUES ((SELECT coalesce(max(manufacturer_id), 0) + 1 FROM manufacturer), 'TD Trail Brand ')`);
    await db.execute(sql`INSERT INTO symptom (symptom_id, symptom_name)
      VALUES ((SELECT coalesce(max(symptom_id), 0) + 1 FROM symptom), ${'TD trail sym\n'})`);
    // a NEW job (the shared JOB_EDIT fixture must keep its empty brand for the tests below)
    // a fresh test DB has no model yet (the master tests below create theirs later)
    await db.execute(sql`INSERT INTO model (model_code, model_name)
      SELECT 'TD-TRAIL-MODEL', 'TD trail model' WHERE NOT EXISTS (SELECT 1 FROM model)`);
    const [m] = (await db.execute<{ c: string }>(sql`SELECT model_code AS c FROM model LIMIT 1`)).rows;
    const [jt] = (await db.execute<{ n: string }>(sql`SELECT job_type_name AS n FROM job_type LIMIT 1`)).rows;
    const r = await fieldsOf(
      createJob(
        {
          customerCode: CUSTOMER,
          jobType: jt!.n,
          so: 'TD-SO-TRAIL',
          channel: 'SHOPEE',
          saleOrderDate: '2026-10-01',
          warrantyMonth: 12,
          expireDate: '2027-10-01',
          serial: 'TD-TRAILING-NAMES',
          brand: 'TD Trail Brand',
          modelCode: m!.c,
          symptoms: ['TD trail sym'],
          dueDate: addDays(today(), 5),
        },
        U.admin.id,
      ),
    );
    assert.equal(
      r.status,
      200,
      `status ${r.status} ${JSON.stringify(r.fields ?? null)} ${(r as { message?: string }).message ?? ''}`,
    );
  });
  await test('job edit: an unknown brand that was sent → 400 under brand, job unchanged; not sent → saves', async () => {
    const r = await fieldsOf(
      updateJob(JOB_EDIT, { ...jobEdit, brand: 'TD-NOPE-BRAND', remark: 'TD bad brand' }, U.admin.id),
    );
    assert.equal(r.status, 400);
    assert.deepEqual(Object.keys(r.fields ?? {}), ['brand']);
    const [j] = (await db.execute<{ r: string }>(sql`SELECT job_remark AS r FROM job WHERE job_no = ${JOB_EDIT}`)).rows;
    assert.notEqual(j.r, 'TD bad brand');
    await updateJob(JOB_EDIT, { ...jobEdit, remark: 'TD no brand sent' }, U.admin.id);
  });
  await test('assign to an unknown or inactive engineer → 400 under engineerId, job not assigned', async () => {
    const before = (
      await db.execute<{ e: number | null }>(sql`SELECT engineer_id AS e FROM job WHERE job_no = ${JOB_EDIT}`)
    ).rows[0].e;
    for (const id of [999999, U.inactive.id]) {
      const r = await fieldsOf(assignJobs([JOB_EDIT], id, U.admin.id));
      assert.equal(r.status, 400, String(id));
      assert.deepEqual(Object.keys(r.fields ?? {}), ['engineerId']);
    }
    const [j] = (
      await db.execute<{ e: number | null }>(sql`SELECT engineer_id AS e FROM job WHERE job_no = ${JOB_EDIT}`)
    ).rows;
    assert.equal(j.e, before);
  });
  await test('sale order with an unknown salesperson → 400 under salesId, no order', async () => {
    const r = await json(
      await soPOST(
        await request('/api/sale-orders', U.admin, {
          method: 'POST',
          body: {
            customerCode: CUSTOMER,
            salesId: 999999,
            remark: 'TD-bad-sales',
            lines: [{ code: P.b.code, qty: 1 }],
          },
        }),
      ),
    );
    assert.equal(r.status, 400);
    assert.deepEqual((r.body.details as { fields: object }).fields, { salesId: 'ไม่พบพนักงานขาย' });
    assert.equal(await soCount('TD-bad-sales'), 0);
  });
  await test('sale order edit keeps its tracking number, fee and a salesperson who has left', async () => {
    const created = await json(await createSO(U.admin, 'TD-keep'));
    const no = (created.body.order as { no: string }).no;
    await db.execute(sql`
      UPDATE sale_out_hd SET delivery_tracking_no = 'TDTRACK1', fee_amount = 50, sale_out_by = ${U.inactive.id}
       WHERE sale_out_hd_no = ${no}`);
    const r = await json(
      await soPOST(
        await request('/api/sale-orders', U.admin, {
          method: 'POST',
          // what the edit form sends: no tracking, no fee
          body: {
            no,
            customerCode: CUSTOMER,
            salesId: U.inactive.id,
            submit: false,
            remark: 'TD-keep',
            lines: [{ code: P.b.code, qty: 2 }],
          },
        }),
      ),
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [hd] = (
      await db.execute<{ t: string; fee: string; net: string; by: number }>(
        sql`SELECT delivery_tracking_no AS t, fee_amount AS fee, net_amount AS net, sale_out_by AS by
              FROM sale_out_hd WHERE sale_out_hd_no = ${no}`,
      )
    ).rows;
    assert.deepEqual(
      { t: hd.t, fee: Number(hd.fee), net: Number(hd.net), by: hd.by },
      { t: 'TDTRACK1', fee: 50, net: 2 * 200 + 50, by: U.inactive.id },
    );
  });
  await test('stock issue without จ่ายให้ / รับคืนจาก → 400 under payTo, no inventory_hd row', async () => {
    await setStock(P.a.code, 10);
    const count = async () =>
      (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM inventory_hd`)).rows[0].n;
    const n0 = await count();
    for (const [type, payTo, msg] of [
      ['other', undefined, 'ต้องเลือก จ่ายให้'],
      ['other', '   ', 'ต้องเลือก จ่ายให้'],
      ['return', '', 'ต้องเลือก รับคืนจาก'],
    ] as const) {
      const r = await json(
        await stockIssuePOST(
          await request('/api/stock/issue', U.admin, {
            method: 'POST',
            body: { type, ref: JOB_PARTS, payTo, lines: [{ code: P.a.code, logId: 1, qty: 1 }] },
          }),
        ),
      );
      assert.equal(r.status, 400, `${type} ${JSON.stringify(payTo)}`);
      assert.equal((r.body.details as { fields: Record<string, string> }).fields.payTo, msg);
    }
    assert.equal(await count(), n0);
    assert.equal((await qty(P.a.code)).remain, 10);
  });
  await test('stock receive: date required and a real day ("abc" / 2026-02-30 → 400, nothing received)', async () => {
    await setStock(P.b.code, 10);
    for (const date of [undefined, 'abc', '2026-02-30']) {
      const r = await stockReceivePOST(
        await request('/api/stock/receive', U.admin, {
          method: 'POST',
          body: { date, supplier: 'TD-date', lines: [{ code: P.b.code, qty: 1 }] },
        }),
      );
      assert.equal(r.status, 400, String(date));
    }
    assert.equal((await qty(P.b.code)).remain, 10);
  });

  // ==== row_version on no-op saves (drizzle/0027) + legacy บาท discount on quotations (agent B, 2026-10-15) ====
  console.log('\nrow_version: a save that changes nothing keeps the version; บาท discounts survive an edit');
  const { getQuotation } = await import('@/server/services/quotations');
  const { parseDiscount } = await import('@/lib/validation/quotation');
  await test('trigger: unchanged update → same version; real change → +1; status stamp / excluded columns → same', async () => {
    const cust = sql`customer_code = ${CUSTOMER}`;
    const v0 = await version('customer', cust);
    await db.execute(sql`UPDATE customer SET customer_name = customer_name WHERE ${cust}`);
    assert.equal(await version('customer', cust), v0, 'nothing changed');
    await db.execute(
      sql`UPDATE customer SET status_changed_at = now(), status_changed_by = ${U.clerk.id} WHERE ${cust}`,
    );
    assert.equal(await version('customer', cust), v0, 'status stamp only');
    await db.execute(sql`UPDATE customer SET line_id = ${`td-${crypto.randomUUID().slice(0, 8)}`} WHERE ${cust}`);
    assert.equal(await version('customer', cust), v0 + 1, 'a real change');
    const job = sql`job_no = ${JOB_EDIT}`;
    const j0 = await version('job', job);
    await db.execute(
      sql`UPDATE job SET track_opened_at = now(), document_profile_id = document_profile_id WHERE ${job}`,
    );
    assert.equal(await version('job', job), j0, 'excluded columns only');
  });
  await test('customer: saving the form unchanged keeps the version — another tab on it saves without a false 409', async () => {
    const save = async (ver: number) =>
      json(
        await customerPOST(
          await request('/api/customers', U.admin, {
            method: 'POST',
            body: { code: CUSTOMER, name: 'ลูกค้า ทดสอบโดเมน', phone: '02-000-0000', version: ver },
          }),
        ),
      );
    const first = await save(await version('customer', sql`customer_code = ${CUSTOMER}`)); // may tidy legacy values
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const v = (first.body.row as { version: number }).version;
    // saves are seconds apart in real life: the status stamp then differs (nowThai() has 1 s resolution)
    await db.execute(sql`UPDATE customer SET status_changed_at = '2000-01-01' WHERE customer_code = ${CUSTOMER}`);
    const again = await save(v);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal((again.body.row as { version: number }).version, v);
    assert.equal((await save(v)).status, 200, 'the other tab still holds a current version');
  });
  await test('quotation: a บาท discount (legacy "200บาท" on parts) is kept by load + save, totals unchanged, version too', async () => {
    // test:running-no restarts the numbers and test:track empties quotation_hd: lines of an old run
    // would join the new quotation that gets their number
    await db.execute(
      sql`DELETE FROM quotation_dt d WHERE NOT EXISTS (SELECT 1 FROM quotation_hd h WHERE h.quotation_no = d.quotation_no)`,
    );
    const created = await saveQuotation(
      {
        customerCode: CUSTOMER,
        jobNo: JOB_QUOTE,
        contactName: 'TD',
        remark: 'TD baht discount',
        lines: [
          {
            itemType: 'SparePart',
            code: P.a.code,
            detail: 'TD',
            qty: 3,
            unit: 'ชิ้น',
            unitPrice: 500,
            discount: 0,
            discountPercent: 0,
          },
        ],
        discountType: 'ส่วนลดค่าอะไหล่',
        discountValue: 200,
        discountUnit: 'บาท',
      },
      U.admin.id,
    );
    assert.equal(created.discountFormula, '200บาท');
    await db.execute(sql`UPDATE quotation_hd SET status_changed_at = '2000-01-01' WHERE quotation_no = ${created.no}`);
    const loaded = (await getQuotation(created.no))!;
    // what the edit form sends back for it (quotation-form payload())
    const d = parseDiscount(loaded.discountType, loaded.discountFormula);
    const saved = await saveQuotation(
      {
        no: loaded.no,
        version: loaded.version,
        type: loaded.type,
        customerCode: loaded.customerCode,
        contactName: loaded.contactName,
        jobNo: loaded.jobRef,
        lines: loaded.lines,
        serviceAmount: loaded.serviceAmount,
        discountType: d.value > 0 ? d.type : 'ไม่มีส่วนลด',
        discountValue: d.value,
        discountUnit: d.unit,
        vatRate: loaded.vatRate,
        remark: loaded.remark,
        status: loaded.status,
        approveRemark: loaded.approveRemark,
      },
      U.admin.id,
    );
    assert.deepEqual(
      [saved.discountType, saved.discountFormula, saved.discountAmount, saved.netAmount],
      ['ส่วนลดค่าอะไหล่', '200บาท', 200, 1300],
    );
    assert.equal(saved.version, loaded.version, 'nothing changed → same version');
  });

  console.log('\nOut-source round trip — a job sent out must come back before it is closed');
  const statusName = async (id: number) =>
    (await db.execute<{ n: string }>(sql`SELECT job_status_name AS n FROM job_status WHERE job_status_id = ${id}`))
      .rows[0].n;
  const closeInput = async (status = 20) => ({
    status: await statusName(status),
    payment: { type: 'เงินสด' },
    return: { type: 'รับเอง', date: '2026-10-05' },
  });
  const jobRow = async (no: string) =>
    (
      await db.execute<{ s: number; repaired: string; by: number; closed: string }>(sql`
        SELECT job_status_id AS s, to_char(job_repaired_date, 'YYYY-MM-DD HH24:MI:SS') AS repaired,
               job_repaired_by AS by, to_char(job_closed_date, 'YYYY-MM-DD HH24:MI:SS') AS closed
          FROM job WHERE job_no = ${no}`)
    ).rows[0];
  await test('closeJob while the out-source send is open → 400 under status, job not closed', async () => {
    await saveOutsource(
      JOB_OUT,
      { send: { to: 'TD Vendor', date: '2026-10-01' }, status: await statusName(14) },
      U.admin.id,
    );
    assert.equal((await jobRow(JOB_OUT)).s, 14);
    let err: unknown;
    await closeJob(JOB_OUT, await closeInput(), U.admin.id).catch((e) => (err = e));
    assert.ok(err instanceof HttpError, 'refused');
    assert.equal(err.status, 400);
    assert.deepEqual(err.details, { fields: { status: OUTSOURCE_NOT_BACK } });
    assert.equal((await jobRow(JOB_OUT)).s, 14, 'status unchanged');
  });
  await test('receive back stamps job_repaired_date = the receive date (by the saver); then close succeeds', async () => {
    await saveOutsource(
      JOB_OUT,
      { receive: { from: 'TD Vendor', date: '2026-10-03' }, status: await statusName(15) },
      U.admin.id,
    );
    let j = await jobRow(JOB_OUT);
    assert.deepEqual([j.s, j.repaired, j.by], [15, '2026-10-03 00:00:00', U.admin.id]);
    await closeJob(JOB_OUT, await closeInput(), U.admin.id);
    j = await jobRow(JOB_OUT);
    assert.equal(j.s, 20);
    assert.equal(j.repaired, '2026-10-03 00:00:00', 'the close keeps the repaired date already there');
  });
  await test('closing a job whose repaired date is still 1900 stamps it with the close time', async () => {
    await closeJob(JOB_NOREPAIR, await closeInput(), U.admin.id);
    const j = await jobRow(JOB_NOREPAIR);
    assert.equal(j.s, 20);
    assert.equal(j.repaired, j.closed);
    assert.equal(j.by, U.admin.id);
  });
  await test('an already-closed legacy job with an open send row can still move between closed statuses', async () => {
    await closeJob(JOB_OUT_CLOSED, await closeInput(24), U.admin.id);
    const j = await jobRow(JOB_OUT_CLOSED);
    assert.equal(j.s, 24);
    assert.equal(j.repaired, '2026-01-01 00:00:00', 'a real repaired date is never overwritten');
  });

  console.log('\nReport cards — sale total = approved only, quotation total without cancelled');
  await pool.query(`
    INSERT INTO sale_out_hd (sale_out_hd_no, customer_code, customer_name, net_amount, approve_status_id, document_create_date, document_create_by, delivery_tracking_no)
      VALUES ('TDS0001', '${CUSTOMER}', 'ลูกค้า ทดสอบโดเมน', 1000, 4, '2001-04-10', 9101, 'TRK-OLD'),
             ('TDS0002', '${CUSTOMER}', 'ลูกค้า ทดสอบโดเมน', 300, 2, '2001-04-11', 9101, ''),
             ('TDS0003', '${CUSTOMER}', 'ลูกค้า ทดสอบโดเมน', 50, 5, '2001-04-12', 9101, '');
    INSERT INTO quotation_hd (quotation_no, customer_code, net_amount, quotation_status_id, create_date, create_by, is_active)
      VALUES ('TDQ0001', '${CUSTOMER}', 500, 2, '2001-04-10', 9101, true),
             ('TDQ0002', '${CUSTOMER}', 120, 5, '2001-04-11', 9101, true);`);
  const APRIL = { from: '2001-04-01', to: '2001-04-30' };
  await test('sale-order summary: ยอดขายรวม = approved orders, the rest shown apart; average per approved order', async () => {
    const s = await saleOrderReportSummary(APRIL);
    assert.deepEqual(s, { total: 3, approved: 1, amount: 1000, notApprovedAmount: 350, avg: 1000 });
  });
  await test('quotation summary: มูลค่ารวม leaves out cancelled (5), the cancelled amount shown apart', async () => {
    const s = await quotationReportSummary(APRIL);
    assert.equal(s.total, 2);
    assert.equal(s.amount, 500);
    assert.equal(s.cancelledAmount, 120);
  });

  console.log('\nDashboard — ยกเลิก = customer declined (6), not counted as repaired; KPI link = card');
  await pool.query(`
    INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date) VALUES
      ('TDJ0101', 5, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', '2001-02-10', '2001-02-10', '1900-01-01'),
      ('TDJ0102', 6, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', '2001-02-11', '2001-02-11', '1900-01-01'),
      ('TDJ0103', 20, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', '2001-02-12', '2001-02-12', '2001-02-20');`);
  const FEB = { from: '2001-02-01', to: '2001-02-28' };
  await test('cards: repaired 1, finished 1, cancel 1 (the declined job) — each = its ?src=kpi&group= list', async () => {
    const d = await dashboard(FEB);
    const card = (k: string) => d.groups.find((g) => g.key === k)?.jobs;
    assert.deepEqual([card('repaired'), card('finished'), card('cancel')], [1, 1, 1]);
    for (const g of d.groups) {
      const listed = await pageJobs(
        { page: 1, pageSize: 25, q: '', f: {} },
        filtersFromQuery({ statusGroup: g.sub, ...FEB }),
      );
      assert.equal(listed.total, g.jobs, `${g.sub}: list = card`);
    }
  });
  await test('repair report: a declined job is not a successful repair', async () => {
    const s = await jobReportSummary(filtersFromQuery(FEB));
    assert.deepEqual([s.total, s.done], [3, 2]);
  });
  await test('withStatementTimeout cancels a read past its limit (57014), and the setting ends with it', async () => {
    const { withStatementTimeout } = await import('@/db/client');
    const err = await withStatementTimeout((tx) => tx.execute(sql`select pg_sleep(2)`), 100).catch((e) => e);
    assert.equal((err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code, '57014');
    const [after] = (await db.execute<{ t: string }>(sql`select current_setting('statement_timeout') t`)).rows;
    assert.notEqual(after?.t, '100ms', 'SET LOCAL must not leak into the pooled connection');
  });

  console.log('\nProduct-used report — price at issue time, returned parts subtracted');
  await pool.query(`
    -- the log needs its job (foreign key, drizzle/0031): closed in 2001, outside every other count
    INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date)
      VALUES ('TDJ0011', 20, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', '2001-03-05', '2001-03-05', '2001-03-07');
    INSERT INTO job_order_spare_part_log (job_no, spare_part_code, spare_part_serial_no, stock_id, is_quotation, is_special, request_qty,
                                          spare_part_unit_price, order_status_id, request_date, request_by, grant_qty, return_qty)
      VALUES ('TDJ0011', '${P.a.code}', '', 1, false, true, 2, 80, 3, '2001-03-05', 9101, 2, 1);
    INSERT INTO inventory_hd (inventory_no, inventory_type_id, reference_document_no, create_date, create_by, is_active) VALUES
      ('TDW0001', 3, 'TDJ0011', '2001-03-05', 9101, true),  -- 2 x TDP1 for the job (stored 80, today 100)
      ('TDW0002', 2, 'TDJ0011', '2001-03-06', 9101, true),  -- 1 x TDP1 returned
      ('TDW0003', 5, 'TD-other', '2001-03-07', 9101, true); -- 1 x TDP2, nothing stored → today's 200
    INSERT INTO inventory_dt (inventory_no, item_code, item_quantity) VALUES
      ('TDW0001', '${P.a.code}', 2), ('TDW0002', '${P.a.code}', 1), ('TDW0003', '${P.b.code}', 1);`);
  const MARCH = { from: '2001-03-01', to: '2001-03-31' };
  await test("card: qty 2 − 1 + 1 = 2, value 2×80 − 1×80 + 1×200 = 280, one line at today's price", async () => {
    const s = await issuedStats('', MARCH);
    assert.deepEqual(s, { lines: 3, qty: 2, value: 280, todayPriced: 1, top: P.a.code });
  });
  await test('table rows add up to the card (the return is a negative line)', async () => {
    const t = await pageIssuedLines({ page: 1, pageSize: 100, q: '', f: {} }, MARCH);
    assert.equal(t.total, 3);
    assert.equal(
      t.rows.reduce((a, r) => a + r.value, 0),
      280,
    );
    const back = t.rows.find((r) => r.doc === 'TDW0002');
    assert.deepEqual([back?.qty, back?.price, back?.priceBasis], [-1, 80, 'ราคา ณ วันเบิก']);
    assert.equal(t.rows.find((r) => r.doc === 'TDW0003')?.priceBasis, 'ราคาปัจจุบัน');
  });

  console.log('\nReport cards follow the search too — summary(q) = table(q) through /api/data');
  const data = async (resource: string, params: Record<string, string>) => {
    const r = await dataGET(await request(`/api/data/${resource}?${new URLSearchParams(params)}`, U.admin), {
      params: Promise.resolve({ resource }),
    });
    assert.equal(r.status, 200, resource);
    return (await r.json()) as unknown;
  };
  const card = async (resource: string, params: Record<string, string>) =>
    ((await data(resource, params)) as Record<string, number>[])[0];
  const rowsTotal = async (resource: string, params: Record<string, string>) =>
    ((await data(resource, { ...params, paged: '1' })) as { total: number }).total;
  await test('job_summary / sale_order_summary / quotation_summary / issued_stats with q = the paged table total', async () => {
    const jobs = { ...FEB, q: 'TDJ0102' };
    assert.equal((await card('job_summary', jobs)).total, 1);
    assert.equal(await rowsTotal('jobs', jobs), 1);
    const so = { ...APRIL, q: 'TDS0002' };
    assert.deepEqual([(await card('sale_order_summary', so)).total, await rowsTotal('sale_orders', so)], [1, 1]);
    const qt = { ...APRIL, q: 'TDQ0002' };
    assert.deepEqual([(await card('quotation_summary', qt)).total, await rowsTotal('quotations', qt)], [1, 1]);
    const used = { ...MARCH, q: 'TDW0002' };
    assert.deepEqual([(await card('issued_stats', used)).lines, await rowsTotal('issued_lines', used)], [1, 1]);
  });

  console.log('\nAudit keeps the old value — [old, new], not [null, new]');
  const lastChanges = async (entity: string, key: string) =>
    (
      await db.execute<{ c: Record<string, [unknown, unknown]> }>(
        sql`SELECT changes AS c FROM audit_log WHERE entity = ${entity} AND entity_key = ${key} ORDER BY id DESC LIMIT 1`,
      )
    ).rows[0]?.c;
  await test('record status (customer), master (color), user delete, sale-order tracking no.', async () => {
    await setRecordStatus('customers', CUSTOMER, 'INACTIVE', U.admin.id);
    assert.deepEqual((await lastChanges('customer', CUSTOMER))?.recordStatus, ['ACTIVE', 'INACTIVE']);
    await setRecordStatus('customers', CUSTOMER, 'ACTIVE', U.admin.id);
    assert.deepEqual((await lastChanges('customer', CUSTOMER))?.recordStatus, ['INACTIVE', 'ACTIVE']);
    const color = (await pool.query<{ id: number }>(`INSERT INTO color (color_name) VALUES ('TD color') RETURNING id`))
      .rows[0].id;
    await setSimpleStatus('colors', color, 'INACTIVE', U.admin.id);
    assert.deepEqual((await lastChanges('colors', String(color)))?.recordStatus, ['ACTIVE', 'INACTIVE']);
    await setUserDeleted(U.inactive.id, true, U.admin.id);
    assert.deepEqual((await lastChanges('app_user', String(U.inactive.id)))?.recordStatus, ['INACTIVE', 'DELETED']);
    await setTracking('TDS0001', 'TRK-NEW', U.admin.id);
    assert.deepEqual((await lastChanges('sale_out_hd', 'TDS0001'))?.deliveryTrackingNo, ['TRK-OLD', 'TRK-NEW']);
  });
  // ==== field formats: products / customers / quotation / sale order / stock / users (agent P, 2026-10-15) ====
  console.log('\nField formats (agent P) — the API refuses what the forms refuse, legacy values still save');
  {
    const { saveProduct } = await import('@/server/services/stock');
    const { upsertUser } = await import('@/server/services/users');
    const mfgOf = async (code: string) =>
      (await db.execute<{ m: string }>(sql`SELECT product_vender_code AS m FROM product WHERE product_code = ${code}`))
        .rows[0].m;
    await test('product: the vendor code is stored cleaned + upper-case ("2a190159r " → "2A190159R")', async () => {
      await saveProduct({ sysCode: P.a.code, name: 'อะไหล่ทดสอบ 1', mfgCode: ' 2a190159r\u200B ' }, U.admin.id);
      assert.equal(await mfgOf(P.a.code), '2A190159R');
    });
    await test('product: a Thai / spaced / listed vendor code → 400 under mfgCode, nothing saved', async () => {
      for (const bad of ['อะไหล่-JIMMY JV85', 'A,B', 'Cancel_2A19']) {
        const r = await fieldsOf(saveProduct({ sysCode: P.a.code, name: 'อะไหล่ทดสอบ 1', mfgCode: bad }, U.admin.id));
        assert.equal(r.status, 400, bad);
        assert.ok((r.fields as Record<string, string>).mfgCode, bad);
      }
      assert.equal(await mfgOf(P.a.code), '2A190159R');
    });
    await test('product: a legacy junk vendor code left unchanged still saves; changing it to junk → 400', async () => {
      await db.execute(
        sql`UPDATE product SET product_vender_code = 'อะไหล่-jimmy JV85' WHERE product_code = ${P.b.code}`,
      );
      const keep = { sysCode: P.b.code, name: 'อะไหล่ทดสอบ 2 แก้ชื่อ', mfgCode: 'อะไหล่-jimmy JV85' };
      assert.equal((await fieldsOf(saveProduct(keep, U.admin.id))).status, 200);
      assert.equal((await fieldsOf(saveProduct({ ...keep, mfgCode: 'อะไหล่-jimmy JV86' }, U.admin.id))).status, 400);
      await db.execute(
        sql`UPDATE product SET product_vender_code = '', product_name = 'อะไหล่ทดสอบ 2' WHERE product_code = ${P.b.code}`,
      );
    });
    await test('product: an unknown brand / category / model → 400 under each (was: no brand, category #1)', async () => {
      const r = await fieldsOf(
        saveProduct(
          {
            sysCode: P.a.code,
            name: 'อะไหล่ทดสอบ 1',
            brand: 'TD no brand',
            category: 'TD no cat',
            models: ['TD-NO-MODEL'],
          },
          U.admin.id,
        ),
      );
      assert.equal(r.status, 400);
      assert.deepEqual(Object.keys(r.fields ?? {}).sort(), ['brand', 'category', 'models']);
    });

    const postCustomer = async (body: Record<string, unknown>) =>
      json(await customerPOST(await request('/api/customers', U.admin, { method: 'POST', body })));
    await test('customer: a legacy phone nobody touched still saves; changing it to junk → 400 under phone', async () => {
      await db.execute(sql`UPDATE customer SET phone_number = 'คุณตูน 0922798963' WHERE customer_code = ${CUSTOMER}`);
      const base = { code: CUSTOMER, name: 'ลูกค้า ทดสอบโดเมน', phone: 'คุณตูน 0922798963' };
      const ok = await postCustomer({ ...base, line: '@td.shop' });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      const bad = await postCustomer({ ...base, phone: 'คุณตูน' });
      assert.equal(bad.status, 400);
      assert.ok((bad.body.details as { fields: Record<string, string> }).fields.phone);
      await postCustomer({ ...base, phone: '02-000-0000', line: '' });
    });
    await test('customer: a new one without a mobile → 400; a wrong tax ID check digit → 400 (no row)', async () => {
      const count = async () =>
        (
          await db.execute<{ n: number }>(
            sql`SELECT count(*)::int AS n FROM customer WHERE customer_name LIKE 'TD ใหม่%'`,
          )
        ).rows[0].n;
      const n0 = await count();
      const noMobile = await postCustomer({ name: 'TD ใหม่ ไม่มีมือถือ', phone: '02-111-2222' });
      assert.equal(noMobile.status, 400);
      assert.match((noMobile.body.details as { fields: Record<string, string> }).fields.phone, /มือถือ/);
      const badTax = await postCustomer({ name: 'TD ใหม่ ภาษี', phone: '0899990001', taxId: '1234567890123' });
      assert.equal(badTax.status, 400);
      assert.ok((badTax.body.details as { fields: Record<string, string> }).fields.taxId);
      assert.equal(await count(), n0);
    });
    await test('quotation: qty 1.5 and VAT 5 % → 400 under lines.0.qty / vatRate', async () => {
      const r = await fieldsOf(
        saveQuotation(
          {
            customerCode: CUSTOMER,
            jobNo: JOB_QUOTE,
            vatRate: 5,
            lines: [
              {
                itemType: 'SparePart',
                code: P.a.code,
                detail: 'TD',
                qty: 1.5,
                unit: 'ชิ้น',
                unitPrice: 100,
                discount: 0,
                discountPercent: 0,
              },
            ],
          },
          U.admin.id,
        ),
      );
      assert.equal(r.status, 400);
      assert.deepEqual(Object.keys(r.fields ?? {}).sort(), ['lines.0.qty', 'vatRate']);
    });
    await test('sale order: paid 1e9 → 400 under paymentAmount (was a 500 from numeric(11,2)), no order', async () => {
      const r = await json(
        await soPOST(
          await request('/api/sale-orders', U.admin, {
            method: 'POST',
            body: {
              customerCode: CUSTOMER,
              salesId: U.admin.id,
              remark: 'TD-1e9',
              paymentAmount: 1e9,
              lines: [{ code: P.b.code, qty: 1 }],
            },
          }),
        ),
      );
      assert.equal(r.status, 400);
      assert.ok((r.body.details as { fields: Record<string, string> }).fields.paymentAmount);
      assert.equal(await soCount('TD-1e9'), 0);
    });
    await test('stock receive: a 51-character PO ref → 400 under poRef (was cut to 50), nothing received', async () => {
      await setStock(P.b.code, 10);
      const r = await json(
        await stockReceivePOST(
          await request('/api/stock/receive', U.admin, {
            method: 'POST',
            body: { date: '2026-10-01', poRef: 'P'.repeat(51), lines: [{ code: P.b.code, qty: 1 }] },
          }),
        ),
      );
      assert.equal(r.status, 400);
      assert.ok((r.body.details as { fields: Record<string, string> }).fields.poRef);
      assert.equal((await qty(P.b.code)).remain, 10);
    });
    await test('stock issue: จ่ายให้ not in the list (store / current staff) → 400 under payTo', async () => {
      const r = await json(
        await stockIssuePOST(
          await request('/api/stock/issue', U.admin, {
            method: 'POST',
            body: { type: 'other', payTo: 'ใครก็ได้', lines: [{ code: P.a.code, qty: 1 }] },
          }),
        ),
      );
      assert.equal(r.status, 400);
      assert.ok((r.body.details as { fields: Record<string, string> }).fields.payTo);
    });
    await test('user: a new user with an existing email → 409 under email, the other user unchanged', async () => {
      const before = (await db.execute(sql`SELECT * FROM app_user WHERE user_id = ${U.clerk.id}`)).rows[0];
      const r = await fieldsOf(
        upsertUser(
          { name: 'TD ซ้ำ อีเมล', role: 'TD Job Clerk', email: ` ${U.clerk.email.toUpperCase()} ` },
          U.admin.id,
        ),
      );
      assert.equal(r.status, 409);
      assert.ok((r.fields as Record<string, string>).email);
      const after = (await db.execute(sql`SELECT * FROM app_user WHERE user_id = ${U.clerk.id}`)).rows[0];
      assert.deepEqual(after, before);
    });
  }
  console.log('\nField formats (agent J) — jobs / masters: legacy values still save, new junk → 400 under the field');
  {
    const { addCallLog, saveSwapRefund } = await import('@/server/services/jobs');
    const { saveSimple, saveSymptom, saveModel } = await import('@/server/services/masters');
    const JOB_LEGACY = 'TDJ0010'; // legacy junk in SO / serial / IMEI / tracking / channel / warranty months
    const LEGACY_PARTS = 'มอเตอร์ดูดฝุ่น H11 MAX,H12';
    await pool.query(`
      DELETE FROM job WHERE job_no = '${JOB_LEGACY}';
      INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date,
                       job_reception_date, job_closed_date, job_reference_no, product_serial, product_imei_no,
                       job_reception_tracking_no, job_reception_shipper, product_sale_out_channel,
                       product_warranty_month, spare_part_replace, swap_refund_document_no)
        VALUES ('${JOB_LEGACY}', 2, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01',
                'so 12', 'SN เสียหาย', '-', 'ไรเดอร์มาส่ง', 'F', 'Online', 1224, '${LEGACY_PARTS}', 'เบิก 1');
      DELETE FROM color WHERE color_name ILIKE 'TD J%';
      DELETE FROM category WHERE category_name ILIKE 'TD J%';
      DELETE FROM symptom WHERE symptom_name ILIKE 'TD J%';
      DELETE FROM model WHERE model_name ILIKE 'TD J%';
      DELETE FROM manufacturer WHERE manufacturer_name = 'TD J Brand';
      INSERT INTO manufacturer (manufacturer_id, manufacturer_name, record_status, is_active)
        VALUES ((SELECT coalesce(max(manufacturer_id), 0) + 1 FROM manufacturer), 'TD J Brand', 'ACTIVE', true);`);
    // what the edit form sends back for a job it loaded (fromJob → toJobInput)
    const asLoaded = async (no: string) => {
      const j = (await getJob(no))!;
      return {
        customerCode: CUSTOMER,
        so: j.so,
        channel: j.channel,
        serial: j.serial,
        imei: j.imei,
        warrantyMonth: j.warrantyMonth,
        receptionTrackingNo: j.receptionTrackingNo,
        receptionShipper: j.receptionShipper,
        receptionDate: j.receptionDate,
        dueDate: j.dueDate,
        version: j.version,
      };
    };
    const row = async (no: string) =>
      (
        await db.execute<Record<string, string>>(sql`
          SELECT job_reference_no AS so, product_serial AS serial, job_reception_tracking_no AS tracking,
                 product_sale_out_shop_name AS shop, job_remark AS remark, spare_part_replace AS parts,
                 return_customer_detail AS ret, job_payment_detail AS pay
            FROM job WHERE job_no = ${no}`)
      ).rows[0];

    await test('J: a legacy job with a junk SO / serial / IMEI / tracking no / channel / 1224 months saves unchanged', async () => {
      const r = await fieldsOf(updateJob(JOB_LEGACY, await asLoaded(JOB_LEGACY), U.admin.id));
      assert.equal(r.status, 200, JSON.stringify(r.fields ?? r));
      const j = await row(JOB_LEGACY);
      // R5 "never worse": a value equal to the stored one once cleaned keeps the stored text (no re-cleaning)
      assert.deepEqual([j.so, j.serial, j.tracking], ['so 12', 'SN เสียหาย', 'ไรเดอร์มาส่ง'], 'kept as stored');
    });
    await test('J: changing them to new junk → 400 under each field, nothing saved', async () => {
      const base = await asLoaded(JOB_LEGACY);
      const r = await fieldsOf(
        updateJob(
          JOB_LEGACY,
          {
            ...base,
            so: 'ไม่มี',
            serial: 'SN หาย',
            imei: '123',
            receptionTrackingNo: 'มาส่งเอง',
            channel: 'Offline',
            warrantyMonth: 1225,
            receptionShipper: 'TD ขนส่งไม่มีจริง',
            productType: 'TD-NOPE-TYPE',
            remark: 'TD junk',
          },
          U.admin.id,
        ),
      );
      assert.equal(r.status, 400);
      assert.deepEqual(Object.keys(r.fields ?? {}).sort(), [
        'channel',
        'imei',
        'receptionTrackingNo',
        'serial',
        'so',
        'warrantyMonth',
      ]);
      // the master-list checks answer once the formats are right
      const m = await fieldsOf(
        updateJob(
          JOB_LEGACY,
          { ...base, receptionShipper: 'TD ขนส่งไม่มีจริง', productType: 'TD-NOPE-TYPE' },
          U.admin.id,
        ),
      );
      assert.deepEqual(Object.keys(m.fields ?? {}).sort(), ['productType', 'receptionShipper']);
      assert.notEqual((await row(JOB_LEGACY)).remark, 'TD junk');
    });
    await test('J: values are stored cleaned (cleanCode / no "S/N:" / no spaces in parcel no / clean text)', async () => {
      const r = await fieldsOf(
        updateJob(
          JOB_LEGACY,
          {
            ...(await asLoaded(JOB_LEGACY)),
            so: ' so-2600123 ',
            serial: 's/n: ab12345',
            imei: '',
            receptionTrackingNo: 'th 1234 5678 9ΤΗ',
            shopName: '  ร้าน​   A  ',
            remark: ' บรรทัด 1  \n  บรรทัด 2 ',
          },
          U.admin.id,
        ),
      );
      assert.equal(r.status, 200, JSON.stringify(r.fields ?? r));
      const j = await row(JOB_LEGACY);
      assert.deepEqual(
        [j.so, j.serial, j.tracking, j.shop, j.remark],
        ['SO-2600123', 'AB12345', 'TH123456789TH', 'ร้าน A', 'บรรทัด 1\nบรรทัด 2'],
      );
    });
    await test('J: repair "New Serial" is added to the legacy part list, never written over it', async () => {
      await saveRepair(JOB_LEGACY, { status: 'ซ่อมเสร็จ', newSerial: 'new0001' }, U.admin.id);
      assert.equal((await row(JOB_LEGACY)).parts, `${LEGACY_PARTS}\nNew S/N: NEW0001`);
      await saveRepair(JOB_LEGACY, { status: 'ซ่อมเสร็จ', newSerial: 'NEW0002' }, U.admin.id);
      assert.equal((await row(JOB_LEGACY)).parts, `${LEGACY_PARTS}\nNew S/N: NEW0002`, 'the earlier one is replaced');
      const r = await fieldsOf(saveRepair(JOB_LEGACY, { status: 'ซ่อมเสร็จ', newSerial: 'SN ใหม่' }, U.admin.id));
      assert.deepEqual([r.status, Object.keys(r.fields ?? {})], [400, ['newSerial']]);
    });
    await test('J: swap — legacy doc no unchanged passes, the part list is kept; refund over 1,000,000 → 400', async () => {
      const ok = await fieldsOf(
        saveSwapRefund(JOB_LEGACY, { status: 'ซ่อมเสร็จ', newSerial: 'SWAP0001', docNo: 'เบิก 1' }, U.admin.id),
      );
      assert.equal(ok.status, 200, JSON.stringify(ok.fields ?? ok));
      assert.equal((await row(JOB_LEGACY)).parts, `${LEGACY_PARTS}\nNew S/N: SWAP0001`);
      const bad = await fieldsOf(
        saveSwapRefund(JOB_LEGACY, { status: 'ซ่อมเสร็จ', newSerial: 'SWAP0001', docNo: 'เบิก 2' }, U.admin.id),
      );
      assert.deepEqual(Object.keys(bad.fields ?? {}), ['docNo']);
      const refund = await fieldsOf(
        saveSwapRefund(
          JOB_LEGACY,
          { status: 'ซ่อมเสร็จ', refundAmount: 1000000.5, refundMethod: 'เงินสด' },
          U.admin.id,
        ),
      );
      assert.deepEqual([refund.status, Object.keys(refund.fields ?? {})], [400, ['refundAmount']]);
    });
    await test('J: close — parcel no stored without spaces; the courier / date prefix is not added twice', async () => {
      const input = {
        status: 'ซ่อมเสร็จ',
        payment: { type: 'เงินสด', date: '2026-10-01', detail: 'จ่ายครบ' },
        return: {
          type: 'ส่งไปรษณีย์',
          date: '2026-10-01',
          tracking: 'ed 0063 9063 5th',
          courier: 'Flash',
          detail: 'ฝากหน้าบ้าน',
        },
      };
      await closeJob(JOB_LEGACY, input, U.admin.id);
      let j = await row(JOB_LEGACY);
      // saved again with what the close screen loads back (the stored, already-prefixed texts)
      await closeJob(
        JOB_LEGACY,
        { ...input, payment: { ...input.payment, detail: j.pay }, return: { ...input.return, detail: j.ret } },
        U.admin.id,
      );
      j = await row(JOB_LEGACY);
      assert.deepEqual([j.pay, j.ret], ['ชำระ 2026-10-01 · จ่ายครบ', 'Flash · ฝากหน้าบ้าน']);
      const [t] = (
        await db.execute<{ t: string }>(
          sql`SELECT return_customer_tracking_no AS t FROM job WHERE job_no = ${JOB_LEGACY}`,
        )
      ).rows;
      assert.equal(t.t, 'ED006390635TH');
    });
    await test('J: call log of 201+ characters → 400, nothing saved (it used to keep the first 200)', async () => {
      const count = async () =>
        (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM job_call_log WHERE job_no = ${JOB_LEGACY}`))
          .rows[0].n;
      const before = await count();
      const r = await fieldsOf(addCallLog(JOB_LEGACY, 'ก'.repeat(201), U.admin.id));
      assert.deepEqual([r.status, Object.keys(r.fields ?? {})], [400, ['detail']]);
      assert.equal(await count(), before);
      const rows = await addCallLog(JOB_LEGACY, 'ข'.repeat(200), U.admin.id);
      assert.equal(rows[0]?.detail, 'ข'.repeat(200), 'all 200 kept');
    });
    await test('J: master names unique ignoring case and spaces → 409 under name; a row keeping its name saves', async () => {
      const first = await saveSimple('colors', { name: 'TD J Navy Blue' }, U.admin.id);
      const dup = await fieldsOf(saveSimple('colors', { name: ' td j  navyblue ' }, U.admin.id));
      // R3: the line under the name is the whole message — it names the row that has the name
      assert.deepEqual([dup.status, dup.fields], [409, { name: dup.message }]);
      assert.match(dup.message ?? '', /^มีชื่อนี้อยู่แล้ว: "TD J Navy Blue"/);
      assert.equal(
        (await fieldsOf(saveSimple('colors', { id: first.id, name: 'TD J Navy Blue', detail: 'x' }, U.admin.id)))
          .status,
        200,
      );
      // explicit id: other fixtures insert symptom ids by hand, the identity sequence lags behind
      await db.execute(sql`INSERT INTO symptom (symptom_id, symptom_name, record_status)
        VALUES ((SELECT coalesce(max(symptom_id), 0) + 1 FROM symptom), 'TD J เปิดไม่ติด', 'ACTIVE')`);
      assert.equal((await fieldsOf(saveSymptom({ name: 'td j เปิด ไม่ติด' }, U.admin.id))).status, 409);
    });
    await test('J: category detail of 51+ characters → 400 under detail (was a 500); 50 saves', async () => {
      const r = await fieldsOf(saveSimple('categories', { name: 'TD J Cat', detail: 'ก'.repeat(51) }, U.admin.id));
      assert.deepEqual([r.status, Object.keys(r.fields ?? {})], [400, ['detail']]);
      assert.equal(
        (await fieldsOf(saveSimple('categories', { name: 'TD J Cat', detail: 'ก'.repeat(50) }, U.admin.id))).status,
        200,
      );
    });
    await test('J: model name twice for one brand (ignoring case / spaces) → 409, not a 500', async () => {
      const m = await saveModel({ name: 'TD J Model X1', brand: 'TD J Brand', price: 0 }, U.admin.id);
      const dup = await fieldsOf(saveModel({ name: 'td j model  x1', brand: 'TD J Brand', price: 0 }, U.admin.id));
      assert.deepEqual([dup.status, dup.fields], [409, { name: dup.message }]);
      assert.match(dup.message ?? '', /^มีชื่อนี้อยู่แล้ว: "TD J Model X1" \(รหัส /);
      const same = await fieldsOf(
        saveModel({ code: m.code, name: 'TD J Model X1', brand: 'TD J Brand', price: 10 }, U.admin.id),
      );
      assert.equal(same.status, 200, 'editing the model itself');
      const long = await fieldsOf(saveModel({ name: 'X'.repeat(51), brand: 'TD J Brand', price: 0 }, U.admin.id));
      assert.deepEqual(Object.keys(long.fields ?? {}), ['name']);
    });
  }

  // ── Round 1: sale orders + customers + addresses ──
  console.log('\nRound 1 — sale orders + customers + addresses');
  {
    const newSO = async (code: string) => {
      const r = await json(
        await soPOST(
          await request('/api/sale-orders', U.admin, {
            method: 'POST',
            body: { customerCode: CUSTOMER, salesId: U.admin.id, submit: true, lines: [{ code, qty: 1 }] },
          }),
        ),
      );
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return (r.body.order as { no: string }).no;
    };
    const decide = async (no: string, decision: string) =>
      (
        await soApprovePOST(
          await request(`/api/sale-orders/${no}/approve`, U.admin, {
            method: 'POST',
            body: { decision, remark: 'TD reason' }, // deny / send back need a reason (round 2)
          }),
          { params: Promise.resolve({ no }) },
        )
      ).status;
    await test('R1: a denied sale order cannot be approved / sent back / re-saved (409, no stock out); approve ∥ deny → one wins', async () => {
      await setStock(P.b.code, 10);
      const no = await newSO(P.b.code);
      assert.equal(await decide(no, 'deny'), 200);
      assert.deepEqual(
        [await decide(no, 'approve'), await decide(no, 'reject'), await decide(no, 'deny')],
        [409, 409, 409],
      );
      const edit = await soPOST(
        await request('/api/sale-orders', U.admin, {
          method: 'POST',
          body: { no, customerCode: CUSTOMER, salesId: U.admin.id, submit: true, lines: [{ code: P.b.code, qty: 1 }] },
        }),
      );
      assert.equal(edit.status, 409, 're-saving would put it back to "waiting"');
      const [hd] = (
        await db.execute<{ s: number }>(
          sql`SELECT approve_status_id AS s FROM sale_out_hd WHERE sale_out_hd_no = ${no}`,
        )
      ).rows;
      assert.equal(hd.s, 5);
      assert.equal((await qty(P.b.code)).remain, 10, 'nothing went out');
      // the row lock: two people deciding at once — exactly one decision lands
      const race = await newSO(P.b.code);
      const both = await Promise.all([decide(race, 'approve'), decide(race, 'deny')]);
      assert.deepEqual([...both].sort(), [200, 409]);
      assert.equal((await qty(P.b.code)).remain, both[0] === 200 ? 9 : 10);
    });

    // address master rows (the test DB has none): Bangkok names carry their own แขวง / เขต prefix
    await pool.query(`
      INSERT INTO mt_city (city_id, name_en, name_th, region) VALUES
        (10, 'Bangkok', 'กรุงเทพมหานคร', 'Central'), (9950, 'TD Chiang Mai', 'เชียงใหม่', 'North') ON CONFLICT DO NOTHING;
      INSERT INTO mt_district (city_id, district_id, name_en, name_th, postal_code) VALUES
        (10, 9901, 'TD Huai Khwang', 'เขตห้วยขวาง', '10310'), (9950, 9951, 'TD Mueang', 'เมืองเชียงใหม่', '50000') ON CONFLICT DO NOTHING;
      INSERT INTO mt_sub_district (city_id, district_id, sub_district_id, name_en, name_th, postal_code) VALUES
        (10, 9901, 99011, 'TD Huai Khwang', 'แขวงห้วยขวาง', '10310'), (9950, 9951, 99511, 'TD Si Phum', 'ศรีภูมิ', '50000') ON CONFLICT DO NOTHING;
    `);
    // the test DB has C00001/C00002 but no Customer running_no row → the first new code would collide
    await pool.query(`
      INSERT INTO running_no (running_type, company_id, branch_id, prefix, pyear, pmonth, pday, number, length_year, length_month, length_number)
        SELECT 'Customer', 0, 0, 'C', 0, 0, 0, 90000, 0, 0, 5
         WHERE NOT EXISTS (SELECT 1 FROM running_no WHERE running_type = 'Customer');`);
    const mobile = () => `08${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const newCustomer = async (body: Record<string, unknown>) =>
      json(
        await customerPOST(
          await request('/api/customers', U.admin, { method: 'POST', body: { phone: mobile(), ...body } }),
        ),
      );
    const storedAddress = async (code: string) =>
      (
        await db.execute<{ a: string; p: string }>(
          sql`SELECT customer_address AS a, postal_code AS p FROM customer WHERE customer_code = ${code}`,
        )
      ).rows[0];
    await test('R1: a real postal code that differs from the ตำบล master (50200 vs 50000) saves; a non-5-digit one → 400', async () => {
      const where = { name: 'TD R1 เชียงใหม่', address1: '1', cityId: 9950, districtId: 9951, subDistrictId: 99511 };
      const ok = await newCustomer({ ...where, postalCode: '50200' });
      assert.equal(ok.status, 201, JSON.stringify(ok.body));
      const c = await storedAddress((ok.body.row as { code: string }).code);
      assert.equal(c.p, '50200');
      assert.equal(c.a, '1 ต.ศรีภูมิ อ.เมืองเชียงใหม่ จ.เชียงใหม่ 50200');
      const bad = await newCustomer({ ...where, postalCode: '5020' });
      assert.equal(bad.status, 400);
      assert.ok((bad.body.details as { fields: Record<string, string> }).fields.postalCode);
    });
    await test('R1: Bangkok address keeps one แขวง / เขต prefix (was "แขวงแขวงห้วยขวาง เขตเขตห้วยขวาง")', async () => {
      const r = await newCustomer({
        name: 'TD R1 กรุงเทพ',
        address1: '99/1',
        cityId: 10,
        districtId: 9901,
        subDistrictId: 99011,
        postalCode: '10310',
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      const c = await storedAddress((r.body.row as { code: string }).code);
      assert.equal(c.a, '99/1 แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพมหานคร 10310');
      const { withPrefix } = await import('@/lib/validation/customer');
      assert.equal(withPrefix('ต.', 'จ.ป.ร.'), 'ต.จ.ป.ร.', 'a ตำบล named จ.ป.ร. still gets ต.');
      assert.equal(withPrefix('อ.', 'กิ่งอำเภอบ้านแฮด'), 'กิ่งอำเภอบ้านแฮด');
    });
  }
  // ── Round 1: app shell + admin users ──
  console.log('\nRound 1 — admin users: an admin cannot revoke, disable, delete or re-role their own account');
  {
    const { upsertUser, setUserDeleted } = await import('@/server/services/users');
    const { POST: recordsPOST } = await import('@/app/api/admin/records/route');
    await test('admin users: self revoke / role change / delete / disable → 409, own row unchanged; editing own name saves', async () => {
      const row = async () =>
        (await db.execute(sql`SELECT user_type, record_status FROM app_user WHERE user_id = ${U.admin.id}`)).rows[0];
      const before = await row();
      const self = { id: String(U.admin.id), name: 'TD td-admin', role: 'System Admin' };
      assert.equal(await statusOf(upsertUser({ ...self, status: 'Inactive' }, U.admin.id)), 409, 'ถอนสิทธิ์ตัวเอง');
      assert.equal(await statusOf(upsertUser({ ...self, role: 'TD Job Clerk' }, U.admin.id)), 409, 'role change');
      assert.equal(await statusOf(setUserDeleted(U.admin.id, true, U.admin.id)), 409, 'delete (service)');
      for (const status of ['DELETED', 'INACTIVE']) {
        const r = await recordsPOST(
          await request('/api/admin/records', U.admin, {
            method: 'POST',
            body: { table: 'users', id: U.admin.id, status },
          }),
        );
        assert.equal(r.status, 409, `records ${status}`);
      }
      assert.deepEqual(await row(), before);
      // never worse: the admin still edits their own row when role + status stay
      assert.equal(await statusOf(upsertUser({ ...self, status: 'Active' }, U.admin.id)), 200);
    });
  }
  // ── Round 1: stock + products ──
  console.log('\nRound 1 — stock + products');
  {
    const { saveProduct, getProduct, pageProducts, listProductsLite, jobsWithPendingParts } =
      await import('@/server/services/stock');
    const { GET: pickLinesGET } = await import('@/app/api/stock/pick-lines/route');
    await test('R1 stock: a product form saved with the version it loaded after another save → 409, the new price stays', async () => {
      const p0 = (await getProduct(P.b.code))!;
      const form = { sysCode: P.b.code, name: p0.name, mfgCode: '' };
      await saveProduct({ ...form, price: 250, version: p0.version }, U.admin.id);
      const p1 = (await getProduct(P.b.code))!;
      assert.equal(p1.price, 250);
      assert.notEqual(p1.version, p0.version, 'a price change moves the version');
      // the stale dialog: the old price + the version it was filled from — refused, nothing written
      assert.equal(await statusOf(saveProduct({ ...form, price: p0.price, version: p0.version }, U.admin.id)), 409);
      assert.equal((await getProduct(P.b.code))!.price, 250);
      // stock counters are not part of the form: a movement never makes an open form stale
      await setStock(P.b.code, 7);
      assert.equal((await getProduct(P.b.code))!.version, p1.version);
      assert.equal(await statusOf(saveProduct({ ...form, price: 260, version: p1.version }, U.admin.id)), 200);
      assert.equal((await getProduct(P.b.code))!.price, 260);
      await setStock(P.b.code, 10);
    });
    await test('R1 stock: no parts issued to a closed / cancelled job (service, pick lines, dropdown); open again → offered', async () => {
      const jobNo = 'TDJ0131';
      await pool.query(`
        INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date)
          VALUES ('${jobNo}', 20, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01');
        INSERT INTO job_order_spare_part_log (job_no, spare_part_code, spare_part_serial_no, stock_id, is_quotation, is_special, request_qty, order_status_id, request_date, request_by, grant_qty, return_qty)
          VALUES ('${jobNo}', '${P.a.code}', '', 1, false, true, 1, 1, now(), 9101, 0, 0);`);
      const [log] = (
        await db.execute<{ id: number }>(
          sql`SELECT job_order_log_id AS id FROM job_order_spare_part_log WHERE job_no = ${jobNo}`,
        )
      ).rows;
      const before = await qty(P.a.code);
      for (const status of [20, 0, 6]) {
        await db.execute(sql`UPDATE job SET job_status_id = ${status} WHERE job_no = ${jobNo}`);
        assert.equal(
          await statusOf(issueForJob({ jobNo, lines: [{ logId: log.id, qty: 1 }] }, U.admin.id)),
          409,
          `status ${status}`,
        );
        const r = await pickLinesGET(await request(`/api/stock/pick-lines?type=job&ref=${jobNo}`, U.admin));
        assert.equal(r.status, 409, `pick lines, status ${status}`);
        assert.ok(!(await jobsWithPendingParts()).includes(jobNo), `dropdown, status ${status}`);
      }
      assert.deepEqual(await qty(P.a.code), before, 'nothing went out');
      await db.execute(sql`UPDATE job SET job_status_id = 11 WHERE job_no = ${jobNo}`);
      assert.ok((await jobsWithPendingParts()).includes(jobNo), 'an open job is offered');
      const r = await pickLinesGET(await request(`/api/stock/pick-lines?type=job&ref=${jobNo}`, U.admin));
      assert.equal(r.status, 200);
    });
    await test('R1 stock: product name search finds the English / Chinese name (list q, name filter, picker lite rows)', async () => {
      await db.execute(sql`UPDATE product SET product_name_en = 'TD Round1 Hinge Cover', product_name_cn = 'TD铰链盖',
        record_status = 'ACTIVE' WHERE product_code = ${P.a.code}`);
      const codes = async (q: string, f: { name?: string }) =>
        (await pageProducts({ page: 1, pageSize: 25, q, f: {} }, f)).rows.map((r) => r.sysCode);
      assert.ok((await codes('round1 hinge', {})).includes(P.a.code), 'search box');
      assert.ok((await codes('', { name: 'Hinge Cover' })).includes(P.a.code), 'ชื่ออะไหล่ filter (EN)');
      assert.ok((await codes('', { name: '铰链' })).includes(P.a.code), 'ชื่ออะไหล่ filter (CN)');
      const lite = await listProductsLite('Round1 Hinge');
      assert.deepEqual(
        lite.map((p) => [p.sysCode, p.nameEn]),
        [[P.a.code, 'TD Round1 Hinge Cover']],
      );
    });
  }
  // ── Round 1: jobs ──
  console.log('\nRound 1 — jobs (repair / close / out-source / job list)');
  {
    const { markPartsIssued, listJobs } = await import('@/server/services/jobs');
    const { invalidate } = await import('@/server/cache');
    const { OUTSOURCE_STATUS_ONLY, RECEIVE_DATE_REQUIRED, STATUS_CLOSE_ONLY } = await import('@/lib/validation/job');
    const job = (no: string, status: number, customer = `${CUSTOMER} ลูกค้า ทดสอบโดเมน`) =>
      `('${no}', ${status}, 9001, '${customer}', 'Model TD', now(), current_date, '1900-01-01')`;
    // เบิก 1, nothing issued
    const pending = (no: string) => `('${no}', '${P.a.code}', '', 1, true, true, 1, 1, now(), 9101, 0, 0)`;
    await pool.query(`
      INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
        SELECT * FROM (VALUES (3, 'อยู่ระหว่างการซ่อม - รออะไหล่', 3, 'Pending', true),
                              (7, 'ปิดงาน-ส่งคืนสินค้า (รอลงเลขที่พัสดุ)', 7, 'Finished', true),
                              (8, 'ปิดงาน-ส่งคืนสินค้า (ลงเลขที่พัสดุแล้ว)', 8, 'Finished', true),
                              (10, 'อยู่ระหว่างการซ่อม - เบิกจ่ายอะไหล่ครบแล้ว', 10, 'Pending', true),
                              (11, 'อยู่ระหว่างการซ่อม - เริ่มเบิกอะไหล่', 11, 'Pending', true)) v(id, name, ord, grp, act)
         WHERE NOT EXISTS (SELECT 1 FROM job_status s WHERE s.job_status_id = v.id);
      INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date)
        VALUES ${job('TDJ0201', 5)}, ${job('TDJ0202', 7)}, ${job('TDJ0203', 2)}, ${job('TDJ0204', 3)},
               ${job('TDJ0205', 2)}, ${job('TDJ0206', 2, `${CUSTOMER} ลูกค้า R1 โทร 081-496-9925`)}, ${job('TDJ0207', 5)};
      INSERT INTO job_order_spare_part_log (job_no, spare_part_code, spare_part_serial_no, stock_id, is_quotation, is_special, request_qty, order_status_id, request_date, request_by, grant_qty, return_qty)
        VALUES ${pending('TDJ0203')}, ${pending('TDJ0204')};`);
    invalidate('jobstatus'); // the statuses above, by name
    await test('R1 jobs: close with no payment entered (in-warranty, total 0) writes no payment method / note', async () => {
      // what the close page sends when nobody touched the payment tab: no payment block
      await closeJob(
        'TDJ0201',
        { status: await statusName(20), return: { type: 'ลูกค้ามารับเอง', date: '2026-10-15' } },
        U.admin.id,
      );
      const [j] = (
        await db.execute<{ s: number; t: string; d: string }>(sql`
          SELECT job_status_id AS s, coalesce(job_payment_type, '') AS t, coalesce(job_payment_detail, '') AS d
            FROM job WHERE job_no = 'TDJ0201'`)
      ).rows;
      assert.deepEqual([j.s, j.t, j.d], [20, '', '']);
    });
    await test('R1 jobs: a job at 7 saved again with a parcel no. moves to 8 (+ job_log); 8 needs the no. on every path', async () => {
      const input = { type: 'บริษัทขนส่งเอกชน', date: '2026-10-15' };
      await db.execute(sql`UPDATE job SET job_closed_date = '2026-10-01 10:00:00' WHERE job_no = 'TDJ0202'`);
      await closeJob(
        'TDJ0202',
        { status: await statusName(7), return: { ...input, tracking: 'th 1234 5678 9th' } },
        U.admin.id,
      );
      assert.equal((await jobRow('TDJ0202')).s, 8);
      assert.equal((await jobRow('TDJ0202')).closed, '2026-10-01 10:00:00', 'the late parcel no. keeps the close date');
      assert.deepEqual(await logRows('TDJ0202'), [8]);
      // the reverse: no parcel no. stored → 8 refused from the close screen and from the others
      const close = await fieldsOf(closeJob('TDJ0207', { status: await statusName(8), return: input }, U.admin.id));
      assert.deepEqual([close.status, Object.keys(close.fields ?? {})], [400, ['return.tracking']]);
      // R5: the repair page cannot close a job at all (only ปิดงาน closes)
      const repair = await fieldsOf(saveRepair('TDJ0207', { status: await statusName(8) }, U.admin.id));
      assert.deepEqual([repair.status, repair.fields], [400, { status: STATUS_CLOSE_ONLY }]);
      assert.equal((await jobRow('TDJ0207')).s, 5);
    });
    await test('R1 jobs: ซ่อมเสร็จ refused while a เบิก part is not issued; เสนอ-only and a job already at 5 save', async () => {
      const r = await fieldsOf(saveRepair('TDJ0203', { status: 'ซ่อมเสร็จ' }, U.admin.id));
      assert.equal(r.status, 400);
      assert.ok(r.fields && 'status' in r.fields && String(r.fields.status).includes(P.a.code), JSON.stringify(r));
      assert.equal((await jobRow('TDJ0203')).s, 2, 'status unchanged');
      // a quotation-only line (เสนอ, not เบิก): the customer has not agreed, stock owes nothing
      await db.execute(sql`UPDATE job_order_spare_part_log SET is_special = false WHERE job_no = 'TDJ0203'`);
      assert.equal((await fieldsOf(saveRepair('TDJ0203', { status: 'ซ่อมเสร็จ' }, U.admin.id))).status, 200);
      assert.equal((await jobRow('TDJ0203')).s, 5);
      // legacy: already at 5 with a line still waiting — re-saving it is not blocked
      await db.execute(sql`UPDATE job_order_spare_part_log SET is_special = true WHERE job_no = 'TDJ0203'`);
      const again = await fieldsOf(saveRepair('TDJ0203', { status: 'ซ่อมเสร็จ', repairDetail: 'TD R1' }, U.admin.id));
      assert.equal(again.status, 200);
    });
    await test('R1 jobs: stock issues every part of a job in รออะไหล่ (3) → เบิกจ่ายอะไหล่ครบแล้ว (10) + job_log', async () => {
      await setStock(P.a.code, 10);
      const [log] = (
        await db.execute<{ id: number }>(
          sql`SELECT job_order_log_id AS id FROM job_order_spare_part_log WHERE job_no = 'TDJ0204'`,
        )
      ).rows;
      const r = await issueForJob({ jobNo: 'TDJ0204', lines: [{ logId: log.id, qty: 1 }] }, U.admin.id);
      assert.ok(r.allGranted);
      await markPartsIssued('TDJ0204', U.admin.id); // what POST /api/stock/issue calls next
      assert.equal((await jobRow('TDJ0204')).s, 10);
      assert.deepEqual(await logRows('TDJ0204'), [10]);
    });
    await test('R1 jobs: out-source receive needs its date; saving again keeps one row; other statuses → 400', async () => {
      const [s14, s15] = [await statusName(14), await statusName(15)];
      const send = { to: 'TD Vendor R1', date: '2026-10-10' };
      await saveOutsource('TDJ0205', { send, status: s14 }, U.admin.id);
      const noDate = await fieldsOf(
        saveOutsource('TDJ0205', { receive: { from: send.to, date: '', detail: 'TD back' }, status: s15 }, U.admin.id),
      );
      assert.deepEqual([noDate.status, noDate.fields], [400, { 'receive.date': RECEIVE_DATE_REQUIRED }]);
      assert.equal((await jobRow('TDJ0205')).s, 14, 'still out');
      await saveOutsource('TDJ0205', { receive: { from: send.to, date: '2026-10-12' }, status: s15 }, U.admin.id);
      // the page saved again once the row is back (it then sends the send block): the same row, still 15
      await saveOutsource('TDJ0205', { send: { ...send, detail: 'TD again' }, status: s15 }, U.admin.id);
      const rows = (
        await db.execute<{ st: string; d: string }>(
          sql`SELECT send_status AS st, send_detail AS d FROM job_send_forward_dt WHERE job_no = 'TDJ0205'`,
        )
      ).rows;
      assert.deepEqual(rows, [{ st: 'รับเครื่องซ่อมแล้ว', d: 'TD again' }]);
      assert.equal((await jobRow('TDJ0205')).s, 15);
      const bad = await fieldsOf(saveOutsource('TDJ0205', { send, status: await statusName(1) }, U.admin.id));
      assert.deepEqual([bad.status, bad.fields], [400, { status: OUTSOURCE_STATUS_ONLY }]);
    });
    await test('R1 jobs: the job-list search finds a phone typed as digits in "081-496-9925"', async () => {
      const found = async (q: string) => (await listJobs({ q })).some((j) => j.no === 'TDJ0206');
      assert.ok(await found('0814969925'), 'digits only');
      assert.ok(await found('081 496 9925'), 'with spaces');
      assert.ok(!(await found('0814969926')), 'another number');
      // the phone filter too — '\\D' in a drizzle sql`` template (a single '\D' reached Postgres as 'D')
      assert.ok(
        (await listJobs({ phone: '0814969925' })).some((j) => j.no === 'TDJ0206'),
        'phone filter',
      );
    });
    await test('R1: customer search finds a phone stored with dashes ("02-000-0000") typed as digits', async () => {
      const { listCustomers } = await import('@/server/services/customers');
      const hit = async (o: Parameters<typeof listCustomers>[0]) =>
        (await listCustomers(o)).some((c) => c.code === CUSTOMER);
      assert.ok(await hit({ q: '020000000' }), 'search box');
      assert.ok(await hit({ filters: { phone: '020000000' } }), 'phone filter');
    });
    await test('R1: a เสนอ-only part line (not ticked เบิก) is not offered to stock and cannot be issued', async () => {
      const { listPartRequests, jobsWithPendingParts } = await import('@/server/services/stock');
      await pool.query(`INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date)
                          VALUES ${job('TDJ0208', 2)};
                        INSERT INTO job_order_spare_part_log (job_no, spare_part_code, spare_part_serial_no, stock_id, is_quotation, is_special, request_qty, order_status_id, request_date, request_by, grant_qty, return_qty)
                          VALUES ('TDJ0208', '${P.a.code}', '', 1, true, false, 1, 1, now(), 9101, 0, 0);`);
      assert.deepEqual(await listPartRequests('TDJ0208', true), []);
      assert.ok(!(await jobsWithPendingParts()).includes('TDJ0208'));
      const [log] = (
        await db.execute<{ id: number }>(
          sql`SELECT job_order_log_id AS id FROM job_order_spare_part_log WHERE job_no = 'TDJ0208'`,
        )
      ).rows;
      assert.equal(
        await statusOf(issueForJob({ jobNo: 'TDJ0208', lines: [{ logId: log.id, qty: 1 }] }, U.admin.id)),
        400,
      );
    });
  }
  // ── Round 2: stock + products ──
  console.log('\nRound 2 — stock + products');
  {
    const { saleOrdersToPick, listSaleOrderPickLines, issueForSaleOrder, jobsWithPendingParts } =
      await import('@/server/services/stock');
    const { GET: pickLinesGET } = await import('@/app/api/stock/pick-lines/route');
    await test('R2 stock: ราคาทุน — a role without Product edit gets no cost in the product API JSON or the export; an admin does', async () => {
      const { invalidateGrantCache } = await import('@/server/auth');
      const { GET: productGET } = await import('@/app/api/products/[code]/route');
      const { exportXlsx } = await import('@/server/export');
      const ExcelJS = (await import('exceljs')).default;
      await db.execute(sql`UPDATE product_none_serial SET capital_price = 55.00 WHERE product_id = ${P.a.id}`);
      // TD Seller may view products (the export needs it) but not edit them
      await pool.query(`INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view)
                          VALUES ('TD Seller', 'Product', false, false, false, true)`);
      invalidateGrantCache();
      try {
        const detail = async (u: TestUser) =>
          (
            await json(
              await productGET(await request(`/api/products/${P.a.code}`, u), {
                params: Promise.resolve({ code: P.a.code }),
              }),
            )
          ).body.product as Record<string, unknown>;
        assert.ok(!('capitalPrice' in (await detail(U.seller))), 'detail JSON');
        assert.equal((await detail(U.admin)).capitalPrice, 55);
        const list = await json(
          await dataGET(await request(`/api/data/products?paged=1&sysCode=${P.a.code}`, U.seller), {
            params: Promise.resolve({ resource: 'products' }),
          }),
        );
        const rows = (list.body as { rows: Record<string, unknown>[] }).rows;
        assert.ok(rows.length > 0 && rows.every((r) => !('capitalPrice' in r)), 'list JSON');
        const sheet = async (u: TestUser) => {
          const { buffer } = await exportXlsx(await request(`/api/export/products?sysCode=${P.a.code}`, u), 'products');
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer as unknown as ArrayBuffer);
          const ws = wb.worksheets[0]!;
          return [1, 2].map((n) => (ws.getRow(n).values as unknown[]).slice(1));
        };
        const [head, row] = await sheet(U.seller);
        assert.ok(!head.includes('ราคาทุน'), 'export header');
        assert.ok(!row.includes(55), 'export row');
        const [adminHead, adminRow] = await sheet(U.admin);
        assert.equal(adminRow[adminHead.indexOf('ราคาทุน')], 55);
      } finally {
        await pool.query(`DELETE FROM app_config WHERE user_type = 'TD Seller' AND module_name = 'Product'`);
        invalidateGrantCache();
      }
    });
    await test('R2 stock: no parts issued to a job at 22 ซ่อมเสร็จ (ไม่พบอาการเสีย ขอส่งคืน) — service, pick lines, dropdown', async () => {
      const jobNo = 'TDJS221';
      await pool.query(`
        INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date)
          VALUES ('${jobNo}', 22, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01');
        INSERT INTO job_order_spare_part_log (job_no, spare_part_code, spare_part_serial_no, stock_id, is_quotation, is_special, request_qty, order_status_id, request_date, request_by, grant_qty, return_qty)
          VALUES ('${jobNo}', '${P.a.code}', '', 1, false, true, 1, 1, now(), 9101, 0, 0);`);
      const [log] = (
        await db.execute<{ id: number }>(
          sql`SELECT job_order_log_id AS id FROM job_order_spare_part_log WHERE job_no = ${jobNo}`,
        )
      ).rows;
      const before = await qty(P.a.code);
      assert.equal(await statusOf(issueForJob({ jobNo, lines: [{ logId: log.id, qty: 1 }] }, U.admin.id)), 409);
      const r = await pickLinesGET(await request(`/api/stock/pick-lines?type=job&ref=${jobNo}`, U.admin));
      assert.equal(r.status, 409, 'pick lines');
      assert.ok(!(await jobsWithPendingParts()).includes(jobNo), 'dropdown');
      assert.deepEqual(await qty(P.a.code), before, 'nothing went out');
    });
    await test('R2 stock: an approved sale order (issued at approval) is not offered to จ่ายออกตามใบสั่งขาย; issuing again → 409 naming the WHO', async () => {
      const { GET: pickOrdersGET } = await import('@/app/api/stock/pick-orders/route');
      await setStock(P.b.code, 10);
      const created = await json(
        await soPOST(
          await request('/api/sale-orders', U.admin, {
            method: 'POST',
            body: { customerCode: CUSTOMER, salesId: U.admin.id, submit: true, lines: [{ code: P.b.code, qty: 1 }] },
          }),
        ),
      );
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const no = (created.body.order as { no: string }).no;
      const approved = await soApprovePOST(
        await request(`/api/sale-orders/${no}/approve`, U.admin, { method: 'POST', body: { decision: 'approve' } }),
        { params: Promise.resolve({ no }) },
      );
      assert.equal(approved.status, 200);
      const [line] = await listSaleOrderPickLines(no);
      assert.ok(line.picked && line.pickNo, 'approval issued the line');
      const offered = async () =>
        (
          (await json(await pickOrdersGET(await request('/api/stock/pick-orders', U.picker)))).body.rows as string[]
        ).includes(no);
      assert.ok(!(await offered()), 'not offered: nothing left to issue');
      const err = await issueForSaleOrder({ soNo: no }, U.admin.id).catch((e: unknown) => e);
      assert.ok(err instanceof HttpError && err.status === 409 && err.message.includes(line.pickNo), String(err));
      assert.equal((await qty(P.b.code)).remain, 9, 'stock went out once');
      // a legacy approved order with a line no WHO issued yet is offered
      await db.execute(sql`UPDATE sale_out_dt SET pick_inventory_no = '' WHERE sale_out_hd_no = ${no}`);
      assert.ok(await offered(), 'offered while a line is left');
      assert.ok((await saleOrdersToPick()).includes(no));
      await db.execute(sql`UPDATE sale_out_dt SET pick_inventory_no = ${line.pickNo} WHERE sale_out_hd_no = ${no}`);
    });
  }
  // ── Round 2: sale orders + quotations + customers ──
  console.log('\nRound 2 — sale orders + quotations + customers');
  {
    const { SELF_APPROVE, REASON_REQUIRED, getSaleOrder } = await import('@/server/services/sale-orders');
    const { quotedParts } = await import('@/lib/validation/quotation');
    const createSO = async (u: TestUser, salesId: number, submit: boolean) => {
      const r = await json(
        await soPOST(
          await request('/api/sale-orders', u, {
            method: 'POST',
            body: { customerCode: CUSTOMER, salesId, submit, lines: [{ code: P.a.code, qty: 1 }] },
          }),
        ),
      );
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return (r.body.order as { no: string }).no;
    };
    const decideAs = async (u: TestUser, no: string, decision: string, remark?: string) =>
      json(
        await soApprovePOST(
          await request(`/api/sale-orders/${no}/approve`, u, { method: 'POST', body: { decision, remark } }),
          { params: Promise.resolve({ no }) },
        ),
      );
    const approveIdOf = async (no: string) =>
      (
        await db.execute<{ s: number }>(
          sql`SELECT approve_status_id AS s FROM sale_out_hd WHERE sale_out_hd_no = ${no}`,
        )
      ).rows[0].s;

    await test('R2 SO: the creator cannot approve / deny / send back their own order (403); a draft cannot be decided (409); System Admin may', async () => {
      await setStock(P.a.code, 10);
      // a Manager (an approver) creates and submits — as salesperson and as the one who keyed it in
      for (const salesId of [U.manager.id, U.admin.id]) {
        const own = await createSO(U.manager, salesId, true);
        for (const d of ['approve', 'deny', 'reject']) {
          const r = await decideAs(U.manager, own, d, 'TD reason');
          assert.deepEqual([r.status, r.body.error], [403, SELF_APPROVE], `${d} (sales ${salesId})`);
        }
        assert.equal(await approveIdOf(own), 2, 'still waiting');
      }
      assert.equal((await qty(P.a.code)).remain, 10, 'nothing went out');
      // a draft (1) and a sent-back (3) order: nobody decides until it is sent again
      const draft = await createSO(U.admin, U.admin.id, false);
      assert.equal((await decideAs(U.admin, draft, 'approve')).status, 409);
      const back = await createSO(U.admin, U.admin.id, true);
      assert.equal((await decideAs(U.manager, back, 'reject', 'TD fix the price')).status, 200, 'another approver');
      assert.equal((await decideAs(U.admin, back, 'approve')).status, 409, 'sent back = not waiting');
      // someone else (a Manager on an admin-made order) approves; System Admin approves its own
      assert.equal((await decideAs(U.manager, await createSO(U.admin, U.admin.id, true), 'approve')).status, 200);
      assert.equal((await decideAs(U.admin, await createSO(U.admin, U.admin.id, true), 'approve')).status, 200);
      assert.equal((await qty(P.a.code)).remain, 8);
    });

    await test('R2 SO: deny / send back need a reason (400 under remark); the reason, who and when are on the order', async () => {
      const no = await createSO(U.admin, U.admin.id, true);
      for (const [d, remark] of [
        ['deny', undefined],
        ['reject', '   '],
      ] as const) {
        const r = await decideAs(U.admin, no, d, remark);
        assert.equal(r.status, 400, d);
        assert.deepEqual((r.body.details as { fields: object }).fields, { remark: REASON_REQUIRED });
      }
      assert.equal(await approveIdOf(no), 2, 'nothing decided');
      assert.equal((await decideAs(U.admin, no, 'reject', 'x'.repeat(101))).status, 400, '> 100 (the column)');
      const ok = await decideAs(U.admin, no, 'deny', '  ราคาผิด  ');
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      const o = (await getSaleOrder(no))!;
      assert.deepEqual([o.approveId, o.approveRemark], [5, 'ราคาผิด']);
      assert.ok(o.approvedBy && o.approveDate, 'who + when for the banner');
    });

    await test('R2 SO: tracking no. only on an approved order (409 before); saved + format checked after', async () => {
      await setStock(P.a.code, 10);
      const no = await createSO(U.admin, U.admin.id, true);
      assert.equal(await statusOf(setTracking(no, 'TH123456789', U.admin.id)), 409);
      assert.equal((await decideAs(U.admin, no, 'approve')).status, 200);
      assert.equal(await statusOf(setTracking(no, 'มี ช่องว่าง!!', U.admin.id)), 400);
      const o = await setTracking(no, ' th 1234 5678 9 ', U.admin.id);
      assert.equal(o.tracking, 'TH123456789');
    });

    await test("R2 quotation: type B takes the job's B lines (was set A) — and the totals count them", async () => {
      await pool.query(`
        DELETE FROM job_order_spare_part_log WHERE job_no = '${JOB_QUOTE}';
        INSERT INTO job_order_spare_part_log (job_no, spare_part_code, spare_part_serial_no, stock_id, is_quotation, is_special, request_qty,
                                              is_quotation_b, is_special_b, request_qty_b, spare_part_unit_price, order_status_id, request_date, request_by, grant_qty, return_qty)
          VALUES ('${JOB_QUOTE}', '${P.a.code}', '', 1, true, false, 1, false, false, 0, 100, 1, now(), 9101, 0, 0),
                 ('${JOB_QUOTE}', '${P.b.code}', '', 1, false, false, 0, true, false, 2, 200, 1, now(), 9101, 0, 0);`);
      const parts = (await getJob(JOB_QUOTE))!.parts;
      assert.deepEqual(
        quotedParts(parts, 'A').map((l) => [l.code, l.qty]),
        [[P.a.code, 1]],
      );
      const b = quotedParts(parts, 'B');
      assert.deepEqual(
        b.map((l) => [l.code, l.qty, l.price]),
        [[P.b.code, 2, 200]],
      );
      // what the form posts for a type B quotation of this job
      const q = await saveQuotation(
        {
          type: 'Type B (VIP)',
          customerCode: CUSTOMER,
          jobNo: JOB_QUOTE,
          lines: b.map((l) => ({
            itemType: 'SparePart' as const,
            code: l.code,
            detail: l.name,
            qty: l.qty,
            unit: 'หน่วย',
            unitPrice: l.price,
            discount: 0,
            discountPercent: 0,
          })),
        },
        U.admin.id,
      );
      assert.equal(q.type, 'Type B (VIP)');
      assert.equal(q.netAmount, 400);
      await pool.query(`DELETE FROM job_order_spare_part_log WHERE job_no = '${JOB_QUOTE}'`);
    });

    await test('R2 customers: a Corporate customer may give a landline (an individual may not); an edited phone is format-checked', async () => {
      const landline = `02-${String(Math.floor(Math.random() * 1e7))
        .padStart(7, '0')
        .replace(/^(\d{3})/, '$1-')}`;
      const add = async (body: Record<string, unknown>) =>
        json(await customerPOST(await request('/api/customers', U.admin, { method: 'POST', body })));
      const person = await add({ name: 'TD R2 บุคคล', phone: landline, type: 'Normal' });
      assert.equal(person.status, 400);
      assert.match((person.body.details as { fields: { phone: string } }).fields.phone, /มือถือ/);
      const corp = await add({ name: 'TD R2 บริษัท จำกัด', phone: landline, type: 'Corporate' });
      assert.equal(corp.status, 201, JSON.stringify(corp.body));
      const code = (corp.body.row as { code: string }).code;
      // the edit that used to save "086-417-29530611474570" (a 20-digit run)
      const bad = await add({ code, name: 'TD R2 บริษัท จำกัด', phone: '086-417-29530611474570', type: 'Corporate' });
      assert.equal(bad.status, 400);
      assert.ok((bad.body.details as { fields: { phone?: string } }).fields.phone);
      const ok = await add({
        code,
        name: 'TD R2 บริษัท จำกัด',
        phone: `${landline} / 081-234-5678`,
        type: 'Corporate',
      });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      // a legacy phone nobody touched still saves (only a changed one is checked)
      await db.execute(sql`UPDATE customer SET phone_number = '086-417-29530611474570' WHERE customer_code = ${code}`);
      const legacy = await add({
        code,
        name: 'TD R2 บริษัท (แก้ชื่อ)',
        phone: '086-417-29530611474570',
        type: 'Corporate',
      });
      assert.equal(legacy.status, 200, JSON.stringify(legacy.body));
    });
  }
  // ── Round 2: customer /track + documents + migration 0028 ──
  console.log('\nRound 2 — customer /track, documents, shipping profiles, migration 0028');
  {
    const tracking = await import('@/server/services/tracking');
    const { getQuotation } = await import('@/server/services/quotations');
    const { saveShippingProfile, deleteShippingProfile, listShippingProfiles } =
      await import('@/server/services/shipping-profiles');
    const { readFileSync } = await import('node:fs');
    await pool.query(`
      INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
        SELECT * FROM (VALUES (8, 'ปิดงาน-ส่งคืนสินค้า (ลงเลขที่พัสดุแล้ว)', 8, 'Finished', true),
                              (16, 'อยู่ระหว่างการซ่อม - พันกำหนดเสนอราคา', 16, 'Pending', true)) v(id, name, ord, grp, act)
         WHERE NOT EXISTS (SELECT 1 FROM job_status s WHERE s.job_status_id = v.id);
      DELETE FROM customer WHERE customer_id = 9281 OR customer_code = 'TDC281';
      INSERT INTO customer (customer_id, customer_code, customer_name, phone_number, customer_address, customer_card_id, email, line_id)
        VALUES (9281, 'TDC281', 'คุณสมชาย ใจดี', '081-234-5678', '99/1 ซ.สุขใจ แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพมหานคร 10310',
                '1234567890123', 'somchai@example.invalid', 'somchai-line');
      INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, product_serial, product_imei_no,
                       engineer_id, job_create_date, job_reception_date, job_closed_date)
        VALUES ('TDJ0281', 4, 9281, 'TDC281 คุณสมชาย ใจดี 081-234-5678', 'Model TD', 'SN เสียหาย', '356789012345678',
                ${U.admin.id}, now(), current_date, '1900-01-01'),
               ('TDJ0282', 2, 9281, 'TDC281 คุณสมชาย ใจดี', 'Model TD', '', '', 0,
                '2026-09-07 11:50:47', '2026-09-08', '1900-01-01'),
               ('TDJ0284', 2, 9281, 'TDC281 คุณสมชาย ใจดี', 'Model TD', '', '', 0,
                '2026-09-07 11:50:47', '1900-01-01', '1900-01-01');
      INSERT INTO job_log (job_no, job_status_id, job_log_date, job_action_by)
        VALUES ('TDJ0282', 1, '2026-09-07 11:50:47', ${U.admin.id}), ('TDJ0284', 1, '2026-09-07 11:50:47', ${U.admin.id});
      INSERT INTO quotation_hd (quotation_no, customer_code, reference_job_no, net_amount, quotation_status_id, create_date, create_by, is_active)
        VALUES ('TDQ0281', 'TDC281', 'TDJ0281', 500, 2, '2001-04-10', ${U.admin.id}, true);`);

    await test('R2 track: a document opened from /track is masked like the page (name / phone / address / IMEI / tax id, no technician); prices stay', async () => {
      const staff = (await getJob('TDJ0281'))!;
      assert.equal(staff.engineer, 'TD td-admin', 'staff print unchanged');
      assert.equal(staff.customer!.phone, '081-234-5678');
      const j = tracking.maskJobForCustomer(staff);
      assert.deepEqual(
        [
          j.customer!.name,
          j.customer!.phone,
          j.customer!.address,
          j.customer!.taxId,
          j.customer!.email,
          j.customer!.line,
        ],
        ['คุณ สมช…', '•••-•••-5678', 'แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพมหานคร 10310', '', '', ''],
      );
      assert.deepEqual([j.imei, j.serial, j.engineer, j.engineerId], ['••••5678', '', '', 0]);
      assert.ok(!j.customerDetail.includes('081'), 'customer_detail carries the phone');
      const q = tracking.maskQuotationForCustomer((await getQuotation('TDQ0281'))!);
      assert.deepEqual(
        [q.customer, q.customerDetail!.phone, q.customerDetail!.taxId, q.imei, q.job!.engineer],
        ['คุณ สมช…', '•••-•••-5678', '', '••••5678', ''],
      );
      assert.equal(q.netAmount, 500, 'the customer decides with the price');
      // and the page lists that 2001 quotation as expired, never as current
      const pub = (await tracking.publicJobByNo('TDJ0281'))!;
      assert.match(
        pub.docs.find((d) => d.kind === 'quotation')!.label,
        /หมดอายุแล้ว — ติดต่อศูนย์เพื่อขอใบเสนอราคาใหม่/,
      );
      // round 3: the status line no longer asks for an answer to it either
      assert.equal(pub.stepLabel, 'ใบเสนอราคาหมดอายุแล้ว — ติดต่อศูนย์เพื่อขอใบเสนอราคาใหม่');
    });
    await test('R2 track: one received date — header, timeline and receipt all show job_reception_date (1900 → opened)', async () => {
      const a = (await tracking.publicJobByNo('TDJ0282'))!;
      const at = (j: typeof a) => j.history.find((h) => h.key === 'received')?.at;
      assert.deepEqual([a.receivedDate, at(a), a.docs[0].date], ['2026-09-08', '2026-09-08', '2026-09-08']);
      const b = (await tracking.publicJobByNo('TDJ0284'))!;
      assert.deepEqual([b.receivedDate, at(b)], ['2026-09-07', '2026-09-07']);
    });
    await test('R2 track: a deleted shipping profile still gives old jobs their logo + tracking link; hidden from pickers; a new one goes last', async () => {
      const code = `TDS${Date.now() % 1_000_000}`;
      const p = await saveShippingProfile({ code, nameTh: 'TD ขนส่ง', trackUrl: 'https://t.example/{no}' }, U.admin.id);
      const others = (await listShippingProfiles(false)).filter((o) => o.id !== p.id);
      assert.ok(
        others.every((o) => o.sortOrder < p.sortOrder),
        `sort ${p.sortOrder} is last`,
      );
      await pool.query(`
        INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date,
                         job_closed_date, return_customer_tracking_no, return_shipper_id)
          VALUES ('TDJ0283', 8, 9281, 'TDC281 คุณสมชาย ใจดี', 'Model TD', now(), current_date, now(), 'TH123', ${p.id})`);
      await deleteShippingProfile(p.id, U.admin.id);
      assert.ok(!(await listShippingProfiles(false)).some((o) => o.id === p.id), 'not offered any more');
      const j = (await tracking.publicJobByNo('TDJ0283'))!;
      assert.deepEqual(j.courier, { name: 'TD ขนส่ง', logoUrl: '', trackUrl: 'https://t.example/TH123' });
      assert.equal(j.stepLabel, 'ส่งคืนแล้ว (พัสดุ)');
    });
    await test('R2 track: masking — one title ("คุณ คุณ…"), a Thai note in the S/N field is not a serial', async () => {
      assert.equal(tracking.maskName('คุณสมชาย ใจดี'), 'คุณ สมช…');
      assert.equal(tracking.maskName('คุณ สมชาย'), 'คุณ สมช…');
      assert.equal(tracking.maskName('C43600 นายสมศักดิ์ ดีมาก 0812345678'), 'คุณ สมศ…');
      assert.equal(tracking.maskName('Mr. John Covate'), 'คุณ Joh…');
      assert.equal(tracking.maskName(''), 'ลูกค้า');
      for (const v of ['SN เสียหาย', 'รอ SN จากลูกค้า', 'ไม่มีเลข SN', '-', 'no'])
        assert.equal(tracking.maskRef(v), '', v);
      assert.equal(tracking.maskRef('R58N123ABCD'), '••••ABCD');
      // the job's serial is a note → the IMEI is shown instead
      assert.equal((await tracking.publicJobByNo('TDJ0281'))!.deviceRef, '••••5678');
    });
    await test('R2 track: a document link opens many times / from any browser for 10 min, only while its /track link is live', async () => {
      const token = await tracking.rotateToken('TDJ0282');
      const raw = await tracking.issueDocLink({ jobNo: 'TDJ0282', kind: 'job', ref: 'TDJ0282' }, token, '127.0.0.1');
      const want = { jobNo: 'TDJ0282', kind: 'job', ref: 'TDJ0282' };
      assert.deepEqual(await tracking.docForLink(raw), want, 'LINE in-app browser');
      assert.deepEqual(await tracking.docForLink(raw), want, 'then Safari');
      await tracking.rotateToken('TDJ0282'); // the link it was issued under is dead → so is the document link
      assert.equal(await tracking.docForLink(raw), null);
      assert.equal(await tracking.docForLink('x'.repeat(43)), null);
    });
    await test('R2 migration 0028: status 16 พ้นกำหนดเสนอราคา; Customer Service cannot save Job Repair (view kept); re-runnable', async () => {
      const file = readFileSync('drizzle/0028_round2_status_name_cs_repair.sql', 'utf8');
      await pool.query(`
        UPDATE job_status SET job_status_name = 'อยู่ระหว่างการซ่อม - พันกำหนดเสนอราคา' WHERE job_status_id = 16;
        INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
          ('Customer Service', 'Job Repair', true, true, true, true), ('Customer Service', 'Job Management', true, true, true, true)
          ON CONFLICT (user_type, module_name) DO UPDATE SET can_insert = true, can_edit = true, can_delete = true, can_view = true;`);
      const state = async () => ({
        name: (await pool.query(`SELECT job_status_name n FROM job_status WHERE job_status_id = 16`)).rows[0].n,
        rights: (
          await pool.query(`SELECT module_name m, can_insert i, can_edit e, can_delete d, can_view v FROM app_config
                             WHERE user_type = 'Customer Service' AND module_name IN ('Job Repair', 'Job Management') ORDER BY 1`)
        ).rows,
      });
      const want = {
        name: 'อยู่ระหว่างการซ่อม - พ้นกำหนดเสนอราคา',
        rights: [
          { m: 'Job Management', i: true, e: true, d: true, v: true },
          { m: 'Job Repair', i: false, e: false, d: false, v: true },
        ],
      };
      await pool.query(file);
      assert.deepEqual(await state(), want);
      await pool.query(file);
      assert.deepEqual(await state(), want, 'second run changes nothing');
    });
  }
  // ── Round 2: app shell + admin + dashboard ──
  console.log('\nRound 2 — app shell + admin + dashboard');
  {
    const { provisionFailure, upsertUser, setUserDeleted } = await import('@/server/services/users');
    await test('R2 shell: a unique violation on app_user at first sign-in → user_conflict (logged), other DB errors → db_unavailable', async () => {
      // a real Postgres 23505 through drizzle (the id sequence behind the data does exactly this)
      let dupErr: unknown;
      try {
        await db.execute(
          sql`INSERT INTO app_user (user_id, email_address) VALUES (${U.admin.id}, 'td-r2-dup@example.invalid')`,
        );
      } catch (e) {
        dupErr = e;
      }
      assert.ok(dupErr, 'the duplicate id is refused');
      const conflict = provisionFailure(dupErr);
      assert.equal(conflict.reason, 'user_conflict');
      assert.ok(conflict.constraint, 'the violated constraint is named for the log');
      let otherErr: unknown;
      try {
        await db.execute(sql`SELECT 1 / 0`);
      } catch (e) {
        otherErr = e;
      }
      assert.ok(otherErr);
      assert.deepEqual(provisionFailure(otherErr), { reason: 'db_unavailable' });
      assert.deepEqual(provisionFailure(new Error('connect ECONNREFUSED')), { reason: 'db_unavailable' });
    });
    await test('R2 admin users: the audit line says อนุมัติ / ถอนสิทธิ์ / คืนสิทธิ์ / เปลี่ยนสิทธิ์ / ลบ / กู้คืน, not "แก้ไขผู้ใช้" for all', async () => {
      const id = U.pending.id;
      const last = async () =>
        (
          await db.execute<{ a: string; s: string }>(
            sql`SELECT action AS a, summary AS s FROM audit_log WHERE entity = 'app_user' AND entity_key = ${String(id)} ORDER BY id DESC LIMIT 1`,
          )
        ).rows[0];
      const save = (role: string, status: string) =>
        upsertUser({ id: String(id), name: 'TD td-pending', role, status }, U.admin.id);
      try {
        await save('TD Job Clerk', 'Active'); // อนุมัติ from the users page (pending → a role)
        assert.deepEqual(await last(), { a: 'APPROVE', s: 'อนุมัติผู้ใช้ TD td-pending → TD Job Clerk' });
        await save('TD Job Clerk', 'Inactive');
        assert.deepEqual(await last(), { a: 'STATUS', s: 'ถอนสิทธิ์ผู้ใช้ TD td-pending (TD Job Clerk)' });
        await save('TD Job Clerk', 'Active');
        assert.deepEqual(await last(), { a: 'STATUS', s: 'คืนสิทธิ์ผู้ใช้ TD td-pending (TD Job Clerk)' });
        await save('TD Seller', 'Active');
        assert.deepEqual(await last(), {
          a: 'UPDATE',
          s: 'เปลี่ยนสิทธิ์ผู้ใช้ TD td-pending: TD Job Clerk → TD Seller',
        });
        await save('TD Seller', 'Active'); // R3: saved with nothing changed → no audit line
        assert.equal((await last()).s, 'เปลี่ยนสิทธิ์ผู้ใช้ TD td-pending: TD Job Clerk → TD Seller');
        await setUserDeleted(id, true, U.admin.id);
        assert.deepEqual(await last(), { a: 'DELETE', s: 'ลบผู้ใช้ TD td-pending' });
        await setUserDeleted(id, false, U.admin.id); // R3: restored INACTIVE
        assert.deepEqual(await last(), { a: 'STATUS', s: 'กู้คืนผู้ใช้ TD td-pending (ยังปิดการใช้งาน)' });
      } finally {
        await db.execute(
          sql`UPDATE app_user SET user_type = NULL, record_status = 'ACTIVE', deleted = false, first_name = 'TD', last_name = 'td-pending' WHERE user_id = ${id}`,
        );
      }
    });
  }
  // ── Round 2: jobs ──
  console.log('\nRound 2 — jobs (underpayment / closed-job money / take-over / walk-in)');
  {
    const { saveSwapRefund } = await import('@/server/services/jobs');
    const { jobBalance, WALK_IN_CHANNEL } = await import('@/lib/validation/job');
    const job = (no: string, status: number, eng = 0) =>
      `('${no}', ${status}, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01', ${eng})`;
    await pool.query(`
      INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date, engineer_id)
        VALUES ${job('TDJ0301', 5)}, ${job('TDJ0302', 20)}, ${job('TDJ0303', 1, U.admin.id)}, ${job('TDJ0304', 1, U.admin.id)},
               ${job('TDJ0305', 1)};
      UPDATE job SET service_cost = 1300, spare_part_total_cost = 0, job_total_cost = 1300 WHERE job_no = 'TDJ0301';
      UPDATE job SET deposit_cost = 500, service_cost = 300, spare_part_total_cost = 0, job_total_cost = 300,
                     job_payment_type = 'เงินสด', job_payment_amount = 0 WHERE job_no = 'TDJ0302';`);
    const back = { type: 'ลูกค้ามารับเอง', date: '2026-10-15' };
    await test('R2 jobs: close paying 1,000 of 1,300 saves; the job detail says ค้างชำระ 300 (deposit > total = money back)', async () => {
      const r = await fieldsOf(
        closeJob(
          'TDJ0301',
          { status: await statusName(20), payment: { type: 'เงินสด', amount: 1000 }, return: back },
          U.clerk.id,
        ),
      );
      assert.equal(r.status, 200, JSON.stringify(r));
      const j = (await getJob('TDJ0301'))!;
      assert.deepEqual(
        [j.statusId, j.payment.amount, j.amountDue, j.outstanding, j.depositRefund],
        [20, 1000, 1300, 300, 0],
      );
      // the numbers the return note prints
      assert.deepEqual(jobBalance(1300, 0, 1000), { due: 1300, refund: 0, outstanding: 300 });
      assert.deepEqual(jobBalance(300, 500, 0), { due: 0, refund: 200, outstanding: 0 }, 'not 0.00: 200 back');
      assert.deepEqual(
        jobBalance(250, 100, -50),
        { due: 150, refund: 0, outstanding: 150 },
        'a refund is not a payment',
      );
    });
    await test('R2 jobs: closed job — a money change → 409 on edit / repair / close / swap-refund; remark → 200; admin → 200', async () => {
      const j = (await getJob('TDJ0302'))!;
      // what the edit form sends back: every money field as loaded
      const base = {
        customerCode: CUSTOMER,
        dueDate: j.dueDate,
        warrantyMonth: j.warrantyMonth, // the form always sends it (the first save stores 0 for an empty one)
        estimateCost: j.estimateCost,
        depositCost: j.depositCost,
        serviceCost: j.serviceCost,
        toolCost: j.toolCost,
        deliveryCost: j.deliveryCost,
        boxCost: j.boxCost,
      };
      const s20 = await statusName(20);
      const edit = await fieldsOf(updateJob('TDJ0302', { ...base, depositCost: 600 }, U.clerk.id));
      assert.equal(edit.status, 409);
      assert.match(edit.message ?? '', /ค่ามัดจำ/);
      assert.equal((await fieldsOf(saveRepair('TDJ0302', { status: s20, serviceCost: 999 }, U.clerk.id))).status, 409);
      const pay = { status: s20, payment: { type: 'เงินสด', amount: 800 }, return: back };
      assert.equal((await fieldsOf(closeJob('TDJ0302', pay, U.clerk.id))).status, 409);
      const refund = { status: s20, refundAmount: 200, refundMethod: 'เงินสด' };
      assert.equal((await fieldsOf(saveSwapRefund('TDJ0302', refund, U.clerk.id))).status, 409);
      const now = (await getJob('TDJ0302'))!;
      assert.deepEqual([now.depositCost, now.serviceCost, now.payment.amount], [500, 300, 0], 'nothing written');
      // the money as loaded passes; System Admin may change it
      assert.equal((await fieldsOf(updateJob('TDJ0302', { ...base, remark: 'TD R2 note' }, U.clerk.id))).status, 200);
      assert.equal(
        (await fieldsOf(saveRepair('TDJ0302', { status: s20, repairDetail: 'TD R2' }, U.clerk.id))).status,
        200,
      );
      const admin = { ...base, remark: 'TD R2 note', depositCost: 600 };
      assert.equal((await fieldsOf(updateJob('TDJ0302', admin, U.admin.id))).status, 200);
      const after = (await getJob('TDJ0302'))!;
      assert.deepEqual([after.remark, after.repairDetail, after.depositCost], ['TD R2 note', 'TD R2', 600]);
    });
    await test('R2 jobs: taking a job someone else has → 409 unless takeOver (assign + edit); edit assign = NEW → 2 + log', async () => {
      const r = await fieldsOf(assignJobs(['TDJ0303'], U.engineer.id, U.clerk.id));
      assert.equal(r.status, 409);
      assert.match(r.message ?? '', /มีผู้รับงานแล้ว/);
      await assignJobs(['TDJ0303'], U.engineer.id, U.clerk.id, true);
      const eng = async (no: string) =>
        (
          await db.execute<{ e: number; s: number }>(
            sql`SELECT engineer_id AS e, job_status_id AS s FROM job WHERE job_no = ${no}`,
          )
        ).rows[0];
      assert.deepEqual({ ...(await eng('TDJ0303')) }, { e: U.engineer.id, s: 2 });
      const dueDate = (await getJob('TDJ0304'))!.dueDate;
      const input = { customerCode: CUSTOMER, dueDate, engineerId: U.engineer.id };
      assert.equal((await fieldsOf(updateJob('TDJ0304', input, U.clerk.id))).status, 409);
      assert.deepEqual({ ...(await eng('TDJ0304')) }, { e: U.admin.id, s: 1 }, 'unchanged');
      await updateJob('TDJ0304', { ...input, takeOver: true }, U.clerk.id);
      assert.deepEqual({ ...(await eng('TDJ0304')) }, { e: U.engineer.id, s: 2 });
      assert.deepEqual(await logRows('TDJ0304'), [2]);
      // nobody on it yet: no question, and the edit screen moves it like /jobs/assign does
      const free = await getJob('TDJ0305');
      await updateJob(
        'TDJ0305',
        { customerCode: CUSTOMER, dueDate: free!.dueDate, engineerId: U.engineer.id },
        U.clerk.id,
      );
      assert.deepEqual({ ...(await eng('TDJ0305')) }, { e: U.engineer.id, s: 2 });
      assert.deepEqual(await logRows('TDJ0305'), [2]);
    });
    await test('R2 jobs: walk-in (หน้าร้าน) opens without SO no. / SO date / expire date; another channel → 400 for those', async () => {
      const [m] = (await db.execute<{ c: string }>(sql`SELECT model_code AS c FROM model LIMIT 1`)).rows;
      const [jt] = (await db.execute<{ n: string }>(sql`SELECT job_type_name AS n FROM job_type LIMIT 1`)).rows;
      const input = {
        customerCode: CUSTOMER,
        jobType: jt!.n,
        warrantyMonth: 12,
        serial: 'TD-R2-WALKIN',
        brand: 'TD Trail Brand', // made by the "legacy master names" test above
        modelCode: m!.c,
        symptoms: ['TD trail sym'],
        dueDate: addDays(today(), 5),
      };
      const walkIn = await fieldsOf(createJob({ ...input, channel: WALK_IN_CHANNEL }, U.admin.id));
      assert.equal(walkIn.status, 200, JSON.stringify(walkIn));
      const other = await fieldsOf(createJob({ ...input, channel: 'SHOPEE' }, U.admin.id));
      assert.deepEqual(
        [other.status, Object.keys(other.fields ?? {}).sort()],
        [400, ['expireDate', 'saleOrderDate', 'so']],
      );
    });
  }
  // ── Round 3: customer /track + print documents ──
  console.log('\nRound 3 — customer /track + print documents');
  {
    const tracking = await import('@/server/services/tracking');
    const { getQuotation } = await import('@/server/services/quotations');
    // customer 9281 + TDJ0281 (status 4, a 2001 quotation) + TDJ0283 (closed, status 8) come from the Round 2 block
    await pool.query(`
      INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
        SELECT * FROM (VALUES (4, 'อยู่ระหว่างการซ่อม - เสนอราคาลูกค้า', 4, 'Pending', true),
                              (24, 'ปิดงาน-รอลูกค้ามารับที่ศูนย์บริการ', 24, 'Finished', true)) v(id, name, ord, grp, act)
         WHERE NOT EXISTS (SELECT 1 FROM job_status s WHERE s.job_status_id = v.id);
      DELETE FROM quotation_hd WHERE quotation_no IN ('TDQ0392', 'TDQ0393');
      DELETE FROM job WHERE job_no IN ('TDJ0391', 'TDJ0392', 'TDJ0393');
      INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_by,
                       job_create_date, job_reception_date, job_closed_date)
        VALUES ('TDJ0391', 24, 9281, 'TDC281 คุณสมชาย ใจดี', 'Model TD', ${U.admin.id},
                '2026-09-07 11:50:47', '2026-09-08', now()),
               ('TDJ0392', 4, 9281, 'TDC281 คุณสมชาย ใจดี', 'Model TD', ${U.admin.id}, now(), current_date, '1900-01-01'),
               ('TDJ0393', 4, 9281, 'TDC281 คุณสมชาย ใจดี', 'Model TD', ${U.admin.id}, now(), current_date, '1900-01-01');
      INSERT INTO quotation_hd (quotation_no, customer_code, reference_job_no, net_amount, quotation_status_id, create_date, create_by, is_active)
        VALUES ('TDQ0392', 'TDC281', 'TDJ0392', 500, 2, now() - interval '30 days', ${U.admin.id}, true),
               ('TDQ0393', 'TDC281', 'TDJ0393', 500, 2, now(), ${U.admin.id}, true);`);

    await test('R3 track docs: no staff names on the customer copy (ผู้รับงาน / เสนอราคาโดย); a company is never "คุณ บริ…"', async () => {
      const staff = (await getJob('TDJ0391'))!;
      assert.equal(staff.createByName, 'TD td-admin', 'staff print unchanged');
      const j = tracking.maskJobForCustomer(staff);
      assert.deepEqual([j.createByName, j.createBy, j.engineer, j.outsource], ['', 0, '', []]);
      const sq = (await getQuotation('TDQ0392'))!;
      assert.equal(sq.createdBy, 'TD td-admin', 'staff print unchanged');
      assert.equal(tracking.maskQuotationForCustomer(sq).createdBy, '');
      assert.equal(tracking.maskName('บริษัท เอบีซี จำกัด'), 'บริษัท เอบ…');
      assert.equal(tracking.maskName('C43600 บริษัทเอบีซี จำกัด (มหาชน) 02-111-2222'), 'บริษัท เอบ…');
      assert.equal(tracking.maskName('หจก. สมบูรณ์การช่าง'), 'หจก. สมบ…');
      assert.equal(tracking.maskName('ABC Co., Ltd.'), 'ABC…');
      assert.equal(tracking.maskName('คุณสมชาย ใจดี'), 'คุณ สมช…', 'a person keeps "คุณ"');
      assert.equal(tracking.maskName('Corinne Smith'), 'คุณ Cor…', '"Co" inside a name is not a company');
    });
    await test('R3 track docs: receipt + return note use the /track received date (job_reception_date), not job_create_date', async () => {
      const j = (await getJob('TDJ0391'))!;
      assert.equal(j.createDate.slice(0, 10), '2026-09-07');
      assert.equal(tracking.receivedDateOf(j), '2026-09-08');
      assert.equal(tracking.receivedDateOf(tracking.maskJobForCustomer(j)), '2026-09-08', 'customer copy too');
      assert.equal((await tracking.publicJobByNo('TDJ0391'))!.receivedDate, tracking.receivedDateOf(j), 'one truth');
      // legacy 1900 reception date → the day the job was opened, as on /track
      assert.equal(tracking.receivedDateOf({ receptionDate: '', createDate: '2026-09-07 11:50' }), '2026-09-07');
    });
    await test('R3 track: a quotation past its validity → status line + list say expired, not "รอคำตอบจากคุณ"', async () => {
      const expired = 'ใบเสนอราคาหมดอายุแล้ว — ติดต่อศูนย์เพื่อขอใบเสนอราคาใหม่';
      assert.equal((await tracking.publicJobByNo('TDJ0392'))!.stepLabel, expired);
      assert.equal((await tracking.publicJobByNo('TDJ0393'))!.stepLabel, 'รอคำตอบจากคุณ (ใบเสนอราคา)', 'still valid');
      const { active } = await tracking.listJobsForCustomers([9281]);
      const label = (no: string) => active.find((r) => r.no === no)?.stepLabel;
      assert.deepEqual([label('TDJ0392'), label('TDJ0393')], [expired, 'รอคำตอบจากคุณ (ใบเสนอราคา)']);
      // the document opened from /track uses the same rule (stamp, no sign-and-return)
      const q = (await getQuotation('TDQ0392'))!;
      assert.equal(tracking.quoteExpired(q.statusId, q.date, q.job?.statusId ?? null), true);
      const fresh = (await getQuotation('TDQ0393'))!;
      assert.equal(tracking.quoteExpired(fresh.statusId, fresh.date, fresh.job?.statusId ?? null), false);
    });
    await test('R3 track: "พร้อมให้มารับที่ศูนย์" (24) stays under กำลังดำเนินการ until collected; a shipped job is history', async () => {
      const { active, history } = await tracking.listJobsForCustomers([9281]);
      const row = active.find((r) => r.no === 'TDJ0391');
      assert.equal(row?.stepLabel, 'พร้อมให้มารับที่ศูนย์');
      assert.ok(!history.some((r) => r.no === 'TDJ0391'), 'not in ประวัติ');
      assert.ok(
        history.some((r) => r.no === 'TDJ0283'),
        'ส่งคืนแล้ว (พัสดุ) is history',
      );
      assert.deepEqual(
        [
          tracking.inProgressForCustomer(24, 'Finished'),
          tracking.inProgressForCustomer(7, 'Finished'),
          tracking.inProgressForCustomer(8, 'Finished'),
          tracking.inProgressForCustomer(20, 'Finished'),
          tracking.inProgressForCustomer(0, 'Cancel'),
          tracking.inProgressForCustomer(3, 'Pending'),
        ],
        [true, true, false, false, false, true],
      );
    });
  }
  // ── Round 3: sale orders + quotations + customers + stock ──
  console.log('\nRound 3 — sale orders + quotations + customers + stock');
  {
    const { SELF_APPROVE, SELF_APPROVE_SALES, getSaleOrder, pageSaleOrders } =
      await import('@/server/services/sale-orders');
    const post = async (u: TestUser, body: Record<string, unknown>) =>
      json(await soPOST(await request('/api/sale-orders', u, { method: 'POST', body })));
    const so = (u: TestUser, salesId: number, extra: Record<string, unknown> = {}) =>
      post(u, {
        customerCode: CUSTOMER,
        salesId,
        submit: true,
        lines: [{ code: P.a.code, qty: 1, price: 100 }],
        ...extra,
      });
    const noOf = (r: { status: number; body: Record<string, unknown> }) => {
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return (r.body.order as { no: string }).no;
    };
    const hdOf = async (no: string) =>
      (
        await db.execute<{ t: string | null; a: string | null; c: number; s: number }>(
          sql`SELECT payment_type AS t, payment_amount AS a, document_create_by AS c, sale_out_by AS s
              FROM sale_out_hd WHERE sale_out_hd_no = ${no}`,
        )
      ).rows[0];
    const fieldKeys = (r: { body: Record<string, unknown> }) =>
      Object.keys((r.body.details as { fields?: object })?.fields ?? {});

    await test('R3 SO: no payment entered → no type / amount saved; more than the total → 400 under paymentAmount (new, and an edit that lowers the qty)', async () => {
      const none = await hdOf(noOf(await so(U.admin, U.admin.id)));
      assert.deepEqual([none.t ?? '', none.a], ['', null], 'was โอนเงิน + the net');
      // 3 × 100 paid 300 → the manager lowers it to 1: the 300 must not stay on a 100 order
      const paid = noOf(
        await so(U.admin, U.admin.id, {
          lines: [{ code: P.a.code, qty: 3, price: 100 }],
          paymentType: 'โอนเงิน',
          paymentAmount: '300',
        }),
      );
      assert.deepEqual({ ...(await hdOf(paid)) }.a, '300.00');
      const lowered = await so(U.admin, U.admin.id, { no: paid, paymentType: 'โอนเงิน', paymentAmount: '300' });
      assert.deepEqual([lowered.status, fieldKeys(lowered)], [400, ['paymentAmount']]);
      assert.equal((await hdOf(paid)).a, '300.00', 'nothing saved');
      // no price sent (the server takes the product's 100) — the server's own check
      const noPrice = await post(U.admin, {
        customerCode: CUSTOMER,
        salesId: U.admin.id,
        lines: [{ code: P.a.code, qty: 1 }],
        paymentType: 'เงินสด',
        paymentAmount: 9_999_999, // more than any product's price
      });
      assert.deepEqual([noPrice.status, fieldKeys(noPrice)], [400, ['paymentAmount']]);
      // an amount needs its payment type
      const noType = await so(U.admin, U.admin.id, { paymentAmount: '100' });
      assert.deepEqual([noType.status, fieldKeys(noType)], [400, ['paymentType']]);
      assert.equal(
        (await so(U.admin, U.admin.id, { no: paid, paymentType: 'โอนเงิน', paymentAmount: '100' })).status,
        200,
      );
    });

    await test('R3 SO: document_create_by = who keyed it in, sale_out_by = the salesperson; shown apart; self-approval says which', async () => {
      const bySeller = noOf(await so(U.seller, U.admin.id)); // CS keys in an order for another salesperson
      assert.deepEqual({ ...(await hdOf(bySeller)) }, { t: '', a: null, c: U.seller.id, s: U.admin.id });
      const o = (await getSaleOrder(bySeller))!;
      assert.deepEqual([o.createdById, o.createdBy, o.sales], [U.seller.id, 'TD td-seller', 'TD td-admin']);
      const approve = async (u: TestUser, no: string) =>
        json(
          await soApprovePOST(
            await request(`/api/sale-orders/${no}/approve`, u, { method: 'POST', body: { decision: 'approve' } }),
            { params: Promise.resolve({ no }) },
          ),
        );
      // R4: self-approval is checked on an approver (Manager) — CS may not approve at all
      assert.deepEqual([(await approve(U.manager, noOf(await so(U.manager, U.admin.id)))).body.error], [SELF_APPROVE]);
      const forManager = noOf(await so(U.admin, U.manager.id));
      const r = await approve(U.manager, forManager);
      assert.deepEqual([r.status, r.body.error], [403, SELF_APPROVE_SALES]);
      // an edit by someone else keeps who keyed it in; the salesperson changes
      assert.equal((await so(U.admin, U.seller.id, { no: bySeller })).status, 200);
      assert.deepEqual([(await hdOf(bySeller)).c, (await hdOf(bySeller)).s], [U.seller.id, U.seller.id]);
    });

    await test('R3 SO: a waiting order names the roles that may approve (R4: Manager); a draft none; 3 reads ส่งกลับแก้ไข (+ its filter)', async () => {
      await pool.query(`
        INSERT INTO approve_status (approve_status_id, approve_name_th)
          SELECT * FROM (VALUES (1, 'กำลังดำเนินการจัดทำ'), (2, 'รออนุมัติ'), (3, 'แก้ไขข้อมูล'), (4, 'อนุมัติแล้ว'), (5, 'ปฏิเสธ')) v(id, name)
           WHERE NOT EXISTS (SELECT 1 FROM approve_status s WHERE s.approve_status_id = v.id)`);
      const waiting = (await getSaleOrder(noOf(await so(U.admin, U.admin.id))))!;
      // the roles ticked SO Approve (R6; seeded: Manager), not the Sale Order edit grant (TD Seller has it);
      // System Admin always may — not listed
      assert.deepEqual(waiting.approverRoles, ['Manager']);
      const draft = (await getSaleOrder(noOf(await so(U.admin, U.admin.id, { submit: false }))))!;
      assert.deepEqual(draft.approverRoles, []);
      const back = noOf(await so(U.admin, U.admin.id));
      const r = await json(
        await soApprovePOST(
          await request(`/api/sale-orders/${back}/approve`, U.manager, {
            method: 'POST',
            body: { decision: 'reject', remark: 'TD fix' },
          }),
          { params: Promise.resolve({ no: back }) },
        ),
      );
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal((await getSaleOrder(back))!.approve, 'ส่งกลับแก้ไข');
      const page = await pageSaleOrders({ page: 1, pageSize: 25, q: back, f: {} }, { approve: 'ส่งกลับแก้ไข' });
      assert.deepEqual(
        page.rows.map((x) => [x.no, x.approve]),
        [[back, 'ส่งกลับแก้ไข']],
      );
    });

    await test("R3 stock: จ่ายออกอื่นๆ search finds a part by its English / Chinese name (the pickers' word search)", async () => {
      const { productsChanged, listProductsLite } = await import('@/server/services/stock');
      const { matchProducts } = await import('@/lib/product-match');
      await db.execute(sql`UPDATE product SET product_name_en = 'TD Brushroll window assembly', product_name_cn = 'TD滚刷窗组件',
      record_status = 'ACTIVE' WHERE product_code = ${P.a.code}`);
      productsChanged();
      const rows = await listProductsLite(); // what the pick page loads (useProducts)
      const codes = (q: string) => matchProducts(rows, q, Infinity).map((p) => p.sysCode);
      assert.ok(codes('brushroll window').includes(P.a.code), 'EN');
      assert.ok(codes('滚刷窗').includes(P.a.code), 'CN');
      assert.ok(!codes('brushroll nothing-like-this').includes(P.a.code));
    });

    await test('R3 customers: "+66 2000 0000" finds "02-000-0000" (search box, phone filter, the picker lookup)', async () => {
      const { listCustomers } = await import('@/server/services/customers');
      const { GET: lookupGET } = await import('@/app/api/customers/lookup/route');
      const hit = async (o: Parameters<typeof listCustomers>[0]) =>
        (await listCustomers(o)).some((c) => c.code === CUSTOMER);
      assert.ok(await hit({ q: '+6620000000' }), 'search box');
      assert.ok(await hit({ q: '+66 2000 0000' }), 'search box, spaced');
      assert.ok(await hit({ filters: { phone: '6620000000' } }), 'phone filter');
      const r = await json(
        await lookupGET(await request(`/api/customers/lookup?q=${encodeURIComponent('+6620000000')}`, U.admin)),
      );
      assert.ok(
        (r.body.rows as { code: string }[]).some((c) => c.code === CUSTOMER),
        'customer picker',
      );
    });
  }
  // ── Round 3: app shell + admin ──
  console.log('\nRound 3 — app shell + admin');
  {
    const { GET: meGET } = await import('@/app/api/sso/me/route');
    const { canViewPath } = await import('@/lib/modules');
    const { upsertUser, setUserDeleted } = await import('@/server/services/users');
    const { saveSimple, saveModel } = await import('@/server/services/masters');
    await test('R3 shell: /api/sso/me marks who used this browser (os_seen = user id); a signed-out browser gets signedOut, an expired one does not', async () => {
      const ok = await meGET(await request('/api/sso/me', U.admin));
      assert.equal(ok.status, 200);
      assert.equal(ok.cookies.get('os_seen')?.value, String(U.admin.id));
      // ออกจากระบบ cleared both cookies → the other open tabs go to /login?bye=1, no `next`
      const out = await json(await meGET(await request('/api/sso/me', null)));
      assert.deepEqual([out.status, out.body.signedOut], [401, true]);
      // idle expiry: the session cookie is gone but os_seen stays → the "expired" flow (back to this page)
      const expired = await json(
        await meGET(await request('/api/sso/me', null, { headers: { cookie: `os_seen=${U.admin.id}` } })),
      );
      assert.deepEqual([expired.status, expired.body.signedOut], [401, undefined]);
    });
    await test("R3 shell: a create page (…/new) needs the module's add, not only view; edit / list pages stay view", async () => {
      const viewOnly = {
        'Job Management': { add: false, edit: true, del: false, view: true },
        Quotation: { add: false, edit: false, del: false, view: true },
        'Sale Order': { add: false, edit: false, del: false, view: true },
      };
      for (const p of ['/jobs/new', '/quotation/new', '/sale/orders/new'])
        assert.equal(canViewPath(false, viewOnly, p), false, p);
      for (const p of ['/jobs/list', '/jobs/edit', '/quotation/edit', '/sale/orders', '/sale/orders/edit'])
        assert.equal(canViewPath(false, viewOnly, p), true, p);
      const adder = { 'Job Management': { add: true, edit: false, del: false, view: true } };
      assert.equal(canViewPath(false, adder, '/jobs/new'), true);
      assert.equal(
        canViewPath(false, { 'Job Management': { ...adder['Job Management'], view: false } }, '/jobs/new'),
        false,
      );
      assert.equal(canViewPath(true, {}, '/jobs/new'), true, 'admin');
    });
    await test('R3 masters: a duplicate name names the existing row and its state, under the field (brands / models / colors)', async () => {
      // by hand (max + 1): other fixtures insert manufacturer ids directly, the identity sequence lags behind
      const [brand] = (
        await db.execute<{
          id: number;
        }>(sql`INSERT INTO manufacturer (manufacturer_id, manufacturer_name, record_status, is_active)
          VALUES ((SELECT coalesce(max(manufacturer_id), 0) + 1 FROM manufacturer), 'TD Trail Brand R3', 'INACTIVE', false)
          RETURNING manufacturer_id AS id`)
      ).rows;
      const b = await fieldsOf(saveSimple('manufacturers', { name: 'td trail brand  r3' }, U.admin.id));
      assert.equal(b.status, 409);
      assert.equal(b.message, `มีชื่อนี้อยู่แล้ว: "TD Trail Brand R3" (รหัส ${brand!.id} · Inactive)`);
      assert.deepEqual(b.fields, { name: b.message });
      const color = await saveSimple('colors', { name: 'TD J R3 Teal' }, U.admin.id); // 'TD J%' rows are reset above
      await setSimpleStatus('colors', Number(color.id), 'DELETED', U.admin.id);
      const c = await fieldsOf(saveSimple('colors', { name: 'td j r3 TEAL' }, U.admin.id));
      assert.deepEqual(c.fields, { name: `มีชื่อนี้อยู่แล้ว: "TD J R3 Teal" (รหัส ${color.id} · อยู่ในรายการที่ลบ)` });
      const m = await saveModel({ name: 'TD J R3 Model', brand: 'TD J Brand', price: 0 }, U.admin.id);
      const d = await fieldsOf(saveModel({ name: 'td j r3 model', brand: 'TD J Brand', price: 0 }, U.admin.id));
      assert.deepEqual(d.fields, { name: `มีชื่อนี้อยู่แล้ว: "TD J R3 Model" (รหัส ${m.code})` });
    });
    await test('R3 admin users: restoring a deleted user brings them back INACTIVE (revoked stays revoked); restore of a live user → 409', async () => {
      const id = U.inactive.id; // a fixture already revoked (INACTIVE) — the case that came back ACTIVE
      const row = async () =>
        (
          await db.execute<{ rs: string; act: boolean; del: boolean }>(
            sql`SELECT record_status AS rs, is_active AS act, deleted AS del FROM app_user WHERE user_id = ${id}`,
          )
        ).rows[0];
      await setUserDeleted(id, true, U.admin.id);
      await setUserDeleted(id, false, U.admin.id);
      assert.deepEqual(await row(), { rs: 'INACTIVE', act: false, del: false });
      const [line] = (
        await db.execute<{ s: string }>(
          sql`SELECT summary AS s FROM audit_log WHERE entity = 'app_user' AND entity_key = ${String(id)} ORDER BY id DESC LIMIT 1`,
        )
      ).rows;
      assert.equal(line?.s, 'กู้คืนผู้ใช้ TD td-inactive (ยังปิดการใช้งาน)');
      assert.equal(await statusOf(setUserDeleted(id, false, U.admin.id)), 409, 'not in the deleted list');
      assert.deepEqual(await row(), { rs: 'INACTIVE', act: false, del: false });
    });
    await test('R3 admin users: saving an account with nothing changed (your own included) writes no audit line', async () => {
      const count = async () =>
        (
          await db.execute<{ n: number }>(
            sql`SELECT count(*)::int AS n FROM audit_log WHERE entity = 'app_user' AND entity_key = ${String(U.admin.id)}`,
          )
        ).rows[0].n;
      const self = { id: String(U.admin.id), name: 'TD td-admin', role: 'System Admin', status: 'Active' };
      await upsertUser(self, U.admin.id); // the fixture row → this form's values (may write one line)
      const before = await count();
      await upsertUser(self, U.admin.id);
      await upsertUser(self, U.admin.id);
      assert.equal(await count(), before);
      await upsertUser({ ...self, name: 'TD td-admin2' }, U.admin.id);
      assert.equal(await count(), before + 1, 'a real change is still audited');
      await upsertUser(self, U.admin.id);
    });
  }
  // ── Round 3: jobs ──
  console.log('\nRound 3 — jobs (closed-job status / เสนอ-only parts / out-source receive / close / export / phone)');
  {
    const { saveSwapRefund, markPartsIssued, listJobs } = await import('@/server/services/jobs');
    const { REOPEN_LOCKED, returnDetailOf } = await import('@/lib/validation/job');
    const { exportXlsx } = await import('@/server/export');
    const ExcelJS = (await import('exceljs')).default;
    const job = (no: string, status: number, customer = `${CUSTOMER} ลูกค้า ทดสอบโดเมน`) =>
      `('${no}', ${status}, 9001, '${customer}', 'Model TD', now(), current_date, '1900-01-01')`;
    const part = (no: string, pick: boolean) =>
      `('${no}', '${P.a.code}', '', 1, true, ${pick}, 1, 1, now(), ${U.admin.id}, 0, 0)`;
    await pool.query(`
      INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date)
        VALUES ${job('TDJ0401', 20)}, ${job('TDJ0402', 3)}, ${job('TDJ0403', 2)}, ${job('TDJ0404', 5)}, ${job('TDJ0405', 20)},
               ${job('TDJ0406', 2, `${CUSTOMER} ลูกค้า R3 โทร 089-999-3466`)};
      INSERT INTO job_order_spare_part_log (job_no, spare_part_code, spare_part_serial_no, stock_id, is_quotation, is_special, request_qty, order_status_id, request_date, request_by, grant_qty, return_qty)
        VALUES ${part('TDJ0402', true)}, ${part('TDJ0402', false)};
      UPDATE job SET service_cost = 1300, spare_part_total_cost = 0, job_total_cost = 1300, deposit_cost = 300,
                     job_payment_type = 'เงินสด', job_payment_amount = 500 WHERE job_no = 'TDJ0405';`);
    await test('R3 jobs: a closed job re-saved with its own status stays closed; an open status → 409 (not System Admin); admin may', async () => {
      const [s20, s5, s2] = [await statusName(20), await statusName(5), await statusName(2)];
      // what /jobs/repair now sends for a closed job: its current status, unchanged
      const same = await fieldsOf(saveRepair('TDJ0401', { status: s20, repairDetail: 'TD R3 note' }, U.clerk.id));
      assert.equal(same.status, 200, JSON.stringify(same));
      assert.deepEqual([(await jobRow('TDJ0401')).s, await logRows('TDJ0401')], [20, []]);
      // picking an open status by mistake: refused on every path (setStatus), nothing written
      const repair = await fieldsOf(saveRepair('TDJ0401', { status: s5, repairDetail: 'TD R3 x' }, U.clerk.id));
      assert.deepEqual([repair.status, repair.fields], [409, { status: REOPEN_LOCKED }]);
      const swap = await fieldsOf(saveSwapRefund('TDJ0401', { status: s2, newSerial: 'TDR3SERIAL' }, U.clerk.id));
      assert.equal(swap.status, 409);
      const s14 = await statusName(14);
      const out = await fieldsOf(
        saveOutsource('TDJ0401', { send: { to: 'TD Vendor R3', date: '2026-10-10' }, status: s14 }, U.clerk.id),
      );
      assert.equal(out.status, 409, 'out-source sent (14)');
      assert.deepEqual([(await jobRow('TDJ0401')).s, await logRows('TDJ0401')], [20, []]);
      assert.equal((await getJob('TDJ0401'))!.repairDetail, 'TD R3 note');
      // System Admin re-opens on purpose
      assert.equal((await fieldsOf(saveRepair('TDJ0401', { status: s5 }, U.admin.id))).status, 200);
      assert.deepEqual([(await jobRow('TDJ0401')).s, await logRows('TDJ0401')], [5, [5]]);
    });
    await test('R3 jobs: stock issues every เบิก line → เบิกจ่ายอะไหล่ครบแล้ว (10), a เสนอ-only line does not hold it at 3', async () => {
      await setStock(P.a.code, 10);
      const [log] = (
        await db.execute<{ id: number }>(
          sql`SELECT job_order_log_id AS id FROM job_order_spare_part_log WHERE job_no = 'TDJ0402' AND is_special`,
        )
      ).rows;
      await issueForJob({ jobNo: 'TDJ0402', lines: [{ logId: log.id, qty: 1 }] }, U.admin.id);
      await markPartsIssued('TDJ0402', U.admin.id); // what POST /api/stock/issue calls next
      assert.equal((await jobRow('TDJ0402')).s, 10);
      assert.deepEqual(await logRows('TDJ0402'), [10]);
    });
    await test('R3 jobs: out-source already back — saving again with a new หมายเหตุการรับคืน stores it (one row, still 15)', async () => {
      const [s14, s15] = [await statusName(14), await statusName(15)];
      const send = { to: 'TD Vendor R3', date: '2026-10-10' };
      await saveOutsource('TDJ0403', { send, status: s14 }, U.admin.id);
      const receive = { from: send.to, date: '2026-10-12', detail: 'TD first note', by: U.admin.id };
      await saveOutsource('TDJ0403', { receive, status: s15 }, U.admin.id);
      // what the page sends once the row is back: the send block + the receive block (its note edited)
      const r = await fieldsOf(
        saveOutsource('TDJ0403', { send, receive: { ...receive, detail: 'TD edited note' }, status: s15 }, U.admin.id),
      );
      assert.equal(r.status, 200, JSON.stringify(r));
      const rows = (
        await db.execute<{ st: string; d: string; vendor: string }>(
          sql`SELECT send_status AS st, receive_detail AS d, send_to_name AS vendor FROM job_send_forward_dt WHERE job_no = 'TDJ0403'`,
        )
      ).rows;
      assert.deepEqual(rows, [{ st: 'รับเครื่องซ่อมแล้ว', d: 'TD edited note', vendor: send.to }]);
      assert.equal((await jobRow('TDJ0403')).s, 15);
    });
    await test('R3 jobs: close — a return note starting with a longer carrier name ("ไปรษณีย์ไทย · …") is not prefixed again', async () => {
      assert.equal(returnDetailOf('ไปรษณีย์', 'ไปรษณีย์ไทย · ฝากหน้าบ้าน'), 'ไปรษณีย์ไทย · ฝากหน้าบ้าน');
      assert.equal(returnDetailOf('Flash', 'ฝากหน้าบ้าน'), 'Flash · ฝากหน้าบ้าน');
      const ret = { type: 'บริษัทขนส่งเอกชน', date: '2026-10-15', courier: 'ไปรษณีย์', detail: 'ไปรษณีย์ไทย · TD R3' };
      for (let n = 0; n < 2; n++) await closeJob('TDJ0404', { status: await statusName(20), return: ret }, U.admin.id);
      assert.equal((await getJob('TDJ0404'))!.return.detail, 'ไปรษณีย์ไทย · TD R3');
    });
    await test('R3 jobs: the job list Excel has มัดจำ and ค้างชำระ (1,300 − deposit 300 − paid 500 = 500)', async () => {
      const { buffer } = await exportXlsx(await request('/api/export/jobs?q=TDJ0405', U.admin), 'jobs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      const ws = wb.worksheets[0]!;
      const [head, row] = [1, 2].map((n) => (ws.getRow(n).values as unknown[]).slice(1));
      assert.equal(row[head.indexOf('เลขที่งาน')], 'TDJ0405');
      assert.deepEqual([row[head.indexOf('มัดจำ')], row[head.indexOf('ค้างชำระ')]], [300, 500]);
    });
    await test('R3 jobs: a phone typed as +66… finds "089-999-3466" (search box and phone filter)', async () => {
      const found = async (f: Parameters<typeof listJobs>[0]) => (await listJobs(f)).some((j) => j.no === 'TDJ0406');
      assert.ok(await found({ q: '+66899993466' }), 'search +66');
      assert.ok(await found({ q: '+66 89 999 3466' }), 'search with spaces');
      assert.ok(await found({ phone: '+66899993466' }), 'phone filter');
      assert.ok(await found({ q: '0899993466' }), 'the 0 form still works');
      assert.ok(!(await found({ q: '+66899993467' })), 'another number');
    });
  }
  // ── Round 4: sale orders ──
  console.log('\nRound 4 — sale orders');
  {
    const { NOT_APPROVER, SUBMIT_CREATOR_ONLY } = await import('@/server/services/sale-orders');
    const { WAITING_CREATOR_ONLY } = await import('@/lib/validation/sale-order');
    const post = async (u: TestUser, body: Record<string, unknown>) =>
      json(await soPOST(await request('/api/sale-orders', u, { method: 'POST', body })));
    const save = (u: TestUser, submit: boolean, no?: string) =>
      post(u, { no, customerCode: CUSTOMER, salesId: U.admin.id, submit, lines: [{ code: P.a.code, qty: 1 }] });
    const create = async (u: TestUser, submit: boolean) => {
      const r = await save(u, submit);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return (r.body.order as { no: string }).no;
    };
    const decide = async (u: TestUser, no: string, decision: string) =>
      json(
        await soApprovePOST(
          await request(`/api/sale-orders/${no}/approve`, u, {
            method: 'POST',
            body: { decision, remark: 'TD R4' },
          }),
          { params: Promise.resolve({ no }) },
        ),
      );
    const statusOfSO = async (no: string) =>
      (
        await db.execute<{ s: number }>(
          sql`SELECT approve_status_id AS s FROM sale_out_hd WHERE sale_out_hd_no = ${no}`,
        )
      ).rows[0].s;

    await test("R4 SO: only Manager / System Admin decide — CS (Sale Order edit) on another CS's order → 403, stock untouched; Manager → 200", async () => {
      await setStock(P.a.code, 10);
      const no = await create(U.seller, true); // keyed in by one CS (salesperson: admin) …
      for (const d of ['approve', 'deny', 'reject']) {
        const r = await decide(U.seller2, no, d); // … decided by another CS
        assert.deepEqual([r.status, r.body.error], [403, NOT_APPROVER], d);
      }
      assert.equal(await statusOfSO(no), 2, 'still waiting');
      assert.equal((await qty(P.a.code)).remain, 10, 'nothing went out');
      const ok = await decide(U.manager, no, 'approve');
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.equal((await qty(P.a.code)).remain, 9);
    });

    await test('R4 SO: only the creator sends it for approval — someone else 403 (a plain save keeps the status); creator / System Admin 200', async () => {
      const draft = await create(U.seller, false);
      const r = await save(U.manager, true, draft); // an approver submits someone's draft …
      assert.deepEqual([r.status, r.body.error], [403, SUBMIT_CREATOR_ONLY]);
      assert.equal(await statusOfSO(draft), 1);
      assert.equal((await save(U.manager, false, draft)).status, 200, 'an edit without submit');
      assert.equal(await statusOfSO(draft), 1, 'kept');
      assert.equal((await save(U.seller, true, draft)).status, 200, 'the creator');
      assert.equal(await statusOfSO(draft), 2);
      // R5 owner decision: a waiting order is edited only by its creator (System Admin may)
      const waiting = await save(U.manager, false, draft);
      assert.deepEqual(
        [waiting.status, waiting.body.error],
        [403, WAITING_CREATOR_ONLY],
        'a waiting order: creator only',
      );
      assert.equal(await statusOfSO(draft), 2, '… stays waiting');
      const other = await create(U.seller, false);
      assert.equal((await save(U.admin, true, other)).status, 200, 'System Admin');
      assert.equal(await statusOfSO(other), 2);
    });
  }
  // ── Round 4: jobs ──
  console.log('\nRound 4 — jobs (charged parts / deposit refund / who may take a job)');
  {
    const { listStaff } = await import('@/server/services/users');
    const { NOT_ENGINEER, REFUND_REQUIRED, partCharge, refundDateOf } = await import('@/lib/validation/job');
    const job = (no: string, status: number, eng = 0) =>
      `('${no}', ${status}, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01', ${eng})`;
    await pool.query(`
      INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date, engineer_id)
        VALUES ${job('TDJ0501', 2, U.engineer.id)}, ${job('TDJ0502', 5)}, ${job('TDJ0503', 1)};
      UPDATE job SET deposit_cost = 500, service_cost = 300, spare_part_total_cost = 0, job_total_cost = 300,
                     job_payment_type = '', job_payment_amount = 0 WHERE job_no = 'TDJ0502';`);

    await test('R4 jobs: only เบิก lines are charged — เบิก 200 + เสนอ-only 250 → 200; ticking เบิก on the second → 450', async () => {
      await setStock(P.a.code, 10);
      await setStock(P.b.code, 10);
      const line = (code: string, price: number, pick: boolean, logId?: number) => ({
        logId,
        code,
        unitPrice: price,
        a: { pick, quote: true, qty: 1 },
        b: { pick: false, quote: false, qty: 0 },
      });
      const status = (await getJob('TDJ0501'))!.status;
      await saveRepair(
        'TDJ0501',
        { status, parts: [line(P.a.code, 200, true), line(P.b.code, 250, false)] },
        U.engineer.id,
      );
      let j = (await getJob('TDJ0501'))!;
      assert.deepEqual([j.partsCost, j.totalCost], [200, 200]);
      const id = (code: string) => j.parts.find((p) => p.code === code)!.logId;
      const parts = [line(P.a.code, 200, true, id(P.a.code)), line(P.b.code, 250, true, id(P.b.code))];
      await saveRepair('TDJ0501', { status: j.status, parts }, U.engineer.id);
      j = (await getJob('TDJ0501'))!;
      assert.deepEqual([j.partsCost, j.totalCost], [450, 450]);
      // the repair page's ค่าอะไหล่ uses the same rule
      assert.equal(partCharge({ pick: false, quote: true, qty: 1 }, 250), 0);
      assert.equal(partCharge({ pick: true, quote: true, qty: 2 }, 250), 500);
    });

    await test('R4 jobs: deposit 500 > total 300 → the close asks for the refund (400 under refund.*, ≤ 200), stored as −200 "คืนมัดจำ <date>"', async () => {
      const s20 = await statusName(20);
      const back = { type: 'ลูกค้ามารับเอง', date: '2026-10-15' };
      const none = await fieldsOf(closeJob('TDJ0502', { status: s20, return: back }, U.clerk.id));
      assert.deepEqual([none.status, none.fields], [400, { 'refund.type': REFUND_REQUIRED }]);
      const refund = { type: 'เงินสด', amount: 250, date: '2026-10-15' };
      const over = await fieldsOf(closeJob('TDJ0502', { status: s20, return: back, refund }, U.clerk.id));
      assert.deepEqual([over.status, Object.keys(over.fields ?? {})], [400, ['refund.amount']]);
      assert.equal((await jobRow('TDJ0502')).s, 5, 'not closed');
      const ok = await fieldsOf(
        closeJob('TDJ0502', { status: s20, return: back, refund: { ...refund, amount: 200 } }, U.clerk.id),
      );
      assert.equal(ok.status, 200, JSON.stringify(ok));
      const j = (await getJob('TDJ0502'))!;
      assert.deepEqual(
        [j.statusId, j.payment.type, j.payment.amount, j.payment.detail, j.outstanding, j.depositRefund],
        [20, 'เงินสด', -200, 'คืนมัดจำ 2026-10-15', 0, 200],
      );
      assert.equal(refundDateOf(j.payment.detail), '2026-10-15', 'the date the return note prints');
      // closed: the money is locked — a re-save is not asked for the refund again, and cannot change it
      assert.equal((await fieldsOf(closeJob('TDJ0502', { status: s20, return: back }, U.clerk.id))).status, 200);
      const again = { status: s20, return: back, refund: { ...refund, amount: 100 } };
      assert.equal((await fieldsOf(closeJob('TDJ0502', again, U.clerk.id))).status, 409);
      assert.equal((await getJob('TDJ0502'))!.payment.amount, -200);
    });

    await test('R4 jobs: only an Engineer / Head Engineer takes a job (400 under engineerId; the current one re-saved passes); history: who gave it to whom', async () => {
      // the มอบหมายงานนี้ให้ picker = the staff list filtered by Job Take (Engineer has it: 0030)
      const offered = (await listStaff()).filter((u) => u.takesJobs).map((u) => u.id);
      assert.ok(offered.includes(U.engineer.id) && !offered.includes(U.clerk.id), 'engineers only');
      const assign = await fieldsOf(assignJobs(['TDJ0503'], U.clerk.id, U.admin.id));
      assert.deepEqual([assign.status, assign.fields], [400, { engineerId: NOT_ENGINEER }]);
      const j = (await getJob('TDJ0503'))!;
      // what the edit form sends back (warrantyMonth too: a stored 0 counts as filled once saved)
      const input = { customerCode: CUSTOMER, dueDate: j.dueDate, warrantyMonth: j.warrantyMonth };
      const edit = await fieldsOf(updateJob('TDJ0503', { ...input, engineerId: U.clerk.id }, U.admin.id));
      assert.deepEqual([edit.status, edit.fields], [400, { engineerId: NOT_ENGINEER }]);
      const assigned = async () => (await getJob('TDJ0503'))!.history.find((h) => h.action === 'ASSIGN')?.summary;
      await assignJobs(['TDJ0503'], U.engineer.id, U.admin.id);
      assert.equal(await assigned(), 'TD td-admin มอบหมายงานให้ TD td-engineer');
      // an old job on someone who is not an engineer: saved again unchanged → still fine
      await pool.query(`UPDATE job SET engineer_id = ${U.clerk.id} WHERE job_no = 'TDJ0503'`);
      const kept = await fieldsOf(updateJob('TDJ0503', { ...input, engineerId: U.clerk.id }, U.admin.id));
      assert.equal(kept.status, 200, JSON.stringify(kept));
      // the edit / repair picker takes it over → the history names both
      await updateJob('TDJ0503', { ...input, engineerId: U.engineer.id, takeOver: true }, U.admin.id);
      assert.equal(await assigned(), 'TD td-admin เปลี่ยนผู้รับงานจาก TD td-clerk เป็น TD td-engineer');
    });
  }
  // ── Round 4: landing page + notification bell ──
  console.log('\nRound 4 — landing page + bell (sale orders waiting for approval)');
  {
    const { GET: pendingGET } = await import('@/app/api/alerts/sale-orders-pending/route');
    const { landingPath } = await import('@/app/landing');
    const { grantsForUserType } = await import('@/server/auth');
    const { NOT_APPROVER } = await import('@/lib/validation/sale-order');
    const waitingOrder = async (u: TestUser, salesId: number) => {
      const body = { customerCode: CUSTOMER, salesId, submit: true, lines: [{ code: P.a.code, qty: 1 }] };
      const r = await json(await soPOST(await request('/api/sale-orders', u, { method: 'POST', body })));
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return (r.body.order as { no: string }).no;
    };
    const pending = async (u: TestUser) => json(await pendingGET(await request('/api/alerts/sale-orders-pending', u)));
    const nosOf = (body: Record<string, unknown>) => (body.items as { no: string }[]).map((i) => i.no);

    await test('R4 bell: Manager gets the waiting sale orders minus the ones they created / sell; System Admin all; CS → 403', async () => {
      const others = await waitingOrder(U.seller, U.admin.id); // newest first, so these three lead the list
      const created = await waitingOrder(U.manager, U.admin.id);
      const sold = await waitingOrder(U.seller, U.manager.id);
      const m = await pending(U.manager);
      assert.equal(m.status, 200, JSON.stringify(m.body));
      const nos = nosOf(m.body);
      assert.ok(nos.includes(others), 'someone else’s waiting order is listed');
      assert.ok(!nos.includes(created), 'not the one the Manager keyed in (approveSaleOrder refuses it)');
      assert.ok(!nos.includes(sold), 'not the one the Manager is the salesperson of');
      assert.ok((m.body.total as number) >= nos.length);
      const item = (m.body.items as { no: string; amount: number; createdBy: string }[]).find((i) => i.no === others)!;
      assert.ok(item.amount > 0 && item.createdBy, JSON.stringify(item));
      const a = await pending(U.admin);
      assert.equal(a.status, 200);
      for (const no of [others, created, sold]) assert.ok(nosOf(a.body).includes(no), `System Admin sees ${no}`);
      const cs = await pending(U.seller); // Sale Order view + edit, not an approver
      assert.deepEqual([cs.status, cs.body.error], [403, NOT_APPROVER]);
    });

    await test('R4 landing: Manager with Sale Order view → /sale/orders?pending=1; System Admin / CS unchanged', async () => {
      const at = async (u: TestUser) => {
        const cu = await userOf(u);
        return landingPath(cu, cu.isAdmin ? {} : await grantsForUserType(cu.userType));
      };
      assert.equal(await at(U.manager), '/sale/orders?pending=1');
      assert.equal(await at(U.admin), '/jobs/dashboard', 'System Admin keeps the dashboard');
      assert.equal(await at(U.seller), '/sale/orders', 'a CS: the first menu page it may open, as before');
      assert.equal(landingPath({ isAdmin: false, userType: 'Manager' }, {}), '/admin/guide', 'no Sale Order view');
    });
  }
  // ── Round 5: customer /track + print documents ──
  console.log('\nRound 5 — customer /track + print documents');
  {
    const tracking = await import('@/server/services/tracking');
    // TDJ0391 comes from the Round 3 /track block

    await test('R5 track: masking — address cut at the postcode (no trailing phone), "นาย." title, companies', async () => {
      assert.equal(
        tracking.maskAddress(
          '256 หมู่15 ต.รอบเวียง อ.เมือง จ.เชียงราย 57000 โทร 095-4104532 ( ร.17 พัน.3) ต.รอบเวียง 57000',
        ),
        'ต.รอบเวียง อ.เมือง จ.เชียงราย 57000',
      );
      assert.equal(
        tracking.maskAddress('26/126 ต.ในเมือง อ.เมือง จ.พิษณุโลก 65000 เบอร์โทร 0814747040'),
        'ต.ในเมือง อ.เมือง จ.พิษณุโลก 65000',
      );
      assert.equal(
        tracking.maskAddress('12 ต.บ้านไร่ โทร 081-234-5678 จ.ราชบุรี'),
        'ต.บ้านไร่ โทร จ.ราชบุรี',
        'no postcode',
      );
      assert.equal(tracking.maskAddress('99/1 ซ.สุขใจ กรุงเทพ 10310 0812345678'), '10310', 'no ตำบล: postcode only');
      assert.equal(
        tracking.maskAddress('99/1 ซ.สุขใจ แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพมหานคร 10310'),
        'แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพมหานคร 10310',
        'a clean address is unchanged',
      );
      assert.equal(tracking.maskName('นาย.อัครพล ใจดี'), 'คุณ อัค…');
      assert.equal(tracking.maskName('น.ส.สมหญิง'), 'คุณ สมห…');
      assert.equal(tracking.maskName('บริษัท เอบีซี จำกัด'), 'บริษัท เอบ…');
      assert.equal(tracking.maskName('ร้านสมใจโมบาย'), 'ร้าน สมใ…');
    });
    await test('R5 track docs: customer copy drops job remark / engineer remark / return detail; SO masked; /track status words', async () => {
      const staff = (await getJob('TDJ0391'))!;
      const j = tracking.maskJobForCustomer({
        ...staff,
        statusId: 14,
        statusGroup: 'Pending',
        status: 'อยู่ระหว่างการซ่อม - ส่งซ่อม Out-Source แล้ว',
        remark: 'ลูกค้าโวยวาย',
        engineerRemark: 'พี่บอมเช็คแล้ว',
        so: '240915ABCD1234',
        return: { ...staff.return, type: 'ส่งพัสดุ', tracking: 'TH123', detail: 'คืนเงินนอกระบบ' },
      });
      assert.deepEqual(
        [j.remark, j.engineerRemark, j.return.detail, j.return.type, j.return.tracking, j.so],
        ['', '', '', 'ส่งพัสดุ', 'TH123', '••••1234'],
      );
      assert.equal(j.status, 'กำลังตรวจสอบ / ซ่อม', 'not the internal status name');
    });
    await test('R5 track: status words for 6 / 17 / 18 / 19 / 22 — 6 is not "ยกเลิกรายการ"; every id 0–24 has one', async () => {
      // job_status_group as in the legacy dump; every other id is Pending
      const group: Record<number, string> = { 0: 'Cancel' };
      for (const id of [5, 6, 9, 18, 19, 22]) group[id] = 'Repaired';
      for (const id of [7, 8, 20, 21, 23, 24]) group[id] = 'Finished';
      const label = (id: number) => tracking.statusLabel(id, tracking.stepOf(id, group[id] ?? 'Pending'));
      assert.equal(label(6), 'ไม่ซ่อม — รอส่งคืน/รับคืนเครื่อง');
      assert.notEqual(tracking.stepOf(6, 'Repaired'), null, 'not cancelled');
      assert.equal(tracking.inProgressForCustomer(6, 'Repaired'), true, 'listed under กำลังดำเนินการ');
      assert.equal(label(17), 'รับเครื่องเข้าคลังแล้ว — รอเปลี่ยนเครื่องหรือคืนเงิน');
      assert.equal(label(18), 'เปลี่ยนเครื่องใหม่ — เตรียมส่งคืน');
      assert.equal(label(19), 'คืนเงินแล้ว');
      assert.equal(label(22), 'ตรวจแล้วไม่พบอาการเสีย — เตรียมส่งคืน');
      for (let id = 0; id <= 24; id++) {
        assert.ok(label(id), `status ${id} has words`);
        assert.equal(tracking.stepOf(id, group[id] ?? 'Pending') === null, id === 0, `only 0 is cancelled (${id})`);
      }
    });
    await test('R5 quotation sign block: only a sent, unexpired quotation asks to be signed', async () => {
      const today = (await import('@/lib/dates')).today();
      const s = tracking.quoteSignState;
      assert.deepEqual(
        [s(2, today, 4), s(1, today, 13), s(2, '2001-04-10', 4), s(8, today, 16), s(2, today, 16)],
        ['sign', 'sign', 'expired', 'expired', 'expired'],
      );
      assert.deepEqual([s(3, today, 12), s(6, today, 12), s(9, today, 3)], ['agreed', 'agreed', 'agreed']);
      assert.deepEqual([s(4, today, 6), s(5, today, 2)], ['declined', 'cancelled']);
    });
  }
  // ── Round 5: auth + admin ──
  console.log('\nRound 5 — sign-out marker, own email, deleted users, cancel / restore, bell, migration 0029');
  {
    const { GET: callbackGET } = await import('@/app/api/sso/callback/route');
    const { GET: logoutGET } = await import('@/app/api/sso/logout/route');
    const { GET: meGET } = await import('@/app/api/sso/me/route');
    const { proxy } = await import('@/proxy');
    const { SSO } = await import('@/lib/sso');
    const { upsertUser, setUserDeleted } = await import('@/server/services/users');
    const { POST: usersPOST } = await import('@/app/api/admin/users/route');
    const { POST: recordsPOST } = await import('@/app/api/admin/records/route');
    const { GET: pendingGET } = await import('@/app/api/alerts/sale-orders-pending/route');
    const { invalidateGrantCache, grantsForUserType } = await import('@/server/auth');
    const { canViewPath } = await import('@/lib/modules');
    const { readFileSync } = await import('node:fs');
    const records = async (u: TestUser, body: Record<string, unknown>) =>
      json(await recordsPOST(await request('/api/admin/records', u, { method: 'POST', body })));

    await test('R5 sign-out: logout leaves os_seen=0 → /me signedOut, proxy adds no "expired", callback keeps `next` only for the same user', async () => {
      const out = await logoutGET(await request('/api/sso/logout', null));
      assert.equal(out.cookies.get('os_seen')?.value, '0');
      const me = await json(await meGET(await request('/api/sso/me', null, { headers: { cookie: 'os_seen=0' } })));
      assert.deepEqual([me.status, me.body.signedOut], [401, true]);
      const login = async (seen: string) =>
        new URL(
          (await proxy(await request('/jobs/list', null, { headers: { cookie: `os_seen=${seen}` } }))).headers.get(
            'location',
          )!,
        );
      assert.equal((await login('0')).searchParams.get('expired'), null, 'signed out, not expired');
      assert.equal((await login(String(U.clerk.id))).searchParams.get('expired'), '1', 'a real idle expiry');

      const state = `${crypto.randomUUID()}|/jobs/list`;
      const realFetch = globalThis.fetch;
      const secret = process.env.SSO_CLIENT_SECRET;
      process.env.SSO_CLIENT_SECRET = 'td-secret';
      // the central SSO's verify answers for U.clerk; nothing else is reachable
      globalThis.fetch = (async (input: RequestInfo | URL) =>
        String(input instanceof Request ? input.url : input) === SSO.verifyUrl
          ? Response.json({ email: U.clerk.email, name: 'TD td-clerk', sub: 'td-sub' })
          : new Response('', { status: 404 })) as typeof fetch;
      try {
        const after = async (seen?: string) => {
          const cookie = [`os_state=${state}`, ...(seen === undefined ? [] : [`os_seen=${seen}`])].join('; ');
          const url = `/api/sso/callback?code=td-code&state=${encodeURIComponent(state)}`;
          const r = await callbackGET(await request(url, null, { headers: { cookie } }));
          assert.equal(r.status, 307, `redirect (${seen})`);
          const to = new URL(r.headers.get('location')!);
          return to.pathname + to.search;
        };
        assert.equal(await after('0'), '/', 'a `next` made after ออกจากระบบ is dropped');
        assert.equal(await after(String(U.admin.id)), '/', "someone else's page is dropped");
        assert.equal(await after(String(U.clerk.id)), '/jobs/list', 'the same person goes back to their page');
        assert.equal(await after(), '/jobs/list', 'a browser nobody used before keeps the link it was opened with');
      } finally {
        globalThis.fetch = realFetch;
        if (secret === undefined) delete process.env.SSO_CLIENT_SECRET;
        else process.env.SSO_CLIENT_SECRET = secret;
      }
    });

    await test('R5 admin users: your own email / username cannot be changed (409, row unchanged); the same email in other case / spaces saves', async () => {
      const row = async () =>
        (await db.execute(sql`SELECT email_address, username FROM app_user WHERE user_id = ${U.admin.id}`)).rows[0];
      const before = await row();
      const self = { id: String(U.admin.id), name: 'TD td-admin', role: 'System Admin', status: 'Active' };
      assert.equal(await statusOf(upsertUser({ ...self, email: 'td-other@example.invalid' }, U.admin.id)), 409);
      assert.equal(await statusOf(upsertUser({ ...self, username: 'td-admin-renamed' }, U.admin.id)), 409);
      assert.deepEqual(await row(), before);
      assert.equal(
        await statusOf(upsertUser({ ...self, email: `  ${U.admin.email.toUpperCase()} ` }, U.admin.id)),
        200,
      );
    });

    await test('R5 admin users: a DELETED user never goes straight back to Active (users API → 409; records → กู้คืน = INACTIVE)', async () => {
      const id = U.inactive.id;
      const rs = async () =>
        (await db.execute<{ rs: string }>(sql`SELECT record_status AS rs FROM app_user WHERE user_id = ${id}`)).rows[0]
          .rs;
      await setUserDeleted(id, true, U.admin.id);
      const body = { id: String(id), name: 'TD td-inactive', role: 'TD Customer Viewer', status: 'Active' };
      const api = await json(await usersPOST(await request('/api/admin/users', U.admin, { method: 'POST', body })));
      assert.deepEqual([api.status, api.body.error], [409, 'ผู้ใช้นี้ถูกลบ — กู้คืนก่อน']);
      assert.equal(await rs(), 'DELETED');
      assert.equal(
        (await records(U.admin, { table: 'users', id, status: 'INACTIVE' })).status,
        409,
        'not around กู้คืน',
      );
      assert.equal(await rs(), 'DELETED');
      const back = await records(U.admin, { table: 'users', id, status: 'ACTIVE' });
      assert.deepEqual([back.status, back.body.status], [200, 'INACTIVE']);
      assert.equal(await rs(), 'INACTIVE');
    });

    await test('R5 records: an approved sale order (stock issued) cannot be cancelled; a waiting one can', async () => {
      await setStock(P.a.code, 10);
      const order = async () => {
        const body = {
          customerCode: CUSTOMER,
          salesId: U.seller.id,
          submit: true,
          lines: [{ code: P.a.code, qty: 1 }],
        };
        const r = await json(await soPOST(await request('/api/sale-orders', U.seller, { method: 'POST', body })));
        assert.equal(r.status, 201, JSON.stringify(r.body));
        return (r.body.order as { no: string }).no;
      };
      const approved = await order();
      const ok = await soApprovePOST(
        await request(`/api/sale-orders/${approved}/approve`, U.admin, {
          method: 'POST',
          body: { decision: 'approve' },
        }),
        { params: Promise.resolve({ no: approved }) },
      );
      assert.equal(ok.status, 200);
      const cancel = await records(U.admin, { table: 'sale_orders', id: approved, status: 'DELETED' });
      assert.equal(cancel.status, 409, JSON.stringify(cancel.body));
      const [hd] = (
        await db.execute<{ rs: string; doc: boolean }>(
          sql`SELECT record_status AS rs, document_status AS doc FROM sale_out_hd WHERE sale_out_hd_no = ${approved}`,
        )
      ).rows;
      assert.deepEqual(hd, { rs: 'ACTIVE', doc: true });
      const waiting = await order();
      assert.equal((await records(U.admin, { table: 'sale_orders', id: waiting, status: 'DELETED' })).status, 200);
    });

    await test('R5 records: restoring a deleted job puts back its status before the delete (job_log), else 1 งานใหม่', async () => {
      await pool.query(`
        INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date)
          VALUES ('TDJ0551', 5, 9001, '${CUSTOMER}', 'Model TD', now(), current_date, '1900-01-01'),
                 ('TDJ0552', 2, 9001, '${CUSTOMER}', 'Model TD', now(), current_date, '1900-01-01');
        INSERT INTO job_log (job_no, job_status_id, job_log_date, job_action_by)
          VALUES ('TDJ0551', 1, now() - interval '2 days', ${U.admin.id}), ('TDJ0551', 5, now() - interval '1 day', ${U.admin.id});`);
      const state = async (no: string) =>
        (
          await db.execute<{ st: number; rs: string; log: string }>(sql`
            SELECT j.job_status_id AS st, j.record_status AS rs,
                   (SELECT string_agg(job_status_id::text, ',' ORDER BY job_log_id) FROM job_log l WHERE l.job_no = j.job_no) AS log
              FROM job j WHERE j.job_no = ${no}`)
        ).rows[0];
      for (const no of ['TDJ0551', 'TDJ0552']) await setRecordStatus('jobs', no, 'DELETED', U.admin.id);
      assert.equal((await state('TDJ0551')).st, 0);
      for (const no of ['TDJ0551', 'TDJ0552']) await setRecordStatus('jobs', no, 'ACTIVE', U.admin.id);
      assert.deepEqual(await state('TDJ0551'), { st: 5, rs: 'ACTIVE', log: '1,5,0,5' });
      assert.deepEqual(await state('TDJ0552'), { st: 1, rs: 'ACTIVE', log: '0,1' }, 'no history → งานใหม่');
    });

    await test('R5 bell: the waiting-orders list needs Sale Order EDIT (as approving does) — a view-only Manager → 403', async () => {
      const pending = async () =>
        (await pendingGET(await request('/api/alerts/sale-orders-pending', U.manager))).status;
      assert.equal(await pending(), 200);
      await pool.query(
        `UPDATE app_config SET can_edit = false WHERE user_type = 'Manager' AND module_name = 'Sale Order'`,
      );
      invalidateGrantCache();
      try {
        assert.equal(await pending(), 403);
      } finally {
        await pool.query(
          `UPDATE app_config SET can_edit = true WHERE user_type = 'Manager' AND module_name = 'Sale Order'`,
        );
        invalidateGrantCache();
      }
    });

    await test('R5 migration 0029: Account / Audit may view sale orders (list + edit page), nothing more; a bigger grant is kept; re-runnable', async () => {
      const file = readFileSync('drizzle/0029_round5_sale_order_view_account_audit.sql', 'utf8');
      await pool.query(`
        DELETE FROM app_config WHERE user_type = 'Account' AND module_name = 'Sale Order';
        INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view)
          VALUES ('Audit', 'Sale Order', false, true, false, false)
          ON CONFLICT (user_type, module_name) DO UPDATE SET can_insert = false, can_edit = true, can_delete = false, can_view = false;`);
      const state = async () =>
        (
          await pool.query(`SELECT user_type t, can_insert i, can_edit e, can_delete d, can_view v FROM app_config
                             WHERE module_name = 'Sale Order' AND user_type IN ('Account', 'Audit') ORDER BY 1`)
        ).rows;
      const want = [
        { t: 'Account', i: false, e: false, d: false, v: true },
        { t: 'Audit', i: false, e: true, d: false, v: true },
      ];
      await pool.query(file);
      assert.deepEqual(await state(), want);
      await pool.query(file);
      assert.deepEqual(await state(), want, 'second run changes nothing');
      invalidateGrantCache();
      const g = await grantsForUserType('Account');
      for (const p of ['/sale/orders', '/sale/orders/edit']) assert.equal(canViewPath(false, g, p), true, p);
      assert.equal(canViewPath(false, g, '/sale/orders/new'), false);
    });
  }
  // ── Round 5: sale orders + quotations + customers + stock ──
  console.log('\nRound 5 — sale orders + quotations + customers + stock');
  {
    const { getSaleOrder } = await import('@/server/services/sale-orders');
    const { WAITING_CREATOR_ONLY, SO_CANCELLED, SELF_APPROVE_SALES } = await import('@/lib/validation/sale-order');
    const { issueForSaleOrder } = await import('@/server/services/stock');
    const { getQuotation: loadQuotation } = await import('@/server/services/quotations');
    const { listCustomers, findCustomerConflicts } = await import('@/server/services/customers');
    const { GET: productGET } = await import('@/app/api/products/[code]/route');
    const { POST: uploadPOST } = await import('@/app/api/upload/route');
    type Order = {
      no: string;
      version: number;
      salesId: number;
      lines: { code: string; qty: number; price: number }[];
    };
    const post = async (u: TestUser, body: Record<string, unknown>) =>
      json(await soPOST(await request('/api/sale-orders', u, { method: 'POST', body })));
    const newSO = async (u: TestUser, extra: Record<string, unknown> = {}) => {
      const r = await post(u, {
        customerCode: CUSTOMER,
        salesId: u.id,
        submit: true,
        lines: [{ code: P.a.code, qty: 1, price: 100 }],
        ...extra,
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body.order as Order;
    };
    const decide = async (u: TestUser, no: string, body: Record<string, unknown>) =>
      json(
        await soApprovePOST(await request(`/api/sale-orders/${no}/approve`, u, { method: 'POST', body }), {
          params: Promise.resolve({ no }),
        }),
      );
    const hdOf = async (no: string) =>
      (
        await db.execute<{ s: number; by: number; rv: number; rs: string }>(
          sql`SELECT approve_status_id AS s, sale_out_by AS by, row_version AS rv, record_status AS rs
                FROM sale_out_hd WHERE sale_out_hd_no = ${no}`,
        )
      ).rows[0];
    const dtOf = async (no: string) =>
      (
        await db.execute<{ id: number; code: string; q: number; p: string; retail: string; type: string; ln: number }>(
          sql`SELECT sale_out_dt_id AS id, product_code AS code, sale_out_quantity AS q, sale_out_price AS p,
                     retail_price AS retail, product_type AS type, list_no AS ln
                FROM sale_out_dt WHERE sale_out_hd_no = ${no} ORDER BY list_no, sale_out_dt_id`,
        )
      ).rows;
    const errOf = async (p: Promise<unknown>) => {
      try {
        await p;
        return '';
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    };

    await test('R5 SO: a waiting order is edited only by its creator — Manager changing the salesperson / another CS the price → 403, nothing saved; creator / System Admin 200', async () => {
      const o = await newSO(U.seller, { salesId: U.manager.id }); // keyed in by a CS, sold by the Manager
      const edit = (u: TestUser, salesId: number, price: number) =>
        post(u, {
          no: o.no,
          customerCode: CUSTOMER,
          salesId,
          submit: true,
          lines: [{ code: P.a.code, qty: 1, price }],
        });
      const byManager = await edit(U.manager, U.seller2.id, 100); // the Manager moves the sale off himself …
      assert.deepEqual([byManager.status, byManager.body.error], [403, WAITING_CREATOR_ONLY]);
      const byOtherCS = await edit(U.seller2, U.manager.id, 1); // another CS: 100 → 1
      assert.deepEqual([byOtherCS.status, byOtherCS.body.error], [403, WAITING_CREATOR_ONLY]);
      assert.deepEqual([(await hdOf(o.no)).by, (await dtOf(o.no))[0].p], [U.manager.id, '100.00'], 'nothing saved');
      // … so he still cannot approve his own sale
      assert.equal((await decide(U.manager, o.no, { decision: 'approve' })).body.error, SELF_APPROVE_SALES);
      assert.equal((await edit(U.seller, U.manager.id, 90)).status, 200, 'the creator');
      assert.equal((await hdOf(o.no)).s, 2, 'still waiting');
      assert.equal((await edit(U.admin, U.manager.id, 80)).status, 200, 'System Admin');
    });

    await test('R5 SO: an approval with the version on screen — the creator changed qty 1 → 8 since → 409, nothing issued; the current version → 200', async () => {
      await setStock(P.a.code, 10);
      const o = await newSO(U.seller);
      const onScreen = (await getSaleOrder(o.no))!.version; // the Manager opens it
      const changed = await post(U.seller, {
        no: o.no,
        version: onScreen,
        customerCode: CUSTOMER,
        salesId: U.seller.id,
        submit: true,
        lines: [{ code: P.a.code, qty: 8, price: 100 }],
      });
      assert.equal(changed.status, 200, JSON.stringify(changed.body));
      const stale = await decide(U.manager, o.no, { decision: 'approve', version: onScreen });
      assert.deepEqual([stale.status, stale.body.details], [409, { stale: true }]);
      assert.deepEqual([(await hdOf(o.no)).s, (await qty(P.a.code)).remain], [2, 10], 'still waiting, nothing out');
      const now = (changed.body.order as Order).version;
      const ok = await decide(U.manager, o.no, { decision: 'approve', version: now });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.equal((await qty(P.a.code)).remain, 2, 'the 8 the Manager saw');
    });

    await test('R5 SO: a cancelled (DELETED) order cannot be edited, approved or issued (409), stock untouched', async () => {
      await setStock(P.a.code, 10);
      const o = await newSO(U.admin);
      await db.execute(sql`UPDATE sale_out_hd SET record_status = 'DELETED' WHERE sale_out_hd_no = ${o.no}`);
      const edit = await post(U.admin, {
        no: o.no,
        customerCode: CUSTOMER,
        salesId: U.admin.id,
        submit: true,
        lines: [{ code: P.a.code, qty: 2, price: 100 }],
      });
      assert.equal(edit.status, 409);
      assert.match(String(edit.body.error), new RegExp(SO_CANCELLED));
      const approve = await decide(U.admin, o.no, { decision: 'approve' });
      assert.equal(approve.status, 409);
      assert.match(String(approve.body.error), new RegExp(SO_CANCELLED));
      // an approved order cancelled by SQL / an old path: no stock goes out for it
      await db.execute(sql`UPDATE sale_out_hd SET approve_status_id = 4 WHERE sale_out_hd_no = ${o.no}`);
      assert.match(await errOf(issueForSaleOrder({ soNo: o.no, payTo: 'TD' }, U.admin.id)), /ยกเลิก/);
      assert.deepEqual([(await dtOf(o.no))[0].q, (await qty(P.a.code)).remain], [1, 10]);
    });

    await test('R5 products: the edit version (a hash over ราคาทุน) only goes to who may see the cost', async () => {
      const get = async (u: TestUser) =>
        json(
          await productGET(await request(`/api/products/${P.a.code}`, u), {
            params: Promise.resolve({ code: P.a.code }),
          }),
        );
      const viewer = (await get(U.viewer)).body.product as { version?: number; capitalPrice?: number };
      assert.deepEqual([viewer.version, viewer.capitalPrice], [undefined, undefined]);
      const admin = (await get(U.admin)).body.product as { version?: number };
      assert.equal(typeof admin.version, 'number');
    });

    await test('R5 SO: a line-only edit (same total, header unchanged) moves the version — a second tab on the old one → 409', async () => {
      const o = await newSO(U.admin, {
        submit: false,
        lines: [
          { code: P.a.code, qty: 1, price: 100 },
          { code: P.b.code, qty: 1, price: 200 },
        ],
      });
      const rv = (await hdOf(o.no)).rv;
      const edit = (lines: unknown[]) =>
        post(U.admin, {
          no: o.no,
          version: o.version,
          customerCode: CUSTOMER,
          salesId: U.admin.id,
          submit: false,
          lines,
        });
      const a = await edit([
        { code: P.a.code, qty: 1, price: 100 },
        { code: P.c.code, qty: 1, price: 200 },
      ]);
      assert.equal(a.status, 200, JSON.stringify(a.body));
      assert.equal((await hdOf(o.no)).rv, rv, 'the header row did not change (row_version alone missed it)');
      assert.notEqual((a.body.order as Order).version, o.version);
      const b = await edit([
        { code: P.a.code, qty: 2, price: 100 },
        { code: P.b.code, qty: 1, price: 200 },
      ]);
      assert.deepEqual([b.status, b.body.details], [409, { stale: true }]);
      assert.deepEqual(
        (await dtOf(o.no)).map((d) => [d.code, d.q]),
        [
          [P.a.code, 1],
          [P.c.code, 1],
        ],
      );
    });

    await test('R5 quotation: a line-only edit moves the version — a second tab on the old one → 409, the first edit stays', async () => {
      const line = {
        itemType: 'SparePart' as const,
        code: P.a.code,
        qty: 1,
        unit: 'ชิ้น',
        unitPrice: 100,
        discount: 0,
      };
      const base = { customerCode: CUSTOMER, jobNo: JOB_QUOTE, contactName: 'TD', remark: 'TD R5 q' };
      const q = await saveQuotation(
        { ...base, lines: [{ ...line, detail: 'TD one', discountPercent: 0 }] },
        U.admin.id,
      );
      const a = await saveQuotation(
        { ...base, no: q.no, version: q.version, lines: [{ ...line, detail: 'TD two', discountPercent: 0 }] },
        U.admin.id,
      );
      assert.notEqual(a.version, q.version);
      assert.equal(
        await statusOf(
          saveQuotation(
            { ...base, no: q.no, version: q.version, lines: [{ ...line, detail: 'TD three', discountPercent: 0 }] },
            U.admin.id,
          ),
        ),
        409,
      );
      assert.equal((await loadQuotation(q.no))!.lines[0].detail, 'TD two');
    });

    await test('R5 SO: saving a LEGACY order unchanged writes nothing — same line ids / prices / list_no, header, status 3, no audit; a customer change logs the phone as text', async () => {
      const no = 'TDS5001';
      await pool.query(`
        DELETE FROM sale_out_dt WHERE sale_out_hd_no = '${no}';
        DELETE FROM sale_out_hd WHERE sale_out_hd_no = '${no}';
        DELETE FROM customer WHERE customer_code = 'TDC501';
        INSERT INTO customer (customer_id, customer_code, customer_name, phone_number) VALUES (9501, 'TDC501', 'TD R5 ลูกค้าใหม่', '0980882117');
        INSERT INTO sale_out_hd (sale_out_hd_no, document_type, document_create_date, document_create_by, document_status, customer_id,
                                 customer_code, customer_card_id, customer_name, customer_address, customer_phone_number, customer_fax_number,
                                 total_base_amount, vat_rat, vat_amount, total_amount, rounding_amount, fee_amount, net_amount, remark_hd,
                                 is_sale_out, sale_out_date, sale_out_by, reference_no, payment_type, payment_amount, approve_status_id,
                                 approve_date, approve_by, approve_remark, delivery_tracking_no, delivery_date)
          VALUES ('${no}', 'SaleOrder', '2023-01-05 10:00', ${U.seller.id}, true, 9001, '${CUSTOMER}', '', 'ลูกค้า (ชื่อตอนขาย)',
                  'ที่อยู่ตอนขาย 2023', '', '', 1500, 0, 0, 1500, 0, 0, 1500, 'TD legacy ', true, '2023-01-05 10:00', ${U.seller.id}, '',
                  'โอนเงิน', 1500, 3, '2023-01-06', ${U.manager.id}, 'TD แก้ราคา', '', '1900-01-01');
        INSERT INTO sale_out_dt (sale_out_hd_no, list_no, product_id, store_location_id, condition_id, serial_no, capital_price,
                                 wholesale_price, retail_price, sale_out_price, sale_out_quantity, amount_dt, remark_dt, onhand_item_id,
                                 product_type, document_credit_note_no, product_code, pick_inventory_no, return_inventory_no)
          VALUES ('${no}', 0, ${P.a.id}, 1, 1, '', 900, 1200, 1500, 1500, 1, 1500, '', ${P.a.id}, 'SparePart', '', '${P.a.code}', '', '');`);
      const hdRow = async () =>
        (await db.execute(sql`SELECT * FROM sale_out_hd WHERE sale_out_hd_no = ${no}`)).rows[0] as Record<
          string,
          unknown
        >;
      const before = { hd: await hdRow(), dt: await dtOf(no) };
      const loaded = (await getSaleOrder(no))!;
      assert.equal(loaded.salesId, U.seller.id, 'the edit form picks the salesperson by id');
      // what the edit form sends back for it (sale-order-form payloadOf)
      const form = {
        no,
        version: loaded.version,
        customerCode: loaded.customerCode,
        salesId: loaded.salesId,
        lines: loaded.lines.map((l) => ({ code: l.code, qty: l.qty, price: l.price, name: l.name, type: l.type })),
        paymentType: loaded.paymentType,
        paymentAmount: String(loaded.paymentAmount),
        slip: '',
        remark: loaded.remark,
        submit: false,
      };
      // audit_log is append-only: count only what this save writes
      const [{ mark }] = (
        await db.execute<{ mark: number }>(sql`SELECT coalesce(max(id), 0)::int AS mark FROM audit_log`)
      ).rows;
      const r = await post(U.admin, form);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(await dtOf(no), before.dt, 'line ids, retail 1500, list_no 0 kept');
      assert.deepEqual(await hdRow(), before.hd, 'header untouched (snapshot, remark, status 3, row_version)');
      const [{ n }] = (
        await db.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM audit_log WHERE entity = 'sale_out_hd' AND entity_key = ${no} AND id > ${mark}`,
        )
      ).rows;
      assert.equal(n, 0, 'no audit row');
      // the user picks another customer: its snapshot is taken, the log keeps the phone's leading 0
      const moved = await post(U.admin, { ...form, customerCode: 'TDC501' });
      assert.equal(moved.status, 200, JSON.stringify(moved.body));
      const changes = (await lastChanges('sale_out_hd', no))!;
      assert.deepEqual(changes.customerPhoneNumber, ['', '0980882117']);
      assert.deepEqual((await dtOf(no))[0].id, before.dt[0].id, 'lines still untouched');
      await pool.query(`UPDATE sale_out_hd SET customer_code = '${CUSTOMER}' WHERE sale_out_hd_no = '${no}'`); // seed cleanup
    });

    await test('R5 SO: a real product sent as type Service is still a product line — the approval issues it', async () => {
      await setStock(P.a.code, 10);
      const o = await newSO(U.admin, { lines: [{ code: P.a.code, qty: 1, price: 100, type: 'Service', name: 'TD' }] });
      assert.equal((await dtOf(o.no))[0].type, 'SparePart');
      assert.equal((await decide(U.admin, o.no, { decision: 'approve' })).status, 200);
      assert.equal((await qty(P.a.code)).remain, 9);
    });

    await test('R5 SO: no slip upload on an approved / denied order (409), the stored slip stays', async () => {
      const sharp = (await import('sharp')).default;
      const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } })
        .png()
        .toBuffer();
      const upload = async (no: string) => {
        const fd = new FormData();
        fd.set('kind', 'sale-order-slip');
        fd.set('id', no);
        fd.set('file', new File([new Uint8Array(png)], 'slip.png', { type: 'image/png' }));
        const req = new NextRequest('https://svc.example.test/api/upload', {
          method: 'POST',
          headers: { cookie: await cookieFor(U.admin), 'user-agent': 'test-domain' },
          body: fd,
        });
        return (await uploadPOST(req)).status;
      };
      await setStock(P.a.code, 10);
      for (const decision of ['approve', 'deny']) {
        const o = await newSO(U.seller);
        await db.execute(
          sql`UPDATE sale_out_hd SET slip_file_name = ${`sale-orders/${o.no}/slip/old.png`} WHERE sale_out_hd_no = ${o.no}`,
        );
        assert.equal((await decide(U.admin, o.no, { decision, remark: 'TD' })).status, 200, decision);
        assert.equal(await upload(o.no), 409, decision);
        const [hd] = (
          await db.execute<{ f: string }>(
            sql`SELECT slip_file_name AS f FROM sale_out_hd WHERE sale_out_hd_no = ${o.no}`,
          )
        ).rows;
        assert.equal(hd.f, `sale-orders/${o.no}/slip/old.png`);
      }
    });

    await test('R5 customers: a stored "+66 89 …" is found by "089…" and a new "089…" is a duplicate of it; a new +66 number is saved 0-prefixed', async () => {
      const local = `08${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`; // a mobile nobody has
      await pool.query(`
        DELETE FROM customer WHERE customer_code = 'TDC502';
        INSERT INTO customer (customer_id, customer_code, customer_name, phone_number, record_status)
          VALUES (9502, 'TDC502', 'TD R5 +66', '+66 ${local.slice(1, 3)} ${local.slice(3, 6)} ${local.slice(6)}', 'ACTIVE');`);
      assert.ok(
        (await listCustomers({ q: local })).some((c) => c.code === 'TDC502'),
        'search box',
      );
      assert.ok(
        (await listCustomers({ filters: { phone: local } })).some((c) => c.code === 'TDC502'),
        'phone filter',
      );
      assert.ok(
        (await findCustomerConflicts({ phone: local })).some((c) => c.code === 'TDC502'),
        'duplicate check',
      );
      const dup = await json(
        await customerPOST(
          await request('/api/customers', U.admin, {
            method: 'POST',
            body: { name: 'TD R5 ซ้ำ', phone: `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}` },
          }),
        ),
      );
      assert.equal(dup.status, 409, JSON.stringify(dup.body));
      await pool.query(`DELETE FROM customer WHERE customer_code = 'TDC502'`);
      const fresh = await json(
        await customerPOST(
          await request('/api/customers', U.admin, {
            method: 'POST',
            body: { name: 'TD R5 +66 ใหม่', phone: `+66 ${local.slice(1, 3)} ${local.slice(3, 6)} ${local.slice(6)}` },
          }),
        ),
      );
      assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
      assert.equal(
        (fresh.body.row as { phone: string }).phone,
        `0${local.slice(1, 3)} ${local.slice(3, 6)} ${local.slice(6)}`,
      );
    });

    await test('R5 customers: an "unchanged" phone is the same text — "-" → "ไม่มีเบอร์" and "081abc2345678" for "081-234-5678" → 400; the same text saves and is kept as is', async () => {
      await pool.query(`
        DELETE FROM customer WHERE customer_code = 'TDC503';
        INSERT INTO customer (customer_id, customer_code, customer_name, phone_number, customer_type, record_status)
          VALUES (9503, 'TDC503', 'TD R5 เบอร์เก่า', '-', 'Normal', 'ACTIVE');`);
      const save = async (phone: string) =>
        json(
          await customerPOST(
            await request('/api/customers', U.admin, {
              method: 'POST',
              body: { code: 'TDC503', name: 'TD R5 เบอร์เก่า', phone },
            }),
          ),
        );
      assert.equal((await save('ไม่มีเบอร์')).status, 400);
      assert.equal((await save('-')).status, 200, 'the legacy "-" itself still saves');
      await pool.query(`UPDATE customer SET phone_number = '081-234-5678 ' WHERE customer_code = 'TDC503'`);
      assert.equal((await save('081abc2345678')).status, 400);
      assert.equal((await save('081-234-5678')).status, 200);
      const [c] = (
        await db.execute<{ p: string }>(sql`SELECT phone_number AS p FROM customer WHERE customer_code = 'TDC503'`)
      ).rows;
      assert.equal(c.p, '081-234-5678 ', 'kept as stored');
    });

    await test('R5 stock: a part returned from a CLOSED job goes back on the shelf; the job’s parts / total cost stay as billed', async () => {
      await pool.query(`
        DELETE FROM job_order_spare_part_log WHERE job_no = 'TDJ0571';
        DELETE FROM job WHERE job_no = 'TDJ0571';
        INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date,
                         job_closed_date, service_cost, service_tool_cost, delivery_cost, carton_box_cost, spare_part_total_cost, job_total_cost)
          VALUES ('TDJ0571', 20, 9001, '${CUSTOMER}', 'Model TD', now(), current_date, now(), 50, 0, 0, 0, 200, 250);
        INSERT INTO job_order_spare_part_log (job_no, spare_part_code, spare_part_serial_no, stock_id, is_quotation, is_special,
                                              request_qty, spare_part_unit_price, spare_part_total_price, order_status_id,
                                              request_date, request_by, grant_qty, return_qty)
          VALUES ('TDJ0571', '${P.a.code}', '', 1, true, true, 2, 100, 200, 3, now(), 9101, 2, 0);`);
      await setStock(P.a.code, 10);
      const [line] = (await getJob('TDJ0571'))!.parts;
      await returnFromJob({ jobNo: 'TDJ0571', lines: [{ logId: line.logId, qty: 1 }] }, U.admin.id);
      const [j] = (
        await db.execute<{ p: string; t: string }>(
          sql`SELECT spare_part_total_cost AS p, job_total_cost AS t FROM job WHERE job_no = 'TDJ0571'`,
        )
      ).rows;
      assert.deepEqual([Number(j.p), Number(j.t)], [200, 250], 'money of a closed job is locked');
      assert.equal((await qty(P.a.code)).remain, 11, 'back on the shelf');
    });
  }
  // ── Round 5: jobs ──
  console.log(
    '\nRound 5 — jobs (refund kept at close / locked close / parts before close / status paths / never worse)',
  );
  {
    const { invalidate } = await import('@/server/cache');
    const { saveSwapRefund } = await import('@/server/services/jobs');
    const {
      closePaymentEdited,
      swapRefundOf,
      STATUS_CLOSE_ONLY,
      STATUS_DELETE_ONLY,
      EDIT_STATUS_ONLY,
      REPAIR_STATUS_ONLY,
      SWAP_STATUS_OPTIONS,
    } = await import('@/lib/validation/job');
    const { exportXlsx } = await import('@/server/export');
    const ExcelJS = (await import('exceljs')).default;
    const job = (no: string, status: number) =>
      `('${no}', ${status}, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01', 0)`;
    const waitingLine = (no: string) => `('${no}', '${P.a.code}', '', 1, true, true, 1, 1, now(), ${U.admin.id}, 0, 0)`;
    await pool.query(`
      INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
        SELECT * FROM (VALUES (19, 'อยู่ระหว่างดำเนินการ - เบิกจ่ายเงินแล้ว', 19, 'Repaired', true),
                              (22, 'ซ่อมเสร็จ (ไม่พบอาการเสีย ขอส่งคืน)', 22, 'Repaired', true)) v(id, name, ord, grp, act)
         WHERE NOT EXISTS (SELECT 1 FROM job_status s WHERE s.job_status_id = v.id);
      INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date, engineer_id)
        VALUES ${job('TDJ0601', 19)}, ${job('TDJ0602', 7)}, ${job('TDJ0603', 5)}, ${job('TDJ0604', 7)}, ${job('TDJ0605', 2)},
               ${job('TDJ0606', 2)}, ${job('TDJ0607', 2)}, ${job('TDJ0608', 2)}, ${job('TDJ0609', 24)}, ${job('TDJ0610', 2)},
               ${job('TDJ0611', 19)}, ${job('TDJ0612', 5)}, ${job('TDJ0613', 2)}, ${job('TDJ0614', 1)}, ${job('TDJ0615', 20)};
      -- a swap refund (Swap / Refund page): a negative payment "Refund <date>" + its "ยอดเงินคืน" line
      UPDATE job SET job_payment_type = 'โอนเงินเข้าบัญชี', job_payment_amount = -500, job_payment_detail = 'Refund 2026-10-10',
                     swap_refund_detail = 'ยอดเงินคืน: 500.00' WHERE job_no IN ('TDJ0601', 'TDJ0611');
      UPDATE job SET service_cost = 1000, spare_part_total_cost = 0, job_total_cost = 1000 WHERE job_no IN ('TDJ0602', 'TDJ0612');
      -- legacy: a parts cost with no part rows behind it
      UPDATE job SET spare_part_total_cost = 2000, job_total_cost = 2000 WHERE job_no = 'TDJ0606';
      -- a deposit given back at the close
      UPDATE job SET deposit_cost = 500, job_payment_type = 'เงินสด', job_payment_amount = -500,
                     job_payment_detail = 'คืนมัดจำ 2026-10-01' WHERE job_no = 'TDJ0615';
      -- legacy texts with stray spaces, a total that does not add up, nobody recorded as "ส่งคืนโดย"
      UPDATE job SET engineer_repair_detail = 'ได้รับสินค้าไม่ครบ ', product_model_detail = 'White ',
                     product_symptom_other = ' อาการเปิดไม่ติด', product_sale_out_shop_name = 'DDpai ', job_reference_no = 'so 12',
                     product_sale_out_channel = 'SHOPEE', job_reception_type = 'Carry-In', service_cost = 300,
                     spare_part_total_cost = 2000, job_total_cost = 999, job_payment_type = 'เงินสด', job_payment_amount = 999,
                     job_payment_detail = 'ชำระ 2026-10-01', return_customer_type = 'ลูกค้ามารับเอง',
                     job_return_date = '2026-10-01 14:22:00', return_customer_detail = '', return_customer_tracking_no = '',
                     job_return_by = -1 WHERE job_no = 'TDJ0609';
      INSERT INTO job_order_spare_part_log (job_no, spare_part_code, spare_part_serial_no, stock_id, is_quotation, is_special, request_qty, order_status_id, request_date, request_by, grant_qty, return_qty)
        VALUES ${waitingLine('TDJ0603')}, ${waitingLine('TDJ0604')};`);
    invalidate('jobstatus'); // 19 / 22 above, by name
    const back = { type: 'ลูกค้ามารับเอง', date: '2026-10-15' };
    const line = (code: string, qty: number, logId?: number) => ({
      logId,
      code,
      unitPrice: 100,
      a: { pick: true, quote: true, qty },
      b: { pick: false, quote: false, qty: 0 },
    });

    await test('R5 H1: a swap refund (−500) survives the close — the page sends no payment, the server never wipes it', async () => {
      // what the close page pre-fills for it: the method / note, no amount (a negative one is not put in the box)
      const loaded = {
        payType: 'โอนเงินเข้าบัญชี',
        payAmount: '',
        payDate: '',
        payNo: '',
        payDetail: 'Refund 2026-10-10',
      };
      assert.equal(closePaymentEdited({ ...loaded }, loaded, false), false, 'untouched → no payment block');
      assert.equal(closePaymentEdited({ ...loaded, payType: 'เงินสด' }, loaded, false), true, 'edited → sent');
      // what the page used to send ({ type, amount: '' }): the refund is not replaced by "0.00"
      const pay = { type: 'โอนเงินเข้าบัญชี', amount: '' };
      const r = await fieldsOf(
        closeJob('TDJ0601', { status: await statusName(20), payment: pay, return: back }, U.admin.id),
      );
      assert.equal(r.status, 200, JSON.stringify(r));
      const j = (await getJob('TDJ0601'))!;
      assert.deepEqual([j.statusId, j.payment.amount, j.payment.detail], [20, -500, 'Refund 2026-10-10']);
    });

    await test('R5 H2: a closed job with ค้างชำระ gets its parcel no. later (non-admin): no payment asked or sent', async () => {
      const j = (await getJob('TDJ0602'))!;
      assert.equal(j.outstanding, 1000);
      // the page pre-fills the amount due; on a money-locked job nothing is ever sent
      const loaded = { payType: '', payAmount: String(j.amountDue), payDate: '', payNo: '', payDetail: '' };
      assert.equal(closePaymentEdited(loaded, loaded, true), false);
      assert.equal(closePaymentEdited({ ...loaded, payType: 'เงินสด' }, loaded, true), false, 'locked');
      const ret = { ...back, type: 'บริษัทขนส่งเอกชน', tracking: 'TH987654321TH' };
      const r = await fieldsOf(closeJob('TDJ0602', { status: await statusName(7), return: ret }, U.clerk.id));
      assert.equal(r.status, 200, JSON.stringify(r));
      const k = (await getJob('TDJ0602'))!;
      assert.deepEqual([k.statusId, k.payment.amount, k.outstanding], [8, 0, 1000]);
    });

    await test('R5 H3: close / ยกเลิกซ่อม refused while a เบิก line waits (400 naming it); legacy closed job not blocked', async () => {
      const close = await fieldsOf(closeJob('TDJ0603', { status: await statusName(20), return: back }, U.admin.id));
      assert.equal(close.status, 400);
      assert.ok(String((close.fields as { status?: string })?.status).includes(P.a.code), JSON.stringify(close));
      const declined = await fieldsOf(saveRepair('TDJ0603', { status: await statusName(6) }, U.admin.id));
      assert.equal(declined.status, 400);
      assert.ok(String((declined.fields as { status?: string })?.status).includes(P.a.code));
      assert.deepEqual([(await jobRow('TDJ0603')).s, await logRows('TDJ0603')], [5, []]);
      // legacy: already closed (7) with a line still waiting — the parcel no. added later moves it to 8
      const ret = { ...back, type: 'บริษัทขนส่งเอกชน', tracking: 'TH123456789TH' };
      const late = await fieldsOf(closeJob('TDJ0604', { status: await statusName(7), return: ret }, U.admin.id));
      assert.equal(late.status, 200, JSON.stringify(late));
      assert.equal((await jobRow('TDJ0604')).s, 8);
      // the line cancelled on the repair page → the close goes through
      await saveRepair('TDJ0603', { status: await statusName(5), parts: [] }, U.admin.id);
      const ok = await fieldsOf(closeJob('TDJ0603', { status: await statusName(20), return: back }, U.admin.id));
      assert.equal(ok.status, 200, JSON.stringify(ok));
    });

    await test('R5 H4: only ปิดงาน closes — repair / swap / edit refuse a closed status or ยกเลิกข้อมูล; each page its own list', async () => {
      const [s0, s5, s14, s20] = [await statusName(0), await statusName(5), await statusName(14), await statusName(20)];
      const err = async (p: Promise<unknown>) => {
        const r = await fieldsOf(p);
        return [r.status, r.fields];
      };
      assert.deepEqual(await err(saveRepair('TDJ0605', { status: s20 }, U.engineer.id)), [
        400,
        { status: STATUS_CLOSE_ONLY },
      ]);
      assert.deepEqual(await err(saveRepair('TDJ0605', { status: s14 }, U.engineer.id)), [
        400,
        { status: REPAIR_STATUS_ONLY },
      ]);
      const swap = { newSerial: 'TDR5SWAP01' };
      assert.deepEqual(await err(saveSwapRefund('TDJ0605', { ...swap, status: s20 }, U.admin.id)), [
        400,
        { status: STATUS_CLOSE_ONLY },
      ]);
      assert.deepEqual(await err(saveSwapRefund('TDJ0605', { ...swap, status: s0 }, U.admin.id)), [
        400,
        { status: STATUS_DELETE_ONLY },
      ]);
      const j = (await getJob('TDJ0605'))!;
      const edit = {
        customerCode: CUSTOMER,
        jobType: j.jobType,
        dueDate: j.dueDate,
        warrantyMonth: j.warrantyMonth,
        status: s5,
      };
      assert.deepEqual(await err(updateJob('TDJ0605', edit, U.admin.id)), [400, { status: EDIT_STATUS_ONLY }]);
      assert.deepEqual([(await jobRow('TDJ0605')).s, await logRows('TDJ0605')], [2, []]);
      // the Swap / Refund page offers the same list the server takes
      assert.ok(!SWAP_STATUS_OPTIONS.includes('ปิดงาน (Complete)') && !SWAP_STATUS_OPTIONS.includes('ยกเลิกข้อมูล'));
      assert.ok(SWAP_STATUS_OPTIONS.includes('ซ่อมเสร็จ'));
    });

    await test('R5 M2: a repair save that adds / changes no part line keeps the legacy parts cost (2,000, no part rows)', async () => {
      const j = (await getJob('TDJ0606'))!;
      await saveRepair('TDJ0606', { status: j.status, parts: [], repairDetail: 'TD R5 M2' }, U.admin.id);
      const k = (await getJob('TDJ0606'))!;
      assert.deepEqual([k.partsCost, k.totalCost, k.repairDetail], [2000, 2000, 'TD R5 M2']);
    });

    await test('R5 M3: a stale repair page (old version) → 409, the part request added since is not cancelled', async () => {
      await setStock(P.a.code, 10);
      const loaded = (await getJob('TDJ0607'))!;
      // someone else adds a part request after this page loaded
      await saveRepair(
        'TDJ0607',
        { status: loaded.status, parts: [line(P.a.code, 1)], version: loaded.version },
        U.engineer.id,
      );
      const stale = await fieldsOf(
        saveRepair('TDJ0607', { status: loaded.status, parts: [], version: loaded.version }, U.admin.id),
      );
      assert.equal(stale.status, 409);
      assert.deepEqual(
        (await getJob('TDJ0607'))!.parts.map((p) => p.statusId),
        [1],
        'still requested',
      );
    });

    await test('R5 M4: correcting the vendor / send date of a trip already back updates that row (no open row; close works)', async () => {
      const [s14, s15] = [await statusName(14), await statusName(15)];
      await saveOutsource('TDJ0608', { send: { to: 'TD Vendor R5', date: '2026-10-10' }, status: s14 }, U.admin.id);
      const receive = { from: 'TD Vendor R5', date: '2026-10-12', by: U.admin.id };
      await saveOutsource('TDJ0608', { receive, status: s15 }, U.admin.id);
      // what the page sends once the trip is back: the send block (corrected) + the receive block
      const fix = { send: { to: 'TD Vendor R5b', date: '2026-10-11' }, receive: { ...receive, from: 'TD Vendor R5b' } };
      const r = await fieldsOf(saveOutsource('TDJ0608', { ...fix, status: s15 }, U.admin.id));
      assert.equal(r.status, 200, JSON.stringify(r));
      const rows = (
        await db.execute<{ st: string; vendor: string; d: string }>(sql`
          SELECT send_status AS st, send_to_name AS vendor, to_char(send_date, 'YYYY-MM-DD') AS d
            FROM job_send_forward_dt WHERE job_no = 'TDJ0608'`)
      ).rows;
      assert.deepEqual(rows, [{ st: 'รับเครื่องซ่อมแล้ว', vendor: 'TD Vendor R5b', d: '2026-10-11' }]);
      assert.equal((await jobRow('TDJ0608')).s, 15);
      const close = await fieldsOf(closeJob('TDJ0608', { status: await statusName(20), return: back }, U.admin.id));
      assert.equal(close.status, 200, JSON.stringify(close));
    });

    await test('R5 M5: a deposit refund (คืนมัดจำ) does not open Swap / Refund in Refund mode; a swap save keeps it', async () => {
      const j = (await getJob('TDJ0615'))!;
      assert.equal(j.payment.amount, -500);
      assert.equal(swapRefundOf(j.swap.detail), '', 'not a swap refund');
      assert.equal(swapRefundOf('ยอดเงินคืน: 500.00'), '500.00');
      // saved in Swap mode by a non-admin on the closed job: 200, the deposit refund untouched
      const swap = { status: j.status, newSerial: 'TDR5SWAP02', swapDate: '2026-10-15' };
      const r = await fieldsOf(saveSwapRefund('TDJ0615', swap, U.clerk.id));
      assert.equal(r.status, 200, JSON.stringify(r));
      const k = (await getJob('TDJ0615'))!;
      assert.deepEqual([k.payment.amount, k.payment.detail], [-500, 'คืนมัดจำ 2026-10-01']);
    });

    await test('R5 P-M1: a legacy job saved unchanged on /jobs/repair and /jobs/close changes nothing (row, version, history)', async () => {
      const snapshot = async () => ({
        row: (await db.execute<{ j: unknown }>(sql`SELECT to_jsonb(job) AS j FROM job WHERE job_no = 'TDJ0609'`))
          .rows[0].j,
        trail: (
          await db.execute<{ a: number; l: number; s: number }>(sql`
            SELECT (SELECT count(*)::int FROM audit_log WHERE entity = 'job' AND entity_key = 'TDJ0609') AS a,
                   (SELECT count(*)::int FROM job_log WHERE job_no = 'TDJ0609') AS l,
                   (SELECT count(*)::int FROM job_symptom WHERE job_no = 'TDJ0609') AS s`)
        ).rows[0],
      });
      const before = await snapshot();
      const j = (await getJob('TDJ0609'))!;
      // /jobs/repair: the shared sections (PATCH, fromJob → toJobInput) as loaded, then its own action
      const common = {
        customerCode: CUSTOMER,
        jobType: j.jobType,
        jobTypeDetail: j.jobTypeDetail,
        isBounce: j.isBounce,
        so: j.so,
        channel: j.channel,
        shopName: j.shopName,
        saleOrderDate: j.saleOrderDate,
        warrantyMonth: j.warrantyMonth,
        expireDate: j.expireDate,
        warranty: j.warranty,
        productType: j.productType,
        imei: j.imei,
        serial: j.serial,
        brand: j.brand,
        modelCode: j.modelCode,
        modelDetail: j.modelDetail,
        receptionDate: j.receptionDate,
        receptionTrackingNo: j.receptionTrackingNo,
        receptionShipper: j.receptionShipper,
        receptionType: j.receptionType,
        equipment: j.equipment,
        fault: j.fault,
        symptoms: j.symptoms,
        symptomOther: j.symptomOther,
        remark: j.remark,
        serviceCost: j.serviceCost,
        toolCost: j.toolCost,
        deliveryCost: j.deliveryCost,
        boxCost: j.boxCost,
        estimateCost: j.estimateCost ? String(j.estimateCost) : '',
        depositCost: j.depositCost ? String(j.depositCost) : '',
        engineerId: j.engineerId,
        dueDate: j.dueDate,
        version: j.version,
      };
      const edit = await fieldsOf(updateJob('TDJ0609', common, U.admin.id));
      assert.equal(edit.status, 200, JSON.stringify(edit));
      const repair = {
        status: j.status,
        repairDetail: j.repairDetail,
        engineerRemark: j.engineerRemark,
        engineerSymptom: j.engineerSymptom,
        newSerial: '',
        serviceCost: j.serviceCost,
        toolCost: j.toolCost,
        deliveryCost: j.deliveryCost,
        boxCost: j.boxCost,
        parts: [],
        version: j.version,
      };
      const rep = await fieldsOf(saveRepair('TDJ0609', repair, U.admin.id));
      assert.equal(rep.status, 200, JSON.stringify(rep));
      // /jobs/close "ยืนยันปิดงาน": the return info as loaded, no payment edited
      const ret = {
        type: j.return.type,
        date: j.return.date.slice(0, 10),
        courier: '',
        tracking: '',
        detail: j.return.detail,
      };
      const close = await fieldsOf(closeJob('TDJ0609', { status: j.status, return: ret }, U.admin.id));
      assert.equal(close.status, 200, JSON.stringify(close));
      const after = await snapshot();
      assert.deepEqual(after.row, before.row, 'no column changed (texts, totals, ส่งคืนโดย, row_version)');
      assert.deepEqual({ ...after.trail }, { ...before.trail }, 'no audit / job_log / job_symptom rows');
    });

    await test('R5 P-M1 / L5: an assignment writes one history row (ASSIGN only); clearing it unassigns ("ยกเลิกผู้รับงาน")', async () => {
      const rowsSince = async (id: number) =>
        (
          await db.execute<{ action: string; summary: string }>(sql`
            SELECT action, summary FROM audit_log WHERE entity = 'job' AND entity_key = 'TDJ0610' AND id > ${id} ORDER BY id`)
        ).rows.map((r) => ({ ...r }));
      const last = async () =>
        (await db.execute<{ id: number }>(sql`SELECT coalesce(max(id), 0)::int AS id FROM audit_log`)).rows[0].id;
      const j = (await getJob('TDJ0610'))!;
      // what the edit form sends back (it always carries the reception date)
      const input = {
        customerCode: CUSTOMER,
        jobType: j.jobType,
        dueDate: j.dueDate,
        warrantyMonth: j.warrantyMonth,
        receptionDate: j.receptionDate,
      };
      let id = await last();
      await updateJob('TDJ0610', { ...input, engineerId: U.engineer.id }, U.admin.id);
      assert.deepEqual(await rowsSince(id), [
        { action: 'ASSIGN', summary: 'TD td-admin มอบหมายงานให้ TD td-engineer' },
      ]);
      id = await last();
      await updateJob('TDJ0610', { ...input, engineerId: 0 }, U.admin.id);
      const cleared = await rowsSince(id);
      assert.deepEqual(cleared[0], { action: 'ASSIGN', summary: 'TD td-admin ยกเลิกผู้รับงาน TD td-engineer' });
      // R6: nobody on an อยู่ระหว่างดำเนินการ job any more → back to งานใหม่ (its own STATUS row)
      assert.deepEqual(
        cleared.map((r) => r.action),
        ['ASSIGN', 'STATUS'],
      );
      assert.equal((await getJob('TDJ0610'))!.engineerId, 0);
    });

    await test('R5 L2: job Excel — ยอดชำระ never negative, a refund in คืนเงิน, ค้างชำระ only on a closed job', async () => {
      const { buffer } = await exportXlsx(await request('/api/export/jobs?q=TDJ061', U.admin), 'jobs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      const ws = wb.worksheets[0]!;
      const head = (ws.getRow(1).values as unknown[]).slice(1);
      const rows = Array.from({ length: ws.rowCount - 1 }, (_, n) => (ws.getRow(n + 2).values as unknown[]).slice(1));
      const money = (no: string) => {
        const r = rows.find((x) => x[head.indexOf('เลขที่งาน')] === no)!;
        return ['ยอดชำระ', 'คืนเงิน', 'ค้างชำระ'].map((h) => r[head.indexOf(h)]);
      };
      assert.deepEqual(money('TDJ0611'), [0, 500, 0], 'swap refund −500');
      assert.deepEqual(money('TDJ0612'), [0, 0, 0], 'open job (1,000 unpaid): not billed yet');
    });

    await test('R5 L4: re-booking a pending line moves the booking of the row’s own part, not the code the page sent', async () => {
      await setStock(P.a.code, 10);
      await setStock(P.b.code, 10);
      await saveRepair(
        'TDJ0613',
        { status: (await getJob('TDJ0613'))!.status, parts: [line(P.a.code, 1)] },
        U.admin.id,
      );
      const j = (await getJob('TDJ0613'))!;
      const [a0, b0] = [(await qty(P.a.code)).booking, (await qty(P.b.code)).booking];
      await saveRepair('TDJ0613', { status: j.status, parts: [line(P.b.code, 2, j.parts[0]!.logId)] }, U.admin.id);
      assert.deepEqual([(await qty(P.a.code)).booking - a0, (await qty(P.b.code)).booking - b0], [1, 0]);
    });

    await test('R5 L6: an Engineer taking a new job through the repair save moves it to อยู่ระหว่างดำเนินการ (+ job_log)', async () => {
      const j = (await getJob('TDJ0614'))!;
      await saveRepair('TDJ0614', { status: j.status, repairDetail: 'TD R5 L6' }, U.engineer.id);
      const [r] = (
        await db.execute<{ e: number; s: number }>(
          sql`SELECT engineer_id AS e, job_status_id AS s FROM job WHERE job_no = 'TDJ0614'`,
        )
      ).rows;
      assert.deepEqual({ ...r }, { e: U.engineer.id, s: 2 });
      assert.deepEqual(await logRows('TDJ0614'), [2]);
      const actions = (await getJob('TDJ0614'))!.history.map((h) => h.action);
      assert.ok(actions.includes('ASSIGN') && actions.includes('STATUS'), actions.join(','));
    });
  }
  // ── Round 6: session messages ──
  console.log('\nRound 6 — session messages');
  {
    const { GET: meGET } = await import('@/app/api/sso/me/route');
    const { GET: refreshGET } = await import('@/app/api/sso/refresh/route');
    await test('R6 session: a stale session_version (signed out on another device) → 401 reason "elsewhere", an idle-expired cookie → "expired"', async () => {
      const me = await json(await meGET(await request('/api/sso/me', U.admin, { sv: SV - 1 })));
      assert.deepEqual([me.status, me.body.reason, me.body.signedOut], [401, 'elsewhere', undefined]);
      const rf = await refreshGET(await request('/api/sso/refresh', U.admin, { sv: SV - 1 }));
      assert.deepEqual([rf.status, ((await rf.json()) as { reason?: string }).reason], [401, 'elsewhere']);
      assert.equal(rf.cookies.get(SESSION_COOKIE), undefined, 'the dead cookie is kept — /login reads it');
      const now = Date.now();
      const idle = await signSession({
        email: U.admin.email,
        name: U.admin.email,
        exp: now - 1000,
        iat: now - 31 * 60_000,
        sv: SV,
      });
      const headers = { cookie: `${SESSION_COOKIE}=${idle}; os_seen=${U.admin.id}` };
      const meIdle = await json(await meGET(await request('/api/sso/me', null, { headers })));
      assert.deepEqual([meIdle.status, meIdle.body.reason, meIdle.body.signedOut], [401, 'expired', undefined]);
      const rfIdle = await refreshGET(await request('/api/sso/refresh', null, { headers }));
      assert.deepEqual([rfIdle.status, ((await rfIdle.json()) as { reason?: string }).reason], [401, 'expired']);
    });
  }
  // ── Round 6: jobs + quotation → job status ──
  console.log('\nRound 6 — jobs (a quotation moves its job / รับงานเอง / no engineer → งานใหม่)');
  {
    const { invalidate } = await import('@/server/cache');
    const tracking = await import('@/server/services/tracking');
    const job = (no: string, status: number, eng = 0) =>
      `('${no}', ${status}, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01', ${eng})`;
    // the quotation form wants J + 7 digits: J99007xx (not cleaned by seed — cleaned here)
    await pool.query(`
      INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
        SELECT * FROM (VALUES (3, 'อยู่ระหว่างการซ่อม - รออะไหล่', 3, 'Pending', true),
                              (4, 'อยู่ระหว่างการซ่อม - เสนอราคาลูกค้า', 4, 'Pending', true),
                              (10, 'อยู่ระหว่างการซ่อม - เบิกจ่ายอะไหล่ครบแล้ว', 10, 'Pending', true),
                              (11, 'อยู่ระหว่างการซ่อม - เริ่มเบิกอะไหล่', 11, 'Pending', true),
                              (12, 'อยู่ระหว่างการซ่อม - ลูกค้าตกลงซ่อม', 12, 'Pending', true),
                              (13, 'อยู่ระหว่างการซ่อม - รอเสนอราคา', 13, 'Pending', true),
                              (16, 'อยู่ระหว่างการซ่อม - พ้นกำหนดเสนอราคา', 16, 'Pending', true)) v(id, name, ord, grp, act)
         WHERE NOT EXISTS (SELECT 1 FROM job_status s WHERE s.job_status_id = v.id);
      INSERT INTO quotation_status (quotation_status_id, quotation_status_name)
        SELECT * FROM (VALUES (1, 'รอเสนอราคา'), (2, 'เสนอราคาแล้ว'), (3, 'ลูกค้าตกลงซ่อม'), (4, 'ลูกค้าไม่ตกลงซ่อม'),
                              (5, 'ยกเลิกใบเสนอราคา'), (6, 'ลูกค้าตกลงซ่อม รอชำระเงิน'), (8, 'พ้นกำหนดเสนอราคา'),
                              (9, 'ลูกค้าตกลงซ่อม รออะไหล่')) v(id, name)
         WHERE NOT EXISTS (SELECT 1 FROM quotation_status s WHERE s.quotation_status_id = v.id);
      DELETE FROM job_log WHERE job_no LIKE 'J99007%';
      DELETE FROM quotation_dt WHERE quotation_no IN (SELECT quotation_no FROM quotation_hd WHERE reference_job_no LIKE 'J99007%');
      DELETE FROM quotation_hd WHERE reference_job_no LIKE 'J99007%';
      DELETE FROM job WHERE job_no LIKE 'J99007%';
      INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date, engineer_id)
        VALUES ${job('J9900701', 1)}, ${job('J9900702', 2)}, ${job('J9900703', 13)}, ${job('J9900704', 16)},
               ${job('J9900705', 10)}, ${job('J9900706', 20)}, ${job('J9900707', 4)},
               ${job('TDJ0701', 1)}, ${job('TDJ0702', 1)}, ${job('TDJ0703', 11, U.engineer.id)};`);
    invalidate('jobstatus');
    invalidate('quotationstatus');
    const quote = (jobNo: string, status: string, prev?: { no: string; version: number }) =>
      saveQuotation(
        { customerCode: CUSTOMER, jobNo, contactName: 'TD', remark: 'TD R6 q', lines: [], status, ...prev },
        U.admin.id,
      );
    const statusIdOf = async (no: string) => (await getJob(no))!.statusId;

    await test('R6 quotation → job: sent → 4, agreed (3 / 6) → 12, agreed waiting parts → 3; history says why; never back / never a later or closed job', async () => {
      // 1 งานใหม่ → เสนอราคาแล้ว → 4, with the reason in the history line + job_log
      let q = await quote('J9900701', 'เสนอราคาแล้ว');
      let j = (await getJob('J9900701'))!;
      assert.equal(j.statusId, 4);
      assert.equal(j.history[0].summary, `เปลี่ยนสถานะงาน → ${j.status} · ตามใบเสนอราคา ${q.no} : เสนอราคาแล้ว`);
      assert.deepEqual(await logRows('J9900701'), [4]);
      // /track: waiting for the customer's answer
      assert.equal(tracking.statusLabel(4, tracking.stepOf(4, 'Pending')), 'รอคำตอบจากคุณ (ใบเสนอราคา)');
      // saved again with the same status: the job is not touched (no job_log, no history row)
      const histBefore = j.history.length;
      q = await quote('J9900701', 'เสนอราคาแล้ว', { no: q.no, version: q.version });
      assert.deepEqual([await logRows('J9900701'), (await getJob('J9900701'))!.history.length], [[4], histBefore]);
      // → ลูกค้าตกลงซ่อม → 12
      q = await quote('J9900701', 'ลูกค้าตกลงซ่อม', { no: q.no, version: q.version });
      j = (await getJob('J9900701'))!;
      assert.equal(j.statusId, 12);
      assert.ok(j.history[0].summary.endsWith(`ตามใบเสนอราคา ${q.no} : ลูกค้าตกลงซ่อม`), j.history[0].summary);
      // → ตกลงซ่อม รออะไหล่ → 3
      q = await quote('J9900701', 'ลูกค้าตกลงซ่อม รออะไหล่', { no: q.no, version: q.version });
      assert.equal(await statusIdOf('J9900701'), 3);
      // never backwards: sent again / declined leave 3
      q = await quote('J9900701', 'เสนอราคาแล้ว', { no: q.no, version: q.version });
      q = await quote('J9900701', 'ลูกค้าไม่ตกลงซ่อม', { no: q.no, version: q.version });
      assert.deepEqual([await statusIdOf('J9900701'), await logRows('J9900701')], [3, [4, 12, 3]]);

      // the other earlier statuses move too
      await quote('J9900702', 'ลูกค้าตกลงซ่อม รอชำระเงิน'); // 2 → 12
      await quote('J9900703', 'เสนอราคาแล้ว'); // 13 → 4
      await quote('J9900704', 'ลูกค้าตกลงซ่อม รออะไหล่'); // 16 → 3
      // further along (10) / closed (20): never moved
      await quote('J9900705', 'ลูกค้าตกลงซ่อม');
      await quote('J9900706', 'ลูกค้าตกลงซ่อม');
      // declined / cancelled / expired: no automatic change
      for (const st of ['ลูกค้าไม่ตกลงซ่อม', 'ยกเลิกใบเสนอราคา', 'พ้นกำหนดเสนอราคา']) await quote('J9900707', st);
      const now = await Promise.all(
        ['J9900702', 'J9900703', 'J9900704', 'J9900705', 'J9900706', 'J9900707'].map(statusIdOf),
      );
      assert.deepEqual(now, [12, 4, 3, 10, 20, 4]);
      for (const no of ['J9900705', 'J9900706', 'J9900707']) assert.deepEqual(await logRows(no), [], no);
    });

    await test('R6 jobs: an engineer taking a job on the repair page → "X รับงานเอง"; no engineer on อยู่ระหว่างดำเนินการ → งานใหม่ (+ job_log), not on a later status', async () => {
      await saveRepair('TDJ0701', { status: (await getJob('TDJ0701'))!.status, repairDetail: 'TD R6' }, U.engineer.id);
      const took = (await getJob('TDJ0701'))!.history.find((h) => h.action === 'ASSIGN')?.summary;
      assert.equal(took, 'TD td-engineer รับงานเอง');

      const input = async (no: string) => {
        const j = (await getJob(no))!;
        return {
          customerCode: CUSTOMER,
          jobType: j.jobType,
          dueDate: j.dueDate,
          warrantyMonth: j.warrantyMonth,
          receptionDate: j.receptionDate,
        };
      };
      await updateJob('TDJ0702', { ...(await input('TDJ0702')), engineerId: U.engineer.id }, U.admin.id);
      assert.equal(await statusIdOf('TDJ0702'), 2);
      await updateJob('TDJ0702', { ...(await input('TDJ0702')), engineerId: 0 }, U.admin.id);
      const j = (await getJob('TDJ0702'))!;
      assert.deepEqual([j.statusId, j.engineerId, await logRows('TDJ0702')], [1, 0, [2, 1]]);
      assert.ok(j.history[0].summary.endsWith(' · ไม่มีผู้รับงาน'), j.history[0].summary);
      // a job further along keeps its status when the engineer is cleared
      await updateJob('TDJ0703', { ...(await input('TDJ0703')), engineerId: 0 }, U.admin.id);
      assert.deepEqual([await statusIdOf('TDJ0703'), await logRows('TDJ0703')], [11, []]);
    });
  }
  // ── Round 6: customers + products + sale-order slip ──
  console.log('\nRound 6 — customers + products + sale-order slip');
  {
    const { getCustomerByCode } = await import('@/server/services/customers');
    const { saveProduct, getProduct } = await import('@/server/services/stock');
    const { WAITING_CREATOR_ONLY } = await import('@/lib/validation/sale-order');
    const { POST: uploadPOST } = await import('@/app/api/upload/route');
    // audit_log is append-only (drizzle/0006): rows of earlier runs stay — only the ones after `since` count
    const lastAuditId = async () =>
      Number((await db.execute<{ m: number }>(sql`SELECT coalesce(max(id), 0) AS m FROM audit_log`)).rows[0]!.m);
    const auditOf = async (entity: string, key: string, since: number) =>
      (
        await db.execute<{ changes: Record<string, unknown> | null }>(
          sql`SELECT changes FROM audit_log WHERE entity = ${entity} AND entity_key = ${key} AND id > ${since} ORDER BY id`,
        )
      ).rows.map((r) => r.changes);

    await test('R6 customers: a legacy customer saved unchanged (trailing spaces, a one-line / composed address) → row identical, no audit; a Line change writes only that', async () => {
      await pool.query(`
        DELETE FROM customer WHERE customer_id IN (9661, 9662) OR customer_code IN ('TDC661', 'TDC662');
        INSERT INTO customer (customer_id, customer_code, customer_name, phone_number, customer_address, customer_address1,
                              customer_address2, city_id, district_id, sub_district_id, postal_code, email, line_id,
                              customer_card_id, customer_type, is_customer_online, use_price_group, record_status) VALUES
          (9661, 'TDC661', 'TD R6 ร้านเก่า ', '038-111222 ', '98 ม.4 ต.ดอนหัวฬ่อ อ.เมือง จ.ชลบุรี 20000  ', NULL, NULL,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'ACTIVE'),
          (9662, 'TDC662', 'TD R6 คอนโด', '+66 82 504 4564', 'ห้อง 101 ( คอนโด ),  แขวงบางนาใต้ เขตบางนา จ.กรุงเทพมหานคร 10260',
           'ห้อง 101 ( คอนโด ),', '', 10, 980, 7583, '10260', '', '', '', 'Normal', true, 'Retail', 'ACTIVE');`);
      const since = await lastAuditId();
      const rowOf = async (code: string) =>
        (
          await db.execute<{ r: Record<string, unknown> }>(
            sql`SELECT to_jsonb(c) AS r FROM customer c WHERE customer_code = ${code}`,
          )
        ).rows[0]!.r;
      // what the edit form sends back (customer-form.tsx toCustomerForm: an address-only row shows it in บรรทัด 1)
      const form = async (code: string) => {
        const c = (await getCustomerByCode(code))!;
        return { ...c, address1: c.address1 || c.address, address: undefined, id: undefined };
      };
      const save = async (body: Record<string, unknown>) =>
        (await customerPOST(await request('/api/customers', U.admin, { method: 'POST', body }))).status;
      for (const code of ['TDC661', 'TDC662']) {
        const before = await rowOf(code);
        assert.equal(await save(await form(code)), 200, code);
        assert.deepEqual(
          await rowOf(code),
          before,
          `${code} unchanged (no trim, no re-built address, no stamp, row_version kept)`,
        );
        assert.deepEqual(await auditOf('customer', code, since), [], `${code} no audit row`);
      }
      assert.equal(await save({ ...(await form('TDC662')), line: 'td-r6' }), 200);
      const r = await rowOf('TDC662');
      assert.deepEqual(
        [r.line_id, r.customer_address, r.status_changed_at, r.row_version],
        ['td-r6', 'ห้อง 101 ( คอนโด ),  แขวงบางนาใต้ เขตบางนา จ.กรุงเทพมหานคร 10260', null, 1],
      );
      assert.deepEqual(await auditOf('customer', 'TDC662', since), [{ lineId: ['', 'td-r6'] }]);
    });

    await test('R6 products: a product saved unchanged writes nothing (no status stamp, no audit); a price change logs only it, with the real old value', async () => {
      await pool.query(`
        DELETE FROM product_model WHERE product_id = 9661;
        DELETE FROM product_none_serial WHERE product_id = 9661 OR item_id = 9661;
        DELETE FROM product WHERE product_id = 9661 OR product_code = 'TDP661';
        INSERT INTO product (product_id, product_code, product_name, product_name_en, product_vender_code, record_status)
          VALUES (9661, 'TDP661', 'TD R6 อะไหล่เก่า ', 'Old  part ', '', 'ACTIVE');
        INSERT INTO product_none_serial (item_id, product_id, quantity_available, quantity_used, quantity_booking,
                                         quantity_remain, retail_price, capital_price, wholesale_price)
          VALUES (9661, 9661, 0, 0, 0, 0, 5.00, 0.00, 4.00);`);
      const since = await lastAuditId();
      const rowOf = async () =>
        (
          await db.execute<{ r: Record<string, unknown> & { n: Record<string, unknown> } }>(
            sql`SELECT to_jsonb(p) || jsonb_build_object('n', (SELECT to_jsonb(n) FROM product_none_serial n
                  WHERE n.product_id = p.product_id)) AS r FROM product p WHERE product_id = 9661`,
          )
        ).rows[0]!.r;
      // what the product dialog sends back (product-detail-modal.tsx)
      const form = async () => {
        const p = (await getProduct('TDP661'))!;
        return {
          sysCode: p.sysCode,
          mfgCode: p.mfgCode,
          name: p.name,
          nameEn: p.nameEn ?? '',
          nameCn: p.nameCn ?? '',
          description: p.description ?? '',
          category: p.category,
          brand: p.brand,
          capitalPrice: p.capitalPrice ? String(p.capitalPrice) : '',
          wholesalePrice: p.wholesalePrice ? String(p.wholesalePrice) : '',
          price: p.price ? String(p.price) : '',
          forModelColor: p.forModelColor ?? '',
          status: p.status,
          ubRepairOnly: p.ubRepairOnly,
          models: p.models,
          version: p.version,
        };
      };
      const before = await rowOf();
      await saveProduct(await form(), U.admin.id);
      assert.deepEqual(await rowOf(), before, 'unchanged');
      assert.deepEqual(await auditOf('product', 'TDP661', since), [], 'no audit row');
      await saveProduct({ ...(await form()), price: '6' }, U.admin.id);
      const r = await rowOf();
      assert.deepEqual([r.n.retail_price, r.status_changed_at, r.product_name], [6, null, 'TD R6 อะไหล่เก่า ']);
      assert.deepEqual(await auditOf('product', 'TDP661', since), [{ retailPrice: [5, 6] }]);
    });

    await test('R6 SO slip: on a waiting order only its creator / System Admin pass the guard (others 403 like an edit); a cancelled one → 409', async () => {
      const sharp = (await import('sharp')).default;
      const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } })
        .png()
        .toBuffer();
      const upload = async (u: TestUser, no: string) => {
        const fd = new FormData();
        fd.set('kind', 'sale-order-slip');
        fd.set('id', no);
        fd.set('file', new File([new Uint8Array(png)], 'slip.png', { type: 'image/png' }));
        const req = new NextRequest('https://svc.example.test/api/upload', {
          method: 'POST',
          headers: { cookie: await cookieFor(u), 'user-agent': 'test-domain' },
          body: fd,
        });
        const r = await uploadPOST(req);
        return { status: r.status, error: ((await r.json()) as { error?: string }).error };
      };
      await setStock(P.a.code, 10);
      const created = await json(
        await soPOST(
          await request('/api/sale-orders', U.seller, {
            method: 'POST',
            body: {
              customerCode: CUSTOMER,
              salesId: U.seller.id,
              submit: true,
              lines: [{ code: P.a.code, qty: 1, price: 100 }],
            },
          }),
        ),
      );
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const no = (created.body.order as { no: string }).no;
      for (const u of [U.seller2, U.manager])
        assert.deepEqual(await upload(u, no), { status: 403, error: WAITING_CREATOR_ONLY }, u.email);
      // no storage in the test env: past the guard the upload stops at 503 "ระบบจัดเก็บไฟล์ยังไม่ได้ตั้งค่า"
      const env = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SECRET_KEY;
      try {
        assert.deepEqual([(await upload(U.seller, no)).status, (await upload(U.admin, no)).status], [503, 503]);
      } finally {
        if (env.url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = env.url;
        if (env.key !== undefined) process.env.SUPABASE_SECRET_KEY = env.key;
      }
      await db.execute(sql`UPDATE sale_out_hd SET record_status = 'DELETED' WHERE sale_out_hd_no = ${no}`);
      assert.equal((await upload(U.admin, no)).status, 409, 'cancelled');
    });
  }
  // ── Round 6: special rights ──
  console.log('\nRound 6 — special rights (app_config rows instead of role names in code) + migration 0030');
  {
    const { savePermissions, listStaff } = await import('@/server/services/users');
    const { getSaleOrder } = await import('@/server/services/sale-orders');
    const { overdueAlerts } = await import('@/server/services/alerts');
    const { NOT_APPROVER } = await import('@/lib/validation/sale-order');
    const { NOT_ENGINEER, REOPEN_LOCKED } = await import('@/lib/validation/job');
    const { hasRight, invalidateGrantCache, grantsForUserType } = await import('@/server/auth');
    const { canViewPath } = await import('@/lib/modules');
    const { GET: productGET } = await import('@/app/api/products/[code]/route');
    const { GET: exportGET } = await import('@/app/api/export/[resource]/route');
    // the permissions page's save (POST /api/admin/permissions → savePermissions): it must take effect at once
    const tick = (role: string, menu: string, view: boolean) =>
      savePermissions([{ role, menu, add: false, edit: false, del: false, view }], U.admin.id);
    const job = (no: string, status: number) =>
      `('${no}', ${status}, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01')`;
    await pool.query(`
      INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date)
        VALUES ${job('TDJ0801', 1)}, ${job('TDJ0802', 1)}, ${job('TDJ0803', 20)};
      UPDATE job SET service_cost = 300, spare_part_total_cost = 0, job_total_cost = 300,
                     job_payment_type = 'เงินสด', job_payment_amount = 300 WHERE job_no = 'TDJ0803';`);

    await test('R6 SO Approve: ticked for a CS-like role → it approves another’s order (and is named as approver); unticked for Manager → 403', async () => {
      await setStock(P.a.code, 10);
      const create = async () => {
        const body = {
          customerCode: CUSTOMER,
          salesId: U.seller.id,
          submit: true,
          lines: [{ code: P.a.code, qty: 1 }],
        };
        const r = await json(await soPOST(await request('/api/sale-orders', U.seller, { method: 'POST', body })));
        assert.equal(r.status, 201, JSON.stringify(r.body));
        return (r.body.order as { no: string }).no;
      };
      const approve = async (u: TestUser, no: string) =>
        json(
          await soApprovePOST(
            await request(`/api/sale-orders/${no}/approve`, u, { method: 'POST', body: { decision: 'approve' } }),
            { params: Promise.resolve({ no }) },
          ),
        );
      const no = await create();
      assert.deepEqual(
        [(await approve(U.seller2, no)).status, (await getSaleOrder(no))!.approverRoles],
        [403, ['Manager']],
      );
      await tick('TD Seller', 'SO Approve', true);
      try {
        assert.deepEqual((await getSaleOrder(no))!.approverRoles, ['Manager', 'TD Seller']);
        const ok = await approve(U.seller2, no); // created + sold by U.seller, decided by another TD Seller
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.equal((await qty(P.a.code)).remain, 9);
        await tick('Manager', 'SO Approve', false);
        const r = await approve(U.manager, await create());
        assert.deepEqual([r.status, r.body.error], [403, NOT_APPROVER]);
      } finally {
        await tick('TD Seller', 'SO Approve', false);
        await tick('Manager', 'SO Approve', true);
      }
    });

    await test('R6 Job Take: the assignee list + assertAssignee follow the right (clerk role ticked → takes a job; Engineer unticked → 400); Overdue All widens the bell', async () => {
      const offered = async () => (await listStaff()).filter((u) => u.takesJobs).map((u) => u.id);
      const scope = async (u: TestUser) => (await overdueAlerts(await userOf(u))).scope;
      assert.ok(!(await offered()).includes(U.clerk.id));
      assert.equal((await fieldsOf(assignJobs(['TDJ0801'], U.clerk.id, U.admin.id))).status, 400);
      assert.deepEqual([await scope(U.engineer), await scope(U.clerk)], ['mine', 'all']);
      await tick('TD Job Clerk', 'Job Take', true);
      try {
        assert.ok((await offered()).includes(U.clerk.id), 'offered at once: the save drops the staff cache');
        assert.equal((await fieldsOf(assignJobs(['TDJ0801'], U.clerk.id, U.admin.id))).status, 200);
        assert.equal(await scope(U.clerk), 'mine', 'a job taker sees their own overdue jobs');
        await tick('TD Job Clerk', 'Overdue All', true);
        assert.equal(await scope(U.clerk), 'all', 'unless also Overdue All (Head Engineer)');
        await tick('Engineer', 'Job Take', false);
        assert.ok(!(await offered()).includes(U.engineer.id));
        const r = await fieldsOf(assignJobs(['TDJ0802'], U.engineer.id, U.admin.id));
        assert.deepEqual([r.status, r.fields], [400, { engineerId: NOT_ENGINEER }]);
      } finally {
        await tick('TD Job Clerk', 'Job Take', false);
        await tick('TD Job Clerk', 'Overdue All', false);
        await tick('Engineer', 'Job Take', true);
      }
    });

    await test('R6 Job Money After Close / Job Reopen: a non-admin role with the right edits money on a closed job / re-opens it', async () => {
      const [s20, s5] = [await statusName(20), await statusName(5)];
      const money = () => fieldsOf(saveRepair('TDJ0803', { status: s20, serviceCost: 999 }, U.clerk.id));
      assert.equal((await money()).status, 409);
      const reopen = await fieldsOf(saveRepair('TDJ0803', { status: s5 }, U.clerk.id));
      assert.deepEqual([reopen.status, reopen.fields], [409, { status: REOPEN_LOCKED }]);
      try {
        await tick('TD Job Clerk', 'Job Money After Close', true);
        assert.equal((await money()).status, 200);
        assert.deepEqual([(await getJob('TDJ0803'))!.serviceCost, (await jobRow('TDJ0803')).s], [999, 20]);
        await tick('TD Job Clerk', 'Job Reopen', true);
        assert.equal((await fieldsOf(saveRepair('TDJ0803', { status: s5 }, U.clerk.id))).status, 200);
        assert.equal((await jobRow('TDJ0803')).s, 5);
      } finally {
        await tick('TD Job Clerk', 'Job Money After Close', false);
        await tick('TD Job Clerk', 'Job Reopen', false);
      }
    });

    await test('R6 Product Cost: the product API returns ราคาทุน only to a role with the right (Product edit no longer decides)', async () => {
      await db.execute(sql`UPDATE product_none_serial SET capital_price = 55.00 WHERE product_id = ${P.a.id}`);
      const cost = async () =>
        (
          (
            await json(
              await productGET(await request(`/api/products/${P.a.code}`, U.seller), {
                params: Promise.resolve({ code: P.a.code }),
              }),
            )
          ).body.product as { capitalPrice?: number }
        ).capitalPrice;
      await savePermissions([{ role: 'TD Seller', menu: 'Product', add: false, edit: true, del: false, view: true }]);
      try {
        assert.equal(await cost(), undefined, 'Product edit alone');
        await tick('TD Seller', 'Product Cost', true);
        assert.equal(await cost(), 55);
      } finally {
        await tick('TD Seller', 'Product Cost', false);
        await pool.query(`DELETE FROM app_config WHERE user_type = 'TD Seller' AND module_name = 'Product'`);
        invalidateGrantCache();
      }
    });

    await test('R6 Report / Export: report data + pages follow Report; the export route follows Export', async () => {
      const exportAs = async (u: TestUser) =>
        (
          await exportGET(await request('/api/export/customers', u), {
            params: Promise.resolve({ resource: 'customers' }),
          })
        ).status;
      const pages = async () => canViewPath(false, await grantsForUserType('TD Customer Viewer'), '/reports/open-job');
      assert.deepEqual([await readData('job_summary', U.viewer), await pages()], [403, false]);
      await tick('TD Customer Viewer', 'Report', true);
      try {
        assert.deepEqual([await readData('job_summary', U.viewer), await pages()], [200, true]);
        assert.equal(await exportAs(U.viewer), 200, 'Customer view + Export (seeded for every role)');
        await tick('TD Customer Viewer', 'Export', false);
        assert.equal(await exportAs(U.viewer), 403);
      } finally {
        await tick('TD Customer Viewer', 'Report', false);
        await tick('TD Customer Viewer', 'Export', true);
      }
    });

    await test('R6 migration 0030: seeds the rights as the rules were; re-run changes nothing; a removed right stays removed', async () => {
      const file = readFile('drizzle/0030_special_rights.sql', 'utf8');
      await pool.query(`
        DELETE FROM app_config WHERE user_type IN ('Head Engineer', 'TD Cost Role');
        INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view)
          VALUES ('TD Cost Role', 'Product', false, true, false, true), ('Head Engineer', 'Job Repair', true, true, true, true);
        UPDATE app_config SET can_view = false WHERE user_type = 'TD Customer Viewer' AND module_name = 'Export';`);
      const roles = `'Manager', 'Engineer', 'Head Engineer', 'TD Cost Role', 'TD Customer Viewer'`;
      const state = async () =>
        (
          await pool.query<{ t: string; m: string; i: boolean; e: boolean; d: boolean; v: boolean }>(
            `SELECT user_type t, module_name m, can_insert i, can_edit e, can_delete d, can_view v FROM app_config
              WHERE user_type IN (${roles}) AND module_name IN ('SO Approve', 'Job Take', 'Overdue All', 'Job Reopen',
                    'Job Money After Close', 'Product Cost', 'Report', 'Export')
                AND (can_view OR module_name = 'Export')`, // earlier tests leave unticked rows behind
          )
        ).rows
          .map((r) => `${r.t}:${r.m}:${r.i ? 'I' : '-'}${r.e ? 'E' : '-'}${r.d ? 'D' : '-'}${r.v ? 'V' : '-'}`)
          .sort();
      try {
        await pool.query(file);
        const once = await state();
        assert.deepEqual(once, [
          'Engineer:Export:---V',
          'Engineer:Job Take:---V',
          'Head Engineer:Export:---V',
          'Head Engineer:Job Take:---V',
          'Head Engineer:Overdue All:---V',
          'Manager:Export:---V',
          'Manager:SO Approve:---V',
          'TD Cost Role:Export:---V',
          'TD Cost Role:Product Cost:---V',
          'TD Customer Viewer:Export:----', // unticked by the business: not given back
        ]);
        await pool.query(file);
        assert.deepEqual(await state(), once, 'second run changes nothing');
        const granted = await pool.query(
          `SELECT 1 FROM app_config WHERE module_name IN ('Job Reopen', 'Job Money After Close', 'Report') AND can_view`,
        );
        assert.equal(granted.rowCount, 0, 'System Admin only (implicit) — no role row');
        invalidateGrantCache();
        const as = (userType: string) => ({ isAdmin: userType === 'System Admin', userType });
        assert.deepEqual(
          [
            await hasRight(as('Manager'), 'SO Approve'),
            await hasRight(as('Engineer'), 'Job Take'),
            await hasRight(as('Engineer'), 'Overdue All'),
            await hasRight(as('Head Engineer'), 'Overdue All'),
            await hasRight(as('TD Cost Role'), 'Product Cost'),
            await hasRight(as('System Admin'), 'Job Reopen'),
            await hasRight(as('System Admin'), 'Job Take'),
          ],
          [true, true, false, true, true, true, false],
        );
      } finally {
        await pool.query(`
          DELETE FROM app_config WHERE user_type = 'TD Cost Role';
          UPDATE app_config SET can_view = true WHERE user_type = 'TD Customer Viewer' AND module_name = 'Export';`);
        invalidateGrantCache();
      }
    });
  }
  // ── Round 7: small fixes ──
  console.log('\nRound 7 — small fixes (rights names, System Admin on the permissions page)');
  {
    const { RIGHTS, PAGE_MODULES, adminImplicit, checkGrant, checkRight, rightLabel, noRight } =
      await import('@/lib/modules');
    const { NOT_APPROVER } = await import('@/lib/validation/sale-order');
    const { NOT_ENGINEER, REOPEN_LOCKED, MONEY_LOCKED, moneyLockedMsg } = await import('@/lib/validation/job');
    const rights = Object.keys(RIGHTS) as (keyof typeof RIGHTS)[];

    await test('R7 permissions page: System Admin shows ticked + locked exactly what it holds with no row (all but Job Take)', async () => {
      // the page ticks and locks adminImplicit(m) for System Admin — it must be what the checks grant with no rows
      for (const r of rights) assert.equal(adminImplicit(r), checkRight(true, {}, r), r);
      for (const m of PAGE_MODULES)
        for (const a of ['add', 'edit', 'del', 'view'] as const)
          assert.equal(adminImplicit(m), checkGrant(true, {}, m, a), `${m} ${a}`);
      assert.deepEqual(
        rights.filter((r) => !adminImplicit(r)),
        ['Job Take'],
      );
      // ticked Job Take still counts for System Admin; a non-admin needs the tick for every right
      assert.equal(
        checkRight(true, { 'Job Take': { add: false, edit: false, del: false, view: true } }, 'Job Take'),
        true,
      );
      for (const r of rights) assert.equal(checkRight(false, {}, r), false, r);
    });

    await test('R7 rights: one short name per right — the 403 / 409 messages and hints are built from RIGHTS', async () => {
      const says = (msg: string, r: keyof typeof RIGHTS) => {
        assert.ok(msg.includes(`"${RIGHTS[r]}"`) && msg.includes(`(${r})`), `${r}: ${msg}`);
        assert.ok(msg.includes(rightLabel(r)), msg);
      };
      says(NOT_APPROVER, 'SO Approve');
      assert.equal(NOT_APPROVER, noRight('SO Approve'));
      says(NOT_ENGINEER, 'Job Take');
      says(REOPEN_LOCKED, 'Job Reopen');
      says(MONEY_LOCKED, 'Job Money After Close');
      says(moneyLockedMsg('ค่าบริการ'), 'Job Money After Close');
      // the names the testers saw disagree (page vs error) are gone: the page shows RIGHTS[r] itself
      assert.equal(RIGHTS['SO Approve'], 'อนุมัติใบสั่งขาย');
      assert.equal(RIGHTS['Job Reopen'], 'เปิดงานที่ปิดแล้ว');
      for (const r of rights) assert.ok(!RIGHTS[r].includes(' / ') && RIGHTS[r].length <= 30, `short name: ${r}`);
    });
  }
  // ── Round 7: persona R6 — users page could not clear an optional field ──
  {
    const { upsertUser } = await import('@/server/services/users');
    await test('R7 admin users: clearing phone / Lark ID / department saves them empty; leaving them out keeps them', async () => {
      const row = async () =>
        (
          await db.execute<{ p: string | null; l: string | null; d: string | null }>(
            sql`SELECT phone_no AS p, lark_id AS l, department AS d FROM app_user WHERE user_id = ${U.clerk.id}`,
          )
        ).rows[0];
      const base = { id: String(U.clerk.id), name: 'TD td-clerk', role: U.clerk.type, status: 'Active' };
      await upsertUser({ ...base, phone: '0812345678', code: 'TD-LARK', branch: 'TD สาขา' }, U.admin.id);
      assert.deepEqual({ ...(await row()) }, { p: '0812345678', l: 'TD-LARK', d: 'TD สาขา' });
      await upsertUser(base, U.admin.id); // a caller that does not send them
      assert.deepEqual({ ...(await row()) }, { p: '0812345678', l: 'TD-LARK', d: 'TD สาขา' }, 'not sent → kept');
      await upsertUser({ ...base, phone: '', code: '', branch: '' }, U.admin.id); // the edit form, fields emptied
      assert.deepEqual({ ...(await row()) }, { p: null, l: null, d: null }, 'sent empty → cleared');
    });
    await test("R7 sale-order list: the part-code box finds orders by a line's code; SO no. and customer filter on their own", async () => {
      const { listSaleOrders } = await import('@/server/services/sale-orders');
      const [o] = (
        await db.execute<{ no: string; code: string; cust: string }>(sql`
          SELECT h.sale_out_hd_no AS no, d.product_code AS code, h.customer_name AS cust FROM sale_out_hd h
            JOIN sale_out_dt d ON d.sale_out_hd_no = h.sale_out_hd_no
           WHERE h.record_status <> 'DELETED' AND coalesce(d.product_code, '') <> '' LIMIT 1`)
      ).rows;
      assert.ok(o, 'a sale order with a coded line exists');
      const nos = async (f: Parameters<typeof listSaleOrders>[0]) => (await listSaleOrders(f)).map((r) => r.no);
      assert.ok((await nos({ code: o.code })).includes(o.no), 'by part code');
      assert.ok(!(await nos({ code: 'TD-NO-SUCH-PART' })).length, 'unknown code → none');
      assert.deepEqual(await nos({ no: o.no }), [o.no], 'by SO no.');
      assert.ok((await nos({ no: o.no, customer: o.cust.slice(0, 3) })).includes(o.no), 'both boxes together');
      assert.ok(!(await nos({ no: o.no, customer: 'TD-NOBODY-XYZ' })).length, 'a wrong name is not dropped');
    });
  }
  // ── Round 8: sales, customers, products, stock history ──
  {
    const { pageMovements } = await import('@/server/services/stock');
    await test('R8 stock history: a code and a name typed together ("P02556 ฝาหลัง") find the document, every word must match', async () => {
      await db.execute(sql`UPDATE product SET product_name_en = 'TD R8 Back Cover' WHERE product_code = ${P.a.code}`);
      const { no } = await receiveStock(
        { supplier: 'TD-R8', poRef: 'TD-R8-PO', lines: [{ code: P.a.code, qty: 1 }] },
        U.admin.id,
      );
      const docs = async (q: string, f: { code?: string } = {}) =>
        (await pageMovements({ page: 1, pageSize: 100, q, f: {} }, f)).rows.map((r) => r.doc);
      assert.ok((await docs(`${P.a.code} back cover`)).includes(no), 'search box: code + name words');
      assert.ok((await docs(`cover ${P.a.code}`)).includes(no), 'any order');
      assert.ok((await docs(`TD-R8-PO back`)).includes(no), 'reference + name');
      assert.ok((await docs(`${no} ${P.a.code}`)).includes(no), 'document no + code');
      assert.ok(!(await docs(`${P.a.code} TD-NO-SUCH-WORD`)).includes(no), 'one word that matches nothing → not found');
      assert.ok((await docs('', { code: `${P.a.code} Back` })).includes(no), 'รหัส / ชื่ออะไหล่ filter: code + name');
      assert.ok(!(await docs('', { code: `${P.a.code} TD-NO-SUCH-WORD` })).includes(no), 'filter: every word');
    });
  }
  // ── Round 8: shared UI, admin, /track, API docs ──
  {
    const { upsertUser } = await import('@/server/services/users');
    const { PENDING_ROLE } = await import('@/lib/access');
    const { fieldLabel } = await import('@/lib/field-labels');
    const { JOB_COLUMN_LABEL } = await import('@/lib/validation/job');
    const tracking = await import('@/server/services/tracking');
    /** the 400's status + field names of a refused call (null when it went through) */
    const refusal = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: unknown) => {
          if (!(e instanceof HttpError)) throw e;
          return [e.status, Object.keys((e.details as { fields?: object } | undefined)?.fields ?? {})];
        },
      );

    await test('R8 date filters: an impossible date (2026-02-30) is a 400 under its name, not a dropped filter', async () => {
      const get = async (resource: string, query: string) =>
        json(
          await dataGET(await request(`/api/data/${resource}?${query}`, U.admin), {
            params: Promise.resolve({ resource }),
          }),
        );
      for (const [resource, query, field] of [
        ['audit_log', 'paged=1&from=2026-02-30', 'from'],
        ['jobs', 'paged=1&to=abc', 'to'],
        ['quotations', 'from=2026-13-01', 'from'],
        ['movements', 'to=2026-02-29', 'to'], // 2026 is not a leap year
      ] as const) {
        const r = await get(resource, query);
        assert.equal(r.status, 400, `${resource} ${query}`);
        assert.deepEqual(Object.keys((r.body.details as { fields: object }).fields), [field], `${resource} ${query}`);
      }
      assert.equal((await get('audit_log', 'paged=1&from=2026-02-28&to=2028-02-29')).status, 200, 'real days pass');
      assert.equal((await get('audit_log', 'paged=1&from=&to=')).status, 200, 'empty = no filter');
    });

    await test('R8 admin users: "รออนุมัติ" cannot be given from the user form (400 under role); a pending user keeps it', async () => {
      const email = 'td-r8-pending@example.invalid';
      assert.deepEqual(
        await refusal(upsertUser({ name: 'TD r8-new', email, role: PENDING_ROLE, status: 'Active' }, U.admin.id)),
        [400, ['role']],
        'new user',
      );
      assert.equal((await db.execute(sql`SELECT 1 FROM app_user WHERE email_address = ${email}`)).rows.length, 0);
      const clerk = { id: String(U.clerk.id), name: 'TD td-clerk', status: 'Active' };
      assert.deepEqual(
        await refusal(upsertUser({ ...clerk, role: PENDING_ROLE }, U.admin.id)),
        [400, ['role']],
        'a user with a role',
      );
      const typeOf = async (id: number) =>
        (await db.execute<{ t: string | null }>(sql`SELECT user_type AS t FROM app_user WHERE user_id = ${id}`)).rows[0]
          ?.t;
      assert.equal(await typeOf(U.clerk.id), U.clerk.type, 'role kept');
      // never worse: a still-pending user saved as it is (ถอนสิทธิ์ / แก้ไข) still saves
      await upsertUser(
        { id: String(U.pending.id), name: 'TD td-pending', role: PENDING_ROLE, status: 'Active' },
        U.admin.id,
      );
      assert.equal(await typeOf(U.pending.id), null);
    });

    await test('R8 audit log: one Thai label map for the job history and the audit log; an unknown key shows as it is', async () => {
      for (const [k, v] of Object.entries(JOB_COLUMN_LABEL)) assert.equal(fieldLabel(k), v, k);
      assert.equal(fieldLabel('nameEn'), 'ชื่อ (อังกฤษ)');
      assert.equal(fieldLabel('isActive'), 'เปิดใช้งาน');
      assert.equal(fieldLabel('trackUrl'), 'ลิงก์ติดตามพัสดุ');
      assert.equal(fieldLabel('recordStatus'), 'สถานะรายการ');
      assert.equal(fieldLabel('someNewColumn'), 'someNewColumn');
      assert.equal(fieldLabel('constructor'), 'constructor', 'own keys only');
    });

    await test('R8 /track: a cancelled quotation leaves no "ใบเสนอราคา" step on the timeline (a sent one still does)', async () => {
      // customer 9281 comes from the Round 2 block
      await pool.query(`
        INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
          SELECT * FROM (VALUES (4, 'อยู่ระหว่างการซ่อม - เสนอราคาลูกค้า', 4, 'Pending', true),
                                (13, 'อยู่ระหว่างการซ่อม - รอเสนอราคา', 13, 'Pending', true)) v(id, name, ord, grp, act)
           WHERE NOT EXISTS (SELECT 1 FROM job_status s WHERE s.job_status_id = v.id);
        DELETE FROM quotation_hd WHERE quotation_no = 'TDQ0881';
        DELETE FROM job_log WHERE job_no = 'TDJ0881';
        DELETE FROM job WHERE job_no = 'TDJ0881';
        INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_by,
                         job_create_date, job_reception_date, job_closed_date)
          VALUES ('TDJ0881', 5, 9281, 'TDC281 คุณสมชาย ใจดี', 'Model TD', ${U.admin.id},
                  '2026-09-07 10:00', '2026-09-07', '1900-01-01');
        INSERT INTO job_log (job_no, job_status_id, job_log_date, job_action_by)
          VALUES ('TDJ0881', 1, '2026-09-07 10:00', ${U.admin.id}), ('TDJ0881', 13, '2026-09-08 10:00', ${U.admin.id}),
                 ('TDJ0881', 4, '2026-09-08 11:00', ${U.admin.id}), ('TDJ0881', 5, '2026-09-10 10:00', ${U.admin.id});
        INSERT INTO quotation_hd (quotation_no, customer_code, reference_job_no, net_amount, quotation_status_id, create_date, create_by, is_active)
          VALUES ('TDQ0881', 'TDC281', 'TDJ0881', 500, 5, '2026-09-08', ${U.admin.id}, true);`);
      const cancelled = (await tracking.publicJobByNo('TDJ0881'))!;
      assert.ok(!cancelled.docs.some((d) => d.kind === 'quotation'), 'no document');
      assert.deepEqual(
        cancelled.history.map((h) => h.key),
        ['received', 'repaired'],
        'no passed quotation step',
      );
      await pool.query(`UPDATE quotation_hd SET quotation_status_id = 2 WHERE quotation_no = 'TDQ0881'`);
      const sent = (await tracking.publicJobByNo('TDJ0881'))!;
      assert.deepEqual(
        sent.history.find((h) => h.key === 'waiting'),
        { key: 'waiting', at: '2026-09-08', label: 'ใบเสนอราคา' },
      );
      assert.ok(sent.docs.some((d) => d.kind === 'quotation' && d.ref === 'TDQ0881'));
    });

    // ── Round 8: wrap-up ──
    await test('R8 search: a typed "%" or "_" is matched literally, not as a LIKE wildcard', async () => {
      const { listJobs } = await import('@/server/services/jobs');
      const { listCustomers } = await import('@/server/services/customers');
      await pool.query(`
        DELETE FROM job WHERE job_no IN ('TDJ0891', 'TDJ0892');
        INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date)
          VALUES ('TDJ0891', 2, 9001, '${CUSTOMER} ร้านลด 100%_ดี', 'Model TD', now(), current_date, '1900-01-01'),
                 ('TDJ0892', 2, 9001, '${CUSTOMER} ร้านลด 100xyดี', 'Model TD', now(), current_date, '1900-01-01');`);
      const hits = async (f: Parameters<typeof listJobs>[0]) =>
        (await listJobs(f)).map((j) => j.no).filter((n) => n === 'TDJ0891' || n === 'TDJ0892');
      assert.deepEqual(await hits({ q: '%' }), ['TDJ0891'], 'search box: "%" alone is not "everything"');
      assert.deepEqual(await hits({ q: '100%_ดี' }), ['TDJ0891'], 'search box: "100%_ดี" is not "100…?ดี"');
      assert.deepEqual(await hits({ q: 'ลด 100_' }), [], '"_" is not "any one character"');
      assert.deepEqual(await hits({ customer: '0%' }), ['TDJ0891'], 'customer filter');
      assert.deepEqual(await hits({ customer: '100xyดี' }), ['TDJ0892'], 'plain text still finds');
      assert.ok(!(await listCustomers({ q: '%' })).some((c) => c.code === CUSTOMER), 'customer search');
      assert.ok(!(await listCustomers({ filters: { code: '_' } })).some((c) => c.code === CUSTOMER), 'customer code');
    });
  }
} finally {
  // fixtures above insert symptoms / brands with explicit ids: move the sequences past them, or the next
  // suite's first app insert (test:api POST /api/masters/symptoms) collides on the primary key
  await pool.query(`
    SELECT setval(pg_get_serial_sequence('symptom', 'symptom_id'), (SELECT coalesce(max(symptom_id), 1) FROM symptom));
    SELECT setval(pg_get_serial_sequence('manufacturer', 'manufacturer_id'), (SELECT coalesce(max(manufacturer_id), 1) FROM manufacturer));`);
  await pool.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
