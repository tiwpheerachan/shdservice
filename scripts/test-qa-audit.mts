/**
 * scripts/test-qa-audit.mts — the audit trail, through the real routes:
 * sign-in / sign-out / export / role and permission changes land in security_log with who did it as they were then
 * (email, role, request id, session id, the permission used), data changes in audit_log; both are append-only and
 * hashed. A user deactivated or losing a grant between the route's permission check and its write gets 403,
 * nothing is written, and one DENIED line names them. A second DB session (`blocker()`) holds the actor's row /
 * grant row so the change lands exactly between check and write.
 *
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-audit.mts
 * Seeds its own fixtures (users 9650–9655, roles "QAU *", customer QAUC01, sale order QAUSO01, emails
 * qau-*@example.invalid), reset at
 * every start. ONLY a local *_test database.
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { NextRequest } from 'next/server';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
Object.assign(process.env, {
  SESSION_SECRET: 'unit-test-session-secret-0123456789abcdef',
  SSO_CLIENT_SECRET: 'qau-sso-secret',
  OWNER_EMAILS: 'qau-owner@example.invalid',
  DB_POOL_MAX: '10',
});
/** who the fake central SSO's /sso/verify answers for; the directory and everything else is unreachable */
const identity = { email: '', name: '' };
globalThis.fetch = (async (input: RequestInfo | URL) =>
  String(input instanceof Request ? input.url : input).includes('/api/v1/sso/verify')
    ? Response.json(identity)
    : new Response('{}', { status: 503 })) as typeof fetch;

const { pool } = await import('@/db/client');
const { signSession, SESSION_COOKIE } = await import('@/lib/session');
const { STATE_COOKIE } = await import('@/lib/sso');
const { invalidateGrantCache, invalidateUserCache } = await import('@/server/auth');
const callback = await import('@/app/api/sso/callback/route');
const logout = await import('@/app/api/sso/logout/route');
const exportRoute = await import('@/app/api/export/[resource]/route');
const usersRoute = await import('@/app/api/admin/users/route');
const permsRoute = await import('@/app/api/admin/permissions/route');
const customersRoute = await import('@/app/api/customers/route');
const approveRoute = await import('@/app/api/sale-orders/[id]/approve/route');

const SV = 4;
const U = {
  admin: { pk: 9650, email: 'qau-admin@example.invalid', role: 'System Admin' },
  clerk: { pk: 9651, email: 'qau-clerk@example.invalid', role: 'QAU Clerk' },
  off: { pk: 9652, email: 'qau-off@example.invalid', role: 'QAU Clerk' },
  target: { pk: 9653, email: 'qau-target@example.invalid', role: 'QAU Clerk' },
  editor: { pk: 9654, email: 'qau-editor@example.invalid', role: 'QAU Editor' },
  seller: { pk: 9655, email: 'qau-seller@example.invalid', role: 'QAU Seller' },
} as const;
type Who = (typeof U)[keyof typeof U];
const rand = Math.random().toString(36).slice(2, 7);
const Q = async <T = Record<string, unknown>,>(text: string, params: unknown[] = []) =>
  (await pool.query(text, params)).rows as T[];

