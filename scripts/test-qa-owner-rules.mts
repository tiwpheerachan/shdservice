/**
 * scripts/test-qa-owner-rules.mts — the owner's data rules of 2026-10-30 (ADR 0008 phase 2, "no redundant data"),
 * through the real services:
 *   (a) a NEW job / quotation / sale order / customer / stock move stores no copy of what a relation gives — and every
 *       read still shows the same text through the join
 *   (b) customer snapshots: a quotation's when the customer agrees (once), a sale order's at approval (not the draft)
 *   (c) legacy lock: the money / quantity a legacy row (pk ≤ legacy_boundary.max_pk) already recorded is System
 *       Admin's alone; new lines, an empty payment filled at the close and the status flow stay everyone's
 *
 * Runs ONLY against a throwaway local test database (TEST_DATABASE_URL=…_test, npm run db:test:prepare):
 *   API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-owner-rules.mts
 * Seeds its own fixtures (users 9501/9502, customer QORC01 = 9501, part QORP1 = 9501, model QOR-M1, courier QORS)
 * and resets them at every start. legacy_boundary (immutable after 0006) is moved for (c) with its triggers off —
 * test database only — and put back in `finally`.
 */
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.SESSION_SECRET = 'unit-test-session-secret-0123456789abcdef';

const { db, pool } = await import('@/db/client');
const { HttpError } = await import('@/server/auth');
const { invalidate } = await import('@/server/cache');
const { nextRunningNo } = await import('@/db/running-no');
const { createJob, getJob, closeJob, saveRepair } = await import('@/server/services/jobs');
const { saveQuotation, getQuotation } = await import('@/server/services/quotations');
const { saveSaleOrder, approveSaleOrder, getSaleOrder, setTracking } = await import('@/server/services/sale-orders');
const { saveCustomer, getCustomerByCode } = await import('@/server/services/customers');
const { issueForJob, listMovements } = await import('@/server/services/stock');

const ADMIN = { id: 9501, email: 'qor-admin@example.invalid', isAdmin: true, userType: 'System Admin' };
const CLERK = { id: 9502, email: 'qor-clerk@example.invalid', isAdmin: false, userType: 'QOR Clerk' };
const CUSTOMER = 'QORC01';
const PART = 'QORP1';
const MODEL = 'QOR-M1';
const SHIPPER = 'ขนส่ง QOR';
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

const one = async <T,>(q: ReturnType<typeof sql>) => (await db.execute<T & Record<string, unknown>>(q)).rows[0]!;
/** the fixture customer's jobs / quotations / sale orders (everything this file makes hangs off QORC01) */
const MINE = {
  jobs: 'SELECT pk FROM job WHERE customer_pk = 9501',
  quotes: 'SELECT pk FROM quotation WHERE customer_pk = 9501',
  sos: 'SELECT pk FROM sale_order WHERE customer_pk = 9501',
};

