import type { Page } from '@playwright/test';
import { ENGINEER_EMAIL, STOCK_EMAIL } from './support/env';
import { movementsOf, newJob, newPart, newPartLine, one, rows, stockOf, userId } from './support/db';
import { dismissToasts, expect, signIn, switchUser, test } from './support/fixtures';

/**
 * Parts for a repair job: the engineer requests them on บันทึกงานซ่อม (/jobs/repair, แบบ A เบิก + เสนอ, qty) —
 * booked, not moved; the store issues them on ตัดจ่ายอะไหล่ (/stock/pick) — จ่ายออกตามงานซ่อม (inventory type 3),
 * on hand down; a part brought back is รับคืนจากการเบิก (type 2) — on hand up, the job's parts cost down.
 * More than on hand never goes out.
 */
const PRICE = 250;

const lineOf = (no: string) =>
  one(
    `SELECT spare_part_code AS code, is_special AS pick, is_quotation AS quote, request_qty AS requested,
            grant_qty AS granted, return_qty AS returned, order_status_id AS status, spare_part_total_price::float AS total
       FROM job_order_spare_part_log WHERE job_no = $1`,
    [no],
  );
const jobCosts = (no: string) =>
  one<{ status: number; parts: number; total: number }>(
    `SELECT job_status_id AS status, spare_part_total_cost::float AS parts, job_total_cost::float AS total
       FROM job WHERE job_no = $1`,
    [no],
  );

/** ตัดจ่ายอะไหล่: a document type, its job, Get Data */
async function pickLines(page: Page, docType: string, no: string) {
  await page.goto('/stock/pick');
  await expect(page.getByRole('heading', { name: 'ตัดจ่ายอะไหล่' })).toBeVisible();
  await page.getByLabel('ประเภทเอกสาร').selectOption(docType);
  await page.getByLabel('อ้างอิงเลขเอกสาร').fill(no);
  await page.getByRole('button', { name: 'Get Data' }).click();
}

/** the bottom-right save button, once the toasts stacked over it are gone */
async function save(page: Page, name: string) {
  await dismissToasts(page);
  await page.getByRole('button', { name }).click();
}

async function pickPerson(page: Page, field: string, name: string) {
  await page.getByLabel(field).click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(page.getByLabel(field)).toContainText(name);
}

test('engineer requests a part, the store issues it, one comes back: stock and job cost follow each step', async ({
  page,
}) => {
  const part = await newPart({ remain: 5, price: PRICE });
  const no = await newJob({ status: 2 }); // กำลังดำเนินการ, no costs yet
  const stock = await userId(STOCK_EMAIL);

  // ---- บันทึกงานซ่อม: request 2 (แบบ A: เบิก + เสนอ) ----
  await signIn(page, ENGINEER_EMAIL);
  await page.goto(`/jobs/repair?job=${no}`);
  await expect(page.getByRole('heading', { name: 'บันทึกงานซ่อม' })).toBeVisible();
  await page.getByRole('combobox', { name: 'เพิ่มอะไหล่ — ค้นหา ชื่อ / รหัส / เลข part / ยี่ห้อ…' }).click();
  await page.keyboard.type(part.code);
  await page.getByRole('option', { name: new RegExp(part.code) }).click();
  // the table on a desktop; the phone cards carry the same labels but are hidden
  await expect(page.getByLabel(`เบิก แบบ A ${part.code}`).filter({ visible: true })).toBeChecked();
  await expect(page.getByLabel(`เสนอ แบบ A ${part.code}`).filter({ visible: true })).toBeChecked();
  await page.getByLabel(`จำนวน แบบ A ${part.code}`).filter({ visible: true }).fill('2');
  await page.getByRole('button', { name: 'บันทึกงานซ่อม' }).click();
  await expect(page.getByText('บันทึกงานซ่อมเรียบร้อย')).toBeVisible();

  expect(await lineOf(no)).toEqual({
    code: part.code,
    pick: true,
    quote: true,
    requested: 2,
    granted: 0,
    returned: 0,
    status: 1, // รอเบิก
    total: 2 * PRICE,
  });
  expect(await stockOf(part.code)).toEqual({ available: 5, used: 0, booking: 2, remain: 5 }); // booked, not moved
  expect(await jobCosts(no)).toEqual({ status: 11, parts: 500, total: 500 }); // เริ่มเบิกอะไหล่
  expect(await movementsOf(no)).toEqual([]);

  // ---- ตัดจ่ายอะไหล่: จ่ายออกตามงานซ่อม 2 ----
  await switchUser(page, STOCK_EMAIL);
  await pickLines(page, 'จ่ายออกตามงานซ่อม', no);
  const row = page.getByRole('row', { name: new RegExp(part.code) });
  await expect(row).toContainText('รอเบิก');
  await row.getByLabel(`จำนวนจ่ายออก ${part.code}`).fill('2');
  await pickPerson(page, 'จ่ายให้', 'E2E Engineer');
  await save(page, 'บันทึกการจ่ายออก');
  await expect(page.getByText('บันทึกการจ่ายออกแล้ว 2 ชิ้น')).toBeVisible();

  const issued = await movementsOf(no);
  expect(issued).toEqual([{ no: expect.stringMatching(/^WHO\d+$/), type: 3, code: part.code, qty: 2 }]);
  expect(await stockOf(part.code)).toEqual({ available: 5, used: 2, booking: 0, remain: 3 });
  expect(await lineOf(no)).toMatchObject({ granted: 2, status: 3 }); // จ่ายแล้ว
  expect(await one('SELECT grant_by FROM job_order_spare_part_log WHERE job_no = $1', [no])).toEqual({
    grant_by: stock,
  });
  expect(await jobCosts(no)).toEqual({ status: 10, parts: 500, total: 500 }); // เบิกจ่ายอะไหล่ครบแล้ว

  // ---- รับคืนจากการเบิก 1 ----
  await pickLines(page, 'รับคืนจากการเบิก', no);
  await expect(row).toContainText('จ่ายแล้ว');
  await row.getByLabel(`จำนวนรับคืน ${part.code}`).fill('1');
  await pickPerson(page, 'รับคืนจาก', 'E2E Engineer');
  await save(page, 'บันทึกการรับคืน');
  await expect(page.getByText('บันทึกการรับคืนแล้ว 1 ชิ้น')).toBeVisible();

  const back = (await movementsOf(no)).filter((m) => m.type === 2);
  expect(back).toEqual([{ no: expect.stringMatching(/^WHI\d+$/), type: 2, code: part.code, qty: 1 }]);
  expect(await movementsOf(no)).toHaveLength(2);
  expect(await stockOf(part.code)).toEqual({ available: 5, used: 1, booking: 0, remain: 4 });
  expect(await lineOf(no)).toMatchObject({ granted: 2, returned: 1, status: 3, total: PRICE }); // re-priced to 1 used
  expect(await jobCosts(no)).toEqual({ status: 10, parts: 250, total: 250 });
});

