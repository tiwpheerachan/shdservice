import { writeFile } from 'node:fs/promises';
import { REPAIR_CLOSE_TERMS } from '@/lib/company';
import { E2E_CUSTOMER, OWNER_EMAIL } from './support/env';
import { jobUuid, newJob, newPart, newPartLine, one } from './support/db';
import type { Page } from '@playwright/test';
import { expect, signIn, test } from './support/fixtures';

const sheetsOf = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;

/** the job moved to a customer of its own: CE2E01 is shared, and has no address */
async function customerWithAddress(no: string, address: string) {
  await one(
    `WITH c AS (
       INSERT INTO customer (customer_code, customer_name, phone_number, customer_address)
       VALUES ($1, $2, '081-000-9002', $3) RETURNING pk)
     UPDATE job SET customer_pk = (SELECT pk FROM c) WHERE job_no = $4 RETURNING 1`,
    [`C${no}`, `ลูกค้า ${no}`, address, no],
  );
}

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

test('a job receipt with a long remark still prints on one A4 sheet, the parcel frame on the next', async ({
  page,
}, info) => {
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
  expect(sheetsOf(pdf)).toBe(2);
  await page.locator('.so-sheet').evaluate((el) => el.parentElement!.remove());
  const receiptOnly = await page.pdf({ preferCSSPageSize: true });
  await writeFile(info.outputPath('job-receipt-only.pdf'), receiptOnly);
  expect(sheetsOf(receiptOnly)).toBe(1);
});

test('a job receipt too long for one sheet still puts the parcel frame on its own next page', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'chromium', 'page.pdf() is the desktop Chromium print path');
  const no = await newJob({ status: 1 });
  await one(
    `UPDATE job SET job_remark = repeat('ลูกค้าแจ้งว่าเครื่องเปิดไม่ติดหลังจากตกน้ำ ขอให้ตรวจสอบเพิ่มเติม ', 60) WHERE job_no = $1 RETURNING 1`,
    [no],
  );
  await signIn(page, OWNER_EMAIL);
  await page.goto(`/print/job/${await jobUuid(no)}?auto=0`);
  await expect(page.getByText('พนง.รับเครื่องซ่อม')).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true });
  await writeFile(info.outputPath('job-receipt-long.pdf'), pdf);
  await page.locator('.so-sheet').evaluate((el) => el.parentElement!.remove());
  const receiptOnly = await page.pdf({ preferCSSPageSize: true });
  expect(sheetsOf(receiptOnly)).toBeGreaterThan(1);
  expect(sheetsOf(pdf)).toBe(sheetsOf(receiptOnly) + 1);
});

test('the staff receipt prints the parcel frame: sender, customer address, order number', async ({ page }) => {
  const no = await newJob({ status: 1 });
  const address = `99/9 ซอยทดสอบ ${no}`;
  await customerWithAddress(no, address);
  await one(`UPDATE job SET job_reference_no = $2 WHERE job_no = $1 RETURNING 1`, [no, `SO-${no}`]);
  const { sender } = await one<{ sender: string }>(
    `SELECT name_th AS sender FROM document_profile WHERE is_default AND is_active AND deleted_at IS NULL ORDER BY sort_order, pk LIMIT 1`,
  );
  await signIn(page, OWNER_EMAIL);
  const id = await jobUuid(no);
  await page.goto(`/print/job/${id}?auto=0`);
  const frame = page.locator('.so-frame');
  await expect(frame).toContainText(`(เลขคำสั่งซื้อ : SO-${no})`);
  await expect(frame).toContainText(sender);
  await expect(frame).toContainText('กรุณานำส่ง');
  await expect(frame).toContainText(`ลูกค้า ${no}`);
  await expect(frame).toContainText(address);
  await expect(frame).toContainText('โทร.081-000-9002');
  // the address as it is: no "ต. อ. จ." line under it
  await expect(frame).not.toContainText('ต.');

  // the courier label is its own document: still the job number
  await page.goto(`/print/job/${id}/label?auto=0`);
  await expect(page.locator('.so-frame')).toContainText(no);
  await expect(page.locator('.so-frame')).not.toContainText('เลขคำสั่งซื้อ');
});

