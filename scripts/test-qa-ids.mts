/**
 * TEST_DATABASE_URL=… NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-ids.mts
 * Id rules on the live catalog: every public table has `id uuid NOT NULL DEFAULT uuid_generate_v7()` with a unique
 * index; uuid_v7_stable gives the same id for the same (time, seed); `pk bigint` identity ALWAYS first and the PK,
 * `id` second, every `*_pk` a RESTRICT foreign key to `<table>.pk`, no column 0006 dropped, legacy_orphan_ref as
 * designed. Each rule also proves it catches a break (DDL in a transaction rolled back). Fixtures: approve_status
 * 9973, removed at the end.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL; // src/server/ids.ts reads through the app's pool (section 3)
const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1, options: '-c TimeZone=Asia/Bangkok' });
const q = async <T,>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const MIGRATION_0006 = readFileSync('drizzle/0006_bigint_pk.sql', 'utf8');

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

/**
 * A catalog rule: `sql` selects one `bad` text per violation, none when the rule holds. Each of `breaks` (DDL)
 * is then applied in a transaction that is rolled back, and the rule must notice it — so no rule passes vacuously.
 */
async function rule(name: string, sql: string, values: unknown[], breaks: string[]) {
  const bad = async () => (await q<{ bad: string }>(sql, values)).map((r) => r.bad);
  await test(name, async () => assert.deepEqual(await bad(), []));
  for (const b of breaks)
    await test(`  …and fails after: ${b}`, async () => {
      await q('BEGIN');
      try {
        await q(b);
        assert.notDeepEqual(await bad(), [], 'the rule did not notice');
      } finally {
        await q('ROLLBACK');
      }
    });
}

