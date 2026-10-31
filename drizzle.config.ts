import { defineConfig } from 'drizzle-kit';

// Schema lives in src/db/schema; SQL migrations in ./drizzle.
// No env file is loaded (generate needs no database); db:studio needs DATABASE_URL set on the command line.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