async function reset() {
  await pool.query(`
    DELETE FROM role_permission WHERE user_type IN ('QAU Clerk', 'QAU Seller', 'QAU Editor');
    INSERT INTO role_permission (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
      ('QAU Clerk', 'Customer', false, false, false, true),
      ('QAU Seller', 'Customer', false, false, false, true),
      ('QAU Seller', 'Sale Order', true, true, false, true),
      ('QAU Editor', 'Customer', false, true, false, true);
    -- fixture users stay (audit_log / security_log, append-only, point at them): reset in place
    INSERT INTO app_user (pk, username, first_name, last_name, email_address, user_type, record_status, session_version)
    OVERRIDING SYSTEM VALUE VALUES
      ${Object.values(U)
        .map(
          (u) =>
            `(${u.pk}, '${u.email.split('@')[0]}', 'QAU', '${u.email.split('@')[0]}', '${u.email}', '${u.role}', '${u === U.off ? 'INACTIVE' : 'ACTIVE'}', ${SV})`,
        )
        .join(',\n      ')}
    ON CONFLICT (pk) DO UPDATE SET username = excluded.username, first_name = excluded.first_name,
      last_name = excluded.last_name, email_address = excluded.email_address, user_type = excluded.user_type,
      record_status = excluded.record_status, session_version = excluded.session_version, last_login = DEFAULT,
      title = DEFAULT, avatar = DEFAULT, department = DEFAULT, status_changed_at = DEFAULT,
      status_changed_by_app_user_pk = DEFAULT;
    -- a job a QAU Clerk (no Job Management) is refused on (section 5b); kept across runs
    INSERT INTO model (model_code, model_name, record_status)
      SELECT 'TST-M', 'Test model', 'ACTIVE' WHERE NOT EXISTS (SELECT 1 FROM model WHERE model_code = 'TST-M');
    INSERT INTO job (job_no, job_status_id, model_pk, job_create_date, job_reception_date, record_status)
      SELECT 'QAUJ01', NULL, (SELECT pk FROM model WHERE model_code = 'TST-M'), now(), current_date, 'ACTIVE'
       WHERE NOT EXISTS (SELECT 1 FROM job WHERE job_no = 'QAUJ01');
    -- a waiting sale order a QAU Seller (no SO Approve) is refused on (section 5c); kept across runs
    INSERT INTO sale_order (sale_order_no, approve_status_id, record_status, created_by_app_user_pk, customer_name)
      SELECT 'QAUSO01', 2, 'ACTIVE', ${U.admin.pk}, 'ลูกค้า QAU'
       WHERE NOT EXISTS (SELECT 1 FROM sale_order WHERE sale_order_no = 'QAUSO01');
    UPDATE sale_order SET approve_status_id = 2 WHERE sale_order_no = 'QAUSO01';
    -- the customer the R2 edits aim at (nothing points at it)
    DELETE FROM customer WHERE customer_code = 'QAUC01';
    INSERT INTO customer (customer_code, customer_name, phone_number, record_status)
      VALUES ('QAUC01', 'QAU ลูกค้า', '02-965-0001', 'ACTIVE');
  `);
  invalidateUserCache();
  invalidateGrantCache();
}
await reset();

let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`);
  }
}

const cookieOf = async (u: Who) => {
  const now = Date.now();
  return `${SESSION_COOKIE}=${await signSession({ email: u.email, name: u.email, exp: now + 600_000, iat: now, sv: SV })}`;
};
async function request(path: string, init: { method?: string; body?: unknown; cookie?: string; as?: Who } = {}) {
  const headers: Record<string, string> = {
    'user-agent': 'test-qa-audit',
    'sec-fetch-site': 'same-origin',
    cookie: init.cookie ?? (await cookieOf(init.as ?? U.admin)),
  };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`https://svc.example.test${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** the SSO callback for `email`, as the browser comes back from the central sign-in */
async function login(email: string) {
  Object.assign(identity, { email, name: email.split('@')[0] });
  const res = await callback.GET(
    await request(`/api/sso/callback?code=c-${Math.random()}&state=s1`, { cookie: `${STATE_COOKIE}=s1` }),
  );
  assert.equal(res.status, 307, 'callback redirects');
}

type Log = {
  pk: string;
  ev: string;
  result: string | null;
  actor_pk: number | null;
  actor_email: string | null;
  actor_role: string | null;
  request_id: string | null;
  session_id: string | null;
  permission: string | null;
  entity: string | null;
  entity_id: string | null;
  entity_no: string | null;
  hashed: boolean;
  detail: Record<string, unknown> | null;
};
/** the newest pk of both logs — `since(m)` is what was written after it */
const mark = async () =>
  (
    await Q<{ a: string; s: string }>(
      `SELECT (SELECT coalesce(max(pk), 0) FROM audit_log)::text a, (SELECT coalesce(max(pk), 0) FROM security_log)::text s`,
    )
  )[0]!;
