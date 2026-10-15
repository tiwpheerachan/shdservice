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
} as const;
type TestUser = (typeof U)[keyof typeof U];
const SV = 3; // every fixture user's session_version — a cookie must carry exactly this
const P = { a: { id: 9201, code: 'TDP1' }, b: { id: 9202, code: 'TDP2' }, c: { id: 9203, code: 'TDP3' } };
const CUSTOMER = 'TDC001';
const JOB_CLOSE = 'TDJ0001'; // closeJob race
const JOB_PARTS = 'TDJ0002'; // issueForJob over stock
const JOB_REPAIR = 'TDJ0003'; // saveRepair race
const JOB_EDIT = 'TDJ0004'; // row_version
const JOB_QUOTE = 'TDJ00005'; // a quotation's job (the form wants letters + ≥ 5 digits)
const JOB_BILL = 'TDJ0006'; // deposit + returned parts (amount due, parts cost)
const JOB_OUT = 'TDJ0007'; // out-source send → close refused → receive → close
const JOB_NOREPAIR = 'TDJ0008'; // closed with job_repaired_date still 1900
const JOB_OUT_CLOSED = 'TDJ0009'; // legacy: already closed with an open send row

async function seed() {
  const users = Object.values(U);
  await pool.query(`
    DELETE FROM app_config WHERE user_type LIKE 'TD %';
    INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
      ('TD Job Clerk', 'Job Management', false, true, false, true),
      ('TD Job Clerk', 'Customer', true, true, true, false),          -- every right but view: view is its own grant
      ('TD Customer Viewer', 'Customer', false, false, false, true),
      ('TD Picker', 'Product Pick Stock', true, false, false, true),
      ('TD Seller', 'Sale Order', true, true, false, true);

    DELETE FROM app_user WHERE user_id BETWEEN 9100 AND 9199 OR email_address LIKE 'td-%@example.invalid';
    INSERT INTO app_user (user_id, first_name, last_name, email_address, user_type, record_status, session_version) VALUES
      ${users.map((u) => `(${u.id}, 'TD', '${u.email.split('@')[0]}', '${u.email}', ${u.type ? `'${u.type}'` : 'NULL'}, '${u.status}', ${SV})`).join(',\n      ')};

    INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
      SELECT * FROM (VALUES (0, 'ยกเลิก', 0, 'Cancel', true), (1, 'รับงานใหม่', 1, 'Open', true), (2, 'กำลังดำเนินการ', 2, 'Open', true),
                            (5, 'ซ่อมเสร็จ', 5, 'Repaired', true), (20, 'เสร็จสมบูรณ์', 20, 'Finished', true),
                            (6, 'ยกเลิกซ่อม (ลูกค้าไม่ตกลงซ่อม)', 6, 'Repaired', true),
                            (14, 'อยู่ระหว่างการซ่อม - ส่งซ่อม Out-Source แล้ว', 14, 'Pending', true),
                            (15, 'อยู่ระหว่างการซ่อม - รับคืนจาก Out-Source แล้ว', 15, 'Pending', true),
                            (24, 'ปิดงาน-รอลูกค้ามารับที่ศูนย์บริการ', 24, 'Finished', true)) v(id, name, ord, grp, act)
       WHERE NOT EXISTS (SELECT 1 FROM job_status s WHERE s.job_status_id = v.id);

    DELETE FROM sale_out_dt WHERE sale_out_hd_no IN (SELECT sale_out_hd_no FROM sale_out_hd WHERE customer_code = '${CUSTOMER}');
    DELETE FROM sale_out_hd WHERE customer_code = '${CUSTOMER}';
    DELETE FROM customer WHERE customer_id = 9001 OR customer_code = '${CUSTOMER}';
    INSERT INTO customer (customer_id, customer_code, customer_name, phone_number) VALUES (9001, '${CUSTOMER}', 'ลูกค้า ทดสอบโดเมน', '02-000-0000');

    DELETE FROM product_none_serial WHERE product_id IN (9201, 9202, 9203) OR item_id IN (9201, 9202, 9203);
    DELETE FROM product WHERE product_id IN (9201, 9202, 9203) OR product_code IN ('TDP1', 'TDP2', 'TDP3');
    INSERT INTO product (product_id, product_code, product_name) VALUES (9201, 'TDP1', 'อะไหล่ทดสอบ 1'), (9202, 'TDP2', 'อะไหล่ทดสอบ 2'), (9203, 'TDP3', 'อะไหล่ทดสอบ 3');
    INSERT INTO product_none_serial (item_id, product_id, quantity_available, quantity_used, quantity_booking, quantity_remain, retail_price) VALUES
      (9201, 9201, 10, 0, 0, 10, 100.00), (9202, 9202, 10, 0, 0, 10, 200.00), (9203, 9203, 10, 0, 0, 10, 300.00);

    DELETE FROM job_log WHERE job_no LIKE 'TDJ%';
    DELETE FROM job_send_forward_dt WHERE job_no LIKE 'TDJ%';
    DELETE FROM quotation_hd WHERE quotation_no LIKE 'TDQ%';
    DELETE FROM inventory_dt WHERE inventory_no LIKE 'TDW%';
    DELETE FROM inventory_hd WHERE inventory_no LIKE 'TDW%';
    DELETE FROM color WHERE color_name = 'TD color';
    DELETE FROM job_order_spare_part_log WHERE job_no LIKE 'TDJ%';
    DELETE FROM job WHERE job_no LIKE 'TDJ%';
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
        body: { type: 'sale', ref: soNo, payTo: 'TD', lines: [{ dtId: soDtId, qty: 2 }] },
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
  const jobEdit = { customerCode: CUSTOMER, jobType: '', dueDate: '2026-12-31', warrantyMonth: 0, channel: 'Online' }; // what an edit of this fixture must keep
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
    const save = async (name: string, ver: number) =>
      customerPOST(
        await request('/api/customers', U.admin, {
          method: 'POST',
          body: { code: CUSTOMER, name, phone: '02-000-0000', version: ver },
        }),
      );
    assert.equal((await save('ลูกค้า ทดสอบโดเมน', v)).status, 200);
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
      if (e instanceof HttpError) return { status: e.status, fields: (e.details as { fields?: object })?.fields };
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
          channel: 'Online',
          saleOrderDate: '2026-10-01',
          warrantyMonth: 12,
          expireDate: '2027-10-01',
          serial: 'TD-UNKNOWN-LOOKUP',
          brand: 'TD-NOPE-BRAND',
          modelCode: 'TD-NOPE-MODEL',
          symptoms: ['TD-NOPE-SYMPTOM'],
          dueDate: '2026-10-20',
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
      UPDATE sale_out_hd SET delivery_tracking_no = 'TDTRACK1', fee_amount = 50, document_create_by = ${U.inactive.id}
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
        sql`SELECT delivery_tracking_no AS t, fee_amount AS fee, net_amount AS net, document_create_by AS by
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

  console.log('\nProduct-used report — price at issue time, returned parts subtracted');
  await pool.query(`
    INSERT INTO job_order_spare_part_log (job_no, spare_part_code, spare_part_serial_no, stock_id, is_quotation, is_special, request_qty,
                                          spare_part_unit_price, order_status_id, request_date, request_by, grant_qty, return_qty)
      VALUES ('TDJ0010', '${P.a.code}', '', 1, false, true, 2, 80, 3, '2001-03-05', 9101, 2, 1);
    INSERT INTO inventory_hd (inventory_no, inventory_type_id, reference_document_no, create_date, create_by, is_active) VALUES
      ('TDW0001', 3, 'TDJ0010', '2001-03-05', 9101, true),  -- 2 x TDP1 for the job (stored 80, today 100)
      ('TDW0002', 2, 'TDJ0010', '2001-03-06', 9101, true),  -- 1 x TDP1 returned
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
} finally {
  await pool.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
