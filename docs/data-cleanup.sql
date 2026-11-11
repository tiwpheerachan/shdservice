-- data-cleanup.sql — PROPOSAL ONLY, not a migration. Nobody has run this. Review the SELECTs on a
-- copy first; every write below is wrapped in BEGIN … ROLLBACK — change to COMMIT only after the
-- business has signed off on the preview.
--
-- Context (2026-10-15): the customer form now rejects phones that are not "digits / spaces / - / + /
-- ( ) , . and ≥ 9 digits" (src/lib/validation/customer.ts). Of the legacy customers 256 failed; 104 of
-- them only because of invisible characters / en–em dashes, which the app now strips on test and save
-- (normalizePhone). The remaining ~152 hold text in phone_number (names, notes, an address, "Tel.",
-- dates) or too few digits ("0", "111"). Until fixed, editing such a customer forces the user to
-- correct the phone first.
--
-- Where does the text go? customer has no remark/note column. fax_number varchar(50) is the only free
-- text column the app never writes (always '') nor shows, and it is empty in every row — so it can hold
-- the original phone text without a schema change. It is NOT visible in the app: if the notes must be
-- seen, the product decision is a real column instead (ALTER TABLE customer ADD COLUMN remark text +
-- show it on the customer form) and the same UPDATE writes there.

-- 1. Preview: rows that still fail after normalisation (Postgres version of the JS rule; NBSP = the
--    non-breaking space JS treats as whitespace). Expect ≈152 rows.
WITH c AS (
  SELECT customer_code, customer_name, phone_number,
         btrim(translate(regexp_replace(coalesce(phone_number, ''),
                                        E'[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]', '', 'g'),
                         E'\u2013\u2014\u00A0', '-- '), E' \t\r\n\u2028\u2029') AS p
  FROM customer
  WHERE record_status <> 'DELETED'
)
SELECT customer_code, customer_name, phone_number,
       substring(p FROM '0[0-9][0-9 -]{6,}[0-9]') AS proposed_phone -- first Thai-looking number in the text
FROM c
WHERE p <> ''
  AND (p !~ E'^[0-9 \t\r\n+/(),.-]+$' OR length(regexp_replace(p, '\D', '', 'g')) < 9)
ORDER BY customer_code;

-- 2. Proposed fix: keep the original text in fax_number, keep only the number in phone_number (empty
--    when the text has no usable number — an existing customer may stay without a phone).
BEGIN;
WITH c AS (
  SELECT customer_code,
         btrim(translate(regexp_replace(coalesce(phone_number, ''),
                                        E'[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]', '', 'g'),
                         E'\u2013\u2014\u00A0', '-- '), E' \t\r\n\u2028\u2029') AS p
  FROM customer
  WHERE record_status <> 'DELETED'
)
UPDATE customer AS t
SET fax_number   = left(t.phone_number, 50),
    phone_number = coalesce(substring(c.p FROM '0[0-9][0-9 -]{6,}[0-9]'), '')
FROM c
WHERE t.customer_code = c.customer_code
  AND c.p <> ''
  AND (c.p !~ E'^[0-9 \t\r\n+/(),.-]+$' OR length(regexp_replace(c.p, '\D', '', 'g')) < 9)
  AND coalesce(t.fax_number, '') = '';   -- never overwrite something already there
-- check: SELECT customer_code, fax_number, phone_number FROM customer WHERE fax_number <> '' ORDER BY 1;
ROLLBACK; -- COMMIT after review

-- 3. Tax ids: 7 customers have a fragment of the name / address in customer_card_id (not a 13-digit id):
--    C04544 'ถ.จรัญสนิทวงศ์', C12617 ')', C13801 'ุ', C27368 'ศิริกิจวัฒนสกุล', C28386 'คถ', C28996 '์',
--    C30626 'ู'. None is a recoverable id. Proposal: blank them (C04544 / C27368 look like address /
--    surname text — check with the shop whether it belongs in the address or name first).
-- BEGIN;
-- UPDATE customer SET customer_card_id = ''
-- WHERE customer_code IN ('C04544', 'C12617', 'C13801', 'C27368', 'C28386', 'C28996', 'C30626')
--   AND customer_card_id !~ '^[0-9 -]*$';
-- ROLLBACK; -- COMMIT after review

-- =====================================================================================================
-- Field formats — products / customers (agent P, 2026-10-15). PROPOSAL ONLY, not run. Counts are from
-- the dev DB copy of real data. The app already lets every UNCHANGED legacy value save ("never worse"),
-- so none of this blocks anyone — it only makes the data searchable and the codes usable.
-- =====================================================================================================

-- 4. รหัสอะไหล่ (ผู้ผลิต) product.product_vender_code — owner decision: one code of A-Z 0-9 . _ / - ,
--    upper-case, no Thai / spaces / commas, no "CANCEL_" prefix (src/lib/validation/admin.ts MFG_CODE_RE).
--    474 of 2,551 filled codes fail today:
--      75  "Cancel_…"   (a cancelled product kept its code with a prefix — 32 of the previewed rows
--                        would then equal another product's code: column same_code_on in 4a; the app
--                        only warns on a duplicate vendor code, it does not block it)
--      21  "-"          (= no code)
--     244  code = product name (a name typed into the code box)
--       8  start with a Thai vowel / tone mark (stray key before the code)
--     134  the rest: 124 Thai text, 5 "code , code" pairs, 5 other (spaces: "AirStyle Pro0001", "海帕T-HPU61")
-- 4a. Preview: what each automatic fix would write
SELECT product_code, product_vender_code AS now,
       CASE
         WHEN btrim(product_vender_code) = '-' THEN ''
         WHEN upper(btrim(product_vender_code)) = upper(btrim(product_name)) THEN ''
         ELSE upper(btrim(regexp_replace(regexp_replace(product_vender_code, '^[Cc][Aa][Nn][Cc][Ee][Ll]_', ''),
                                         E'^[ัิ-ฺ็-๎]+', '')))
       END AS proposed,
       (SELECT string_agg(o.product_code, ', ') FROM product o
         WHERE o.product_id <> p.product_id
           AND upper(btrim(o.product_vender_code)) =
               upper(btrim(regexp_replace(p.product_vender_code, '^[Cc][Aa][Nn][Cc][Ee][Ll]_', '')))) AS same_code_on
