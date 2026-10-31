/**
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-inactive.mts
 * An INACTIVE customer / product goes on no new document (a document already on it
 * keeps it); a partial issue / a return from a job moves the job's version, so a repair page opened before is stale.
 * Same harness as scripts/test-qa-jobs.mts; its own fixtures (ids 945x, codes QI*, users qi-*), reset at every start.
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
const { issueForJob, returnFromJob } = await import('@/server/services/stock');
const { createJob, getJob, saveRepair, updateJob } = await import('@/server/services/jobs');
const { saveQuotation } = await import('@/server/services/quotations');
const { saveSaleOrder } = await import('@/server/services/sale-orders');
const { addDays, today } = await import('@/lib/dates');

const ADMIN = { id: 9451, email: 'qi-admin@example.invalid' };
const by = { pk: ADMIN.id, isAdmin: true };
const C = { on: 'QIC001', off: 'QIC002' }; // QIC002 INACTIVE
const P = { on: 'QIP1', off: 'QIP2' }; // QIP2 INACTIVE
const J = (n: number) => `QIJ${String(n).padStart(4, '0')}`;
const QJOB = 'J9904501'; // a quotation's job no is J + 7 digits
/** the fixture jobs' / customers' pks — what their logs, part lines, documents point at */
const JOBS = `(SELECT pk FROM job WHERE job_no LIKE 'QIJ%' OR job_no = 'J9904501' OR customer_pk IN (9451, 9452))`;
const QUOTES = `(SELECT pk FROM quotation WHERE customer_pk IN (9451, 9452) OR job_pk IN ${JOBS})`;
const OFF_CUSTOMER = 'ลูกค้ารายนี้ปิดใช้งาน (Inactive) — เปิดใช้งานก่อน หรือเลือกรายอื่น';

