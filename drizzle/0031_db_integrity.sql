-- 0031_db_integrity — the database itself refuses what the services already refuse
-- (docs/production-readiness.md "โครงสร้าง DB", audit 2026-10-16: DB-3, DB-4, DB-5).
--
-- 1. Document numbers: 0022's partial unique indexes (WHERE no IS NOT NULL) cannot back a foreign key;
--    a plain unique index means the same (NULLs never collide) and can. Swapped only when 0022 created it.
-- 2. Foreign keys on relations every service writes with a real row. Left out on purpose: columns the
--    code fills with a "none" sentinel (customer.city/district/sub_district_id = -1, job.product_model_id
--    = 0, job.engineer_id = -1, audit_log.user_id = 0) and text keys that may hold ''.
--    Each FK is added NOT VALID (checks new writes only), then VALIDATEd when the existing rows pass;
--    otherwise a NOTICE counts the orphans and old rows stay as they are. Parents are soft-deleted
--    (adr/0002), so no FK ever blocks a delete the app makes.
-- 3. CHECKs on stock counts and prices: added only where no existing row breaks them (a NOT VALID check
--    would still refuse any UPDATE of a breaking row, e.g. a price edit on a product whose stock is already
--    negative) — otherwise a NOTICE. Exception: inventory_dt, which the app never updates (a movement is
--    written once) — there a NOT VALID check is safe and still guards every new line.
--    No check on quantity_remain: legacy rows hold negative on-hand numbers (5 on 2026-10-16) and
--    stock.ts adjustQty(allowNegative) still changes their bookings — fix the counts first (data cleanup).
-- 4. quotation_dt money/quantity: varchar → numeric, when every value parses (commas stripped:
--    '1,500.00'); otherwise a NOTICE and the column stays text. Readers already go through num().
-- 5. mt_sub_district.city_id: index under its FK.
--
-- scripts/migrate.ts prints NOTICEs in the deploy log. Idempotent (the legacy tables can be reloaded and
-- every migration re-run): each step checks what is already there.

-- 1 ---------------------------------------------------------------------------------------------------
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('ux_quotation_hd_no', 'quotation_hd', 'quotation_no'),
    ('ux_sale_out_hd_no',  'sale_out_hd',  'sale_out_hd_no'),
    ('ux_inventory_hd_no', 'inventory_hd', 'inventory_no')
  ) AS v(idx, tbl, col)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass(t.idx) AND indpred IS NOT NULL) THEN
      EXECUTE format('DROP INDEX %I', t.idx);
      EXECUTE format('CREATE UNIQUE INDEX %I ON %I (%I)', t.idx, t.tbl, t.col);
    END IF;
  END LOOP;
END $$;

-- 2 ---------------------------------------------------------------------------------------------------
DO $$
DECLARE
  t record;
  orphans bigint;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('fk_job_customer',            'job',                      'customer_id',      'customer',     'customer_id'),
    ('fk_job_job_type',            'job',                      'job_type_id',      'job_type',     'job_type_id'),
    ('fk_job_job_status',          'job',                      'job_status_id',    'job_status',   'job_status_id'),
    ('fk_job_log_job',             'job_log',                  'job_no',           'job',          'job_no'),
    ('fk_job_spare_part_log_job',  'job_order_spare_part_log', 'job_no',           'job',          'job_no'),
    ('fk_sale_out_hd_customer',    'sale_out_hd',              'customer_id',      'customer',     'customer_id'),
    ('fk_sale_out_dt_hd',          'sale_out_dt',              'sale_out_hd_no',   'sale_out_hd',  'sale_out_hd_no'),
    ('fk_sale_out_dt_product',     'sale_out_dt',              'product_id',       'product',      'product_id'),
    ('fk_quotation_dt_hd',         'quotation_dt',             'quotation_no',     'quotation_hd', 'quotation_no'),
    ('fk_inventory_dt_hd',         'inventory_dt',             'inventory_no',     'inventory_hd', 'inventory_no'),
    ('fk_inventory_dt_location',   'inventory_dt',             'store_location_id','store_location','store_location_id'),
    ('fk_inventory_hd_type',       'inventory_hd',             'inventory_type_id','inventory_type','inventory_type_id'),
    ('fk_product_manufacturer',    'product',                  'manufacturer_id',  'manufacturer', 'manufacturer_id')
  ) AS v(name, tbl, col, ref, refcol)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t.name AND conrelid = t.tbl::regclass) THEN
      CONTINUE;
    END IF;
    -- the parent key must be unique (1. may have skipped a table with duplicate numbers)
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
       WHERE i.indrelid = t.ref::regclass AND i.indisunique AND i.indnkeyatts = 1 AND i.indpred IS NULL
         AND i.indexprs IS NULL AND a.attname = t.refcol
    ) THEN
      RAISE NOTICE '0031: %.% is not unique, % NOT created', t.ref, t.refcol, t.name;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I (%I) NOT VALID',
                   t.tbl, t.name, t.col, t.ref, t.refcol);
    EXECUTE format('SELECT count(*) FROM %I c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I r WHERE r.%I = c.%I)',
                   t.tbl, t.col, t.ref, t.refcol, t.col) INTO orphans;
    IF orphans = 0 THEN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', t.tbl, t.name);
    ELSE
      RAISE NOTICE '0031: % — % rows of %.% point at no %, FK checks new writes only (NOT VALID)',
                   t.name, orphans, t.tbl, t.col, t.ref;
    END IF;
  END LOOP;
