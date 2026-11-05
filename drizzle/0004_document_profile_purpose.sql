-- 0004_document_profile_purpose — a document profile is either an issuer ("ออกเอกสารในนาม" of jobs / quotations /
-- sale orders: 'document') or the header of ใบเบิกสินค้า ('pick_slip', owner 2026-10-29: the legacy pick slip prints
-- "บริษัท อินเตอร์เนชั่นเนลเพอร์เฟคอัลไลแอนซ์ จำกัด"). Issuer lists and choosers take 'document' only, so the
-- forms stay as they were. The IPA profile is added with its name only (address / tax id / logo editable on the
-- profile page). Idempotent: IPA is added only while no row (live or deleted) has that code.
ALTER TABLE document_profile ADD COLUMN IF NOT EXISTS purpose varchar(20) NOT NULL DEFAULT 'document';

INSERT INTO document_profile (code, name_th, prefix_job, prefix_quotation, prefix_sale_order, is_default, is_active, sort_order, purpose)
SELECT 'IPA', 'บริษัท อินเตอร์เนชั่นเนลเพอร์เฟคอัลไลแอนซ์ จำกัด', 'J', 'Q', 'SO', false, true,
       (SELECT coalesce(max(sort_order), 0) + 1 FROM document_profile), 'pick_slip'
WHERE NOT EXISTS (SELECT 1 FROM document_profile WHERE code = 'IPA');
