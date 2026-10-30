import { boolean, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { pkCol, pkRef, uuidId } from './id';

/** the บทสอน each user has been offered (drizzle/0039) — `seen` = page paths answered, `off` = never ask */
export const appUserTour = pgTable(
  'app_user_tour',
  {
    pk: pkCol(),
    id: uuidId(),
    /** UNIQUE — one row per user (the upsert target); FK RESTRICT since drizzle/0006 (was CASCADE) */
    appUserPk: pkRef('app_user_pk').notNull(),
    seen: text('seen').array().notNull().default([]),
    off: boolean('off').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ux_app_user_tour_app_user_pk').on(t.appUserPk)],
);
