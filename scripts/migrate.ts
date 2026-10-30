/**
 * npm run db:migrate
 *
 * Applies ./drizzle/*.sql in journal order using drizzle's migrator against
 * DATABASE_URL. Extra behaviour for this project:
 *
 *  - The legacy tables are (re)loaded from a SQL Server dump by
 *    setupdata/load_supabase.sh, which DROPs and re-creates them. After such a
 *    reload drizzle's journal (drizzle.__drizzle_migrations) still says every
 *    migration was applied, while the app columns are gone again. We detect
 *    that state (journal has rows but app_user.lark_id is missing) and reset the
 *    journal so every migration — all written to be idempotent — runs again.
 *
 *  - `--reset` forces that behaviour. Neither ever runs against production (PROD_REF in the URL), nor on a database
 *    drizzle/0006 converted (job.pk exists, ADR 0008 decision 12): that one is wiped (scripts/db-wipe.sql) and migrated.
 *  - `--deploy` (db:migrate:deploy, and db:migrate while Render's dashboard still calls it): Render's pre-deploy
 *    only — from a laptop it is refused and names the two commands that are (ADR 0009).
 *  - `--prod`: run by scripts/db-prod-migrate.mts (db:prod:migrate) after it asked; never with --reset.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { dbSsl } from '../src/db/ssl';
import { PROD_REF } from './db-prod-migrate.mjs'; // the .mts (tsx and tsc resolve it)

const PROD_RESET =
  'REFUSED: the migration journal of PRODUCTION is never reset from here (a reload is setupdata/load_supabase.sh).';
const MIGRATIONS_FOLDER = './drizzle';
const JOURNAL_SCHEMA = 'drizzle';
const JOURNAL_TABLE = '__drizzle_migrations';

async function main() {
  // which database is said out loud: dev (db:dev:migrate), production (db:prod:migrate — asks first), deploy (Render)
  if (process.argv.includes('--deploy') && !process.env.RENDER) {
    console.error(
      'REFUSED: db:migrate / db:migrate:deploy run on Render (pre-deploy) only. Local dev DB: npm run db:dev:migrate · production from here: npm run db:prod:migrate (asks first).',
    );
    process.exit(1);
  }
  if (process.argv.includes('--prod') && process.argv.includes('--reset')) {
    console.error(
      'REFUSED: --reset is never run against production from here (a reload is setupdata/load_supabase.sh).',
    );
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set (use the Supabase *Session pooler*, port 5432).');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: url,
    max: 1,
    ssl: dbSsl(url), // same TLS rules as the app (src/db/ssl.ts)
    options: '-c TimeZone=Asia/Bangkok',
  });
  // RAISE NOTICE from a migration (e.g. 0022 "duplicate …, unique index NOT created") must reach
  // the deploy log — node-postgres drops notices nobody listens for
  pool.on('connect', (c) => c.on('notice', (n) => console.warn(`NOTICE: ${n.message}`)));
  const db = drizzle(pool);

  const force = process.argv.includes('--reset');
  const prod = url.includes(PROD_REF);
  // the journal of production is never cleared from here, whatever is exported (ALLOW_PROD_DB, RENDER) — a reload
  // is setupdata/load_supabase.sh's; the automatic re-run below is refused the same way
  if (prod && force) {
    console.error(PROD_RESET);
    process.exit(1);
  }
  // production is migrated by Render (pre-deploy, RENDER is set there) — from a laptop, .env's
  // DATABASE_URL is production, so a stray `npm run db:migrate` must not run against it
  if (prod && !process.env.RENDER && process.env.ALLOW_PROD_DB !== '1') {
    console.error(
      'REFUSED: this is the PRODUCTION database — Render migrates it on deploy. For the local dev DB: npm run db:dev:load. Set ALLOW_PROD_DB=1 only if you really mean it.',
    );
    process.exit(1);
  }
  const { rows: j } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = $2`,
    [JOURNAL_SCHEMA, JOURNAL_TABLE],
  );
  const journalExists = j[0]?.n !== '0';
  if (journalExists) {
    const { rows: c } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'app_user' AND column_name = 'lark_id'`,
    );
    const appColumnsPresent = c[0]?.n !== '0';
    const { rows: applied } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${JOURNAL_SCHEMA}.${JOURNAL_TABLE}`,
    );
    const hasEntries = applied[0]?.n !== '0';
    if (!force && hasEntries && !appColumnsPresent && process.env.RENDER) {
      // a deploy must never guess the journal is stale — a renamed column would re-run everything
      console.error(
        'app_user.lark_id missing but the journal says applied — check why (a legacy reload is setupdata/load_supabase.sh)',
      );
      process.exit(1);
    }
    if (force || (hasEntries && !appColumnsPresent)) {
      // after drizzle/0006 (ADR 0008 decision 12) the tables are rebuilt: re-running the migrations over them cannot
      // work — a converted database is rebuilt instead (a legacy reload wipes first, so it never gets here)
      const { rows: pk } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'job' AND column_name = 'pk'`,
      );
      if (pk[0]?.n !== '0') {
        console.error('REFUSED: แปลงแล้ว (drizzle/0006): สร้างฐานใหม่ — db-wipe + migrate (scripts/db-wipe.sql)');
        process.exit(1);
      }
      if (prod) {
        console.error(`${PROD_RESET} (app_user.lark_id missing but the journal says applied — check why)`);
        process.exit(1);
      }
      console.log(
        force
          ? '--reset: clearing the migration journal, all migrations will re-run'
          : 'legacy tables were reloaded since the last migrate — re-running all migrations',
      );
      await pool.query(`DELETE FROM ${JOURNAL_SCHEMA}.${JOURNAL_TABLE}`);
    }
  }

  console.log(`migrating ${url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@')}`);
  await migrate(db, {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: JOURNAL_SCHEMA,
    migrationsTable: JOURNAL_TABLE,
  });

  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${JOURNAL_SCHEMA}.${JOURNAL_TABLE}`,
  );
  console.log(`done — ${rows[0]?.n ?? '?'} migration(s) recorded`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
