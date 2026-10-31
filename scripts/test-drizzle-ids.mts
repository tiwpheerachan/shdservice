/**
 * No DB: every drizzle pgTable starts with `pk` (bigint identity ALWAYS, the primary key) then `id` (uuid).
 * `tsx scripts/test-drizzle-ids.mts`
 */
import assert from 'node:assert/strict';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import * as mod from '../src/db/schema/index.ts';

// tsx loads src/ as CommonJS: the exports sit on `default`
const schema: object = (mod as { default?: object }).default ?? mod;
const tables = Object.values(schema).filter((t): t is PgTable => is(t, PgTable));
for (const t of tables) {
  const { name, columns } = getTableConfig(t);
  const [pk, id] = columns;
  assert.equal(pk?.name, 'pk', `${name}: column 1 is pk`);
  assert.equal(pk.getSQLType(), 'bigint', `${name}.pk is bigint`);
  assert.ok(pk.primary, `${name}.pk is the primary key`);
  assert.equal(pk.generatedIdentity?.type, 'always', `${name}.pk is identity ALWAYS`);
  assert.equal(id?.name, 'id', `${name}: column 2 is id`);
  assert.equal(id.getSQLType(), 'uuid', `${name}.id is uuid`);
  assert.ok(id.notNull, `${name}.id is NOT NULL`);
  for (const c of columns.slice(1)) assert.ok(!c.primary, `${name}.${c.name}: only pk is the primary key`);
}
assert.ok(tables.length >= 66, `${tables.length} tables`);
console.log(`drizzle ids: ${tables.length} tables ok`);
