/**
 * scripts/test-qa-admin.mts — admin + reports regressions: two admins on
 * the same user / role / master row, duplicate master names saved at the same instant, the permissions API,
 * the export cap signal, the 403 wording and the audit time.
 *
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-admin.mts
 * Seeds its own fixtures (ids 94xx, roles "QA *") and resets them at every start. ONLY a local *_test database.
 */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
Object.assign(process.env, {
  SESSION_SECRET: 'unit-test-session-secret-0123456789abcdef',
  DB_POOL_MAX: '25', // the race tests need real concurrency
});
globalThis.fetch = (async () => new Response('{}', { status: 503 })) as typeof fetch; // no directory lookups

const { db, pool } = await import('@/db/client');
const { HttpError, requireCan } = await import('@/server/auth');
const { signSession, SESSION_COOKIE } = await import('@/lib/session');
const { saveSimple, saveSymptom } = await import('@/server/services/masters');
const { listAudit } = await import('@/server/audit');
const { MAX_EXPORT_ROWS } = await import('@/lib/export-limit');
const usersRoute = await import('@/app/api/admin/users/route');
const permsRoute = (await import('@/app/api/admin/permissions/route')) as Record<
  string,
  (req: NextRequest) => Promise<Response>
>;
const mastersRoute = await import('@/app/api/masters/[kind]/route');
const exportRoute = await import('@/app/api/export/[resource]/route');

const SV = 3;
const U = {
  a: { id: 9401, email: 'qa-admin-a@example.invalid', type: 'System Admin' },
  b: { id: 9402, email: 'qa-admin-b@example.invalid', type: 'System Admin' },
  t1: { id: 9403, email: 'qa-target1@example.invalid', type: 'QA Clerk' },
  t2: { id: 9404, email: 'qa-target2@example.invalid', type: 'QA Clerk' },
  viewer: { id: 9405, email: 'qa-viewer@example.invalid', type: 'QA Viewer' },
} as const;
type Who = (typeof U)[keyof typeof U];
const rand = Math.random().toString(36).slice(2, 7);

await pool.query(`
  DELETE FROM role_permission WHERE user_type ILIKE 'QA %';
  INSERT INTO role_permission (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
    ('QA Clerk', 'Customer', false, false, false, true),
    ('QA Clerk2', 'Customer', false, false, false, true),
    ('QA Viewer', 'Customer', false, false, false, true),
    ('QA Grid', 'Quotation', false, false, false, false);
  INSERT INTO app_user (pk, first_name, last_name, email_address, user_type, record_status, session_version)
  OVERRIDING SYSTEM VALUE VALUES
    ${Object.values(U)
      .map((u) => `(${u.id}, 'QA', '${u.email.split('@')[0]}', '${u.email}', '${u.type}', 'ACTIVE', ${SV})`)
      .join(',\n    ')}
    -- fixture users stay (audit_log, append-only, points at them): reset in place
    ON CONFLICT (pk) DO UPDATE SET (first_name, last_name, email_address, user_type, record_status, session_version, last_login, title, avatar, department)
      = ROW(excluded.first_name, excluded.last_name, excluded.email_address, excluded.user_type, excluded.record_status, excluded.session_version, NULL, NULL, NULL, NULL);
`);

