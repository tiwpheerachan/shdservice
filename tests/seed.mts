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
    TRUNCATE job_status, customer, job, job_log, quotation_hd, app_config, app_user,
      track_ticket, track_rate, track_block, track_event, track_session, track_otp, track_doc_ticket RESTART IDENTITY;

    INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active) VALUES
      (0, 'ยกเลิก', 0, 'Cancel', true),
      (1, 'รับงานใหม่', 1, 'Open', true),
      (2, 'กำลังดำเนินการ', 2, 'Open', true),
      (20, 'เสร็จสมบูรณ์', 20, 'Finished', true);

    INSERT INTO customer (customer_id, customer_code, customer_name, phone_number) VALUES
      (1, 'C00001', 'สมชาย ทดสอบ', '081-234-5678'),
      (2, 'C00002', 'บริษัท ตัวอย่าง', '02-123-4567');
    -- explicit ids above: move the sequence past them, or the next app-created customer collides on id 1
    SELECT setval(pg_get_serial_sequence('customer', 'customer_id'), (SELECT max(customer_id) FROM customer));

    INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, product_serial,
                     job_create_date, job_reception_date, job_closed_date) VALUES
      ('TJ00001', 2, 1, 'C00001 สมชาย 0812345678', 'Model A', 'SN123456789', now() - interval '1 hour', current_date, '1900-01-01'),
      ('TJ00002', 1, 2, 'C00002 ตัวอย่าง', 'Model B', 'SN987654321', now() - interval '2 hours', current_date, '1900-01-01'),
      ('TJ00003', 20, 2, 'C00002 ตัวอย่าง', 'Model C', 'SN555555555', now() - interval '10 days', current_date - 10, now() - interval '1 day');

    INSERT INTO quotation_hd (quotation_no, quotation_status_id, reference_job_no, create_date) VALUES
      ('QT-0001', 3, 'TJ00002', now() - interval '90 minutes'),
      ('QT-0002', 5, 'TJ00002', now() - interval '100 minutes');

    INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
      ('Staff', 'Job Management', true, true, false, true);
  `);
}

// standalone: npx tsx tests/seed.mts
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertLocal(TEST_DATABASE_URL);
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1, options: '-c TimeZone=Asia/Bangkok' });
  await seed(pool);
  await pool.end();
  console.log('seeded');
}