END $$;

-- 3 ---------------------------------------------------------------------------------------------------
DO $$
DECLARE
  t record;
  bad bigint;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('ck_stock_available', 'product_none_serial', 'quantity_available >= 0', false),
    ('ck_stock_booking',   'product_none_serial', 'quantity_booking >= 0', false),
    ('ck_stock_prices',    'product_none_serial', 'capital_price >= 0 AND wholesale_price >= 0 AND retail_price >= 0', false),
    ('ck_inventory_dt_qty','inventory_dt',        'item_quantity >= 0', true)  -- sign comes from the document type
  ) AS v(name, tbl, expr, write_once)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t.name AND conrelid = t.tbl::regclass) THEN
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM %I WHERE NOT (%s)', t.tbl, t.expr) INTO bad;
    IF bad = 0 THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', t.tbl, t.name, t.expr);
    ELSIF t.write_once THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID', t.tbl, t.name, t.expr);
      RAISE NOTICE '0031: % — % old rows of % break (%), CHECK guards new rows only (NOT VALID)', t.name, bad, t.tbl, t.expr;
    ELSE
      RAISE NOTICE '0031: % — % rows of % break (%), CHECK NOT created', t.name, bad, t.tbl, t.expr;
    END IF;
  END LOOP;
END $$;

-- 4 ---------------------------------------------------------------------------------------------------
DO $$
DECLARE
  t record;
  bad bigint;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('quantity',                    'numeric(12,2)'),
    ('unit_price',                  'numeric(18,2)'),
    ('unit_price_discount',         'numeric(18,2)'),
    ('unit_price_discount_percent', 'numeric(18,2)'),
    ('total_price',                 'numeric(18,2)')
  ) AS v(col, typ)
  LOOP
    IF (SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'quotation_dt' AND column_name = t.col) <> 'character varying' THEN
      CONTINUE;
    END IF;
    EXECUTE format($q$SELECT count(*) FROM quotation_dt
                       WHERE nullif(btrim(%1$I), '') IS NOT NULL
                         AND replace(btrim(%1$I), ',', '') !~ '^-?[0-9]{1,14}(\.[0-9]{1,2})?$'$q$, t.col) INTO bad;
    IF bad = 0 THEN
      EXECUTE format($q$ALTER TABLE quotation_dt ALTER COLUMN %1$I TYPE %2$s
                         USING nullif(replace(btrim(%1$I), ',', ''), '')::%2$s$q$, t.col, t.typ);
    ELSE
      RAISE NOTICE '0031: quotation_dt.% has % values that are not numbers, stays varchar', t.col, bad;
    END IF;
  END LOOP;
END $$;

-- 5 ---------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_mt_sub_district_city ON mt_sub_district (city_id);