test('the parcel frame shows the job number when the job has no order number', async ({ page }, info) => {
  const no = await newJob({ status: 1 });
  await signIn(page, OWNER_EMAIL);
  await page.goto(`/print/job/${await jobUuid(no)}?auto=0`);
  const frame = page.locator('.so-frame');
  await expect(frame).toContainText(no);
  await expect(frame).not.toContainText('เลขคำสั่งซื้อ');
  if (info.project.name !== 'chromium') return; // a phone's preview is scaled to fit its screen
  // a short address sits where staff expect it: 44mm down, 60mm in, in a frame of 92mm
  const at = await page.evaluate(() => {
    const mm = (px: number) => Math.round((px * 25.4) / 96);
    const f = document.querySelector('.so-frame')!.getBoundingClientRect();
    const a = document.querySelectorAll('.so-frame > div')[1]!.getBoundingClientRect();
    return { top: mm(a.top - f.top), left: mm(a.left - f.left), height: mm(f.height) };
  });
  expect(at).toEqual({ top: 44, left: 60, height: 92 });
});

test('a stored placeholder address prints on neither the receipt nor the parcel frame', async ({ page }) => {
  const no = await newJob({ status: 1 });
  const select = '- - Please Select - -';
  await customerWithAddress(no, `ต.${select} อ.${select} จ.${select} `);
  await signIn(page, OWNER_EMAIL);
  const id = await jobUuid(no);
  await page.goto(`/print/job/${id}?auto=0`);
  await expect(page.locator('.so-frame')).toContainText(`ลูกค้า ${no}`);
  await expect(page.locator('body')).not.toContainText('Please Select');
  await expect(page.locator('.so-frame')).not.toContainText('ต.');
  await page.goto(`/print/job/${id}/label?auto=0`);
  await expect(page.locator('.so-frame')).toContainText(`ลูกค้า ${no}`);
  await expect(page.locator('.so-frame')).not.toContainText('Please Select');
});

test('the receipt keeps the line breaks of the remark', async ({ page }) => {
  const no = await newJob({ status: 1 });
  await one(`UPDATE job SET job_remark = $2 WHERE job_no = $1 RETURNING 1`, [no, 'บรรทัดหนึ่ง\nบรรทัดสอง']);
  await signIn(page, OWNER_EMAIL);
  await page.goto(`/print/job/${await jobUuid(no)}?auto=0`);
  const remark = page.locator('p', { hasText: 'หมายเหตุ:' }).filter({ hasText: 'บรรทัดหนึ่ง' });
  expect(await remark.evaluate((el) => (el as HTMLElement).innerText)).toContain('บรรทัดหนึ่ง\nบรรทัดสอง');
});

const THAI_WORDS = 'หมู่บ้านสวนสยาม ซอยลาดพร้าว ถนนเจริญกรุง อาคารศูนย์การค้า ตำบลสำโรงเหนือ อำเภอเมืองสมุทรปราการ ';
const LATIN_WORDS = 'Knightsbridge Space Ratchayothin Tower Building Company Limited ';
const text = (words: string, length: number) =>
  words.repeat(Math.ceil(length / words.length)).slice(0, length - 1) + '.';

