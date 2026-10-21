/**
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-jobs.mts
 * Jobs + stock regressions found by multi-user QA (2026-10-21): a stale repair page rolling the status back
 * after a stock issue, issued part lines silently left as they were, the partly issued dead end, out-source /
 * swap last-write-wins, the browser's unit price, assigning / closing jobs in any state, search on the
 * customer as they were, reopen keeping the close date, deleted products moving, the track link issued by a GET.
 * Same harness as scripts/test-domain.mts; its own fixtures (ids 985x, codes QJ*, users qj-*), reset at every start.
 */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
Object.assign(process.env, { SESSION_SECRET: 'unit-test-session-secret-0123456789abcdef', DB_POOL_MAX: '25' });

const { db, pool } = await import('@/db/client');
const { HttpError } = await import('@/server/auth');
const { signSession, SESSION_COOKIE } = await import('@/lib/session');
const { nextRunningNo } = await import('@/db/running-no');
const { issueForJob, issueOther, receiveStock, returnFromJob, listReturnableLines } =
  await import('@/server/services/stock');
const {
  assignJobs,
  closeJob,
  getJob,
  saveRepair,
  updateJob,
  saveOutsource,
  saveSwapRefund,
  pageJobs,
  filtersFromQuery,
} = await import('@/server/services/jobs');
const { receiveSchema } = await import('@/lib/validation/stock');
const { addDays, today } = await import('@/lib/dates');
const { GET: trackLinkGET } = await import('@/app/api/jobs/[no]/track-link/route');
const { POST: stockIssuePOST } = await import('@/app/api/stock/issue/route');

// ---- fixtures ----
const U = {
  admin: { id: 9851, email: 'qj-admin@example.invalid', type: 'System Admin' },
  engineer: { id: 9852, email: 'qj-engineer@example.invalid', type: 'Engineer' },
} as const;
type TestUser = (typeof U)[keyof typeof U];
const SV = 3;
const CUSTOMER = 'QJC001';
const P = { pricey: 'QJP1', part: 'QJP2', gone: 'QJP3' }; // ราคาขาย 1200 / 100 / 50 (QJP3 deleted)
const J = (n: number) => `QJJ${String(n).padStart(4, '0')}`;

