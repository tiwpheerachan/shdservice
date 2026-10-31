/**
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-race-services.mts
 * Check-then-act races: a check that ran before its write's transaction let a delete commit in
 * between (job / quotation / sale order on a deleted customer, job given to a deactivated engineer;
 * quotation on a deleted job; request for a deleted product; an attachment deleted twice; an attachment
 * stored on a job deleted during the upload). A second DB session ("blocker") pins the request between its check
 * and its write — the window a concurrent user's commit falls into in production.
 * Its own fixtures (ids 987x, codes QRS*, users qrs-*), reset at every start.
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { NextRequest } from 'next/server';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
const STORAGE = 'http://storage.qrs.test';
Object.assign(process.env, {
  SESSION_SECRET: 'unit-test-session-secret-0123456789abcdef',
  DB_POOL_MAX: '20',
  NEXT_PUBLIC_SUPABASE_URL: STORAGE,
  SUPABASE_SECRET_KEY: 'qrs-fake-key',
});

// fake storage: a Set of paths; an upload waits for `uploadGate` (the window a delete falls into)
const stored = new Set<string>();
let uploadGate: Promise<void> = Promise.resolve();
let uploadStarted: () => void = () => {};
const { BUCKET } = await import('@/server/storage');
const objects = `${STORAGE}/storage/v1/object/${BUCKET}`;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = init?.method ?? 'GET';
  if (url === `${STORAGE}/storage/v1/bucket`) return Response.json({ name: BUCKET });
  if (method === 'POST' && url.startsWith(`${objects}/`)) {
    uploadStarted();
    await uploadGate;
    const path = decodeURIComponent(url.slice(objects.length + 1));
    stored.add(path);
    return Response.json({ Key: `${BUCKET}/${path}` });
  }
  if (method === 'DELETE' && url === objects) {
    for (const p of (JSON.parse(String(init?.body)) as { prefixes: string[] }).prefixes) stored.delete(p);
    return Response.json([]);
  }
  return new Response('', { status: 404 });
}) as typeof fetch;

const { pool } = await import('@/db/client');
const { HttpError } = await import('@/server/auth');
const { signSession, SESSION_COOKIE } = await import('@/lib/session');
const { thaiYear } = await import('@/server/mappers/format');
const { createJob, updateJob, assignJobs, saveRepair } = await import('@/server/services/jobs');
const { saveQuotation } = await import('@/server/services/quotations');
const { saveSaleOrder } = await import('@/server/services/sale-orders');
const { setRecordStatus } = await import('@/server/services/records');
const { addDays, today } = await import('@/lib/dates');
const attachRoute = await import('@/app/api/attachments/route');
const attachIdRoute = await import('@/app/api/attachments/[id]/route');

const ADMIN = { id: 9871, email: 'qrs-admin@example.invalid' };
const ENG = 9872; // role QRS Engineer (Job Take)
const SV = 3;
const CUST = 'QRSC01';
const PART = 'QRSP1';
const J = (n: number) => `QRS${String(n).padStart(4, '0')}`;
const QJOB = 'J9987001'; // a quotation's job no is J + 7 digits

await pool.query(`
  INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
    SELECT * FROM (VALUES (0, 'ยกเลิก', 0, 'Cancel', true), (1, 'รับงานใหม่', 1, 'Open', true), (2, 'กำลังดำเนินการ', 2, 'Open', true),
                          (3, 'อยู่ระหว่างการซ่อม - รออะไหล่', 35, 'Pending', true),
                          (4, 'อยู่ระหว่างการซ่อม - เสนอราคาลูกค้า', 37, 'Pending', true),
                          (12, 'อยู่ระหว่างการซ่อม - ลูกค้าตกลงซ่อม', 38, 'Pending', true),
                          (13, 'อยู่ระหว่างการซ่อม - รอเสนอราคา', 36, 'Pending', true),
                          (10, 'อยู่ระหว่างการซ่อม - เบิกจ่ายอะไหล่ครบแล้ว', 34, 'Pending', true),
                          (11, 'อยู่ระหว่างการซ่อม - เริ่มเบิกอะไหล่', 33, 'Pending', true),
                          (20, 'ปิดงาน (Complete)', 20, 'Finished', true)) v(id, name, ord, grp, act)
     WHERE NOT EXISTS (SELECT 1 FROM job_status s WHERE s.job_status_id = v.id);
  INSERT INTO quotation_status (quotation_status_id, quotation_status_name)
    SELECT * FROM (VALUES (1, 'รอเสนอราคา'), (2, 'เสนอราคาแล้ว'), (3, 'ลูกค้าตกลงซ่อม'), (4, 'ลูกค้าไม่ตกลงซ่อม'),
                          (5, 'ยกเลิกใบเสนอราคา')) v(id, name)
     WHERE NOT EXISTS (SELECT 1 FROM quotation_status s WHERE s.quotation_status_id = v.id);
  -- code tables a part line / sale order points at (foreign keys, drizzle/0006)
  INSERT INTO job_part_status (job_part_status_id, job_part_status_name)
    SELECT * FROM (VALUES (1, 'เบิก'), (2, 'ขอคืน'), (3, 'จ่ายแล้ว'), (4, 'ยกเลิก'), (5, 'คืนแล้ว')) v(id, name)
     WHERE NOT EXISTS (SELECT 1 FROM job_part_status s WHERE s.job_part_status_id = v.id);
  INSERT INTO approve_status (approve_status_id, approve_name_th)
    SELECT * FROM (VALUES (1, 'กำลังดำเนินการจัดทำ'), (2, 'รออนุมัติ'), (3, 'แก้ไขข้อมูล'), (4, 'อนุมัติแล้ว'), (5, 'ปฏิเสธ')) v(id, name)
     WHERE NOT EXISTS (SELECT 1 FROM approve_status s WHERE s.approve_status_id = v.id);
  INSERT INTO store_location (store_location_id, store_location_name, is_active)
    SELECT * FROM (VALUES (1, 'คลังสินค้าดี', true), (2, 'คลังสินค้าเสีย', true)) v(id, name, on_)
     WHERE NOT EXISTS (SELECT 1 FROM store_location s WHERE s.store_location_id = v.id);
  INSERT INTO condition (condition_id, condition_name, is_active)
    SELECT 1, 'สินค้าใหม่', true WHERE NOT EXISTS (SELECT 1 FROM condition WHERE condition_id = 1);
  INSERT INTO job_type (job_type_name, record_status) SELECT 'QRS งานซ่อม', 'ACTIVE'
     WHERE NOT EXISTS (SELECT 1 FROM job_type WHERE job_type_name = 'QRS งานซ่อม');
  INSERT INTO brand (brand_name, record_status) SELECT 'QRS', 'ACTIVE'
     WHERE NOT EXISTS (SELECT 1 FROM brand WHERE brand_name = 'QRS');
  INSERT INTO model (model_code, model_name, brand_pk, record_status)
    SELECT 'QRS', 'QRS', (SELECT min(pk) FROM brand WHERE brand_name = 'QRS'), 'ACTIVE'
     WHERE NOT EXISTS (SELECT 1 FROM model WHERE model_code = 'QRS');
  INSERT INTO symptom (symptom_name, record_status) SELECT 'QRS', 'ACTIVE'
     WHERE NOT EXISTS (SELECT 1 FROM symptom WHERE symptom_name = 'QRS');
  DELETE FROM role_permission WHERE user_type = 'QRS Engineer';
  INSERT INTO role_permission (user_type, module_name, can_insert, can_edit, can_delete, can_view)
    VALUES ('QRS Engineer', 'Job Take', false, false, false, true);
  -- the users stay (audit_log, append-only, points at them): upserted at their fixed pk
  INSERT INTO app_user (pk, first_name, last_name, email_address, user_type, record_status, session_version)
  OVERRIDING SYSTEM VALUE VALUES
    (${ADMIN.id}, 'QRS', 'admin', '${ADMIN.email}', 'System Admin', 'ACTIVE', ${SV}),
    (${ENG}, 'QRS', 'engineer', 'qrs-eng@example.invalid', 'QRS Engineer', 'ACTIVE', ${SV})
  ON CONFLICT (pk) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
    email_address = excluded.email_address, user_type = excluded.user_type, record_status = excluded.record_status,
    session_version = excluded.session_version, last_login = DEFAULT;
  -- children before parents (RESTRICT): everything on the QRS customers / jobs / parts
  CREATE TEMP TABLE qrs_job ON COMMIT DROP AS SELECT pk FROM job
   WHERE job_no LIKE 'QRS%' OR job_no LIKE 'J998700_' OR customer_pk IN (SELECT pk FROM customer WHERE customer_code LIKE 'QRS%');
  CREATE TEMP TABLE qrs_q ON COMMIT DROP AS SELECT pk FROM quotation
   WHERE job_pk IN (SELECT pk FROM qrs_job) OR customer_pk IN (SELECT pk FROM customer WHERE customer_code LIKE 'QRS%');
  CREATE TEMP TABLE qrs_so ON COMMIT DROP AS SELECT pk FROM sale_order
   WHERE customer_pk IN (SELECT pk FROM customer WHERE customer_code LIKE 'QRS%');
  UPDATE job SET approved_quotation_pk = NULL WHERE approved_quotation_pk IN (SELECT pk FROM qrs_q);
  DELETE FROM quotation_line WHERE quotation_pk IN (SELECT pk FROM qrs_q);
  DELETE FROM quotation WHERE pk IN (SELECT pk FROM qrs_q);
  DELETE FROM stock_move_line WHERE stock_move_pk IN (SELECT pk FROM stock_move
   WHERE sale_order_pk IN (SELECT pk FROM qrs_so) OR job_pk IN (SELECT pk FROM qrs_job));
  DELETE FROM sale_order_line WHERE sale_order_pk IN (SELECT pk FROM qrs_so);
  DELETE FROM stock_move WHERE sale_order_pk IN (SELECT pk FROM qrs_so) OR job_pk IN (SELECT pk FROM qrs_job);
  DELETE FROM sale_order WHERE pk IN (SELECT pk FROM qrs_so);
  DELETE FROM job_attachment WHERE job_pk IN (SELECT pk FROM qrs_job);
  DELETE FROM job_symptom WHERE job_pk IN (SELECT pk FROM qrs_job);
  DELETE FROM job_status_log WHERE job_pk IN (SELECT pk FROM qrs_job);
  DELETE FROM job_part WHERE job_pk IN (SELECT pk FROM qrs_job)
     OR product_pk IN (SELECT pk FROM product WHERE pk BETWEEN 9871 AND 9879 OR product_code LIKE 'QRSP%');
  DELETE FROM job WHERE pk IN (SELECT pk FROM qrs_job);
  DELETE FROM customer WHERE pk BETWEEN 9871 AND 9879 OR customer_code LIKE 'QRS%';
  INSERT INTO customer (pk, customer_code, customer_name, phone_number, record_status) OVERRIDING SYSTEM VALUE
    SELECT 9870 + n, 'QRSC0' || n, 'ลูกค้า QRS ' || n, '02-987-000' || n, 'ACTIVE' FROM generate_series(1, 6) n;
  DELETE FROM product_stock WHERE product_pk BETWEEN 9871 AND 9879 OR pk BETWEEN 9871 AND 9879;
  DELETE FROM product WHERE pk BETWEEN 9871 AND 9879 OR product_code LIKE 'QRSP%';
  INSERT INTO product (pk, product_code, product_name, record_status) OVERRIDING SYSTEM VALUE
    SELECT 9870 + n, 'QRSP' || n, 'อะไหล่ QRS ' || n, 'ACTIVE' FROM generate_series(1, 3) n;
  INSERT INTO product_stock (pk, product_pk, quantity_available, quantity_used, quantity_booking, quantity_remain, retail_price)
  OVERRIDING SYSTEM VALUE
    SELECT 9870 + n, 9870 + n, 100, 0, 0, 100, 100.00 FROM generate_series(1, 3) n;
  INSERT INTO job (job_no, job_status_id, customer_pk, customer_detail, model_pk, product_model_name, job_create_date, job_reception_date,
                   job_closed_date, record_status, engineer_app_user_pk, service_cost, spare_part_total_cost, job_total_cost)
    SELECT 'QRS' || lpad(n::text, 4, '0'), CASE WHEN n = 2 THEN 11 ELSE 2 END, 9871, '${CUST} ลูกค้า QRS 1', (SELECT pk FROM model WHERE model_code = 'QRS'), 'Model QRS', now(), current_date, '1900-01-01', 'ACTIVE',
           CASE WHEN n = 3 THEN NULL ELSE ${ENG} END, 0, 0, 0
      FROM generate_series(1, 6) n;
  INSERT INTO job (job_no, job_status_id, customer_pk, customer_detail, model_pk, product_model_name, job_create_date, job_reception_date, job_closed_date, record_status)
    SELECT v.no, 2, 9871, 'QRS', (SELECT pk FROM model WHERE model_code = 'QRS'), 'Model QRS', now(), current_date, '1900-01-01', 'ACTIVE'
      FROM (VALUES ('${QJOB}'), ('J9987002'), ('J9987003')) v(no);
  INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
    SELECT 0, 'ยกเลิกข้อมูล', 0, 'Cancel', true WHERE NOT EXISTS (SELECT 1 FROM job_status WHERE job_status_id = 0);
  INSERT INTO job_attachment (job_pk, original_file_name, system_file_name, remark, record_status)
    VALUES ((SELECT pk FROM job WHERE job_no = '${J(5)}'), 'qrs.pdf', 'qrs.pdf', '', 'ACTIVE');
`);

const Q = async <T = Record<string, unknown>,>(text: string, params: unknown[] = []) =>
  (await pool.query(text, params)).rows as T[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** a separate connection, outside the app's pool — the "other session" that holds a lock */
