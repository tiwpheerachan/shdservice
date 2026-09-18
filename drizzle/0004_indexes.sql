-- 0004_indexes — indexes for the filters/searches the app actually runs
-- (measured on the 420k-row dump). pg_trgm makes the free-text ILIKE '%…%'
-- searches on the job and customer lists use an index instead of scanning.
-- Idempotent — re-created automatically after a legacy reload.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- job: report date ranges / dashboard / filters
CREATE INDEX IF NOT EXISTS ix_job_closed_date    ON job (job_closed_date);
CREATE INDEX IF NOT EXISTS ix_job_repaired_date  ON job (job_repaired_date);
CREATE INDEX IF NOT EXISTS ix_job_symptom        ON job (product_symptom_id);
CREATE INDEX IF NOT EXISTS ix_job_type           ON job (job_type_id);

-- free-text search (ILIKE '%term%') on the job list
CREATE INDEX IF NOT EXISTS gin_job_customer_detail ON job USING gin (customer_detail gin_trgm_ops);
CREATE INDEX IF NOT EXISTS gin_job_no              ON job USING gin (job_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS gin_job_imei            ON job USING gin (product_imei_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS gin_job_serial          ON job USING gin (product_serial gin_trgm_ops);
CREATE INDEX IF NOT EXISTS gin_job_reference_no    ON job USING gin (job_reference_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS gin_job_model_name      ON job USING gin (product_model_name gin_trgm_ops);

-- free-text search on the customer list / lookups
CREATE INDEX IF NOT EXISTS gin_customer_name       ON customer USING gin (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS gin_customer_phone      ON customer USING gin (phone_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS gin_customer_code       ON customer USING gin (customer_code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS gin_customer_card_id    ON customer USING gin (customer_card_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS gin_customer_email      ON customer USING gin (email gin_trgm_ops);

-- product search (name / codes) for the paged product list and dropdown search
CREATE INDEX IF NOT EXISTS gin_product_name        ON product USING gin (product_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS gin_product_code        ON product USING gin (product_code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS gin_product_vender_code ON product USING gin (product_vender_code gin_trgm_ops);

-- small but free
CREATE INDEX IF NOT EXISTS ix_mt_district_city        ON mt_district (city_id);
CREATE INDEX IF NOT EXISTS ix_mt_sub_district_district ON mt_sub_district (district_id);
CREATE INDEX IF NOT EXISTS ix_inventory_hd_type       ON inventory_hd (inventory_type_id);
CREATE INDEX IF NOT EXISTS ix_sale_out_hd_approve     ON sale_out_hd (approve_status_id);
CREATE INDEX IF NOT EXISTS ix_sale_out_hd_create_by   ON sale_out_hd (document_create_by);
CREATE INDEX IF NOT EXISTS gin_sale_out_hd_customer   ON sale_out_hd USING gin (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS gin_inventory_hd_no        ON inventory_hd USING gin (inventory_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS gin_inventory_hd_ref       ON inventory_hd USING gin (reference_document_no gin_trgm_ops);