/** the uuid's version nibble and variant bits */
const isV7 = (u: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(u);

try {
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

  console.log('\n2. every public table: id (phase 1)');
  await rule(
    'has id uuid NOT NULL DEFAULT uuid_generate_v7() with a unique index of its own',
    `SELECT t.table_name || ': ' ||
            CASE WHEN c.column_name IS NULL THEN 'no id'
                 WHEN c.data_type <> 'uuid' THEN 'id is ' || c.data_type
                 WHEN c.is_nullable <> 'NO' THEN 'id nullable'
                 WHEN c.column_default IS DISTINCT FROM 'uuid_generate_v7()' THEN 'default ' || coalesce(c.column_default, 'none')
                 ELSE 'no unique index on (id)' END bad
       FROM information_schema.tables t
       LEFT JOIN information_schema.columns c
         ON c.table_schema = t.table_schema AND c.table_name = t.table_name AND c.column_name = 'id'
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND NOT coalesce(c.data_type = 'uuid' AND c.is_nullable = 'NO' AND c.column_default = 'uuid_generate_v7()'
                 AND EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
                              WHERE i.indrelid = format('public.%I', t.table_name)::regclass
                                AND i.indisunique AND i.indnatts = 1 AND i.indpred IS NULL AND a.attname = 'id'), false)
      ORDER BY 1`,
    [],
    ['ALTER TABLE color ALTER COLUMN id DROP DEFAULT', 'DROP INDEX ux_color_id', 'CREATE TABLE qid_bad (x int)'],
  );

  console.log('\n3. uuid in, row out: contract uuid() / byUuid(), src/server/ids.ts');
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
      const [{ id, pk }] = (await q<{ id: string; pk: number }>(
        `SELECT id::text, pk::int FROM approve_status WHERE approve_status_id = 9973`,
      )) as [{ id: string; pk: number }];
      const gone = '0190a000-0000-7000-8000-000000000000';
      await test('uuid(): lower-cases; a number, an old document number or junk → its message', async () => {
        assert.equal(uuid().parse(id.toUpperCase()), id);
        for (const bad of [9973, '9973', 'J2600001', `${id}x`, ''])
          assert.equal(uuid('bad id').safeParse(bad).error?.issues[0]?.message, 'bad id', String(bad));
        assert.equal(byUuid('งาน', 'job').safeParse({ id: 'J2600001' }).error?.issues[0]?.message, 'ไม่พบงาน');
        assert.deepEqual(byUuid('งาน', 'job').parse({ id: id.toUpperCase() }), { id });
      });
      await test('pkOf / rowByUuid: the row of that uuid; none → 404 ไม่พบ<what>', async () => {
        assert.equal(await pkOf(approveStatus, id, 'สถานะ'), pk);
        assert.equal((await rowByUuid(approveStatus, id, 'สถานะ')).approveNameTh, 'QID4');
        assert.equal(await status(pkOf(approveStatus, gone, 'สถานะ')), '404 ไม่พบสถานะ');
        assert.equal(await status(rowByUuid(approveStatus, gone, 'สถานะ')), '404 ไม่พบสถานะ');
      });
      await test('pksOf: every uuid once → its pk; [] → empty; one without a row → 404', async () => {
        const m = await pksOf(approveStatus, [id, id], 'สถานะ');
        assert.deepEqual([...m], [[id, pk]]);
        assert.equal((await pksOf(approveStatus, [], 'สถานะ')).size, 0);
        assert.equal(await status(pksOf(approveStatus, [id, gone], 'สถานะ')), '404 ไม่พบสถานะ');
      });
    } finally {
      await q(`DELETE FROM approve_status WHERE approve_status_id = 9973`);
      await appPool.end();
    }
  }

  console.log('\n4. ADR 0008 phase 2 (drizzle/0006): pk first, *_pk foreign keys, nothing dropped comes back');
  /** live tables (and partitioned), their columns numbered 1, 2, … in order */
  const COLS = `WITH t AS (SELECT oid, relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p')),
    col AS (SELECT a.attrelid, a.attnum, a.attname, a.atttypid, a.attidentity,
                   row_number() OVER (PARTITION BY a.attrelid ORDER BY a.attnum) pos
              FROM pg_attribute a JOIN t ON t.oid = a.attrelid WHERE a.attnum > 0 AND NOT a.attisdropped)`;
  await test('67 tables or more (66 converted + legacy_orphan_ref)', async () => {
    const [{ n }] = (await q<{ n: number }>(
      `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    )) as [{ n: number }];
    assert.ok(n >= 67, `${n} tables`);
  });
  await rule(
    'column 1 = pk bigint GENERATED ALWAYS AS IDENTITY, the primary key (alone); column 2 = id',
    `${COLS}
     SELECT relname || ': ' || why bad FROM (
       SELECT t.relname, CASE
                WHEN c1.attname IS DISTINCT FROM 'pk' THEN 'column 1 is ' || coalesce(c1.attname, 'none')
                WHEN c1.atttypid <> 'bigint'::regtype THEN 'pk is ' || format_type(c1.atttypid, NULL)
                WHEN c1.attidentity <> 'a' THEN 'pk is not GENERATED ALWAYS AS IDENTITY'
                WHEN NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = t.oid AND k.contype = 'p' AND k.conkey = ARRAY[c1.attnum])
                  THEN 'the primary key is not (pk)'
                WHEN c2.attname IS DISTINCT FROM 'id' THEN 'column 2 is ' || coalesce(c2.attname, 'none') END why
         FROM t LEFT JOIN col c1 ON c1.attrelid = t.oid AND c1.pos = 1 LEFT JOIN col c2 ON c2.attrelid = t.oid AND c2.pos = 2
     ) x WHERE why IS NOT NULL ORDER BY 1`,
    [],
    [
      'ALTER TABLE color ALTER COLUMN pk SET GENERATED BY DEFAULT',
      'ALTER TABLE running_no DROP CONSTRAINT running_no_pkey',
      'CREATE TABLE qid_bad (pk integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, id uuid NOT NULL DEFAULT uuid_generate_v7() UNIQUE)',
      'CREATE TABLE qid_bad (pk bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, x int, id uuid NOT NULL DEFAULT uuid_generate_v7() UNIQUE)',
    ],
  );
  // legacy_orphan_ref.row_pk points at any table (no FK by nature); track_otp / track_session.customer_pks are
  // bigint[] (no FK on arrays) and do not end in _pk
  await rule(
    'every *_pk column has a foreign key to <table>.pk and its name ends in <table>_pk',
    `${COLS}
     SELECT t.relname || '.' || c.attname ||
            CASE WHEN f.oid IS NULL THEN ': no foreign key' ELSE ' → ' || rc.relname || '.' || ra.attname END bad
       FROM t JOIN col c ON c.attrelid = t.oid
       LEFT JOIN pg_constraint f ON f.conrelid = t.oid AND f.contype = 'f' AND f.conkey = ARRAY[c.attnum]
       LEFT JOIN pg_class rc ON rc.oid = f.confrelid
       LEFT JOIN pg_attribute ra ON ra.attrelid = f.confrelid AND ra.attnum = f.confkey[1]
      WHERE c.attname LIKE '%\\_pk'
        AND (t.relname, c.attname) NOT IN (('legacy_orphan_ref', 'row_pk'), ('legacy_boundary', 'max_pk'))
        AND (f.oid IS NULL OR ra.attname <> 'pk'
             OR NOT (c.attname = rc.relname || '_pk' OR right(c.attname, length(rc.relname) + 4) = '_' || rc.relname || '_pk'
                     OR c.attname = 'actor_pk' AND rc.relname = 'app_user'))
      ORDER BY 1`,
    [],
    [
      'ALTER TABLE color ADD COLUMN stray_pk bigint',
      'ALTER TABLE color ADD COLUMN owner_pk bigint REFERENCES app_user (pk) ON DELETE RESTRICT',
      'ALTER TABLE color ADD COLUMN qid_job_pk bigint REFERENCES app_user (pk) ON DELETE RESTRICT',
    ],
  );
  await rule(
    'every foreign key is one column and targets pk, but for the code tables (decision 5)',
    `SELECT f.conrelid::regclass || '.' || f.conname || ' → ' || f.confrelid::regclass || '.' || ra.attname bad
       FROM pg_constraint f JOIN pg_attribute ra ON ra.attrelid = f.confrelid AND ra.attnum = f.confkey[1]
      WHERE f.contype = 'f' AND f.connamespace = 'public'::regnamespace
        AND (cardinality(f.confkey) <> 1
             OR ra.attname <> 'pk' AND f.confrelid::regclass::text || '.' || ra.attname <> ALL ($1::text[]))
      ORDER BY 1`,
    [
      [
        'job_status.job_status_id',
        'quotation_status.quotation_status_id',
        'approve_status.approve_status_id',
        'job_part_status.job_part_status_id',
        'stock_move_type.stock_move_type_id',
        'store_location.store_location_id',
        'condition.condition_id',
        'record_status.code',
      ],
    ],
    ['ALTER TABLE color ADD COLUMN qid_job_no varchar(50) REFERENCES job (job_no) ON DELETE RESTRICT'],
  );
  await rule(
    'every foreign key is ON DELETE RESTRICT (decision 3)',
    `SELECT conrelid::regclass || '.' || conname || ' ON DELETE ' || confdeltype::text bad
       FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND confdeltype <> 'r' ORDER BY 1`,
    [],
    [
      'ALTER TABLE color ADD COLUMN qid_app_user_pk bigint REFERENCES app_user (pk) ON DELETE CASCADE',
      'ALTER TABLE color ADD COLUMN qid_app_user_pk bigint REFERENCES app_user (pk)',
    ],
  );
  {
    // the columns 0006 dropped or renamed: its section-1 list of old columns minus its CREATE TABLE <t>__new columns
    // (section 3), under the table's new name (section 7), plus the columns section 7 renames
    const section = (n: number) =>
      MIGRATION_0006.slice(MIGRATION_0006.indexOf(`-- === ${n}. `), MIGRATION_0006.indexOf(`-- === ${n + 1}. `));
    const old = new Map(
      [...section(1).matchAll(/^ {6}\('(\w+)', '([\w ]+)'\),?$/gm)].map((m) => [m[1]!, m[2]!.split(' ')]),
    );
    const now = new Map(
      [...section(3).matchAll(/^CREATE TABLE (\w+)__new \(\n([\s\S]*?)\n\);/gm)].map((m) => [
        m[1]!,
        m[2]!.split('\n').map((l) => l.trim().split(' ')[0]!),
      ]),
    );
    const newName = new Map([...section(7).matchAll(/^ {6}\('(\w+)', '(\w+)'\),?$/gm)].map((m) => [m[1]!, m[2]!]));
    const renamed = [...section(7).matchAll(/^ALTER TABLE (\w+) RENAME COLUMN (\w+) TO \w+;$/gm)].map((m) => [
      m[1]!,
      m[2]!,
    ]);
    const dropped = [...old].flatMap(([t, cols]) => cols.filter((c) => !now.get(t)?.includes(c)).map((c) => [t, c]));
    // what must not exist any more: (new table, old column)
    const gone = [...dropped.map(([t, c]) => [newName.get(t!) ?? t!, c!]), ...renamed];
    await test('drizzle/0006 lists 66 old and 66 new tables (19 renamed); ~170 dropped / renamed columns, the known ones among them', () => {
      assert.equal(old.size, 66);
      assert.equal(now.size, 66);
      assert.equal(newName.size, 66);
      assert.equal([...newName].filter(([o, n]) => o !== n).length, 19);
      assert.ok(renamed.length >= 40, `${renamed.length} renamed`);
      assert.ok(gone.length >= 170, `${gone.length} dropped / renamed`);
      const names = gone.map(([t, c]) => `${t}.${c}`);
      for (const c of [
        'app_user.user_id',
        'app_user.password',
        'job.engineer_id',
        'job.product_brand_id', // → brand_manufacturer_pk, then dropped (model.brand_pk says it)
        'job_status_log.job_no',
        'job_attachment.reference_topic',
        'stock_move.reference_document_no',
        'sale_order.customer_code',
        'sale_order.vat_rat',
        'audit_log.app_user_pk',
        'track_otp.customer_ids',
      ])
        assert.ok(names.includes(c), c);
      return Promise.resolve();
    });
    await rule(
      'no column drizzle/0006 dropped or renamed exists again',
      `SELECT table_name || '.' || column_name bad FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name::text, column_name::text) IN (SELECT * FROM unnest($1::text[], $2::text[])) ORDER BY 1`,
      [gone.map(([t]) => t), gone.map(([, c]) => c)],
      [
        'ALTER TABLE job ADD COLUMN engineer_id integer',
        'ALTER TABLE job_status_log ADD COLUMN job_no varchar(50)',
        'ALTER TABLE sale_order ADD COLUMN vat_rat numeric',
      ],
    );
  }
  await rule(
    'legacy_orphan_ref: pk, id, table_name, row_pk, column_name, legacy_value; UNIQUE (table_name, row_pk, column_name); RLS; no foreign keys',
    `WITH r AS (SELECT to_regclass('public.legacy_orphan_ref') oid)
     SELECT 'missing' bad FROM r WHERE oid IS NULL
     UNION ALL
     SELECT 'columns: ' || coalesce(cols, 'none') FROM (
       SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
                         ', ' ORDER BY a.attnum) cols
         FROM r JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped) x
      WHERE cols IS DISTINCT FROM $1
     UNION ALL
     SELECT 'no UNIQUE (table_name, row_pk, column_name)' FROM r WHERE NOT EXISTS (
       SELECT 1 FROM pg_index i
        WHERE i.indrelid = r.oid AND i.indisunique AND i.indpred IS NULL
          AND (SELECT array_agg(a.attname::text ORDER BY k.o) FROM unnest(i.indkey::int2[]) WITH ORDINALITY k(n, o)
                 JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.n) = ARRAY['table_name', 'row_pk', 'column_name'])
     UNION ALL
     SELECT 'row level security off' FROM r JOIN pg_class c ON c.oid = r.oid WHERE NOT c.relrowsecurity
     UNION ALL
     SELECT 'foreign key ' || f.conname FROM r JOIN pg_constraint f ON f.contype = 'f' AND r.oid IN (f.conrelid, f.confrelid)`,
    [
      'pk bigint NOT NULL, id uuid NOT NULL, table_name character varying(63) NOT NULL, row_pk bigint NOT NULL, ' +
        'column_name character varying(63) NOT NULL, legacy_value text NOT NULL',
    ],
    [
      'DROP TABLE legacy_orphan_ref',
      'ALTER TABLE legacy_orphan_ref ALTER COLUMN legacy_value DROP NOT NULL',
      'DROP INDEX ux_legacy_orphan_ref_row',
      'ALTER TABLE legacy_orphan_ref DISABLE ROW LEVEL SECURITY',
      'ALTER TABLE legacy_orphan_ref ADD FOREIGN KEY (row_pk) REFERENCES job (pk) ON DELETE RESTRICT NOT VALID',
    ],
  );
} finally {
  await pool.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
