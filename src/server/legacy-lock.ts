import 'server-only';
import { db } from '@/db/client';
import { legacyBoundary } from '@/db/schema';
import { cached, TTL_STATIC } from '@/server/cache';
import { HttpError } from '@/server/http-error';
import { markDenied, requestCtx } from '@/server/request-context';

/**
 * Owner rule 2026-10-30: the money / quantity figures of a row that came from the legacy system (pk <= its table's
 * legacy_boundary.max_pk, written by drizzle/0006) are never changed by anyone but System Admin — never recomputed.
 * The boundary never changes after a load, so it is read once an hour.
 */
const boundaries = () =>
  cached('legacy_boundary', TTL_STATIC, async () =>
    Object.fromEntries((await db.select().from(legacyBoundary)).map((b) => [b.tableName, b.maxPk])),
  );

/** the row came from the legacy system */
export async function isLegacyRow(table: string, pk: number): Promise<boolean> {
  const max = (await boundaries())[table];
  return max !== undefined && pk <= max;
}

/** refuse a change to a legacy row's money / quantity fields unless the user is System Admin */
export async function assertFiguresEditable(user: { isAdmin: boolean }, table: string, pk: number): Promise<void> {
  if (!user.isAdmin && (await isLegacyRow(table, pk))) {
    const reason = 'ตัวเลขเงิน / จำนวนของข้อมูลจากระบบเก่าแก้ได้เฉพาะ System Admin';
    // logged like a permission refusal (security_log DENIED, the record named) once the request ends
    markDenied({
      reason,
      permission: 'legacy figures',
      role: requestCtx()?.user?.userType ?? null,
      at: 'legacy',
      entity: table,
      pk,
    });
    throw new HttpError(403, reason);
  }
}
