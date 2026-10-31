/**
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-parity-d.mts
 * Legacy parity: a sale order paid "เก็บเงินปลายทาง (COD)" (sale orders only — not the job close), the
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
  DELETE FROM role_permission WHERE user_type IN ('QPD CS', 'QPD Viewer');
  INSERT INTO role_permission (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
    ('QPD CS', 'Customer', true, true, false, true), ('QPD Viewer', 'Customer', false, false, false, true);
  INSERT INTO approve_status (approve_status_id, approve_name_th)
    SELECT 1, 'กำลังดำเนินการจัดทำ' WHERE NOT EXISTS (SELECT 1 FROM approve_status WHERE approve_status_id = 1);
  -- a sale order line's store / condition codes have foreign keys (drizzle/0006)
  INSERT INTO store_location (store_location_id, store_location_name, is_active)
    SELECT 1, 'คลังสินค้าดี', true WHERE NOT EXISTS (SELECT 1 FROM store_location WHERE store_location_id = 1);
  INSERT INTO condition (condition_id, condition_name, is_active)
    SELECT 1, 'ใหม่', true WHERE NOT EXISTS (SELECT 1 FROM condition WHERE condition_id = 1);
  -- the users stay (audit_log, append-only, points at them): reset in place
  INSERT INTO app_user (pk, first_name, last_name, email_address, user_type, record_status, session_version)
  OVERRIDING SYSTEM VALUE VALUES
    ${Object.values(U)
      .map((u) => `(${u.id}, 'QPD', '${u.email.split('@')[0]}', '${u.email}', '${u.type}', 'ACTIVE', ${SV})`)
      .join(', ')}
  ON CONFLICT (pk) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
    email_address = excluded.email_address, user_type = excluded.user_type, record_status = excluded.record_status,
    session_version = excluded.session_version, last_login = DEFAULT;
  DELETE FROM sale_order_line WHERE sale_order_pk IN (SELECT h.pk FROM sale_order h JOIN customer c ON c.pk = h.customer_pk WHERE c.customer_code LIKE 'QPD%');
  DELETE FROM sale_order WHERE customer_pk IN (SELECT pk FROM customer WHERE customer_code LIKE 'QPD%');
  DELETE FROM customer WHERE pk = 9981 OR customer_code LIKE 'QPD%';
  INSERT INTO customer (pk, customer_code, customer_name, phone_number, record_status)
    OVERRIDING SYSTEM VALUE VALUES (9981, 'QPDC001', 'ลูกค้า QPD', '02-998-0001', 'ACTIVE');
  DELETE FROM product_stock WHERE product_pk = 9981 OR pk = 9981;
  DELETE FROM product WHERE pk = 9981 OR product_code LIKE 'QPDP%';
  INSERT INTO product (pk, product_code, product_name, record_status) OVERRIDING SYSTEM VALUE VALUES (9981, 'QPDP1', 'อะไหล่ QPD', 'ACTIVE');
  INSERT INTO product_stock (pk, product_pk, quantity_available, quantity_used, quantity_booking, quantity_remain, retail_price)
    OVERRIDING SYSTEM VALUE VALUES (9981, 9981, 10, 0, 0, 10, 100.00);
  DELETE FROM sub_district WHERE district_pk = ${DISTRICT} OR province_pk = ${CITY};
  DELETE FROM district WHERE pk = ${DISTRICT} OR province_pk = ${CITY};
  DELETE FROM province WHERE pk = ${CITY};
  INSERT INTO province (pk, name_en, name_th, region) OVERRIDING SYSTEM VALUE VALUES (${CITY}, 'QPD', 'จังหวัด QPD', 'QPD');
  INSERT INTO district (province_pk, pk, name_en, name_th, postal_code)
    OVERRIDING SYSTEM VALUE VALUES (${CITY}, ${DISTRICT}, 'QPD', 'อำเภอ QPD', '99810');
  INSERT INTO sub_district (province_pk, district_pk, name_en, name_th, postal_code)
    VALUES (${CITY}, ${DISTRICT}, 'QPD', 'ตำบลเดิม QPD', '99810');
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
/** the district's uuid — what /api/address takes */
const districtId = (await pool.query<{ id: string }>(`SELECT id::text FROM district WHERE pk = $1`, [DISTRICT]))
  .rows[0]!.id;
/** the salesperson's uuid — what a sale order takes */
const adminId = (await pool.query<{ id: string }>(`SELECT id::text FROM app_user WHERE pk = $1`, [U.admin.id])).rows[0]!
  .id;
