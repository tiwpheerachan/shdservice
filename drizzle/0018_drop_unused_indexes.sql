-- 0018_drop_unused_indexes — 0 scans in production since go-live, and no query can use them:
--   gin_sale_order_customer: the sale order search reads coalesce(sale_order.customer_name, customer.customer_name)
--                            (sale-orders.ts), which a trigram index on the bare column cannot serve
--   ix_customer_phone:       phone search / duplicate check compare digits (gin_customer_phone_digits); only an
--                            ORDER BY phone_number on the customer list could use it, and that sort is a 47k-row sort
-- Both are rebuilt with one CREATE INDEX if ever needed. Idempotent.
DROP INDEX IF EXISTS gin_sale_order_customer;
DROP INDEX IF EXISTS ix_customer_phone;
