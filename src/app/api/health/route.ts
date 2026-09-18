import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { ownerEmails } from "@/lib/access";
import { userFromRequest } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      await db.execute(sql`select 1`);
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
    const users = await db.execute(sql`select count(*)::int as n, count(*) filter (where user_type is null or trim(user_type) = '')::int as pending from app_user`);
    const cols = await db.execute(sql`select count(*)::int as n from information_schema.columns where table_name = 'app_user' and column_name = 'lark_id'`);
    const mig = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`).catch(() => ({ rows: [{ n: 0 }] }));
    const row = users.rows[0] as { n: number; pending: number };
    out.db = "ok";
    out.dbLatencyMs = Date.now() - t0;
    out.appUsers = row.n;
    out.pendingUsers = row.pending;
    out.appColumnsPresent = (cols.rows[0] as { n: number }).n > 0;
    out.migrationsRecorded = (mig.rows[0] as { n: number }).n;
  } catch (e) {
    out.db = "error";
    out.dbError = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  }
  return NextResponse.json(out, { status: out.db === "ok" ? 200 : 503 });
}
