/**
 * npm run test:running-no — concurrent document numbers never repeat, including the
 * first document of a new year (no row for the year yet).
 * Needs a THROWAWAY local Postgres with the running_no table:
 *   TEST_DATABASE_URL=postgresql://postgres:t@127.0.0.1:55499/postgres npm run test:running-no
 */
import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/db/schema/index.ts";
import { nextRunningNo } from "../src/db/running-no.ts";

const url = process.env.TEST_DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("TEST_DATABASE_URL must point at a local throwaway database");
  process.exit(1);
}
const pool = new Pool({ connectionString: url, max: 25, options: "-c TimeZone=Asia/Bangkok" });
const db = drizzle(pool, { schema });
const N = 20;

async function burst(type: "Quotation" | "Inventory-In") {
  const nos = await Promise.all(Array.from({ length: N }, () => db.transaction((tx) => nextRunningNo(tx as never, type))));
  const unique = new Set(nos);
  console.log(`  ${type}: ${unique.size}/${N} unique (${[...unique].sort()[0]} … ${[...unique].sort().at(-1)})`);
  assert.equal(unique.size, N, `duplicate numbers: ${nos.sort().join(", ")}`);
}

try {
  await pool.query("DELETE FROM running_no WHERE pyear <> 2568"); // simulate New Year: only last year's row exists
  await burst("Quotation"); // yearly, current year's row missing
  await burst("Quotation"); // row exists now
  await burst("Inventory-In"); // no row at all
  console.log("\npassed");
} finally {
  await pool.end();
}