async function seed() {
  await pool.query(`
    INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
      SELECT * FROM (VALUES (0, 'ยกเลิก', 0, 'Cancel', true), (1, 'รับงานใหม่', 1, 'Open', true),
        (2, 'กำลังดำเนินการ', 2, 'Open', true), (3, 'อยู่ระหว่างการซ่อม - รออะไหล่', 35, 'Pending', true),
        (4, 'อยู่ระหว่างการซ่อม - เสนอราคาลูกค้า', 37, 'Pending', true), (5, 'ซ่อมเสร็จ', 5, 'Repaired', true),
        (9, 'ซ่อมเสร็จ (ชำระเงินแล้ว)', 45, 'Repaired', true),
        (10, 'อยู่ระหว่างการซ่อม - เบิกจ่ายอะไหล่ครบแล้ว', 34, 'Pending', true),
        (11, 'อยู่ระหว่างการซ่อม - เริ่มเบิกอะไหล่', 33, 'Pending', true),
        (12, 'อยู่ระหว่างการซ่อม - ลูกค้าตกลงซ่อม', 38, 'Pending', true),
        (13, 'อยู่ระหว่างการซ่อม - รอเสนอราคา', 36, 'Pending', true),
        (20, 'ปิดงาน (Complete)', 20, 'Finished', true)) v(id, name, ord, grp, act)
       WHERE NOT EXISTS (SELECT 1 FROM job_status s WHERE s.job_status_id = v.id);
    INSERT INTO quotation_status (quotation_status_id, quotation_status_name)
      SELECT * FROM (VALUES (1, 'รอเสนอราคา'), (2, 'เสนอราคาแล้ว'), (3, 'ลูกค้าตกลงซ่อม'), (4, 'ลูกค้าไม่ตกลงซ่อม'),
        (5, 'ยกเลิกใบเสนอราคา'), (6, 'ลูกค้าตกลงซ่อม รอชำระเงิน'), (8, 'พ้นกำหนดเสนอราคา'),
        (9, 'ลูกค้าตกลงซ่อม รออะไหล่')) v(id, name)
       WHERE NOT EXISTS (SELECT 1 FROM quotation_status s WHERE s.quotation_status_id = v.id);
    INSERT INTO approve_status (approve_status_id, approve_name_th)
      SELECT * FROM (VALUES (1, 'กำลังดำเนินการจัดทำ'), (2, 'รออนุมัติ'), (3, 'แก้ไขข้อมูล'), (4, 'อนุมัติแล้ว'), (5, 'ปฏิเสธ')) v(id, n)
       WHERE NOT EXISTS (SELECT 1 FROM approve_status s WHERE s.approve_status_id = v.id);
    INSERT INTO job_part_status (job_part_status_id, job_part_status_name)
      SELECT * FROM (VALUES (1, 'เบิก'), (2, 'ขอคืน'), (3, 'จ่ายแล้ว'), (4, 'ยกเลิก'), (5, 'คืนแล้ว')) v(id, n)
       WHERE NOT EXISTS (SELECT 1 FROM job_part_status s WHERE s.job_part_status_id = v.id);
    INSERT INTO stock_move_type (stock_move_type_id, stock_move_type_name, movement_action_type, movement_action, is_active)
      SELECT * FROM (VALUES (1, 'รับเข้า', 'รับเข้า', 1, true), (2, 'รับคืนจากการเบิก', 'รับเข้า', 1, true),
        (3, 'จ่ายออกตามงานซ่อม', 'จ่ายออก', -1, true), (4, 'จ่ายออกตามใบสั่งขาย', 'จ่ายออก', -1, true),
        (5, 'จ่ายออกอื่นๆ', 'จ่ายออก', -1, true)) v(id, n, k, a, o)
       WHERE NOT EXISTS (SELECT 1 FROM stock_move_type t WHERE t.stock_move_type_id = v.id);
    INSERT INTO store_location (store_location_id, store_location_name, is_active)
      SELECT 1, 'คลังสินค้าดี', true WHERE NOT EXISTS (SELECT 1 FROM store_location WHERE store_location_id = 1);
    INSERT INTO job_type (job_type_name, record_status)
      SELECT 'QOR ซ่อม', 'ACTIVE' WHERE NOT EXISTS (SELECT 1 FROM job_type WHERE job_type_name = 'QOR ซ่อม');
    INSERT INTO brand (brand_name, record_status)
      SELECT 'QOR Brand', 'ACTIVE' WHERE NOT EXISTS (SELECT 1 FROM brand WHERE brand_name = 'QOR Brand');
    INSERT INTO model (model_code, model_name, brand_pk, record_status)
      SELECT '${MODEL}', 'QOR รุ่นหนึ่ง', (SELECT pk FROM brand WHERE brand_name = 'QOR Brand'), 'ACTIVE'
       WHERE NOT EXISTS (SELECT 1 FROM model WHERE model_code = '${MODEL}');
    INSERT INTO symptom (symptom_name, record_status)
      SELECT 'QOR เปิดไม่ติด', 'ACTIVE' WHERE NOT EXISTS (SELECT 1 FROM symptom WHERE symptom_name = 'QOR เปิดไม่ติด');
    INSERT INTO shipping_profile (pk, code, name_th) OVERRIDING SYSTEM VALUE
      SELECT 9501, 'QORS', '${SHIPPER}' WHERE NOT EXISTS (SELECT 1 FROM shipping_profile WHERE pk = 9501);
    INSERT INTO role_permission (user_type, module_name, can_insert, can_edit, can_delete, can_view)
      SELECT '${CLERK.userType}', m, true, true, false, true
        FROM unnest(ARRAY['Job Management', 'Job Repair', 'Job Closing', 'Quotation', 'Sale Order', 'Customer']) m
    ON CONFLICT (user_type, module_name) DO NOTHING;
    -- users stay (audit_log, append-only, points at them): reset in place
    INSERT INTO app_user (pk, first_name, last_name, email_address, user_type, record_status, session_version)
      OVERRIDING SYSTEM VALUE VALUES
        (${ADMIN.id}, 'QOR', 'admin', '${ADMIN.email}', '${ADMIN.userType}', 'ACTIVE', 1),
        (${CLERK.id}, 'QOR', 'clerk', '${CLERK.email}', '${CLERK.userType}', 'ACTIVE', 1)
      ON CONFLICT (pk) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
        email_address = excluded.email_address, user_type = excluded.user_type, record_status = excluded.record_status,
        session_version = excluded.session_version, last_login = DEFAULT;

    -- children before parents (every relation is a RESTRICT foreign key)
    CREATE TEMP TABLE qor_j ON COMMIT DROP AS ${MINE.jobs};
    CREATE TEMP TABLE qor_q ON COMMIT DROP AS ${MINE.quotes} UNION SELECT pk FROM quotation WHERE job_pk IN (SELECT pk FROM qor_j);
    CREATE TEMP TABLE qor_s ON COMMIT DROP AS ${MINE.sos};
    CREATE TEMP TABLE qor_m ON COMMIT DROP AS SELECT pk FROM stock_move
      WHERE job_pk IN (SELECT pk FROM qor_j) OR sale_order_pk IN (SELECT pk FROM qor_s);
    UPDATE job SET approved_quotation_pk = NULL WHERE pk IN (SELECT pk FROM qor_j);
    DELETE FROM track_doc_ticket WHERE job_pk IN (SELECT pk FROM qor_j);
    DELETE FROM track_ticket WHERE job_pk IN (SELECT pk FROM qor_j);
    DELETE FROM quotation_line WHERE quotation_pk IN (SELECT pk FROM qor_q);
    DELETE FROM quotation WHERE pk IN (SELECT pk FROM qor_q);
    DELETE FROM sale_order_line WHERE sale_order_pk IN (SELECT pk FROM qor_s);
    DELETE FROM stock_move_line WHERE stock_move_pk IN (SELECT pk FROM qor_m) OR product_pk = 9501;
    DELETE FROM stock_move WHERE pk IN (SELECT pk FROM qor_m);
    DELETE FROM sale_order WHERE pk IN (SELECT pk FROM qor_s);
    DELETE FROM job_status_log WHERE job_pk IN (SELECT pk FROM qor_j);
    DELETE FROM job_part WHERE job_pk IN (SELECT pk FROM qor_j) OR product_pk = 9501;
    DELETE FROM job_symptom WHERE job_pk IN (SELECT pk FROM qor_j);
    DELETE FROM job WHERE pk IN (SELECT pk FROM qor_j);
    DELETE FROM customer WHERE customer_name LIKE 'QOR-NEW%';
    DELETE FROM customer WHERE pk = 9501 OR customer_code = '${CUSTOMER}';
    INSERT INTO customer (pk, customer_code, customer_name, customer_address1, customer_card_id, phone_number, customer_type,
                          record_status)
      OVERRIDING SYSTEM VALUE
      VALUES (9501, '${CUSTOMER}', 'ลูกค้า QOR', '9/1 ถนน QOR', '1234567890121', '081-555-9501', 'Normal', 'ACTIVE');
    DELETE FROM product_stock WHERE product_pk = 9501 OR pk = 9501;
    DELETE FROM product WHERE pk = 9501 OR product_code = '${PART}';
    INSERT INTO product (pk, product_code, product_name, record_status) OVERRIDING SYSTEM VALUE
      VALUES (9501, '${PART}', 'อะไหล่ QOR', 'ACTIVE');
    INSERT INTO product_stock (pk, product_pk, quantity_available, quantity_used, quantity_booking, quantity_remain,
                               retail_price, capital_price, wholesale_price)
      OVERRIDING SYSTEM VALUE VALUES (9501, 9501, 100, 0, 0, 100, 100.00, 50.00, 80.00);
    -- customer_code is UNIQUE: the Customer series starts past the codes test fixtures typed by hand (C00001 …)
    INSERT INTO running_no (running_type, company_id, branch_id, prefix, pyear, pmonth, pday, number, length_year,
                            length_month, length_number)
      SELECT 'Customer', 0, 0, 'C', 0, 0, 0, 90000, 0, 0, 5
       WHERE NOT EXISTS (SELECT 1 FROM running_no WHERE running_type = 'Customer');
  `);
  // as test-domain: this year's Inventory-Out series past the numbers other suites already used
  await db.transaction((tx) => nextRunningNo(tx, 'Inventory-Out'));
  await pool.query(`
    UPDATE running_no r SET number = greatest(r.number, coalesce((
      SELECT max(substring(h.stock_move_no FROM length(r.prefix) + 3)::int) FROM stock_move h
       WHERE h.stock_move_no ~ ('^' || r.prefix || right(r.pyear::text, 2) || '[0-9]+$')), 0))
     WHERE r.running_type = 'Inventory-Out' AND r.length_year = 2`);
}