async function blocker() {
  const c = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await c.connect();
  await c.query('BEGIN');
  return c;
}
/** until `min` sessions of this database wait on a lock */
async function lockWaits(min = 1, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const [r] = await Q<{ n: number }>(
      `SELECT count(*)::int n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (r!.n >= min) return;
    await sleep(10);
  }
  throw new Error('the request never reached the lock');
}
/** settles to the HTTP status (200 = done), recording the order the promises settled in */
function track(order: string[], name: string, p: Promise<unknown>) {
  return p.then(
    () => (order.push(name), 200),
    (e: unknown) => {
      order.push(name);
      if (e instanceof HttpError) return e.status;
      throw e;
    },
  );
}
const runningLock = (b: pg.Client, type: string) =>
  b.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`running_no:${type}:${thaiYear()}`]);
/**
 * the request `req` is pinned (blocker holds a lock it needs after its check); `del` runs then. Fixed, the
 * request holds its row lock by then and the delete waits for it; broken, the delete commits inside the window.
 */
async function race(b: pg.Client, req: () => Promise<unknown>, del: () => Promise<unknown>) {
  const order: string[] = [];
  const r = track(order, 'req', req());
  let d: Promise<number> = Promise.resolve(0);
  let delFirst = false;
  try {
    // the request settling first = it never reached the pinned point (a 400 from the fixtures, …)
    await Promise.race([lockWaits(1), r.then((s) => Promise.reject(new Error(`the request answered ${s} first`)))]);
    d = track(order, 'del', del());
    await Promise.race([d, sleep(400)]);
    delFirst = order.includes('del'); // the delete committed while the request sat between its check and its write
  } finally {
    await b.query('COMMIT');
    await b.end();
  }
  return { req: await r, del: await d, delFirst };
}
const del = (table: 'customers' | 'jobs' | 'products', id: string) => () =>
  setRecordStatus(table, id, 'DELETED', ADMIN.id);
/** a customer's uuid — what /api/admin/records (setRecordStatus) takes for one */
const custId = async (code: string) =>
  (await Q<{ id: string }>(`SELECT id::text AS id FROM customer WHERE customer_code = $1`, [code]))[0]!.id;
/** a job's / user's uuid — what the API and records take */
const uuidOf = async (table: 'job' | 'app_user', key: string | number) =>
  (
    await Q<{ id: string }>(`SELECT id::text AS id FROM ${table} WHERE ${table === 'job' ? 'job_no' : 'pk'} = $1`, [
      key,
    ])
  )[0]!.id;
const QLINE = { itemType: 'SparePart' as const, code: '', detail: 'QRS', qty: 1, unit: 'หน่วย', unitPrice: 100 };
const jobInput = (customerCode: string, extra: Record<string, unknown> = {}) => ({
  customerCode,
  jobType: 'QRS งานซ่อม',
  channel: 'หน้าร้าน',
  warrantyMonth: 12,
  brand: 'QRS',
  modelCode: 'QRS',
  symptoms: ['QRS'],
  dueDate: addDays(today(), 5),
  ...extra,
});

async function route(
  handler: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>,
  url: string,
  init: { method: string; form?: FormData; params?: Record<string, string> },
) {
  const now = Date.now();
  const cookie = `${SESSION_COOKIE}=${await signSession({ email: ADMIN.email, name: 'QRS', exp: now + 600_000, iat: now, sv: SV })}`;
  const req = new NextRequest(`https://svc.example.test${url}`, {
    method: init.method,
    headers: { cookie, 'user-agent': 'qrs', host: 'svc.example.test' },
    body: init.form,
  });
  const res = await handler(req, { params: Promise.resolve(init.params ?? {}) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
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
  console.log('\nG13 · a document for a customer deleted at the same moment');
  await test('POST job ‖ delete its customer: the job is opened before the delete, or refused (409)', async () => {
    const serial = `QRS-G13-${Date.now()}`;
    const b = await blocker();
    await runningLock(b, 'Job'); // another job being opened: holds this one after its checks
    const r = await race(
      b,
      () => createJob(jobInput('QRSC02', { serial }), ADMIN.id),
      del('customers', await custId('QRSC02')),
    );
    const jobs = await Q(`SELECT job_no FROM job WHERE product_serial = $1`, [serial]);
    assert.ok(
      r.req === 200 ? !r.delFirst : r.req === 409,
      `create ${r.req}, delete ${r.del}, delete first ${r.delFirst}`,
    );
    assert.equal(jobs.length, r.req === 200 ? 1 : 0);
  });
  await test('PATCH job to another customer ‖ delete that customer → 409, the job keeps its customer', async () => {
    const b = await blocker();
    await b.query(`SELECT 1 FROM job WHERE job_no = $1 FOR UPDATE`, [J(1)]); // a save of the job in flight
    const p = updateJob(
      J(1),
      {
        customerCode: 'QRSC03',
        jobType: '',
        dueDate: addDays(today(), 30),
        warrantyMonth: 0,
        channel: 'SHOPEE',
        brand: 'QRS', // the job's model and its brand stay filled (job.model_pk NOT NULL: "never worse")
        modelCode: 'QRS',
      },
      ADMIN.id,
    ).then(
      () => 200,
      (e: unknown) => (e instanceof HttpError ? e.status : Promise.reject(e)),
    );
    await lockWaits(1);
    await del('customers', await custId('QRSC03'))();
    await b.query('COMMIT');
    await b.end();
    assert.equal(await p, 409);
    const [j] = await Q<{ c: number }>(`SELECT customer_pk::int c FROM job WHERE job_no = $1`, [J(1)]);
    assert.equal(j!.c, 9871);
  });
  await test('POST quotation / sale order ‖ delete its customer: saved before the delete, or refused (409)', async () => {
    const bad: string[] = [];
    const [{ id: salesId }] = await Q<{ id: string }>(`SELECT id::text AS id FROM app_user WHERE pk = $1`, [ADMIN.id]);
    for (const [code, save, type] of [
      [
        'QRSC04',
        () =>
          saveQuotation({ jobNo: 'J9987002', customerCode: 'QRSC04', contactName: 'QRS', lines: [QLINE] }, ADMIN.id),
        'Quotation',
      ],
      [
        'QRSC05',
        () =>
          saveSaleOrder(
            { customerCode: 'QRSC05', salesId, submit: false, lines: [{ code: PART, qty: 1 }] },
            { pk: ADMIN.id, isAdmin: true },
          ),
        'SaleOrder',
      ],
    ] as const) {
      const b = await blocker();
      await runningLock(b, type);
      const r = await race(b, save, del('customers', await custId(code)));
      if (r.req === 200 ? r.delFirst : r.req !== 409) bad.push(`${type}: ${r.req}, delete first ${r.delFirst}`);
    }
    assert.deepEqual(bad, []);
  });
  await test('assign a job ‖ its engineer deactivated → 400 "account closed", the job not given to them', async () => {
    const b = await blocker();
    await b.query(`SELECT 1 FROM job WHERE job_no = $1 FOR UPDATE`, [J(3)]);
    let fields: unknown;
    const eng = await uuidOf('app_user', ENG);
    const p = assignJobs([J(3)], eng, ADMIN.id).then(
      () => 200,
      (e: unknown) =>
        e instanceof HttpError ? ((fields = (e.details as { fields?: unknown })?.fields), e.status) : Promise.reject(e),
    );
    await lockWaits(1);
    await Q(`UPDATE app_user SET record_status = 'INACTIVE' WHERE pk = $1`, [ENG]); // users.ts' save, committed
    await b.query('COMMIT');
    await b.end();
    const status = await p;
    await Q(`UPDATE app_user SET record_status = 'ACTIVE' WHERE pk = $1`, [ENG]);
    assert.equal(status, 400);
    // not "lacks Job Take": the account itself is closed
    assert.deepEqual(fields, { engineerId: 'บัญชีช่างคนนี้ถูกปิดใช้งานแล้ว — เลือกช่างคนอื่น' });
    const [j] = await Q<{ e: number | null }>(`SELECT engineer_app_user_pk::int e FROM job WHERE job_no = $1`, [J(3)]);
    assert.equal(j!.e, null);
  });

  console.log('\nG16 · a quotation for a job deleted at the same moment');
  await test('POST quotation for a job ‖ delete the job: raised before the delete, or refused (409)', async () => {
    const b = await blocker();
    await runningLock(b, 'Quotation');
    const r = await race(
      b,
      () => saveQuotation({ jobNo: QJOB, customerCode: CUST, contactName: 'QRS', lines: [QLINE] }, ADMIN.id),
      del('jobs', await uuidOf('job', QJOB)),
    );
    const qs = await Q(`SELECT 1 FROM quotation WHERE job_pk = (SELECT pk FROM job WHERE job_no = $1)`, [QJOB]);
    assert.ok(r.req === 200 ? !r.delFirst : r.req === 409, `quotation ${r.req}, delete first ${r.delFirst}`);
    assert.equal(qs.length, r.req === 200 ? 1 : 0);
  });
  await test('POST quotation waiting on a job being deleted → 409 naming the status it ends in (not "0")', async () => {
    const b = await blocker();
    // the delete (records.ts) holds the job row: DELETED, status 0 ยกเลิกข้อมูล, not committed yet
    await b.query(`UPDATE job SET record_status = 'DELETED', job_status_id = 0 WHERE job_no = 'J9987003'`);
    const p = saveQuotation(
      { jobNo: 'J9987003', customerCode: CUST, contactName: 'QRS', lines: [QLINE] },
      ADMIN.id,
    ).then(
      () => 'saved',
      (e: unknown) => (e instanceof HttpError ? `${e.status} ${e.message}` : Promise.reject(e)),
    );
    await lockWaits(1);
    await b.query('COMMIT');
    await b.end();
    const [{ name }] = await Q<{ name: string }>(`SELECT job_status_name name FROM job_status WHERE job_status_id = 0`);
    assert.ok((await p).startsWith(`409 งาน J9987003 อยู่ในสถานะ "${name}"`), await p);
  });

  console.log('\nG6 · a part request for a product deleted at the same moment');
  await test('repair adds a เบิก line ‖ delete the product: never a waiting request on a deleted product', async () => {
    const b = await blocker();
    await b.query(`SELECT 1 FROM product_stock WHERE product_pk = 9872 FOR UPDATE`); // a stock receipt in flight
    const r = await race(
      b,
      () =>
        saveRepair(
          J(2),
          {
            status: 'อยู่ระหว่างการซ่อม - เริ่มเบิกอะไหล่',
            parts: [
              { code: 'QRSP2', a: { pick: true, quote: true, qty: 2 }, b: { pick: false, quote: false, qty: 0 } },
            ],
          },
          ADMIN.id,
        ),
      del('products', 'QRSP2'),
    );
    const [p] = await Q<{ rs: string }>(`SELECT record_status rs FROM product WHERE pk = 9872`);
    const waiting = await Q(
      `SELECT 1 FROM job_part WHERE job_pk = (SELECT pk FROM job WHERE job_no = $1) AND product_pk = 9872 AND job_part_status_id = 1`,
      [J(2)],
    );
    assert.ok(!(p!.rs === 'DELETED' && waiting.length), `repair ${r.req}, delete ${r.del}, delete first ${r.delFirst}`);
  });

  console.log('\nG4 · an attachment deleted twice at once');
  await test('5 × DELETE /api/attachments/{id} at once → one 200 and one DELETE audit row, the rest 404 "ไฟล์นี้ถูกลบไปแล้ว"', async () => {
    const [a] = await Q<{ id: string }>(
      `SELECT id::text id FROM job_attachment WHERE job_pk = (SELECT pk FROM job WHERE job_no = $1)`,
      [J(5)],
    );
    const id = a!.id;
    const [{ last }] = await Q<{ last: number }>(`SELECT coalesce(max(pk), 0) AS last FROM audit_log`);
    const b = await blocker();
    await b.query(`SELECT 1 FROM job_attachment WHERE id = $1 FOR UPDATE`, [a!.id]);
    const rs = Array.from({ length: 5 }, () =>
      route(attachIdRoute.DELETE as never, `/api/attachments/${id}`, { method: 'DELETE', params: { id } }),
    );
    await lockWaits(5);
    await b.query('COMMIT');
    await b.end();
    const answers = await Promise.all(rs);
    const statuses = answers.map((r) => r.status).sort();
    const audits = await Q(
      `SELECT 1 FROM audit_log WHERE pk > $1 AND entity_key = $2 AND action = 'DELETE' AND summary LIKE 'ลบไฟล์แนบ%'`,
      [last, J(5)],
    );
    assert.deepEqual([statuses, audits.length], [[200, 404, 404, 404, 404], 1]);
    // the losers are told in Thai that the file is already gone (the screen drops the row on it)
    for (const r of answers.filter((a) => a.status === 404)) assert.equal(r.body.error, 'ไฟล์นี้ถูกลบไปแล้ว');
  });

  console.log('\n#10 · an attachment uploaded to a job deleted during the upload');
  await test('POST /api/attachments ‖ delete the job during the upload → 409, no row, the stored file removed', async () => {
    let open!: () => void;
    const started = new Promise<void>((r) => (uploadStarted = r));
    uploadGate = new Promise<void>((r) => (open = r));
    const form = new FormData();
    form.set(
      'file',
      new File(['%PDF-1.4\n%QRS\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'], 'qrs.pdf', { type: 'application/pdf' }),
    );
    form.set('jobNo', J(6));
    const p = route(attachRoute.POST as never, '/api/attachments', { method: 'POST', form });
    await started;
    await del('jobs', await uuidOf('job', J(6)))();
    open();
    const r = await p;
    uploadGate = Promise.resolve();
    uploadStarted = () => {};
    const rows = await Q(`SELECT 1 FROM job_attachment WHERE job_pk = (SELECT pk FROM job WHERE job_no = $1)`, [J(6)]);
    assert.deepEqual([r.status, rows.length, [...stored].filter((s) => s.includes(J(6)))], [409, 0, []]);
  });
} finally {
  await pool.query(`UPDATE app_user SET record_status = 'ACTIVE' WHERE pk = ${ENG}`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
