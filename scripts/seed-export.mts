/**
 * npm run db:seed:export — what the new system set up that a reload of the legacy dump does not carry, written as
 * one SQL file (../setupdata/seed.sql, outside the repo: it holds people's e-mails and phones) that the load
 * applies after the migration (setupdata/load_supabase.sh, npm run db:dev:load):
 *
 *   โปรไฟล์ผู้ออกเอกสาร / บริษัทขนส่ง   the live rows, same ids (logos stay in the bucket under the stored path); a
 *                                      profile only a migration adds (0004 หัวใบเบิกสินค้า) stays
 *   ผู้ใช้ระบบ                          every user who has signed in to the new app (last_login set), matched by
 *                                      e-mail: a legacy row keeps its user_id (its old jobs stay theirs) and takes the
 *                                      new app's role / status / name / SSO profile; a person new to the app is added
 *   สิทธิ์ตามบทบาท                      app_config as set on the permissions page (a role only the dump has stays)
 *   สถานะบทสอน                         who has seen / turned off the tutorials
 *
 * ids (uuid, ADR 0008 / drizzle/0005) — the external id a row has had stays with it across reloads:
 *   a row the legacy dump brings back has the same id at every load already (the migration's uuid_v7_stable): a
 *   legacy user matched by e-mail and a (role, menu) both sides have keep the TARGET's id; a user, (role, menu),
 *   profile or tutorial row only the new app has takes the SOURCE's id. Profiles are made by the migration (now()
 *   time, so a new id at every load) → the source's id replaces it, by pk (document) or code (courier).
 *   A source from before 0005 has no uuid ids (its profiles' integer id is exported as `pk`): such a row keeps the
 *   target's id, or gets a new one. The seed is always applied to a migrated database (0005 or later).
 *
 *   SEED_FROM=<postgres url> npm run db:seed:export [-- <out file>]
 *
 * Reads only: one READ ONLY transaction (the pooler drops startup options, so it is set per transaction). The
 * legacy password column is not exported. Never reads .env — the source is named on purpose.
 */
import { writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { dbSsl } from '../src/db/ssl';

const url = process.env.SEED_FROM;
if (!url) throw new Error('set SEED_FROM to the database the seed is taken from');
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
// drizzle/0005 renamed the profiles' integer `id` to `pk` and added `id uuid`: a source from before is exported in that shape
const { rows: v } = await db.query<{ v7: boolean }>(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'document_profile' AND column_name = 'pk') AS v7`);
const profile = (a: string) => (v[0]!.v7 ? a : `to_jsonb(${a}) - 'id' || jsonb_build_object('pk', ${a}.id)`);
const pk = v[0]!.v7 ? 'pk' : 'id';
const doc = await json(`SELECT ${profile('d')} AS r FROM document_profile d WHERE deleted_at IS NULL ORDER BY ${pk}`);
const ship = await json(`SELECT ${profile('s')} AS r FROM shipping_profile s WHERE deleted_at IS NULL ORDER BY ${pk}`);
const users = await json(`SELECT to_jsonb(u) - 'password' AS r FROM app_user u
  WHERE u.last_login IS NOT NULL AND btrim(coalesce(u.email_address, '')) <> '' ORDER BY u.user_id`);
const config = await json('SELECT c AS r FROM app_config c ORDER BY config_id');
const tour =
  await json(`SELECT json_build_object('id', to_jsonb(t) -> 'id', 'email', u.email_address, 'seen', t.seen, 'off', t.off,
    'updated_at', t.updated_at) AS r
  FROM app_user_tour t JOIN app_user u USING (user_id)
  WHERE u.last_login IS NOT NULL AND btrim(coalesce(u.email_address, '')) <> ''`);
await db.query('COMMIT');
await db.end();
// a source that was just wiped (a load that failed half way, run again) must not overwrite a good seed.sql
if (!doc.n || !users.n) throw new Error(`the source has no document profile / signed-in user — ${out} not overwritten`);

const lit = (s: string) => db.escapeLiteral(s);
const host = url.replace(/^.*@/, '').replace(/\/.*$/, '');
const sql = `-- seed.sql — taken from ${host} on ${new Date().toISOString()} by scripts/seed-export.mts
-- document_profile ${doc.n} · shipping_profile ${ship.n} · app_user ${users.n} · app_config ${config.n} · app_user_tour ${tour.n}
-- Apply after the legacy load + db:migrate (same schema version). Re-runnable: running it again changes nothing.
BEGIN;

CREATE TEMP TABLE s_doc ON COMMIT DROP AS SELECT * FROM json_populate_recordset(NULL::document_profile, ${lit(doc.json)});
CREATE TEMP TABLE s_ship ON COMMIT DROP AS SELECT * FROM json_populate_recordset(NULL::shipping_profile, ${lit(ship.json)});
CREATE TEMP TABLE s_user ON COMMIT DROP AS SELECT * FROM json_populate_recordset(NULL::app_user, ${lit(users.json)});
CREATE TEMP TABLE s_config ON COMMIT DROP AS SELECT * FROM json_populate_recordset(NULL::app_config, ${lit(config.json)});
CREATE TEMP TABLE s_tour ON COMMIT DROP AS
  SELECT * FROM json_to_recordset(${lit(tour.json)}) AS x(id uuid, email text, seen text[], off boolean, updated_at timestamptz);

-- ผู้ออกเอกสาร: the source's live rows (the migration's built-in SHD is replaced, same id or code); a profile only the
-- migration adds stays (drizzle/0004's หัวใบเบิกสินค้า IPA, when the source was taken before 0004), and a source
-- without document_profile.purpose (before 0004) is an issuer: 'document'
UPDATE s_doc SET purpose = 'document' WHERE purpose IS NULL;
-- a source from before drizzle/0005 has no uuid: the target's row with that pk keeps its own (a re-run changes nothing)
UPDATE s_doc s SET id = coalesce((SELECT p.id FROM document_profile p WHERE p.pk = s.pk), uuid_generate_v7()) WHERE s.id IS NULL;
DELETE FROM document_profile p WHERE p.pk IN (SELECT pk FROM s_doc) OR p.code IN (SELECT code FROM s_doc);
INSERT INTO document_profile SELECT * FROM s_doc;
SELECT setval(pg_get_serial_sequence('document_profile', 'pk'), GREATEST((SELECT max(pk) FROM document_profile), 1));
-- บริษัทขนส่ง: the source's live profiles by code (names, logo, link, order); a courier the migration added that the
-- source does not have stays (drizzle/0001), and so do its other names when the source has none (taken before 0001)
UPDATE shipping_profile p SET name_th = s.name_th, name_en = s.name_en, logo_path = s.logo_path, track_url = s.track_url,
       is_active = s.is_active, sort_order = s.sort_order, updated_at = s.updated_at, id = coalesce(s.id, p.id),
       aliases = CASE WHEN coalesce(s.aliases, '') <> '' THEN s.aliases ELSE p.aliases END
  FROM s_ship s
 WHERE p.code = s.code AND p.deleted_at IS NULL;
INSERT INTO shipping_profile (id, code, name_th, name_en, logo_path, track_url, is_active, sort_order, aliases, created_at, updated_at)
SELECT coalesce(s.id, uuid_generate_v7()), s.code, s.name_th, s.name_en, s.logo_path, s.track_url, s.is_active, s.sort_order, coalesce(s.aliases, ''),
       s.created_at, s.updated_at
  FROM s_ship s
 WHERE NOT EXISTS (SELECT 1 FROM shipping_profile p WHERE p.code = s.code AND p.deleted_at IS NULL);

-- ผู้ใช้: the legacy row (same e-mail) keeps its user_id and id, and takes the new app's values
UPDATE app_user u SET user_type = s.user_type, record_status = s.record_status, is_active = s.is_active,
       deleted = s.deleted, first_name = s.first_name, last_name = s.last_name, phone_no = s.phone_no,
       lark_id = s.lark_id, department = s.department, title = s.title, avatar = s.avatar, last_login = s.last_login,
       session_version = s.session_version -- a cookie signed out (logout) on the source stays dead
  FROM s_user s
 WHERE lower(btrim(u.email_address)) = lower(btrim(s.email_address));
-- a person only the new app knows: added (a legacy user with the same login name → the name gets a suffix,
-- as provisionSsoUser does), with the source's id
INSERT INTO app_user (id, username, password, first_name, last_name, user_type, is_active, record_status, phone_no,
                      email_address, lark_id, department, title, avatar, last_login, deleted, session_version)
SELECT coalesce(s.id, uuid_generate_v7()),
       CASE WHEN EXISTS (SELECT 1 FROM app_user x WHERE x.username = s.username AND x.password = '')
            THEN left(s.username, 44) || '.' || left(md5(s.email_address), 4) ELSE s.username END,
       '', s.first_name, s.last_name, s.user_type, s.is_active, s.record_status, s.phone_no,
       lower(btrim(s.email_address)), s.lark_id, s.department, s.title, s.avatar, s.last_login, s.deleted, s.session_version
  FROM s_user s
 WHERE NOT EXISTS (SELECT 1 FROM app_user u WHERE lower(btrim(u.email_address)) = lower(btrim(s.email_address)));

-- สิทธิ์ตามบทบาท: the source's value for every (role, menu) it has; a (role, menu) the target has keeps its id
INSERT INTO app_config (id, user_type, module_name, can_insert, can_edit, can_delete, can_view)
SELECT coalesce(id, uuid_generate_v7()), user_type, module_name, can_insert, can_edit, can_delete, can_view FROM s_config
ON CONFLICT (user_type, module_name) DO UPDATE
   SET can_insert = excluded.can_insert, can_edit = excluded.can_edit,
       can_delete = excluded.can_delete, can_view = excluded.can_view;

-- บทสอน (the target has a row only when this seed ran before: it keeps its id)
INSERT INTO app_user_tour (id, user_id, seen, off, updated_at)
SELECT coalesce(s.id, uuid_generate_v7()), u.user_id, s.seen, s.off, s.updated_at
  FROM s_tour s JOIN app_user u ON lower(btrim(u.email_address)) = lower(btrim(s.email))
ON CONFLICT (user_id) DO UPDATE SET seen = excluded.seen, off = excluded.off, updated_at = excluded.updated_at;

-- a legacy row of someone who signs in through SSO (bell → belle.kridsawan …) goes INACTIVE — drizzle/0002; their SSO
-- rows have only just arrived above
SELECT merge_legacy_users();

COMMIT;
`;
writeFileSync(out, sql);
console.log(
  `${out}: document_profile ${doc.n}, shipping_profile ${ship.n}, app_user ${users.n}, app_config ${config.n}, app_user_tour ${tour.n}`,
);
