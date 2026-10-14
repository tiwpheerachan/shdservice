import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { logError } from "@/lib/log";

/**
 * SERVER-ONLY database handle (drizzle over node-postgres).
 *
 * DATABASE_URL is the plain Postgres connection string — for Supabase use the
 * *Session pooler* (port 5432). It is never sent to the browser: this module
 * imports "server-only", so bundling it into a client component fails the build.
 *
 * All timestamps in the legacy schema are `timestamp` WITHOUT time zone holding
 * Thai wall-clock time. We keep that convention: the pool sets the session time
 * zone to Asia/Bangkok so `now()` / `current_date` produce Thai local values.
 */
const globalForDb = globalThis as unknown as { __shdPool?: Pool };

/** Supabase project ref of PRODUCTION (render.yaml) — `next dev` must not write to it by accident. */
const PROD_DB_REF = "izypdfhjbqctbopxhrqq";

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured on the server");
  if (process.env.NODE_ENV === "development" && url.includes(PROD_DB_REF) && process.env.ALLOW_PROD_DB !== "1")
    throw new Error("DATABASE_URL points at the PRODUCTION database from a dev server — set ALLOW_PROD_DB=1 if you really mean it");
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    // Supabase pooler needs TLS; local docker does not.
    ssl: /supabase\.co|supabase\.com|pooler/.test(url) ? { rejectUnauthorized: false } : undefined,
    // fail fast instead of queueing forever when the pool/pooler is saturated,
    // and stop a runaway query before it holds a connection for minutes
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    options: "-c TimeZone=Asia/Bangkok -c statement_timeout=30000",
  });
  // An idle client dropped by the pooler emits 'error' on the pool; unhandled, it kills the process.
  pool.on("error", (e) => logError(e, "db idle client error"));
  return pool;
}

// Reuse across Next.js dev hot reloads to avoid exhausting connections.
export const pool = globalForDb.__shdPool ?? (globalForDb.__shdPool = createPool());

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
