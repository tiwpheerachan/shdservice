/**
 * scripts/test-qa-lines.mts — quotation / sale order lines matched by their id (uuid), updated in place:
 *   existing lines are sent back with their `id`, a new line without one; an unknown or repeated id → 400; a stored line
 *   whose id is not sent is deleted; only the changed columns of a line are written, and any line change bumps the
 *   header's row_version (the version). A legacy document (legacy_boundary) keeps every recorded line as it is.
 *
 * Runs ONLY against a throwaway local test database (TEST_DATABASE_URL=…_test, npm run db:test:prepare):
 *   API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-lines.mts
 * Fixtures (reset at every start): users 9581 (admin) / 9582 (clerk), customer QLNC01 = 9581, parts QLNP1 / QLNP2 =
 * 9581 / 9582, job J9958101, legacy quotation QLNQ01 and sale order QLNS01. legacy_boundary (immutable after 0006) is
 * moved for the legacy cases with its triggers off — test database only — and put back in `finally`.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.SESSION_SECRET = 'unit-test-session-secret-0123456789abcdef';

const { db, pool } = await import('@/db/client');
const { invalidate } = await import('@/server/cache');
const { saveQuotation, getQuotation } = await import('@/server/services/quotations');
const { saveSaleOrder, getSaleOrder } = await import('@/server/services/sale-orders');

const ADMIN = { pk: 9581, email: 'qln-admin@example.invalid', isAdmin: true, type: 'System Admin' };
const CLERK = { pk: 9582, email: 'qln-clerk@example.invalid', isAdmin: false, type: 'QLN Clerk' };
const CUSTOMER = 'QLNC01';
const P1 = 'QLNP1';
const P2 = 'QLNP2';
const JOB = 'J9958101'; // J + 7 digits (the quotation form's rule)

const one = async <T,>(q: ReturnType<typeof sql>) => (await db.execute<T & Record<string, unknown>>(q)).rows[0]!;
const statusOf = (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: { status?: number }) => e.status ?? 500,
  );

async function seed() {
  await pool.query(`
    INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
      SELECT * FROM (VALUES (1, 'รับงานใหม่', 1, 'Open', true), (2, 'กำลังดำเนินการ', 2, 'Open', true)) v(a, b, c, d, e)
       WHERE NOT EXISTS (SELECT 1 FROM job_status s WHERE s.job_status_id = v.a);
    INSERT INTO quotation_status (quotation_status_id, quotation_status_name)
      SELECT * FROM (VALUES (1, 'รอเสนอราคา'), (2, 'เสนอราคาแล้ว'), (3, 'ลูกค้าตกลงซ่อม'), (5, 'ยกเลิกใบเสนอราคา')) v(id, name)
       WHERE NOT EXISTS (SELECT 1 FROM quotation_status s WHERE s.quotation_status_id = v.id);
    INSERT INTO approve_status (approve_status_id, approve_name_th)
      SELECT * FROM (VALUES (1, 'กำลังดำเนินการจัดทำ'), (2, 'รออนุมัติ'), (3, 'แก้ไขข้อมูล'), (4, 'อนุมัติแล้ว'), (5, 'ปฏิเสธ')) v(id, name)
       WHERE NOT EXISTS (SELECT 1 FROM approve_status s WHERE s.approve_status_id = v.id);
    INSERT INTO role_permission (user_type, module_name, can_insert, can_edit, can_delete, can_view)
      SELECT '${CLERK.type}', m, true, true, true, true FROM unnest(ARRAY['Quotation', 'Sale Order']) m
    ON CONFLICT (user_type, module_name) DO NOTHING;
    -- users stay (audit_log, append-only, points at them): reset in place
    INSERT INTO app_user (pk, first_name, last_name, email_address, user_type, record_status, session_version)
      OVERRIDING SYSTEM VALUE VALUES
        (${ADMIN.pk}, 'QLN', 'admin', '${ADMIN.email}', '${ADMIN.type}', 'ACTIVE', 1),
        (${CLERK.pk}, 'QLN', 'clerk', '${CLERK.email}', '${CLERK.type}', 'ACTIVE', 1)
      ON CONFLICT (pk) DO UPDATE SET email_address = excluded.email_address, user_type = excluded.user_type,
        record_status = excluded.record_status, session_version = excluded.session_version, last_login = DEFAULT;
    INSERT INTO model (model_code, model_name, record_status)
      SELECT 'TST-M', 'Test model', 'ACTIVE' WHERE NOT EXISTS (SELECT 1 FROM model WHERE model_code = 'TST-M');

    -- children before parents (every relation is a RESTRICT foreign key)
    CREATE TEMP TABLE qln_q ON COMMIT DROP AS
      SELECT pk FROM quotation WHERE customer_pk = 9581 OR quotation_no LIKE 'QLN%';
    CREATE TEMP TABLE qln_s ON COMMIT DROP AS
      SELECT pk FROM sale_order WHERE customer_pk = 9581 OR sale_order_no LIKE 'QLN%';
    UPDATE job SET approved_quotation_pk = NULL WHERE approved_quotation_pk IN (SELECT pk FROM qln_q);
    DELETE FROM quotation_line WHERE quotation_pk IN (SELECT pk FROM qln_q);
    DELETE FROM quotation WHERE pk IN (SELECT pk FROM qln_q);
    DELETE FROM sale_order_line WHERE sale_order_pk IN (SELECT pk FROM qln_s) OR product_pk IN (9581, 9582);
    DELETE FROM sale_order WHERE pk IN (SELECT pk FROM qln_s);
    DELETE FROM job_status_log WHERE job_pk IN (SELECT pk FROM job WHERE job_no = '${JOB}' OR customer_pk = 9581);
    DELETE FROM job WHERE job_no = '${JOB}' OR customer_pk = 9581;
    DELETE FROM customer WHERE pk = 9581 OR customer_code = '${CUSTOMER}';
    DELETE FROM product_stock WHERE product_pk IN (9581, 9582) OR pk IN (9581, 9582);
    DELETE FROM quotation_line WHERE product_pk IN (9581, 9582);
    DELETE FROM product WHERE pk IN (9581, 9582) OR product_code IN ('${P1}', '${P2}');

    INSERT INTO customer (pk, customer_code, customer_name, phone_number) OVERRIDING SYSTEM VALUE
      VALUES (9581, '${CUSTOMER}', 'ลูกค้า QLN', '02-958-1000');
    INSERT INTO product (pk, product_code, product_name, record_status) OVERRIDING SYSTEM VALUE
      VALUES (9581, '${P1}', 'อะไหล่ QLN 1', 'ACTIVE'), (9582, '${P2}', 'อะไหล่ QLN 2', 'ACTIVE');
    INSERT INTO product_stock (pk, product_pk, quantity_available, quantity_used, quantity_booking, quantity_remain, retail_price)
      OVERRIDING SYSTEM VALUE VALUES (9581, 9581, 100, 0, 0, 100, 100.00), (9582, 9582, 100, 0, 0, 100, 200.00);
    INSERT INTO job (job_no, job_status_id, customer_pk, model_pk, job_create_date, job_reception_date, record_status)
      VALUES ('${JOB}', 2, 9581, (SELECT pk FROM model WHERE model_code = 'TST-M'), now(), current_date, 'ACTIVE');

    -- a legacy quotation and sale order as the dump brings them: the code stored as text beside product_pk
    INSERT INTO quotation (quotation_no, customer_pk, job_pk, create_date, created_by_app_user_pk, quotation_status_id,
                           spare_part_amount, service_amount, sum_exclude_amount, discount_amount, after_discount_amount,
                           total_base_amount, vat_rate, vat_amount, total_amount, rounding_amount, net_amount, record_status)
      VALUES ('QLNQ01', 9581, (SELECT pk FROM job WHERE job_no = '${JOB}'), '2023-02-01 10:00', ${ADMIN.pk}, 1,
              300, 0, 300, 0, 300, 300, 0, 0, 300, 0, 300, 'ACTIVE');
    INSERT INTO quotation_line (quotation_pk, line_number, item_type, item_code, product_pk, item_detail, quantity,
                                unit_price, unit_price_discount, total_price, unit_price_discount_percent)
      SELECT (SELECT pk FROM quotation WHERE quotation_no = 'QLNQ01'), v.n, 'SparePart', v.code, v.p, v.d, v.q, 100, 0,
             100 * v.q, 0
        FROM (VALUES (1, '${P1}', 9581, 'อะไหล่ QLN 1 (เดิม)', 1), (2, '${P1}', 9581, 'อะไหล่ QLN 1 อีกชิ้น', 2)) v(n, code, p, d, q);
    INSERT INTO sale_order (sale_order_no, document_create_date, created_by_app_user_pk, customer_pk, total_base_amount,
                            vat_rate, vat_amount, total_amount, rounding_amount, fee_amount, net_amount,
                            sale_out_by_app_user_pk, approve_status_id, record_status)
      VALUES ('QLNS01', '2023-02-02 10:00', ${ADMIN.pk}, 9581, 300, 0, 0, 300, 0, 0, 300, ${ADMIN.pk}, 1, 'ACTIVE');
    INSERT INTO sale_order_line (sale_order_pk, list_no, product_pk, capital_price, wholesale_price, retail_price,
                                 sale_out_price, sale_out_quantity, amount, remark, product_code)
      SELECT (SELECT pk FROM sale_order WHERE sale_order_no = 'QLNS01'), v.n, 9581, 60, 80, 100, 100, v.q, 100 * v.q, '',
             '${P1}'
        FROM (VALUES (1, 1), (2, 2)) v(n, q);
  `);
}

/** TEST DATABASE ONLY: legacy_boundary is immutable once 0006 filled it — moved with its triggers off */
async function moveBoundary(table: string, max: string) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('ALTER TABLE legacy_boundary DISABLE TRIGGER USER');
    await c.query('UPDATE legacy_boundary SET max_pk = $2 WHERE table_name = $1', [table, max]);
    await c.query('ALTER TABLE legacy_boundary ENABLE TRIGGER USER');
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

