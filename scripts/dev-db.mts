/**
 * npm run db:dev:load — (re)build the LOCAL dev database from the legacy dump in
 * ../setupdata/out (the same files production was loaded from), then apply every
 * migration. Wipes the dev database each time. Never touches anything but the local
 * container (docker-compose.yml, port 55443).
 */
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { spawn } from "node:child_process";

export const DEV_DATABASE_URL = "postgresql://postgres:dev@127.0.0.1:55443/oneservice_dev";
const OUT = "../setupdata/out";
const compose = ["compose", "-f", "docker-compose.yml", "-p", "oneservice-dev"];

for (const f of ["01_schema.sql", "02_data.sql", "03_post.sql"])
  if (!existsSync(`${OUT}/${f}`)) throw new Error(`missing ${OUT}/${f} — run setupdata/convert.py first`);

execFileSync("docker", [...compose, "up", "-d", "--wait"], { stdio: "inherit" });

/** psql inside the container, fed from a file on this machine */
function psqlFile(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("docker", [...compose, "exec", "-T", "db", "psql", "-U", "postgres", "-d", "oneservice_dev", "-v", "ON_ERROR_STOP=1", "-q"], {
      stdio: ["pipe", "ignore", "inherit"],
    });
    createReadStream(file).pipe(p.stdin);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`psql ${file} exited ${code}`))));
  });
}

// Supabase ships pgcrypto; plain Postgres does not (migration 0012 uses gen_random_bytes)
execFileSync("docker", [...compose, "exec", "-T", "db", "psql", "-U", "postgres", "-d", "oneservice_dev", "-qc", "CREATE EXTENSION IF NOT EXISTS pgcrypto"], { stdio: "inherit" });
for (const f of ["01_schema.sql", "02_data.sql", "03_post.sql"]) {
  console.log(`==> ${f}`);
  await psqlFile(`${OUT}/${f}`);
}
execFileSync("npx", ["tsx", "scripts/migrate.ts"], { stdio: "inherit", env: { ...process.env, DATABASE_URL: DEV_DATABASE_URL } });
console.log(`\ndev database ready: ${DEV_DATABASE_URL.replace(/:dev@/, ":***@")}`);
