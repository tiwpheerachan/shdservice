/**
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-so2.mts
 * Sale-order owner decisions (2026-10-21): cancel with a reason (who may), cancelled orders findable in the
 * list, a slip (+ amount) added after the approval when the order has none, the salesperson a role that sells.
 * Same harness as scripts/test-qa-so.mts; its own fixtures (ids 980x, codes Q2*, users q2-*), reset at every
 * start. Storage is a fake Supabase Storage behind globalThis.fetch.
 */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
const STORAGE = 'http://storage.q2.test';
Object.assign(process.env, {
  SESSION_SECRET: 'unit-test-session-secret-0123456789abcdef',
  NEXT_PUBLIC_SUPABASE_URL: STORAGE,
  SUPABASE_SECRET_KEY: 'q2-fake-key',
});

const { db, pool } = await import('@/db/client');
const { signSession, SESSION_COOKIE } = await import('@/lib/session');
const { nextRunningNo } = await import('@/db/running-no');
const { BUCKET } = await import('@/server/storage');
const { listStaff } = await import('@/server/services/users');
const { POST: soPOST } = await import('@/app/api/sale-orders/route');
const { POST: approvePOST } = await import('@/app/api/sale-orders/[id]/approve/route');
const { POST: recordsPOST } = await import('@/app/api/admin/records/route');
const { POST: uploadPOST } = await import('@/app/api/upload/route');
const { GET: dataGET } = await import('@/app/api/data/[resource]/route');

