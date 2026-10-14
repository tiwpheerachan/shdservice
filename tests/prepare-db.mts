/**
 * npm run db:test:prepare — make the throwaway test database look like a fresh Supabase
 * project, then apply every migration. Refuses anything that isn't a local database.
 *   TEST_DATABASE_URL (default postgresql://postgres:test@127.0.0.1:55442/oneservice_test)
 */
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { TEST_DATABASE_URL, assertLocal } from "./db-url.mts";

assertLocal(TEST_DATABASE_URL);
const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
// Supabase ships these; plain Postgres (docker, CI) does not — 0012 uses gen_random_bytes()
await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
await pool.end();
execFileSync("npx", ["tsx", "scripts/migrate.ts"], { stdio: "inherit", env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } });
