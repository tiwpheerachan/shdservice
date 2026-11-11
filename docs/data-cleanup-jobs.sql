-- Data cleanup PROPOSAL for the jobs area (field-format rules, 2026-10-15) — NOT run.
-- Counts are from the dev DB copy of the real data. Review, then run each block in a transaction on a
-- copy first. The app already treats every value below correctly (an unchanged legacy value still
-- saves); this only makes search / reports / the "ข้อมูลไม่ครบ" notice see clean data.
-- Leading Thai marks: U+0E31, U+0E34–U+0E3A, U+0E47–U+0E4E (same set as clean() in src/lib/validation).

BEGIN;

-- 1. Symptom names with a trailing space / newline (10 rows) — the job form matches them trimmed already
UPDATE symptom SET symptom_name = btrim(symptom_name, E' \t\r\n')
 WHERE symptom_name <> btrim(symptom_name, E' \t\r\n');

-- 2. Five duplicate symptom pairs (same name ignoring case/space): keep the first id, re-point every use
--    of the second, then soft-delete it. (keep ← drop): 37 ← 76, 119 ← 168, 45 ← 63, 183 ← 184, 128 ← 297
CREATE TEMP TABLE symptom_merge (keep_id int, drop_id int) ON COMMIT DROP;
INSERT INTO symptom_merge VALUES (37, 76), (119, 168), (45, 63), (183, 184), (128, 297);
-- job_symptom PK is (job_no, symptom_id): drop the rows that would collide, move the rest
DELETE FROM job_symptom js USING symptom_merge m
 WHERE js.symptom_id = m.drop_id
   AND EXISTS (SELECT 1 FROM job_symptom k WHERE k.job_no = js.job_no AND k.symptom_id = m.keep_id);
UPDATE job_symptom js SET symptom_id = m.keep_id FROM symptom_merge m WHERE js.symptom_id = m.drop_id;
UPDATE job j SET product_symptom_id = m.keep_id FROM symptom_merge m WHERE j.product_symptom_id = m.drop_id;
UPDATE job j SET engineer_symptom_id = m.keep_id FROM symptom_merge m WHERE j.engineer_symptom_id = m.drop_id;
UPDATE symptom s SET record_status = 'DELETED', is_active = false, status_changed_at = now()
  FROM symptom_merge m WHERE s.symptom_id = m.drop_id;

-- 3. Manufacturer names with trailing spaces (10 rows)
UPDATE manufacturer SET manufacturer_name = btrim(manufacturer_name, E' \t\r\n')
 WHERE manufacturer_name <> btrim(manufacturer_name, E' \t\r\n');

-- 4. Greek / Cyrillic look-alikes in the customer's parcel number ("ED006390635ΤΗ") — 126 rows
UPDATE job SET job_reception_tracking_no = translate(job_reception_tracking_no,
         'ΑΒΕΗΙΚΜΝΟΡΤΧΥΖАВЕКМНОРСТХ', 'ABEHIKMNOPTXYZABEKMHOPCTX')
 WHERE job_reception_tracking_no ~ '[ΑΒΕΗΙΚΜΝΟΡΤΧΥΖАВЕКМНОРСТХ]';

-- 5. "0" / "-" written for "no parcel number" → empty (902 reception + 16 return rows).
--    Serial "0" / "-" (6,420) are NOT touched: "-" is the "ไม่มี S/N / S/N เสียหาย" marker the form now
--    stores (NO_SERIAL), "0" keeps counting as empty.
UPDATE job SET job_reception_tracking_no = '' WHERE btrim(job_reception_tracking_no) IN ('0', '-');
UPDATE job SET return_customer_tracking_no = '' WHERE btrim(return_customer_tracking_no) IN ('0', '-');

-- 6. IMEI that is not 15 digits (27 rows: "0", "-", notes) → empty — list them first:
--    SELECT job_no, product_imei_no FROM job
--     WHERE coalesce(btrim(product_imei_no), '') <> '' AND btrim(product_imei_no) !~ '^[0-9]{15}$';
UPDATE job SET product_imei_no = ''
 WHERE coalesce(btrim(product_imei_no), '') <> '' AND btrim(product_imei_no) !~ '^[0-9]{15}$';

-- 7. A Thai mark typed before the text (shows as a dotted circle) — รุ่นย่อย 612, Shop Name 54
UPDATE job SET product_model_detail = regexp_replace(product_model_detail, '^[ัิ-ฺ็-๎]+', '')
 WHERE product_model_detail ~ '^[ัิ-ฺ็-๎]';
UPDATE job SET product_sale_out_shop_name = regexp_replace(product_sale_out_shop_name, '^[ัิ-ฺ็-๎]+', '')
 WHERE product_sale_out_shop_name ~ '^[ัิ-ฺ็-๎]';

ROLLBACK; -- change to COMMIT once the counts above match
