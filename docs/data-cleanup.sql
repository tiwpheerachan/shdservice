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
