import { writeFile } from 'node:fs/promises';
import { REPAIR_CLOSE_TERMS } from '@/lib/company';
import { E2E_CUSTOMER, OWNER_EMAIL } from './support/env';
import { jobUuid, newJob, newPart, newPartLine, one } from './support/db';
import { expect, signIn, test } from './support/fixtures';

test('a quotation too long for one A4 prints on more sheets, each numbered by the browser', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'page.pdf() is the desktop Chromium print path');
  const { no } = await one<{ no: string }>(
    `SELECT 'Q97' || lpad((coalesce(max(substring(quotation_no FROM 4)::int), 0) + 1)::text, 5, '0') AS no
       FROM quotation WHERE quotation_no ~ '^Q97[0-9]{5}$'`,
  );
  const { id } = await one<{ id: string }>(
    `WITH q AS (
       INSERT INTO quotation (quotation_no, customer_pk, create_date, quotation_status_id, record_status)
       VALUES ($1, (SELECT pk FROM customer WHERE customer_code = $2), now(), 1, 'ACTIVE') RETURNING pk, id)
     , l AS (
       INSERT INTO quotation_line (quotation_pk, line_number, item_type, item_code, item_detail, quantity, unit_price, unit_price_discount, total_price, unit_price_discount_percent)
       SELECT q.pk, n, 'Service', 'SV' || n, 'ค่าบริการตรวจเช็คและซ่อมแผงวงจร รายการที่ ' || n, 1, 100, 0, 100, 0
         FROM q, generate_series(1, 80) n)
     SELECT id::text AS id FROM q`,
    [no, E2E_CUSTOMER],
  );
  await signIn(page, OWNER_EMAIL);
  await page.goto(`/print/quotation/${id}?auto=0`);
  await expect(page.getByText(`SV80`, { exact: true })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true });
  await writeFile(info.outputPath('quotation.pdf'), pdf);
  const sheets = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
  expect(sheets).toBeGreaterThan(1);
});

test('a job receipt with a long remark still prints on one A4 sheet', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'page.pdf() is the desktop Chromium print path');
  const no = await newJob({ status: 1 });
  // longer than the longest remark on a real job (~900 characters)
  await one(
    `UPDATE job SET job_remark = repeat('ลูกค้าแจ้งว่าเครื่องเปิดไม่ติดหลังจากตกน้ำ ขอให้ตรวจสอบเพิ่มเติม ', 18) WHERE job_no = $1 RETURNING 1`,
    [no],
  );
  await signIn(page, OWNER_EMAIL);
  await page.goto(`/print/job/${await jobUuid(no)}?auto=0`);
  // the legacy slip's pick-up line and signature row, with the receiving staff's name printed
  await expect(page.getByText('ลงชื่อผู้รับเครื่องคืน (เขียนตัวบรรจง)')).toBeVisible();
  await expect(page.getByText('พนง.รับเครื่องซ่อม')).toBeVisible();
  await expect(page.getByText('(สำหรับศูนย์บริการ)')).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true });
  await writeFile(info.outputPath('job-receipt.pdf'), pdf);
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length ?? 0).toBe(1);
});

test('the repair close sheet (ใบปิดงานซ่อม) prints for a job at any status, on one A4 sheet', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'chromium', 'page.pdf() is the desktop Chromium print path');
  const no = await newJob({ status: 1 }); // not repaired yet: the repair fields are empty, the sheet still prints
  await signIn(page, OWNER_EMAIL);
  await page.goto(`/print/job/${await jobUuid(no)}/repair-close?auto=0`);
  await expect(page.getByRole('heading', { name: 'ใบปิดงานซ่อม' })).toBeVisible();
  await expect(page.getByText(no, { exact: true })).toBeVisible();
  await expect(page.getByText('ผู้ตรวจเช็ค (By SV)')).toBeVisible();
  await expect(page.getByText('ผู้ตรวจสอบโดย (By QC)')).toBeVisible();
  for (const t of REPAIR_CLOSE_TERMS) await expect(page.getByText(t)).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true });
  await writeFile(info.outputPath('repair-close.pdf'), pdf);
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length ?? 0).toBe(1);
});

test('the repair close sheet prints the parts used (issued less returned) and the stored total, on one A4 sheet', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'chromium', 'page.pdf() is the desktop Chromium print path');
  const [issued, quoted, cancelled] = [
    await newPart({ remain: 5, price: 250 }),
    await newPart({ remain: 5, price: 400 }),
    await newPart({ remain: 5, price: 90 }),
  ];
  const no = await newJob({ status: 5, service: 300, parts: 250 }); // ซ่อมเสร็จ
  await newPartLine({ jobNo: no, code: issued.code, price: 250, qty: 2, granted: 2 });
  await newPartLine({ jobNo: no, code: quoted.code, price: 400, qty: 1, granted: 0 });
  await newPartLine({ jobNo: no, code: cancelled.code, price: 90, qty: 1, granted: 1 });
  const line = `(SELECT pk FROM job WHERE job_no = $1) AND product_pk = (SELECT pk FROM product WHERE product_code = $2)`;
  await one(`UPDATE job_part SET return_qty = 1, return_date = now() WHERE job_pk = ${line} RETURNING 1`, [
    no,
    issued.code,
  ]);
  // เสนอ only (เบิก not ticked): quoted to the customer, never issued
  await one(`UPDATE job_part SET is_special = false WHERE job_pk = ${line} RETURNING 1`, [no, quoted.code]);
  await one(`UPDATE job_part SET job_part_status_id = 4 WHERE job_pk = ${line} RETURNING 1`, [no, cancelled.code]);
  // the stored total, deliberately not the sum of the lines: the sheet prints it, never a figure of its own
  await one(
    `UPDATE job SET job_total_cost = 1234.50, engineer_repair_detail = 'เปลี่ยนบอร์ดจ่ายไฟ ทดสอบใช้งานได้ปกติ',
                    engineer_remark = 'แจ้งลูกค้าแล้ว', job_remark = 'ลูกค้าขอรับเครื่องที่ศูนย์'
      WHERE job_no = $1 RETURNING 1`,
    [no],
  );
  await signIn(page, OWNER_EMAIL);
  await page.goto(`/print/job/${await jobUuid(no)}/repair-close?auto=0`);
  const parts = page.getByRole('list', { name: 'รายการอะไหล่ ที่ใช้' }).getByRole('listitem');
  await expect(parts).toHaveCount(1);
  await expect(parts.first()).toHaveText(`${issued.code}${issued.name}x 1`);
  await expect(page.getByText(quoted.code)).toHaveCount(0);
  await expect(page.getByText(cancelled.code)).toHaveCount(0);
  await expect(page.getByText('1,234.50 บาท', { exact: true })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true });
  await writeFile(info.outputPath('repair-close-parts.pdf'), pdf);
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length ?? 0).toBe(1);
});
