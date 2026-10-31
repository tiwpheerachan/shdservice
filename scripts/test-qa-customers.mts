/**
 * scripts/test-qa-customers.mts — customer rules: two simultaneous saves
 * claiming the same phone / tax id / email, deleted customers through /api/customers/lookup, Thai digits and
 * junk in the phone / tax-id filters, a dashed tax id in the quick search, the one-line address cut at 200.
 *
 *   TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-customers.mts
 *
 * Runs ONLY against a throwaway local *_test database. Seeds its own users (ids 96xx, roles "QC *") and
 * customers (names "QC-CUST …", fresh random numbers each run) and removes the previous run's at the start.
 */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
Object.assign(process.env, {
  SESSION_SECRET: 'unit-test-session-secret-0123456789abcdef',
  DB_POOL_MAX: '25', // the race tests need real concurrency
});

const { pool } = await import('@/db/client');
const { signSession, SESSION_COOKIE } = await import('@/lib/session');
const { POST: customerPOST } = await import('@/app/api/customers/route');
const { GET: lookupGET } = await import('@/app/api/customers/lookup/route');
const { pageCustomers } = await import('@/server/services/customers');

const U = {
  admin: { id: 9601, email: 'qc-admin@example.invalid', type: 'System Admin' },
  cs: { id: 9602, email: 'qc-cs@example.invalid', type: 'QC CS' },
} as const;
type TestUser = (typeof U)[keyof typeof U];
const SV = 1;

await pool.query(`
  DELETE FROM role_permission WHERE user_type LIKE 'QC %';
  INSERT INTO role_permission (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
    ('QC CS', 'Customer', true, true, false, true),
    ('QC CS', 'Job Management', true, true, false, true);
  INSERT INTO app_user (pk, first_name, last_name, email_address, user_type, record_status, session_version)
  OVERRIDING SYSTEM VALUE VALUES
    ${Object.values(U)
      .map((u) => `(${u.id}, 'QC', '${u.email.split('@')[0]}', '${u.email}', '${u.type}', 'ACTIVE', ${SV})`)
      .join(',\n    ')}
    -- fixture users stay (audit_log, append-only, points at them): reset in place
    ON CONFLICT (pk) DO UPDATE SET (first_name, last_name, email_address, user_type, record_status, session_version, last_login, title, avatar, department)
      = ROW(excluded.first_name, excluded.last_name, excluded.email_address, excluded.user_type, excluded.record_status, excluded.session_version, NULL, NULL, NULL, NULL);
  DELETE FROM idempotency_key WHERE app_user_pk BETWEEN 9600 AND 9699;
  DELETE FROM customer WHERE customer_name LIKE 'QC-CUST%';
  -- customer_code is UNIQUE (drizzle/0006) and tests/seed.mts holds C00001/C00002 with no Customer running_no row:
  -- the series starts past them (as test-domain's)
  INSERT INTO running_no (running_type, company_id, branch_id, prefix, pyear, pmonth, pday, number, length_year, length_month, length_number)
    SELECT 'Customer', 0, 0, 'C', 0, 0, 0, 90000, 0, 0, 5
     WHERE NOT EXISTS (SELECT 1 FROM running_no WHERE running_type = 'Customer');`);

