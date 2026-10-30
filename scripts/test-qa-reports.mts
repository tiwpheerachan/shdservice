/**
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-reports.mts
 * The 7 reports at the legacy system's level (src/app/(app)/reports/report-specs.ts, services/reports.ts reportPage):
 * each report's legacy columns in order, its filters and modes, the KPIs under the same filters, who may read the
 * table, and the Excel / Word / PDF (print view) exports with their caps. Its own fixtures (ids 994x, codes QRP*,
 * users qrp-*).
 */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.SESSION_SECRET = 'unit-test-session-secret-0123456789abcdef';

const { pool } = await import('@/db/client');
const { signSession, SESSION_COOKIE } = await import('@/lib/session');
const { reportPage, jobReportSummary, quotationReportSummary, saleOrderReportSummary } =
  await import('@/server/services/reports');
const { filtersFromQuery } = await import('@/server/services/jobs');
const { quotationFiltersFromQuery } = await import('@/server/services/quotations');
const { saleOrderFiltersFromQuery } = await import('@/server/services/sale-orders');
const { REPORT_SPECS, JOB_BOUNCE, ONHAND_ALL_COLORS, jobReportQuery, modelsOfBrand } =
  await import('@/app/(app)/reports/report-specs');
const dataRoute = await import('@/app/api/data/[resource]/route');
const exportRoute = await import('@/app/api/export/[resource]/route');
type ReportKey = import('@/app/(app)/reports/report-specs').ReportKey;

const SV = 3;
const U = {
  admin: { id: 9944, email: 'qrp-admin@example.invalid', type: 'System Admin' },
  admin2: { id: 9945, email: 'qrp-admin2@example.invalid', type: 'System Admin' },
  report: { id: 9946, email: 'qrp-report@example.invalid', type: 'QRP Report' }, // Report only
  jobs: { id: 9947, email: 'qrp-jobs@example.invalid', type: 'QRP Jobs' }, // Job Management only, no Report
  stock: { id: 9948, email: 'qrp-stock@example.invalid', type: 'QRP Stock' }, // Report + Product + Export, no Product Cost
} as const;
const STAFF = [
  { id: 9941, last: 'opener' },
  { id: 9942, last: 'engineer' },
  { id: 9943, last: 'closer' },
];

