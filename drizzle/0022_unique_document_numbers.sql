-- 0022_unique_document_numbers — a document number can exist only once.
--
-- The last safety net under src/db/running-no.ts (advisory lock per series): if two
-- inserts ever got the same number, the second now fails (409 "ข้อมูลซ้ำ") instead of
-- being saved silently. job.job_no is already the primary key.
--
-- Legacy data might hold duplicates (none in the dev copy, 2026-10-14). Each index is
-- created only when its column has none; otherwise a NOTICE names it in the deploy log
-- (scripts/migrate.ts prints notices) and the deploy goes on. db:migrate will NOT run this
-- file again (it is journaled): clean the duplicates, then run it by hand with `psql -f`.
-- Idempotent (the legacy tables can be reloaded and every migration re-run).

DO $$
DECLARE
  t record;
  dup boolean;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('ux_quotation_hd_no',    'quotation_hd', 'quotation_no'),
    ('ux_sale_out_hd_no',     'sale_out_hd',  'sale_out_hd_no'),
    ('ux_inventory_hd_no',    'inventory_hd', 'inventory_no')
  ) AS v(idx, tbl, col)
  LOOP
    IF to_regclass(t.idx) IS NOT NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE %I IS NOT NULL GROUP BY %I HAVING count(*) > 1)', t.tbl, t.col, t.col) INTO dup;
    IF dup THEN
      RAISE NOTICE '0022: % has duplicate %, unique index % NOT created', t.tbl, t.col, t.idx;
    ELSE
      EXECUTE format('CREATE UNIQUE INDEX %I ON %I (%I) WHERE %I IS NOT NULL', t.idx, t.tbl, t.col, t.col);
    END IF;
  END LOOP;
END $$;
