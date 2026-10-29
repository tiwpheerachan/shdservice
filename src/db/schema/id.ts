import { sql } from 'drizzle-orm';
import { uuid } from 'drizzle-orm/pg-core';

/** every table's external id (ADR 0008, drizzle/0005): uuid v7 minted by the database, unique */
export const uuidId = () =>
  uuid('id')
    .notNull()
    .default(sql`uuid_generate_v7()`);
