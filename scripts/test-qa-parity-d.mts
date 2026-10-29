/**
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-parity-d.mts
 * Legacy parity (2026-10-29): a sale order paid "เก็บเงินปลายทาง (COD)" (sale orders only — not the job close), the
 * customer form's "+ เพิ่มชื่อ" แขวง / ตำบล (POST /api/address), and 75 rows a page. Its own fixtures (ids 998x,
 * codes QPD*, users qpd-*), reset at every start.
 */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.SESSION_SECRET = 'unit-test-session-secret-0123456789abcdef';

const { pool } = await import('@/db/client');
const { signSession, SESSION_COOKIE } = await import('@/lib/session');
const { saveSaleOrder } = await import('@/server/services/sale-orders');
const { saleOrderSchema } = await import('@/lib/validation/sale-order');
const { PAYMENT_METHODS, JOB_PAYMENT_METHODS } = await import('@/data/options');
const { PAGE_SIZES } = await import('@/data/keys');
const { parsePageQuery } = await import('@/server/paging');
const { fromQuery } = await import('@/app/(app)/jobs/list/filters');
const addressRoute = await import('@/app/api/address/route');
const dataRoute = await import('@/app/api/data/[resource]/route');

const COD = 'เก็บเงินปลายทาง (COD)';
const U = {
  admin: { id: 9981, email: 'qpd-admin@example.invalid', type: 'System Admin' },
  cs: { id: 9982, email: 'qpd-cs@example.invalid', type: 'QPD CS' }, // Customer edit
  viewer: { id: 9983, email: 'qpd-viewer@example.invalid', type: 'QPD Viewer' }, // Customer view only
} as const;
const SV = 3;
const CITY = 9981;
const DISTRICT = 9981;
await pool.query(`
  DELETE FROM app_config WHERE user_type IN ('QPD CS', 'QPD Viewer');
  INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
    ('QPD CS', 'Customer', true, true, false, true), ('QPD Viewer', 'Customer', false, false, false, true);
  DELETE FROM app_user WHERE user_id BETWEEN 9981 AND 9989 OR email_address LIKE 'qpd-%@example.invalid';
  INSERT INTO app_user (user_id, first_name, last_name, email_address, user_type, record_status, session_version) VALUES
    ${Object.values(U)
      .map((u) => `(${u.id}, 'QPD', '${u.email.split('@')[0]}', '${u.email}', '${u.type}', 'ACTIVE', ${SV})`)
      .join(', ')};
  DELETE FROM sale_out_dt WHERE sale_out_hd_no IN (SELECT sale_out_hd_no FROM sale_out_hd WHERE customer_code LIKE 'QPD%');
  DELETE FROM sale_out_hd WHERE customer_code LIKE 'QPD%';
  DELETE FROM customer WHERE customer_id = 9981 OR customer_code LIKE 'QPD%';
  INSERT INTO customer (customer_id, customer_code, customer_name, phone_number, record_status)
    VALUES (9981, 'QPDC001', 'ลูกค้า QPD', '02-998-0001', 'ACTIVE');
  DELETE FROM product_none_serial WHERE product_id = 9981 OR item_id = 9981;
  DELETE FROM product WHERE product_id = 9981 OR product_code LIKE 'QPDP%';
  INSERT INTO product (product_id, product_code, product_name, record_status) VALUES (9981, 'QPDP1', 'อะไหล่ QPD', 'ACTIVE');
  INSERT INTO product_none_serial (item_id, product_id, quantity_available, quantity_used, quantity_booking, quantity_remain, retail_price)
    VALUES (9981, 9981, 10, 0, 0, 10, 100.00);
  DELETE FROM mt_sub_district WHERE district_id = ${DISTRICT} OR city_id = ${CITY};
  DELETE FROM mt_district WHERE district_id = ${DISTRICT} OR city_id = ${CITY};
  DELETE FROM mt_city WHERE city_id = ${CITY};
  INSERT INTO mt_city (city_id, name_en, name_th, region) VALUES (${CITY}, 'QPD', 'จังหวัด QPD', 'QPD');
  INSERT INTO mt_district (city_id, district_id, name_en, name_th, postal_code)
    VALUES (${CITY}, ${DISTRICT}, 'QPD', 'อำเภอ QPD', '99810');
  INSERT INTO mt_sub_district (city_id, district_id, sub_district_id, name_en, name_th, postal_code)
    SELECT ${CITY}, ${DISTRICT}, coalesce(max(sub_district_id), 0) + 1, 'QPD', 'ตำบลเดิม QPD', '99810' FROM mt_sub_district;
`);

