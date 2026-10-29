/**
 * scripts/test-qa-dump-admin.mts — admin regressions from the QA on the legacy data dump (2026-10-28): master audit
 * lines in Thai, Thai module / permission labels on the audit page, a refused sign-in leaves last_login alone, a user /
 * master save that keeps the status keeps status_changed_at / _by, a refused sign-in is audited as refused (never as a
 * System Admin login), a master saved with nothing changed writes no audit line.
 *
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-dump-admin.mts
 * Seeds its own fixtures (ids 995x, users qa-dump-*) and resets them at every start. ONLY a local *_test database.
 */
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
Object.assign(process.env, { SESSION_SECRET: 'unit-test-session-secret-0123456789abcdef' });
globalThis.fetch = (async () => new Response('{}', { status: 503 })) as typeof fetch; // no directory lookups

const { db, pool } = await import('@/db/client');
const { saveSimple, saveSymptom, saveModel } = await import('@/server/services/masters');
const { provisionSsoUser, upsertUser, signInAuditLine } = await import('@/server/services/users');
const { PENDING_ROLE } = await import('@/lib/access');
const { listAudit } = await import('@/server/audit');
const { moduleLabel, PAGE_MODULES, RIGHTS } = await import('@/lib/modules');
const { fieldLabel } = await import('@/lib/field-labels');

const U = {
  admin: { id: 9950, email: 'qa-dump-admin@example.invalid', type: 'System Admin', rs: 'ACTIVE' },
  active: { id: 9951, email: 'qa-dump-active@example.invalid', type: 'System Admin', rs: 'ACTIVE' },
  pending: { id: 9952, email: 'qa-dump-pending@example.invalid', type: null, rs: 'ACTIVE' },
  inactive: { id: 9953, email: 'qa-dump-inactive@example.invalid', type: 'System Admin', rs: 'INACTIVE' },
  deleted: { id: 9954, email: 'qa-dump-deleted@example.invalid', type: 'System Admin', rs: 'DELETED' },
  edit: { id: 9955, email: 'qa-dump-edit@example.invalid', type: 'System Admin', rs: 'ACTIVE' },
} as const;
const rand = Math.random().toString(36).slice(2, 7);

await pool.query(`
  DELETE FROM app_user WHERE user_id BETWEEN 9950 AND 9959 OR email_address LIKE 'qa-dump-%@example.invalid';
  INSERT INTO app_user (user_id, first_name, last_name, email_address, user_type, record_status, last_login,
                        status_changed_at, status_changed_by) VALUES
    ${Object.values(U)
      .map(
        (u) =>
          `(${u.id}, 'QA', '${u.email.split('@')[0]}', '${u.email}', ${u.type ? `'${u.type}'` : 'NULL'}, '${u.rs}', NULL, '2000-01-01 00:00:00', 1)`,
      )
      .join(',\n    ')};
`);

const userRow = async (id: number) =>
  (
    await db.execute<{ last_login: string | null; title: string | null; at: string | null; by: number | null }>(
      sql`SELECT last_login::text, title, status_changed_at::text AS at, status_changed_by AS by FROM app_user WHERE user_id = ${id}`,
    )
  ).rows[0]!;
const signIn = (email: string) =>
  provisionSsoUser({ email, name: 'QA Dump', avatar: '', larkId: '', department: '', phone: '', title: 'QA title' });