await pool.query(`
  INSERT INTO inventory_type (inventory_type_id, inventory_type_name, movement_action_type, movement_action, is_active)
    SELECT * FROM (VALUES (1, 'รับเข้า', 'รับเข้า', 1, true), (2, 'รับคืนจากการเบิก', 'รับเข้า', 1, true),
                          (3, 'จ่ายออกตามงานซ่อม', 'จ่ายออก', -1, true), (4, 'จ่ายออกตามใบสั่งขาย', 'จ่ายออก', -1, true),
                          (5, 'จ่ายออกอื่นๆ', 'จ่ายออก', -1, true)) v(id, name, kind, act, on_)
     WHERE NOT EXISTS (SELECT 1 FROM inventory_type t WHERE t.inventory_type_id = v.id);
  INSERT INTO store_location (store_location_id, store_location_name, is_active)
    SELECT * FROM (VALUES (1, 'คลังสินค้าดี', true), (2, 'คลังสินค้าเสีย', true)) v(id, name, on_)
     WHERE NOT EXISTS (SELECT 1 FROM store_location s WHERE s.store_location_id = v.id);
  -- the statuses these flows move a job through (as test-domain seeds them)
  INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
    SELECT * FROM (VALUES (0, 'ยกเลิก', 0, 'Cancel', true), (1, 'รับงานใหม่', 1, 'Open', true), (2, 'กำลังดำเนินการ', 2, 'Open', true),
                          (3, 'อยู่ระหว่างการซ่อม - รออะไหล่', 35, 'Pending', true), (5, 'ซ่อมเสร็จ', 5, 'Repaired', true),
                          (10, 'อยู่ระหว่างการซ่อม - เบิกจ่ายอะไหล่ครบแล้ว', 34, 'Pending', true),
                          (11, 'อยู่ระหว่างการซ่อม - เริ่มเบิกอะไหล่', 33, 'Pending', true),
                          (14, 'อยู่ระหว่างการซ่อม - ส่งซ่อม Out-Source แล้ว', 14, 'Pending', true),
                          (15, 'อยู่ระหว่างการซ่อม - รับคืนจาก Out-Source แล้ว', 15, 'Pending', true),
                          (20, 'ปิดงาน (Complete)', 20, 'Finished', true)) v(id, name, ord, grp, act)
     WHERE NOT EXISTS (SELECT 1 FROM job_status s WHERE s.job_status_id = v.id);
  INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view)
    VALUES ('Engineer', 'Job Take', false, false, false, true)
    ON CONFLICT (user_type, module_name) DO UPDATE SET can_view = true;
  DELETE FROM job_log WHERE job_no LIKE 'QJJ%';
  DELETE FROM job_send_forward_dt WHERE job_no LIKE 'QJJ%';
  DELETE FROM job_order_spare_part_log WHERE job_no LIKE 'QJJ%';
  DELETE FROM job WHERE job_no LIKE 'QJJ%' OR customer_id = 9851;
  DELETE FROM app_user WHERE user_id BETWEEN 9850 AND 9899 OR email_address LIKE 'qj-%@example.invalid';
  INSERT INTO app_user (user_id, first_name, last_name, email_address, user_type, record_status, session_version) VALUES
    ${Object.values(U)
      .map((u) => `(${u.id}, 'QJ', '${u.email.split('@')[0]}', '${u.email}', '${u.type}', 'ACTIVE', ${SV})`)
      .join(', ')};
  DELETE FROM customer WHERE customer_id = 9851 OR customer_code = '${CUSTOMER}';
  INSERT INTO customer (customer_id, customer_code, customer_name, phone_number) VALUES (9851, '${CUSTOMER}', 'ลูกค้า QJ เดิม', '02-985-0001');
  DELETE FROM product_none_serial WHERE product_id IN (9851, 9852, 9853) OR item_id IN (9851, 9852, 9853);
  DELETE FROM product WHERE product_id IN (9851, 9852, 9853) OR product_code IN ('QJP1', 'QJP2', 'QJP3');
  INSERT INTO product (product_id, product_code, product_name, record_status) VALUES
    (9851, 'QJP1', 'อะไหล่ QJ แพง', 'ACTIVE'), (9852, 'QJP2', 'อะไหล่ QJ', 'ACTIVE'), (9853, 'QJP3', 'อะไหล่ QJ ลบแล้ว', 'DELETED');
  INSERT INTO product_none_serial (item_id, product_id, quantity_available, quantity_used, quantity_booking, quantity_remain, retail_price) VALUES
    (9851, 9851, 10, 0, 0, 10, 1200.00), (9852, 9852, 100, 0, 0, 100, 100.00), (9853, 9853, 10, 0, 0, 10, 50.00);
  INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date, job_closed_by, job_repaired_date, record_status)
    SELECT 'QJJ' || lpad(n::text, 4, '0'), s, 9851, '${CUSTOMER} ลูกค้า QJ เดิม 02-985-0001', 'Model QJ', now(), current_date,
           cd::timestamp, cb, '1900-01-01', rs
      FROM (VALUES (1, 11, '1900-01-01', 0, 'ACTIVE'), (2, 10, '1900-01-01', 0, 'ACTIVE'), (3, 11, '1900-01-01', 0, 'ACTIVE'),
                   (4, 11, '1900-01-01', 0, 'ACTIVE'), (5, 2, '1900-01-01', 0, 'ACTIVE'), (6, 2, '1900-01-01', 0, 'ACTIVE'),
                   (7, 2, '1900-01-01', 0, 'ACTIVE'), (8, 20, '2026-10-01', 9851, 'ACTIVE'), (9, 2, '1900-01-01', 0, 'DELETED'),
                   (10, 2, '1900-01-01', 0, 'ACTIVE'), (11, 20, '2026-10-01 10:00', 9851, 'ACTIVE'), (12, 2, '1900-01-01', 0, 'ACTIVE'),
                   (13, 2, '1900-01-01', 0, 'ACTIVE'), (14, 2, '1900-01-01', 0, 'ACTIVE'), (15, 11, '1900-01-01', 0, 'ACTIVE'),
                   (16, 5, '1900-01-01', 0, 'ACTIVE')) v(n, s, cd, cb, rs);
  -- part requests (เบิก A, priced 100, charged): booked as saveRepair would have booked them
  INSERT INTO job_order_spare_part_log (job_no, spare_part_code, spare_part_serial_no, stock_id, is_quotation, is_special, request_qty,
                                        spare_part_unit_price, spare_part_total_price, order_status_id, request_date, request_by, grant_qty, return_qty)
    VALUES ('QJJ0001', 'QJP2', '', 1, true, true, 1, 100, 100, 1, now(), 9851, 0, 0),
           ('QJJ0002', 'QJP2', '', 1, true, true, 2, 100, 200, 3, now(), 9851, 2, 0),
           ('QJJ0003', 'QJP2', '', 1, true, true, 3, 100, 300, 1, now(), 9851, 0, 0),
           ('QJJ0004', 'QJP2', '', 1, true, true, 3, 100, 300, 1, now(), 9851, 0, 0),
           ('QJJ0015', 'QJP3', '', 1, true, true, 1, 50, 50, 1, now(), 9851, 0, 0);
  UPDATE product_none_serial SET quantity_booking = 7 WHERE product_id = 9852;
  UPDATE product_none_serial SET quantity_booking = 1 WHERE product_id = 9853;
`);
// as test-domain: this year's Inventory series past the numbers other suites already used
for (const t of ['Inventory-In', 'Inventory-Out'] as const) await db.transaction((tx) => nextRunningNo(tx, t));
await pool.query(`
  UPDATE running_no r SET number = greatest(r.number, coalesce((
    SELECT max(substring(h.inventory_no FROM length(r.prefix) + 3)::int) FROM inventory_hd h
     WHERE h.inventory_no ~ ('^' || r.prefix || right(r.pyear::text, 2) || '[0-9]+$')), 0))
   WHERE r.running_type IN ('Inventory-In', 'Inventory-Out') AND r.length_year = 2`);