async function expectInFrame(page: Page, name: string) {
  const out = await page.evaluate(() => {
    const frame = document.querySelector('.so-frame')!.getBoundingClientRect();
    const parts = [...document.querySelectorAll('.so-frame > *')].map((el) => el.getBoundingClientRect());
    const block = [...document.querySelectorAll('.so-frame > div')];
    return {
      bottomOver: Math.max(...parts.map((r) => r.bottom)) - frame.bottom,
      rightOver: Math.max(...parts.map((r) => r.right)) - frame.right,
      sideways: Math.max(...block.map((el) => el.scrollWidth - el.clientWidth)),
      gap: block[1]!.getBoundingClientRect().top - block[0]!.getBoundingClientRect().bottom,
      // the frame grows with the text, so "inside the frame" alone proves little: it must stay on its sheet
      offSheet: frame.bottom - document.querySelector('.so-sheet')!.getBoundingClientRect().bottom,
      heightMm: frame.height / (96 / 25.4),
    };
  });
  expect.soft(out.bottomOver, `${name}: runs out of the bottom of the frame`).toBeLessThanOrEqual(0);
  expect.soft(out.rightOver, `${name}: runs out of the side of the frame`).toBeLessThanOrEqual(0);
  expect.soft(out.sideways, `${name}: does not wrap`).toBeLessThanOrEqual(0);
  expect.soft(out.gap, `${name}: the sender and the address overlap`).toBeGreaterThanOrEqual(0);
  expect.soft(out.offSheet, `${name}: the frame runs off its sheet`).toBeLessThanOrEqual(0);
  expect.soft(out.heightMm, `${name}: the frame fills the A5 sheet`).toBeLessThanOrEqual(124);
}

test('the longest name and address stay inside the parcel frame on every document that prints it', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const no = await newJob({ status: 1 });
  await one(
    `WITH c AS (
       INSERT INTO customer (customer_code, customer_name, phone_number, customer_address1, customer_address2, postal_code,
                             province_pk, district_pk, sub_district_pk)
       VALUES ($1, $2, '081-000-9002 / 089-000-9003', $3, $4, '10270',
         (SELECT pk FROM province ORDER BY length(name_th) DESC, pk LIMIT 1),
         (SELECT pk FROM district ORDER BY length(name_th) DESC, pk LIMIT 1),
         (SELECT pk FROM sub_district ORDER BY length(name_th) DESC, pk LIMIT 1))
       RETURNING pk)
     UPDATE job SET customer_pk = (SELECT pk FROM c) WHERE job_no = $5 RETURNING 1`,
    [`C${no}`, text(THAI_WORDS, 200), text(THAI_WORDS, 500), text(THAI_WORDS, 500), no],
  );
  const { so } = await one<{ so: string }>(
    `WITH o AS (
       INSERT INTO sale_order (sale_order_no, customer_pk, customer_name, customer_address, customer_phone_number)
       VALUES ('S' || $1, (SELECT customer_pk FROM job WHERE job_no = $1), $2, $3, '081-000-9002') RETURNING id)
     SELECT id::text AS so FROM o`,
    [no, text(THAI_WORDS, 200), text(THAI_WORDS, 1167)],
  );
  await signIn(page, OWNER_EMAIL);
  const id = await jobUuid(no);
  const shot = async (name: string) => {
    await expect(page.locator('.so-frame')).toContainText('กรุณานำส่ง');
    await expectInFrame(page, name);
    await page.locator('.so-sheet').screenshot({ path: info.outputPath(`${name}.png`) });
  };
  await page.goto(`/print/job/${id}?auto=0`);
  await shot('receipt-parcel-page');
  if (info.project.name === 'chromium') {
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ preferCSSPageSize: true });
    await writeFile(info.outputPath('receipt-longest.pdf'), pdf);
    await page.locator('.so-sheet').evaluate((el) => el.parentElement!.remove());
    expect(sheetsOf(pdf)).toBe(sheetsOf(await page.pdf({ preferCSSPageSize: true })) + 1);
    await page.emulateMedia({ media: 'screen' });
  }
  await page.goto(`/print/job/${id}/label?auto=0`);
  await shot('label');
  await page.goto(`/print/sale-order/${so}?auto=0`);
  await shot('sale-order');

  // at the size change and in wider Latin text, on the legacy one-line address (200 characters at most)
  const widest: [string, string, number, number][] = [
    ['thai-120-120', THAI_WORDS, 120, 120],
    ['latin-120-120', LATIN_WORDS, 120, 120],
    ['latin-200-40', LATIN_WORDS, 200, 40],
    ['latin-40-200', LATIN_WORDS, 40, 200],
    ['thai-121-120', THAI_WORDS, 121, 120],
    ['latin-200-200', LATIN_WORDS, 200, 200],
    ['digits-200-200', '9', 200, 200],
  ];
  for (const [name, words, n, a] of widest) {
    await one(
      `UPDATE customer SET customer_name = $2, customer_address = $3, customer_address1 = NULL, customer_address2 = NULL,
              province_pk = NULL, district_pk = NULL, sub_district_pk = NULL, postal_code = NULL
        WHERE customer_code = $1 RETURNING 1`,
      [`C${no}`, text(words, n), text(words, a)],
    );
    await page.goto(`/print/job/${id}/label?auto=0`);
    await shot(name);
  }

  // the sale order's snapshot, up to the most the address columns compose
  const snapshots: [string, string, number][] = [
    ['so-latin-365', LATIN_WORDS, 365],
    ['so-latin-1167', LATIN_WORDS, 1167],
    ['so-thai-1167', THAI_WORDS, 1167],
    ['so-digits-365', '9', 365],
    ['so-digits-1167', '9', 1167],
  ];
  for (const [name, words, a] of snapshots) {
    await one(`UPDATE sale_order SET customer_name = $2, customer_address = $3 WHERE id = $1 RETURNING 1`, [
      so,
      text(words, 200),
      text(words, a),
    ]);
    await page.goto(`/print/sale-order/${so}?auto=0`);
    await shot(name);
  }
});

test('the customer copy through /track/doc has no parcel frame', async ({ page }, info) => {
  const no = await newJob({ status: 1 });
  await customerWithAddress(no, `99/9 ซอยทดสอบ ${no}`);
  await signIn(page, OWNER_EMAIL);
  const id = await jobUuid(no);
  await page.goto(`/print/job/${id}?auto=0`);
  await expect(page.getByText('กรุณานำส่ง')).toBeVisible();
  const post = (url: string, body: unknown) =>
    page.evaluate(
      async ([u, b]) =>
        (
          await fetch(u as string, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(b),
          })
        ).json() as Promise<{ url: string }>,
      [url, body],
    );
  const link = await post(`/api/jobs/${id}/track-link`, {});
  const doc = await post('/api/track/doc', { linkToken: link.url.split('/').pop(), kind: 'job', ref: no });
  await page.goto(`${doc.url}?auto=0`);
  await expect(page.getByRole('heading', { name: 'ใบรับงานซ่อม' })).toBeVisible();
  await expect(page.getByText(`ลูกค้า ${no}`).first()).toBeVisible();
  await expect(page.getByText('กรุณานำส่ง')).toHaveCount(0);
  await expect(page.locator('.so-frame')).toHaveCount(0);
  if (info.project.name !== 'chromium') return;
  await page.emulateMedia({ media: 'print' });
  expect(sheetsOf(await page.pdf({ preferCSSPageSize: true }))).toBe(1);
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

test('every field at its longest in one unbroken run: nothing runs past the paper, the money columns keep their width', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'chromium', 'page.pdf() is the desktop Chromium print path');
  test.setTimeout(60_000);
  const digits = (n: number) => '1234567890'.repeat(Math.ceil(n / 10)).slice(0, n);
  const no = await newJob({ status: 8, service: 350, parts: 2501, closed: true });
  await customerWithAddress(no, digits(200));
  await one(
    `UPDATE customer SET customer_name = $2, customer_address1 = $3, customer_address2 = $3
      WHERE pk = (SELECT customer_pk FROM job WHERE job_no = $1) RETURNING 1`,
    [no, digits(200), digits(500)],
  );
  await one(
    `UPDATE job SET product_serial = $2, product_equipment = $3, product_fault = $3, product_sale_out_shop_name = $3,
            job_remark = $4::varchar, product_symptom_other = $4::varchar, engineer_repair_detail = $4::varchar,
            engineer_remark = $4::varchar, job_payment_detail = $3, return_customer_detail = $3
      WHERE job_no = $1 RETURNING 1`,
    [no, digits(50), digits(500), digits(2000)],
  );
  const part = await newPart({ remain: 5, price: 1250.5 });
  await one(`UPDATE product SET product_name = $2 WHERE product_code = $1 RETURNING 1`, [part.code, digits(500)]);
  await newPartLine({ jobNo: no, code: part.code, price: 1250.5, qty: 2, granted: 2 });
  const q = await one<{ id: string }>(
    `WITH n AS (SELECT 'Q96' || lpad((coalesce(max(substring(quotation_no FROM 4)::int), 0) + 1)::text, 5, '0') AS no
                  FROM quotation WHERE quotation_no ~ '^Q96[0-9]{5}$')
     , q AS (
       INSERT INTO quotation (quotation_no, customer_pk, job_pk, create_date, quotation_status_id, record_status, remark, net_amount)
       SELECT n.no, j.customer_pk, j.pk, now(), 2, 'ACTIVE', $2, 2501 FROM n, job j WHERE j.job_no = $1 RETURNING pk, id)
     , l AS (
       INSERT INTO quotation_line (quotation_pk, line_number, item_type, item_code, item_detail, quantity, unit_price, unit_price_discount, total_price, unit_price_discount_percent)
       SELECT q.pk, g, 'SparePart', 'P' || g, $3, 2, 1250.50, 0, 2501.00, 0 FROM q, generate_series(1, 6) g)
     SELECT id::text AS id FROM q`,
    [no, digits(1000), digits(500)],
  );
  await signIn(page, OWNER_EMAIL);
  const id = await jobUuid(no);
  // the width of the paper less its margins, where the print layout is laid out
  const docs: [string, string, number, string][] = [
    ['receipt', `/print/job/${id}?auto=0`, 718, '.print-page'],
    ['repair-close', `/print/job/${id}/repair-close?auto=0`, 718, '.print-page'],
    ['return-note', `/print/job/${id}/return?auto=0`, 718, '.print-page'],
    ['quotation', `/print/quotation/${q.id}?auto=0`, 718, '.print-page'],
    ['pick-slip', `/print/pick-slip?ids=${q.id}&auto=0`, 1047, '.ps-sheet'],
  ];
  for (const [name, url, width, root] of docs) {
    await page.emulateMedia({ media: 'screen' });
    await page.goto(url);
    await expect(page.locator(root).first()).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await page.setViewportSize({ width, height: 1000 });
    const out = await page.evaluate((r) => {
      const inside = [...document.querySelectorAll<HTMLElement>(`${r} *`)];
      return {
        past: inside
          .filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 1)
          .map((e) => `${e.tagName} ${(e.textContent ?? '').slice(0, 20)}`)
          .slice(0, 5),
        money: [...document.querySelectorAll<HTMLElement>('table.items th[class*="w-[92px]"]')].map((e) =>
          Math.round(e.getBoundingClientRect().width),
        ),
      };
    }, root);
    expect.soft(out.past, `${name}: past the paper`).toEqual([]);
    expect
      .soft(new Set(out.money).size <= 1 && (out.money[0] ?? 92) === 92, `${name}: money columns ${out.money}`)
      .toBe(true);
    const pdf = await page.pdf({ preferCSSPageSize: true });
    await writeFile(info.outputPath(`${name}-longest.pdf`), pdf);
    expect.soft(sheetsOf(pdf), `${name}: sheets`).toBeGreaterThan(1);
  }
});