/* one adapter per document kind: create, read, save, the stored line rows */
type Line = { id?: string; code: string; qty: number; detail?: string };
type Kind = {
  name: string;
  create: (lines: Line[]) => Promise<string>;
  read: (
    no: string,
  ) => Promise<{ version: number; lines: { id: string; code: string; qty: number; detail?: string }[] }>;
  save: (no: string, version: number, lines: Line[], by: typeof ADMIN | typeof CLERK) => Promise<unknown>;
  /** every stored line of the document, all columns, oldest first */
  rows: (no: string) => Promise<Record<string, unknown>[]>;
  /** the stored code column and product of a row */
  codeOf: (r: Record<string, unknown>) => [unknown, unknown];
  legacyNo: string;
  tables: [string, string];
};
const salesId = async () =>
  (await one<{ id: string }>(sql`SELECT id::text AS id FROM app_user WHERE pk = ${ADMIN.pk}`)).id;
const QUOTE: Kind = {
  name: 'quotation',
  legacyNo: 'QLNQ01',
  tables: ['quotation', 'quotation_line'],
  create: async (lines) => (await QUOTE.save('', 0, lines, ADMIN)) as string,
  read: async (no) => {
    const q = (await getQuotation(no))!;
    // what the page shows goes back as it is (the detail text too)
    return {
      version: q.version,
      lines: q.lines.map((l) => ({ id: l.id, code: l.code, qty: l.qty, detail: l.detail })),
    };
  },
  save: async (no, version, lines, by) => {
    const q = await saveQuotation(
      {
        ...(no ? { no, version } : {}),
        customerCode: CUSTOMER,
        jobNo: JOB,
        lines: lines.map((l) => ({
          ...(l.id ? { id: l.id } : {}),
          itemType: 'SparePart',
          code: l.code,
          detail: l.detail ?? 'QLN',
          qty: l.qty,
          unitPrice: 100,
          discount: 0,
          discountPercent: 0,
        })),
      } as Parameters<typeof saveQuotation>[0],
      by.pk,
      by.isAdmin,
    );
    return q.no;
  },
  rows: async (no) =>
    (
      await db.execute<{ r: Record<string, unknown> }>(
        sql`SELECT to_jsonb(l) AS r FROM quotation_line l JOIN quotation q ON q.pk = l.quotation_pk
             WHERE q.quotation_no = ${no} ORDER BY l.pk`,
      )
    ).rows.map((x) => x.r),
  codeOf: (r) => [r.item_code, r.product_pk],
};
const ORDER: Kind = {
  name: 'sale order',
  legacyNo: 'QLNS01',
  tables: ['sale_order', 'sale_order_line'],
  create: async (lines) => (await ORDER.save('', 0, lines, ADMIN)) as string,
  read: async (no) => {
    const o = (await getSaleOrder(no))!;
    return { version: o.version, lines: o.lines.map((l) => ({ id: l.id, code: l.code, qty: l.qty })) };
  },
  save: async (no, version, lines, by) => {
    const o = await saveSaleOrder(
      {
        ...(no ? { no, version } : {}),
        customerCode: CUSTOMER,
        salesId: await salesId(),
        submit: false,
        paymentType: '',
        paymentAmount: '',
        lines: lines.map((l) => ({
          ...(l.id ? { id: l.id } : {}),
          code: l.code,
          qty: l.qty,
          price: 100,
          type: 'SparePart',
        })),
      } as Parameters<typeof saveSaleOrder>[0],
      { pk: by.pk, isAdmin: by.isAdmin },
    );
    return o.no;
  },
  rows: async (no) =>
    (
      await db.execute<{ r: Record<string, unknown> }>(
        sql`SELECT to_jsonb(l) AS r FROM sale_order_line l JOIN sale_order s ON s.pk = l.sale_order_pk
             WHERE s.sale_order_no = ${no} ORDER BY l.pk`,
      )
    ).rows.map((x) => x.r),
  codeOf: (r) => [r.product_code, r.product_pk],
};

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    const details = (e as { details?: unknown }).details;
    console.log(
      `  ✗ ${name}\n      ${e instanceof Error ? e.message : e}${details ? ` ${JSON.stringify(details)}` : ''}`,
    );
  }
}