test('more than on hand is never issued: the page flags it, a stale screen gets 409, nothing moves', async ({
  page,
}) => {
  const part = await newPart({ remain: 1, price: PRICE });
  const no = await newJob({ status: 11, parts: 3 * PRICE }); // เริ่มเบิกอะไหล่
  await newPartLine({ jobNo: no, code: part.code, price: PRICE, qty: 3, granted: 0 }); // 3 requested, 1 on hand
  const issues: string[] = [];
  page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/api/stock/issue') && issues.push(r.url()));

  await signIn(page, STOCK_EMAIL);
  await pickLines(page, 'จ่ายออกตามงานซ่อม', no);
  const row = page.getByRole('row', { name: new RegExp(part.code) });
  const qty = row.getByLabel(`จำนวนจ่ายออก ${part.code}`);
  await qty.fill('2');
  await expect(row.getByRole('alert')).toHaveText('เกินจำนวนคงเหลือในสต๊อก (มี 1)');
  await pickPerson(page, 'จ่ายให้', 'คลังสินค้าดี');
  await save(page, 'บันทึกการจ่ายออก');
  await expect(page.getByText('จำนวนเกิน 1 รายการ — แก้ช่องที่มีข้อความสีแดงก่อนบันทึก').first()).toBeVisible();
  expect(issues, 'the page sends nothing').toEqual([]);

  // 1 is fine on this screen — but another store user takes the last one before it is saved
  await qty.fill('1');
  await expect(row.getByRole('alert')).toHaveCount(0);
  await rows(
    `UPDATE product_none_serial SET quantity_used = quantity_used + 1, quantity_remain = quantity_remain - 1
      WHERE product_id = (SELECT product_id FROM product WHERE product_code = $1)`,
    [part.code],
  );
  await save(page, 'บันทึกการจ่ายออก');
  await expect(page.getByText(`สต๊อก ${part.code} ไม่พอ (คงเหลือ 0)`)).toBeVisible();
  expect(issues).toHaveLength(1);

  expect(await movementsOf(no)).toEqual([]);
  expect(await stockOf(part.code)).toEqual({ available: 1, used: 1, booking: 3, remain: 0 }); // as the other user left it
  expect(await lineOf(no)).toMatchObject({ requested: 3, granted: 0, status: 1 });
  expect((await jobCosts(no)).status).toBe(11);
});