async function request(path: string, u: Who, init: { method?: string; body?: unknown } = {}) {
  const now = Date.now();
  const headers: Record<string, string> = {
    'user-agent': 'test-qa-admin',
    cookie: `${SESSION_COOKIE}=${await signSession({ email: u.email, name: u.email, exp: now + 600_000, iat: now, sv: SV })}`,
  };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`https://svc.example.test${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
async function json(r: Response) {
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}
const postUser = async (u: Who, body: Record<string, unknown>) =>
  json(await usersRoute.POST(await request('/api/admin/users', u, { method: 'POST', body })));
const perms = async (u: Who, method: string, body?: unknown, query = '') => {
  const handler = permsRoute[method];
  assert.ok(handler, `${method} /api/admin/permissions is not exported`);
  return json(await handler(await request(`/api/admin/permissions${query}`, u, { method, body })));
};
const userRow = async (id: number) =>
  (
    await db.execute<{ role: string; rs: string; first: string }>(
      sql`SELECT user_type AS role, record_status AS rs, first_name AS first FROM app_user WHERE pk = ${id}`,
    )
  ).rows[0]!;
/** the row as the users page loaded it (GET /api/admin/users) */
const loaded = async (u: Who) => {
  const r = await json(await usersRoute.GET(await request('/api/admin/users', U.a)));
  return (r.body.rows as Record<string, string>[]).find((x) => x.email === u.email)!;
};
async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
}

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

try {
  console.log('\n1. users — a stale view never undoes another admin');
  await test('U1: A revokes, B saves the edit dialog it opened before → 409 stale, the user stays revoked', async () => {
    const seen = await loaded(U.t1); // B opens แก้ไข
    // A revokes from the edit dialog (the whole row it loaded, status changed)
    const a = await postUser(U.a, { ...seen, phone: undefined, status: 'Inactive', expect: { status: seen.status } });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await postUser(U.b, {
      ...seen,
      phone: undefined,
      name: 'QA renamed',
      expect: { name: seen.name, email: seen.email, role: seen.role, status: seen.status },
    });
    assert.equal(b.status, 409, JSON.stringify(b.body));
    const row = await userRow(U.t1.id);
    assert.deepEqual([row.rs, row.first], ['INACTIVE', 'QA']);
  });
  await test('U2: A changes the role, B (stale) presses ถอนสิทธิ์ → revoked, the new role kept', async () => {
    const seen = await loaded(U.t2);
    const a = await postUser(U.a, { ...seen, phone: undefined, role: 'QA Clerk2', expect: { role: seen.role } });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    // the quick action sends only what it changes
    const b = await postUser(U.b, { id: seen.id, status: 'Inactive', expect: { status: seen.status } });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    const row = await userRow(U.t2.id);
    assert.deepEqual([row.role, row.rs], ['QA Clerk2', 'INACTIVE']);
  });

  console.log('\n2. permissions — two admins on the same role');
  const off = { add: false, edit: false, del: false, view: false };
  const grid = async (role: string) =>
    Object.fromEntries(
      (
        await db.execute<{ m: string; a: boolean; e: boolean; d: boolean; v: boolean }>(
          sql`SELECT module_name AS m, can_insert AS a, can_edit AS e, can_delete AS d, can_view AS v FROM role_permission WHERE user_type = ${role}`,
        )
      ).rows.map((r) => [r.m, { add: r.a, edit: r.e, del: r.d, view: r.v }]),
    );
  await test('two saves of different menus (both from the same loaded grid) → both kept, each audited by its admin', async () => {
    const a = await perms(U.a, 'POST', {
      items: [{ role: 'QA Grid', menu: 'Customer', ...off, view: true, was: off }],
    });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await perms(U.b, 'POST', {
      items: [{ role: 'QA Grid', menu: 'Sale Order', ...off, view: true, was: off }],
    });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    const g = await grid('QA Grid');
    assert.deepEqual([g.Customer?.view, g['Sale Order']?.view, g.Quotation?.view], [true, true, false]);
    const lines = (
      await db.execute<{ u: number; c: Record<string, unknown> }>(
        sql`SELECT actor_pk::int AS u, changes AS c FROM audit_log WHERE entity = 'role_permission' AND entity_key = 'QA Grid' ORDER BY pk DESC LIMIT 2`,
      )
    ).rows;
    assert.deepEqual(
      lines.map((l) => [l.u, Object.keys(l.c)]),
      [
        [U.b.id, ['Sale Order']],
        [U.a.id, ['Customer']],
      ],
    );
  });
  await test('the same menu changed by A, then saved by B from the old grid → 409 naming it, nothing written', async () => {
    const a = await perms(U.a, 'POST', {
      items: [{ role: 'QA Grid', menu: 'Quotation', ...off, view: true, was: off }],
    });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await perms(U.b, 'POST', {
      items: [
        { role: 'QA Grid', menu: 'Quotation', ...off, add: true, was: off },
        { role: 'QA Grid', menu: 'Product', ...off, view: true, was: off },
      ],
    });
    assert.equal(b.status, 409, JSON.stringify(b.body));
    assert.match(String(b.body.error), /Quotation/);
    const g = await grid('QA Grid');
    assert.deepEqual(g.Quotation, { ...off, view: true });
    assert.equal(g.Product, undefined, 'nothing of the refused save was written');
  });

  console.log('\n3. masters — duplicate names saved at the same instant');
  // open the connections first: a cold pool connects one by one and the first race would never overlap
  await Promise.all(Array.from({ length: 8 }, () => pool.query('SELECT pg_sleep(0.05)')));
  for (const [kind, save] of [
    ['categories', (name: string) => saveSimple('categories', { name }, U.a.id)],
    ['colors', (name: string) => saveSimple('colors', { name }, U.a.id)],
    ['symptoms', (name: string) => saveSymptom({ name }, U.a.id)],
  ] as const)
    await test(`${kind}: four saves of one name in different case / spaces at once → one row, the rest 409`, async () => {
      const names = [`QA Race ${rand}`, `qa race ${rand}`, `QA  RACE ${rand}`, `qarace${rand.toUpperCase()}`];
      const got = await Promise.all(names.map((n) => statusOf(save(n))));
      assert.deepEqual(
        got.toSorted((x, y) => x - y),
        [200, 409, 409, 409],
      );
    });

  console.log('\n4. masters — two admins editing the same row');
  await test('A renames a colour, B saves the dialog it opened before → 409 stale, A’s name kept', async () => {
    const row = await saveSimple('colors', { name: `QA Edit ${rand}` }, U.a.id);
    const was = { name: row.name, detail: row.detail, status: row.status };
    const save = async (u: Who, body: Record<string, unknown>) =>
      json(
        await mastersRoute.POST(await request('/api/masters/colors', u, { method: 'POST', body }), {
          params: Promise.resolve({ kind: 'colors' }),
        }),
      );
    const a = await save(U.a, { id: row.id, name: `QA Edit A ${rand}`, detail: '', status: 'Active', expect: was });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await save(U.b, { id: row.id, name: row.name, detail: 'B', status: 'Active', expect: was });
    assert.equal(b.status, 409, JSON.stringify(b.body));
    const [now] = (
      await db.execute<{ n: string; d: string }>(
        sql`SELECT color_name AS n, coalesce(description, '') AS d FROM color WHERE id = ${row.id}`,
      )
    ).rows;
    assert.deepEqual([now?.n, now?.d], [`QA Edit A ${rand}`, '']);
  });

  await test('A renames a model, B saves a price from the dialog it opened before → 409 stale, A’s name kept', async () => {
    const brand = await saveSimple('manufacturers', { name: `QA Brand ${rand}` }, U.a.id);
    const save = async (u: Who, body: Record<string, unknown>) =>
      json(
        await mastersRoute.POST(await request('/api/masters/models', u, { method: 'POST', body }), {
          params: Promise.resolve({ kind: 'models' }),
        }),
      );
    const made = await save(U.a, { name: `QA Model ${rand}`, brand: brand.name, price: '100', status: 'Active' });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const row = made.body.row as { code: string; name: string; brand: string; price: number; status: string };
    const was = { name: row.name, brand: row.brand, price: String(row.price), status: row.status };
    const a = await save(U.a, { ...was, code: row.code, name: `QA Model A ${rand}`, expect: was });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await save(U.b, { ...was, code: row.code, price: '250', expect: was });
    assert.equal(b.status, 409, JSON.stringify(b.body));
    assert.equal((b.body.details as { stale?: boolean } | undefined)?.stale, true);
    const [now] = (
      await db.execute<{ n: string; p: string }>(
        sql`SELECT model_name AS n, market_price::text AS p FROM model WHERE model_code = ${row.code}`,
      )
    ).rows;
    assert.deepEqual([now?.n, Number(now?.p)], [`QA Model A ${rand}`, 100]);
  });

  console.log('\n6. export — the 20,000-row cap is signalled; the file is named by the report');
  await test('a capped export answers X-Export-Truncated: <total>; ?file= names the file', async () => {
    const key = `qa-cap-${rand}`;
    await pool.query(
      `INSERT INTO audit_log (at, actor_name, action, module, entity, entity_key, summary)
       SELECT now(), 'qa', 'UPDATE', 'Admin', 'qa_cap', $1, 'qa' FROM generate_series(1, $2)`,
      [key, MAX_EXPORT_ROWS + 5],
    );
    const res = await exportRoute.GET(await request(`/api/export/audit_log?key=${key}&file=audit-qa`, U.a), {
      params: Promise.resolve({ resource: 'audit_log' }),
    });
    await res.arrayBuffer(); // read to the end: cancelling the web stream mid-file crashes Node (toWeb adapter)
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-export-truncated'), String(MAX_EXPORT_ROWS + 5));
    assert.match(res.headers.get('content-disposition') ?? '', /filename="audit-qa-\d{4}-\d\d-\d\d-partial\.xlsx"/);
    const small = await exportRoute.GET(await request('/api/export/colors', U.a), {
      params: Promise.resolve({ resource: 'colors' }),
    });
    await small.arrayBuffer();
    assert.equal(small.headers.get('x-export-truncated'), null);
  });

  console.log('\n7. permissions API — only known menus; roles can be removed when nobody holds them');
  await test('an unknown menu → 400, nothing stored; a role name over 50 characters → 400', async () => {
    const r = await perms(U.a, 'POST', { items: [{ role: 'QA Grid', menu: 'RQ-BOGUS-MENU', view: true }] });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal((await grid('QA Grid'))['RQ-BOGUS-MENU'], undefined);
    const long = await perms(U.a, 'POST', { items: [{ role: `QA ${'x'.repeat(60)}`, menu: 'Customer', view: true }] });
    assert.equal(long.status, 400, JSON.stringify(long.body));
    const right = await perms(U.a, 'POST', { items: [{ role: 'QA Grid', menu: 'Export', view: true }] });
    assert.equal(right.status, 200, 'a special right is a known menu');
  });
  await test('ลบตำแหน่ง: a role someone holds → 409; an unused one → its rows gone', async () => {
    const held = await perms(U.a, 'DELETE', undefined, `?role=${encodeURIComponent('QA Viewer')}`);
    assert.equal(held.status, 409, JSON.stringify(held.body));
    assert.ok(Object.keys(await grid('QA Viewer')).length > 0);
    const gone = await perms(U.a, 'DELETE', undefined, `?role=${encodeURIComponent('QA Grid')}`);
    assert.equal(gone.status, 200, JSON.stringify(gone.body));
    assert.deepEqual(await grid('QA Grid'), {});
    const admin = await perms(U.a, 'DELETE', undefined, `?role=${encodeURIComponent('System Admin')}`);
    assert.equal(admin.status, 409, 'System Admin stays');
  });

  await test('a new role that differs from an existing one only in case / spaces → refused, nothing stored', async () => {
    const r = await perms(U.a, 'POST', { items: [{ role: 'qa  viewer', menu: 'Customer', view: true }] });
    assert.ok([400, 409].includes(r.status), JSON.stringify(r.body));
    assert.match(String(r.body.error), /QA Viewer/);
    assert.deepEqual(await grid('qa  viewer'), {});
    const same = await perms(U.a, 'POST', { items: [{ role: 'QA Viewer', menu: 'Customer', view: true }] });
    assert.equal(same.status, 200, 'the role itself still saves');
  });

  console.log('\n9. wording');
  await test('a 403 names the Thai menu, not the module key', async () => {
    try {
      await requireCan(await request('/', U.viewer), 'Customer', 'add');
      assert.fail('should be refused');
    } catch (e) {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 403);
      assert.ok(!e.message.includes('Customer') && e.message.includes('ลูกค้า'), e.message);
    }
  });
  await test('audit rows carry the time to the second', async () => {
    const [row] = await listAudit({ limit: 1 });
    assert.match(row?.at ?? '', /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
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
