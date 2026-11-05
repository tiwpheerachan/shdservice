-- 0005_uuid7_ids — ADR 0008 phase 1: every public table gets `id uuid NOT NULL DEFAULT uuid_generate_v7()` with a
-- unique index — the id that will leave the database (the API switches to it next; phase 2 adds `pk bigint` first
-- column, `<table>_pk` foreign keys and recreates the tables).
--
-- 1. uuid_generate_v7(ts) — copied verbatim from OneLink (drizzle/0027): the default of every id column.
--    uuid_v7_stable(ts, seed) — the same layout without randomness: 48-bit Unix ms of ts, then the first bytes of
--    sha256(seed), version 7 and variant 10 set. Same input → same uuid.
-- 2. Ten tables already had an integer `id` (app_back_up_db_log, audit_log, color, document_profile, job_close_temp,
--    job_create_temp, job_send_forward_dt, shipping_profile, temp_model, track_event): it is renamed `pk`, phase 2's
--    name. Its PK / identity / serial sequence / indexes follow the rename; no function, trigger or view of this
--    schema names it (audit_log_readonly() raises without reading the row; view_customer reads customer only), and
--    drizzle/0000's two statements that do (the setval of the identity sequences, the SHD profile) read whichever of
--    id / pk is there, so a re-run (--reset) over converted tables still works.
-- 3. Rows that exist when this runs get a STABLE id: the legacy dump is reloaded (wipe → dump → migrate → seed) until
--    cutover and this file runs after every load, so the same legacy row must get the same id every time:
--      time = the row's creation time (the column listed below, `timestamp` columns read as Asia/Bangkok wall clock
--             like the rest of the legacy data); no such column, or NULL → 2023-01-01 (before the first legacy row)
--      seed = '<table>/' || the row's legacy key: its primary key as text (job → job_no, a composite key →
--             ROW(a, b)::text). temp_model / temp_spare_part have no primary key (and no unique column the dump
--             guarantees): their key is the whole row as text + '#' + its number among identical rows, unique by
--             construction (two identical rows are interchangeable, so which gets #1 does not matter); a row edited in
--             the legacy system between two dumps gets a new id there — both tables are unused leftovers.
--    Rows inserted afterwards take the random default. A table that already has `id uuid` is skipped: a re-run never
--    touches ids handed out since. The backfill is a table rewrite (ALTER COLUMN … TYPE uuid USING, which may read
--    the row's other columns), not an UPDATE: no trigger fires (audit_log is append-only; job / quotation_hd /
--    sale_out_hd / customer would bump row_version), legacy rows that break a NOT VALID check (inventory_dt …) are
--    not checked again, and no dead rows are left. Only the two tables without a key take an UPDATE (a window
--    function cannot be in USING; they have no trigger or check). The unique index is built after the backfill.

CREATE OR REPLACE FUNCTION uuid_generate_v7(ts timestamptz DEFAULT clock_timestamp())
RETURNS uuid
LANGUAGE sql
VOLATILE
AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(int8send((extract(epoch FROM ts) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid
$$;

COMMENT ON FUNCTION uuid_generate_v7(timestamptz) IS
  'UUIDv7 (RFC 9562): Unix milliseconds of ts, then randomness. Default for every id column. Replace with the built-in uuidv7() once on Postgres 18.';

CREATE OR REPLACE FUNCTION uuid_v7_stable(ts timestamptz, seed text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT encode(set_byte(set_byte(b, 6, (get_byte(b, 6) & 15) | 112), 8, (get_byte(b, 8) & 63) | 128), 'hex')::uuid
    FROM (SELECT overlay(substring(sha256(convert_to(seed, 'UTF8')) FROM 1 FOR 16)
                 PLACING substring(int8send((extract(epoch FROM ts) * 1000)::bigint) FROM 3)
                 FROM 1 FOR 6) AS b) x
$$;

COMMENT ON FUNCTION uuid_v7_stable(timestamptz, text) IS
  'UUIDv7 layout with the 74 random bits taken from sha256(seed): the same (ts, seed) always gives the same uuid. Backfills ids of rows a legacy reload brings back (drizzle/0005).';

DO $$
DECLARE
  t record;
  keys text[];
  key text;
  ts text;
BEGIN
  FOR t IN
    SELECT b.table_name AS name, c.column_name AS created, c.data_type AS created_type
      FROM information_schema.tables b
      LEFT JOIN (VALUES
        ('app_back_up_db_log', 'back_up_date'), ('audit_log', 'at'), ('customer', 'created_date'),
        ('document_profile', 'created_at'), ('idempotency_key', 'created_at'), ('inventory_hd', 'create_date'),
        ('job', 'job_create_date'), ('job_call_log', 'call_log_date'), ('job_log', 'job_log_date'),
        ('job_order_spare_part_log', 'request_date'), ('job_return_hd', 'create_date'), ('product', 'create_date'),
        ('product_serial', 'create_date'), ('quotation_hd', 'create_date'), ('sale_out_hd', 'document_create_date'),
        ('shipping_profile', 'created_at'), ('track_doc_ticket', 'created_at'), ('track_event', 'at'),
        ('track_otp', 'created_at'), ('track_session', 'created_at'), ('track_ticket', 'created_at')
      ) AS v(table_name, column_name) USING (table_name)
      LEFT JOIN information_schema.columns c
        ON c.table_schema = 'public' AND c.table_name = b.table_name AND c.column_name = v.column_name
     WHERE b.table_schema = 'public' AND b.table_type = 'BASE TABLE'
     ORDER BY 1
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = t.name AND column_name = 'id' AND data_type <> 'uuid') THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN id TO pk', t.name);
    END IF;
    CONTINUE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema = 'public' AND table_name = t.name AND column_name = 'id');

    ts := CASE WHEN t.created IS NULL THEN NULL
               WHEN t.created_type = 'timestamp with time zone' THEN format('%I', t.created)
               ELSE format('%I AT TIME ZONE ''Asia/Bangkok''', t.created) END;
    ts := format('coalesce(%s, timestamptz ''2023-01-01 00:00:00+07'')', coalesce(ts, 'NULL'));
    SELECT array_agg(quote_ident(a.attname) ORDER BY k.n) INTO keys
      FROM pg_index i
      CROSS JOIN unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, n)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE i.indrelid = format('public.%I', t.name)::regclass AND i.indisprimary;
    key := CASE WHEN keys IS NULL THEN NULL
                WHEN cardinality(keys) = 1 THEN keys[1] || '::text'
                ELSE 'ROW(' || array_to_string(keys, ', ') || ')::text' END;

    EXECUTE format('ALTER TABLE %I ADD COLUMN id uuid', t.name);
    IF key IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN id TYPE uuid USING uuid_v7_stable(%s, %L || %s)',
                     t.name, ts, t.name || '/', key);
    ELSE
      EXECUTE format(
        'UPDATE %1$I SET id = uuid_v7_stable(%2$s, %3$L || s.k)
           FROM (SELECT ctid AS c, r::text || ''#'' || row_number() OVER (PARTITION BY r::text) AS k FROM %1$I r) s
          WHERE %1$I.ctid = s.c',
        t.name, ts, t.name || '/');
    END IF;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN id SET DEFAULT uuid_generate_v7(), ALTER COLUMN id SET NOT NULL', t.name);
    EXECUTE format('CREATE UNIQUE INDEX %I ON %I (id)', 'ux_' || t.name || '_id', t.name);
  END LOOP;
END $$;