async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
}
const statusName = async (id: number) =>
  (await one<{ n: string }>(sql`SELECT job_status_name AS n FROM job_status WHERE job_status_id = ${id}`)).n;

/** a new job of the fixture customer, made the way the job form makes it */
const newJob = (by = ADMIN.id, o: Record<string, unknown> = {}) =>
  createJob(
    {
      customerCode: CUSTOMER,
      jobType: 'QOR ซ่อม',
      brand: 'QOR Brand',
      modelCode: MODEL,
      symptoms: ['QOR เปิดไม่ติด'],
      receptionShipper: SHIPPER,
      serial: `QOR-SN-${Date.now()}`,
      channel: 'SHOPEE',
      so: '260901QOR00001',
      saleOrderDate: '2026-10-01',
      warrantyMonth: 12,
      expireDate: '2027-10-01',
      dueDate: today(),
      ...o,
    } as Parameters<typeof createJob>[0],
    by,
  );
const qLine = (o: Record<string, unknown> = {}) => ({
  itemType: 'SparePart',
  code: PART,
  detail: 'อะไหล่ QOR',
  qty: 1,
  unitPrice: 100,
  discount: 0,
  discountPercent: 0,
  ...o,
});
/** a new part line on the repair page: เบิก 1 of the fixture part */
const NEW_PART = {
  code: PART,
  unitPrice: 100,
  a: { pick: true, quote: false, qty: 1 },
  b: { pick: false, quote: false, qty: 0 },
};
const SERVICE_LINE = qLine({ itemType: 'Service', code: 'SV0001', detail: 'ค่าบริการ QOR', unitPrice: 300 });
const quote = (jobNo: string, o: Record<string, unknown> = {}) =>
  ({ customerCode: CUSTOMER, jobNo, lines: [qLine(), SERVICE_LINE], ...o }) as Parameters<typeof saveQuotation>[0];