// ---- helpers ----
const one = async <T,>(q: ReturnType<typeof sql>) => (await db.execute<T & Record<string, unknown>>(q)).rows[0]!;
const statusName = async (id: number) =>
  (await one<{ n: string }>(sql`SELECT job_status_name AS n FROM job_status WHERE job_status_id = ${id}`)).n;
const jobRow = (no: string) =>
  one<{
    s: number;
    v: number;
    closed: string;
    closedBy: number;
    repaired: string;
    rb: number;
    hash: string | null;
  }>(sql`
    SELECT job_status_id AS s, row_version AS v, to_char(job_closed_date, 'YYYY-MM-DD HH24:MI') AS closed,
           job_closed_by AS "closedBy", to_char(job_repaired_date, 'YYYY-MM-DD') AS repaired, job_repaired_by AS rb,
           track_token_hash AS hash
      FROM job WHERE job_no = ${no}`);
const line = (no: string) =>
  one<{ id: number; st: number; req: number; got: number; back: number; price: string; total: string }>(sql`
    SELECT job_order_log_id AS id, order_status_id AS st, request_qty AS req, grant_qty AS got, return_qty AS back,
           spare_part_unit_price AS price, spare_part_total_price AS total
      FROM job_order_spare_part_log WHERE job_no = ${no} ORDER BY job_order_log_id DESC LIMIT 1`);
const booking = async (code: string) =>
  (
    await one<{ b: number }>(sql`
      SELECT s.quantity_booking AS b FROM product_none_serial s JOIN product p ON p.product_id = s.product_id
       WHERE p.product_code = ${code}`)
  ).b;
