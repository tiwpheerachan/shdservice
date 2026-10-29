/**
 * scripts/test-qa-quotes.mts — quotation bugs found by the multi-user QA round (2026-10-21): line discounts
 * and line fields the API took as anything, the job's "agreed quotation" pointer under two approvals / a
 * move, a quotation built from a stale copy of the job's parts, half-cent rounding, expired quotations in
 * the list / filter / export, and what a new quotation may start as.
 *
 * Runs ONLY against a throwaway local test database (TEST_DATABASE_URL=…_test, npm run db:test:prepare):
 *   API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-quotes.mts
 * Seeds its own fixtures (user 9301, customer QQC001, jobs J99031xx) and resets them at every start.
 */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
Object.assign(process.env, { SESSION_SECRET: 'unit-test-session-secret-0123456789abcdef', DB_POOL_MAX: '10' });

const { db, pool } = await import('@/db/client');
const { HttpError } = await import('@/server/auth');
const { signSession, SESSION_COOKIE } = await import('@/lib/session');
const { saveQuotation, getQuotation, pageQuotations, listQuotations } = await import('@/server/services/quotations');
const { getJob } = await import('@/server/services/jobs');
const { computeTotals, quotedPartsKey } = await import('@/lib/validation/quotation');
const { POST: quotationPOST } = await import('@/app/api/quotations/route');

const ADMIN = { id: 9301, email: 'qq-admin@example.invalid' };
const CUSTOMER = 'QQC001';
const J = (n: number) => `J99031${String(n).padStart(2, '0')}`;

async function seed() {
  await pool.query(`
    INSERT INTO quotation_status (quotation_status_id, quotation_status_name)
      SELECT * FROM (VALUES (1, 'รอเสนอราคา'), (2, 'เสนอราคาแล้ว'), (3, 'ลูกค้าตกลงซ่อม'), (4, 'ลูกค้าไม่ตกลงซ่อม'),
                            (5, 'ยกเลิกใบเสนอราคา'), (6, 'ลูกค้าตกลงซ่อม รอชำระเงิน'), (8, 'พ้นกำหนดเสนอราคา'),
                            (9, 'ลูกค้าตกลงซ่อม รออะไหล่')) v(id, name)
       WHERE NOT EXISTS (SELECT 1 FROM quotation_status s WHERE s.quotation_status_id = v.id);
    INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
      SELECT * FROM (VALUES (0, 'ยกเลิก', 0, 'Cancel', true), (1, 'รับงานใหม่', 1, 'Open', true), (2, 'กำลังดำเนินการ', 2, 'Open', true),
                            (3, 'อยู่ระหว่างการซ่อม - รออะไหล่', 35, 'Pending', true),
                            (4, 'อยู่ระหว่างการซ่อม - เสนอราคาลูกค้า', 37, 'Pending', true),
                            (6, 'ยกเลิกซ่อม (ลูกค้าไม่ตกลงซ่อม)', 6, 'Repaired', true),
                            (12, 'อยู่ระหว่างการซ่อม - ลูกค้าตกลงซ่อม', 38, 'Pending', true),
                            (13, 'อยู่ระหว่างการซ่อม - รอเสนอราคา', 36, 'Pending', true),
                            (16, 'อยู่ระหว่างการซ่อม - พ้นกำหนดเสนอราคา', 39, 'Pending', true),
                            (20, 'ปิดงาน (Complete)', 20, 'Finished', true)) v(id, name, ord, grp, act)
       WHERE NOT EXISTS (SELECT 1 FROM job_status s WHERE s.job_status_id = v.id);
    DELETE FROM app_user WHERE user_id = ${ADMIN.id} OR email_address = '${ADMIN.email}';
    INSERT INTO app_user (user_id, first_name, last_name, email_address, user_type, record_status, session_version)
      VALUES (${ADMIN.id}, 'QQ', 'admin', '${ADMIN.email}', 'System Admin', 'ACTIVE', 1);
    DELETE FROM quotation_dt WHERE quotation_no IN (SELECT quotation_no FROM quotation_hd WHERE customer_code = '${CUSTOMER}');
    DELETE FROM quotation_hd WHERE customer_code = '${CUSTOMER}';
    DELETE FROM job_log WHERE job_no LIKE 'J99031%';
    DELETE FROM job_order_spare_part_log WHERE job_no LIKE 'J99031%';
    DELETE FROM job WHERE job_no LIKE 'J99031%';
    DELETE FROM customer WHERE customer_id = 9301 OR customer_code = '${CUSTOMER}';
    INSERT INTO customer (customer_id, customer_code, customer_name, phone_number) VALUES (9301, '${CUSTOMER}', 'ลูกค้า QA ใบเสนอราคา', '02-000-0001');
    DELETE FROM idempotency_key WHERE user_id = ${ADMIN.id};
  `);
}
/** a job of the fixture customer in `status` */
async function mkJob(n: number, status = 2) {
  await pool.query(
    `INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date)
     VALUES ($1, $2, 9301, '${CUSTOMER} ลูกค้า QA', 'Model QQ', now(), current_date, '1900-01-01')`,
    [J(n), status],
  );
  return J(n);
}
const line = (o: Record<string, unknown> = {}) => ({
  itemType: 'SparePart',
  code: '',
  detail: 'QQ รายการ',
  qty: 1,
  unit: 'หน่วย',
  unitPrice: 100,
  discount: 0,
  discountPercent: 0,
  ...o,
});
const base = (jobNo: string, o: Record<string, unknown> = {}) =>
  ({ customerCode: CUSTOMER, jobNo, contactName: 'QQ', lines: [line()], ...o }) as Parameters<typeof saveQuotation>[0];
