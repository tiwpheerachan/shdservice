/**
 * scripts/test-qa-race-auth.mts — users / auth races from the race audit (2026-10-21): a sign-in that undid an
 * admin's role change (G1), the auth caches refilled with data read before an invalidate (G12), usernames
 * differing only in case created at once (G14), a role given to a user while it is being deleted (G15).
 * A second DB session (`blocker()`) pins a request between its check and its write, so each race is
 * deterministic, not a timing lottery.
 *
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-race-auth.mts
 * Seeds its own fixtures (ids 993x, roles "RA *", emails ra-*@example.invalid) and resets them at every start.
 * ONLY a local *_test database.
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { NextRequest } from 'next/server';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
Object.assign(process.env, {
  SESSION_SECRET: 'unit-test-session-secret-0123456789abcdef',
  SSO_CLIENT_SECRET: 'race-sso-secret',
  OWNER_EMAILS: 'ra-owner@example.invalid',
  DB_POOL_MAX: '10',
});
/** who the fake central SSO's /sso/verify answers for; the directory and everything else is unreachable */
const identity = { email: '', name: '' };
globalThis.fetch = (async (input: RequestInfo | URL) =>
  String(input instanceof Request ? input.url : input).includes('/api/v1/sso/verify')
    ? Response.json(identity)
    : new Response('{}', { status: 503 })) as typeof fetch;

const { pool } = await import('@/db/client');
const { signSession, verifySession, SESSION_COOKIE } = await import('@/lib/session');
const { STATE_COOKIE } = await import('@/lib/sso');
const { grantsForUserType, invalidateGrantCache, invalidateUserCache, resolveUser } = await import('@/server/auth');
const callback = await import('@/app/api/sso/callback/route');
const usersRoute = await import('@/app/api/admin/users/route');
const permsRoute = (await import('@/app/api/admin/permissions/route')) as Record<
  string,
  (req: NextRequest) => Promise<Response>
>;

const SV = 3;
const ADMIN = { id: 9930, email: 'ra-admin@example.invalid' };
const Q = async <T = Record<string, unknown>,>(text: string, params: unknown[] = []) =>
  (await pool.query(text, params)).rows as T[];

await pool.query(`
  DELETE FROM app_config WHERE user_type ILIKE 'RA %';
  INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
    ('RA Clerk', 'Customer', false, false, false, true),
    ('RA Seller', 'Customer', false, false, false, true),
    ('RA Grants', 'Customer', false, false, false, false);
  DELETE FROM app_user WHERE user_id BETWEEN 9930 AND 9939 OR email_address LIKE 'ra-%@example.invalid';
  INSERT INTO app_user (user_id, username, first_name, last_name, phone_no, email_address, user_type, lark_id,
                        record_status, session_version) VALUES
    (9930, 'ra-admin',   'RA',   'admin', null, 'ra-admin@example.invalid',   'System Admin', null,    'ACTIVE', ${SV}),
    (9931, 'ra-sso',     'RA',   'sso',   null, 'ra-sso@example.invalid',     'RA Clerk',     null,    'ACTIVE', ${SV}),
    (9932, 'ra-target',  'RA',   'target',null, 'ra-target@example.invalid',  'RA Clerk',     null,    'ACTIVE', ${SV}),
    (9933, 'ra-cached',  'RA',   'cached',null, 'ra-cached@example.invalid',  'RA Clerk',     null,    'ACTIVE', ${SV}),
    (9934, 'ra-owner',   '',     null,    '  ', 'ra-owner@example.invalid',   null,           'L-old', 'ACTIVE', ${SV}),
    (9935, 'ra-pending', null,   null,    '081', ' RA-Pending@example.invalid ', '  ',        null,    'ACTIVE', ${SV});
`);

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

async function request(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const now = Date.now();
  const headers: Record<string, string> = {
    'user-agent': 'test-qa-race-auth',
    cookie:
      init.cookie ??
      `${SESSION_COOKIE}=${await signSession({ email: ADMIN.email, name: ADMIN.email, exp: now + 600_000, iat: now, sv: SV })}`,
  };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`https://svc.example.test${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
const status = async (r: Promise<Response>) => (await r).status;
const postUser = async (body: Record<string, unknown>) =>
  status(usersRoute.POST(await request('/api/admin/users', { method: 'POST', body })));
const perms = async (method: string, body?: unknown, query = '') =>
  status(permsRoute[method]!(await request(`/api/admin/permissions${query}`, { method, body })));

/** the SSO callback for `email`, as the browser comes back from the central sign-in → its session cookie */
async function login(email: string, name: string) {
  Object.assign(identity, { email, name });
  const res = (await callback.GET(
    await request(`/api/sso/callback?code=c-${Math.random()}&state=s1`, { cookie: `${STATE_COOKIE}=s1` }),
  )) as unknown as { status: number; cookies: { get(n: string): { value: string } | undefined } };
  assert.equal(res.status, 307, 'callback redirects');
  return verifySession(res.cookies.get(SESSION_COOKIE)?.value);
}

/** a separate connection, outside the app's pool — the "other session" that holds a lock */
async function blocker() {
  const c = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await c.connect();
  return c;
}
/** true once `min` sessions of this DB wait on a lock (row, table or advisory); false after `ms` */
async function lockWaiters(min: number, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) {
    const [{ n }] = await Q<{ n: number }>(
      `SELECT count(*)::int n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (n >= min) return true;
  }
  return false;
}

/** hold the next query matching `re` after its rows came back — a load that read before a commit */
function holdNextQuery(re: RegExp) {
  const orig = pool.query;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let read!: () => void;
  const readDone = new Promise<void>((r) => (read = r));
  pool.query = (async (...args: unknown[]) => {
    const q = args[0] as string | { text?: string };
    const res = await (orig as (...a: unknown[]) => Promise<unknown>).apply(pool, args);
    if (re.test(typeof q === 'string' ? q : (q?.text ?? ''))) {
      pool.query = orig;
      read();
      await gate;
    }
    return res;
  }) as typeof pool.query;
  return { readDone, release };
}

await test("G1 a sign-in while an admin changes the role / name keeps the admin's values (and the session gets the new role)", async () => {
  const b = await blocker();
  await b.query('BEGIN');
  await b.query('SELECT 1 FROM app_user WHERE user_id = 9931 FOR UPDATE'); // the admin's upsertUser tx, in flight
  const signIn = login('ra-sso@example.invalid', 'Someone Else');
  assert.ok(await lockWaiters(1), 'the sign-in reached the row lock');
  await b.query(`UPDATE app_user SET user_type = 'RA Seller', first_name = 'Renamed' WHERE user_id = 9931`);
  await b.query('COMMIT');
  await b.end();
  const session = await signIn;
  const [row] = await Q<{ user_type: string; first_name: string; last_login: string | null }>(
    `SELECT user_type, first_name, last_login FROM app_user WHERE user_id = 9931`,
  );
  assert.equal(row?.user_type, 'RA Seller', 'role change kept');
  assert.equal(row?.first_name, 'Renamed', 'name change kept');
  assert.ok(row?.last_login, 'last_login stamped');
  assert.equal(session?.role, 'RA Seller', 'the cookie carries the role as committed');
});

await test('G1 provisioning rules: blanks filled from SSO, owner bootstrap, a set value / a profile field not received kept, first login once', async () => {
  const owner = await login('ra-owner@example.invalid', 'Owner Person');
  const [o] = await Q(`SELECT user_type, first_name, last_name, phone_no, lark_id FROM app_user WHERE user_id = 9934`);
  assert.deepEqual(o, {
    user_type: 'System Admin',
    first_name: 'Owner',
    last_name: 'Person',
    phone_no: null,
    lark_id: 'L-old',
  });
  assert.equal(owner?.role, 'System Admin');
  const pending = await login('ra-pending@example.invalid', 'Pen Ding');
  const [p] = await Q(`SELECT user_type, first_name, last_name, phone_no FROM app_user WHERE user_id = 9935`);
  assert.deepEqual(p, { user_type: null, first_name: 'Pen', last_name: 'Ding', phone_no: '081' });
  assert.equal(pending?.approved, false);
  // two tabs finishing the first sign-in at once → one row, both signed in (pending)
  const both = await Promise.all([1, 2].map(() => login('ra-new@example.invalid', 'New Comer')));
  const rows = await Q(`SELECT user_type, first_name FROM app_user WHERE email_address = 'ra-new@example.invalid'`);
  assert.deepEqual(rows, [{ user_type: null, first_name: 'New' }]);
  assert.ok(both.every((s) => s && !s.approved));
});