async function request(path: string, u: TestUser, init: { method?: string; body?: unknown } = {}) {
  const now = Date.now();
  const cookie = `${SESSION_COOKIE}=${await signSession({ email: u.email, name: u.email, exp: now + 600_000, iat: now, sv: SV })}`;
  const headers: Record<string, string> = { 'user-agent': 'test-qa-customers', cookie };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`https://svc.example.test${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
type Answer = { status: number; body: Record<string, unknown> & { row?: { code: string }; error?: string } };
const json = async (r: Response): Promise<Answer> => ({ status: r.status, body: await r.json() });
const save = async (body: object, u: TestUser = U.cs) =>
  json(await customerPOST(await request('/api/customers', u, { method: 'POST', body })));
const lookup = async (q: string, u: TestUser = U.cs, extra = '') =>
  (await json(await lookupGET(await request(`/api/customers/lookup?q=${encodeURIComponent(q)}${extra}`, u)))).body
    .rows as {
    code: string;
    status: string;
  }[];

const rnd = (n: number) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
const mobile = () => `06${rnd(8)}`;
const taxId = () => {
  const d = `3${rnd(11)}`;
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(d[i]) * (13 - i);
  return d + ((11 - (s % 11)) % 10);
};
const dashed = (t: string) => `${t[0]}-${t.slice(1, 5)}-${t.slice(5, 10)}-${t.slice(10, 12)}-${t[12]}`;
const thai = (s: string) => s.replace(/\d/g, (d) => String.fromCharCode(0x0e50 + Number(d)));
const rowsWith = async (sqlText: string, v: unknown[]) => (await pool.query(sqlText, v)).rows;

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

/** two creates at once, three rounds: exactly one 201, the other the usual duplicate 409 — one row in the table */
async function raceCreates(a: () => object, b: (fromA: object) => object, field: RegExp) {
  for (let round = 0; round < 3; round++) {
    const first = a();
    const answers = await Promise.all([save(first), save(b(first))]);
    const statuses = answers.map((x) => x.status).sort();
    assert.deepEqual(statuses, [201, 409], `round ${round}: ${JSON.stringify(answers.map((x) => x.body))}`);
    const lost = answers.find((x) => x.status === 409)!;
    assert.match(String(lost.body.error), field);
    assert.match(String(lost.body.error), /มีลูกค้าอยู่แล้ว \(C\d+ QC-CUST .*\) — ห้ามสร้างซ้ำ$/);
  }
}

try {
  console.log('\nBug 1 — simultaneous saves claiming the same identity');
  await test('two creates with the same phone at once → one 201, one 409 (×3)', async () => {
    await raceCreates(
      () => ({ name: 'QC-CUST race phone A', phone: mobile() }),
      (a) => ({ name: 'QC-CUST race phone B', phone: (a as { phone: string }).phone }),
      /^เบอร์โทรศัพท์นี้/,
    );
  });
  await test('the phone inside a two-number field, created at once with the plain number → one 201, one 409 (×3)', async () => {
    await raceCreates(
      () => ({ name: 'QC-CUST race two A', phone: mobile() }),
      (a) => ({ name: 'QC-CUST race two B', phone: `02-555-${rnd(4)} / ${(a as { phone: string }).phone}` }),
      /^เบอร์โทรศัพท์นี้/,
    );
  });
  await test('two creates with the same tax id (one dashed) at once → one 201, one 409 (×3)', async () => {
    await raceCreates(
      () => ({ name: 'QC-CUST race tax A', phone: mobile(), taxId: taxId() }),
      (a) => ({ name: 'QC-CUST race tax B', phone: mobile(), taxId: dashed((a as { taxId: string }).taxId) }),
      /^เลขบัตร\/ผู้เสียภาษีนี้/,
    );
  });
  await test('two creates with the same email (different case) at once → one 201, one 409 (×3)', async () => {
    await raceCreates(
      () => ({ name: 'QC-CUST race mail A', phone: mobile(), email: `qc.${rnd(8)}@example.com` }),
      (a) => ({ name: 'QC-CUST race mail B', phone: mobile(), email: (a as { email: string }).email.toUpperCase() }),
      /^อีเมลนี้/,
    );
  });
  await test('two edits giving two customers the same new number at once → one 200, one 409 (×3)', async () => {
    for (let round = 0; round < 3; round++) {
      const [a, b] = await Promise.all([
        save({ name: 'QC-CUST edit A', phone: mobile() }),
        save({ name: 'QC-CUST edit B', phone: mobile() }),
      ]);
      assert.deepEqual([a.status, b.status], [201, 201]);
      const phone = mobile();
      const edit = (r: Answer, name: string) =>
        save({ code: r.body.row!.code, name, phone, version: (r.body.row as { version?: number }).version });
      const answers = await Promise.all([edit(a, 'QC-CUST edit A'), edit(b, 'QC-CUST edit B')]);
      assert.deepEqual(
        answers.map((x) => x.status).sort(),
        [200, 409],
        `round ${round}: ${JSON.stringify(answers.map((x) => x.body))}`,
      );
      assert.match(String(answers.find((x) => x.status === 409)!.body.error), /^เบอร์โทรศัพท์นี้เป็นของลูกค้า C\d+ /);
      const holders = await rowsWith(
        `SELECT customer_code FROM customer WHERE regexp_replace(phone_number, '\\D', '', 'g') = $1`,
        [phone],
      );
      assert.equal(holders.length, 1, 'one customer holds the number');
    }
  });

  console.log('\nBug 2 — deleted customers through /api/customers/lookup');
  await test('a DELETED customer: the exact-code lookup finds nothing (pickers), System Admin only with deleted=all', async () => {
    const c = await save({ name: 'QC-CUST deleted', phone: mobile() });
    assert.equal(c.status, 201);
    const code = c.body.row!.code;
    assert.deepEqual(
      (await lookup(code)).map((r) => r.code),
      [code],
    );
    await pool.query(`UPDATE customer SET record_status = 'DELETED' WHERE customer_code = $1`, [code]);
    assert.deepEqual(await lookup(code), [], 'cs');
    assert.deepEqual(await lookup('QC-CUST deleted'), [], 'cs, by name');
    assert.deepEqual(await lookup(code, U.admin), [], 'admin, a picker');
    assert.deepEqual(await lookup(code, U.cs, '&deleted=all'), [], 'cs asking');
    assert.deepEqual(
      (await lookup(code, U.admin, '&deleted=all')).map((r) => r.code),
      [code],
      'admin, the customers page ?edit=',
    );
  });

  console.log('\nBug 4 — Thai digits / no digits in the phone and tax-id filters');
  const page = (f: object) => pageCustomers({ page: 1, pageSize: 50, q: '', f: {} }, 'exclude', f);
  await test('phone / tax-id filter typed in Thai digits finds the customer (and only it)', async () => {
    const phone = mobile();
    const tax = taxId();
    const c = await save({ name: 'QC-CUST thai digits', phone, taxId: tax });
    assert.equal(c.status, 201);
    for (const f of [{ phone: thai(phone) }, { taxId: thai(dashed(tax)) }]) {
      const p = await page(f);
      assert.deepEqual([p.total, p.rows.map((r) => r.code)], [1, [c.body.row!.code]], JSON.stringify(f));
    }
    const q = await pageCustomers({ page: 1, pageSize: 50, q: thai(phone), f: {} }, 'exclude', {});
    assert.deepEqual(
      q.rows.map((r) => r.code),
      [c.body.row!.code],
      'quick search q',
    );
  });
  await test('a phone / tax-id filter with no digit at all → no rows (not every customer)', async () => {
    await save({ name: 'QC-CUST any', phone: mobile() });
    for (const f of [{ phone: 'abc' }, { taxId: 'เลขบัตร' }]) assert.equal((await page(f)).total, 0, JSON.stringify(f));
  });

  console.log('\nBug 5 — a dashed tax id in the quick search / the job-form lookup');
  await test('q = "3-1234-56789-01-2" finds a customer stored with digits; q = digits finds a legacy dashed one', async () => {
    const tax = taxId();
    const c = await save({ name: 'QC-CUST dashed tax', phone: mobile(), taxId: tax });
    assert.equal(c.status, 201);
    assert.deepEqual(
      (await lookup(dashed(tax))).map((r) => r.code),
      [c.body.row!.code],
    );
    const legacy = taxId();
    const [{ customer_code: code }] = await rowsWith(
      `INSERT INTO customer (customer_code, customer_name, phone_number, customer_card_id, record_status)
       VALUES ('QC' || floor(random() * 1e6)::int, 'QC-CUST legacy dashed', '', $1, 'ACTIVE') RETURNING customer_code`,
      [dashed(legacy)],
    );
    assert.deepEqual(
      (await lookup(legacy)).map((r) => r.code),
      [code],
    );
  });

  console.log('\nBug 9 — nothing cut silently');
  await test('an address line over 100 characters → 400 under address1, nothing saved (never cut)', async () => {
    const name = `QC-CUST long address ${rnd(6)}`;
    const r = await save({ name, phone: mobile(), address1: 'ก'.repeat(101) });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.ok((r.body.details as { fields?: Record<string, string> }).fields?.address1, JSON.stringify(r.body));
    assert.equal((await rowsWith(`SELECT 1 FROM customer WHERE customer_name = $1`, [name])).length, 0);
  });
  await test('two full address lines (100 + 100) → saved whole; no one-line copy stored (customer_address)', async () => {
    // the one-line customer_address is a legacy snapshot: a new row never writes it, so its 200 is no limit
    const name = `QC-CUST two lines ${rnd(6)}`;
    const r = await save({ name, phone: mobile(), address1: 'ก'.repeat(100), address2: 'ข'.repeat(100) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(
      await rowsWith(
        `SELECT length(customer_address1) a1, length(customer_address2) a2, customer_address one FROM customer
          WHERE customer_name = $1`,
        [name],
      ),
      [{ a1: 100, a2: 100, one: null }],
    );
  });
  await test('a 201-character name → 400 (the server never cuts it)', async () => {
    const r = await save({ name: 'QC-CUST ' + 'ก'.repeat(193), phone: mobile() });
    assert.deepEqual(
      [r.status, (r.body.details as { fields: Record<string, string> }).fields.name],
      [400, 'ชื่อลูกค้ายาวเกิน 200 ตัวอักษร'],
    );
  });

  console.log('\nCustomer codes — customer_code is UNIQUE (drizzle/0006)');
  await test('the code series behind a code already taken (typed by hand / a legacy row) → the next free code, not a 409', async () => {
    const taken = await save({ name: 'QC-CUST code taken', phone: mobile() });
    assert.equal(taken.status, 201, JSON.stringify(taken.body));
    const n = Number(taken.body.row!.code.slice(1));
    // the series one behind: its next number is the code just issued
    await pool.query(`UPDATE running_no SET number = $1 WHERE running_type = 'Customer'`, [n - 1]);
    try {
      const next = await save({ name: 'QC-CUST code after taken', phone: mobile() });
      assert.equal(next.status, 201, JSON.stringify(next.body));
      assert.notEqual(next.body.row!.code, taken.body.row!.code);
    } finally {
      // past every code issued, whatever happened above
      await pool.query(
        `UPDATE running_no SET number = (SELECT max(substring(customer_code FROM 2)::int) FROM customer
          WHERE customer_code ~ '^C[0-9]{5,}$') WHERE running_type = 'Customer'`,
      );
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
