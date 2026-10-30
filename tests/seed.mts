/**
 * Fixture rows for scripts/test-track.mts — the minimum the /track tests read.
 * Wipes and re-creates its tables on every call (throwaway DB only), so a run never
 * depends on what a previous run left behind (rate counters, the global SMS cap, links).
 *   npx tsx tests/seed.mts — seed by hand (TEST_DATABASE_URL, local only)
 *
 *   customer 1 — 0812345678 (the OTP customer): TJ00001 open
 *   customer 2 — a landline (never matches a mobile lookup): TJ00002 open with a sent (3) and a
 *                cancelled (5) quotation, TJ00003 finished + closed (return note)
 *   TJ00001 / TJ00002 are the two newest open jobs → JOB_A / JOB_B
 */
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { TEST_DATABASE_URL, assertLocal } from './db-url.mts';

export async function seed(db: { query(text: string): Promise<unknown> }): Promise<void> {
  await db.query(`
    TRUNCATE job_status, customer, job, job_status_log, quotation, quotation_line, role_permission,
      track_ticket, track_rate, track_block, track_event, track_session, track_otp, track_doc_ticket RESTART IDENTITY
      CASCADE; -- tables pointing at these through a foreign key (drizzle/0006: every relation) go too.
    -- app_user stays: every table that records a person points at it (CASCADE would reach audit_log — append-only,
    -- TRUNCATE refused — and the profiles the other suites read)

    INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active) VALUES
      (0, 'ยกเลิก', 0, 'Cancel', true),
      (1, 'รับงานใหม่', 1, 'Open', true),
      (2, 'กำลังดำเนินการ', 2, 'Open', true),
      (20, 'ปิดงาน (Complete)', 20, 'Finished', true);

    INSERT INTO customer (pk, customer_code, customer_name, phone_number) OVERRIDING SYSTEM VALUE VALUES
      (1, 'C00001', 'สมชาย ทดสอบ', '081-234-5678'),
      (2, 'C00002', 'บริษัท ตัวอย่าง', '02-123-4567');
    -- explicit pks above: move the sequence past them, or the next app-created customer collides on pk 1
    SELECT setval(pg_get_serial_sequence('customer', 'pk'), (SELECT max(pk) FROM customer));

    -- job.model_pk is NOT NULL (drizzle/0006); the page reads the model's name through it (no copy on the job)
    INSERT INTO model (model_code, model_name, record_status)
      SELECT v.c, v.n, 'ACTIVE' FROM (VALUES ('TM-A', 'Model A'), ('TM-B', 'Model B'), ('TM-C', 'Model C')) v(c, n)
       WHERE NOT EXISTS (SELECT 1 FROM model m WHERE m.model_code = v.c);
    INSERT INTO job (job_no, job_status_id, customer_pk, model_pk, product_serial, job_create_date, job_reception_date,
                     job_closed_date)
      SELECT v.no, v.st, v.c, (SELECT pk FROM model WHERE model_code = v.m), v.sn, v.created, v.received, v.closed
        FROM (VALUES
          ('TJ00001', 2, 1, 'TM-A', 'SN123456789', now() - interval '1 hour', current_date, timestamp '1900-01-01'),
          ('TJ00002', 1, 2, 'TM-B', 'SN987654321', now() - interval '2 hours', current_date, timestamp '1900-01-01'),
          ('TJ00003', 20, 2, 'TM-C', 'SN555555555', now() - interval '10 days', current_date - 10, now() - interval '1 day'))
          v(no, st, c, m, sn, created, received, closed);

    -- quotation.quotation_status_id has a foreign key (drizzle/0006)
    INSERT INTO quotation_status (quotation_status_id, quotation_status_name) VALUES
      (3, 'ลูกค้าตกลงซ่อม'), (5, 'ยกเลิกใบเสนอราคา') ON CONFLICT DO NOTHING;
    INSERT INTO quotation (quotation_no, quotation_status_id, job_pk, create_date)
      SELECT v.no, v.st, (SELECT pk FROM job WHERE job_no = 'TJ00002'), now() - v.ago FROM (VALUES
        ('QT-0001', 3, interval '90 minutes'),
        ('QT-0002', 5, interval '100 minutes')) v(no, st, ago);

    INSERT INTO role_permission (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
      ('Staff', 'Job Management', true, true, false, true);

    -- category 1 ยังไม่ระบุ (a legacy row): a product saved without a category points at it (stock.ts; a foreign key
    -- since drizzle/0006). Here, before test:domain's masters take pk 1 on a fresh database
    INSERT INTO category (pk, category_name, record_status) OVERRIDING SYSTEM VALUE
      SELECT 1, 'ยังไม่ระบุ', 'ACTIVE' WHERE NOT EXISTS (SELECT 1 FROM category WHERE pk = 1);
    SELECT setval(pg_get_serial_sequence('category', 'pk'), (SELECT max(pk) FROM category));
  `);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertLocal(TEST_DATABASE_URL);
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1, options: '-c TimeZone=Asia/Bangkok' });
  await seed(pool);
  await pool.end();
  console.log('seeded');
}
