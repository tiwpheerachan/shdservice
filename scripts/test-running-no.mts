/**
 * npm run test:running-no — concurrent document numbers never repeat, including the
 * first document of a new year (no row for the year yet).
 * Runs against the local test database (npm run db:test:up && npm run db:test:prepare).
 */
import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/db/schema/index.ts";
import { nextRunningNo } from "../src/db/running-no.ts";
import { TEST_DATABASE_URL as url, assertLocal } from "../tests/db-url.mts";

assertLocal(url);
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
  // simulate New Year: only last year's row exists (nothing for this year, nothing for Inventory-In)
  await pool.query("DELETE FROM running_no WHERE running_type IN ('Quotation', 'Inventory-In')");
  await pool.query("INSERT INTO running_no (running_type, company_id, branch_id, prefix, pyear, pmonth, pday, number, length_year, length_month, length_number) VALUES ('Quotation', 1, 0, 'Q', 2000, 0, 0, 500, 2, 0, 5)");
  await burst("Quotation"); // yearly, current year's row missing
  await burst("Quotation"); // row exists now
  await burst("Inventory-In"); // no row at all
  console.log("\npassed");
} finally {
  await pool.end();
}