const stored = new Set<string>();
const objects = `${STORAGE}/storage/v1/object/${BUCKET}`;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = init?.method ?? 'GET';
  if (url === `${STORAGE}/storage/v1/bucket`) return Response.json({ name: BUCKET });
  if (method === 'POST' && url.startsWith(`${objects}/`)) {
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

// ---- fixtures ----
const U = {
  admin: { id: 9801, email: 'q2-admin@example.invalid', type: 'System Admin' },
  seller: { id: 9802, email: 'q2-seller@example.invalid', type: 'Q2 Seller' }, // Sale Order V/A/E/D
  approver: { id: 9803, email: 'q2-approver@example.invalid', type: 'Q2 Approver' }, // + SO Approve
  viewer: { id: 9804, email: 'q2-viewer@example.invalid', type: 'Q2 Viewer' }, // Sale Order view only
  clerk: { id: 9805, email: 'q2-clerk@example.invalid', type: 'Q2 Clerk' }, // no Sale Order add
} as const;
type TestUser = (typeof U)[keyof typeof U];
const SV = 3;
const CUSTOMER = 'Q2C001';
const PART = 'Q2P1';

await pool.query(`
  INSERT INTO stock_move_type (stock_move_type_id, stock_move_type_name, movement_action_type, movement_action, is_active)
    SELECT * FROM (VALUES (1, 'รับเข้า', 'รับเข้า', 1, true), (2, 'รับคืนจากการเบิก', 'รับเข้า', 1, true),
                          (3, 'จ่ายออกตามงานซ่อม', 'จ่ายออก', -1, true), (4, 'จ่ายออกตามใบสั่งขาย', 'จ่ายออก', -1, true),
                          (5, 'จ่ายออกอื่นๆ', 'จ่ายออก', -1, true)) v(id, name, kind, act, on_)
     WHERE NOT EXISTS (SELECT 1 FROM stock_move_type t WHERE t.stock_move_type_id = v.id);
  INSERT INTO store_location (store_location_id, store_location_name, is_active)
    SELECT * FROM (VALUES (1, 'คลังสินค้าดี', true), (2, 'คลังสินค้าเสีย', true)) v(id, name, on_)
     WHERE NOT EXISTS (SELECT 1 FROM store_location s WHERE s.store_location_id = v.id);
  -- sale_order.approve_status_id / sale_order_line.condition_id have foreign keys (drizzle/0006): src/lib/status-ids.ts
  INSERT INTO approve_status (approve_status_id, approve_name_th, approve_name_en, is_can_edit, is_can_revise)
    SELECT * FROM (VALUES (1, 'กำลังดำเนินการจัดทำ', 'In Progess', true, true), (2, 'รออนุมัติ', 'Wait Approve', true, true),
                          (3, 'แก้ไขข้อมูล', 'Reject', true, true), (4, 'อนุมัติแล้ว', 'Approved', false, false),
                          (5, 'ปฏิเสธ', 'Deny', false, false)) v(id, th, en, ed, rv)
     WHERE NOT EXISTS (SELECT 1 FROM approve_status s WHERE s.approve_status_id = v.id);
  INSERT INTO condition (condition_id, condition_name, is_active)
    SELECT 1, 'สินค้าใหม่', true WHERE NOT EXISTS (SELECT 1 FROM condition WHERE condition_id = 1);
  DELETE FROM role_permission WHERE user_type IN ('Q2 Seller', 'Q2 Approver', 'Q2 Viewer', 'Q2 Clerk');
  INSERT INTO role_permission (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
    ('Q2 Seller', 'Sale Order', true, true, true, true),
    ('Q2 Approver', 'Sale Order', false, true, true, true), ('Q2 Approver', 'SO Approve', false, false, false, true),
    ('Q2 Viewer', 'Sale Order', false, false, false, true),
    ('Q2 Clerk', 'Customer', true, true, false, true);
  -- fixture users keep their pk (audit_log, append-only, points at them: never deleted) — upserted
  INSERT INTO app_user (pk, first_name, last_name, email_address, user_type, record_status, session_version) OVERRIDING SYSTEM VALUE VALUES
    ${Object.values(U)
      .map((u) => `(${u.id}, 'Q2', '${u.email.split('@')[0]}', '${u.email}', '${u.type}', 'ACTIVE', ${SV})`)
      .join(', ')}
    ON CONFLICT (pk) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
      email_address = excluded.email_address, user_type = excluded.user_type, record_status = 'ACTIVE',
      session_version = excluded.session_version, last_login = DEFAULT;
  -- children before parents (RESTRICT, drizzle/0006): lines, movements, orders, the customer, the part
  DELETE FROM sale_order_line WHERE sale_order_pk IN (SELECT pk FROM sale_order WHERE customer_pk = 9801) OR product_pk = 9801;
  DELETE FROM stock_move_line WHERE product_pk = 9801 OR stock_move_pk IN (SELECT pk FROM stock_move
    WHERE sale_order_pk IN (SELECT pk FROM sale_order WHERE customer_pk = 9801));
  DELETE FROM stock_move WHERE sale_order_pk IN (SELECT pk FROM sale_order WHERE customer_pk = 9801);
  DELETE FROM sale_order WHERE customer_pk = 9801;
  DELETE FROM customer WHERE pk = 9801 OR customer_code = '${CUSTOMER}';
  INSERT INTO customer (pk, customer_code, customer_name, phone_number) OVERRIDING SYSTEM VALUE VALUES (9801, '${CUSTOMER}', 'ลูกค้า QA SO2', '02-980-0001');
  DELETE FROM product_stock WHERE product_pk = 9801 OR pk = 9801;
  DELETE FROM product WHERE pk = 9801 OR product_code = '${PART}';
  INSERT INTO product (pk, product_code, product_name) OVERRIDING SYSTEM VALUE VALUES (9801, '${PART}', 'อะไหล่ Q2');
  INSERT INTO product_stock (pk, product_pk, quantity_available, quantity_used, quantity_booking, quantity_remain, retail_price)
    OVERRIDING SYSTEM VALUE VALUES (9801, 9801, 1000, 0, 0, 1000, 100.00);
`);
// as test-domain: this year's Inventory-Out series past the numbers other suites already used
await db.transaction((tx) => nextRunningNo(tx, 'Inventory-Out'));
await pool.query(`
  UPDATE running_no r SET number = greatest(r.number, coalesce((
    SELECT max(substring(h.stock_move_no FROM length(r.prefix) + 3)::int) FROM stock_move h
     WHERE h.stock_move_no ~ ('^' || r.prefix || right(r.pyear::text, 2) || '[0-9]+$')), 0))
   WHERE r.running_type = 'Inventory-Out' AND r.length_year = 2`);

// ---- helpers ----
async function cookieFor(u: TestUser) {
  const now = Date.now();
  return `${SESSION_COOKIE}=${await signSession({ email: u.email, name: u.email, exp: now + 10 * 60_000, iat: now, sv: SV })}`;
}
const headers = async (u: TestUser) => ({
  'user-agent': 'test-qa-so2',
  'content-type': 'application/json',
  cookie: await cookieFor(u),
});
const post = async (path: string, u: TestUser, body: unknown) =>
  new NextRequest(`https://svc.example.test${path}`, {
    method: 'POST',
    headers: await headers(u),
    body: JSON.stringify(body),
  });
type Order = { no: string; version: number; slip: string; paymentAmount: number; cancelled: boolean };
type Res = { status: number; body: Record<string, unknown> & { error?: string; order?: Order } };
const json = async (r: Response): Promise<Res> => ({ status: r.status, body: (await r.json()) as Res['body'] });
/** an order's / a user's uuid — what the API takes (ADR 0008); an unknown number → a uuid of no order */
const soIdOf = async (no: string) =>
  (await pool.query<{ id: string }>('SELECT id::text FROM sale_order WHERE sale_order_no = $1', [no])).rows[0]?.id ??
  '00000000-0000-7000-8000-000000000000';
const userUuid = async (userId: number) =>
  (await pool.query<{ id: string }>('SELECT id::text FROM app_user WHERE pk = $1', [userId])).rows[0]!.id;
const params = async (no: string) => ({ params: Promise.resolve({ id: await soIdOf(no) }) });

const save = async (u: TestUser, body: Record<string, unknown>) =>
  json(await soPOST(await post('/api/sale-orders', u, body)));
const create = async (u: TestUser, extra: Record<string, unknown> = {}) => {
  const r = await save(u, {
    customerCode: CUSTOMER,
    salesId: await userUuid(u.id),
    submit: true,
    lines: [{ code: PART, qty: 1 }],
    ...extra,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.order!;
};
const decide = async (u: TestUser, no: string, decision: string) =>
  json(
    await approvePOST(await post(`/api/sale-orders/${no}/approve`, u, { decision, remark: 'Q2' }), await params(no)),
  );
const cancel = async (u: TestUser, no: string, remark?: string) =>
  json(
    await recordsPOST(
      await post('/api/admin/records', u, { table: 'sale_orders', id: await soIdOf(no), status: 'DELETED', remark }),
    ),
  );
const png = await (
  await import('sharp')
)
  .default({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } })
  .png()
  .toBuffer();
const upload = async (u: TestUser, no: string, paymentAmount?: string) => {
  const fd = new FormData();
  fd.set('kind', 'sale-order-slip');
  fd.set('id', await soIdOf(no));
  if (paymentAmount !== undefined) fd.set('paymentAmount', paymentAmount);
  fd.set('file', new File([new Uint8Array(png)], 'slip.png', { type: 'image/png' }));
  return json(
    await uploadPOST(
      new NextRequest('https://svc.example.test/api/upload', {
        method: 'POST',
        headers: { cookie: await cookieFor(u), 'user-agent': 'test-qa-so2' },
        body: fd,
      }),
    ),
  );
};
const hd = async (no: string) =>
  (
    await db.execute<{ rs: string; remark: string | null; slip: string | null; paid: string | null }>(
      sql`SELECT record_status AS rs, document_cancel_remark AS remark, slip_file_name AS slip, payment_amount::text AS paid
            FROM sale_order WHERE sale_order_no = ${no}`,
    )
  ).rows[0];
const lastAudit = async (no: string) =>
  (
    await db.execute<{ summary: string; changes: Record<string, unknown> | null }>(
      sql`SELECT summary, changes FROM audit_log WHERE entity = 'sale_order' AND entity_key = ${no} ORDER BY pk DESC LIMIT 1`,
    )
  ).rows[0];
const listNos = async (u: TestUser, deleted?: string) => {
  const q = new URLSearchParams({ paged: '1', customer: CUSTOMER, pageSize: '100', ...(deleted ? { deleted } : {}) });
  const r = await dataGET(
    new NextRequest(`https://svc.example.test/api/data/sale_orders?${q}`, { headers: await headers(u) }),
    { params: Promise.resolve({ resource: 'sale_orders' }) },
  );
  assert.equal(r.status, 200);
  return ((await r.json()) as { rows: { no: string; cancelled: boolean }[] }).rows;
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
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : e}`);
  }
}

try {
  console.log('\nQA sale orders 2 — cancel (ยกเลิกใบสั่งขาย)');
  await test('the creator cancels a draft with a reason: stored in document_cancel_remark and the audit line', async () => {
    const o = await create(U.seller, { submit: false });
    const r = await cancel(U.seller, o.no, '  ลูกค้าเปลี่ยนใจ  ');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([(await hd(o.no)).rs, (await hd(o.no)).remark], ['DELETED', 'ลูกค้าเปลี่ยนใจ']);
    assert.match((await lastAudit(o.no)).summary, /ลูกค้าเปลี่ยนใจ/);
  });
  await test('a reason over 100 characters is a 400, nothing changes', async () => {
    const o = await create(U.seller, { submit: false });
    const r = await cancel(U.seller, o.no, 'ก'.repeat(101));
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal((await hd(o.no)).rs, 'ACTIVE');
  });
  await test('a denied order is final: neither its creator nor an SO Approve user cancels it (409)', async () => {
    const o = await create(U.seller);
    assert.equal((await decide(U.approver, o.no, 'deny')).status, 200);
    const mine = await cancel(U.seller, o.no, 'Q2');
    assert.equal(mine.status, 409, JSON.stringify(mine.body));
    assert.equal((await cancel(U.approver, o.no, 'Q2')).status, 409);
    assert.equal((await hd(o.no)).rs, 'ACTIVE');
  });
  await test('cancelled orders: hidden from the list by default, listed with deleted=all for a view-only role', async () => {
    const o = await create(U.seller, { submit: false });
    assert.equal((await cancel(U.seller, o.no, 'Q2')).status, 200);
    assert.ok(!(await listNos(U.viewer)).some((r) => r.no === o.no));
    const all = await listNos(U.viewer, 'all');
    assert.deepEqual(
      all.find((r) => r.no === o.no),
      { ...all.find((r) => r.no === o.no), cancelled: true },
    );
  });

  console.log('\nQA sale orders 2 — slip after the approval');
  await test('approved, no slip yet: the slip (and the paid amount) is added, audited; a second one is 409', async () => {
    const o = await create(U.seller);
    assert.equal((await decide(U.approver, o.no, 'approve')).status, 200);
    const r = await upload(U.seller, o.no, '100');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const row = await hd(o.no);
    assert.equal(row.slip, r.body.path);
    assert.equal(Number(row.paid), 100);
    const a = await lastAudit(o.no);
    assert.deepEqual(a.changes, { slipFileName: [null, r.body.path], paymentAmount: [null, 100] });
    const again = await upload(U.seller, o.no);
    assert.deepEqual(again, { status: 409, body: { error: 'ใบสั่งขายอนุมัติแล้ว — เปลี่ยนสลิปไม่ได้' } });
    assert.equal((await hd(o.no)).slip, r.body.path, 'the first slip stays');
  });
  await test('the paid amount is never more than the order total (400, no slip stored)', async () => {
    const o = await create(U.seller);
    assert.equal((await decide(U.approver, o.no, 'approve')).status, 200);
    const r = await upload(U.seller, o.no, '150');
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal((await hd(o.no)).slip, null);
    assert.ok(![...stored].some((p) => p.startsWith(`sale-orders/${o.no}/`)), 'the refused file is not kept');
  });

  console.log('\nQA sale orders 2 — salesperson (พนักงานขาย)');
  await test('the staff list marks who sells: Sale Order add or System Admin', async () => {
    const staff = new Map((await listStaff()).map((s) => [s.id, s.sells]));
    // the staff list carries each user's uuid (ADR 0008)
    const uuidOf = async (u: { id: number }) =>
      (await pool.query<{ id: string }>('SELECT id::text FROM app_user WHERE pk = $1', [u.id])).rows[0]!.id;
    const got = [];
    for (const u of [U.admin, U.seller, U.approver, U.clerk]) got.push(staff.get(await uuidOf(u)));
    assert.deepEqual(got, [true, true, false, false]);
  });
  await test('a salesperson whose role cannot add sale orders is refused (400 salesId); one kept on an edit passes', async () => {
    const r = await save(U.seller, {
      customerCode: CUSTOMER,
      salesId: await userUuid(U.clerk.id),
      lines: [{ code: PART, qty: 1 }],
    });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.ok((r.body.details as { fields?: Record<string, string> })?.fields?.salesId);
    assert.equal(
      (
        await save(U.seller, {
          customerCode: CUSTOMER,
          salesId: await userUuid(U.admin.id),
          lines: [{ code: PART, qty: 1 }],
        })
      ).status,
      201,
    );
    // an order already naming the clerk (legacy) keeps them on an edit
    const o = await create(U.seller, { submit: false });
    await db.execute(sql`UPDATE sale_order SET sale_out_by_app_user_pk = ${U.clerk.id} WHERE sale_order_no = ${o.no}`);
    const kept = await save(U.seller, {
      no: o.no,
      customerCode: CUSTOMER,
      salesId: await userUuid(U.clerk.id),
      submit: false,
      remark: 'Q2 keep',
      lines: [{ code: PART, qty: 1 }],
    });
    assert.equal(kept.status, 200, JSON.stringify(kept.body));
  });
} finally {
  // its roles go: an SO Approve role left behind would be named as an approver by test:domain's next run
  await pool.query(
    `DELETE FROM role_permission WHERE user_type IN ('Q2 Seller', 'Q2 Approver', 'Q2 Viewer', 'Q2 Clerk')`,
  );
  await pool.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
