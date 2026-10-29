/**
 * TEST_DATABASE_URL=… NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-ids.mts
 * ADR 0008 phase 1 (drizzle/0005): every public table has `id uuid NOT NULL DEFAULT uuid_generate_v7()` with a unique
 * index, and the ids of rows a legacy reload brings back are the same at every load (uuid_v7_stable); the API reads
 * them with the contract's uuid() / byUuid() and src/server/ids.ts. Its own fixtures (approve_status 9971–9973,
 * idempotency_key of user 9971, temp_model 'QID%'), reset at every start.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL; // src/server/ids.ts reads through the app's pool (section 4)
const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1, options: '-c TimeZone=Asia/Bangkok' });
const q = async <T,>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const MIGRATION = readFileSync('drizzle/0005_uuid7_ids.sql', 'utf8');

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

/** the uuid's version nibble and variant bits */
const isV7 = (u: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(u);

// one table per kind of legacy key: single-column PK, composite PK + timestamptz creation time, a renamed `id` → pk
// + `timestamp` creation time + append-only trigger, no primary key (two identical rows)
const TABLES: { table: string; order: string; expected: string }[] = [
  {
    table: 'approve_status',
    order: 'approve_status_id',
    expected: `uuid_v7_stable(timestamptz '2023-01-01 00:00:00+07', 'approve_status/' || approve_status_id::text)`,
  },
  {
    table: 'idempotency_key',
    order: 'user_id, key',
    expected: `uuid_v7_stable(created_at, 'idempotency_key/' || ROW(user_id, key)::text)`,
  },
  {
    table: 'audit_log',
    order: 'pk',
    expected: `uuid_v7_stable(at AT TIME ZONE 'Asia/Bangkok', 'audit_log/' || pk::text)`,
  },
  { table: 'temp_model', order: 'model_code, id', expected: '' },
];
const ids = async (table: string, order: string) =>
  (await q<{ id: string }>(`SELECT id::text FROM ${table} ORDER BY ${order}`)).map((r) => r.id);
/** a reload, as far as this table goes: its ids are gone and the migration fills them again */
const reload = async (table: string) => {
  await q(`ALTER TABLE ${table} DROP COLUMN id`);
  await q(MIGRATION);
};

try {
  await q(`
    DELETE FROM approve_status WHERE approve_status_id = 9971;
    INSERT INTO approve_status (approve_status_id, approve_name_th) VALUES (9971, 'QID');
    DELETE FROM idempotency_key WHERE user_id = 9971;
    INSERT INTO idempotency_key (user_id, key, route, created_at)
      VALUES (9971, 'qid-a', '/qid', '2024-05-06 07:08:09.123+07'), (9971, 'qid-b', '/qid', '2024-05-06 07:08:09.123+07');
    INSERT INTO audit_log (at, user_id, user_name, action, module, entity, entity_key, summary)
      VALUES ('2025-01-02 03:04:05.678', 9971, 'QID', 'CREATE', 'qid', 'qid', 'qid', 'test-qa-ids');
    DELETE FROM temp_model WHERE model_code LIKE 'QID%';
    INSERT INTO temp_model (pk, model_name, model_code) VALUES (1, 'QID same', 'QID1'), (1, 'QID same', 'QID1'), (2, 'QID other', 'QID2');
  `);

  console.log('\n1. uuid_v7_stable');
  await test('same (time, seed) → same uuid, a valid v7 holding the time; another seed → another uuid', async () => {
    const [r] = await q<{ a: string; b: string; c: string; ms: string }>(`
      SELECT uuid_v7_stable(t, 'job/J2600001')::text a, uuid_v7_stable(t, 'job/J2600001')::text b,
             uuid_v7_stable(t, 'job/J2600002')::text c, (extract(epoch FROM t) * 1000)::bigint::text ms
        FROM (SELECT timestamptz '2024-05-06 07:08:09.123+07' t) x`);
    assert.equal(r!.a, r!.b);
    assert.notEqual(r!.a, r!.c);
    assert.ok(isV7(r!.a) && isV7(r!.c), `${r!.a} / ${r!.c} is not version 7, variant 10`);
    assert.equal(BigInt(`0x${r!.a.replace(/-/g, '').slice(0, 12)}`).toString(), r!.ms);
  });
  await test('uuid_generate_v7(): random, v7, time-ordered', async () => {
    const r = await q<{ u: string }>(
      `SELECT uuid_generate_v7(now() + n * interval '1 ms')::text u FROM generate_series(1, 50) n`,
    );
    assert.ok(r.every((x) => isV7(x.u)));
    const u = r.map((x) => x.u);
    assert.deepEqual([...u].sort(), u);
    assert.equal(new Set(u).size, u.length);
  });

  console.log('\n2. a reload gives every legacy row the same id again');
  for (const { table, order, expected } of TABLES)
    await test(`${table}: dropped and backfilled twice → the same ids${expected ? ', = the documented formula' : ''}`, async () => {
      await reload(table);
      const first = await ids(table, order);
      assert.ok(first.length > 0);
      await reload(table);
      assert.deepEqual(await ids(table, order), first);
      assert.ok(first.every(isV7));
      assert.equal(new Set(first).size, first.length);
      if (expected)
        assert.equal((await q<{ n: number }>(`SELECT count(*)::int n FROM ${table} WHERE id <> ${expected}`))[0]!.n, 0);
    });
  await test('a new row takes a random id; a re-run of the migration keeps it', async () => {
    const id = async () =>
      (await q<{ id: string }>(`SELECT id::text FROM approve_status WHERE approve_status_id = 9972`))[0]?.id;
    await q(`INSERT INTO approve_status (approve_status_id, approve_name_th) VALUES (9972, 'QID new')`);
    const before = await id();
    await q(MIGRATION);
    const after = await id();
    await q(`DELETE FROM approve_status WHERE approve_status_id IN (9971, 9972)`);
    assert.ok(before && isV7(before));
    assert.equal(after, before);
  });

  console.log('\n3. every public table');
  await test('has id uuid NOT NULL DEFAULT uuid_generate_v7() with a unique index of its own; no integer id left', async () => {
    const bad = await q<{ t: string; why: string }>(`
      SELECT t.table_name t,
             CASE WHEN c.column_name IS NULL THEN 'no id'
                  WHEN c.data_type <> 'uuid' THEN 'id is ' || c.data_type
                  WHEN c.is_nullable <> 'NO' THEN 'id nullable'
                  WHEN c.column_default IS DISTINCT FROM 'uuid_generate_v7()' THEN 'default ' || coalesce(c.column_default, 'none')
                  ELSE 'no unique index on (id)' END why
        FROM information_schema.tables t
        LEFT JOIN information_schema.columns c
          ON c.table_schema = t.table_schema AND c.table_name = t.table_name AND c.column_name = 'id'
       WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
         AND NOT (c.data_type = 'uuid' AND c.is_nullable = 'NO' AND c.column_default = 'uuid_generate_v7()'
                  AND EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
                               WHERE i.indrelid = format('public.%I', t.table_name)::regclass
                                 AND i.indisunique AND i.indnatts = 1 AND i.indpred IS NULL AND a.attname = 'id'))
       ORDER BY 1`);
    assert.deepEqual(bad, []);
    const [{ n }] = (await q<{ n: number }>(
      `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    )) as [{ n: number }];
    assert.ok(n >= 66, `${n} tables`);
  });

  console.log('\n4. uuid in, row out: contract uuid() / byUuid(), src/server/ids.ts');
  {
    const { uuid, byUuid } = await import('@/server/contract/common');
    const { pkOf, pksOf, rowByUuid } = await import('@/server/ids');
    const { approveStatus } = await import('@/db/schema');
    const { pool: appPool } = await import('@/db/client');
    const status = async (p: Promise<unknown>) =>
      p.then(
        () => 200,
        (e: { status?: number; message?: string }) => `${e.status} ${e.message}`,
      );
    try {
      await q(`DELETE FROM approve_status WHERE approve_status_id = 9973;
               INSERT INTO approve_status (approve_status_id, approve_name_th) VALUES (9973, 'QID4')`);
      const [{ id }] = (await q<{ id: string }>(
        `SELECT id::text FROM approve_status WHERE approve_status_id = 9973`,
      )) as [{ id: string }];
      const gone = '0190a000-0000-7000-8000-000000000000';
      await test('uuid(): lower-cases; a number, an old document number or junk → its message', async () => {
        assert.equal(uuid().parse(id.toUpperCase()), id);
        for (const bad of [9973, '9973', 'J2600001', `${id}x`, ''])
          assert.equal(uuid('bad id').safeParse(bad).error?.issues[0]?.message, 'bad id', String(bad));
        assert.equal(byUuid('งาน', 'job').safeParse({ id: 'J2600001' }).error?.issues[0]?.message, 'ไม่พบงาน');
        assert.deepEqual(byUuid('งาน', 'job').parse({ id: id.toUpperCase() }), { id });
      });
      await test('pkOf / rowByUuid: the row of that uuid; none → 404 ไม่พบ<what>', async () => {
        assert.equal(await pkOf(approveStatus, approveStatus.approveStatusId, id, 'สถานะ'), 9973);
        assert.equal((await rowByUuid(approveStatus, id, 'สถานะ')).approveNameTh, 'QID4');
        assert.equal(await status(pkOf(approveStatus, approveStatus.approveStatusId, gone, 'สถานะ')), '404 ไม่พบสถานะ');
        assert.equal(await status(rowByUuid(approveStatus, gone, 'สถานะ')), '404 ไม่พบสถานะ');
      });
      await test('pksOf: every uuid once → its key; [] → empty; one without a row → 404', async () => {
        const m = await pksOf(approveStatus, approveStatus.approveStatusId, [id, id], 'สถานะ');
        assert.deepEqual([...m], [[id, 9973]]);
        assert.equal((await pksOf(approveStatus, approveStatus.approveStatusId, [], 'สถานะ')).size, 0);
        assert.equal(
          await status(pksOf(approveStatus, approveStatus.approveStatusId, [id, gone], 'สถานะ')),
          '404 ไม่พบสถานะ',
        );
      });
    } finally {
      await q(`DELETE FROM approve_status WHERE approve_status_id = 9973`);
      await appPool.end();
    }
  }
} finally {
  await pool.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
