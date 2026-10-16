-- 0024_phone_digits_index — phone search on digits only.
--
-- ~30% of legacy customer phones are stored with dashes/spaces ("081-4969925"), so the
-- staff search now compares digits on both sides (src/server/services/customers.ts phoneHas,
-- jobs.ts jobWhere). These trigram indexes on the same expressions keep that an index scan.
-- regexp_replace is IMMUTABLE, so it may be indexed. Idempotent.

CREATE INDEX IF NOT EXISTS gin_customer_phone_digits
  ON customer USING gin ((regexp_replace(coalesce(phone_number, ''), '\D', '', 'g')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS gin_job_customer_detail_digits
  ON job USING gin ((regexp_replace(coalesce(customer_detail, ''), '\D', '', 'g')) gin_trgm_ops);