/** a master row's status + stamp; `reset` first sets the stamp back to 2000-01-01 by user 1 */
const MASTER = {
  colors: ['color', 'id'],
  symptoms: ['symptom', 'id'],
  models: ['model', 'model_code'],
} as const;
async function stampOf(kind: keyof typeof MASTER, key: string, reset = false) {
  const [t, k] = MASTER[kind].map((x) => sql.raw(x)) as [ReturnType<typeof sql.raw>, ReturnType<typeof sql.raw>];
  if (reset)
    await db.execute(
      sql`UPDATE ${t} SET status_changed_at = '2000-01-01 00:00:00', status_changed_by = 1 WHERE ${k}::text = ${key}`,
    );
  return (
    await db.execute<{ rs: string; at: string | null; by: number | null }>(
      sql`SELECT record_status AS rs, status_changed_at::text AS at, status_changed_by AS by FROM ${t} WHERE ${k}::text = ${key}`,
    )
  ).rows[0]!;
}
const OLD = { at: '2000-01-01 00:00:00', by: 1 };

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
  console.log('\n1. master audit lines name the table in Thai');
  const NOUN = {
    categories: 'หมวดหมู่',
    manufacturers: 'ยี่ห้อ',
    colors: 'สี',
    job_types: 'ประเภทงาน',
    product_types: 'ประเภทสินค้า',
  };
  for (const [kind, noun] of Object.entries(NOUN) as [keyof typeof NOUN, string][]) {
    await test(`${kind}: เพิ่ม${noun} / แก้ไข${noun}, never the table key`, async () => {
      const name = `QA-dump ${kind} ${rand}`;
      const days = kind === 'job_types' ? { days: '1' } : {};
      const made = await saveSimple(kind, { name, status: 'Active', ...days }, U.admin.id);
      const [created] = await listAudit({ entity: kind, key: made.id, action: 'CREATE', limit: 1 });
      assert.equal(created?.summary, `เพิ่ม${noun}: ${name}`);
      await saveSimple(kind, { id: made.id, name: `${name}-2`, status: 'Active', ...days }, U.admin.id);
      const [edited] = await listAudit({ entity: kind, key: made.id, action: 'UPDATE', limit: 1 });
      assert.equal(edited?.summary, `แก้ไข${noun}: ${name}-2`);
    });
  }

  console.log('\n2. audit page labels');
  await test('the module column / filter names every module the log writes in Thai', async () => {
    for (const m of [...PAGE_MODULES, 'Admin', 'Auth', 'Report', 'Job PickStock', 'Job ReturnStock'])
      assert.doesNotMatch(moduleLabel(m), /^[\x20-\x7e]+$/, `${m} → ${moduleLabel(m)}`);
    assert.equal(moduleLabel('Job Management'), 'ข้อมูลงานบริการ');
    assert.equal(moduleLabel('Admin'), 'ข้อมูลระบบ');
    assert.equal(moduleLabel('Something New'), 'Something New', 'an unknown key shows as it is');
  });
  await test('a permissions change names every menu and right in Thai (the change-detail popup)', async () => {
    for (const k of [...PAGE_MODULES, ...Object.keys(RIGHTS)])
      assert.doesNotMatch(fieldLabel(k), /^[\x20-\x7e]+$/, `${k} → ${fieldLabel(k)}`);
    assert.equal(fieldLabel('Customer'), 'ข้อมูลลูกค้า');
    assert.equal(fieldLabel('Report'), 'เปิดหน้ารายงาน');
  });

  console.log('\n3. last_login is a visit, not a refused attempt');
  await test('INACTIVE / DELETED: refused, last_login stays empty (the SSO profile still refreshes)', async () => {
    for (const u of [U.inactive, U.deleted]) {
      const r = await signIn(u.email);
      assert.equal(r.isActive, false);
      const row = await userRow(u.id);
      assert.equal(row.last_login, null, u.email);
      assert.equal(row.title, 'QA title', 'profile fields refresh');
    }
  });
  await test('ACTIVE (with a role, or pending approval): last_login is stamped', async () => {
    for (const u of [U.active, U.pending]) {
      const r = await signIn(u.email);
      assert.equal(r.isActive, true);
      assert.ok((await userRow(u.id)).last_login, u.email);
    }
  });

  console.log('\n4. status_changed_at / _by only on a real status change');
  await test('user: saved with nothing changed → stamp kept; Active → Inactive → stamped', async () => {
    const [{ id }] = (await db.execute<{ id: string }>(sql`SELECT id::text FROM app_user WHERE user_id = ${U.edit.id}`))
      .rows;
    const base = { id, name: 'QA qa-dump-edit', role: U.edit.type, email: U.edit.email };
    await upsertUser({ ...base, status: 'Active' }, U.admin.id);
    assert.deepEqual(await userRow(U.edit.id), { last_login: null, title: null, at: '2000-01-01 00:00:00', by: 1 });
    await upsertUser({ ...base, status: 'Inactive' }, U.admin.id);
    const row = await userRow(U.edit.id);
    assert.notEqual(row.at, '2000-01-01 00:00:00');
    assert.equal(row.by, U.admin.id);
  });
  const brand = `QA-dump brand ${rand}`;
  await saveSimple('manufacturers', { name: brand, status: 'Active' }, U.admin.id);
  const masters: [keyof typeof MASTER, (status?: string, key?: string) => Promise<string>][] = [
    [
      'colors',
      async (status, id) => (await saveSimple('colors', { id, name: `QA-dump stamp ${rand}`, status }, U.admin.id)).id,
    ],
    [
      'symptoms',
      async (status, id) => (await saveSymptom({ id, name: `QA-dump stamp ${rand}`, status }, U.admin.id)).id,
    ],
    [
      'models',
      async (status, code) =>
        (await saveModel({ code, name: `QA-dump stamp ${rand}`, brand, price: 0, status }, U.admin.id)).code,
    ],
  ];
  for (const [kind, save] of masters)
    await test(`${kind}: an edit that keeps (or sends no) status keeps the stamp; Active → Inactive stamps`, async () => {
      const key = await save('Active');
      await stampOf(kind, key, true);
      await save('Active', key);
      assert.deepEqual(await stampOf(kind, key), { rs: 'ACTIVE', ...OLD }, 'unchanged save');
      await save(undefined, key);
      assert.deepEqual(await stampOf(kind, key), { rs: 'ACTIVE', ...OLD }, 'no status sent');
      await save('Inactive', key);
      const changed = await stampOf(kind, key);
      assert.equal(changed.rs, 'INACTIVE');
      assert.notEqual(changed.at, OLD.at);
      assert.equal(changed.by, U.admin.id);
      await stampOf(kind, key, true);
      await save(undefined, key);
      assert.deepEqual(await stampOf(kind, key), { rs: 'INACTIVE', ...OLD }, 'no status sent never writes Active back');
    });

  console.log('\n5. a refused sign-in is audited as refused, not as a login with the role');
  await test('INACTIVE / DELETED → LOGIN_FAILED with the reason; ACTIVE → LOGIN · role; pending → LOGIN · รออนุมัติ', async () => {
    const line = async (u: (typeof U)[keyof typeof U]) => {
      const r = await signIn(u.email);
      return signInAuditLine(u.email, r.userType ?? PENDING_ROLE, r.recordStatus);
    };
    const inactive = await line(U.inactive);
    assert.deepEqual(inactive, {
      action: 'LOGIN_FAILED',
      summary: `เข้าสู่ระบบไม่สำเร็จ ${U.inactive.email} — บัญชีถูกปิดการใช้งาน`,
    });
    assert.deepEqual(await line(U.deleted), {
      action: 'LOGIN_FAILED',
      summary: `เข้าสู่ระบบไม่สำเร็จ ${U.deleted.email} — บัญชีถูกลบ`,
    });
    assert.doesNotMatch(inactive.summary, /System Admin/, 'never the role as if granted');
    assert.deepEqual(await line(U.active), {
      action: 'LOGIN',
      summary: `เข้าสู่ระบบ ${U.active.email} · System Admin`,
    });
    assert.deepEqual(await line(U.pending), { action: 'LOGIN', summary: `เข้าสู่ระบบ ${U.pending.email} · รออนุมัติ` });
  });

  console.log('\n6. a master saved with nothing changed writes no audit line');
  type Save = (key?: string) => Promise<string>;
  const same = `QA-dump same ${rand}`;
  const unchanged: [string, Save][] = [
    ...(['categories', 'manufacturers', 'colors', 'job_types', 'product_types'] as const).map(
      (kind): [string, Save] => [
        kind,
        async (id) =>
          (
            await saveSimple(
              kind,
              { id, name: same, status: 'Active', ...(kind === 'job_types' ? { days: '1' } : {}) },
              U.admin.id,
            )
          ).id,
      ],
    ),
    ['symptom', async (id) => (await saveSymptom({ id, name: same, status: 'Active' }, U.admin.id)).id],
    [
      'model',
      async (code) => (await saveModel({ code, name: same, brand, price: 0, status: 'Active' }, U.admin.id)).code,
    ],
  ];
  for (const [entity, save] of unchanged)
    await test(`${entity}: saved again with the same values → no UPDATE line`, async () => {
      const key = await save();
      await save(key);
      assert.equal((await listAudit({ entity, key, action: 'UPDATE' })).length, 0);
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