await seed();
const boundaryBefore = (
  await pool.query<{ t: string; m: string }>('SELECT table_name AS t, max_pk::text AS m FROM legacy_boundary')
).rows;
try {
  for (const K of [QUOTE, ORDER]) {
    console.log(`\n${K.name}`);
    await test(`${K.name}: the same part on two lines — editing the second line's qty changes only that row`, async () => {
      const no = await K.create([
        { code: P1, qty: 1 },
        { code: P1, qty: 2 },
      ]);
      const d = await K.read(no);
      const [a, b] = await K.rows(no);
      await K.save(no, d.version, [{ ...d.lines[0]! }, { ...d.lines[1]!, qty: 5 }], CLERK);
      const after = await K.rows(no);
      assert.equal(after.length, 2);
      assert.deepEqual(after[0], a, 'the first line untouched');
      assert.deepEqual([after[1]!.pk, after[1]!.id], [b!.pk, b!.id], 'the second line updated in place');
      assert.equal(Number(K === QUOTE ? after[1]!.quantity : after[1]!.sale_out_quantity), 5);
      assert.ok((await K.read(no)).version > d.version, 'a line change bumps the header version');
    });
    await test(`${K.name}: two lines of the same part — dropping the second deletes that one, the first stays as it was`, async () => {
      const no = await K.create([
        { code: P1, qty: 1 },
        { code: P1, qty: 2 },
      ]);
      const d = await K.read(no);
      const [a] = await K.rows(no);
      await K.save(no, d.version, [{ ...d.lines[0]! }], CLERK);
      assert.deepEqual(await K.rows(no), [a]);
    });
    await test(`${K.name}: an unknown line id → 400; the same id twice → 400; nothing saved`, async () => {
      const no = await K.create([{ code: P1, qty: 1 }]);
      const d = await K.read(no);
      const before = await K.rows(no);
      assert.equal(await statusOf(K.save(no, d.version, [{ id: randomUUID(), code: P1, qty: 1 }], CLERK)), 400);
      assert.equal(
        await statusOf(
          K.save(
            no,
            d.version,
            [
              { ...d.lines[0]!, qty: 1 },
              { ...d.lines[0]!, qty: 2 },
            ],
            CLERK,
          ),
        ),
        400,
      );
      assert.deepEqual(await K.rows(no), before);
    });
    await test(`${K.name}: a save on the version before another user's line change → 409, that change stands`, async () => {
      const no = await K.create([{ code: P1, qty: 1 }]);
      const d = await K.read(no);
      await K.save(no, d.version, [{ ...d.lines[0]!, qty: 3 }], ADMIN);
      assert.equal(await statusOf(K.save(no, d.version, [{ ...d.lines[0]!, qty: 4 }], CLERK)), 409);
      assert.equal((await K.read(no)).lines[0]!.qty, 3);
    });
    await test(`${K.name}: another part on an existing (new-data) line updates the same row — product_pk changed, no code text`, async () => {
      const no = await K.create([{ code: P1, qty: 1 }]);
      const d = await K.read(no);
      const [a] = await K.rows(no);
      await K.save(no, d.version, [{ ...d.lines[0]!, code: P2 }], CLERK);
      const [b, ...rest] = await K.rows(no);
      assert.deepEqual(rest, []);
      assert.deepEqual([b!.pk, b!.id], [a!.pk, a!.id], 'the same row');
      assert.deepEqual(K.codeOf(b!), [null, 9582]);
      assert.equal((await K.read(no)).lines[0]!.code, P2, 'the read shows the new part');
    });
    await test(`${K.name}: a line added to a LEGACY document — every recorded line row stays byte-identical, one row inserted`, async () => {
      const [hd, dt] = K.tables;
      const pks = await one<{ h: string; d: string }>(
        sql`SELECT (SELECT max(pk) FROM ${sql.raw(hd)})::text AS h, (SELECT max(pk) FROM ${sql.raw(dt)})::text AS d`,
      );
      await moveBoundary(hd, pks.h);
      await moveBoundary(dt, pks.d);
      invalidate('legacy_boundary');
      const before = await K.rows(K.legacyNo);
      assert.equal(before.length, 2);
      assert.deepEqual(K.codeOf(before[0]!), [P1, 9581], 'the legacy rows hold the code text');
      const d = await K.read(K.legacyNo);
      await K.save(K.legacyNo, d.version, [...d.lines, { code: P2, qty: 1 }], CLERK);
      const after = await K.rows(K.legacyNo);
      assert.equal(after.length, 3);
      assert.deepEqual(after.slice(0, 2), before, 'pk, id, code text and figures of the recorded lines unchanged');
      assert.deepEqual(K.codeOf(after[2]!), [null, 9582], 'the new line: product_pk, no code text');
      // the history names the line change readably (codes, never pks): 2 lines before, 3 after
      const log = await one<{ lines: [string[], string[]] | null }>(
        sql`SELECT changes->'lines' AS lines FROM audit_log WHERE entity = ${hd} AND entity_no = ${K.legacyNo}
             ORDER BY pk DESC LIMIT 1`,
      );
      assert.ok(log.lines, 'the edit logs its lines');
      assert.deepEqual([log.lines[0].length, log.lines[1].length], [2, 3]);
      assert.ok(
        log.lines[1].some((l) => l.includes(P2)),
        'the added line by its code',
      );
      // and a recorded line is System Admin's alone: changing one or dropping one → 403 for the clerk
      const v = (await K.read(K.legacyNo)).version;
      const now = (await K.read(K.legacyNo)).lines;
      assert.equal(await statusOf(K.save(K.legacyNo, v, [{ ...now[0]!, qty: 9 }, now[1]!, now[2]!], CLERK)), 403);
      assert.equal(await statusOf(K.save(K.legacyNo, v, [now[0]!, now[2]!], CLERK)), 403);
      assert.deepEqual((await K.rows(K.legacyNo)).slice(0, 2), before);
    });
  }
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