await test('G12 a grant load that read before a permissions save does not refill the cache after invalidate()', async () => {
  invalidateGrantCache();
  const held = holdNextQuery(/from "app_config"/i);
  const load = grantsForUserType('RA Grants'); // reads view=false …
  await held.readDone;
  await Q(`UPDATE app_config SET can_view = true WHERE user_type = 'RA Grants' AND module_name = 'Customer'`);
  invalidateGrantCache(); // … the save commits and invalidates …
  held.release();
  await load; // … then the old load finishes
  assert.equal((await grantsForUserType('RA Grants')).Customer?.view, true, 'cache holds the saved grant');
});

await test('G12 a user lookup that read before an admin edit does not refill the user cache after invalidate()', async () => {
  const now = Date.now();
  const session = { email: 'ra-cached@example.invalid', name: 'x', exp: now + 600_000, iat: now, sv: SV };
  invalidateUserCache();
  const held = holdNextQuery(/from "app_user"/i);
  const load = resolveUser(session); // reads role RA Clerk …
  await held.readDone;
  await Q(`UPDATE app_user SET user_type = 'RA Seller' WHERE user_id = 9933`);
  invalidateUserCache('ra-cached@example.invalid');
  held.release();
  await load;
  assert.equal((await resolveUser(session))?.userType, 'RA Seller', 'cache holds the edited role');
});

await test('G14 two admins create usernames differing only in case / spaces at once → one user, the other 409', async () => {
  const tag = Math.random().toString(36).slice(2, 7);
  const b = await blocker();
  await b.query('BEGIN');
  await b.query('LOCK TABLE app_user IN SHARE MODE'); // reads go on, an INSERT waits: both past their check
  const both = Promise.all([
    postUser({ name: 'Race One', role: 'RA Clerk', email: `ra-r1-${tag}@example.invalid`, username: `RaceU${tag}` }),
    postUser({ name: 'Race Two', role: 'RA Clerk', email: `ra-r2-${tag}@example.invalid`, username: ` raceu${tag} ` }),
  ]);
  assert.ok(await lockWaiters(2), 'both creates reached a lock');
  await b.query('COMMIT');
  await b.end();
  const codes = (await both).sort();
  const rows = await Q(`SELECT username FROM app_user WHERE lower(btrim(username)) = $1`, [`raceu${tag}`]);
  assert.equal(rows.length, 1, `one user with that username, got ${JSON.stringify(rows)}`);
  assert.deepEqual(codes, [200, 409]);
});

await test('G15 a role deleted while an admin gives it to a user → never a user on a role with no permission rows', async () => {
  const role = `RA Doomed ${Math.random().toString(36).slice(2, 7)}`;
  assert.equal(
    await perms('POST', { items: [{ role, menu: 'Customer', add: false, edit: false, del: false, view: true }] }),
    200,
  );
  const b = await blocker();
  await b.query('BEGIN');
  await b.query('SELECT 1 FROM app_user WHERE user_id = 9932 FOR UPDATE'); // another admin's edit of that user
  const give = postUser({ id: '9932', role });
  assert.ok(await lockWaiters(1), 'the role change reached the row lock');
  const del = perms('DELETE', undefined, `?role=${encodeURIComponent(role)}`);
  await Promise.race([del, lockWaiters(2)]);
  await b.query('COMMIT');
  await b.end();
  const [g, d] = await Promise.all([give, del]);
  const [{ t }] = await Q<{ t: string }>(`SELECT btrim(user_type) t FROM app_user WHERE user_id = 9932`);
  const [{ n }] = await Q<{ n: number }>(`SELECT count(*)::int n FROM app_config WHERE btrim(user_type) = $1`, [role]);
  assert.ok(!(t === role && n === 0), `user 9932 on deleted role "${role}" (give ${g}, delete ${d})`);
  assert.deepEqual([g, d], [200, 409], 'the user got the role first, so the delete is refused');
  // and the other order: a role that no longer exists is refused, not stored
  await Q(`UPDATE app_user SET user_type = 'RA Clerk' WHERE user_id = 9932`);
  invalidateUserCache();
  assert.equal(await postUser({ id: '9932', role: 'RA Never Existed' }), 400);
});

await pool.end();
if (failed) {
  console.error(`test-qa-race-auth: ${failed} failed`);
  process.exit(1);
}
console.log('test-qa-race-auth: all passed');
