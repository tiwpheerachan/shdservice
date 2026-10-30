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
const { POST: approvePOST } = await import('@/app/api/sale-orders/[id]/approve/route');
const { POST: trackingPOST } = await import('@/app/api/sale-orders/[id]/tracking/route');
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
  INSERT INTO stock_move_type (stock_move_type_id, stock_move_type_name, movement_action_type, movement_action, is_active)
    SELECT * FROM (VALUES (1, 'รับเข้า', 'รับเข้า', 1, true), (2, 'รับคืนจากการเบิก', 'รับเข้า', 1, true),
                          (3, 'จ่ายออกตามงานซ่อม', 'จ่ายออก', -1, true), (4, 'จ่ายออกตามใบสั่งขาย', 'จ่ายออก', -1, true),
                          (5, 'จ่ายออกอื่นๆ', 'จ่ายออก', -1, true)) v(id, name, kind, act, on_)
     WHERE NOT EXISTS (SELECT 1 FROM stock_move_type t WHERE t.stock_move_type_id = v.id);
  INSERT INTO store_location (store_location_id, store_location_name, is_active)
    SELECT * FROM (VALUES (1, 'คลังสินค้าดี', true), (2, 'คลังสินค้าเสีย', true)) v(id, name, on_)
     WHERE NOT EXISTS (SELECT 1 FROM store_location s WHERE s.store_location_id = v.id);
  INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
    SELECT 2, 'กำลังดำเนินการ', 2, 'Open', true WHERE NOT EXISTS (SELECT 1 FROM job_status WHERE job_status_id = 2);
  -- sale_order.approve_status_id has a foreign key (drizzle/0006): src/lib/status-ids.ts AS
  INSERT INTO approve_status (approve_status_id, approve_name_th, approve_name_en, is_can_edit, is_can_revise)
    SELECT * FROM (VALUES (1, 'กำลังดำเนินการจัดทำ', 'In Progess', true, true), (2, 'รออนุมัติ', 'Wait Approve', true, true),
                          (3, 'แก้ไขข้อมูล', 'Reject', true, true), (4, 'อนุมัติแล้ว', 'Approved', false, false),
                          (5, 'ปฏิเสธ', 'Deny', false, false)) v(id, th, en, ed, rv)
     WHERE NOT EXISTS (SELECT 1 FROM approve_status s WHERE s.approve_status_id = v.id);
  -- and sale_order_line.condition_id (CONDITION_ID 1)
  INSERT INTO condition (condition_id, condition_name, is_active)
    SELECT 1, 'สินค้าใหม่', true WHERE NOT EXISTS (SELECT 1 FROM condition WHERE condition_id = 1);
  DELETE FROM role_permission WHERE user_type = 'QS Seller';
  INSERT INTO role_permission (user_type, module_name, can_insert, can_edit, can_delete, can_view)
    VALUES ('QS Seller', 'Sale Order', true, true, false, true);
  INSERT INTO role_permission (user_type, module_name, can_insert, can_edit, can_delete, can_view)
    VALUES ('Manager', 'Sale Order', true, true, true, true), ('Manager', 'SO Approve', false, false, false, true)
    ON CONFLICT (user_type, module_name) DO UPDATE SET can_insert = true, can_edit = true, can_view = true;
  -- fixture users keep their pk (audit_log, append-only, points at them: never deleted) — upserted
  INSERT INTO app_user (pk, first_name, last_name, email_address, user_type, record_status, session_version) OVERRIDING SYSTEM VALUE VALUES
    ${Object.values(U)
      .map((u) => `(${u.id}, 'QS', '${u.email.split('@')[0]}', '${u.email}', '${u.type}', 'ACTIVE', ${SV})`)
      .join(', ')}
    ON CONFLICT (pk) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
      email_address = excluded.email_address, user_type = excluded.user_type, record_status = 'ACTIVE',
      session_version = excluded.session_version, last_login = DEFAULT;
  -- children before parents (RESTRICT, drizzle/0006): lines, movements, orders, the job, the customer, the parts
  DELETE FROM sale_order_line WHERE sale_order_pk IN (SELECT pk FROM sale_order WHERE customer_pk = 9701)
    OR product_pk IN (9701, 9702);
  DELETE FROM stock_move_line WHERE product_pk IN (9701, 9702) OR stock_move_pk IN (SELECT h.pk FROM stock_move h
    WHERE h.sale_order_pk IN (SELECT pk FROM sale_order WHERE customer_pk = 9701)
       OR h.job_pk IN (SELECT pk FROM job WHERE job_no = '${JOB}' OR customer_pk = 9701));
  DELETE FROM stock_move WHERE sale_order_pk IN (SELECT pk FROM sale_order WHERE customer_pk = 9701)
    OR job_pk IN (SELECT pk FROM job WHERE job_no = '${JOB}' OR customer_pk = 9701);
  DELETE FROM sale_order WHERE customer_pk = 9701;
  DELETE FROM job_status_log WHERE job_pk IN (SELECT pk FROM job WHERE job_no = '${JOB}' OR customer_pk = 9701);
  DELETE FROM job WHERE job_no = '${JOB}' OR customer_pk = 9701;
  DELETE FROM customer WHERE pk = 9701 OR customer_code = '${CUSTOMER}';
  INSERT INTO customer (pk, customer_code, customer_name, phone_number) OVERRIDING SYSTEM VALUE VALUES (9701, '${CUSTOMER}', 'ลูกค้า QA SO', '02-977-0001');
  DELETE FROM product_stock WHERE product_pk IN (9701, 9702) OR pk IN (9701, 9702);
  DELETE FROM product WHERE pk IN (9701, 9702) OR product_code IN ('${P.a}', '${P.gone}');
  INSERT INTO product (pk, product_code, product_name) OVERRIDING SYSTEM VALUE VALUES (9701, '${P.a}', 'อะไหล่ QS 1'), (9702, '${P.gone}', 'อะไหล่ QS ลบแล้ว');
  INSERT INTO product_stock (pk, product_pk, quantity_available, quantity_used, quantity_booking, quantity_remain, retail_price)
    OVERRIDING SYSTEM VALUE VALUES (9701, 9701, 1000, 0, 0, 1000, 100.00), (9702, 9702, 1000, 0, 0, 1000, 50.00);
  -- job.model_pk is NOT NULL (drizzle/0006): a model every fixture job without its own can point at (never deleted)
  INSERT INTO model (model_code, model_name, record_status)
    SELECT 'TST-M', 'Test model', 'ACTIVE' WHERE NOT EXISTS (SELECT 1 FROM model WHERE model_code = 'TST-M');
  INSERT INTO job (model_pk, job_no, job_status_id, customer_pk, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date, job_payment_slip_file_name)
    VALUES ((SELECT pk FROM model WHERE model_code = 'TST-M'), '${JOB}', 2, 9701, '${CUSTOMER} ลูกค้า QA SO', 'Model QS', now(), current_date, '1900-01-01', 'jobs/${JOB}/slip/old.png');
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
async function request(path: string, u: TestUser, body: unknown) {
  return new NextRequest(`https://svc.example.test${path}`, {
    method: 'POST',
    headers: { 'user-agent': 'test-qa-so', 'content-type': 'application/json', cookie: await cookieFor(u) },
    body: JSON.stringify(body),
  });
}
type Res = { status: number; body: Record<string, unknown> & { error?: string; order?: Order } };
type Order = {
  no: string;
  version: number;
  tracking: string;
  deliveryDate: string;
  slip: string;
  lines: { id: string }[];
};
const json = async (r: Response): Promise<Res> => ({ status: r.status, body: (await r.json()) as Res['body'] });
/** an order's / a user's uuid — what the API takes (ADR 0008); an unknown number → a uuid of no order */
const soIdOf = async (no: string) =>
  (await pool.query<{ id: string }>('SELECT id::text FROM sale_order WHERE sale_order_no = $1', [no])).rows[0]?.id ??
  '00000000-0000-7000-8000-000000000000';