const COLS = `actor_pk::int, actor_email, actor_role, request_id, session_id, permission, entity, entity_id::text,
  entity_no, row_hash IS NOT NULL AS hashed`;
const since = async (m: { a: string; s: string }) => ({
  audit: await Q<Log>(
    `SELECT pk::text, action AS ev, NULL AS result, ${COLS}, meta AS detail FROM audit_log WHERE pk > $1 ORDER BY pk`,
    [m.a],
  ),
  security: await Q<Log>(
    `SELECT pk::text, event AS ev, result, ${COLS}, detail FROM security_log WHERE pk > $1 ORDER BY pk`,
    [m.s],
  ),
});
/** a line written for a signed-in request (or a sign-in / out) says who, as what, in which request and session */
function stamped(r: Log, u: { email: string; role: string } | null, opts: { permission?: boolean } = {}) {
  const at = `${r.ev} #${r.pk}`;
  if (u) {
    assert.equal(r.actor_email, u.email, `${at} actor_email`);
    assert.equal(r.actor_role, u.role, `${at} actor_role`);
  }
  assert.ok(r.request_id, `${at} request_id`);
  assert.ok(r.session_id, `${at} session_id`);
  assert.ok(r.hashed, `${at} row_hash`);
  if (opts.permission) assert.ok(r.permission, `${at} permission`);
}
const uuidOf = async (pk: number) =>
  (await Q<{ id: string }>('SELECT id::text FROM app_user WHERE pk = $1', [pk]))[0]!.id;