await pool.query(`
  DELETE FROM role_permission WHERE user_type IN ('QRP Report', 'QRP Jobs', 'QRP Stock');
  INSERT INTO role_permission (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
    ('QRP Report', 'Report', false, false, false, true),
    ('QRP Jobs', 'Job Management', false, false, false, true),
    ('QRP Stock', 'Report', false, false, false, true),
    ('QRP Stock', 'Product', false, false, false, true),
    ('QRP Stock', 'Export', false, false, false, true);
  -- the users stay (audit_log, append-only, points at them): reset in place
  INSERT INTO app_user (pk, first_name, last_name, email_address, user_type, record_status, session_version) OVERRIDING SYSTEM VALUE VALUES
    ${[
      ...STAFF.map(
        (s) => `(${s.id}, 'QRP', '${s.last}', 'qrp-${s.last}@example.invalid', 'QRP Staff', 'ACTIVE', ${SV})`,
      ),
      ...Object.values(U).map(
        (u) => `(${u.id}, 'QRP', '${u.email.split('@')[0]}', '${u.email}', '${u.type}', 'ACTIVE', ${SV})`,
      ),
    ].join(', ')}
    ON CONFLICT (pk) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
      email_address = excluded.email_address, user_type = excluded.user_type, record_status = excluded.record_status,
      session_version = excluded.session_version, last_login = DEFAULT;
  -- the codes the fixtures carry (foreign keys, drizzle/0006)
  INSERT INTO job_part_status (job_part_status_id, job_part_status_name) VALUES
    (1, 'เบิก'), (2, 'ขอคืน'), (3, 'จ่ายแล้ว'), (4, 'ยกเลิก'), (5, 'คืนแล้ว') ON CONFLICT DO NOTHING;
  INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
    SELECT * FROM (VALUES (1, 'รับงานใหม่', 1, 'Open', true), (5, 'ซ่อมเสร็จ', 5, 'Repaired', true),
                          (8, 'ปิดงาน-ส่งคืนสินค้า (ลงเลขที่พัสดุแล้ว)', 51, 'Finished', true)) v(id, name, ord, grp, act)
     WHERE NOT EXISTS (SELECT 1 FROM job_status s WHERE s.job_status_id = v.id);
  INSERT INTO quotation_status (quotation_status_id, quotation_status_name)
    SELECT * FROM (VALUES (1, 'รอเสนอราคา'), (3, 'ลูกค้าตกลงซ่อม')) v(id, name)
     WHERE NOT EXISTS (SELECT 1 FROM quotation_status s WHERE s.quotation_status_id = v.id);
  INSERT INTO approve_status (approve_status_id, approve_name_th, approve_name_en, is_can_edit, is_can_revise)
    SELECT * FROM (VALUES (3, 'แก้ไขข้อมูล', 'Reject', true, true), (4, 'อนุมัติแล้ว', 'Approved', false, false)) v(id, th, en, ed, rv)
     WHERE NOT EXISTS (SELECT 1 FROM approve_status s WHERE s.approve_status_id = v.id);
  INSERT INTO store_location (store_location_id, store_location_name, is_active)
    SELECT 1, 'คลังสินค้าดี', true WHERE NOT EXISTS (SELECT 1 FROM store_location WHERE store_location_id = 1);

  -- children before parents (every relation is a RESTRICT foreign key, drizzle/0006)
  DELETE FROM job_outsource WHERE job_pk IN (SELECT pk FROM job WHERE job_no LIKE 'QRPJ%');
  DELETE FROM job_part WHERE job_pk IN (SELECT pk FROM job WHERE job_no LIKE 'QRPJ%')
     OR product_pk BETWEEN 9941 AND 9943;
  DELETE FROM quotation_line WHERE quotation_pk IN (SELECT pk FROM quotation WHERE quotation_no LIKE 'QRPQ%');
  DELETE FROM quotation WHERE quotation_no LIKE 'QRPQ%';
  DELETE FROM sale_order_line WHERE sale_order_pk IN (SELECT pk FROM sale_order WHERE sale_order_no LIKE 'QRPSO%');
  DELETE FROM stock_move WHERE stock_move_no = 'WHO-QRP';
  DELETE FROM sale_order WHERE sale_order_no LIKE 'QRPSO%';
  DELETE FROM job WHERE job_no LIKE 'QRPJ%';
  DELETE FROM product_compatible_model WHERE product_pk BETWEEN 9941 AND 9943;
  DELETE FROM product_stock WHERE product_pk BETWEEN 9941 AND 9943;
  DELETE FROM product WHERE pk BETWEEN 9941 AND 9943 OR product_code LIKE 'QRPP%';
  DELETE FROM model WHERE pk = 9941 OR model_code = 'QRPM1';
  DELETE FROM customer WHERE pk = 9941 OR customer_code = 'QRPC01';
  DELETE FROM brand WHERE pk IN (9941, 9942) OR brand_name IN ('QRP Brand', 'QRP Brand 2');
  DELETE FROM product_type WHERE pk = 9941 OR product_type_name = 'QRP Type';
  DELETE FROM job_type WHERE pk = 9941 OR job_type_name = 'QRP งานซ่อม';

  INSERT INTO brand (pk, brand_name) OVERRIDING SYSTEM VALUE VALUES (9941, 'QRP Brand'), (9942, 'QRP Brand 2');
  INSERT INTO product_type (pk, product_type_name) OVERRIDING SYSTEM VALUE VALUES (9941, 'QRP Type');
  INSERT INTO job_type (pk, job_type_name) OVERRIDING SYSTEM VALUE VALUES (9941, 'QRP งานซ่อม');
  INSERT INTO model (pk, model_code, model_name, brand_pk) OVERRIDING SYSTEM VALUE VALUES (9941, 'QRPM1', 'QRP Model', 9941);
  INSERT INTO customer (pk, customer_code, customer_name, phone_number) OVERRIDING SYSTEM VALUE
    VALUES (9941, 'QRPC01', 'ลูกค้า QRP', '0811111111');
  INSERT INTO product (pk, product_code, product_vendor_code, product_name, product_name_en, product_description,
      brand_pk, for_model_color, record_status) OVERRIDING SYSTEM VALUE
    VALUES (9941, 'QRPP1', 'QRPV-1', 'อะไหล่ QRP 1', 'QRP part 1', 'desc1', 9941, 'Red', 'ACTIVE'),
           (9942, 'QRPP2', 'QRPV-2', 'อะไหล่ QRP 2', 'QRP part 2', '', 9941, '', 'ACTIVE'),
           (9943, 'QRPP3', 'QRPV-3', 'อะไหล่ QRP 3', '', '', 9941, 'Blue', 'INACTIVE');
  INSERT INTO product_stock (pk, product_pk, capital_price, retail_price,
      quantity_available, quantity_used, quantity_booking, quantity_remain) OVERRIDING SYSTEM VALUE
    VALUES (9941, 9941, 50, 100, 10, 3, 1, 6), (9942, 9942, 20, 40, 5, 0, 0, 5), (9943, 9943, 1, 2, 0, 0, 0, 0);
  INSERT INTO product_compatible_model (product_pk, model_pk) VALUES (9941, 9941);

  -- 1: closed (TAT 10), bounce, warranty IN, costs; 2: open, no customer row, no warranty, sent out-source in Oct;
  -- 3: repaired, warranty OUT, IMEI
  -- job.model_pk is NOT NULL (drizzle/0006): a model every fixture job without its own can point at (never deleted)
  INSERT INTO model (model_code, model_name, record_status)
    SELECT 'TST-M', 'Test model', 'ACTIVE' WHERE NOT EXISTS (SELECT 1 FROM model WHERE model_code = 'TST-M');
  INSERT INTO job (job_no, record_status, customer_pk, customer_detail, job_create_date, created_by_app_user_pk, engineer_app_user_pk,
      job_status_id, job_closed_date, closed_by_app_user_pk, job_return_date, job_repaired_date, product_warranty, is_job_bounce,
      model_pk, product_model_name, product_type_pk, job_type_pk, job_type_detail, product_symptom_other,
      product_fault, product_equipment, job_remark, job_reception_date, job_reception_tracking_no, job_reference_no,
      product_sale_order_date, product_serial, product_imei_no, spare_part_total_cost, service_cost, service_tool_cost,
      delivery_cost, carton_box_cost, job_total_cost, job_payment_amount, job_payment_type, job_payment_no,
      job_payment_detail, spare_part_replace, engineer_repair_detail, engineer_remark)
    VALUES
    ('QRPJ0001', 'ACTIVE', 9941, 'QRPC01 ลูกค้า QRP 0811111111', '2026-09-10 09:00', 9941, 9942,
      8, '2026-09-20 10:00', 9943, '1900-01-01', '2026-09-15 10:00', 'IN', true,
      9941, 'QRP Model', 9941, 9941, 'ย่อย QRP', 'จอไม่ติด',
      'บอร์ด', 'สายชาร์จ', 'หมายเหตุ QRP', '2026-09-11', 'QRPTRACK1', 'SO-QRP-1',
      '2026-09-01', 'QRPSN1', '', 100, 200, 10,
      50, 20, 380, 380, 'โอน', 'PAY1',
      'โอนแล้ว', 'จอ LCD', 'เปลี่ยนจอ', 'ok'),
    ('QRPJ0002', 'ACTIVE', null, 'QRPC99 สมชาย ทดสอบ 0899999999', '2026-09-12 09:00', 9942, null,
      1, '1900-01-01', null, '1900-01-01', '1900-01-01', '', false,
      (SELECT pk FROM model WHERE model_code = 'TST-M'), '', null, null, '', '', '', '', '', null, '', '', null, 'QRPSN2', '', 0, 0, 0, 0, 0, 0, 0, '', '', '', '', '', ''),
    ('QRPJ0003', 'ACTIVE', 9941, 'QRPC01 ลูกค้า QRP 0811111111', '2026-10-20 09:00', 9941, null,
      5, '1900-01-01', null, '1900-01-01', '2026-10-22 10:00', 'OUT', false,
      (SELECT pk FROM model WHERE model_code = 'TST-M'), '', null, null, '', '', '', '', '', null, '', '', null, '', '35QRP999', 0, 500, 0, 0, 0, 500, 0, '', '', '', '', '', '');
  INSERT INTO job_outsource (job_pk, send_to_name, send_date, receive_date)
    SELECT pk, 'ร้าน QRP', '2026-10-02 10:00', '2026-10-05 10:00' FROM job WHERE job_no = 'QRPJ0002';

  INSERT INTO quotation (quotation_no, record_status, customer_pk, create_date, job_pk,
      quotation_status_id, customer_approve_date, net_amount, remark, quotation_type)
    SELECT v.no, 'ACTIVE', 9941, v.created::timestamp, j.pk, v.st, v.approved::timestamp, v.net, v.remark, 'Normal'
      FROM (VALUES ('QRPQ0001', '2026-09-13 10:00', 'QRPJ0001', 3, '2026-09-14 10:00', 1500, 'QRP remark'),
                   ('QRPQ0002', '2026-09-15 10:00', 'QRPJ0003', 1, '1900-01-01', 200, '')) v(no, created, job, st, approved, net, remark)
      JOIN job j ON j.job_no = v.job;
  INSERT INTO quotation_line (quotation_pk, line_number, item_type, item_code, product_pk, item_detail, quantity, unit_price, total_price)
    SELECT (SELECT pk FROM quotation WHERE quotation_no = 'QRPQ0001'), v.n, v.t, v.code,
           (SELECT pk FROM product WHERE product_code = v.code), v.detail, v.qty, v.price, v.total
      FROM (VALUES (1, 'SparePart', 'QRPP1', 'จอ LCD', 1, 'ชิ้น', 1000, 1000),
                   (2, 'SparePart', 'QRPP2', 'กาว', 2, 'ชิ้น', 50, 100),
                   (3, 'Delivery', 'DL', 'ค่าส่ง', 1, 'ครั้ง', 50, 50)) v(n, t, code, detail, qty, unit, price, total);

  INSERT INTO sale_order (sale_order_no, record_status, document_create_date, created_by_app_user_pk, sale_out_by_app_user_pk,
      customer_pk, customer_name, customer_address, customer_phone_number, total_base_amount, vat_amount, total_amount,
      net_amount, remark, approve_status_id, approve_date, delivery_tracking_no, delivery_date)
    VALUES ('QRPSO001', 'ACTIVE', '2026-09-16 10:00', 9941, 9942, 9941, 'ลูกค้า QRP', '1 ถนน QRP', '0811111111',
            934.58, 65.42, 1000, 1000, 'ส่งด่วน', 4, '2026-09-17 10:00', 'TRK-QRP', '2026-09-18 10:00'),
           ('QRPSO002', 'ACTIVE', '2026-09-17 10:00', 9942, 9942, 9941, 'ลูกค้า QRP', '', '',
            0, 0, 0, 0, '', 3, '1900-01-01', '', '1900-01-01');
  -- its pick slip: the report's reference no. is that move's number (sale_order.reference_no dropped, drizzle/0006)
  INSERT INTO stock_move_type (stock_move_type_id, stock_move_type_name, movement_action_type, movement_action, is_active)
    SELECT 4, 'จ่ายออกตามใบสั่งขาย', 'จ่ายออก', -1, true WHERE NOT EXISTS (SELECT 1 FROM stock_move_type WHERE stock_move_type_id = 4);
  INSERT INTO stock_move (stock_move_no, stock_move_type_id, sale_order_pk, create_date)
    SELECT 'WHO-QRP', 4, pk, '2026-09-17 10:00' FROM sale_order WHERE sale_order_no = 'QRPSO001';
  INSERT INTO sale_order_line (sale_order_pk, list_no, product_code, product_pk, sale_out_quantity, sale_out_price, amount)
    SELECT (SELECT pk FROM sale_order WHERE sale_order_no = 'QRPSO001'), v.n, v.code,
           (SELECT pk FROM product WHERE product_code = v.code), v.qty, v.price, v.amount
      FROM (VALUES (1, 'QRPP1', 2, 300, 600), (2, 'QRPP2', 1, 400, 400)) v(n, code, qty, price, amount);

  INSERT INTO job_part (job_pk, product_pk, is_quotation, request_qty, request_date, grant_qty,
      grant_date, return_qty, return_date, job_part_status_id)
    SELECT (SELECT pk FROM job WHERE job_no = 'QRPJ0001'), p.pk, v.quote, v.qty, v.req::timestamp, v.qty, v.granted::timestamp,
           v.back, v.returned::timestamp, v.st
      FROM (VALUES ('QRPP1', true, 2, '2026-09-14 10:00', '2026-09-14 11:00', 0, '1900-01-01', 3),
                   ('QRPP2', false, 1, '2026-09-14 10:05', '2026-09-14 11:05', 1, '2026-09-20 10:00', 2))
           v(code, quote, qty, req, granted, back, returned, st)
      JOIN product p ON p.product_code = v.code;
  -- 3,001 lines of one job (opened outside the range): the Word / PDF cap (PRINT_MAX 3,000)
  INSERT INTO job (model_pk, job_no, record_status, job_create_date, job_status_id)
    VALUES ((SELECT pk FROM model WHERE model_code = 'TST-M'), 'QRPJ0009', 'ACTIVE', '2025-01-01', 1);
  INSERT INTO job_part (job_pk, product_pk, request_qty, request_date, job_part_status_id)
    SELECT (SELECT pk FROM job WHERE job_no = 'QRPJ0009'), 9942, 1, '2026-09-01 10:00', 1 FROM generate_series(1, 3001);
`);

