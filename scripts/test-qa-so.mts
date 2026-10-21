/**
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-so.mts
 * Sale-order regressions found by multi-user QA (2026-10-21): the slip swapped after an approval, tracking
 * numbers lost to a concurrent save, misleading race messages, deleted products sold. Same harness as
 * scripts/test-domain.mts; its own fixtures (ids 97xx, codes QS*, users qs-*), reset at every start.
 * Storage is a fake Supabase Storage behind globalThis.fetch (a Set of paths), with a slow upload so
 * the race windows the QA hit are wide open.
 */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
const STORAGE = 'http://storage.qs.test';
Object.assign(process.env, {
  SESSION_SECRET: 'unit-test-session-secret-0123456789abcdef',
  DB_POOL_MAX: '25',
  NEXT_PUBLIC_SUPABASE_URL: STORAGE,
  SUPABASE_SECRET_KEY: 'qs-fake-key',
});

const { db, pool } = await import('@/db/client');
const { signSession, SESSION_COOKIE } = await import('@/lib/session');
const { nextRunningNo } = await import('@/db/running-no');
const { BUCKET } = await import('@/server/storage');
const { POST: soPOST } = await import('@/app/api/sale-orders/route');
const { POST: approvePOST } = await import('@/app/api/sale-orders/[no]/approve/route');
const { POST: trackingPOST } = await import('@/app/api/sale-orders/[no]/tracking/route');
const { POST: uploadPOST } = await import('@/app/api/upload/route');

