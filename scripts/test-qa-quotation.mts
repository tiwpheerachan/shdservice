/**
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-quotation.mts
 * Quotations brought up to legacy (2026-10-29): per-line ส่วนลด (%) / ส่วนลด (บาท) — a % wins and becomes บาท, a line
 * never goes below 0, the header totals take the lines after their discount, quotations without one total exactly as
 * before; ยกเลิกใบเสนอราคา from the list = records API DELETED with `del` and a reason, after which the quotation
 * leaves the list and is neither saved nor printed; ใบเบิกสินค้า (pickSlips) and its header profile (IPA, purpose
 * pick_slip — never an issuer) (print: QuotationDoc's
 * `!found.active` → notFound — a server component this harness cannot import). Its own fixtures (users 9971–9973, customer QQT001, jobs J99071xx).
 */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.SESSION_SECRET = 'unit-test-session-secret-0123456789abcdef';

const { pool } = await import('@/db/client');
const { HttpError } = await import('@/server/auth');
const { signSession, SESSION_COOKIE } = await import('@/lib/session');
const { saveQuotation, getQuotation, pageQuotations, pickSlips } = await import('@/server/services/quotations');
const { listDocumentProfiles, issuingProfile, pickSlipProfile, saveDocumentProfile } =
  await import('@/server/services/document-profiles');
const { computeTotals, lineAmount } = await import('@/lib/validation/quotation');
const { lineTotals } = await import('@/components/quotation/line-totals');
const recordsRoute = await import('@/app/api/admin/records/route');

const U = {
  admin: { id: 9971, email: 'qqt-admin@example.invalid', type: 'System Admin' },
  clerk: { id: 9972, email: 'qqt-clerk@example.invalid', type: 'QQT Clerk' }, // Quotation add / edit, no del
  boss: { id: 9973, email: 'qqt-boss@example.invalid', type: 'QQT Boss' }, // Quotation del
} as const;
const SV = 3;
const CUSTOMER = 'QQT001';
const JOB = 'J9907101';
await pool.query(`
  INSERT INTO quotation_status (quotation_status_id, quotation_status_name)
    SELECT * FROM (VALUES (1, 'รอเสนอราคา'), (2, 'เสนอราคาแล้ว')) v(id, name)
     WHERE NOT EXISTS (SELECT 1 FROM quotation_status s WHERE s.quotation_status_id = v.id);
  INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
    SELECT 2, 'กำลังดำเนินการ', 2, 'Open', true WHERE NOT EXISTS (SELECT 1 FROM job_status WHERE job_status_id = 2);
  DELETE FROM app_config WHERE user_type IN ('QQT Clerk', 'QQT Boss');
  INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
    ('QQT Clerk', 'Quotation', true, true, false, true),
    ('QQT Boss', 'Quotation', true, true, true, true);
  DELETE FROM app_user WHERE user_id BETWEEN 9971 AND 9979 OR email_address LIKE 'qqt-%@example.invalid';
  INSERT INTO app_user (user_id, first_name, last_name, email_address, user_type, record_status, session_version) VALUES
    ${Object.values(U)
      .map((u) => `(${u.id}, 'QQT', '${u.email.split('@')[0]}', '${u.email}', '${u.type}', 'ACTIVE', ${SV})`)
      .join(', ')};
  DELETE FROM quotation_dt WHERE quotation_no IN (SELECT quotation_no FROM quotation_hd WHERE customer_code = '${CUSTOMER}');
  DELETE FROM quotation_hd WHERE customer_code = '${CUSTOMER}';
  DELETE FROM job_log WHERE job_no LIKE 'J99071%';
  DELETE FROM job WHERE job_no LIKE 'J99071%';
  DELETE FROM customer WHERE customer_id = 9971 OR customer_code = '${CUSTOMER}';
  INSERT INTO customer (customer_id, customer_code, customer_name, phone_number) VALUES (9971, '${CUSTOMER}', 'ลูกค้า QQT', '02-000-0071');
  INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date)
    VALUES ('${JOB}', 2, 9971, '${CUSTOMER} ลูกค้า QQT', 'Model QQT', now(), current_date, '1900-01-01');
`);

const line = (o: Record<string, unknown> = {}) => ({
  itemType: 'SparePart',
  code: '',
  detail: 'QQT รายการ',
  qty: 1,
  unit: 'หน่วย',
  unitPrice: 100,
  discount: 0,
  discountPercent: 0,
  ...o,
});
const base = (o: Record<string, unknown> = {}) =>
  ({ customerCode: CUSTOMER, jobNo: JOB, contactName: 'QQT', lines: [line()], ...o }) as Parameters<
    typeof saveQuotation
  >[0];