await pool.query(`
  INSERT INTO stock_move_type (stock_move_type_id, stock_move_type_name, movement_action_type, movement_action, is_active)
    SELECT * FROM (VALUES (1, 'รับเข้า', 'รับเข้า', 1, true), (2, 'รับคืนจากการเบิก', 'รับเข้า', 1, true),
                          (3, 'จ่ายออกตามงานซ่อม', 'จ่ายออก', -1, true), (4, 'จ่ายออกตามใบสั่งขาย', 'จ่ายออก', -1, true),
                          (5, 'จ่ายออกอื่นๆ', 'จ่ายออก', -1, true)) v(id, name, kind, act, on_)
     WHERE NOT EXISTS (SELECT 1 FROM stock_move_type t WHERE t.stock_move_type_id = v.id);
  INSERT INTO store_location (store_location_id, store_location_name, is_active)
    SELECT * FROM (VALUES (1, 'คลังสินค้าดี', true), (2, 'คลังสินค้าเสีย', true)) v(id, name, on_)
     WHERE NOT EXISTS (SELECT 1 FROM store_location s WHERE s.store_location_id = v.id);
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
  INSERT INTO job_part_status (job_part_status_id, job_part_status_name)
    SELECT * FROM (VALUES (1, 'เบิก'), (2, 'ขอคืน'), (3, 'จ่ายแล้ว'), (4, 'ยกเลิก'), (5, 'คืนแล้ว')) v(id, name)
     WHERE NOT EXISTS (SELECT 1 FROM job_part_status s WHERE s.job_part_status_id = v.id);
  INSERT INTO approve_status (approve_status_id, approve_name_th, approve_name_en, is_can_edit, is_can_revise)
    SELECT * FROM (VALUES (1, 'กำลังดำเนินการจัดทำ', 'In Progess', true, true), (2, 'รออนุมัติ', 'Wait Approve', true, true),
                          (3, 'แก้ไขข้อมูล', 'Reject', true, true), (4, 'อนุมัติแล้ว', 'Approved', false, false),
                          (5, 'ปฏิเสธ', 'Deny', false, false)) v(id, th, en, ed, rv)
     WHERE NOT EXISTS (SELECT 1 FROM approve_status s WHERE s.approve_status_id = v.id);
  INSERT INTO condition (condition_id, condition_name, is_active)
    SELECT 1, 'สินค้าใหม่', true WHERE NOT EXISTS (SELECT 1 FROM condition WHERE condition_id = 1);
  -- the user stays (audit_log, append-only, points at it): reset in place
  INSERT INTO app_user (pk, first_name, last_name, email_address, user_type, record_status, session_version) OVERRIDING SYSTEM VALUE
    VALUES (${ADMIN.id}, 'QI', 'admin', '${ADMIN.email}', 'System Admin', 'ACTIVE', 1)
    ON CONFLICT (pk) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
      email_address = excluded.email_address, user_type = excluded.user_type, record_status = excluded.record_status,
      session_version = excluded.session_version, last_login = DEFAULT;
  -- children before parents (every relation is a RESTRICT foreign key, drizzle/0006); a job points at its approved
  -- quotation and the quotation at its job: that link goes first
  UPDATE job SET approved_quotation_pk = NULL WHERE pk IN ${JOBS};
  DELETE FROM quotation_line WHERE quotation_pk IN ${QUOTES};
  DELETE FROM quotation WHERE pk IN ${QUOTES};
  DELETE FROM sale_order_line WHERE sale_order_pk IN (SELECT pk FROM sale_order WHERE customer_pk IN (9451, 9452));
  DELETE FROM sale_order WHERE customer_pk IN (9451, 9452);
  DELETE FROM stock_move_line WHERE product_pk IN (9451, 9452)
     OR stock_move_pk IN (SELECT pk FROM stock_move WHERE job_pk IN ${JOBS});
  DELETE FROM stock_move WHERE job_pk IN ${JOBS};
  DELETE FROM job_status_log WHERE job_pk IN ${JOBS};
  DELETE FROM job_part WHERE job_pk IN ${JOBS} OR product_pk IN (9451, 9452);
  DELETE FROM job WHERE pk IN ${JOBS};
  DELETE FROM customer WHERE pk IN (9451, 9452) OR customer_code LIKE 'QIC%';
  INSERT INTO customer (pk, customer_code, customer_name, phone_number, record_status) OVERRIDING SYSTEM VALUE VALUES
    (9451, '${C.on}', 'ลูกค้า QI ใช้งาน', '02-945-0001', 'ACTIVE'), (9452, '${C.off}', 'ลูกค้า QI ปิดใช้งาน', '02-945-0002', 'ACTIVE');
  DELETE FROM product_stock WHERE product_pk IN (9451, 9452) OR pk IN (9451, 9452);
  DELETE FROM product WHERE pk IN (9451, 9452) OR product_code LIKE 'QIP%';
  INSERT INTO product (pk, product_code, product_name, record_status) OVERRIDING SYSTEM VALUE VALUES
    (9451, '${P.on}', 'อะไหล่ QI', 'ACTIVE'), (9452, '${P.off}', 'อะไหล่ QI ปิดใช้งาน', 'ACTIVE');
  INSERT INTO product_stock (pk, product_pk, quantity_available, quantity_used, quantity_booking, quantity_remain, retail_price) OVERRIDING SYSTEM VALUE VALUES
    (9451, 9451, 100, 0, 6, 100, 100.00), (9452, 9452, 100, 0, 1, 100, 50.00);
  -- 1: a job of the customer about to go Inactive; 2: of the active one; 3, 4: a request of 3 (none issued yet);
  -- 5: a request of the product about to go Inactive;
  -- J9904501: the job the quotations are raised for
  -- job.model_pk is NOT NULL (drizzle/0006): a model every fixture job without its own can point at (never deleted)
  INSERT INTO model (model_code, model_name, record_status)
    SELECT 'TST-M', 'Test model', 'ACTIVE' WHERE NOT EXISTS (SELECT 1 FROM model WHERE model_code = 'TST-M');
  INSERT INTO job (model_pk, job_no, job_status_id, customer_pk, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date)
    SELECT (SELECT pk FROM model WHERE model_code = 'TST-M'), 'QIJ' || lpad(n::text, 4, '0'), s, c, 'QI', 'Model QI', now(), current_date, '1900-01-01'
      FROM (VALUES (1, 2, 9452), (2, 2, 9451), (3, 11, 9451), (4, 11, 9451), (5, 11, 9451)) v(n, s, c);
  INSERT INTO job (model_pk, job_no, job_status_id, customer_pk, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date)
    VALUES ((SELECT pk FROM model WHERE model_code = 'TST-M'), 'J9904501', 2, 9451, 'QI', 'Model QI', now(), current_date, '1900-01-01');
  -- 4's request is เบิก only (not charged) and its costs are what a return computes: the return writes no job column
  UPDATE job SET spare_part_total_cost = 0, job_total_cost = 0 WHERE job_no = 'QIJ0004';
  INSERT INTO job_part (job_pk, product_pk, is_quotation, is_special, request_qty,
                                        spare_part_unit_price, spare_part_total_price, job_part_status_id, request_date, requested_by_app_user_pk, grant_qty, return_qty)
    SELECT j.pk, p.pk, v.quote, true, v.qty, v.price, v.total, 1, now(), 9451, 0, 0
      FROM (VALUES ('QIJ0003', '${P.on}', true, 3, 100, 300), ('QIJ0004', '${P.on}', false, 3, 100, 0),
                   ('QIJ0005', '${P.off}', true, 1, 50, 50)) v(no, code, quote, qty, price, total)
      JOIN job j ON j.job_no = v.no JOIN product p ON p.product_code = v.code;
`);
for (const t of ['Inventory-In', 'Inventory-Out'] as const) await db.transaction((tx) => nextRunningNo(tx, t));
await pool.query(`
  UPDATE running_no r SET number = greatest(r.number, coalesce((
    SELECT max(substring(h.stock_move_no FROM length(r.prefix) + 3)::int) FROM stock_move h
     WHERE h.stock_move_no ~ ('^' || r.prefix || right(r.pyear::text, 2) || '[0-9]+$')), 0))
   WHERE r.running_type IN ('Inventory-In', 'Inventory-Out') AND r.length_year = 2`);