const RANGE = { from: '2026-09-01', to: '2026-10-31' };
const page = (f: Record<string, string>, pageSize = 50) => ({ page: 1, pageSize, q: '', f });
const run = async (report: ReportKey, f: Record<string, string>, cost = false) =>
  (await reportPage(report, page(f), cost)).rows;
const col = (rows: Record<string, unknown>[], key = 'no') => rows.map((r) => r[key]);
/** a fixture user's app_user.id — what the report pages' staff filters send (ADR 0008) */
const uuidOf = async (userId: number) =>
  (await pool.query<{ id: string }>('SELECT id::text FROM app_user WHERE pk = $1', [userId])).rows[0]!.id;

async function cookieOf(u: { email: string }) {
  const now = Date.now();
  return `${SESSION_COOKIE}=${await signSession({ email: u.email, name: 'QRP', exp: now + 600_000, iat: now, sv: SV })}`;
}
async function get(route: 'data' | 'export', resource: string, query: string, u: { email: string }) {
  const req = new NextRequest(`https://svc.example.test/api/${route}/${resource}?${query}`, {
    headers: { cookie: await cookieOf(u), 'user-agent': 'qrp', host: 'svc.example.test' },
  });
  const mod = route === 'data' ? dataRoute : exportRoute;
  return mod.GET(req, { params: Promise.resolve({ resource }) } as never);
}

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : e}`);
  }
}

console.log('\nรายงานการเปิดงาน / ซ่อม / ปิดงาน: legacy columns and filters');
const J = { ...RANGE, no: 'QRPJ' };
await test('open_job: every legacy column in order, newest first, # runs on', async () => {
  const rows = await run('open_job', J);
  assert.deepEqual(col(rows), ['QRPJ0003', 'QRPJ0002', 'QRPJ0001']);
  assert.deepEqual(Object.keys(rows[0]!).sort(), REPORT_SPECS.open_job.cols.map((c) => c.key).sort());
  assert.deepEqual(col(rows, 'idx'), [1, 2, 3]);
  const r = rows[2]!;
  assert.deepEqual(
    [r.openedBy, r.customerCode, r.customerName, r.phone, r.so, r.soDate, r.serial, r.brand, r.model, r.productType],
    [
      'QRP opener',
      'QRPC01',
      'ลูกค้า QRP',
      '0811111111',
      'SO-QRP-1',
      '2026-09-01',
      'QRPSN1',
      'QRP Brand',
      'QRP Model',
      'QRP Type',
    ],
  );
  assert.deepEqual(
    [r.warranty, r.bounce, r.jobType, r.jobTypeDetail, r.engineer, r.tracking, r.symptomOther, r.fault, r.equipment],
    ['IN', 'Y', 'QRP งานซ่อม', 'ย่อย QRP', 'QRP engineer', 'QRPTRACK1', 'จอไม่ติด', 'บอร์ด', 'สายชาร์จ'],
  );
  assert.deepEqual(
    [r.partsCost, r.serviceCost, r.toolCost, r.deliveryCost, r.boxCost, r.totalCost, r.paid, r.tat],
    [100, 200, 10, 50, 20, 380, 380, 10],
  );
});
await test('a job with no customer row: code / name / phone from customer_detail; out-source dates', async () => {
  const [r] = await run('open_job', { ...J, no: 'QRPJ0002' });
  assert.deepEqual(
    [r!.customerCode, r!.customerName, r!.phone, r!.outSent, r!.outReceived, r!.bounce],
    ['QRPC99', 'สมชาย ทดสอบ', '0899999999', '2026-10-02 10:00', '2026-10-05 10:00', 'N'],
  );
});
await test('Warranty: ยังไม่ได้ระบุ (NONE) / IN / OUT', async () => {
  assert.deepEqual(col(await run('open_job', { ...J, warranty: 'NONE' })), ['QRPJ0002']);
  assert.deepEqual(col(await run('open_job', { ...J, warranty: 'IN' })), ['QRPJ0001']);
  assert.deepEqual(col(await run('open_job', { ...J, warranty: 'OUT' })), ['QRPJ0003']);
});
await test('date on วันที่ส่งต่อ (forward) / วันที่รับเครื่อง (reception) / วันที่ปิดงาน (closed)', async () => {
  const oct = { no: 'QRPJ', from: '2026-10-01', to: '2026-10-31' };
  assert.deepEqual(col(await run('open_job', { ...oct, dateBy: 'forward' })), ['QRPJ0002']);
  assert.deepEqual(col(await run('open_job', { ...oct })), ['QRPJ0003']); // by วันที่เปิดงาน
  const day = { no: 'QRPJ', from: '2026-09-11', to: '2026-09-11' };
  assert.deepEqual(col(await run('open_job', { ...day, dateBy: 'reception' })), ['QRPJ0001']);
  assert.deepEqual(col(await run('open_job', { ...RANGE, no: 'QRPJ', dateBy: 'closed' })), ['QRPJ0001']);
});
await test('งานซ่อมซ้ำ, ค่าใช้จ่าย มี / ไม่มี, IMEI, เลขพัสดุ, รหัสลูกค้า', async () => {
  assert.deepEqual(col(await run('open_job', { ...J, bounce: '1' })), ['QRPJ0001']);
  assert.deepEqual(col(await run('open_job', { ...J, cost: 'yes' })), ['QRPJ0003', 'QRPJ0001']);
  assert.deepEqual(col(await run('open_job', { ...J, cost: 'no' })), ['QRPJ0002']);
  assert.deepEqual(col(await run('open_job', { ...J, imei: '35QRP' })), ['QRPJ0003']);
  assert.deepEqual(col(await run('open_job', { ...J, tracking: 'QRPTRACK' })), ['QRPJ0001']);
  assert.deepEqual(col(await run('open_job', { ...J, customerCode: 'QRPC99' })), ['QRPJ0002']);
});
await test('พนง.เปิดงาน / ช่าง, ยี่ห้อ / รุ่น, ประเภทงาน + งานย่อย, สถานะ / กลุ่มสถานะ', async () => {
  // staff filters carry the user's uuid (ADR 0008 — report-specs.ts jobReportQuery)
  assert.deepEqual(col(await run('open_job', { ...J, createdBy: await uuidOf(9942) })), ['QRPJ0002']);
  assert.deepEqual(col(await run('open_job', { ...J, engineer: await uuidOf(9942) })), ['QRPJ0001']);
  assert.deepEqual(col(await run('open_job', { ...J, brand: 'QRP Brand', model: 'QRP Model' })), ['QRPJ0001']);
  assert.deepEqual(col(await run('open_job', { ...J, type: 'QRP งานซ่อม', typeDetail: 'ย่อย QRP' })), ['QRPJ0001']);
  assert.deepEqual(col(await run('open_job', { ...J, statusGroup: 'Finished' })), ['QRPJ0001']);
  assert.deepEqual(col(await run('open_job', { ...J, statusGroup: 'Repaired' })), ['QRPJ0003']);
  assert.deepEqual(col(await run('open_job', { ...J, statusId: '5' })), ['QRPJ0003']);
});
await test('repair_job: by วันที่ซ่อมเสร็จ, with the repair columns', async () => {
  const rows = await run('repair_job', { ...J, dateBy: 'repaired' });
  assert.deepEqual(col(rows), ['QRPJ0003', 'QRPJ0001']);
  assert.deepEqual(Object.keys(rows[0]!).sort(), REPORT_SPECS.repair_job.cols.map((c) => c.key).sort());
  const r = rows[1]!;
  assert.deepEqual(
    [r.receptionDate, r.so, r.partsReplaced, r.repairDetail, r.engineerRemark, r.repairedDate, r.remark],
    ['2026-09-11', 'SO-QRP-1', 'จอ LCD', 'เปลี่ยนจอ', 'ok', '2026-09-15 10:00', 'หมายเหตุ QRP'],
  );
});
await test('close_job: closed jobs by วันที่ปิดงานซ่อม, closer + payment columns', async () => {
  const rows = await run('close_job', { ...J, dateBy: 'closed', statusGroup: 'Finished' });
  assert.deepEqual(col(rows), ['QRPJ0001']);
  const r = rows[0]!;
  assert.deepEqual(
    [r.closedBy, r.closedDate, r.paymentType, r.paymentNo, r.paymentDetail],
    ['QRP closer', '2026-09-20 10:00', 'โอน', 'PAY1', 'โอนแล้ว'],
  );
  assert.match(String(r.status), /^ปิดงาน/);
});
await test('the KPIs read the same legacy-only filters (warranty NONE, dateBy forward)', async () => {
  const kpi = async (raw: Record<string, string>) => (await jobReportSummary(filtersFromQuery(raw), '', raw)).total;
  assert.equal(await kpi({ ...J, warranty: 'NONE' }), 1);
  assert.equal(await kpi({ no: 'QRPJ', from: '2026-10-01', to: '2026-10-31', dateBy: 'forward' }), 1);
  assert.equal(await kpi(J), 3);
});

console.log('\nรายงานการเสนอราคา: Summary / Detail Part');
const Q = { ...RANGE, no: 'QRPQ' };
await test('Summary: customer "code : name", the job device, spare parts listed, engineer, remark', async () => {
  const rows = await run('quotation', Q);
  assert.deepEqual(col(rows), ['QRPQ0002', 'QRPQ0001']);
  const r = rows[1]!;
  assert.deepEqual(
    [r.customerDetail, r.jobRef, r.brand, r.model, r.serial, r.parts, r.amount, r.engineer, r.remark, r.status],
    [
      'QRPC01 : ลูกค้า QRP',
      'QRPJ0001',
      'QRP Brand',
      'QRP Model',
      'QRPSN1',
      'จอ LCD, กาว',
      1500,
      'QRP engineer',
      'QRP remark',
      'ลูกค้าตกลงซ่อม',
    ],
  );
});
await test('รุ่น, วันที่เปิดงานซ่อม, วันที่ตกลงซ่อม — in the table and the KPIs', async () => {
  assert.deepEqual(col(await run('quotation', { ...Q, model: 'QRP Model' })), ['QRPQ0001']);
  assert.deepEqual(col(await run('quotation', { ...Q, jobFrom: '2026-10-01', jobTo: '2026-10-31' })), ['QRPQ0002']);
  assert.deepEqual(col(await run('quotation', { ...Q, agreedFrom: '2026-09-14', agreedTo: '2026-09-14' })), [
    'QRPQ0001',
  ]);
  const raw = { ...Q, model: 'QRP Model' };
  assert.equal((await quotationReportSummary(quotationFiltersFromQuery(raw, 'exclude'), '', raw)).total, 1);
});
await test('Detail Part: one row per line, with the job reference no.', async () => {
  const rows = await run('quotation_detail', Q);
  assert.deepEqual(col(rows, 'itemDetail'), ['จอ LCD', 'กาว', 'ค่าส่ง']);
  assert.deepEqual(
    [rows[1]!.qty, rows[1]!.unitPrice, rows[1]!.totalPrice, rows[1]!.jobRefNo],
    [2, 50, 100, 'SO-QRP-1'],
  );
});

console.log('\nรายงานการขาย: Grouping by SO / Detail Items');
const S = { ...RANGE, no: 'QRPSO' };
await test('Grouping: amounts, address, creator, status as the list labels it', async () => {
  const rows = await run('sale_order', S);
  assert.deepEqual(col(rows), ['QRPSO002', 'QRPSO001']);
  const r = rows[1]!;
  assert.deepEqual(
    [r.base, r.vat, r.total, r.address, r.createdBy, r.status, r.approveDate, r.stockDoc, r.tracking, r.deliveryDate],
    [
      934.58,
      65.42,
      1000,
      '1 ถนน QRP',
      'QRP opener',
      'อนุมัติแล้ว',
      '2026-09-17 10:00',
      'WHO-QRP',
      'TRK-QRP',
      '2026-09-18 10:00',
    ],
  );
  assert.equal(rows[0]!.status, 'ส่งกลับแก้ไข');
});
await test('สร้างโดย (document_create_by) in the table and the KPIs; รายการสินค้า', async () => {
  assert.deepEqual(col(await run('sale_order', { ...S, createdBy: await uuidOf(9941) })), ['QRPSO001']);
  assert.deepEqual(col(await run('sale_order', { ...S, createdBy: '9941' })).length, 2, 'the old number: no filter');
  const raw = { ...S, createdBy: await uuidOf(9941) };
  assert.equal((await saleOrderReportSummary(saleOrderFiltersFromQuery(raw, 'exclude'), '', raw)).total, 1);
  assert.deepEqual(col(await run('sale_order', { ...S, code: 'QRPP2' })), ['QRPSO001']);
});
await test('Detail Items: one row per line, item name from the product', async () => {
  const rows = await run('sale_order_detail', S);
  assert.deepEqual(col(rows, 'itemCode'), ['QRPP1', 'QRPP2']);
  assert.deepEqual(
    [rows[0]!.itemName, rows[0]!.qty, rows[0]!.unitPrice, rows[0]!.amount],
    ['อะไหล่ QRP 1', 2, 300, 600],
  );
});

console.log('\nรายงานการเบิกจ่ายอะไหล่: the job part log');
await test('request / grant / return per line, Is Quotation, status; a 1900 date is blank', async () => {
  const rows = await run('product_used', { ...RANGE, jobNo: 'QRPJ0001' });
  assert.deepEqual(col(rows, 'code'), ['QRPP2', 'QRPP1']);
  const [ret, paid] = rows;
  assert.deepEqual(
    [ret!.status, ret!.returnQty, ret!.returnDate, ret!.isQuotation],
    ['ขอคืน', 1, '2026-09-20 10:00', 'N'],
  );
  assert.deepEqual(
    [paid!.status, paid!.grantQty, paid!.returnDate, paid!.isQuotation, paid!.nameEn],
    ['จ่ายแล้ว', 2, '', 'Y', 'QRP part 1'],
  );
});
await test('สถานะ, รหัส (ผู้ผลิต), ชื่อ, ช่วงวันที่', async () => {
  const f = { ...RANGE, jobNo: 'QRPJ0001' };
  assert.deepEqual(col(await run('product_used', { ...f, status: 'ขอคืน' }), 'code'), ['QRPP2']);
  assert.deepEqual(col(await run('product_used', { ...f, code: 'QRPV-1' }), 'code'), ['QRPP1']);
  assert.deepEqual(col(await run('product_used', { ...f, name: 'QRP part 2' }), 'code'), ['QRPP2']);
  assert.deepEqual(await run('product_used', { jobNo: 'QRPJ0001', from: '2026-10-01', to: '2026-10-31' }), []);
});

console.log('\nรายงานอะไหล่คงเหลือ');
await test('qty available / used / booking / remain, models, location; ราคาทุน only with the right', async () => {
  const [r] = await run('product_onhand', { sysCode: 'QRPP1' });
  assert.deepEqual(
    [
      r!.mfgCode,
      r!.description,
      r!.brand,
      r!.modelCode,
      r!.modelName,
      r!.color,
      r!.available,
      r!.used,
      r!.booking,
      r!.remain,
      r!.price,
      r!.location,
    ],
    ['QRPV-1', 'desc1', 'QRP Brand', 'QRPM1', 'QRP Model', 'Red', 10, 3, 1, 6, 100, 'คลังสินค้าดี'],
  );
  assert.equal('capitalPrice' in r!, false);
  assert.equal((await run('product_onhand', { sysCode: 'QRPP1' }, true))[0]!.capitalPrice, 50);
});
await test('สถานะ, สี + "ใช้ได้กับทุกสี", รุ่น', async () => {
  assert.deepEqual(col(await run('product_onhand', { sysCode: 'QRPP', status: 'Active' }), 'code'), ['QRPP1', 'QRPP2']);
  assert.deepEqual(col(await run('product_onhand', { sysCode: 'QRPP', status: 'Inactive' }), 'code'), ['QRPP3']);
  assert.deepEqual(col(await run('product_onhand', { sysCode: 'QRPP' }), 'code'), ['QRPP1', 'QRPP2', 'QRPP3']);
  assert.deepEqual(col(await run('product_onhand', { sysCode: 'QRPP', color: 'Red' }), 'code'), ['QRPP1']);
  assert.deepEqual(col(await run('product_onhand', { sysCode: 'QRPP', color: 'Red', allColors: '1' }), 'code'), [
    'QRPP1',
    'QRPP2',
  ]);
  assert.deepEqual(col(await run('product_onhand', { sysCode: 'QRPP', model: 'QRPM1' }), 'code'), ['QRPP1']);
});

console.log('\nThe dropdowns that stand for legacy checkboxes, and รุ่น under ยี่ห้อ');
await test('งานซ่อมซ้ำ: เฉพาะงานซ่อมซ้ำ (ticked) = only is_job_bounce jobs; ทั้งหมด (unticked) = every job', async () => {
  // ReportView reads ทั้งหมด as left out ('')
  assert.equal(jobReportQuery({ bounce: 'เฉพาะงานซ่อมซ้ำ' }).bounce, '1');
  assert.equal(jobReportQuery({ bounce: '' }).bounce, '');
  assert.deepEqual(Object.keys(JOB_BOUNCE), ['เฉพาะงานซ่อมซ้ำ']);
  const all = await run('open_job', { ...J, bounce: jobReportQuery({}).bounce });
  assert.deepEqual(col(all), ['QRPJ0003', 'QRPJ0002', 'QRPJ0001']); // bounce and not
  const ticked = await run('open_job', { ...J, bounce: jobReportQuery({ bounce: 'เฉพาะงานซ่อมซ้ำ' }).bounce });
  assert.deepEqual(col(ticked, 'bounce'), ['Y']);
});
await test('ทุกสี: starts ไม่รวม (unticked) = that colour only; รวมด้วย = + parts with no colour; no สี = all', async () => {
  const [unticked, ticked] = Object.keys(ONHAND_ALL_COLORS); // the first option is the starting one
  assert.deepEqual([unticked, ticked], ['ไม่รวม', 'รวมด้วย']);
  const f = (allColors: string, color = 'Red') => ({ sysCode: 'QRPP', status: 'Active', color, allColors });
  assert.deepEqual(col(await run('product_onhand', f(ONHAND_ALL_COLORS[unticked!]!)), 'code'), ['QRPP1']);
  assert.deepEqual(col(await run('product_onhand', f(ONHAND_ALL_COLORS[ticked!]!)), 'code'), ['QRPP1', 'QRPP2']);
  assert.deepEqual(col(await run('product_onhand', f('1', '')), 'code'), ['QRPP1', 'QRPP2']);
  assert.deepEqual(col(await run('product_onhand', f('', '')), 'code'), ['QRPP1', 'QRPP2']);
});
await test('รุ่น list follows ยี่ห้อ; a รุ่น of another ยี่ห้อ = no rows (200, not 400) on every report', async () => {
  const models = [
    { name: 'A1', brand: 'QRP Brand' },
    { name: 'B1', brand: 'QRP Brand 2' },
  ];
  assert.deepEqual(
    modelsOfBrand(models, 'QRP Brand 2').map((m) => m.name),
    ['B1'],
  );
  assert.deepEqual(modelsOfBrand(models, 'ทั้งหมด').length, 2);
  assert.deepEqual(modelsOfBrand(models, '').length, 2);
  assert.deepEqual(await run('open_job', { ...J, brand: 'QRP Brand 2', model: 'QRP Model' }), []);
  assert.deepEqual(await run('quotation', { ...Q, brand: 'QRP Brand 2', model: 'QRP Model' }), []);
  assert.deepEqual(await run('product_onhand', { sysCode: 'QRPP', brand: 'QRP Brand 2', model: 'QRPM1' }), []);
  assert.deepEqual(col(await run('product_onhand', { sysCode: 'QRPP', brand: 'QRP Brand', model: 'QRPM1' }), 'code'), [
    'QRPP1',
  ]);
  const r = await get(
    'data',
    'report_rows',
    'paged=1&report=product_onhand&brand=QRP%20Brand%202&model=QRPM1',
    U.admin,
  );
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { total: number }).total, 0);
});
await test('a sort asked for changes nothing: the same rows and columns (display order only)', async () => {
  const a = await reportPage('open_job', page(J));
  const b = await reportPage('open_job', { ...page(J), sort: { key: 'tat', dir: 'asc' } });
  assert.deepEqual(b, a);
});

console.log('\nGET /api/data/report_rows: Report, plus the list the report reads');
await test('admin → one page; the job reports also need a job screen, the stock ones Report alone', async () => {
  const q = `paged=1&report=open_job&no=QRPJ&from=${RANGE.from}&to=${RANGE.to}`;
  const ok = await get('data', 'report_rows', q, U.admin);
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { total: number }).total, 3);
  assert.equal((await get('data', 'report_rows', q, U.report)).status, 403); // Report, no job screen
  assert.equal((await get('data', 'report_rows', q, U.jobs)).status, 403); // a job screen, no Report
  assert.equal((await get('data', 'report_rows', 'paged=1&report=product_onhand&sysCode=QRPP', U.report)).status, 200);
});
await test('job_summary takes dateBy=forward through its declared query', async () => {
  const r = await get('data', 'job_summary', 'no=QRPJ&dateBy=forward&from=2026-10-01&to=2026-10-31', U.admin);
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { total: number }[])[0]!.total, 1);
});

console.log('\nGET /api/export/report_*: Excel, Word, the PDF print view');
await test('Excel: the workbook', async () => {
  const r = await get('export', 'report_open_job', `no=QRPJ&from=${RANGE.from}&to=${RANGE.to}`, U.admin);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /spreadsheetml/);
  assert.match(r.headers.get('content-disposition') ?? '', /report_open_job-.*\.xlsx/);
  await r.arrayBuffer();
});
await test('Word: an HTML table as application/msword, UTF-8 BOM, every legacy column, the rows', async () => {
  const r = await get(
    'export',
    'report_open_job',
    `no=QRPJ&from=${RANGE.from}&to=${RANGE.to}&format=doc&file=report-open-job`,
    U.admin,
  );
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /^application\/msword/);
  assert.match(r.headers.get('content-disposition') ?? '', /attachment; filename="report-open-job-.*\.doc"/);
  const bytes = new Uint8Array(await r.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const html = new TextDecoder().decode(bytes);
  for (const c of REPORT_SPECS.open_job.cols)
    assert.ok(html.includes(`<th>${c.header.replace('&', '&#38;')}</th>`), c.header);
  assert.ok(html.includes('QRPJ0001') && html.includes('380.00'));
});
await test('PDF: the print view — landscape A4, the filters in words, inline', async () => {
  const r = await get(
    'export',
    'report_quotation_detail',
    `no=QRPQ&format=html&cond=${encodeURIComponent('เลขที่ QRPQ <b>')}`,
    U.admin,
  );
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /^text\/html/);
  assert.match(r.headers.get('content-disposition') ?? '', /^inline/);
  const html = await r.text();
  assert.ok(html.includes('size: A4 landscape'));
  assert.ok(html.includes('เลขที่ QRPQ &#60;b&#62;')); // escaped
  assert.ok(html.includes('จอ LCD') && html.includes('3 แถว'));
});
await test('ราคาทุน: no Capital Price column without Product Cost', async () => {
  const no = await (await get('export', 'report_product_onhand', 'sysCode=QRPP&format=doc', U.stock)).text();
  assert.ok(!no.includes('Capital Price') && no.includes('Retail Price'));
  const yes = await (await get('export', 'report_product_onhand', 'sysCode=QRPP&format=doc', U.admin)).text();
  assert.ok(yes.includes('Capital Price') && yes.includes('50.00'));
});
await test('Word / PDF stop at 3,000 rows and say so (header + the document)', async () => {
  const r = await get('export', 'report_product_used', 'jobNo=QRPJ0009&format=doc', U.admin2);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-export-truncated'), '3001');
  assert.match(r.headers.get('content-disposition') ?? '', /-partial\.doc/);
  const html = await r.text();
  assert.ok(html.includes('แสดง 3,000 แถวแรกจาก 3,001 แถว'));
  assert.equal(html.split('<tr>').length - 2, 3000); // header row + 3,000
});

await pool.end();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