const dtOf = async (no: string) =>
  (
    await pool.query<{ d: string; p: string; t: string }>(
      `SELECT unit_price_discount AS d, unit_price_discount_percent AS p, total_price AS t
         FROM quotation_dt WHERE quotation_no = $1 ORDER BY line_number`,
      [no],
    )
  ).rows.map((r) => [Number(r.d), Number(r.p), Number(r.t)]);
async function records(u: (typeof U)[keyof typeof U], body: unknown) {
  const now = Date.now();
  const cookie = `${SESSION_COOKIE}=${await signSession({ email: u.email, name: 'QQT', exp: now + 600_000, iat: now, sv: SV })}`;
  const res = await recordsRoute.POST(
    new NextRequest('https://svc.example.test/api/admin/records', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'user-agent': 'qqt', host: 'svc.example.test' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
}

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
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
  console.log('\nline discount — % → บาท, บาท as given, never below 0');
  await test('lineAmount: 10 % of 2 × 50 = 10 → 90; 25 บาท of 200 → 175; 15 % of 33.30 = 5.00 (half up)', () => {
    assert.deepEqual(lineAmount({ qty: 2, unitPrice: 50, discountPercent: 10 }), { discount: 10, total: 90 });
    assert.deepEqual(lineAmount({ qty: 1, unitPrice: 200, discount: 25 }), { discount: 25, total: 175 });
    assert.deepEqual(lineAmount({ qty: 1, unitPrice: 33.3, discountPercent: 15 }), { discount: 5, total: 28.3 });
    assert.deepEqual(lineAmount({ qty: 3, unitPrice: 9.99, discountPercent: 100 }), { discount: 29.97, total: 0 });
  });
  await test('lineAmount: a % set wins over the บาท sent; a บาท over the amount stops at 0', () => {
    assert.deepEqual(lineAmount({ qty: 1, unitPrice: 100, discount: 5, discountPercent: 20 }), {
      discount: 20,
      total: 80,
    });
    assert.equal(lineAmount({ qty: 1, unitPrice: 10, discount: 15 }).total, 0);
  });
  await test('no discount: every qty 1–50 × price 0.01–99.99 totals round(qty × price) — the old formula', () => {
    let bad = '';
    for (let c = 1; c <= 9999 && !bad; c += 7)
      for (let qty = 1; qty <= 50 && !bad; qty++) {
        const unitPrice = c / 100;
        const t = lineAmount({ qty, unitPrice, discount: 0, discountPercent: 0 }).total;
        if (t !== Math.round((qty * unitPrice - 0) * 100) / 100) bad = `${qty} × ${unitPrice} → ${t}`;
      }
    assert.equal(bad, '');
  });
  await test('the form preview (lineTotals) = the server: parts after line discount, delivery apart', () => {
    const l = (o: Partial<Parameters<typeof lineTotals>[0][number]>) => ({
      id: 1,
      code: '',
      name: 'x',
      qty: 1,
      price: 100,
      discount: 0,
      discountPercent: 0,
      itemType: 'SparePart' as const,
      ...o,
    });
    assert.deepEqual(
      lineTotals([
        l({ qty: 2, price: 50, discountPercent: 10 }),
        l({ price: 200, discount: 25 }),
        l({ price: 60, discount: 10, itemType: 'Delivery' }),
      ]),
      { parts: 265, delivery: 50 },
    );
  });

  console.log('\nsaved amounts');
  await test('a quotation without line discounts stores what it always did (10 % on the total, VAT 7)', async () => {
    const q = await saveQuotation(
      base({
        lines: [line({ qty: 2, unitPrice: 50 }), line({ unitPrice: 33.3 })],
        serviceAmount: 100,
        discountType: 'ส่วนลดรวม',
        discountValue: 10,
        discountUnit: '%',
        vatRate: 7,
      }),
      U.admin.id,
    );
    // parts 133.30 + service 100 = 233.30; 10 % = 23.33; base 209.97; VAT 14.70; net 224.67
    assert.deepEqual(
      [q.partsAmount, q.sumExclude, q.discountAmount, q.totalBase, q.vatAmount, q.netAmount],
      [133.3, 233.3, 23.33, 209.97, 14.7, 224.67],
    );
    assert.deepEqual(await dtOf(q.no), [
      [0, 0, 100],
      [0, 0, 33.3],
    ]);
  });
  let withDisc = '';
  await test('line discounts: % and บาท stored per line, parts / delivery / VAT / net follow', async () => {
    const q = await saveQuotation(
      base({
        lines: [
          line({ qty: 2, unitPrice: 50, discountPercent: 10, discount: 10 }),
          line({ unitPrice: 200, discount: 25 }),
          line({ unitPrice: 100, discountPercent: 100, discount: 100 }),
          line({ itemType: 'Delivery', code: 'SVD0001', detail: 'ค่าขนส่ง', unitPrice: 60, discount: 10 }),
        ],
        vatRate: 7,
      }),
      U.admin.id,
    );
    withDisc = q.no;
    // parts 90 + 175 + 0 = 265; delivery 50; sum 315; VAT 22.05; net 337.05
    assert.deepEqual(
      [q.partsAmount, q.sumExclude, q.discountAmount, q.vatAmount, q.netAmount],
      [265, 315, 0, 22.05, 337.05],
    );
    assert.deepEqual(await dtOf(q.no), [
      [10, 10, 90],
      [25, 0, 175],
      [100, 100, 0],
      [10, 0, 50],
    ]);
    assert.deepEqual(
      q.lines.map((l) => [l.discount, l.discountPercent, l.total]),
      [
        [10, 10, 90],
        [25, 0, 175],
        [100, 100, 0],
        [10, 0, 50],
      ],
    );
  });
  await test('a % with a stale บาท beside it: the server recomputes the บาท from the %', async () => {
    const q = await saveQuotation(base({ lines: [line({ discountPercent: 20, discount: 5 })] }), U.admin.id);
    assert.deepEqual(await dtOf(q.no), [[20, 20, 80]]);
    assert.equal(q.netAmount, 80);
  });
  await test('ส่วนลดค่าอะไหล่ (header) is taken on the parts after their line discounts', async () => {
    const q = await saveQuotation(
      base({
        lines: [line({ unitPrice: 200, discount: 50 })],
        serviceAmount: 100,
        discountType: 'ส่วนลดค่าอะไหล่',
        discountValue: 10,
        discountUnit: '%',
      }),
      U.admin.id,
    );
    const t = computeTotals({
      parts: 150,
      service: 100,
      discountType: 'ส่วนลดค่าอะไหล่',
      discountValue: 10,
      discountUnit: '%',
      vatRate: 0,
    });
    assert.deepEqual([q.discountAmount, q.netAmount], [15, 235]);
    assert.equal(q.netAmount, t.net);
  });
  await test('re-saving the loaded lines (the edit form) changes nothing — same amounts, same version', async () => {
    const q = (await getQuotation(withDisc))!;
    const again = await saveQuotation(
      base({
        no: q.no,
        version: q.version,
        vatRate: 7,
        lines: q.lines.map((l) => ({ ...l, unitPrice: l.unitPrice, discount: l.discount })),
      }),
      U.admin.id,
    );
    assert.equal(again.version, q.version);
    assert.equal(again.netAmount, 337.05);
  });
  await test('a line discount over qty × price / a % over 100 → 400 under the line', async () => {
    for (const [l, key] of [
      [line({ unitPrice: 10, discount: 10.01 }), 'lines.0.discount'],
      [line({ discountPercent: 100.5 }), 'lines.0.discountPercent'],
    ] as const) {
      try {
        await saveQuotation(base({ lines: [l] }), U.admin.id);
        assert.fail('saved');
      } catch (e) {
        assert.ok(e instanceof HttpError && e.status === 400, String(e));
        assert.ok(JSON.stringify((e as InstanceType<typeof HttpError>).details).includes(key), key);
      }
    }
  });

  console.log('\nยกเลิกใบเสนอราคา from the list');
  const victim = await saveQuotation(base(), U.admin.id);
  await test('no `del` on Quotation → 403, the quotation stays', async () => {
    const r = await records(U.clerk, { table: 'quotations', id: victim.no, status: 'DELETED', remark: 'ลูกค้ายกเลิก' });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal((await getQuotation(victim.no))!.active, true);
  });
  await test('`del` without a reason → 400 under remark', async () => {
    const r = await records(U.boss, { table: 'quotations', id: victim.no, status: 'DELETED', remark: '  ' });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.match(JSON.stringify(r.body), /remark/);
    assert.equal((await getQuotation(victim.no))!.active, true);
  });
  await test('`del` + reason → DELETED: gone from the list, no save, read as inactive (the print 404s on it)', async () => {
    const r = await records(U.boss, { table: 'quotations', id: victim.no, status: 'DELETED', remark: 'ลูกค้ายกเลิก' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const page = await pageQuotations({ page: 1, pageSize: 100, q: '', sort: null } as never, {
      customerCode: CUSTOMER,
    });
    assert.ok(page.rows.length > 0 && !page.rows.some((x) => x.no === victim.no));
    const q = (await getQuotation(victim.no))!;
    assert.equal(q.active, false);
    await assert.rejects(
      saveQuotation(base({ no: q.no, version: q.version }), U.admin.id),
      (e) => e instanceof HttpError && e.status === 409,
    );
  });

  console.log('\nใบเบิกสินค้า');
  await test('one slip per quotation, in order: spare-part lines only, their qty / amount, the stored totals', async () => {
    const a = await saveQuotation(
      base({
        lines: [
          line({ code: 'P1', qty: 2, unitPrice: 50, discountPercent: 10, discount: 10 }),
          line({ itemType: 'Delivery', code: 'SVD0001', detail: 'ค่าขนส่ง', unitPrice: 60 }),
          line({ itemType: 'Service', detail: 'ค่าแรง', unitPrice: 300 }),
          line({ code: 'P2', qty: 3, unitPrice: 10 }),
        ],
        serviceAmount: 100,
        discountType: 'ส่วนลดรวม',
        discountValue: 10,
        discountUnit: '%',
        vatRate: 7,
      }),
      U.admin.id,
    );
    const b = await saveQuotation(base(), U.admin.id);
    await pool.query(`UPDATE quotation_hd SET quotation_status_id = 2 WHERE quotation_no = $1`, [b.no]); // เสนอราคาแล้ว
    const { slips, skipped } = await pickSlips([` ${b.no.toLowerCase()} `, a.no, b.no]);
    assert.deepEqual(skipped, []);
    assert.deepEqual(
      slips.map((x) => x.q.no),
      [b.no, a.no],
    );
    const s = slips[1]!;
    assert.deepEqual(
      s.lines.map((l) => [l.code, l.qty, l.total]),
      [
        ['P1', 2, 90],
        ['P2', 3, 30],
      ],
    );
    assert.deepEqual([s.qty, s.parts], [5, 120]);
    const q = (await getQuotation(a.no))!;
    assert.deepEqual(
      [s.q.serviceAmount, s.q.totalBase, s.q.vatAmount, s.q.netAmount],
      [q.serviceAmount, q.totalBase, q.vatAmount, q.netAmount],
    );
  });
  await test('any status prints; deleted / ยกเลิกใบเสนอราคา / unknown are skipped with the reason', async () => {
    const live = await saveQuotation(base(), U.admin.id);
    const off = await saveQuotation(base(), U.admin.id);
    await pool.query(`UPDATE quotation_hd SET quotation_status_id = 5 WHERE quotation_no = $1`, [off.no]);
    const { slips, skipped } = await pickSlips([live.no, victim.no, off.no, 'Q0000000']);
    assert.deepEqual(
      slips.map((x) => x.q.no),
      [live.no],
    );
    assert.deepEqual(skipped, [
      { no: victim.no, why: 'ถูกลบแล้ว' },
      { no: off.no, why: 'ยกเลิกใบเสนอราคา' },
      { no: 'Q0000000', why: 'ไม่พบใบเสนอราคา' },
    ]);
    assert.deepEqual((await pickSlips([victim.no])).slips, []);
  });

  console.log('\nโปรไฟล์หัวใบเบิกสินค้า (IPA, purpose pick_slip)');
  await test('the slip header is IPA; the issuer list and chooser never offer it, nor issue under it', async () => {
    const ipa = await pickSlipProfile();
    assert.equal(ipa?.code, 'IPA');
    assert.equal(ipa?.nameTh, 'บริษัท อินเตอร์เนชั่นเนลเพอร์เฟคอัลไลแอนซ์ จำกัด');
    assert.ok((await listDocumentProfiles(true)).every((p) => p.purpose === 'document' && p.code !== 'IPA'));
    assert.ok((await listDocumentProfiles(false)).some((p) => p.code === 'IPA')); // the admin page shows it
    await assert.rejects(issuingProfile(ipa!.id), (e) => e instanceof HttpError && e.status === 400);
  });
  await test('a pick slip profile cannot be the default; saving it keeps its purpose', async () => {
    const ipa = (await pickSlipProfile())!;
    await assert.rejects(
      saveDocumentProfile({ ...ipa, isDefault: true, expect: ipa } as never, U.admin.id),
      (e) => e instanceof HttpError && e.status === 400,
    );
    const saved = await saveDocumentProfile({ ...ipa, purpose: undefined, expect: ipa } as never, U.admin.id);
    assert.equal(saved.purpose, 'pick_slip');
  });
} finally {
  await pool.end();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
process.exit(0);
