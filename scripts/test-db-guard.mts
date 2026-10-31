/**
 * npm run test:db-guard — the database you migrate is said out loud: db:migrate / db:migrate:deploy
 * only on Render, db:prod:migrate only at the production project (session pooler), never --reset with --prod, and no
 * journal reset at all (forced or the automatic re-run) when the URL is the production project.
 * No database is touched: every refusal happens before a connection.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PROD_REF, pending, prodUrl } from './db-prod-migrate.mts';

let failed = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : e}`);
  }
};
/** migrate.ts as a script, with an env that has no Render and a database nobody listens on */
const migrate = (args: string[], env: Record<string, string> = {}) =>
  spawnSync('npx', ['tsx', 'scripts/migrate.ts', ...args], {
    encoding: 'utf8',
    env: { ...process.env, RENDER: '', DATABASE_URL: 'postgresql://x:y@127.0.0.1:1/none_test', ...env },
  });
/** a URL naming the production project that nobody listens on — a refusal must come before any connection */
const PROD_LIKE = `postgresql://postgres.${PROD_REF}:pw@127.0.0.1:1/postgres`;

test('db:migrate / db:migrate:deploy from a laptop: refused before connecting, names the two commands', () => {
  const r = migrate(['--deploy']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /db:dev:migrate/);
  assert.match(r.stderr, /db:prod:migrate/);
});
test('--prod never with --reset', () => {
  const r = migrate(['--prod', '--reset']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /never run against production/);
});
test('--reset at the production project: refused even with ALLOW_PROD_DB=1 exported, and on Render', () => {
  for (const env of [{ ALLOW_PROD_DB: '1' }, { RENDER: 'true' }, { ALLOW_PROD_DB: '1', RENDER: 'true' }]) {
    const r = migrate(['--reset'], { ...env, DATABASE_URL: PROD_LIKE });
    assert.equal(r.status, 1, JSON.stringify(env));
    assert.match(r.stderr, /PRODUCTION is never reset/, JSON.stringify(env));
    assert.doesNotMatch(r.stderr + r.stdout, /ECONNREFUSED|clearing the migration journal/);
  }
});
test('the production project without ALLOW_PROD_DB off Render: refused (no reset needed)', () => {
  const r = migrate([], { DATABASE_URL: PROD_LIKE });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /PRODUCTION database/);
});
test('prodUrl: only the production project, moved to the session pooler', () => {
  assert.equal(
    prodUrl(`DATABASE_URL=postgresql://postgres.${PROD_REF}:pw@aws-0-x.pooler.supabase.com:6543/postgres\n`),
    `postgresql://postgres.${PROD_REF}:pw@aws-0-x.pooler.supabase.com:5432/postgres`,
  );
  assert.throws(
    () => prodUrl('DATABASE_URL=postgresql://root:p@127.0.0.1:55435/shd_oneservice_dev_db'),
    /not the production/,
  );
  assert.throws(() => prodUrl(''), /not the production/);
});
test('pending: the journal entries newer than the last recorded one', () => {
  const j = {
    entries: [
      { tag: '0000_init', when: 1 },
      { tag: '0001_a', when: 2 },
      { tag: '0002_b', when: 3 },
    ],
  };
  assert.deepEqual(pending(j, 1), ['0001_a', '0002_b']);
  assert.deepEqual(pending(j, 3), []);
  assert.deepEqual(pending(j, null), ['0000_init', '0001_a', '0002_b']);
});

console.log(failed ? `${failed} failed` : 'all passed (0 failed)');
process.exit(failed ? 1 : 0);