/** the error of a rejected call ({ status: 200 } when it resolved); anything but an HttpError is re-thrown */
async function err(p: Promise<unknown>) {
  try {
    await p;
    return { status: 200, message: '', details: undefined as unknown };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, message: e.message, details: e.details };
    throw e;
  }
}
/** a repair-page part line (แบบ A เบิก + เสนอ) as the page sends it */
const partLine = (code: string, qty: number, logId?: number, unitPrice = 100) => ({
  logId,
  code,
  unitPrice,
  a: { pick: true, quote: true, qty },
  b: { pick: false, quote: false, qty: 0 },
});
async function request(path: string, u: TestUser, init: { method?: string; body?: unknown } = {}) {
  const now = Date.now();
  const cookie = `${SESSION_COOKIE}=${await signSession({ email: u.email, name: u.email, exp: now + 600_000, iat: now, sv: SV })}`;
  return new NextRequest(`https://svc.example.test${path}`, {
    method: init.method ?? 'GET',
    headers: { 'user-agent': 'test-qa-jobs', cookie, ...(init.body ? { 'content-type': 'application/json' } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
/** until `n` backends of this database wait on a lock */
async function lockWaiters(n: number) {
  for (let i = 0; i < 200; i++) {
    const { w } = await one<{ w: number }>(
      sql`SELECT count(*)::int AS w FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (w >= n) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`never saw ${n} lock waiter(s)`);
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

try {
  console.log('\n1 · a stale repair page never rolls the status back after a stock issue');
  await test('issuing the last request moves the job to 10 in the issue transaction; the page loaded before → 409 stale, stays 10', async () => {
    const loaded = (await getJob(J(1)))!; // the engineer's repair page: status 11, version v
    await issueForJob({ jobNo: J(1), lines: [{ logId: (await line(J(1))).id, qty: 1 }] }, U.admin.id);
    assert.equal((await jobRow(J(1))).s, 10, 'เบิกจ่ายอะไหล่ครบแล้ว by the issue itself');
    const r = await err(saveRepair(J(1), { status: loaded.status, version: loaded.version }, U.engineer.id));
    assert.deepEqual([r.status, r.details], [409, { stale: true }]);
    assert.equal((await jobRow(J(1))).s, 10);
  });
  await test('updateJob answers the version its own transaction wrote — not one a save right after it made', async () => {
    const no = J(14);
    const v = (await jobRow(no)).v;
    const holder = await pool.connect(); // holds the job row so both saves queue behind it, ours first
    await holder.query('BEGIN');
    await holder.query('SELECT 1 FROM job WHERE job_no = $1 FOR UPDATE', [no]);
    const edit = { customerCode: CUSTOMER, dueDate: addDays(today(), 30), remark: 'QJ mine', version: v };
    const mine = updateJob(no, edit, U.admin.id);
    await lockWaiters(1);
    const theirs = pool.query(`UPDATE job SET job_remark = 'QJ theirs' WHERE job_no = $1`, [no]);
    await lockWaiters(2);
    await holder.query('COMMIT');
    holder.release();
    const [saved] = await Promise.all([mine, theirs]);
    assert.equal((await jobRow(no)).v, v + 2, 'both saves landed');
    assert.equal(saved.version, v + 1, 'the page adopts its own version: its next save is a 409, not a pass');
  });

  console.log('\n2 · issued part lines are never silently left as they were');
  await test('removing / reducing an issued line → 409 naming the part; line and booking unchanged', async () => {
    const before = await line(J(2));
    const status = (await getJob(J(2)))!.status;
    const removed = await err(saveRepair(J(2), { status, parts: [] }, U.engineer.id));
    assert.equal(removed.status, 409);
    assert.match(removed.message, /QJP2 จ่ายไปแล้ว 2 ชิ้น/);
    const reduced = await err(saveRepair(J(2), { status, parts: [partLine(P.part, 1, before.id)] }, U.engineer.id));
    assert.equal(reduced.status, 409);
    assert.deepEqual(reduced.details, { fields: { 'parts.0.a.qty': reduced.message } });
    assert.deepEqual(await line(J(2)), before);
  });

  console.log('\n3 · a partly issued line: reduce to what was issued, or take the issued pieces back');
  await test('request 3 → issue 1 → reduce to 1: booking released, line issued, the job can be marked repaired', async () => {
    const id = (await line(J(3))).id;
    const b0 = await booking(P.part);
    await issueForJob({ jobNo: J(3), lines: [{ logId: id, qty: 1 }] }, U.admin.id);
    assert.equal(await booking(P.part), b0 - 1);
    const status = (await getJob(J(3)))!.status;
    // more, or its ticks off: the issued piece is stock's — 409, nothing written
    const unticked = { ...partLine(P.part, 1, id), a: { pick: false, quote: true, qty: 1 } };
    for (const parts of [[partLine(P.part, 4, id)], [unticked], []])
      assert.equal((await err(saveRepair(J(3), { status, parts }, U.engineer.id))).status, 409, JSON.stringify(parts));
    assert.equal(await booking(P.part), b0 - 1);
    await saveRepair(J(3), { status, parts: [partLine(P.part, 1, id)] }, U.engineer.id);
    assert.equal(await booking(P.part), b0 - 3, 'the 2 never issued are released');
    const l = await line(J(3));
    assert.deepEqual([l.st, l.req, l.got, l.total], [3, 1, 1, '100.00']);
    assert.equal((await getJob(J(3)))!.partsCost, 100);
    await saveRepair(J(3), { status: await statusName(5), parts: [partLine(P.part, 1, id)] }, U.engineer.id);
    assert.equal((await jobRow(J(3))).s, 5);
  });
  await test('stock takes back an issued piece of a partly issued line (it stays รอเบิก for the rest)', async () => {
    const id = (await line(J(4))).id;
    await issueForJob({ jobNo: J(4), lines: [{ logId: id, qty: 1 }] }, U.admin.id);
    assert.deepEqual(
      (await listReturnableLines(J(4))).map((r) => [r.logId, r.returnable]),
      [[id, 1]],
    );
    await returnFromJob({ jobNo: J(4), lines: [{ logId: id, qty: 1 }] }, U.admin.id);
    const l = await line(J(4));
    assert.deepEqual([l.st, l.req, l.got, l.back], [1, 3, 1, 1]);
  });

  console.log('\n4 · out-source and swap/refund refuse a stale page');
  await test('out-source send with a stale version → 409 stale; the first save stands', async () => {
    const v = (await jobRow(J(5))).v;
    const status = await statusName(14);
    const send = (to: string) => ({ status, send: { to, date: today(), by: U.admin.id }, version: v });
    await saveOutsource(J(5), send('QJ Vendor A'), U.admin.id);
    const r = await err(saveOutsource(J(5), send('QJ Vendor B'), U.admin.id));
    assert.deepEqual([r.status, r.details], [409, { stale: true }]);
    assert.deepEqual(
      (await getJob(J(5)))!.outsource.map((o) => o.sendTo),
      ['QJ Vendor A'],
    );
  });
  await test('swap / refund with a stale version → 409 stale; the first save stands', async () => {
    const v = (await jobRow(J(6))).v;
    const status = (await getJob(J(6)))!.status;
    await saveSwapRefund(J(6), { status, newSerial: 'QJSN0001', version: v }, U.admin.id);
    const r = await err(saveSwapRefund(J(6), { status, newSerial: 'QJSN0002', version: v }, U.admin.id));
    assert.deepEqual([r.status, r.details], [409, { stale: true }]);
    assert.match((await getJob(J(6)))!.swap.detail, /QJSN0001/);
  });

  console.log("\n5 · the unit price is never the browser's");
  await test("a new line takes the part's ราคาขาย (1200, page sent 1); a stored line keeps its own price", async () => {
    const status = (await getJob(J(7)))!.status;
    await saveRepair(J(7), { status, parts: [partLine(P.pricey, 1, undefined, 1)] }, U.engineer.id);
    let l = await line(J(7));
    assert.deepEqual([l.price, l.total], ['1200.00', '1200.00']);
    assert.equal((await getJob(J(7)))!.partsCost, 1200);
    await saveRepair(J(7), { status, parts: [partLine(P.pricey, 2, l.id, 5)] }, U.engineer.id);
    l = await line(J(7));
    assert.deepEqual([l.price, l.req, l.total], ['1200.00', 2, '2400.00']);
  });

  console.log('\n6 · assign refuses closed / deleted / unknown jobs');
  await test('a closed job → 409, a deleted one → 409, an unknown job no → 404; nobody assigned', async () => {
    assert.equal((await err(assignJobs([J(8)], U.engineer.id, U.admin.id))).status, 409);
    assert.equal((await err(assignJobs([J(9)], U.engineer.id, U.admin.id))).status, 409);
    assert.equal((await err(assignJobs(['QJJ9999'], U.engineer.id, U.admin.id))).status, 404);
    const { n } = await one<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM job WHERE job_no IN (${J(8)}, ${J(9)}) AND engineer_id = ${U.engineer.id}`,
    );
    assert.equal(n, 0);
  });

  console.log('\n7 · ปิดงาน closes only what its job search offers');
  const close = async () => ({
    status: await statusName(20),
    payment: { type: 'เงินสด' },
    return: { type: 'รับเอง', date: today() },
  });
  await test('an in-progress job → 409, not closed, nobody stamped as repairer; a repaired one closes', async () => {
    const r = await err(closeJob(J(10), await close(), U.admin.id));
    assert.equal(r.status, 409);
    const j = await jobRow(J(10));
    assert.deepEqual([j.s, j.repaired], [2, '1900-01-01']);
    await closeJob(J(16), await close(), U.admin.id);
    assert.equal((await jobRow(J(16))).s, 20);
  });

  console.log('\n9 · the job list finds the customer by their CURRENT name / phone');
  await test("after the customer's phone and name change, both find the job (the opening snapshot still does too)", async () => {
    await db.execute(
      sql`UPDATE customer SET customer_name = 'ลูกค้า QJ ชื่อใหม่', phone_number = '089-985-7777' WHERE customer_id = 9851`,
    );
    const found = async (q: string, f: Record<string, string> = {}) =>
      (await pageJobs({ page: 1, pageSize: 100, q, f: {} }, filtersFromQuery(f))).rows.some((r) => r.no === J(13));
    assert.ok(await found('0899857777'), 'search box: new phone as digits');
    assert.ok(await found('QJ ชื่อใหม่'), 'search box: new name');
    assert.ok(await found('', { phone: '089-985-7777' }), 'phone filter');
    assert.ok(await found('', { customer: 'ชื่อใหม่' }), 'customer filter');
    assert.ok(await found('029850001'), 'the phone as it was at opening');
  });

  console.log('\n10 · reopening a closed job clears its close date');
  await test('Finished → ซ่อมเสร็จ: job_closed_date back to 1900, closer 0, both in the STATUS history row', async () => {
    await saveRepair(J(11), { status: await statusName(5) }, U.admin.id);
    const j = await jobRow(J(11));
    assert.deepEqual([j.s, j.closed, j.closedBy], [5, '1900-01-01 00:00', 0]);
    const { c } = await one<{ c: Record<string, unknown> }>(
      sql`SELECT changes AS c FROM audit_log WHERE entity = 'job' AND entity_key = ${J(11)} AND action = 'STATUS' ORDER BY id DESC LIMIT 1`,
    );
    assert.deepEqual(c.jobClosedBy, [U.admin.id, 0]);
    assert.ok(Array.isArray(c.jobClosedDate));
  });

  console.log('\n11 · stock: deleted products, real on-hand, named parts, sane dates');
  await test('the multi-line shortage names the on-hand, not what an earlier line left in memory', async () => {
    const r = await err(
      issueOther(
        {
          payTo: 'QJ',
          lines: [
            { code: P.pricey, qty: 6 },
            { code: P.pricey, qty: 6 },
          ],
        },
        U.admin.id,
      ),
    );
    assert.deepEqual([r.status, r.message], [409, `สต๊อก ${P.pricey} ไม่พอ (คงเหลือ 10)`]);
  });
  await test('a deleted product: receive / issue / new request / issue of its old request → 409 naming it', async () => {
    const logId = (await line(J(15))).id;
    const status = await statusName(2);
    for (const call of [
      () => receiveStock({ date: today(), lines: [{ code: P.gone, qty: 1 }] }, U.admin.id),
      () => issueOther({ payTo: 'QJ', lines: [{ code: P.gone, qty: 1 }] }, U.admin.id),
      () => saveRepair(J(12), { status, parts: [partLine(P.gone, 1)] }, U.engineer.id),
      () => issueForJob({ jobNo: J(15), lines: [{ logId, qty: 1 }] }, U.admin.id),
    ]) {
      const r = await err(call());
      assert.equal(r.status, 409, r.message);
      assert.match(r.message, /QJP3 ถูกยกเลิกแล้ว/);
    }
  });
  await test('issuing a line already issued → 409 naming the part (not "#<id>")', async () => {
    const r = await err(issueForJob({ jobNo: J(2), lines: [{ logId: (await line(J(2))).id, qty: 1 }] }, U.admin.id));
    assert.equal(r.status, 409);
    assert.match(r.message, /^QJP2 /);
  });
  await test('รับเข้า more than a year back → refused by the form rules', async () => {
    const lines = [{ code: P.part, qty: 1 }];
    assert.equal(receiveSchema.safeParse({ date: addDays(today(), -400), lines }).success, false);
    assert.equal(receiveSchema.safeParse({ date: addDays(today(), -30), lines }).success, true);
  });
  await test('จ่ายออกอื่นๆ to the source store (คลังสินค้าดี) → 400 under payTo', async () => {
    const r = await stockIssuePOST(
      await request('/api/stock/issue', U.admin, {
        method: 'POST',
        body: { type: 'other', payTo: 'คลังสินค้าดี', lines: [{ code: P.part, qty: 1 }] },
      }),
    );
    assert.equal(r.status, 400);
    assert.ok(((await r.json()) as { details: { fields: object } }).details.fields.hasOwnProperty('payTo'));
  });

  console.log('\n12 · opening a job page never issues a tracking link');
  await test('GET track-link (Job Management edit) → url "", no link stored, no audit row', async () => {
    const audits = async () =>
      (
        await one<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM audit_log WHERE entity = 'job' AND entity_key = ${J(12)} AND summary LIKE 'ออกลิงก์%'`,
        )
      ).n;
    const n0 = await audits();
    const r = await trackLinkGET(await request(`/api/jobs/${J(12)}/track-link`, U.admin), {
      params: Promise.resolve({ no: J(12) }),
    });
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as { url: string }).url, '');
    assert.equal((await jobRow(J(12))).hash, null);
    assert.equal(await audits(), n0);
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
