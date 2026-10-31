import { sql } from 'drizzle-orm';
import { bigint, uuid } from 'drizzle-orm/pg-core';

/** every table's internal key (ADR 0008): first column, bigint identity ALWAYS — never leaves the server */
export const pkCol = () => bigint('pk', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();

/** a relation to another table's `pk` (`<role>_<table>_pk`, FK ON DELETE RESTRICT) — TS stays `number` */
export const pkRef = (name: string) => bigint(name, { mode: 'number' });

/** every table's external id (ADR 0008): second column, uuid v7 minted by the database, unique */
export const uuidId = () =>
  uuid('id')
    .notNull()
    .default(sql`uuid_generate_v7()`);