const subDistricts = async () =>
  (await call('GET', `/api/address?level=subdistrict&district=${districtId}`, U.admin)).body.rows as {
    id: string;
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
await test('a sale-order choice only — the job close keeps its 3; fits sale_order.payment_type (50)', async () => {
  assert.ok(PAYMENT_METHODS.includes(COD));
  assert.ok(!JOB_PAYMENT_METHODS.includes(COD));
  assert.ok(COD.length <= 50);
});
await test('the form rules take COD with no amount (nothing collected yet) and with one ≤ the total', async () => {
  const base = { customerCode: 'QPDC001', salesId: adminId, lines: [{ code: 'QPDP1', qty: 1, price: 100 }] };
  assert.equal(saleOrderSchema().safeParse({ ...base, paymentType: COD }).success, true);
  assert.equal(saleOrderSchema().safeParse({ ...base, paymentType: COD, paymentAmount: 100 }).success, true);
  assert.equal(saleOrderSchema().safeParse({ ...base, paymentType: COD, paymentAmount: 101 }).success, false);
});
await test('saved as payment_type "เก็บเงินปลายทาง (COD)", payment_amount empty, the usual status', async () => {
  const o = await saveSaleOrder(
    {
      customerCode: 'QPDC001',
      salesId: adminId,
      submit: false,
      paymentType: COD,
      lines: [{ code: 'QPDP1', qty: 1 }],
    },
    { pk: U.admin.id, isAdmin: true },
  );
  const { rows } = await pool.query(
    `SELECT payment_type, payment_amount, approve_status_id FROM sale_order WHERE sale_order_no = $1`,
    [o.no],
  );
  assert.deepEqual(rows[0], { payment_type: COD, payment_amount: null, approve_status_id: 1 });
  assert.equal(o.paymentType, COD);
});

console.log('\nลูกค้า: + เพิ่มชื่อ แขวง / ตำบล (POST /api/address)');
await test('Customer edit adds one (cleaned) — 201, in the list for everyone, audited', async () => {
  const r = await call('POST', '/api/address', U.cs, {
    district: districtId,
    name: '  ตำบลใหม่   QPD ',
    postal: '99811',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const row = r.body.row as { id: string; name: string; postal: string };
  assert.deepEqual({ name: row.name, postal: row.postal }, { name: 'ตำบลใหม่ QPD', postal: '99811' });
  assert.ok((await subDistricts()).some((s) => s.id === row.id && s.name === 'ตำบลใหม่ QPD'));
  // the audit key = the new row's uuid
  const { rows } = await pool.query(
    `SELECT action, module FROM audit_log WHERE entity = 'sub_district' AND entity_key = $1 ORDER BY pk DESC LIMIT 1`,
    [row.id],
  );
  assert.deepEqual(rows, [{ action: 'CREATE', module: 'Customer' }]);
});
await test('the same name in that district again → 409 (nothing added)', async () => {
  const before = (await subDistricts()).length;
  const r = await call('POST', '/api/address', U.cs, { district: districtId, name: 'ตำบลเดิม QPD', postal: '99810' });
  assert.equal(r.status, 409);
  assert.equal((await subDistricts()).length, before);
});
await test('Customer view only → 403', async () => {
  const r = await call('POST', '/api/address', U.viewer, {
    district: districtId,
    name: 'ตำบลอื่น QPD',
    postal: '99812',
  });
  assert.equal(r.status, 403);
});
await test('a name over the column (50), no name, a bad postal code → 400 under the fields', async () => {
  const r = await call('POST', '/api/address', U.cs, { district: districtId, name: 'ก'.repeat(51), postal: '9981' });
  assert.equal(r.status, 400);
  assert.deepEqual(Object.keys((r.body.details as { fields: object }).fields).sort(), ['name', 'postal']);
  assert.equal(
    (await call('POST', '/api/address', U.cs, { district: districtId, name: ' ', postal: '99810' })).status,
    400,
  );
});
await test('a district that is not there → 404', async () => {
  const r = await call('POST', '/api/address', U.cs, {
    district: '00000000-0000-7000-8000-000000000000',
    name: 'ตำบลอื่น QPD',
    postal: '99812',
  });
  assert.equal(r.status, 404);
  // not a uuid at all (an old int id) → 400 under the field
  const old = await call('POST', '/api/address', U.cs, { district: 9989, name: 'ตำบลอื่น QPD', postal: '99812' });
  assert.equal(old.status, 400);
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