const userUuid = async (userId: number) =>
  (await pool.query<{ id: string }>('SELECT id::text FROM app_user WHERE pk = $1', [userId])).rows[0]!.id;
const params = async (no: string) => ({ params: Promise.resolve({ id: await soIdOf(no) }) });

const save = async (u: TestUser, body: Record<string, unknown>) =>
  json(await soPOST(await request('/api/sale-orders', u, body)));
const create = async (u: TestUser, extra: Record<string, unknown> = {}) => {
  const r = await save(u, {
    customerCode: CUSTOMER,
    salesId: await userUuid(u.id),
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
      await params(no),
    ),
  );
const track = async (u: TestUser, no: string, body: Record<string, unknown>) =>
  json(await trackingPOST(await request(`/api/sale-orders/${no}/tracking`, u, body), await params(no)));
const png = await (
  await import('sharp')
)
  .default({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } })
  .png()
  .toBuffer();
const upload = async (u: TestUser, kind: string, id: string) => {
  const fd = new FormData();
  fd.set('kind', kind);
  fd.set('id', kind === 'sale-order-slip' ? await soIdOf(id) : id);
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
    await db.execute<{ slip: string | null; tracking: string | null; delivery: string | null }>(
      sql`SELECT slip_file_name AS slip, delivery_tracking_no AS tracking, delivery_date::text AS delivery FROM sale_order WHERE sale_order_no = ${no}`,
    )
  ).rows[0];
/** a slip already on the order (and in storage), as an earlier upload left it */
const presetSlip = async (no: string) => {
  const old = `sale-orders/${no}/slip/old.png`;
  await db.execute(sql`UPDATE sale_order SET slip_file_name = ${old} WHERE sale_order_no = ${no}`);
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
    assert.equal((await hd(o.no)).delivery, null, 'no date: NULL, never 1900-01-01 (owner rule 2026-10-30)');
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
      salesId: await userUuid(U.seller.id),
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
        salesId: await userUuid(U.seller.id),
        lines: [{ code: P.gone, qty: 1 }],
      });
      assert.equal(r.status, 400, JSON.stringify(r.body));
      assert.match(r.body.error!, new RegExp(`${P.gone}.*ถูกลบ`));
      const edit = { no: old.no, customerCode: CUSTOMER, salesId: await userUuid(U.seller.id), submit: false };
      // the stored line is sent back by its id (a line without one is a new line)
      const id = old.lines[0]!.id;
      const kept = await save(U.seller, {
        ...edit,
        remark: 'QS แก้หมายเหตุ',
        lines: [{ id, code: P.gone, qty: 1, price: 50 }],
      });
      assert.equal(kept.status, 200, JSON.stringify(kept.body));
      assert.equal(kept.body.order!.lines.length, 1);
      const changed = await save(U.seller, { ...edit, lines: [{ id, code: P.gone, qty: 3, price: 50 }] });
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
