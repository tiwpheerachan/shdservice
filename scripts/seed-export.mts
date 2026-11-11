/**
 * npm run db:seed:export — what the new system set up that a reload of the legacy dump does not carry, written as
 * one SQL file (../setupdata/seed.sql, outside the repo: it holds people's e-mails and phones) that the load
 * applies after the migration (setupdata/load_supabase.sh, npm run db:dev:load):
 *
 *   โปรไฟล์ผู้ออกเอกสาร / บริษัทขนส่ง   the live rows, same ids (logos stay in the bucket under the stored path); a
 *                                      profile only a migration adds (0004 หัวใบเบิกสินค้า) stays
 *   ผู้ใช้ระบบ                          every user who has signed in to the new app (last_login set), matched by
 *                                      e-mail: a legacy row keeps its pk (its old jobs stay theirs) and takes the
 *                                      new app's role / status / name / SSO profile; a person new to the app is added
 *   สิทธิ์ตามบทบาท                      role_permission as set on the permissions page (a role only the dump has stays)
 *   สถานะบทสอน                         who has seen / turned off the tutorials
 *
 * keys: every row has `pk` (bigint identity, what relations point at) and `id` (uuid, what the API shows).
 *   The source must be at drizzle/0006 or later (it has `pk`), and so must the target (the seed is applied after
 *   db:migrate). A legacy row the dump brings back has the same pk and id at every load already (pk = the legacy
 *   key, id = the migration's uuid_v7_stable): a legacy user matched by e-mail, a (role, menu) both sides have and a
 *   courier matched by code keep the TARGET's pk and id. A row only the new app has takes the SOURCE's id, and its
 *   pk when that is free (OVERRIDING SYSTEM VALUE). Profiles are made by the migration (now() time, so a new id at
 *   every load) → the source's id replaces it, by pk (document) or code (courier).
 *
 *   npm run db:seed:export [-- <out file>]                          production: DATABASE_URL in .env.prod.local
 *   SEED_FROM=<postgres url> npm run db:seed:export [-- <out file>] any other database (a local copy, a scratch DB)
 *
 * Reads only: one READ ONLY transaction (the pooler drops startup options, so it is set per transaction). Never reads
 * .env (`next dev` loads that one) — production comes from .env.prod.local, checked to be the production project.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { dbSsl } from '../src/db/ssl';
import { PROD_ENV_FILE, prodUrl } from './db-prod-migrate.mts';

const url =
  process.env.SEED_FROM || (existsSync(PROD_ENV_FILE) ? prodUrl(readFileSync(PROD_ENV_FILE, 'utf8')) : undefined);
if (!url) throw new Error(`no source: set SEED_FROM, or put production's DATABASE_URL in ${PROD_ENV_FILE}`);
const out = process.argv[2] ?? '../setupdata/seed.sql';

const db = new Client({ connectionString: url, ssl: dbSsl(url) });
await db.connect();
await db.query('BEGIN TRANSACTION READ ONLY');
const json = async (q: string): Promise<{ json: string; n: number }> => {
  // q selects one column, r: the row as JSON
  const { rows } = await db.query<{ j: string; n: number }>(`SELECT coalesce(json_agg(t.r), '[]')::text AS j,
    count(*)::int AS n FROM (${q}) t`);
  return { json: rows[0]!.j, n: rows[0]!.n };
};
// drizzle/0006 rebuilt every table around `pk` and renamed app_config → role_permission: an older source is the shape
// this file no longer exports
const { rows: v } = await db.query<{ ok: boolean }>(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'role_permission' AND column_name = 'pk') AS ok`);
if (!v[0]!.ok) throw new Error('the source is from before drizzle/0006 (no role_permission.pk) — migrate it first');
const doc = await json('SELECT d AS r FROM document_profile d WHERE deleted_at IS NULL ORDER BY pk');
const ship = await json('SELECT s AS r FROM shipping_profile s WHERE deleted_at IS NULL ORDER BY pk');
const users = await json(`SELECT u AS r FROM app_user u
  WHERE u.last_login IS NOT NULL AND btrim(coalesce(u.email_address, '')) <> '' ORDER BY u.pk`);
const config = await json('SELECT c AS r FROM role_permission c ORDER BY pk');
const tour = await json(`SELECT json_build_object('id', t.id, 'email', u.email_address, 'seen', t.seen, 'off', t.off,
    'updated_at', t.updated_at) AS r
  FROM app_user_tour t JOIN app_user u ON u.pk = t.app_user_pk
  WHERE u.last_login IS NOT NULL AND btrim(coalesce(u.email_address, '')) <> '' ORDER BY t.pk`);
await db.query('COMMIT');
await db.end();
// a source that was just wiped (a load that failed half way, run again) must not overwrite a good seed.sql
if (!doc.n || !users.n) throw new Error(`the source has no document profile / signed-in user — ${out} not overwritten`);

const lit = (s: string) => db.escapeLiteral(s);
const host = url.replace(/^.*@/, '').replace(/\/.*$/, '');
const sql = `-- seed.sql — taken from ${host} on ${new Date().toISOString()} by scripts/seed-export.mts
-- document_profile ${doc.n} · shipping_profile ${ship.n} · app_user ${users.n} · role_permission ${config.n} · app_user_tour ${tour.n}
-- Apply after the legacy load + db:migrate (same schema version). Re-runnable: running it again changes nothing.
BEGIN;

CREATE TEMP TABLE s_doc ON COMMIT DROP AS SELECT * FROM json_populate_recordset(NULL::document_profile, ${lit(doc.json)});
CREATE TEMP TABLE s_ship ON COMMIT DROP AS SELECT * FROM json_populate_recordset(NULL::shipping_profile, ${lit(ship.json)});
CREATE TEMP TABLE s_user ON COMMIT DROP AS SELECT * FROM json_populate_recordset(NULL::app_user, ${lit(users.json)});
CREATE TEMP TABLE s_config ON COMMIT DROP AS SELECT * FROM json_populate_recordset(NULL::role_permission, ${lit(config.json)});
CREATE TEMP TABLE s_tour ON COMMIT DROP AS
  SELECT * FROM json_to_recordset(${lit(tour.json)}) AS x(id uuid, email text, seen text[], off boolean, updated_at timestamptz);

-- ผู้ออกเอกสาร: the source's live rows by pk (the migration's built-in SHD / IPA take the source's id and values); a
-- profile only the migration adds stays. A live target row whose code the source gives another pk is retired first
-- (soft delete — jobs / quotations / sale orders point at it), and the one default is the source's.
UPDATE document_profile p SET deleted_at = now()
 WHERE p.deleted_at IS NULL AND p.pk NOT IN (SELECT pk FROM s_doc) AND p.code IN (SELECT code FROM s_doc);
UPDATE document_profile SET is_default = false WHERE is_default AND EXISTS (SELECT 1 FROM s_doc WHERE is_default);
-- a code moves between rows (swapped on the source): the matched rows let go of theirs first (code is UNIQUE among live rows)
UPDATE document_profile p SET code = '~' || p.pk FROM s_doc s WHERE p.pk = s.pk AND p.code <> s.code;
UPDATE document_profile p SET id = s.id, code = s.code, name_th = s.name_th, name_en = s.name_en,
       address_line1 = s.address_line1, address_line2 = s.address_line2, phone = s.phone, email = s.email,
       tax_id = s.tax_id, bank_name = s.bank_name, bank_account_type = s.bank_account_type,
       bank_account_no = s.bank_account_no, bank_account_name = s.bank_account_name, logo_path = s.logo_path,
       stamp_path = s.stamp_path, prefix_job = s.prefix_job, prefix_quotation = s.prefix_quotation,
       prefix_sale_order = s.prefix_sale_order, is_default = s.is_default, is_active = s.is_active,
       sort_order = s.sort_order, created_at = s.created_at, updated_at = s.updated_at, deleted_at = NULL,
       deleted_by_app_user_pk = NULL, purpose = s.purpose
  FROM s_doc s
 WHERE p.pk = s.pk;
INSERT INTO document_profile (pk, id, code, name_th, name_en, address_line1, address_line2, phone, email, tax_id,
                              bank_name, bank_account_type, bank_account_no, bank_account_name, logo_path, stamp_path,
                              prefix_job, prefix_quotation, prefix_sale_order, is_default, is_active, sort_order,
                              created_at, updated_at, purpose)
OVERRIDING SYSTEM VALUE
SELECT pk, id, code, name_th, name_en, address_line1, address_line2, phone, email, tax_id, bank_name, bank_account_type,
       bank_account_no, bank_account_name, logo_path, stamp_path, prefix_job, prefix_quotation, prefix_sale_order,
       is_default, is_active, sort_order, created_at, updated_at, purpose
  FROM s_doc s
 WHERE NOT EXISTS (SELECT 1 FROM document_profile p WHERE p.pk = s.pk);
SELECT setval(pg_get_serial_sequence('document_profile', 'pk'), (SELECT max(pk) FROM document_profile));
-- บริษัทขนส่ง: the source's live profiles by code (names, logo, link, order, id); a courier the migration added that the
-- source does not have stays (drizzle/0001), and so do its other names when the source has none (taken before 0001).
-- A courier only the source has: the source's pk when it is free here
UPDATE shipping_profile p SET name_th = s.name_th, name_en = s.name_en, logo_path = s.logo_path, track_url = s.track_url,
       is_active = s.is_active, sort_order = s.sort_order, created_at = s.created_at, updated_at = s.updated_at, id = s.id,
       aliases = CASE WHEN coalesce(s.aliases, '') <> '' THEN s.aliases ELSE p.aliases END
  FROM s_ship s
 WHERE p.code = s.code AND p.deleted_at IS NULL;
-- a taken pk gets a new one past every pk on both sides (never a source pk inserted beside it)
SELECT setval(pg_get_serial_sequence('shipping_profile', 'pk'),
              GREATEST((SELECT max(pk) FROM shipping_profile), (SELECT max(pk) FROM s_ship)));
INSERT INTO shipping_profile (pk, id, code, name_th, name_en, logo_path, track_url, is_active, sort_order, aliases,
                              created_at, updated_at)
OVERRIDING SYSTEM VALUE
SELECT CASE WHEN EXISTS (SELECT 1 FROM shipping_profile p WHERE p.pk = s.pk) THEN nextval(pg_get_serial_sequence('shipping_profile', 'pk'))
            ELSE s.pk END,
       s.id, s.code, s.name_th, s.name_en, s.logo_path, s.track_url, s.is_active, s.sort_order, coalesce(s.aliases, ''),
       s.created_at, s.updated_at
  FROM s_ship s
 WHERE NOT EXISTS (SELECT 1 FROM shipping_profile p WHERE p.code = s.code AND p.deleted_at IS NULL);
SELECT setval(pg_get_serial_sequence('shipping_profile', 'pk'), (SELECT max(pk) FROM shipping_profile));

-- ผู้ใช้: the legacy row (same e-mail) keeps its pk and id, and takes the new app's values
UPDATE app_user u SET user_type = s.user_type, record_status = s.record_status, first_name = s.first_name, last_name = s.last_name, phone_no = s.phone_no,
       lark_id = s.lark_id, department = s.department, title = s.title, avatar = s.avatar, last_login = s.last_login,
       session_version = s.session_version -- a cookie signed out (logout) on the source stays dead
  FROM s_user s
 WHERE lower(btrim(u.email_address)) = lower(btrim(s.email_address));
-- a person only the new app knows: added with the source's id (and pk when free); a login name may repeat (drizzle/0006
-- dropped ix_username_and_password — sign-in finds the account by e-mail)
SELECT setval(pg_get_serial_sequence('app_user', 'pk'), GREATEST((SELECT max(pk) FROM app_user), (SELECT max(pk) FROM s_user)));
INSERT INTO app_user (pk, id, username, first_name, last_name, user_type, record_status, phone_no, email_address, lark_id,
                      department, title, avatar, last_login, session_version)
OVERRIDING SYSTEM VALUE
SELECT CASE WHEN EXISTS (SELECT 1 FROM app_user x WHERE x.pk = s.pk) THEN nextval(pg_get_serial_sequence('app_user', 'pk'))
            ELSE s.pk END,
       s.id,
       s.username, s.first_name, s.last_name, s.user_type, s.record_status, s.phone_no, lower(btrim(s.email_address)),
       s.lark_id, s.department, s.title, s.avatar, s.last_login, s.session_version
  FROM s_user s
 WHERE NOT EXISTS (SELECT 1 FROM app_user u WHERE lower(btrim(u.email_address)) = lower(btrim(s.email_address)));
SELECT setval(pg_get_serial_sequence('app_user', 'pk'), (SELECT max(pk) FROM app_user));

-- สิทธิ์ตามบทบาท: the source's value for every (role, menu) it has; a (role, menu) the target has keeps its pk and id
INSERT INTO role_permission (id, user_type, module_name, can_insert, can_edit, can_delete, can_view)
SELECT id, user_type, module_name, can_insert, can_edit, can_delete, can_view FROM s_config
ON CONFLICT (user_type, module_name) DO UPDATE
   SET can_insert = excluded.can_insert, can_edit = excluded.can_edit,
       can_delete = excluded.can_delete, can_view = excluded.can_view;

-- บทสอน (the target has a row only when this seed ran before: it keeps its id)
INSERT INTO app_user_tour (id, app_user_pk, seen, off, updated_at)
SELECT s.id, u.pk, s.seen, s.off, s.updated_at
  FROM s_tour s JOIN app_user u ON lower(btrim(u.email_address)) = lower(btrim(s.email))
ON CONFLICT (app_user_pk) DO UPDATE SET seen = excluded.seen, off = excluded.off, updated_at = excluded.updated_at;

-- a legacy row of someone who signs in through SSO (bell → belle.kridsawan …) goes INACTIVE — drizzle/0002; their SSO
-- rows have only just arrived above
SELECT merge_legacy_users();

COMMIT;
`;
writeFileSync(out, sql);
console.log(
  `${out}: document_profile ${doc.n}, shipping_profile ${ship.n}, app_user ${users.n}, role_permission ${config.n}, app_user_tour ${tour.n}`,
);
