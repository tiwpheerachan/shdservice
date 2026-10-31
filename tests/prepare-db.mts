/**
 * npm run db:test:prepare — make the throwaway test database look like a fresh Supabase
 * project, then apply every migration. Refuses anything that isn't a local database.
 * `npm run db:test:prepare -- --reset` empties it first (scripts/db-wipe.sql) and migrates from scratch —
 * the migrations cannot re-run over the tables drizzle/0006 rebuilt. CI runs
 * prepare → wipe → prepare.
 *   TEST_DATABASE_URL (default postgresql://postgres:test@127.0.0.1:55442/oneservice_test)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { TEST_DATABASE_URL, assertLocal } from './db-url.mts';

assertLocal(TEST_DATABASE_URL);
const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
if (process.argv.includes('--reset')) {
  console.log('--reset: scripts/db-wipe.sql, then every migration from scratch');
  await pool.query(readFileSync('scripts/db-wipe.sql', 'utf8'));
}
// Supabase ships these; plain Postgres (docker, CI) does not — 0012 uses gen_random_bytes()
await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
await pool.end();
execFileSync('npx', ['tsx', 'scripts/migrate.ts'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
});
