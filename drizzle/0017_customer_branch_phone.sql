-- 0017_customer_branch_phone — เบอร์สาขา: a shop's branch line that many of its customers share, so it is never part of
-- the duplicate check (phone_number stays the customer's own, unique number). Searched on digits like phone_number
-- (customers.ts phoneHas) — the trigram index keeps that an index scan. Idempotent.
ALTER TABLE customer ADD COLUMN IF NOT EXISTS branch_phone varchar(50);

CREATE INDEX IF NOT EXISTS gin_customer_branch_phone_digits
  ON customer USING gin ((regexp_replace(coalesce(branch_phone, ''), '\D', '', 'g')) gin_trgm_ops);