async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
}
async function errorOf(p: Promise<unknown>): Promise<InstanceType<typeof HttpError>> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpError) return e;
    throw e;
  }
  throw new assert.AssertionError({ message: 'expected a refusal, it saved' });
}
async function post(body: unknown) {
  const now = Date.now();
  const cookie = `${SESSION_COOKIE}=${await signSession({ email: ADMIN.email, name: ADMIN.email, exp: now + 600_000, iat: now, sv: 1 })}`;
  const r = await quotationPOST(
    new NextRequest('https://svc.example.test/api/quotations', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'user-agent': 'test-qa-quotes' },
      body: JSON.stringify(body),
    }),
  );
  const b = (await r.json()) as { details?: { fields?: Record<string, string> }; quotation?: { no: string } };
  return { status: r.status, fields: b.details?.fields ?? {}, body: b };
}
const pointer = async (jobNo: string) =>
  (await db.execute<{ p: string | null }>(sql`SELECT quotation_no_approved AS p FROM job WHERE job_no = ${jobNo}`))
    .rows[0]?.p ?? '';
const AGREED = 'ลูกค้าตกลงซ่อม';

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
// audit_log is append-only and the job numbers repeat every run: read only what this run wrote
const AUDIT_FROM = Number(
  (await db.execute<{ m: string | null }>(sql`SELECT max(id) AS m FROM audit_log`)).rows[0]?.m ?? 0,
);
try {
  console.log('\nBug 1 / 5 — line fields and the บาท discount are checked, never taken as anything');
  const j1 = await mkJob(1);
  await test('B1 line discount > qty×price, negative, 3 decimals → 400 under lines.N.discount', async () => {
    for (const discount of [4900, -5, '10.005']) {
      const r = await post(base(j1, { lines: [line({ discount })] }));
      assert.equal(r.status, 400, `discount ${discount}: ${JSON.stringify(r.body)}`);
      assert.ok(r.fields['lines.0.discount'], `discount ${discount}: ${JSON.stringify(r.fields)}`);
    }
  });
  await test('B1 discountPercent "abc" / 150, itemType "Bogus", unit of 11 chars → 400 with Thai messages', async () => {
    const r = await post(
      base(j1, {
        lines: [
          line({ discountPercent: 'abc' }),
          line({ discountPercent: 150 }),
          line({ itemType: 'Bogus' }),
          line({ unit: 'x'.repeat(11) }),
        ],
      }),
    );
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.deepEqual(Object.keys(r.fields).sort(), [
      'lines.0.discountPercent',
      'lines.1.discountPercent',
      'lines.2.itemType',
      'lines.3.unit',
    ]);
    for (const m of Object.values(r.fields)) assert.match(m, /[ก-๙]/, m);
  });
  // a per-line discount is legacy's ส่วนลด (บาท / %) since 2026-10-29 — its math: scripts/test-qa-quotation.mts
  await test('B1 a per-line discount (บาท or %) saves and lowers the net; 0 saves as before', async () => {
    for (const [extra, net] of [
      [{ discount: 30 }, 70],
      [{ discountPercent: 10 }, 90],
      [{ discount: 0, discountPercent: 0 }, 100],
    ] as const) {
      const r = await post(base(j1, { lines: [line({ qty: 2, unitPrice: 50, ...extra })] }));
      assert.equal(r.status, 201, `${JSON.stringify(extra)}: ${JSON.stringify(r.body)}`);
      assert.equal((await getQuotation(r.body.quotation!.no))!.netAmount, net);
    }
  });
  await test('B5 a บาท discount with 3 decimals → 400 discountValue', async () => {
    const r = await post(
      base(j1, { discountType: 'ส่วนลดรวม', discountValue: '10.555', discountUnit: 'บาท', lines: [line()] }),
    );
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.ok(r.fields.discountValue);
  });

  console.log('\nBug 6 — percentages round half a satang up; VAT stays exact');
  const tot = (parts: number, discountValue: number, vatRate = 0) =>
    computeTotals({ parts, service: 0, discountType: 'ส่วนลดรวม', discountValue, discountUnit: '%', vatRate });
  await test('B6 15 % of 33.30 / 4.10 / 16.90 / 32.30 → 5.00 / 0.62 / 2.54 / 4.85; 7.35 % of 100.10 → 7.36', async () => {
    assert.deepEqual(
      [33.3, 4.1, 16.9, 32.3].map((p) => tot(p, 15).discount),
      [5, 0.62, 2.54, 4.85],
    );
    assert.equal(tot(100.1, 7.35).discount, 7.36); // 7.357… → 7.36
    assert.equal(tot(10, 12.5).discount, 1.25);
  });
  await test('B6 VAT 7 % sweep 0.01–20,000.00: half-up on satang, every value', async () => {
    let bad = '';
    for (let c = 1; c <= 2_000_000 && !bad; c++) {
      const vat = computeTotals({
        parts: c / 100,
        service: 0,
        discountType: 'ไม่มีส่วนลด',
        discountValue: 0,
        discountUnit: '%',
        vatRate: 7,
      }).vat;
      if (vat !== Math.floor((c * 7 + 50) / 100) / 100) bad = `${c / 100} → ${vat}`;
    }
    assert.equal(bad, '');
  });
  await test('B6 a saved 15 % discount on 33.30 stores 5.00 and a net of 28.30', async () => {
    const q = await saveQuotation(
      base(j1, { lines: [line({ unitPrice: 33.3 })], discountType: 'ส่วนลดรวม', discountValue: 15, discountUnit: '%' }),
      ADMIN.id,
    );
    assert.deepEqual([q.discountAmount, q.netAmount], [5, 28.3]);
  });

  console.log('\nBug 2 — one agreed quotation per job, the pointer follows it, every change audited');
  const j2 = await mkJob(2);
  await test('B2 two quotations approved at once → one 200, one 409 naming it; the job points at the winner', async () => {
    const a = await saveQuotation(base(j2, { status: 'เสนอราคาแล้ว' }), ADMIN.id);
    const b = await saveQuotation(base(j2, { status: 'เสนอราคาแล้ว' }), ADMIN.id);
    const res = await Promise.allSettled(
      [a, b].map((q) => saveQuotation(base(j2, { no: q.no, version: q.version, status: AGREED }), ADMIN.id)),
    );
    const ok = res.flatMap((r, k) => (r.status === 'fulfilled' ? [[a, b][k]!.no] : []));
    const refused = res.flatMap((r) => (r.status === 'rejected' ? [r.reason as InstanceType<typeof HttpError>] : []));
    assert.equal(ok.length, 1, `exactly one approved: ${JSON.stringify(res.map((r) => r.status))}`);
    assert.equal(refused[0]?.status, 409);
    assert.match(refused[0]!.message, new RegExp(`ตกลงแล้ว.*${ok[0]}`));
    assert.equal(await pointer(j2), ok[0]);
    // the job's status change names the quotation it followed — the one the job points at
    const moved = await db.execute<{ d: string }>(
      sql`SELECT summary AS d FROM audit_log WHERE id > ${AUDIT_FROM} AND entity = 'job' AND entity_key = ${j2} AND summary LIKE '%ตามใบเสนอราคา%ตกลง%'`,
    );
    assert.deepEqual(
      moved.rows.map((r) => r.d.includes(ok[0]!)),
      [true],
    );
  });
  await test('B2 declining the agreed one clears the pointer; the other can then be approved; both audited', async () => {
    const qs = await listQuotations({ jobNo: j2 });
    const agreed = qs.find((q) => q.status === AGREED)!;
    const other = qs.find((q) => q.status !== AGREED)!;
    const ag = (await getQuotation(agreed.no))!;
    await saveQuotation(base(j2, { no: ag.no, version: ag.version, status: 'ลูกค้าไม่ตกลงซ่อม' }), ADMIN.id);
    assert.equal(await pointer(j2), '');
    const ot = (await getQuotation(other.no))!;
    await saveQuotation(base(j2, { no: ot.no, version: ot.version, status: AGREED }), ADMIN.id);
    assert.equal(await pointer(j2), other.no);
    const audits = await db.execute<{ c: unknown }>(
      sql`SELECT changes AS c FROM audit_log WHERE entity = 'job' AND entity_key = ${j2} AND changes ? 'quotationNoApproved' AND id > ${AUDIT_FROM} ORDER BY id`,
    );
    assert.deepEqual(
      audits.rows.map((r) => (r.c as Record<string, unknown>).quotationNoApproved),
      [
        ['', agreed.no],
        [agreed.no, ''],
        ['', other.no],
      ],
    );
  });
  await test('B2 declining an agreed quotation the job does not point at leaves the pointer alone', async () => {
    // legacy data: a second agreed quotation from before the rule
    const [{ no }] = (
      await db.execute<{ no: string }>(
        sql`SELECT quotation_no AS no FROM quotation_hd WHERE reference_job_no = ${j2} AND quotation_status_id = 4`,
      )
    ).rows;
    await db.execute(sql`UPDATE quotation_hd SET quotation_status_id = 3 WHERE quotation_no = ${no}`);
    const q = (await getQuotation(no))!;
    const keep = await pointer(j2);
    await saveQuotation(base(j2, { no, version: q.version, status: 'ยกเลิกใบเสนอราคา' }), ADMIN.id);
    assert.equal(await pointer(j2), keep);
  });

  console.log('\nBug 3 — an agreed quotation does not change jobs');
  await test('B3 moving an agreed quotation to another job → 409; both jobs as they were', async () => {
    const ja = await mkJob(3),
      jb = await mkJob(4);
    const s = await saveQuotation(base(ja, { status: 'เสนอราคาแล้ว' }), ADMIN.id);
    const q = await saveQuotation(base(ja, { no: s.no, version: s.version, status: AGREED }), ADMIN.id);
    const e = await errorOf(saveQuotation(base(jb, { no: q.no, version: q.version, status: AGREED }), ADMIN.id));
    assert.equal(e.status, 409);
    assert.deepEqual([await pointer(ja), await pointer(jb)], [q.no, '']);
    assert.equal((await getQuotation(q.no))!.jobRef, ja);
  });

  console.log("\nBug 4 — a quotation built from the job's parts is refused when they changed since");
  await test('B4 jobParts from before a parts change → 409 "โหลดใหม่"; the current one saves; none = no check', async () => {
    const j = await mkJob(5);
    await pool.query(
      `INSERT INTO job_order_spare_part_log (job_no, spare_part_code, spare_part_serial_no, stock_id, is_quotation, is_special, request_qty, spare_part_unit_price, order_status_id, request_date, request_by, grant_qty, return_qty)
       VALUES ($1, 'QQP1', '', 1, true, false, 1, 100, 1, now(), ${ADMIN.id}, 0, 0)`,
      [j],
    );
    const stale = quotedPartsKey((await getJob(j))!.parts, 'A');
    await pool.query(`UPDATE job_order_spare_part_log SET request_qty = 2 WHERE job_no = $1`, [j]);
    const e = await errorOf(saveQuotation(base(j, { jobParts: stale }), ADMIN.id));
    assert.equal(e.status, 409);
    assert.match(e.message, /รายการอะไหล่ของงานเปลี่ยนแล้ว/);
    const fresh = quotedPartsKey((await getJob(j))!.parts, 'A');
    assert.notEqual(fresh, stale);
    assert.equal(await statusOf(saveQuotation(base(j, { jobParts: fresh }), ADMIN.id)), 200);
    assert.equal(await statusOf(saveQuotation(base(j), ADMIN.id)), 200);
    // through the API too: the contract carries it
    assert.equal((await post(base(j, { jobParts: stale }))).status, 409);
  });

  console.log('\nBug 7 — an expired quotation reads as expired in the list, its filter and the export');
  await test('B7 sent 10 days ago: list / export say พ้นกำหนดเสนอราคา, that filter finds it, "เสนอราคาแล้ว" does not; the form keeps the stored status', async () => {
    const j = await mkJob(6);
    const q = await saveQuotation(base(j, { status: 'เสนอราคาแล้ว' }), ADMIN.id);
    await db.execute(
      sql`UPDATE quotation_hd SET create_date = now() - interval '10 days' WHERE quotation_no = ${q.no}`,
    );
    const page = (status: string) =>
      pageQuotations({ page: 1, pageSize: 50, q: '', f: {} }, { status, jobNo: j, deleted: 'exclude' });
    const expired = await page('พ้นกำหนดเสนอราคา');
    assert.deepEqual(
      expired.rows.map((r) => [r.no, r.status]),
      [[q.no, 'พ้นกำหนดเสนอราคา']],
    );
    assert.equal((await page('เสนอราคาแล้ว')).total, 0);
    assert.deepEqual(
      (await listQuotations({ jobNo: j })).map((r) => r.status),
      ['พ้นกำหนดเสนอราคา'],
    );
    assert.equal((await getQuotation(q.no))!.status, 'เสนอราคาแล้ว');
  });

  console.log('\nBug 9 — a new quotation starts as draft / sent, on an open job');
  await test('B9 a new quotation saved as agreed / declined → 400 under status', async () => {
    for (const status of [AGREED, 'ลูกค้าไม่ตกลงซ่อม']) {
      const r = await post(base(j1, { status }));
      assert.equal(r.status, 400, `${status}: ${JSON.stringify(r.body)}`);
      assert.ok(r.fields.status, JSON.stringify(r.fields));
    }
    assert.equal((await post(base(j1, { status: 'เสนอราคาแล้ว' }))).status, 201);
  });
  await test('B9 a new quotation on a declined / closed / cancelled job → 409; moving one there too', async () => {
    for (const [n, st] of [
      [7, 6],
      [8, 20],
      [9, 0],
    ] as const) {
      const j = await mkJob(n, st);
      const e = await errorOf(saveQuotation(base(j), ADMIN.id));
      assert.equal(e.status, 409, `job status ${st}`);
      assert.match(e.message, new RegExp(j));
    }
    const q = await saveQuotation(base(j1), ADMIN.id);
    assert.equal(await statusOf(saveQuotation(base(J(8), { no: q.no, version: q.version }), ADMIN.id)), 409);
  });
  await test('S5a an open quotation agreed after its job was declined → 409, the job keeps no approved quotation', async () => {
    const j = await mkJob(40);
    const q = await saveQuotation(base(j, { status: 'เสนอราคาแล้ว' }), ADMIN.id);
    await pool.query(`UPDATE job SET job_status_id = 6 WHERE job_no = $1`, [j]); // ยกเลิกซ่อม (ลูกค้าไม่ตกลงซ่อม)
    const e = await errorOf(saveQuotation(base(j, { no: q.no, version: q.version, status: AGREED }), ADMIN.id));
    assert.equal(e.status, 409);
    const { rows } = await pool.query(`SELECT quotation_no_approved AS a FROM job WHERE job_no = $1`, [j]);
    assert.ok(!rows[0].a, JSON.stringify(rows[0]));
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
