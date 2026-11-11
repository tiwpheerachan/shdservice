import { eq, ne, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { nowThai } from '@/server/mappers/format';

/**
 * One soft-delete convention for the whole app: ACTIVE; INACTIVE — kept in lists and pickers with an "Inactive" badge;
 * DELETED — hidden everywhere, restored in SQL only. record_status is the only flag.
 */
export const RS = { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', DELETED: 'DELETED' } as const;
export type RecordStatus = (typeof RS)[keyof typeof RS];

/**
 * What the audit page says about a status change, in words (never a table name): "ลบสี แดง (#27)",
 * "กู้คืนลูกค้า C43759", "ยี่ห้อ Dreame (#3) → Inactive". `cancel` = a sale order's DELETED reads "ยกเลิก".
 */
export function statusSummary(o: {
  noun: string;
  key: string | number;
  name?: string | null;
  old: string | null | undefined;
  rs: string;
  cancel?: boolean;
}): string {
  const what = `${o.noun} ${o.name ? `${o.name} (#${o.key})` : o.key}`;
  if (o.rs === RS.DELETED) return `${o.cancel ? 'ยกเลิก' : 'ลบ'}${what}`;
  if (o.old === RS.DELETED) return `กู้คืน${what}`;
  return `${what} → ${o.rs === RS.ACTIVE ? 'Active' : o.rs === RS.INACTIVE ? 'Inactive' : o.rs}`;
}

export type StatusMode = 'active' | 'exclude' | 'only' | 'all';

export function parseStatusMode(v: string | null | undefined, fallback: StatusMode = 'exclude'): StatusMode {
  return v === 'active' || v === 'exclude' || v === 'only' || v === 'all' ? v : fallback;
}

/** WHERE fragment for a record_status column under the given mode. */
export function statusFilter(col: PgColumn, mode: StatusMode): SQL | undefined {
  switch (mode) {
    case 'active':
      return eq(col, RS.ACTIVE);
    case 'exclude':
      return ne(col, RS.DELETED);
    case 'only':
      return eq(col, RS.DELETED);
    default:
      return undefined;
  }
}

/** UI "Active" / "Inactive" label ("Inactive" also covers DELETED rows in the trash view). */
export const uiStatus = (rs: string | null | undefined): 'Active' | 'Inactive' =>
  rs === RS.ACTIVE || rs == null ? 'Active' : 'Inactive';

/** UI status select ("Active" | "Inactive") → record_status. */
export const fromUiStatus = (s: string | null | undefined): RecordStatus =>
  (s ?? 'Active').trim().toLowerCase() === 'inactive' ? RS.INACTIVE : RS.ACTIVE;

/** Columns to set on every status change. */
export function statusStamp(status: RecordStatus, byUserPk: number) {
  return {
    recordStatus: status,
    statusChangedAt: nowThai(),
    statusChangedByAppUserPk: byUserPk > 0 ? byUserPk : null, // no actor = NULL (FK)
  };
}
