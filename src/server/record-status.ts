import { eq, ne, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { nowThai } from '@/server/mappers/format';

/**
 * One soft-delete convention for the whole app (drizzle/0003_record_status.sql):
 *   ACTIVE   — normal
 *   INACTIVE — kept in lists and pickers with an "Inactive" badge (a picked one shows a warning)
 *   DELETED  — hidden everywhere; restore is done in SQL only (by decision)
 * The legacy flags (is_active / document_status / app_user.deleted) are written
 * alongside so the old reports stay consistent.
 */
export const RS = { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', DELETED: 'DELETED' } as const;
export type RecordStatus = (typeof RS)[keyof typeof RS];

/** How a list should treat statuses. */
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

/** Columns to set on every status change (+ legacy is_active mirror when the table has it). */
export function statusStamp(status: RecordStatus, byUserId: number, withIsActive = true) {
  return {
    recordStatus: status,
    statusChangedAt: nowThai(),
    statusChangedBy: byUserId,
    ...(withIsActive ? { isActive: status === RS.ACTIVE } : {}),
  };
}