/** the admin's app_user.id — what a salesperson pick sends */
const adminUuid = (await pool.query<{ id: string }>('SELECT id::text FROM app_user WHERE pk = $1', [ADMIN.id])).rows[0]!
  .id;
const one = async <T,>(q: ReturnType<typeof sql>) => (await db.execute<T & Record<string, unknown>>(q)).rows[0]!;
const line = (no: string) =>
  one<{
    id: string;
  }> // the request line's uuid — what the pick / repair pages send
  (
    sql`SELECT id::text AS id FROM job_part WHERE job_pk = (SELECT pk FROM job WHERE job_no = ${no}) ORDER BY pk DESC LIMIT 1`,
  );
async function err(p: Promise<unknown>) {
  try {
    await p;
    return { status: 200, message: '' };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, message: e.message };
    throw e;
  }
}
const partLine = (code: string, qty: number, logId?: string) => ({
  logId,
  code,
  unitPrice: 0,
  a: { pick: true, quote: true, qty },
  b: { pick: false, quote: false, qty: 0 },
});
const quoteLine = (code: string) => ({
  itemType: 'SparePart' as const,
  code,
  detail: 'QI',
  qty: 1,
  unit: 'หน่วย',
  unitPrice: 100,
});
const jobEdit = (customerCode: string) => ({
  customerCode,
  modelCode: 'TST-M', // the form always sends the job's model (job.model_pk is NOT NULL)
  jobType: '',
  dueDate: addDays(today(), 30),
  warrantyMonth: 0,
  channel: 'SHOPEE',
});

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
  // documents made while both were Active — they keep their customer / product after the switch
  const oldQuote = await saveQuotation(
    { jobNo: QJOB, customerCode: C.off, contactName: 'QI', lines: [quoteLine(P.off)] },
    ADMIN.id,
  );
  const oldOrder = await saveSaleOrder(
    { customerCode: C.off, salesId: adminUuid, submit: false, lines: [{ code: P.off, qty: 1 }] },
    by,
  );
  await pool.query(`UPDATE customer SET record_status = 'INACTIVE' WHERE customer_code = '${C.off}';
                    UPDATE product SET record_status = 'INACTIVE' WHERE product_code = '${P.off}';`);

  console.log('\n1 · an Inactive customer goes on no new document');
  await test('new job / job moved to it / new quotation / new sale order → 409 with the Inactive message', async () => {
    const calls = {
      createJob: () =>
        createJob(
          {
            customerCode: C.off,
            jobType: 'QI งานซ่อม',
            channel: 'หน้าร้าน',
            warrantyMonth: 12,
            serial: 'QI-1',
            brand: 'QI',
            modelCode: 'QI',
            symptoms: ['QI'],
            dueDate: addDays(today(), 5),
          },
          ADMIN.id,
        ),
      updateJob: () => updateJob(J(2), jobEdit(C.off), ADMIN.id),
      saveQuotation: () =>
        saveQuotation({ jobNo: QJOB, customerCode: C.off, contactName: 'QI', lines: [quoteLine('')] }, ADMIN.id),
      saveSaleOrder: () =>
        saveSaleOrder({ customerCode: C.off, salesId: adminUuid, submit: false, lines: [{ code: P.on, qty: 1 }] }, by),
    };
    for (const [name, call] of Object.entries(calls))
      assert.deepEqual([name, ...Object.values(await err(call()))], [name, 409, OFF_CUSTOMER]);
  });
  await test('documents already on it still save (job / quotation / sale order edits)', async () => {
    const keep = {
      updateJob: () => updateJob(J(1), { ...jobEdit(C.off), remark: 'QI keep' }, ADMIN.id),
      saveQuotation: () =>
        saveQuotation(
          {
            no: oldQuote.no,
            jobNo: QJOB,
            customerCode: C.off,
            contactName: 'QI',
            remark: 'QI keep',
            lines: [{ ...quoteLine(P.off), id: oldQuote.lines[0]!.id }], // the stored line, by its id
          },
          ADMIN.id,
        ),
      saveSaleOrder: () =>
        saveSaleOrder(
          {
            no: oldOrder.no,
            customerCode: C.off,
            salesId: adminUuid,
            submit: false,
            remark: 'QI keep',
            lines: [{ id: oldOrder.lines[0]!.id, code: P.off, qty: 1, price: 50 }], // the stored line, by its id
          },
          by,
        ),
    };
    for (const [name, call] of Object.entries(keep)) {
      const r = await err(call());
      assert.deepEqual([name, r.status], [name, 200], r.message);
    }
  });

  console.log('\n2 · an Inactive product goes on no new / changed line');
  await test('sale order: a new line → 400 naming it; the old order changing its line → 400', async () => {
    const r = await err(
      saveSaleOrder({ customerCode: C.on, salesId: adminUuid, submit: false, lines: [{ code: P.off, qty: 1 }] }, by),
    );
    assert.equal(r.status, 400);
    assert.match(r.message, new RegExp(`${P.off}.*ปิดใช้งาน`));
    const changed = await err(
      saveSaleOrder(
        {
          no: oldOrder.no,
          customerCode: C.off,
          salesId: adminUuid,
          submit: false,
          lines: [{ id: oldOrder.lines[0]!.id, code: P.off, qty: 3, price: 50 }],
        },
        by,
      ),
    );
    assert.equal(changed.status, 400, changed.message);
  });
  await test('quotation: a new line with its code → 409 naming it (a line without a code still saves)', async () => {
    const r = await err(
      saveQuotation(
        { jobNo: QJOB, customerCode: C.on, contactName: 'QI', lines: [quoteLine(P.on), quoteLine(P.off)] },
        ADMIN.id,
      ),
    );
    assert.equal(r.status, 409);
    assert.match(r.message, new RegExp(`${P.off}.*ปิดใช้งาน`));
    assert.equal(
      (
        await err(
          saveQuotation({ jobNo: QJOB, customerCode: C.on, contactName: 'QI', lines: [quoteLine('')] }, ADMIN.id),
        )
      ).status,
      200,
    );
  });
  await test('job: a new request → 409; more of an existing request → 409; the request as it was saves, its issue + return work', async () => {
    const status = (await getJob(J(5)))!.status;
    const id = (await line(J(5))).id;
    const added = await err(
      saveRepair(J(2), { status: (await getJob(J(2)))!.status, parts: [partLine(P.off, 1)] }, ADMIN.id),
    );
    assert.equal(added.status, 409);
    assert.match(added.message, new RegExp(`${P.off}.*ปิดใช้งาน`));
    const more = await err(saveRepair(J(5), { status, parts: [partLine(P.off, 2, id)] }, ADMIN.id));
    assert.equal(more.status, 409, more.message);
    assert.equal((await err(saveRepair(J(5), { status, parts: [partLine(P.off, 1, id)] }, ADMIN.id))).status, 200);
    await issueForJob({ jobNo: J(5), lines: [{ logId: id, qty: 1 }] }, ADMIN.id);
    await returnFromJob({ jobNo: J(5), lines: [{ logId: id, qty: 1 }] }, ADMIN.id);
  });

  console.log('\n3 · a partial issue / a return makes a repair page opened before it stale');
  await test('partial issue: the page loaded before → 409 stale; loaded after → saves', async () => {
    const id = (await line(J(3))).id;
    const before = (await getJob(J(3)))!;
    await issueForJob({ jobNo: J(3), lines: [{ logId: id, qty: 1 }] }, ADMIN.id);
    const stale = await err(saveRepair(J(3), { status: before.status, version: before.version }, ADMIN.id));
    assert.equal(stale.status, 409, 'stale page');
    const after = (await getJob(J(3)))!;
    assert.equal(after.version, before.version + 1, 'one bump');
    assert.equal((await err(saveRepair(J(3), { status: after.status, version: after.version }, ADMIN.id))).status, 200);
  });
  await test('return: the page loaded before → 409 stale; loaded after → saves', async () => {
    const id = (await line(J(4))).id;
    await issueForJob({ jobNo: J(4), lines: [{ logId: id, qty: 1 }] }, ADMIN.id);
    const before = (await getJob(J(4)))!;
    await returnFromJob({ jobNo: J(4), lines: [{ logId: id, qty: 1 }] }, ADMIN.id);
    const stale = await err(saveRepair(J(4), { status: before.status, version: before.version }, ADMIN.id));
    assert.equal(stale.status, 409, 'stale page');
    const after = (await getJob(J(4)))!;
    assert.equal(after.version, before.version + 1, 'one bump');
    assert.equal((await err(saveRepair(J(4), { status: after.status, version: after.version }, ADMIN.id))).status, 200);
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
