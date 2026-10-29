import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { uuidId } from './id';

/** the บทสอน each user has been offered (drizzle/0039) — `seen` = page paths answered, `off` = never ask */
export const appUserTour = pgTable('app_user_tour', {
  id: uuidId(),
  userId: integer('user_id').primaryKey(),
  seen: text('seen').array().notNull().default([]),
  off: boolean('off').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