// ---- fake storage: uploads take UPLOAD_MS, removes are instant ----
const stored = new Set<string>();
const UPLOAD_MS = 150;
const objects = `${STORAGE}/storage/v1/object/${BUCKET}`;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = init?.method ?? 'GET';
  if (url === `${STORAGE}/storage/v1/bucket`) return Response.json({ name: BUCKET });
  if (method === 'POST' && url.startsWith(`${objects}/`)) {
    await new Promise((r) => setTimeout(r, UPLOAD_MS));
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
const filesUnder = (prefix: string) => [...stored].filter((p) => p.startsWith(prefix)).sort();

// ---- fixtures ----
const U = {
  admin: { id: 9701, email: 'qs-admin@example.invalid', type: 'System Admin' },
  seller: { id: 9702, email: 'qs-seller@example.invalid', type: 'QS Seller' },
  manager: { id: 9703, email: 'qs-manager@example.invalid', type: 'Manager' }, // SO Approve
} as const;
type TestUser = (typeof U)[keyof typeof U];
const SV = 3;
const CUSTOMER = 'QSC001';
const P = { a: 'QSP1', gone: 'QSP2' };
const JOB = 'QSJ0001';

await pool.query(`
  INSERT INTO inventory_type (inventory_type_id, inventory_type_name, movement_action_type, movement_action, is_active)
    SELECT * FROM (VALUES (1, 'รับเข้า', 'รับเข้า', 1, true), (2, 'รับคืนจากการเบิก', 'รับเข้า', 1, true),
                          (3, 'จ่ายออกตามงานซ่อม', 'จ่ายออก', -1, true), (4, 'จ่ายออกตามใบสั่งขาย', 'จ่ายออก', -1, true),
                          (5, 'จ่ายออกอื่นๆ', 'จ่ายออก', -1, true)) v(id, name, kind, act, on_)
     WHERE NOT EXISTS (SELECT 1 FROM inventory_type t WHERE t.inventory_type_id = v.id);
  INSERT INTO store_location (store_location_id, store_location_name, is_active)
    SELECT * FROM (VALUES (1, 'คลังสินค้าดี', true), (2, 'คลังสินค้าเสีย', true)) v(id, name, on_)
     WHERE NOT EXISTS (SELECT 1 FROM store_location s WHERE s.store_location_id = v.id);
  INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
    SELECT 2, 'กำลังดำเนินการ', 2, 'Open', true WHERE NOT EXISTS (SELECT 1 FROM job_status WHERE job_status_id = 2);
  DELETE FROM app_config WHERE user_type = 'QS Seller';
  INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view)
    VALUES ('QS Seller', 'Sale Order', true, true, false, true);
  INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view)
    VALUES ('Manager', 'Sale Order', true, true, true, true), ('Manager', 'SO Approve', false, false, false, true)
    ON CONFLICT (user_type, module_name) DO UPDATE SET can_insert = true, can_edit = true, can_view = true;
  DELETE FROM app_user WHERE user_id BETWEEN 9700 AND 9799 OR email_address LIKE 'qs-%@example.invalid';
  INSERT INTO app_user (user_id, first_name, last_name, email_address, user_type, record_status, session_version) VALUES
    ${Object.values(U)
      .map((u) => `(${u.id}, 'QS', '${u.email.split('@')[0]}', '${u.email}', '${u.type}', 'ACTIVE', ${SV})`)
      .join(', ')};
  DELETE FROM job_log WHERE job_no = '${JOB}';
  DELETE FROM job WHERE job_no = '${JOB}' OR customer_id = 9701;
  DELETE FROM sale_out_dt WHERE sale_out_hd_no IN (SELECT sale_out_hd_no FROM sale_out_hd WHERE customer_code = '${CUSTOMER}');
  DELETE FROM sale_out_hd WHERE customer_code = '${CUSTOMER}';
  DELETE FROM customer WHERE customer_id = 9701 OR customer_code = '${CUSTOMER}';
  INSERT INTO customer (customer_id, customer_code, customer_name, phone_number) VALUES (9701, '${CUSTOMER}', 'ลูกค้า QA SO', '02-977-0001');
  DELETE FROM product_none_serial WHERE product_id IN (9701, 9702) OR item_id IN (9701, 9702);
  DELETE FROM product WHERE product_id IN (9701, 9702) OR product_code IN ('${P.a}', '${P.gone}');
  INSERT INTO product (product_id, product_code, product_name) VALUES (9701, '${P.a}', 'อะไหล่ QS 1'), (9702, '${P.gone}', 'อะไหล่ QS ลบแล้ว');
  INSERT INTO product_none_serial (item_id, product_id, quantity_available, quantity_used, quantity_booking, quantity_remain, retail_price)
    VALUES (9701, 9701, 1000, 0, 0, 1000, 100.00), (9702, 9702, 1000, 0, 0, 1000, 50.00);
  INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date, job_payment_slip_file_name)
    VALUES ('${JOB}', 2, 9701, '${CUSTOMER} ลูกค้า QA SO', 'Model QS', now(), current_date, '1900-01-01', 'jobs/${JOB}/slip/old.png');
`);
// as test-domain: this year's Inventory-Out series past the numbers other suites already used
await db.transaction((tx) => nextRunningNo(tx, 'Inventory-Out'));
await pool.query(`
  UPDATE running_no r SET number = greatest(r.number, coalesce((
    SELECT max(substring(h.inventory_no FROM length(r.prefix) + 3)::int) FROM inventory_hd h
     WHERE h.inventory_no ~ ('^' || r.prefix || right(r.pyear::text, 2) || '[0-9]+$')), 0))
   WHERE r.running_type = 'Inventory-Out' AND r.length_year = 2`);

// ---- helpers ----
async function cookieFor(u: TestUser) {
  const now = Date.now();
  return `${SESSION_COOKIE}=${await signSession({ email: u.email, name: u.email, exp: now + 10 * 60_000, iat: now, sv: SV })}`;
}
async function request(path: string, u: TestUser, body: unknown) {
  return new NextRequest(`https://svc.example.test${path}`, {
    method: 'POST',
    headers: { 'user-agent': 'test-qa-so', 'content-type': 'application/json', cookie: await cookieFor(u) },
    body: JSON.stringify(body),
  });
}
type Res = { status: number; body: Record<string, unknown> & { error?: string; order?: Order } };
type Order = { no: string; version: number; tracking: string; deliveryDate: string; slip: string; lines: unknown[] };
const json = async (r: Response): Promise<Res> => ({ status: r.status, body: (await r.json()) as Res['body'] });
const params = (no: string) => ({ params: Promise.resolve({ no }) });

const save = async (u: TestUser, body: Record<string, unknown>) =>
  json(await soPOST(await request('/api/sale-orders', u, body)));
const create = async (u: TestUser, extra: Record<string, unknown> = {}) => {
  const r = await save(u, {
    customerCode: CUSTOMER,
    salesId: u.id,
    submit: true,
    lines: [{ code: P.a, qty: 1 }],
    ...extra,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.order!;
};
const decide = async (u: TestUser, no: string, decision: string, extra: Record<string, unknown> = {}) =>
  json(
    await approvePOST(
      await request(`/api/sale-orders/${no}/approve`, u, { decision, remark: 'QS', ...extra }),
      params(no),
    ),
  );
const track = async (u: TestUser, no: string, body: Record<string, unknown>) =>
  json(await trackingPOST(await request(`/api/sale-orders/${no}/tracking`, u, body), params(no)));
const png = await (
  await import('sharp')
)
  .default({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } })
  .png()
  .toBuffer();
const upload = async (u: TestUser, kind: string, id: string) => {
  const fd = new FormData();
  fd.set('kind', kind);
  fd.set('id', id);
  fd.set('file', new File([new Uint8Array(png)], 'slip.png', { type: 'image/png' }));
  return json(
    await uploadPOST(
      new NextRequest('https://svc.example.test/api/upload', {
        method: 'POST',
        headers: { cookie: await cookieFor(u), 'user-agent': 'test-qa-so' },
        body: fd,
      }),
    ),
  );
};
const hd = async (no: string) =>
  (
    await db.execute<{ slip: string | null; tracking: string | null; delivery: string }>(
      sql`SELECT slip_file_name AS slip, delivery_tracking_no AS tracking, delivery_date::text AS delivery FROM sale_out_hd WHERE sale_out_hd_no = ${no}`,
    )
  ).rows[0];
/** a slip already on the order (and in storage), as an earlier upload left it */
const presetSlip = async (no: string) => {
  const old = `sale-orders/${no}/slip/old.png`;
  await db.execute(sql`UPDATE sale_out_hd SET slip_file_name = ${old} WHERE sale_out_hd_no = ${no}`);
  stored.add(old);
  return old;
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
  console.log('\nQA sale orders — slip vs approval (/api/upload)');
  await test('slip upload ∥ approval: the approved slip never changes, the late file is removed, 409 says approved', async () => {
    const o = await create(U.seller);
    const old = await presetSlip(o.no);
    const [up, ok] = await Promise.all([upload(U.seller, 'sale-order-slip', o.no), decide(U.manager, o.no, 'approve')]);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(up, { status: 409, body: { error: 'ใบสั่งขายอนุมัติแล้ว — เปลี่ยนสลิปไม่ได้' } });
    assert.equal((await hd(o.no)).slip, old, 'the slip the approver saw');
    assert.deepEqual(filesUnder(`sale-orders/${o.no}/`), [old], 'the approved slip kept, the refused one removed');
  });
  await test('two slip uploads at once: the last write wins and the replaced files are removed (none orphaned)', async () => {
    const o = await create(U.seller, { submit: false });
    await presetSlip(o.no);
    const rs = await Promise.all([
      upload(U.seller, 'sale-order-slip', o.no),
      upload(U.seller, 'sale-order-slip', o.no),
    ]);
    assert.deepEqual(
      rs.map((r) => r.status),
      [200, 200],
    );
    const now = (await hd(o.no)).slip!;
    assert.ok(rs.some((r) => r.body.path === now));
    assert.deepEqual(filesUnder(`sale-orders/${o.no}/`), [now]);
  });
  await test('two job slip uploads at once: the replaced files are removed (none orphaned)', async () => {
    stored.add(`jobs/${JOB}/slip/old.png`);
    const rs = await Promise.all([upload(U.admin, 'job-slip', JOB), upload(U.admin, 'job-slip', JOB)]);
    assert.deepEqual(
      rs.map((r) => r.status),
      [200, 200],
    );
    const [{ f }] = (
      await db.execute<{ f: string }>(sql`SELECT job_payment_slip_file_name AS f FROM job WHERE job_no = ${JOB}`)
    ).rows;
    assert.deepEqual(filesUnder(`jobs/${JOB}/`), [f]);
  });

  console.log('\nQA sale orders — tracking number');
  const approved = async () => {
    const o = await create(U.seller);
    const r = await decide(U.manager, o.no, 'approve');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.order!;
  };
  await test('two users save a tracking number from the same screen: one wins, the other gets 409 (nothing lost silently)', async () => {
    const o = await approved();
    const [a, b] = await Promise.all([
      track(U.seller, o.no, { tracking: 'QSAAA111', version: o.version }),
      track(U.manager, o.no, { tracking: 'QSBBB222', version: o.version }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
    const win = a.status === 200 ? 'QSAAA111' : 'QSBBB222';
    assert.equal((await hd(o.no)).tracking, win);
    // a later save from the stale screen is refused too; one from the reloaded screen passes
    assert.equal((await track(U.seller, o.no, { tracking: 'QSCCC333', version: o.version })).status, 409);
    const fresh = (a.status === 200 ? a : b).body.order!;
    assert.equal((await track(U.seller, o.no, { tracking: 'QSCCC333', version: fresh.version })).status, 200);
  });
  await test('clearing the tracking number leaves no delivery date (and an empty save never stamps one)', async () => {
    const o = await approved();
    const empty = await track(U.seller, o.no, { tracking: '' });
    assert.equal(empty.status, 200, JSON.stringify(empty.body));
    assert.equal(empty.body.order!.deliveryDate, '', 'never sent, never stamped');
    const set = await track(U.seller, o.no, { tracking: 'QSDDD444' });
    assert.notEqual(set.body.order!.deliveryDate, '');
    const cleared = await track(U.seller, o.no, { tracking: '', version: set.body.order!.version });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.equal(cleared.body.order!.deliveryDate, '');
    assert.match((await hd(o.no)).delivery, /^1900-01-01/);
  });

  console.log('\nQA sale orders — race messages');
  await test('a deny that loses to a send-back says it was already sent back, not "not submitted yet"', async () => {
    const o = await create(U.seller);
    assert.equal((await decide(U.manager, o.no, 'reject')).status, 200);
    const late = await decide(U.admin, o.no, 'deny', { version: o.version });
    assert.equal(late.status, 409);
    assert.match(late.body.error!, /ส่งกลับแก้ไขไปแล้ว/);
    assert.doesNotMatch(late.body.error!, /ยังไม่ได้ส่งขออนุมัติ/);
  });
  await test('the creator saving after the approval is told it is approved, not "someone else edited it"', async () => {
    const o = await create(U.seller);
    assert.equal((await decide(U.manager, o.no, 'approve')).status, 200);
    const r = await save(U.seller, {
      no: o.no,
      version: o.version,
      customerCode: CUSTOMER,
      salesId: U.seller.id,
      submit: true,
      lines: [{ code: P.a, qty: 2 }],
    });
    assert.deepEqual([r.status, r.body.error], [409, 'ใบสั่งขายอนุมัติแล้ว แก้ไขไม่ได้']);
  });

  console.log('\nQA sale orders — deleted products');
  await test('a DELETED product is refused on create and on a changed line; an old order keeps (and re-saves) its line', async () => {
    const old = await create(U.seller, { submit: false, lines: [{ code: P.gone, qty: 1 }] });
    await db.execute(sql`UPDATE product SET record_status = 'DELETED' WHERE product_code = ${P.gone}`);
    try {
      const r = await save(U.seller, {
        customerCode: CUSTOMER,
        salesId: U.seller.id,
        lines: [{ code: P.gone, qty: 1 }],
      });
      assert.equal(r.status, 400, JSON.stringify(r.body));
      assert.match(r.body.error!, new RegExp(`${P.gone}.*ถูกลบ`));
      const edit = { no: old.no, customerCode: CUSTOMER, salesId: U.seller.id, submit: false };
      const kept = await save(U.seller, {
        ...edit,
        remark: 'QS แก้หมายเหตุ',
        lines: [{ code: P.gone, qty: 1, price: 50 }],
      });
      assert.equal(kept.status, 200, JSON.stringify(kept.body));
      assert.equal(kept.body.order!.lines.length, 1);
      const changed = await save(U.seller, { ...edit, lines: [{ code: P.gone, qty: 3, price: 50 }] });
      assert.equal(changed.status, 400, JSON.stringify(changed.body));
    } finally {
      await db.execute(sql`UPDATE product SET record_status = 'ACTIVE' WHERE product_code = ${P.gone}`);
    }
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
