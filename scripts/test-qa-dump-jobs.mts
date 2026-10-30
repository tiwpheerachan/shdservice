/**
 * scripts/test-qa-dump-jobs.mts — job regressions from the QA on the legacy data dump (2026-10-28): a legacy total
 * that is not the sum of its costs (VAT / a discount folded in) is the net the close page shows, and stays until a
 * cost changes; the job list chips add up to the total (ยกเลิกซ่อม (6) has its own: Cancel, as the dashboard KPI).
 *
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-dump-jobs.mts
 * Seeds its own fixtures (ids 996x, codes QDJ*, users qdj-*) and resets them at every start. ONLY a local *_test database.
 */
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
Object.assign(process.env, { SESSION_SECRET: 'unit-test-session-secret-0123456789abcdef' });

const { db, pool } = await import('@/db/client');
const { getJob, saveRepair, jobStats } = await import('@/server/services/jobs');
const { costRows, netOf, LEGACY_ADJUST_LABEL } = await import('@/components/jobs/close-money');

const ADMIN = { id: 9961, email: 'qdj-admin@example.invalid' };
const CUSTOMER = 'QDJC01';
const J = (n: number) => `QDJ${String(n).padStart(4, '0')}`;

await pool.query(`
  INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
    SELECT * FROM (VALUES (0, 'ยกเลิก', 0, 'Cancel', true), (2, 'อยู่ระหว่างดำเนินการ', 2, 'Pending', true),
                          (5, 'ซ่อมเสร็จ', 5, 'Repaired', true),
                          (6, 'ยกเลิกซ่อม (ลูกค้าไม่ตกลงซ่อม)', 6, 'Repaired', true)) v(id, name, ord, grp, act)
     WHERE NOT EXISTS (SELECT 1 FROM job_status s WHERE s.job_status_id = v.id);
  DELETE FROM job_status_log WHERE job_pk IN (SELECT pk FROM job WHERE job_no LIKE 'QDJ%' OR customer_pk = 9961);
  DELETE FROM job WHERE job_no LIKE 'QDJ%' OR customer_pk = 9961;
  -- the user stays (audit_log, append-only, points at it): reset in place
  INSERT INTO app_user (pk, first_name, last_name, email_address, user_type, record_status) OVERRIDING SYSTEM VALUE
    VALUES (${ADMIN.id}, 'QDJ', 'admin', '${ADMIN.email}', 'System Admin', 'ACTIVE')
    ON CONFLICT (pk) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
      email_address = excluded.email_address, user_type = excluded.user_type, record_status = excluded.record_status, last_login = DEFAULT;
  DELETE FROM customer WHERE pk = 9961 OR customer_code = '${CUSTOMER}';
  INSERT INTO customer (pk, customer_code, customer_name, phone_number) OVERRIDING SYSTEM VALUE VALUES (9961, '${CUSTOMER}', 'ลูกค้า QDJ', '02-996-0001');
  -- J2509357-like (parts 1,600 + service 400, VAT 7% → 2,140 paid), J2300041-like (parts 2,200, discount → 2,000),
  -- a declined job (6), an open one (2)
  -- job.model_pk is NOT NULL (drizzle/0006): a model every fixture job without its own can point at (never deleted)
  INSERT INTO model (model_code, model_name, record_status)
    SELECT 'TST-M', 'Test model', 'ACTIVE' WHERE NOT EXISTS (SELECT 1 FROM model WHERE model_code = 'TST-M');
  INSERT INTO job (model_pk, job_no, job_status_id, customer_pk, customer_detail, engineer_app_user_pk, job_create_date, job_reception_date,
                   spare_part_total_cost, service_cost, job_total_cost, job_payment_amount, record_status)
    SELECT (SELECT pk FROM model WHERE model_code = 'TST-M'), 'QDJ' || lpad(n::text, 4, '0'), s, 9961, '${CUSTOMER} ลูกค้า QDJ 02-996-0001', ${ADMIN.id},
           now() - interval '10 days', current_date - 10, parts, service, total, paid, 'ACTIVE'
      FROM (VALUES (1, 5, 1600, 400, 2140, 2140), (2, 5, 2200, 0, 2000, 2000), (3, 6, 0, 0, 0, 0),
                   (4, 2, 0, 300, 300, 0)) v(n, s, parts, service, total, paid);
`);

const statusName = async (id: number) =>
  (await db.execute<{ n: string }>(sql`SELECT job_status_name AS n FROM job_status WHERE job_status_id = ${id}`))
    .rows[0]!.n;
const totalOf = async (no: string) =>
  Number((await db.execute<{ t: string }>(sql`SELECT job_total_cost AS t FROM job WHERE job_no = ${no}`)).rows[0]!.t);

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
  console.log('\n1. a legacy total that is not the sum of its costs is the net');
  await test('VAT folded in: the costs + ปรับยอดจากระบบเดิม add up to the stored 2,140 (= what is due)', async () => {
    const j = (await getJob(J(1)))!;
    const rows = costRows(j);
    assert.deepEqual(rows.at(-1), { label: LEGACY_ADJUST_LABEL, v: 140 });
    assert.equal(netOf(rows), 2140);
    assert.deepEqual([j.totalCost, j.amountDue, j.outstanding], [2140, 2140, 0]);
  });
  await test('a discount folded in: the adjustment is negative (2,200 − 200 = 2,000)', async () => {
    const rows = costRows((await getJob(J(2)))!);
    assert.deepEqual(rows.at(-1), { label: LEGACY_ADJUST_LABEL, v: -200 });
    assert.equal(netOf(rows), 2000);
  });
  await test('a total that is its costs: no adjustment row', async () => {
    const rows = costRows((await getJob(J(4)))!);
    assert.ok(!rows.some((r) => r.label === LEGACY_ADJUST_LABEL), JSON.stringify(rows));
    assert.equal(netOf(rows), 300);
  });
  await test('the repair page saving the costs unchanged keeps the total; a changed cost adds them up again', async () => {
    const status = await statusName(5);
    const costs = { serviceCost: '400', toolCost: '0', deliveryCost: '0', boxCost: '0' };
    await saveRepair(J(1), { status, ...costs }, ADMIN.id);
    assert.equal(await totalOf(J(1)), 2140);
    const j = await saveRepair(J(1), { status, ...costs, serviceCost: '500' }, ADMIN.id);
    assert.equal(j.totalCost, 2100);
    assert.ok(!costRows(j).some((r) => r.label === LEGACY_ADJUST_LABEL));
  });

  console.log('\n2. ยกเลิกซ่อม (6) counts as Cancel on the job list chips (kpiGroup)');
  await test('the job list chips: what total leaves after new / in progress / done is exactly the 6s', async () => {
    const s = await jobStats();
    const sixes = Number(
      (await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM job WHERE job_status_id = 6`)).rows[0]!.n,
    );
    assert.ok(sixes >= 1);
    assert.equal(s.total - s.fresh - s.progress - s.done, sixes);
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
