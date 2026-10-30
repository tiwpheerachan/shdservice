import { NextResponse, type NextRequest } from 'next/server';
import { and, count, eq, isNull, or, sql } from 'drizzle-orm';
import { pgSchema, varchar } from 'drizzle-orm/pg-core';
import { db } from '@/db/client';
import { appUser } from '@/db/schema';
import { ownerEmails } from '@/lib/access';
import { userFromRequest, checked } from '@/server/auth';
import { logError, scrubText } from '@/lib/log';
import { maintenanceOn } from '@/lib/maintenance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * Postgres' own catalog + drizzle's migration journal — declared HERE, not in src/db/schema,
 * so drizzle-kit never treats them as tables of the app.
 */
const infoColumns = pgSchema('information_schema').table('columns', {
  tableName: varchar('table_name'),
  columnName: varchar('column_name'),
});
const migrations = pgSchema('drizzle').table('__drizzle_migrations', { hash: varchar('hash') });

/**
 * Deployment health check — no secrets, no personal data. Tells whether the
 * server can reach Postgres, whether the app migrations were applied, and how
 * many app_user rows exist (so a "stuck on /pending" can be diagnosed).
 *
 * Always HTTP 200, with the verdict in the body ({"ok":false}): Render's health check
 * restarts an instance that fails, and restarting the web service does not fix
 * Supabase — it only turns a degraded site into no site (OneLink, same reason).
 * An uptime monitor asserts on the body instead. MAINTENANCE_MODE=1 adds `maintenance: true` (the proxy, which
 * answers every other path 503 then, never sees this one).
 */
export const GET = checked(async (request: NextRequest) => {
  // anonymous callers (uptime checks) get only up/down — config and counts are for System Admin
  const me = await userFromRequest(request).catch(() => null);
  const maint = maintenanceOn() ? { maintenance: true } : {};
  if (!me?.isAdmin) {
    try {
      await db.select({ id: appUser.pk }).from(appUser).limit(1);
      return NextResponse.json({ ok: true, ...maint });
    } catch (e) {
      logError(e, 'health: database unreachable', {}, request);
      return NextResponse.json({ ok: false, ...maint });
    }
  }
  const out: Record<string, unknown> = {
    ...maint,
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    hasCentralApiKey: !!process.env.CENTRAL_API_KEY,
    hasSsoClientSecret: !!process.env.SSO_CLIENT_SECRET,
    ssoClientId: process.env.SSO_CLIENT_ID || '(default)',
    ownerEmailsConfigured: ownerEmails().length,
  };
  try {
    const t0 = Date.now();
    const [users] = await db
      .select({
        n: count(),
        pending:
          sql<number>`count(*) filter (where ${or(isNull(appUser.userType), eq(sql`trim(${appUser.userType})`, ''))})`.mapWith(
            Number,
          ),
      })
      .from(appUser);
    const [cols] = await db
      .select({ n: count() })
      .from(infoColumns)
      .where(and(eq(infoColumns.tableName, 'app_user'), eq(infoColumns.columnName, 'lark_id')));
    const [mig] = await db
      .select({ n: count() })
      .from(migrations)
      .catch(() => [{ n: 0 }]);
    out.db = 'ok';
    out.dbLatencyMs = Date.now() - t0;
    // count() without GROUP BY always returns exactly one row
    out.appUsers = users?.n ?? 0;
    out.pendingUsers = users?.pending ?? 0;
    out.appColumnsPresent = (cols?.n ?? 0) > 0;
    out.migrationsRecorded = mig?.n ?? 0;
    // dates are Thai wall-clock `timestamp` without time zone — both clocks must say Bangkok
    const tz = await db.execute<{ tz: string; now: string }>(
      sql`select current_setting('TimeZone') as tz, to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as now`,
    );
    const row = tz.rows[0];
    out.timezone = {
      db: row?.tz,
      process: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ok: row?.tz === 'Asia/Bangkok' && Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Bangkok',
    };
    out.clockSkewMs = row ? Date.now() - Date.parse(row.now) : null;
  } catch (e) {
    out.db = 'error';
    out.dbError = scrubText(e instanceof Error ? e.message : String(e)).slice(0, 300);
  }
  return NextResponse.json({ ok: out.db === 'ok', ...out });
});
