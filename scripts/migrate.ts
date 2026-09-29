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
 *  - `--reset` forces that behaviour.
 */
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const MIGRATIONS_FOLDER = "./drizzle";
const JOURNAL_SCHEMA = "drizzle";
const JOURNAL_TABLE = "__drizzle_migrations";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (use the Supabase *Session pooler*, port 5432).");
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: url,
    max: 1,
    ssl: /supabase\.co|supabase\.com|pooler/.test(url) ? { rejectUnauthorized: false } : undefined,
    options: "-c TimeZone=Asia/Bangkok",
  });
  const db = drizzle(pool);

  const force = process.argv.includes("--reset");
  const { rows: j } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = $2`,
    [JOURNAL_SCHEMA, JOURNAL_TABLE]
  );
  const journalExists = j[0]?.n !== "0";
  if (journalExists) {
    const { rows: c } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'app_user' AND column_name = 'lark_id'`
    );
    const appColumnsPresent = c[0]?.n !== "0";
    const { rows: applied } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${JOURNAL_SCHEMA}.${JOURNAL_TABLE}`
    );
    const hasEntries = applied[0]?.n !== "0";
    if (force || (hasEntries && !appColumnsPresent)) {
      console.log(
        force
          ? "--reset: clearing the migration journal, all migrations will re-run"
          : "legacy tables were reloaded since the last migrate — re-running all migrations"
      );
      await pool.query(`DELETE FROM ${JOURNAL_SCHEMA}.${JOURNAL_TABLE}`);
    }
  }

  console.log(`migrating ${url.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@")}`);
  await migrate(db, {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: JOURNAL_SCHEMA,
    migrationsTable: JOURNAL_TABLE,
  });

  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${JOURNAL_SCHEMA}.${JOURNAL_TABLE}`
  );
  console.log(`done — ${rows[0]?.n ?? "?"} migration(s) recorded`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