const userUuid = async (pk: number) =>
  (await one<{ id: string }>(sql`SELECT id::text AS id FROM app_user WHERE pk = ${pk}`)).id;
const so = async (o: Record<string, unknown> = {}) =>
  ({
    customerCode: CUSTOMER,
    salesId: await userUuid(ADMIN.id),
    submit: false,
    paymentType: '',
    paymentAmount: '',
    lines: [
      { code: PART, qty: 2, price: 100, type: 'SparePart' },
      { code: 'SV0001', qty: 1, price: 150, name: 'ค่าบริการ QOR', type: 'Service' },
    ],
    ...o,
  }) as Parameters<typeof saveSaleOrder>[0];

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    const fields = e instanceof HttpError ? ` ${JSON.stringify(e.details ?? {})}` : '';
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : e}${fields}`);
  }
}

await seed();
/** TEST DATABASE ONLY: the boundary is immutable once 0006 filled it (its triggers refuse every change); a test that
 *  needs legacy rows moves it with the triggers off, in one transaction, and puts it back in `finally` */
const moveBoundary = async (t: string, max: string) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('ALTER TABLE legacy_boundary DISABLE TRIGGER USER');
    await c.query('UPDATE legacy_boundary SET max_pk = $2 WHERE table_name = $1', [t, max]);
    await c.query('ALTER TABLE legacy_boundary ENABLE TRIGGER USER');
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
};
const boundaryBefore = (
  await pool.query<{ t: string; m: string }>('SELECT table_name AS t, max_pk::text AS m FROM legacy_boundary')
).rows;
try {
  console.log('\n(a) new rows store no redundant copy — the reads show the same text through the joins');
  let jobNo = '';
  await test('a new job: customer_detail / product_model_name / job_reception_shipper / reported_symptom_pk NULL', async () => {
    const j = await newJob();
    jobNo = j.no;
    const row = await one<{
      cd: string | null;
      mn: string | null;
      sh: string | null;
      rs: number | null;
      sp: number | null;
    }>(
      sql`SELECT customer_detail AS cd, product_model_name AS mn, job_reception_shipper AS sh, reported_symptom_pk AS rs,
                 reception_shipping_profile_pk::int AS sp FROM job WHERE job_no = ${jobNo}`,
    );
    assert.deepEqual(row, { cd: null, mn: null, sh: null, rs: null, sp: 9501 });
    const d = (await getJob(jobNo))!;
    assert.deepEqual(
      [d.customer?.name, d.modelCode, d.modelName, d.brand, d.receptionShipper, d.symptoms],
      ['ลูกค้า QOR', MODEL, 'QOR รุ่นหนึ่ง', 'QOR Brand', SHIPPER, ['QOR เปิดไม่ติด']],
    );
    assert.match(d.customerDetail, /ลูกค้า QOR/);
  });
  let qNo = '';
  await test('a new quotation: a product line keeps no item_code (product_pk), a service line keeps its text code', async () => {
    const q = await saveQuotation(quote(jobNo), ADMIN.id, true);
    qNo = q.no;
    const rows = (
      await db.execute<{ code: string | null; p: number | null; t: string }>(
        sql`SELECT l.item_code AS code, l.product_pk::int AS p, l.item_type AS t FROM quotation_line l
             JOIN quotation q ON q.pk = l.quotation_pk WHERE q.quotation_no = ${qNo} ORDER BY l.line_number`,
      )
    ).rows;
    assert.deepEqual(rows, [
      { code: null, p: 9501, t: 'SparePart' },
      { code: 'SV0001', p: null, t: 'Service' },
    ]);
    assert.deepEqual(
      (await getQuotation(qNo))!.lines.map((l) => l.code),
      [PART, 'SV0001'],
    );
  });
  let soNo = '';
  await test('a new sale order: a product line keeps no product_code (product_pk), a service line keeps its code', async () => {
    const o = await saveSaleOrder(await so(), { pk: ADMIN.id, isAdmin: true });
    soNo = o.no;
    const rows = (
      await db.execute<{ code: string | null; p: number | null }>(
        sql`SELECT l.product_code AS code, l.product_pk::int AS p FROM sale_order_line l
             JOIN sale_order h ON h.pk = l.sale_order_pk WHERE h.sale_order_no = ${soNo} ORDER BY l.list_no, l.pk`,
      )
    ).rows;
    assert.deepEqual(rows, [
      { code: null, p: 9501 },
      { code: 'SV0001', p: null },
    ]);
    assert.deepEqual(
      (await getSaleOrder(soNo))!.lines.map((l) => [l.code, l.type]),
      [
        [PART, 'SparePart'],
        ['SV0001', 'Service'],
      ],
    );
  });
  await test('a new customer: customer_address (the legacy one-line copy) is not written; the read composes it', async () => {
    const c = await saveCustomer(
      {
        name: `QOR-NEW ${Date.now()}`,
        phone: `08${String(Date.now()).slice(-8)}`,
        address1: '77 ซอย QOR',
        type: 'Normal',
      } as Parameters<typeof saveCustomer>[0],
      ADMIN.id,
    );
    const row = await one<{ a: string | null; a1: string | null }>(
      sql`SELECT customer_address AS a, customer_address1 AS a1 FROM customer WHERE customer_code = ${c.code}`,
    );
    assert.deepEqual(row, { a: null, a1: '77 ซอย QOR' });
    assert.match((await getCustomerByCode(c.code))!.address, /77 ซอย QOR/);
  });
  await test("a job's / a sale order's stock move: reference_out_to NULL — the list shows the job / order number", async () => {
    // a part requested on the job, then issued (WHO type 3); the order approved (WHO type 4)
    const j = (await getJob(jobNo))!;
    await saveRepair(
      jobNo,
      {
        status: j.status,
        version: j.version,
        parts: [NEW_PART],
      } as Parameters<typeof saveRepair>[1],
      ADMIN.id,
    );
    const line = await one<{ id: string }>(
      sql`SELECT p.id::text AS id FROM job_part p JOIN job j ON j.pk = p.job_pk WHERE j.job_no = ${jobNo}`,
    );
    const issued = await issueForJob({ jobNo, lines: [{ logId: line.id, qty: 1 }] }, ADMIN.id);
    const o = (await getSaleOrder(soNo))!;
    await saveSaleOrder(await so({ no: soNo, version: o.version, submit: true }), { pk: ADMIN.id, isAdmin: true });
    await approveSaleOrder(soNo, 'approve', '', ADMIN);
    const moves = (
      await db.execute<{ no: string; out: string | null; job: string | null; so: string | null }>(
        sql`SELECT m.stock_move_no AS no, m.reference_out_to AS out, j.job_no AS job, s.sale_order_no AS so
              FROM stock_move m LEFT JOIN job j ON j.pk = m.job_pk LEFT JOIN sale_order s ON s.pk = m.sale_order_pk
             WHERE j.job_no = ${jobNo} OR s.sale_order_no = ${soNo} ORDER BY m.pk`,
      )
    ).rows;
    assert.deepEqual(
      moves.map((m) => [m.out, m.job ?? m.so]),
      [
        [null, jobNo],
        [null, soNo],
      ],
    );
    assert.equal(moves[0]!.no, issued.no);
    const listed = await listMovements({ limit: 1000 });
    for (const m of moves) assert.equal(listed.find((l) => l.doc === m.no)?.to, m.job ?? m.so, m.no);
  });

  console.log('\n(b) customer snapshots — a quotation when the customer agrees, a sale order at approval');
  await test('quotation: no snapshot while sent; written once at ลูกค้าตกลงซ่อม; a later customer edit leaves it', async () => {
    const snap = () =>
      one<{ n: string | null; a: string | null; t: string | null; p: string | null }>(
        sql`SELECT customer_name AS n, customer_address AS a, customer_tax_id AS t, customer_phone AS p
              FROM quotation WHERE quotation_no = ${qNo}`,
      );
    let q = (await getQuotation(qNo))!;
    q = await saveQuotation(quote(jobNo, { no: qNo, version: q.version, status: 'เสนอราคาแล้ว' }), ADMIN.id, true);
    assert.equal((await snap()).n, null, 'sent: no snapshot yet');
    q = await saveQuotation(quote(jobNo, { no: qNo, version: q.version, status: 'ลูกค้าตกลงซ่อม' }), ADMIN.id, true);
    const taken = await snap();
    assert.equal(taken.n, 'ลูกค้า QOR');
    assert.match(taken.a ?? '', /9\/1 ถนน QOR/);
    assert.equal(taken.t, '1234567890121');
    await pool.query(
      `UPDATE customer SET customer_name = 'ลูกค้า QOR (ย้ายบ้าน)', customer_address1 = '1 ที่ใหม่' WHERE pk = 9501`,
    );
    try {
      assert.deepEqual(await snap(), taken);
      assert.equal((await getQuotation(qNo))!.customerDetail?.name, 'ลูกค้า QOR', 'prints the agreed snapshot');
      // saved again, still agreed: the snapshot is not re-taken
      q = (await getQuotation(qNo))!;
      await saveQuotation(
        quote(jobNo, { no: qNo, version: q.version, status: 'ลูกค้าตกลงซ่อม', remark: 'QOR again' }),
        ADMIN.id,
        true,
      );
      assert.deepEqual(await snap(), taken);
    } finally {
      await pool.query(
        `UPDATE customer SET customer_name = 'ลูกค้า QOR', customer_address1 = '9/1 ถนน QOR' WHERE pk = 9501`,
      );
    }
  });
  await test('sale order: the draft keeps no customer snapshot; approval writes it', async () => {
    const draft = await saveSaleOrder(await so(), { pk: ADMIN.id, isAdmin: true });
    const snap = () =>
      one<{ n: string | null; p: string | null }>(
        sql`SELECT customer_name AS n, customer_phone_number AS p FROM sale_order WHERE sale_order_no = ${draft.no}`,
      );
    assert.deepEqual(await snap(), { n: null, p: null });
    assert.equal((await getSaleOrder(draft.no))!.customerDetail.name, 'ลูกค้า QOR', 'reads the customer now');
    await saveSaleOrder(await so({ no: draft.no, version: draft.version, submit: true }), {
      pk: ADMIN.id,
      isAdmin: true,
    });
    assert.deepEqual(await snap(), { n: null, p: null }, 'waiting: still none');
    await approveSaleOrder(draft.no, 'approve', '', ADMIN);
    const s = await snap();
    assert.equal(s.n, 'ลูกค้า QOR');
    assert.match(s.p ?? '', /081.?555.?9501/);
  });

  await test('a date not reached yet is NULL, never 1900-01-01: a new order / quotation; a cleared tracking no. → NULL', async () => {
    const d = await saveSaleOrder(await so(), { pk: ADMIN.id, isAdmin: true });
    const dates = () =>
      one<{ a: string | null; d: string | null; c: string | null; t: string | null }>(
        sql`SELECT approve_date::text AS a, delivery_date::text AS d, document_cancel_date::text AS c,
                   delivery_tracking_no AS t
              FROM sale_order WHERE sale_order_no = ${d.no}`,
      );
    const draft = await dates();
    assert.deepEqual([draft.a, draft.d, draft.c], [null, null, null], 'a draft');
    await saveSaleOrder(await so({ no: d.no, version: d.version, submit: true }), { pk: ADMIN.id, isAdmin: true });
    await approveSaleOrder(d.no, 'approve', '', ADMIN);
    const approved = await dates();
    assert.ok(approved.a, 'approval dated');
    assert.deepEqual([approved.d, approved.c], [null, null], 'approved, not shipped, not cancelled');
    await setTracking(d.no, 'TH0123456789', ADMIN.id);
    const shipped = await dates();
    assert.equal(shipped.t, 'TH0123456789');
    assert.ok(shipped.d, 'shipped dated');
    await setTracking(d.no, '', ADMIN.id);
    const cleared = await dates();
    assert.deepEqual([cleared.t, cleared.d], [null, null], 'the number cleared: NULL, not ""');
    // a quotation's customer_approve_date: NULL until the customer agrees
    const nj = await newJob();
    let q = await saveQuotation(quote(nj.no), ADMIN.id, true);
    const approvedOn = async () =>
      (
        await one<{ d: string | null }>(
          sql`SELECT customer_approve_date::text AS d FROM quotation WHERE quotation_no = ${q.no}`,
        )
      ).d;
    assert.equal(await approvedOn(), null, 'a new quotation');
    q = await saveQuotation(quote(nj.no, { no: q.no, version: q.version, status: 'เสนอราคาแล้ว' }), ADMIN.id, true);
    assert.equal(await approvedOn(), null, 'sent');
    await saveQuotation(quote(nj.no, { no: q.no, version: q.version, status: 'ลูกค้าตกลงซ่อม' }), ADMIN.id, true);
    assert.ok(await approvedOn(), 'agreed: dated');
  });

  console.log("\n(c) legacy lock — what a legacy row already recorded is System Admin's alone");
  // a job with a service cost and a part line, a quotation and a draft order — then counted as legacy
  const lj = await newJob();
  const lv = (await getJob(lj.no))!;
  await saveRepair(
    lj.no,
    {
      status: lv.status,
      version: lv.version,
      serviceCost: 400,
      parts: [NEW_PART],
    } as Parameters<typeof saveRepair>[1],
    ADMIN.id,
  );
  const lq = await saveQuotation(quote(lj.no), ADMIN.id, true);
  const ls = await saveSaleOrder(await so(), { pk: ADMIN.id, isAdmin: true });
  const lockedPks = await one<{ j: string; p: string; q: string; s: string }>(
    sql`SELECT (SELECT pk FROM job WHERE job_no = ${lj.no})::text AS j,
               (SELECT max(p.pk) FROM job_part p JOIN job j ON j.pk = p.job_pk WHERE j.job_no = ${lj.no})::text AS p,
               (SELECT pk FROM quotation WHERE quotation_no = ${lq.no})::text AS q,
               (SELECT pk FROM sale_order WHERE sale_order_no = ${ls.no})::text AS s`,
  );
  await test('legacy_boundary is fixed by drizzle/0006: a plain UPDATE is refused', async () => {
    await assert.rejects(
      pool.query("UPDATE legacy_boundary SET max_pk = max_pk WHERE table_name = 'job'"),
      /legacy_boundary is fixed by drizzle\/0006/,
    );
  });
  const setBoundary = (t: string, max: string) => moveBoundary(t, max);
  for (const [t, m] of [
    ['job', lockedPks.j],
    ['job_part', lockedPks.p],
    ['quotation', lockedPks.q],
    ['sale_order', lockedPks.s],
  ] as const)
    await setBoundary(t, m);
  invalidate('legacy_boundary');
  const jobMoney = (no: string) =>
    one<{ svc: string; total: string; paid: string }>(
      sql`SELECT service_cost::text AS svc, job_total_cost::text AS total, job_payment_amount::text AS paid
            FROM job WHERE job_no = ${no}`,
    );

  await test('job: figuresLocked names the recorded money for the clerk, nothing for System Admin', async () => {
    assert.ok((await getJob(lj.no, CLERK.id))!.figuresLocked.includes('serviceCost'));
    assert.deepEqual((await getJob(lj.no, ADMIN.id))!.figuresLocked, []);
    assert.deepEqual(
      (await getJob(lj.no, CLERK.id))!.parts.map((p) => p.figuresLocked),
      [true],
    );
  });
  await test('job: the clerk changing a recorded service cost → 403, nothing changed; System Admin → saved + audited', async () => {
    const before = await jobMoney(lj.no);
    const v = (await getJob(lj.no))!;
    assert.equal(
      await statusOf(saveRepair(lj.no, { status: v.status, version: v.version, serviceCost: 999 } as never, CLERK.id)),
      403,
    );
    assert.deepEqual(await jobMoney(lj.no), before);
    const from = await one<{ m: string }>(sql`SELECT coalesce(max(pk), 0)::text AS m FROM audit_log`);
    await saveRepair(lj.no, { status: v.status, version: v.version, serviceCost: 450 } as never, ADMIN.id);
    assert.equal((await jobMoney(lj.no)).svc, '450.00');
    const a = await one<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM audit_log WHERE pk > ${from.m}::bigint AND entity = 'job' AND entity_key = ${lj.no}
            AND actor_pk = ${ADMIN.id} AND changes ? 'serviceCost'`,
    );
    assert.equal(a.n, 1);
  });
  await test('job, through the route: the refusal is one security_log DENIED (permission "legacy figures", the job named)', async () => {
    const { NextRequest } = await import('next/server');
    const { signSession, SESSION_COOKIE } = await import('@/lib/session');
    const { POST } = await import('@/app/api/jobs/[id]/repair/route');
    const v = (await getJob(lj.no))!;
    const now = Date.now();
    const cookie = `${SESSION_COOKIE}=${await signSession({ email: CLERK.email, name: 'c', exp: now + 6e5, iat: now, sv: 1 })}`;
    const from = await one<{ a: string; s: string }>(
      sql`SELECT (SELECT coalesce(max(pk), 0) FROM audit_log)::text AS a, (SELECT coalesce(max(pk), 0) FROM security_log)::text AS s`,
    );
    const res = await POST(
      new NextRequest(`https://svc.example.test/api/jobs/${v.id}/repair`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', 'user-agent': 'test-qa-owner-rules' },
        body: JSON.stringify({ status: v.status, version: v.version, serviceCost: 998 }),
      }),
      { params: Promise.resolve({ id: v.id }) },
    );
    assert.equal(res.status, 403);
    const rows = (
      await db.execute<{ e: string; p: string | null; ent: string | null; id: string | null; no: string | null }>(
        sql`SELECT event || ' ' || result AS e, permission AS p, entity AS ent, entity_id::text AS id, entity_no AS no
              FROM security_log WHERE pk > ${from.s}::bigint AND actor_pk = ${CLERK.id}`,
      )
    ).rows;
    assert.equal(rows.length, 1, JSON.stringify(rows));
    assert.deepEqual([rows[0]!.e, rows[0]!.p, rows[0]!.ent], ['DENIED DENIED', 'legacy figures', 'job']);
    assert.ok(rows[0]!.id === v.id || rows[0]!.no === lj.no, JSON.stringify(rows[0]));
    const audits = await one<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_log WHERE pk > ${from.a}::bigint`);
    assert.equal(audits.n, 0, 'a refused change writes no audit_log row');
  });
  await test("job: the clerk changing a legacy part line's qty → 403; adding a new line → allowed", async () => {
    const v = (await getJob(lj.no))!;
    const keep = { ...NEW_PART, logId: v.parts[0]!.logId };
    assert.equal(
      await statusOf(
        saveRepair(
          lj.no,
          { status: v.status, version: v.version, parts: [{ ...keep, a: { ...keep.a, qty: 3 } }] } as never,
          CLERK.id,
        ),
      ),
      403,
    );
    const n = async () =>
      (await one<{ n: number }>(sql`SELECT count(*)::int AS n FROM job_part WHERE job_pk = ${lockedPks.j}::bigint`)).n;
    assert.equal(await n(), 1);
    await saveRepair(
      lj.no,
      {
        status: v.status,
        version: v.version,
        parts: [keep, NEW_PART],
      } as never,
      CLERK.id,
    );
    assert.equal(await n(), 2);
  });
  await test("job: the status flow and an EMPTY payment filled at the close stay the clerk's", async () => {
    // the store issues the requested parts first (ซ่อมเสร็จ waits for them)
    const pending = (await getJob(lj.no))!.parts.filter((p) => p.need > 0);
    await issueForJob({ jobNo: lj.no, lines: pending.map((p) => ({ logId: p.logId, qty: p.need })) }, ADMIN.id);
    let v = (await getJob(lj.no))!;
    await saveRepair(lj.no, { status: await statusName(5), version: v.version } as never, CLERK.id);
    assert.equal((await getJob(lj.no))!.statusId, 5);
    v = (await getJob(lj.no))!;
    await closeJob(
      lj.no,
      {
        status: await statusName(20),
        payment: { type: 'เงินสด', amount: 100, no: '', detail: '' },
        return: { type: 'รับเอง', date: today() },
        version: v.version,
      } as never,
      CLERK.id,
    );
    assert.equal((await jobMoney(lj.no)).paid, '100.00');
  });
  await test('quotation: figuresLocked; the clerk changing a recorded line → 403; adding a line → allowed; admin → allowed', async () => {
    const q = (await getQuotation(lq.no))!;
    assert.equal(q.figuresLocked, true);
    // the stored lines go back by their id (a line without one is a new line)
    const partId = q.lines.find((l) => l.itemType === 'SparePart')!.id;
    const svcId = q.lines.find((l) => l.itemType === 'Service')!.id;
    const svc = { ...SERVICE_LINE, id: svcId };
    const net = async () =>
      (await one<{ n: string }>(sql`SELECT net_amount::text AS n FROM quotation WHERE quotation_no = ${lq.no}`)).n;
    const before = await net();
    assert.equal(
      await statusOf(
        saveQuotation(
          quote(lj.no, { no: lq.no, version: q.version, lines: [qLine({ qty: 5, id: partId }), svc] }),
          CLERK.id,
        ),
      ),
      403,
    );
    assert.equal(await net(), before);
    const added = await saveQuotation(
      quote(lj.no, {
        no: lq.no,
        version: q.version,
        lines: [qLine({ id: partId }), svc, qLine({ detail: 'QOR เพิ่ม' })],
      }),
      CLERK.id,
    );
    assert.equal(added.lines.length, 3);
    const from = await one<{ m: string }>(sql`SELECT coalesce(max(pk), 0)::text AS m FROM audit_log`);
    await saveQuotation(
      quote(lj.no, { no: lq.no, version: added.version, lines: [qLine({ qty: 2, id: partId }), svc] }),
      ADMIN.id,
      true,
    );
    const a = await one<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM audit_log WHERE pk > ${from.m}::bigint AND actor_pk = ${ADMIN.id}
            AND entity = 'quotation'`,
    );
    assert.ok(a.n >= 1);
  });
  await test('sale order: figuresLocked; the clerk changing a recorded line → 403; System Admin → allowed', async () => {
    const o = (await getSaleOrder(ls.no))!;
    assert.equal(o.figuresLocked, true);
    const idOf = (type: string) => o.lines.find((l) => l.type === type)!.id;
    const changed = await so({
      no: ls.no,
      version: o.version,
      lines: [
        { id: idOf('SparePart'), code: PART, qty: 7, price: 100, type: 'SparePart' },
        { id: idOf('Service'), code: 'SV0001', qty: 1, price: 150, name: 'ค่าบริการ QOR', type: 'Service' },
      ],
    });
    assert.equal(await statusOf(saveSaleOrder(changed, { pk: CLERK.id, isAdmin: false })), 403);
    assert.equal((await getSaleOrder(ls.no))!.lines[0]!.qty, 2);
    await saveSaleOrder(changed, { pk: ADMIN.id, isAdmin: true });
    assert.equal((await getSaleOrder(ls.no))!.lines[0]!.qty, 7);
  });
  await test('a row past the boundary (new) is not locked: figuresLocked false / []', async () => {
    const fresh = await saveSaleOrder(await so(), { pk: ADMIN.id, isAdmin: true });
    assert.equal((await getSaleOrder(fresh.no))!.figuresLocked, false);
    const nj = await newJob();
    assert.deepEqual((await getJob(nj.no, CLERK.id))!.figuresLocked, []);
  });
} finally {
  for (const b of boundaryBefore) await moveBoundary(b.t, b.m);
  invalidate('legacy_boundary');
  await pool.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
