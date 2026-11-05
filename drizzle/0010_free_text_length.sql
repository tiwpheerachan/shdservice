-- 0010_free_text_length — the forms' free text at 100 → varchar(500), TEXT_MAX in src/lib/validation/index.ts. Address
-- snapshots → varchar(1200): customer_address1 + 2 (500 each) + ตำบล / อำเภอ / จังหวัด (50 each + prefix) + postcode compose
-- to at most 1,167.
-- Raising a varchar's length changes the catalog only: no table rewrite, no value touched. Idempotent: the same type
-- again changes nothing. The code before this one keeps working on the wider columns.
ALTER TABLE customer
  ALTER COLUMN customer_address1 TYPE varchar(500),
  ALTER COLUMN customer_address2 TYPE varchar(500);
--> statement-breakpoint
ALTER TABLE job
  ALTER COLUMN product_equipment TYPE varchar(500),
  ALTER COLUMN product_fault TYPE varchar(500),
  ALTER COLUMN product_sale_out_shop_name TYPE varchar(500),
  ALTER COLUMN job_payment_detail TYPE varchar(500),
  ALTER COLUMN return_customer_detail TYPE varchar(500);
--> statement-breakpoint
ALTER TABLE job_outsource
  ALTER COLUMN send_detail TYPE varchar(500),
  ALTER COLUMN receive_detail TYPE varchar(500);
--> statement-breakpoint
ALTER TABLE job_attachment ALTER COLUMN remark TYPE varchar(500);
--> statement-breakpoint
ALTER TABLE sale_order
  ALTER COLUMN remark TYPE varchar(500),
  ALTER COLUMN document_cancel_remark TYPE varchar(500),
  ALTER COLUMN approve_remark TYPE varchar(500),
  ALTER COLUMN customer_address TYPE varchar(1200);
--> statement-breakpoint
ALTER TABLE quotation
  ALTER COLUMN customer_approve_remark TYPE varchar(500),
  ALTER COLUMN customer_address TYPE varchar(1200);
--> statement-breakpoint
ALTER TABLE quotation_line ALTER COLUMN item_detail TYPE varchar(500);
--> statement-breakpoint
ALTER TABLE stock_move ALTER COLUMN remark TYPE varchar(500);
--> statement-breakpoint
ALTER TABLE symptom ALTER COLUMN symptom_description TYPE varchar(500);
--> statement-breakpoint
ALTER TABLE color ALTER COLUMN description TYPE varchar(500);
--> statement-breakpoint
ALTER TABLE job_type ALTER COLUMN job_type_description TYPE varchar(500);
--> statement-breakpoint
ALTER TABLE product_type ALTER COLUMN product_type_description TYPE varchar(500);
