import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { db, type Db, type Tx } from '@/db/client';
import { HttpError } from './http-error';

/**
 * uuid → row / pk (ADR 0008). The API speaks only the uuid `id`; joins and foreign keys use the bigint
 * `pk` (phase 2, drizzle/0006). The uuid comes from the contract's `uuid()` / `byUuid()`
 * (src/server/contract/common.ts) — already checked and lower-cased.
 * Not found → 404 `ไม่พบ<what>` (`what` = 'งาน', 'ผู้ใช้', 'โปรไฟล์' …), the same answer byUuid gives a non-uuid.
 */

type WithId = PgTable & { pk: PgColumn; id: PgColumn };
type Reader = Db | Tx;

const notFound = (what: string) => new HttpError(404, `ไม่พบ${what}`);

/** the whole row whose uuid is `id` */
export async function rowByUuid<T extends WithId>(
  table: T,
  id: string,
  what: string,
  q: Reader = db,
): Promise<T['$inferSelect']> {
  const [row] = await q
    .select()
    .from(table as PgTable)
    .where(eq(table.id, id))
    .limit(1);
  if (!row) throw notFound(what);
  return row as T['$inferSelect'];
}

/** the `pk` of the row whose uuid is `id` */
export async function pkOf(table: WithId, id: string, what: string, q: Reader = db): Promise<number> {
  const [row] = await q
    .select({ pk: table.pk })
    .from(table as PgTable)
    .where(eq(table.id, id))
    .limit(1);
  if (row?.pk == null) throw notFound(what);
  return Number(row.pk);
}

/** pkOf for a list: uuid → pk for every id (duplicates read once); any id without a row → 404 */
export async function pksOf(
  table: WithId,
  ids: readonly string[],
  what: string,
  q: Reader = db,
): Promise<Map<string, number>> {
  const want = [...new Set(ids)];
  if (!want.length) return new Map();
  const rows = await q
    .select({ id: table.id, pk: table.pk })
    .from(table as PgTable)
    .where(inArray(table.id, want));
  const map = new Map(rows.map((r) => [String(r.id), Number(r.pk)]));
  if (map.size < want.length) throw notFound(what);
  return map;
}
