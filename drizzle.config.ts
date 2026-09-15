import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Schema lives in src/db/schema; SQL migrations in ./drizzle.
// DATABASE_URL must be the Postgres connection string (Supabase *Session pooler*, port 5432).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
