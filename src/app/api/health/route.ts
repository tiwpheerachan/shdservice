import { NextResponse, type NextRequest } from "next/server";
import { and, count, eq, isNull, or, sql } from "drizzle-orm";
import { pgSchema, varchar } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { ownerEmails } from "@/lib/access";
import { userFromRequest } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Postgres' own catalog + drizzle's migration journal — declared HERE, not in src/db/schema,
 * so drizzle-kit never treats them as tables of the app.
 */
const infoColumns = pgSchema("information_schema").table("columns", {
  tableName: varchar("table_name"),
  columnName: varchar("column_name"),
});
const migrations = pgSchema("drizzle").table("__drizzle_migrations", { hash: varchar("hash") });

/**
 * Deployment health check — no secrets, no personal data. Tells whether the
 * server can reach Postgres, whether the app migrations were applied, and how
 * many app_user rows exist (so a "stuck on /pending" can be diagnosed).
 */
export async function GET(request: NextRequest) {
  // anonymous callers (uptime checks) get only up/down — config and counts are for System Admin
  const me = await userFromRequest(request).catch(() => null);
  if (!me?.isAdmin) {
    try {
      await db.select({ id: appUser.userId }).from(appUser).limit(1);
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ ok: false }, { status: 503 });
    }
  }
  const out: Record<string, unknown> = {
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    hasCentralApiKey: !!process.env.CENTRAL_API_KEY,
    hasSsoClientSecret: !!process.env.SSO_CLIENT_SECRET,
    ssoClientId: process.env.SSO_CLIENT_ID || "(default)",
    ownerEmailsConfigured: ownerEmails().length,
  };
  try {
    const t0 = Date.now();
    const [users] = await db
      .select({ n: count(), pending: sql<number>`count(*) filter (where ${or(isNull(appUser.userType), eq(sql`trim(${appUser.userType})`, ""))})`.mapWith(Number) })
      .from(appUser);
    const [cols] = await db
      .select({ n: count() })
      .from(infoColumns)
      .where(and(eq(infoColumns.tableName, "app_user"), eq(infoColumns.columnName, "lark_id")));
    const [mig] = await db.select({ n: count() }).from(migrations).catch(() => [{ n: 0 }]);
    out.db = "ok";
    out.dbLatencyMs = Date.now() - t0;
    out.appUsers = users.n;
    out.pendingUsers = users.pending;
    out.appColumnsPresent = cols.n > 0;
    out.migrationsRecorded = mig.n;
  } catch (e) {
    out.db = "error";
    out.dbError = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  }
  return NextResponse.json(out, { status: out.db === "ok" ? 200 : 503 });
}