try {
  console.log('\n1. sign-in → security_log LOGIN; a first sign-in also → audit_log CREATE; refused → LOGIN_FAILED');
  await test('a known ACTIVE user: one LOGIN OK line, nothing in audit_log', async () => {
    const m = await mark();
    await login(U.clerk.email);
    const { audit, security } = await since(m);
    assert.deepEqual(
      security.map((r) => [r.ev, r.result]),
      [['LOGIN', 'OK']],
    );
    stamped(security[0]!, U.clerk);
    assert.equal(security[0]!.actor_pk, U.clerk.pk);
    assert.equal(audit.length, 0, JSON.stringify(audit));
  });
  await test('a person new to the app: LOGIN + audit_log CREATE of their app_user (entity_id = the new row)', async () => {
    const email = `qau-new-${rand}@example.invalid`;
    const m = await mark();
    await login(email);
    const { audit, security } = await since(m);
    const [created] = await Q<{ pk: number; id: string }>(
      'SELECT pk::int, id::text FROM app_user WHERE email_address = $1',
      [email],
    );
    assert.ok(created, 'the user was provisioned');
    assert.deepEqual(
      security.filter((r) => r.ev === 'LOGIN').map((r) => [r.actor_email, r.result]),
      [[email, 'OK']],
    );
    assert.deepEqual(
      audit.map((r) => [r.ev, r.entity, r.entity_id, r.actor_pk]),
      [['CREATE', 'app_user', created.id, created.pk]],
    );
    for (const r of [...audit, ...security]) stamped(r, null);
  });
  await test('an INACTIVE account: refused, one LOGIN_FAILED line naming it, no session', async () => {
    const m = await mark();
    await login(U.off.email);
    const { audit, security } = await since(m);
    assert.equal(audit.length, 0, JSON.stringify(audit));
    assert.equal(security.length, 1, JSON.stringify(security));
    const r = security[0]!;
    assert.equal(r.ev, 'LOGIN_FAILED');
    assert.ok(r.actor_email === U.off.email || r.detail?.email === U.off.email, JSON.stringify(r));
    assert.ok(r.request_id && r.hashed);
  });

  console.log('\n2. sign-out → LOGOUT + session_version bumped');
  await test('GET /api/sso/logout: one LOGOUT line, session_version + 1 (every cookie of the user dies)', async () => {
    const m = await mark();
    const res = await logout.GET(await request('/api/sso/logout', { as: U.clerk }));
    assert.equal(res.status, 307);
    const { audit, security } = await since(m);
    assert.deepEqual(
      security.map((r) => r.ev),
      ['LOGOUT'],
    );
    stamped(security[0]!, U.clerk);
    assert.equal(audit.length, 0);
    const [{ sv }] = await Q<{ sv: number }>('SELECT session_version sv FROM app_user WHERE pk = $1', [U.clerk.pk]);
    assert.equal(sv, SV + 1);
    await Q('UPDATE app_user SET session_version = $2 WHERE pk = $1', [U.clerk.pk, SV]);
    invalidateUserCache(U.clerk.email);
  });

  console.log('\n3. export → security_log EXPORT, never audit_log');
  await test('GET /api/export/customers: one EXPORT line with the permission used, no audit_log row', async () => {
    const m = await mark();
    const res = await exportRoute.GET(await request('/api/export/customers?q=QAUC01'), {
      params: Promise.resolve({ resource: 'customers' }),
    });
    await res.arrayBuffer(); // read to the end (a cancelled web stream crashes Node)
    assert.equal(res.status, 200);
    const { audit, security } = await since(m);
    assert.equal(audit.length, 0, JSON.stringify(audit));
    assert.deepEqual(
      security.map((r) => [r.ev, r.entity]),
      [['EXPORT', 'customers']],
    );
    stamped(security[0]!, U.admin, { permission: true });
  });

  console.log('\n4. role / permission changes → ROLE_CHANGE / PERMISSION_CHANGE');
  await test('admin gives a user another role: audit_log UPDATE + security_log ROLE_CHANGE, both naming the user', async () => {
    const id = await uuidOf(U.target.pk);
    const m = await mark();
    const res = await usersRoute.POST(
      await request('/api/admin/users', { method: 'POST', body: { id, role: 'QAU Seller' } }),
    );
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const { audit, security } = await since(m);
    assert.deepEqual(
      audit.map((r) => [r.entity, r.entity_id]),
      [['app_user', id]],
    );
    assert.deepEqual(
      security.map((r) => [r.ev, r.entity_id]),
      [['ROLE_CHANGE', id]],
    );
    for (const r of [...audit, ...security]) stamped(r, U.admin, { permission: true });
  });
  await test('a permission save: security_log PERMISSION_CHANGE with the role it changed', async () => {
    const role = `QAU Perm ${rand}`;
    const m = await mark();
    const res = await permsRoute.POST(
      await request('/api/admin/permissions', {
        method: 'POST',
        body: { items: [{ role, menu: 'Customer', add: false, edit: false, del: false, view: true }] },
      }),
    );
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const { audit, security } = await since(m);
    assert.ok(audit.length >= 1, 'the change is in audit_log');
    assert.ok(security.length >= 1 && security.every((r) => r.ev === 'PERMISSION_CHANGE'), JSON.stringify(security));
    for (const r of [...audit, ...security]) stamped(r, U.admin, { permission: true });
    await Q('DELETE FROM role_permission WHERE user_type = $1', [role]);
    invalidateGrantCache();
  });

  console.log('\n5. R2 — losing the right between the check and the write');
  /** a separate connection, outside the app's pool — the "other session" that holds a lock */
  async function blocker() {
    const c = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await c.connect();
    return c;
  }
  /** true once a session of this DB waits on a lock; false after `ms` */
  async function lockWaiter(ms = 8000) {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) {
      const [{ n }] = await Q<{ n: number }>(
        `SELECT count(*)::int n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if (n >= 1) return true;
    }
    return false;
  }
  const customerRow = async () =>
    (
      await Q<{ name: string; v: number }>(
        "SELECT customer_name AS name, row_version::int v FROM customer WHERE customer_code = 'QAUC01'",
      )
    )[0]!;
  /** the editor saves QAUC01 under a new name; `lock` / `change` run on the blocker between check and write */
  async function demotedMidSave(lock: string, change: string) {
    await reset();
    const before = await customerRow();
    const m = await mark();
    const b = await blocker();
    try {
      await b.query('BEGIN');
      await b.query(lock);
      const save = customersRoute.POST(
        await request('/api/customers', {
          method: 'POST',
          as: U.editor,
          body: { code: 'QAUC01', name: `QAU renamed ${rand}`, phone: '02-965-0001', version: before.v },
        }),
      );
      const waited = await Promise.race([lockWaiter(), save.then(() => false)]);
      assert.ok(waited, 'the save reached the lock (past its permission check)');
      await b.query(change);
      await b.query('COMMIT');
      const res = await save;
      assert.equal(res.status, 403, JSON.stringify(await res.clone().json()));
    } finally {
      await b.end();
    }
    assert.deepEqual(await customerRow(), before, 'the customer is unchanged');
    const { audit, security } = await since(m);
    assert.equal(audit.length, 0, `no audit_log row: ${JSON.stringify(audit)}`);
    assert.deepEqual(
      security.map((r) => [r.ev, r.result, r.actor_pk]),
      [['DENIED', 'DENIED', U.editor.pk]],
    );
    stamped(security[0]!, null, { permission: true });
    assert.equal(security[0]!.actor_email, U.editor.email);
  }
  await test('(i) the user is set INACTIVE mid-save → 403, nothing saved, one DENIED line', () =>
    demotedMidSave(
      `SELECT 1 FROM app_user WHERE pk = ${U.editor.pk} FOR UPDATE`,
      `UPDATE app_user SET record_status = 'INACTIVE' WHERE pk = ${U.editor.pk}`,
    ));
  await test("(ii) the role's Customer edit is removed mid-save → 403, nothing saved, one DENIED line", () =>
    demotedMidSave(
      "SELECT 1 FROM role_permission WHERE user_type = 'QAU Editor' AND module_name = 'Customer' FOR UPDATE",
      "UPDATE role_permission SET can_edit = false WHERE user_type = 'QAU Editor' AND module_name = 'Customer'",
    ));
  await test('control: the same save with the right intact → 200, one audit_log UPDATE with its stamp', async () => {
    await reset();
    const before = await customerRow();
    const m = await mark();
    const res = await customersRoute.POST(
      await request('/api/customers', {
        method: 'POST',
        as: U.editor,
        body: { code: 'QAUC01', name: `QAU renamed ${rand}`, phone: '02-965-0001', version: before.v },
      }),
    );
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const { audit, security } = await since(m);
    const [{ id }] = await Q<{ id: string }>("SELECT id::text FROM customer WHERE customer_code = 'QAUC01'");
    assert.deepEqual(
      audit.map((r) => [r.ev, r.entity, r.entity_id]),
      [['UPDATE', 'customer', id]],
    );
    stamped(audit[0]!, U.editor, { permission: true });
    assert.equal(security.length, 0);
  });

  console.log('\n5b. a guard refusal on a job route names the job');
  await test('POST /api/jobs/{id}/calls without Job Management → 403, one DENIED line naming the job, no audit_log row', async () => {
    const [{ id }] = await Q<{ id: string }>("SELECT id::text FROM job WHERE job_no = 'QAUJ01'");
    const calls = await import('@/app/api/jobs/[id]/calls/route');
    const m = await mark();
    const res = await calls.POST(
      await request(`/api/jobs/${id}/calls`, { method: 'POST', body: { detail: 'QAU โทรหาลูกค้า' }, as: U.clerk }),
      { params: Promise.resolve({ id }) },
    );
    assert.equal(res.status, 403);
    const { audit, security } = await since(m);
    assert.equal(audit.length, 0);
    assert.deepEqual(
      security.map((r) => [r.ev, r.result, r.actor_pk]),
      [['DENIED', 'DENIED', U.clerk.pk]],
    );
    stamped(security[0]!, U.clerk, { permission: true });
    assert.ok(security[0]!.entity_id === id || security[0]!.entity_no === 'QAUJ01', JSON.stringify(security[0]));
  });

  console.log('\n5c. refusals past the guards are DENIED too: a special right, an account switched off or signed out');
  await test('POST /api/sale-orders/{id}/approve without SO Approve → 403, one DENIED line (permission SO Approve) naming the order', async () => {
    const [{ id }] = await Q<{ id: string }>("SELECT id::text FROM sale_order WHERE sale_order_no = 'QAUSO01'");
    const m = await mark();
    const res = await approveRoute.POST(
      await request(`/api/sale-orders/${id}/approve`, { method: 'POST', body: { decision: 'approve' }, as: U.seller }),
      { params: Promise.resolve({ id }) },
    );
    assert.equal(res.status, 403, JSON.stringify(await res.clone().json()));
    const { audit, security } = await since(m);
    assert.equal(audit.length, 0);
    assert.deepEqual(
      security.map((r) => [r.ev, r.result, r.actor_pk, r.permission, r.entity, r.entity_id]),
      [['DENIED', 'DENIED', U.seller.pk, 'SO Approve', 'sale_order', id]],
    );
    stamped(security[0]!, U.seller);
    const [{ ap }] = await Q<{ ap: number }>(
      "SELECT approve_status_id ap FROM sale_order WHERE sale_order_no = 'QAUSO01'",
    );
    assert.equal(ap, 2, 'still waiting');
  });
  /** the editor's customer save, refused before any write */
  const editorSave = async () =>
    customersRoute.POST(
      await request('/api/customers', {
        method: 'POST',
        as: U.editor,
        body: { code: 'QAUC01', name: `QAU renamed ${rand}`, phone: '02-965-0001' },
      }),
    );
  await test('a save by a user set INACTIVE since their last request → 403, nothing saved, one DENIED line (account)', async () => {
    await reset();
    const before = await customerRow();
    await Q("UPDATE app_user SET record_status = 'INACTIVE' WHERE pk = $1", [U.editor.pk]);
    invalidateUserCache(U.editor.email);
    const m = await mark();
    const res = await editorSave();
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error: string }).error, 'บัญชีนี้ถูกปิดการใช้งาน');
    assert.deepEqual(await customerRow(), before);
    const { audit, security } = await since(m);
    assert.equal(audit.length, 0);
    assert.deepEqual(
      security.map((r) => [r.ev, r.result, r.actor_pk, r.permission]),
      [['DENIED', 'DENIED', U.editor.pk, 'account']],
    );
    stamped(security[0]!, U.editor);
  });
  await test('a save on a session signed out elsewhere (session_version moved) → 401, nothing saved, one DENIED line (session)', async () => {
    await reset();
    const before = await customerRow();
    await Q('UPDATE app_user SET session_version = session_version + 1 WHERE pk = $1', [U.editor.pk]);
    invalidateUserCache(U.editor.email);
    const m = await mark();
    const res = await editorSave();
    assert.equal(res.status, 401);
    assert.deepEqual(await customerRow(), before);
    const { audit, security } = await since(m);
    assert.equal(audit.length, 0);
    assert.deepEqual(
      security.map((r) => [r.ev, r.result, r.actor_pk, r.permission]),
      [['DENIED', 'DENIED', U.editor.pk, 'session']],
    );
    stamped(security[0]!, U.editor);
  });

  console.log('\n6. append-only + hashed');
  await test('audit_log / security_log refuse UPDATE and DELETE; every row has row_hash', async () => {
    const c = await blocker();
    try {
      for (const t of ['audit_log', 'security_log']) {
        await assert.rejects(
          c.query(`UPDATE ${t} SET request_id = 'x' WHERE pk = (SELECT max(pk) FROM ${t})`),
          /append-only/,
        );
        await assert.rejects(c.query(`DELETE FROM ${t} WHERE pk = (SELECT max(pk) FROM ${t})`), /append-only/);
        const [{ n }] = (await c.query(`SELECT count(*)::int n FROM ${t} WHERE row_hash IS NULL`)).rows;
        assert.equal(n, 0, `${t} rows without row_hash`);
      }
    } finally {
      await c.end();
    }
  });
} finally {
  await reset(); // the fixture customer back, the editor ACTIVE with its grant
  await pool.end();
}
if (failed) {
  console.error(`test-qa-audit: ${failed} failed`);
  process.exit(1);
}
console.log('\ntest-qa-audit: all passed');
