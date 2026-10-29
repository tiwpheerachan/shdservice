/**
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-atomic.mts
 * Real-use QA (2026-10-21): บันทึกซ่อม / ปิดงาน / Out-Source / Swap-Refund saved the shared job sections with a
 * PATCH first, so a refused action still saved them (J2612264: service cost 0→250 while the part change was
 * refused). Now the action takes them as `job`, in its own transaction. Also: the parts-driven statuses (11 ⇄ 10)
 * follow the part lines, part / tracking-link wording, the job list showing the customer as they are now.
 * Same harness as scripts/test-qa-jobs.mts; its own fixtures (ids 986x, codes QAT*, users qat-*), reset at every start.
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
const { closeJob, getJob, saveRepair, saveOutsource, saveSwapRefund, pageJobs, listJobs, filtersFromQuery } =
  await import('@/server/services/jobs');
const { addDays, today } = await import('@/lib/dates');
const { POST: repairPOST } = await import('@/app/api/jobs/[no]/repair/route');
const { POST: trackLinkPOST } = await import('@/app/api/jobs/[no]/track-link/route');

// ---- fixtures ----
const U = {
  admin: { id: 9861, email: 'qat-admin@example.invalid', type: 'System Admin' },
  repairer: { id: 9862, email: 'qat-repairer@example.invalid', type: 'QAT Repairer' }, // Job Repair edit only
} as const;
type TestUser = (typeof U)[keyof typeof U];
const SV = 3;
const CUSTOMER = 'QATC01';
const PART = 'QATP1'; // ราคาขาย 100
const J = (n: number) => `QAT${String(n).padStart(4, '0')}`;

await pool.query(`
  INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
    SELECT * FROM (VALUES (0, 'ยกเลิก', 0, 'Cancel', true), (1, 'รับงานใหม่', 1, 'Open', true), (2, 'กำลังดำเนินการ', 2, 'Open', true),
                          (3, 'อยู่ระหว่างการซ่อม - รออะไหล่', 35, 'Pending', true), (5, 'ซ่อมเสร็จ', 5, 'Repaired', true),
                          (10, 'อยู่ระหว่างการซ่อม - เบิกจ่ายอะไหล่ครบแล้ว', 34, 'Pending', true),
                          (11, 'อยู่ระหว่างการซ่อม - เริ่มเบิกอะไหล่', 33, 'Pending', true),
                          (14, 'อยู่ระหว่างการซ่อม - ส่งซ่อม Out-Source แล้ว', 14, 'Pending', true),
                          (15, 'อยู่ระหว่างการซ่อม - รับคืนจาก Out-Source แล้ว', 15, 'Pending', true),
                          (20, 'ปิดงาน (Complete)', 20, 'Finished', true)) v(id, name, ord, grp, act)
     WHERE NOT EXISTS (SELECT 1 FROM job_status s WHERE s.job_status_id = v.id);
  DELETE FROM app_config WHERE user_type = 'QAT Repairer';
  INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view)
    VALUES ('QAT Repairer', 'Job Repair', true, true, false, true), ('QAT Repairer', 'Job Management', false, false, false, true);
  DELETE FROM job_log WHERE job_no LIKE 'QAT%';
  DELETE FROM job_send_forward_dt WHERE job_no LIKE 'QAT%';
  DELETE FROM job_order_spare_part_log WHERE job_no LIKE 'QAT%';
  DELETE FROM job WHERE job_no LIKE 'QAT%' OR customer_id = 9861;
  DELETE FROM app_user WHERE user_id BETWEEN 9860 AND 9869 OR email_address LIKE 'qat-%@example.invalid';
  INSERT INTO app_user (user_id, first_name, last_name, email_address, user_type, record_status, session_version) VALUES
    ${Object.values(U)
      .map((u) => `(${u.id}, 'QAT', '${u.email.split('@')[0]}', '${u.email}', '${u.type}', 'ACTIVE', ${SV})`)
      .join(', ')};
  DELETE FROM customer WHERE customer_id = 9861 OR customer_code = '${CUSTOMER}';
  INSERT INTO customer (customer_id, customer_code, customer_name, phone_number) VALUES (9861, '${CUSTOMER}', 'ลูกค้า QAT เดิม', '02-986-0001');
  DELETE FROM product_none_serial WHERE product_id = 9861 OR item_id = 9861;
  DELETE FROM product WHERE product_id = 9861 OR product_code = '${PART}';
  INSERT INTO product (product_id, product_code, product_name, record_status) VALUES (9861, '${PART}', 'อะไหล่ QAT', 'ACTIVE');
  INSERT INTO product_none_serial (item_id, product_id, quantity_available, quantity_used, quantity_booking, quantity_remain, retail_price)
    VALUES (9861, 9861, 100, 0, 0, 100, 100.00);
  INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date,
                   job_closed_date, job_closed_by, job_repaired_date, record_status, service_cost, spare_part_total_cost, job_total_cost, job_remark)
    SELECT 'QAT' || lpad(n::text, 4, '0'), s, 9861, '${CUSTOMER} ลูกค้า QAT เดิม 02-986-0001', 'Model QAT', now(), current_date,
           '1900-01-01', 0, '1900-01-01', 'ACTIVE', 0, p, p, 'QAT เดิม'
      FROM (VALUES (1, 10, 100), (2, 10, 100), (3, 2, 0), (4, 5, 0), (5, 14, 0), (6, 2, 0), (7, 2, 100), (8, 2, 0),
                   (11, 11, 300), (12, 10, 100), (13, 10, 100), (14, 5, 100), (15, 11, 100), (16, 11, 300), (17, 2, 0),
                   (18, 2, 0)) v(n, s, p);
  INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, record_status)
    VALUES ('${J(19)}', 2, NULL, 'หน้าร้าน QAT 02-986-0019', 'Model QAT', now(), current_date, 'ACTIVE');
  -- part lines (เบิก A, 100 each): 3 = issued in full (1 of 1), 1 = requested (partly issued when grant > 0)
  INSERT INTO job_order_spare_part_log (job_no, spare_part_code, spare_part_serial_no, stock_id, is_quotation, is_special, request_qty,
                                        spare_part_unit_price, spare_part_total_price, order_status_id, request_date, request_by, grant_qty, return_qty)
    VALUES ('${J(1)}', '${PART}', '', 1, true, true, 1, 100, 100, 3, now(), 9861, 1, 0),
           ('${J(2)}', '${PART}', '', 1, true, true, 1, 100, 100, 3, now(), 9861, 1, 0),
           ('${J(7)}', '${PART}', '', 1, true, true, 1, 100, 100, 1, now(), 9861, 0, 0),
           ('${J(11)}', '${PART}', '', 1, true, true, 3, 100, 300, 1, now(), 9861, 1, 0),
           ('${J(12)}', '${PART}', '', 1, true, true, 1, 100, 100, 3, now(), 9861, 1, 0),
           ('${J(13)}', '${PART}', '', 1, true, true, 1, 100, 100, 3, now(), 9861, 1, 0),
           ('${J(14)}', '${PART}', '', 1, true, true, 1, 100, 100, 3, now(), 9861, 1, 0),
           ('${J(15)}', '${PART}', '', 1, true, true, 1, 100, 100, 1, now(), 9861, 0, 0),
           ('${J(16)}', '${PART}', '', 1, true, true, 3, 100, 300, 1, now(), 9861, 1, 0);
  UPDATE product_none_serial SET quantity_booking = 6 WHERE product_id = 9861;
  -- QAT0005 is out at a vendor since today
  INSERT INTO job_send_forward_dt (job_no, send_to_name, send_detail, send_date, send_by, receive_date, receive_by, receive_detail, send_status)
    VALUES ('${J(5)}', 'QAT Vendor', '', current_date, 9861, '1900-01-01', -1, '', 'ส่งเครื่องซ่อมแล้ว');
`);

// ---- helpers ----
const one = async <T,>(q: ReturnType<typeof sql>) => (await db.execute<T & Record<string, unknown>>(q)).rows[0]!;
const statusName = async (id: number) =>
  (await one<{ n: string }>(sql`SELECT job_status_name AS n FROM job_status WHERE job_status_id = ${id}`)).n;
const jobRow = (no: string) =>
  one<{ s: number; v: number; service: string; total: string; remark: string; swap: string | null }>(sql`
    SELECT job_status_id AS s, row_version AS v, service_cost AS service, job_total_cost AS total, job_remark AS remark,
           swap_refund_detail AS swap
      FROM job WHERE job_no = ${no}`);
const audits = async (no: string) =>
  (await one<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_log WHERE entity = 'job' AND entity_key = ${no}`))
    .n;
const line = (no: string) =>
  one<{ id: number; st: number; req: number; got: number }>(sql`
    SELECT job_order_log_id AS id, order_status_id AS st, request_qty AS req, grant_qty AS got
      FROM job_order_spare_part_log WHERE job_no = ${no} ORDER BY job_order_log_id DESC LIMIT 1`);
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
const partLine = (qty: number, logId?: number) => ({
  logId,
  code: PART,
  unitPrice: 100,
  a: { pick: true, quote: true, qty },
  b: { pick: false, quote: false, qty: 0 },
});
/** the page's shared job sections (commonSections): service cost 250 + a remark */
const common = (remark: string) => ({
  customerCode: CUSTOMER,
  dueDate: addDays(today(), 30),
  remark,
  serviceCost: 250,
});
async function request(path: string, u: TestUser, init: { method?: string; body?: unknown } = {}) {
  const now = Date.now();
  const cookie = `${SESSION_COOKIE}=${await signSession({ email: u.email, name: u.email, exp: now + 600_000, iat: now, sv: SV })}`;
  return new NextRequest(`https://svc.example.test${path}`, {
    method: init.method ?? 'GET',
    headers: { 'user-agent': 'test-qa-atomic', cookie, ...(init.body ? { 'content-type': 'application/json' } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
/** a refused save: nothing of it is stored — the job row (fields + version) and its history as they were */
async function nothingSaved(no: string, save: () => Promise<unknown>, status: number) {
  const [row, n] = [await jobRow(no), await audits(no)];
  const r = await err(save());
  assert.equal(r.status, status, r.message);
  assert.deepEqual(await jobRow(no), row, 'job fields unchanged');
  assert.equal(await audits(no), n, 'no history row');
  return r;
}
/** a valid save: both parts stored, the answer carries the version the transaction wrote; the old one is stale */
async function bothSaved(no: string, save: (version: number) => Promise<{ version: number }>) {
  const v0 = (await jobRow(no)).v;
  const saved = await save(v0);
  const row = await jobRow(no);
  assert.equal(row.service, '250.00');
  assert.equal(row.remark, `QAT ${no}`);
  assert.ok(row.v > v0);
  assert.equal(saved.version, row.v, 'the version this save wrote');
  assert.deepEqual((await err(save(v0))).details, { stale: true }, 'the page loaded before it → 409 stale');
  return row;
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
  console.log("\n1 · a workflow page's save is ONE operation: refused → none of it saved");
  await test('บันทึกซ่อม removing an issued line (409) + service cost 250 → cost, remark, history unchanged (J2612264)', async () => {
    const no = J(1);
    const { status, version } = (await getJob(no))!;
    await nothingSaved(
      no,
      () => saveRepair(no, { status, serviceCost: 250, parts: [], job: common(`QAT ${no}`), version }, U.admin.id),
      409,
    );
  });
  await test('บันทึกซ่อม valid: the job sections + the repair saved together; total = parts + cost', async () => {
    const no = J(2);
    const { status } = (await getJob(no))!;
    const id = (await line(no)).id;
    const row = await bothSaved(no, (version) =>
      saveRepair(
        no,
        { status, serviceCost: 250, parts: [partLine(1, id)], job: common(`QAT ${no}`), version },
        U.admin.id,
      ),
    );
    assert.equal(row.total, '350.00');
  });
  const close = async () => ({
    status: await statusName(20),
    payment: { type: 'เงินสด' },
    return: { type: 'รับเอง', date: today() },
  });
  await test('ปิดงาน on an in-progress job (409 not closable) → the job sections not saved either', async () => {
    const no = J(3);
    const r = await nothingSaved(
      no,
      async () => closeJob(no, { ...(await close()), job: common(`QAT ${no}`) }, U.admin.id),
      409,
    );
    assert.match(r.message, /ปิดงานได้เมื่อซ่อมเสร็จ/);
  });
  await test('ปิดงาน valid: closed with the job sections', async () => {
    const no = J(4);
    const c = await close();
    await bothSaved(no, (version) => closeJob(no, { ...c, job: common(`QAT ${no}`), version }, U.admin.id));
    assert.equal((await jobRow(no)).s, 20);
  });
  await test('Out-Source receive dated before the send (400) → the job sections not saved either', async () => {
    const no = J(5);
    const receive = { date: addDays(today(), -1), by: U.admin.id };
    const status = await statusName(15);
    await nothingSaved(no, () => saveOutsource(no, { status, receive, job: common(`QAT ${no}`) }, U.admin.id), 400);
  });
  await test('Out-Source valid: sent with the job sections', async () => {
    const no = J(6);
    const status = await statusName(14);
    const send = { to: 'QAT Vendor', date: today(), by: U.admin.id };
    let first = true;
    await bothSaved(no, (version) => {
      // the second (stale) try sends again to another vendor — a new trip, not "the same row saved again"
      const s = first ? send : { ...send, to: 'QAT Vendor 2' };
      first = false;
      return saveOutsource(no, { status, send: s, job: common(`QAT ${no}`), version }, U.admin.id);
    });
    assert.equal((await jobRow(no)).s, 14);
  });
  await test('Swap whose New S/N does not fit the part list (400, in the transaction) → swap + job sections not saved', async () => {
    const no = J(7);
    // the Swap page offers ซ่อมเสร็จ no more (17 / 18 only): the refusal after the job sections is a full part list
    await db.execute(sql`UPDATE job SET spare_part_replace = ${'ก'.repeat(295)} WHERE job_no = ${no}`);
    const { status } = (await getJob(no))!;
    const r = await nothingSaved(
      no,
      () => saveSwapRefund(no, { status, newSerial: 'QATSN7', job: common(`QAT ${no}`) }, U.admin.id),
      400,
    );
    assert.match(r.message, /300 ตัวอักษร/);
  });
  await test('Swap valid: the swap + the job sections saved together', async () => {
    const no = J(8);
    const { status } = (await getJob(no))!;
    await bothSaved(no, (version) =>
      saveSwapRefund(no, { status, newSerial: 'QATSN8', job: common(`QAT ${no}`), version }, U.admin.id),
    );
    assert.match((await jobRow(no)).swap ?? '', /QATSN8/);
  });
  await test('the job sections need Job Management edit: Job Repair only → 403 with `job`, 200 without', async () => {
    const no = J(17);
    const { status, version } = (await getJob(no))!;
    const post = async (body: object) =>
      repairPOST(await request(`/api/jobs/${no}/repair`, U.repairer, { method: 'POST', body }), {
        params: Promise.resolve({ no }),
      });
    const n = await audits(no);
    assert.equal((await post({ status, job: common(`QAT ${no}`), version })).status, 403);
    assert.equal(await audits(no), n);
    assert.equal((await post({ status, repairDetail: 'QAT ซ่อม', version })).status, 200);
  });

  console.log('\n2 · the parts-driven statuses follow the part lines (11 ⇄ 10)');
  await test('11, a partly issued line lowered to the issued qty (all issued now) → 10', async () => {
    const no = J(11);
    const { status } = (await getJob(no))!;
    await saveRepair(no, { status, parts: [partLine(1, (await line(no)).id)] }, U.admin.id);
    assert.equal((await jobRow(no)).s, 10);
  });
  await test('10, a new part request added → 11', async () => {
    const no = J(12);
    const { status } = (await getJob(no))!;
    await saveRepair(no, { status, parts: [partLine(1, (await line(no)).id), partLine(1)] }, U.admin.id);
    assert.equal((await jobRow(no)).s, 11);
  });
  await test('a status the user picked in this save wins (10 + new request, picked กำลังดำเนินการ → 2)', async () => {
    const no = J(13);
    const status = await statusName(2);
    await saveRepair(no, { status, parts: [partLine(1, (await line(no)).id), partLine(1)] }, U.admin.id);
    assert.equal((await jobRow(no)).s, 2);
  });
  await test('a later-stage status stays (ซ่อมเสร็จ + new request → 5)', async () => {
    const no = J(14);
    const { status } = (await getJob(no))!;
    await saveRepair(no, { status, parts: [partLine(1, (await line(no)).id), partLine(1)] }, U.admin.id);
    assert.equal((await jobRow(no)).s, 5);
  });
  await test('11, its only request cancelled before anything went out → back to 2 กำลังดำเนินการ (QA re-test)', async () => {
    const no = J(15);
    const { status } = (await getJob(no))!;
    await saveRepair(no, { status, parts: [] }, U.admin.id);
    assert.equal((await jobRow(no)).s, 2);
  });

  console.log('\n3 · wording');
  await test('a partly issued line at qty 0 → its minimum is the issued qty; raised → add a new line', async () => {
    const no = J(16);
    const { status } = (await getJob(no))!;
    const id = (await line(no)).id;
    const zero = await err(saveRepair(no, { status, parts: [partLine(0, id)] }, U.admin.id));
    assert.equal(zero.status, 400);
    assert.match((zero.details as { fields: Record<string, string> }).fields['parts.0.a.qty']!, /จำนวนต่ำสุดคือ 1/);
    const more = await err(saveRepair(no, { status, parts: [partLine(4, id)] }, U.admin.id));
    assert.equal(more.status, 409);
    assert.match(more.message, /เพิ่มเป็นรายการใหม่/);
  });
  await test('the first tracking link is not logged as replacing one; the next one is', async () => {
    const no = J(18);
    const issue = async () =>
      (
        await trackLinkPOST(await request(`/api/jobs/${no}/track-link`, U.admin, { method: 'POST' }), {
          params: Promise.resolve({ no }),
        })
      ).status;
    const last = async () =>
      (
        await one<{ s: string }>(
          sql`SELECT summary AS s FROM audit_log WHERE entity = 'job' AND entity_key = ${no} ORDER BY id DESC LIMIT 1`,
        )
      ).s;
    assert.equal(await issue(), 200);
    assert.doesNotMatch(await last(), /ลิงก์เดิม|ใหม่/);
    assert.equal(await issue(), 200);
    assert.match(await last(), /ลิงก์เดิมใช้ไม่ได้แล้ว/);
  });

  console.log('\n4 · the job list (and its export) shows the customer as they are now');
  await test('after the customer is renamed: list + export show the new name / phone; a walk-in keeps its text', async () => {
    await db.execute(
      sql`UPDATE customer SET customer_name = 'ลูกค้า QAT ชื่อใหม่', phone_number = '089-986-7777' WHERE customer_id = 9861`,
    );
    const now = `${CUSTOMER} ลูกค้า QAT ชื่อใหม่ 089-986-7777`;
    const page = async (q: string) =>
      (await pageJobs({ page: 1, pageSize: 10, q, f: {} }, filtersFromQuery({}))).rows.find((r) => r.no === q)
        ?.customer;
    assert.equal(await page(J(18)), now);
    assert.equal((await listJobs({ q: J(18) })).find((r) => r.no === J(18))?.customer, now);
    assert.equal(await page(J(19)), 'หน้าร้าน QAT 02-986-0019');
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