FROM product p
WHERE product_vender_code ~* '^cancel_'
   OR btrim(product_vender_code) = '-'
   OR upper(btrim(product_vender_code)) = upper(btrim(product_name))
   OR product_vender_code ~ E'^[ัิ-ฺ็-๎]'
ORDER BY product_code;

-- 4b. Apply the automatic part (≈ 75 + 21 + 244 + 8 rows)
BEGIN;
UPDATE product SET product_vender_code = '' WHERE btrim(product_vender_code) = '-';
UPDATE product SET product_vender_code = '' WHERE upper(btrim(product_vender_code)) = upper(btrim(product_name));
UPDATE product
SET product_vender_code = upper(btrim(regexp_replace(product_vender_code, E'^[ัิ-ฺ็-๎]+', '')))
WHERE product_vender_code ~ E'^[ัิ-ฺ็-๎]';
UPDATE product SET product_vender_code = upper(btrim(substr(product_vender_code, 8)))
WHERE product_vender_code ~* '^cancel_';
-- check: what still fails
-- SELECT count(*) FROM product WHERE coalesce(product_vender_code, '') <> ''
--   AND upper(btrim(product_vender_code)) !~ '^(?!CANCEL_)[A-Z0-9][A-Z0-9._/-]{0,49}$';
ROLLBACK; -- COMMIT after review

-- 4c. The rest (~134) need a person: a list for the stock team (put the real part number in, or blank it
--     and keep the text in the product name / description).
SELECT product_code, product_name, product_vender_code
FROM product
WHERE coalesce(product_vender_code, '') <> ''
  AND upper(btrim(product_vender_code)) !~ '^(?!CANCEL_)[A-Z0-9][A-Z0-9._/-]{0,49}$'
  AND product_vender_code !~* '^cancel_' AND btrim(product_vender_code) <> '-'
  AND upper(btrim(product_vender_code)) <> upper(btrim(product_name))
ORDER BY (product_vender_code ~ ','), product_code;

-- 5. Customer names / addresses: invisible characters (zero-width, bidi marks, BOM) and non-breaking
--    spaces — 1,995 names and 3,720 address rows — and runs of 2+ spaces (787 names, 776 of them with nothing
--    else wrong, so the character test alone left them). They look right and never match a search. The app now
--    writes clean() values on save; this cleans the rows nobody edits.
SELECT count(*) FILTER (WHERE customer_name ~ E'[​-‏‪-‮⁠﻿ ]' OR customer_name ~ ' {2,}') AS names,
       count(*) FILTER (WHERE customer_address1 ~ E'[​-‏‪-‮⁠﻿ ]'
                           OR customer_address2 ~ E'[​-‏‪-‮⁠﻿ ]'
                           OR customer_address ~ E'[​-‏‪-‮⁠﻿ ]'
                           OR customer_address1 ~ ' {2,}' OR customer_address2 ~ ' {2,}'
                           OR customer_address ~ ' {2,}') AS addresses
FROM customer;
BEGIN;
UPDATE customer
SET customer_name     = btrim(regexp_replace(regexp_replace(customer_name, E'[​-‏‪-‮⁠﻿]', '', 'g'), E'[\\s ]+', ' ', 'g')),
    customer_address  = btrim(regexp_replace(regexp_replace(customer_address, E'[​-‏‪-‮⁠﻿]', '', 'g'), E'[\\s ]+', ' ', 'g')),
    customer_address1 = btrim(regexp_replace(regexp_replace(customer_address1, E'[​-‏‪-‮⁠﻿]', '', 'g'), E'[\\s ]+', ' ', 'g')),
    customer_address2 = btrim(regexp_replace(regexp_replace(customer_address2, E'[​-‏‪-‮⁠﻿]', '', 'g'), E'[\\s ]+', ' ', 'g'))
WHERE customer_name ~ E'[​-‏‪-‮⁠﻿ ]'
   OR customer_address ~ E'[​-‏‪-‮⁠﻿ ]'
   OR customer_address1 ~ E'[​-‏‪-‮⁠﻿ ]'
   OR customer_address2 ~ E'[​-‏‪-‮⁠﻿ ]'
   OR customer_name ~ ' {2,}'
   OR customer_address ~ ' {2,}'
   OR customer_address1 ~ ' {2,}'
   OR customer_address2 ~ ' {2,}';
ROLLBACK; -- COMMIT after review

-- 6. Tax ids: 8 are not 13 digits — the 7 in section 3 plus C00602 '-' (= none → ''). All 10 that ARE
--    13 digits pass the mod-11 check digit the form now checks.
-- BEGIN;
-- UPDATE customer SET customer_card_id = '' WHERE customer_code = 'C00602' AND btrim(customer_card_id) = '-';
-- ROLLBACK; -- COMMIT after review

-- 7. Emails: stored lower-case and trimmed (the uniqueness check compares that way) — 1 row (C15931).
BEGIN;
UPDATE customer SET email = lower(btrim(email)) WHERE coalesce(email, '') <> '' AND email <> lower(btrim(email));
ROLLBACK; -- COMMIT after review
