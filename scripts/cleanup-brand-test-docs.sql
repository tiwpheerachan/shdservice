-- cleanup-brand-test-docs.sql — remove the 2026-09-18 TEST documents that were
-- issued with per-brand prefixes (HJ… / HQ… / HSO…) before numbering went back to
-- one J / Q / SO series (drizzle/0010). Run in Supabase SQL Editor.
-- HARD DELETE by decision (2026-09-22). Run the SELECTs first and check what is listed.

-- ---- 1. what is there ---------------------------------------------------
SELECT job_no, job_create_date, customer_detail, document_profile_id FROM job          WHERE job_no NOT LIKE 'J%';
SELECT quotation_no, create_date, reference_job_no, document_profile_id   FROM quotation_hd WHERE quotation_no NOT LIKE 'Q%';
SELECT sale_out_hd_no, document_create_date, customer_name, document_profile_id FROM sale_out_hd WHERE sale_out_hd_no NOT LIKE 'SO%';

-- ---- 2. delete (children first) ------------------------------------------
BEGIN;
-- sale orders
DELETE FROM sale_out_dt WHERE sale_out_hd_no IN (SELECT sale_out_hd_no FROM sale_out_hd WHERE sale_out_hd_no NOT LIKE 'SO%');
DELETE FROM sale_out_hd WHERE sale_out_hd_no NOT LIKE 'SO%';
-- quotations
DELETE FROM quotation_dt WHERE quotation_no IN (SELECT quotation_no FROM quotation_hd WHERE quotation_no NOT LIKE 'Q%');
DELETE FROM quotation_hd WHERE quotation_no NOT LIKE 'Q%';
-- jobs (+ everything hanging off a job number)
DELETE FROM job_order_spare_part_log WHERE job_no IN (SELECT job_no FROM job WHERE job_no NOT LIKE 'J%');
DELETE FROM job_send_forward_dt      WHERE job_no IN (SELECT job_no FROM job WHERE job_no NOT LIKE 'J%');
DELETE FROM job_symptom              WHERE job_no IN (SELECT job_no FROM job WHERE job_no NOT LIKE 'J%');
DELETE FROM job_call_log             WHERE job_no IN (SELECT job_no FROM job WHERE job_no NOT LIKE 'J%');
DELETE FROM job_log                  WHERE job_no IN (SELECT job_no FROM job WHERE job_no NOT LIKE 'J%');
DELETE FROM document_attach          WHERE reference_topic = 'Jobs' AND reference_item_code IN (SELECT job_no FROM job WHERE job_no NOT LIKE 'J%');
DELETE FROM job WHERE job_no NOT LIKE 'J%';
COMMIT;

-- audit_log rows about them are append-only and stay (that is the point of the log).
-- Files under jobs/HJ…/ in the storage bucket, if any, can be removed from the Supabase Storage UI.