async function call(method: 'GET' | 'POST', url: string, u: (typeof U)[keyof typeof U], body?: unknown) {
  const now = Date.now();
  const cookie = `${SESSION_COOKIE}=${await signSession({ email: u.email, name: 'QPD', exp: now + 600_000, iat: now, sv: SV })}`;
  const req = new NextRequest(`https://svc.example.test${url}`, {
    method,
    headers: {
      cookie,
      'user-agent': 'qpd',
      host: 'svc.example.test',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res =
    url.startsWith('/api/address') && method === 'POST'
      ? await addressRoute.POST(req)
      : url.startsWith('/api/address')
        ? await addressRoute.GET(req)
        : await dataRoute.GET(req, {
            params: Promise.resolve({ resource: new URL(req.url).pathname.split('/')[3]! }),
          } as never);
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> };
}
const subDistricts = async () =>
  (await call('GET', `/api/address?level=subdistrict&district=${DISTRICT}`, U.admin)).body.rows as {
    id: number;
    name: string;
    postal: string;
  }[];

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message.replace(/\n/g, '\n      ') : e}`);
  }
}

console.log('\nใบสั่งขาย: เก็บเงินปลายทาง (COD)');
await test('a sale-order choice only — the job close keeps its 3; fits sale_out_hd.payment_type (50)', async () => {
  assert.ok(PAYMENT_METHODS.includes(COD));
  assert.ok(!JOB_PAYMENT_METHODS.includes(COD));
  assert.ok(COD.length <= 50);
});
await test('the form rules take COD with no amount (nothing collected yet) and with one ≤ the total', async () => {
  const base = { customerCode: 'QPDC001', salesId: U.admin.id, lines: [{ code: 'QPDP1', qty: 1, price: 100 }] };
  assert.equal(saleOrderSchema().safeParse({ ...base, paymentType: COD }).success, true);
  assert.equal(saleOrderSchema().safeParse({ ...base, paymentType: COD, paymentAmount: 100 }).success, true);
  assert.equal(saleOrderSchema().safeParse({ ...base, paymentType: COD, paymentAmount: 101 }).success, false);
});
await test('saved as payment_type "เก็บเงินปลายทาง (COD)", payment_amount empty, the usual status', async () => {
  const o = await saveSaleOrder(
    {
      customerCode: 'QPDC001',
      salesId: U.admin.id,
      submit: false,
      paymentType: COD,
      lines: [{ code: 'QPDP1', qty: 1 }],
    },
    { userId: U.admin.id, isAdmin: true },
  );
  const { rows } = await pool.query(
    `SELECT payment_type, payment_amount, approve_status_id FROM sale_out_hd WHERE sale_out_hd_no = $1`,
    [o.no],
  );
  assert.deepEqual(rows[0], { payment_type: COD, payment_amount: null, approve_status_id: 1 });
  assert.equal(o.paymentType, COD);
});

console.log('\nลูกค้า: + เพิ่มชื่อ แขวง / ตำบล (POST /api/address)');
await test('Customer edit adds one (cleaned) — 201, in the list for everyone, audited', async () => {
  const r = await call('POST', '/api/address', U.cs, {
    district: DISTRICT,
    name: '  ตำบลใหม่   QPD ',
    postal: '99811',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const row = r.body.row as { id: number; name: string; postal: string };
  assert.deepEqual({ name: row.name, postal: row.postal }, { name: 'ตำบลใหม่ QPD', postal: '99811' });
  assert.ok((await subDistricts()).some((s) => s.id === row.id && s.name === 'ตำบลใหม่ QPD'));
  // the latest line: audit_log is append-only, and a re-run may get the same id again
  const { rows } = await pool.query(
    `SELECT action, module FROM audit_log WHERE entity = 'mt_sub_district' AND entity_key = $1 ORDER BY id DESC LIMIT 1`,
    [String(row.id)],
  );
  assert.deepEqual(rows, [{ action: 'CREATE', module: 'Customer' }]);
});
await test('the same name in that district again → 409 (nothing added)', async () => {
  const before = (await subDistricts()).length;
  const r = await call('POST', '/api/address', U.cs, { district: DISTRICT, name: 'ตำบลเดิม QPD', postal: '99810' });
  assert.equal(r.status, 409);
  assert.equal((await subDistricts()).length, before);
});
await test('Customer view only → 403', async () => {
  const r = await call('POST', '/api/address', U.viewer, { district: DISTRICT, name: 'ตำบลอื่น QPD', postal: '99812' });
  assert.equal(r.status, 403);
});
await test('a name over the column (50), no name, a bad postal code → 400 under the fields', async () => {
  const r = await call('POST', '/api/address', U.cs, { district: DISTRICT, name: 'ก'.repeat(51), postal: '9981' });
  assert.equal(r.status, 400);
  assert.deepEqual(Object.keys((r.body.details as { fields: object }).fields).sort(), ['name', 'postal']);
  assert.equal(
    (await call('POST', '/api/address', U.cs, { district: DISTRICT, name: ' ', postal: '99810' })).status,
    400,
  );
});
await test('a district that is not there → 404', async () => {
  const r = await call('POST', '/api/address', U.cs, { district: 9989, name: 'ตำบลอื่น QPD', postal: '99812' });
  assert.equal(r.status, 404);
});

console.log('\n75 rows a page (legacy 50 / 75 / 100)');
await test('PAGE_SIZES offers 75 and keeps 10 / 25 / 50 / 100', async () => {
  assert.deepEqual(PAGE_SIZES, [10, 25, 50, 75, 100]);
});
await test('the paged API and the job list URL take 75', async () => {
  assert.equal(parsePageQuery(new URLSearchParams('pageSize=75')).pageSize, 75);
  assert.equal(fromQuery(new URLSearchParams('size=75')).pageSize, 75);
  const r = await call('GET', '/api/data/customers?paged=1&pageSize=75', U.admin);
  assert.equal(r.status, 200);
  assert.equal(r.body.pageSize, 75);
});

await pool.end();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
