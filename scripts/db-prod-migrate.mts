/**
 * npm run db:prod:migrate — migrate PRODUCTION from this machine. The target is `.env.prod.local` (a file `next dev`
 * never loads) and must be the production project; this shows the migrations still to run and runs nothing until you
 * type the project ref. Never --reset: a journal reset / reload is setupdata/load_supabase.sh's, for a planned cutover only.
 *
 * Production runs the code it was deployed with: a migration run ahead of a deploy must work with the old code too
 * (adding columns / tables is fine; dropping or renaming one waits for the deploy, i.e. db:migrate:deploy).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parse } from 'dotenv';
import { Client } from 'pg';
import { dbSsl } from '../src/db/ssl';

export const PROD_REF = 'bnntpshuoyzkzckepjse';
/** the production values on this machine: a name `next dev` / Next.js never load (unlike .env), git-ignored (*.local) */
export const PROD_ENV_FILE = '.env.prod.local';

/** the production env file's DATABASE_URL on the session pooler (5432): a migration's one long transaction, its NOTICEs, its SETs */
export function prodUrl(envText: string): string {
  const url = (parse(envText).DATABASE_URL ?? '').trim();
  if (!url.includes(PROD_REF))
    throw new Error(`${PROD_ENV_FILE}'s DATABASE_URL is not the production project (${PROD_REF})`);
  return url.replace(/:6543\//, ':5432/');
}

/** journal entries newer than the last one the database recorded (drizzle runs exactly these) */
export function pending(journal: { entries: { tag: string; when: number }[] }, lastApplied: number | null) {
  return journal.entries.filter((e) => lastApplied === null || e.when > lastApplied).map((e) => e.tag);
}

async function main() {
  if (!existsSync(PROD_ENV_FILE))
    throw new Error(`${PROD_ENV_FILE} not found — the production values (DATABASE_URL) live there, never in .env`);
  const url = prodUrl(readFileSync(PROD_ENV_FILE, 'utf8'));
  const host = url.replace(/^.*@/, '').replace(/\/.*$/, '');
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));

  const db = new Client({ connectionString: url, ssl: dbSsl(url) });
  await db.connect();
  await db.query('BEGIN TRANSACTION READ ONLY');
  const { rows } = await db.query<{ last: string | null }>(
    `SELECT CASE WHEN to_regclass('drizzle.__drizzle_migrations') IS NULL THEN NULL
                 ELSE (SELECT max(created_at)::text FROM drizzle.__drizzle_migrations) END AS last`,
  );
  await db.query('COMMIT');
  await db.end();
  const todo = pending(journal, rows[0]?.last == null ? null : Number(rows[0].last));

  console.log(`\nPRODUCTION  ${host}  (${PROD_REF})`);
  if (!todo.length) {
    console.log('nothing to migrate — every migration is recorded');
    return;
  }
  console.log(`to run (${todo.length}):\n${todo.map((t) => `  - ${t}`).join('\n')}`);
  console.log('\nThe app keeps running the code it was deployed with: these must work with it.');
  if (!process.stdin.isTTY) throw new Error('not a terminal — run it yourself to confirm');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`Type the project ref (${PROD_REF}) to migrate: `)).trim();
  rl.close();
  if (answer !== PROD_REF) {
    console.log('aborted — nothing ran');
    process.exit(1);
  }
  execFileSync('npx', ['tsx', 'scripts/migrate.ts', '--prod'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, ALLOW_PROD_DB: '1' },
  });
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((e) => {
    console.error(`✖ ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
