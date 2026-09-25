-- 0010_profile_no_prefix — "ออกเอกสารในนาม" is a letterhead only (decided 2026-09-22).
-- Document numbers are J / Q / SO + year + ONE running series for the whole
-- company, like the legacy app; a profile never changes the number and can be
-- switched on a document at any time. This undoes the per-brand prefixes of 0007.
-- Idempotent.

-- 1. prefixes are no longer per profile: same value everywhere, no uniqueness
DROP INDEX IF EXISTS ux_document_profile_prefix_job;
DROP INDEX IF EXISTS ux_document_profile_prefix_quot;
DROP INDEX IF EXISTS ux_document_profile_prefix_so;
UPDATE document_profile SET prefix_job = 'J', prefix_quotation = 'Q', prefix_sale_order = 'SO'
 WHERE prefix_job <> 'J' OR prefix_quotation <> 'Q' OR prefix_sale_order <> 'SO';

-- 2. one running series per document type: only the company_id = 1 rows count.
--    Per-brand counter rows created under 0007 (company_id = profile id) are dropped.
DELETE FROM running_no
 WHERE running_type IN ('Job', 'Quotation', 'SaleOrder') AND company_id <> 1;
