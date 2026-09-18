-- 0007_document_profile — "ออกเอกสารในนาม": several issuing companies/brands
-- (SHD, HASHTAG, Rabbit, TOP ONE, PTC …) with their own logo, address, tax id,
-- bank account and document-number prefixes. Each quotation / sale order / job
-- remembers the profile it was issued under (document_profile_id); old rows are
-- NULL = SHD (id 1). Running numbers are kept per profile through the legacy
-- running_no.company_id (= profile id). Agreed 2026-09-18. Idempotent.
CREATE TABLE IF NOT EXISTS document_profile (
    id                  serial        PRIMARY KEY,
    code                varchar(20)   NOT NULL UNIQUE,          -- short key shown in dropdowns, e.g. SHD
    name_th             varchar(200)  NOT NULL,
    name_en             varchar(200)  NOT NULL DEFAULT '',
    address_line1       varchar(200)  NOT NULL DEFAULT '',
    address_line2       varchar(200)  NOT NULL DEFAULT '',
    phone               varchar(50)   NOT NULL DEFAULT '',
    email               varchar(100)  NOT NULL DEFAULT '',
    tax_id              varchar(20)   NOT NULL DEFAULT '',
    bank_name           varchar(100)  NOT NULL DEFAULT '',
    bank_account_type   varchar(50)   NOT NULL DEFAULT '',
    bank_account_no     varchar(50)   NOT NULL DEFAULT '',
    bank_account_name   varchar(200)  NOT NULL DEFAULT '',
    logo_path           varchar(200)  NOT NULL DEFAULT '',      -- bucket path (profiles/<id>/logo.png); '' = built-in SHD mark
    stamp_path          varchar(200)  NOT NULL DEFAULT '',      -- reserved: ตราประทับ (not printed yet)
    prefix_job          varchar(10)   NOT NULL,                 -- J  → J2612164
    prefix_quotation    varchar(10)   NOT NULL,                 -- Q  → Q2600468
    prefix_sale_order   varchar(10)   NOT NULL,                 -- SO → SO2600769
    is_default          boolean       NOT NULL DEFAULT false,
    is_active           boolean       NOT NULL DEFAULT true,
    sort_order          integer       NOT NULL DEFAULT 0,
    created_at          timestamp     NOT NULL DEFAULT now(),
    updated_at          timestamp     NOT NULL DEFAULT now()
);
-- prefixes must be unique per document type: the number is the table's primary key
CREATE UNIQUE INDEX IF NOT EXISTS ux_document_profile_prefix_job  ON document_profile (prefix_job);
CREATE UNIQUE INDEX IF NOT EXISTS ux_document_profile_prefix_quot ON document_profile (prefix_quotation);
CREATE UNIQUE INDEX IF NOT EXISTS ux_document_profile_prefix_so   ON document_profile (prefix_sale_order);

-- seed SHD as id 1 / default with what the legacy forms print
INSERT INTO document_profile (id, code, name_th, name_en, address_line1, address_line2, phone, bank_name, bank_account_type, prefix_job, prefix_quotation, prefix_sale_order, is_default, sort_order)
SELECT 1, 'SHD', 'บริษัท เอสเอชดี เทคโนโลยี จำกัด', 'SHD Technology Co., Ltd.',
       'อาคารไอซีเอส ชั้น 7 เลขที่ 112 ถนนเจริญนคร แขวงคลองต้นไทร', 'เขตคลองสาน กรุงเทพมหานคร 10600',
       '02-100-4578', 'ธ.ไทยพาณิชย์ จำกัด (มหาชน)', 'บัญชีออมทรัพย์', 'J', 'Q', 'SO', true, 0
WHERE NOT EXISTS (SELECT 1 FROM document_profile WHERE id = 1);
SELECT setval(pg_get_serial_sequence('document_profile', 'id'), GREATEST((SELECT max(id) FROM document_profile), 1));

-- which profile each document was issued under (NULL = SHD)
ALTER TABLE quotation_hd ADD COLUMN IF NOT EXISTS document_profile_id integer;
ALTER TABLE sale_out_hd  ADD COLUMN IF NOT EXISTS document_profile_id integer;
ALTER TABLE job          ADD COLUMN IF NOT EXISTS document_profile_id integer;

-- running numbers: the legacy rows for these three types belong to SHD (company_id
-- was 0 for Quotation/SaleOrder and 1 for Job); normalise so lookups are by profile id
UPDATE running_no SET company_id = 1
 WHERE running_type IN ('Job', 'Quotation', 'SaleOrder') AND company_id <> 1;
