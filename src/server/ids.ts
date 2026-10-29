import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { db, type Db, type Tx } from '@/db/client';
import { HttpError } from './http-error';

/**
 * uuid → row (ADR 0008 phase 1). The API speaks only the uuid `id`; joins and foreign keys still use the
 * legacy integer / text keys until phase 2 makes `pk` the key. The uuid comes from the contract's
 * `uuid()` / `byUuid()` (src/server/contract/common.ts) — already checked and lower-cased.
 * Not found → 404 `ไม่พบ<what>` (`what` = 'งาน', 'ผู้ใช้', 'โปรไฟล์' …), the same answer byUuid gives a non-uuid.
 * ponytail: phase-1 bridge, a lookup per id — phase 2 drops pkOf / pksOf once FKs are on `pk`.
 */

type WithId = PgTable & { id: PgColumn };
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

/** the internal key (`key`, a column of `table`: user_id, job_no …) of the row whose uuid is `id` */
export async function pkOf<T extends WithId, K extends PgColumn>(
  table: T,
  key: K,
  id: string,
  what: string,
  q: Reader = db,
): Promise<NonNullable<K['_']['data']>> {
  const [row] = await q
    .select({ k: key })
    .from(table as PgTable)
    .where(eq(table.id, id))
    .limit(1);
  if (row?.k == null) throw notFound(what);
  return row.k as NonNullable<K['_']['data']>;
}

/** pkOf for a list: uuid → key for every id (duplicates read once); any id without a row → 404 */
export async function pksOf<T extends WithId, K extends PgColumn>(
  table: T,
  key: K,
  ids: readonly string[],
  what: string,
  q: Reader = db,
): Promise<Map<string, NonNullable<K['_']['data']>>> {
  const want = [...new Set(ids)];
  if (!want.length) return new Map();
  const rows = await q
    .select({ id: table.id, k: key })
    .from(table as PgTable)
    .where(inArray(table.id, want));
  const map = new Map(rows.filter((r) => r.k != null).map((r) => [String(r.id), r.k as NonNullable<K['_']['data']>]));
  if (map.size < want.length) throw notFound(what);
  return map;
}
