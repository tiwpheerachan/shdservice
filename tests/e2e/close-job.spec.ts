import type { Page } from '@playwright/test';
import { CLOSER_EMAIL, OWNER_EMAIL } from './support/env';
import { jobUuid, newJob, newPart, newPartLine, one, rows, userId } from './support/db';
import { call, expect, signIn, test } from './support/fixtures';

/**
 * ปิดงาน-ส่งคืนสินค้า (/jobs/close) by a cashier whose role has Job Closing but not Job Money After Close:
 * the payment of a repaired job, the close itself (status, closed date, job_status_log) and the return note's
 * amounts; refused while a part requested from stock is not issued; a closed job's money stays as recorded.
 */
const CLOSE_STATUS = 'ปิดงาน-รอลูกค้ามารับที่ศูนย์บริการ'; // job_status 24, group Finished
const RETURN_TYPE = 'ลูกค้ามารับเอง';
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

async function openClose(page: Page, no: string) {
  await signIn(page, CLOSER_EMAIL);
  await page.goto(`/jobs/close?id=${await jobUuid(no)}`);
  await expect(page.getByRole('heading', { name: 'ปิดงาน - ส่งคืนสินค้า', exact: true })).toBeVisible();
  await expect(page.getByLabel('หมายเลขงาน', { exact: true })).toHaveText(no);
}

/** the job's close / money columns as stored */
const closeState = (no: string) =>
  one(
    `SELECT j.job_status_id AS status, s.job_status_group AS grp, j.job_payment_type AS pay_type,
            j.job_payment_amount::float AS paid, j.closed_by_app_user_pk::int AS closed_by,
            to_char(j.job_closed_date, 'YYYY-MM-DD') AS closed_day, coalesce(j.return_customer_type, '') AS return_type,
            j.job_total_cost::float AS total
       FROM job j JOIN job_status s ON s.job_status_id = j.job_status_id WHERE j.job_no = $1`,
    [no],
  );
const logsOf = (no: string) =>
  rows(
    `SELECT job_status_id AS status, action_by_app_user_pk::int AS by FROM job_status_log
      WHERE job_pk = (SELECT pk FROM job WHERE job_no = $1) ORDER BY pk`,
    [no],
  );

test('closing a repaired job: the amount due is prefilled, the payment and the close are stored and logged', async ({
  page,
}) => {
  // parts 300 (issued) + service 500 = 800, deposit 200 → 600 due
  const part = await newPart({ remain: 3, price: 300 });
  const no = await newJob({ status: 5, service: 500, parts: 300, deposit: 200 });
  await newPartLine({ jobNo: no, code: part.code, price: 300, qty: 1, granted: 1 });
  const closer = await userId(CLOSER_EMAIL);

  await openClose(page, no);
  await page.getByRole('tab', { name: 'รายละเอียดการรับชำระเงิน' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'ยอดที่ต้องชำระ' })).toContainText('600.00');
  const amount = page.getByLabel('จำนวนเงินที่ชำระ (บาท)');
  await expect(amount).toHaveValue(''); // nothing paid yet: an untouched box is no payment
  await page.getByLabel('วิธีการชำระเงิน').selectOption('เงินโอน');
  await expect(amount).toHaveValue('600.00'); // choosing the method fills in total − deposit (shown as money)
  // a click on the amount selects it: what is typed replaces it, never appended to it (QA 2026-10-27: 250 → 250250)
  await amount.click();
  await page.keyboard.type('600');
  await expect(amount).toHaveValue('600');
  await amount.blur();
  await expect(amount).toHaveValue('600.00');

  await page.getByLabel('วิธีการส่งคืนสินค้า').selectOption(RETURN_TYPE);
  await page.getByLabel('โปรดระบุ สถานะงาน').selectOption(CLOSE_STATUS);
  await page.getByRole('button', { name: 'ยืนยันปิดงาน' }).click();
  await expect(page.getByText('ปิดงานและบันทึกการส่งคืนเรียบร้อย')).toBeVisible();

  expect(await closeState(no)).toEqual({
    status: 24,
    grp: 'Finished',
    pay_type: 'เงินโอน',
    paid: 600,
    closed_by: closer,
    closed_day: today(),
    return_type: RETURN_TYPE,
    total: 800,
  });
  expect(await logsOf(no)).toEqual([{ status: 24, by: closer }]);

  // the return note (พิมพ์ใบส่งคืน opens this page; auto=0: no print dialog)
  await page.goto(`/print/job/${await jobUuid(no)}/return?auto=0`);
  await expect(page.getByRole('heading', { name: 'ใบส่งคืนสินค้า / RETURN & REPAIR NOTE' })).toBeVisible();
  for (const line of [
    new RegExp(`^1 ${part.code} ${part.name} 1 300\\.00 300\\.00$`),
    /ค่าอะไหล่ \/ Parts : 300\.00$/,
    /^ค่าบริการ \/ Service : 500\.00$/,
    /^รวมทั้งสิ้น \/ Grand Total : 800\.00$/,
    /^หักมัดจำ \/ Deposit : -200\.00$/,
    /^ยอดที่ต้องชำระ \(หักมัดจำแล้ว\) : 600\.00$/,
    /ชำระเงิน : เงินโอน 600\.00 บาท/,
  ])
    await expect(page.getByRole('row', { name: line }).first()).toBeVisible();
});

test('a job whose requested part is not issued yet is not closed: field error, nothing stored', async ({ page }) => {
  const part = await newPart({ remain: 0, price: 120 });
  // repaired (closable — anything else is refused before the parts are even looked at), one part still owed
  const no = await newJob({ status: 5, service: 200, parts: 120 });
  await newPartLine({ jobNo: no, code: part.code, price: 120, qty: 1, granted: 0 }); // เบิก, not issued
  const before = await closeState(no);
  const closes: string[] = [];
  page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/close') && closes.push(r.url()));

  await openClose(page, no);
  await page.getByLabel('วิธีการส่งคืนสินค้า').selectOption(RETURN_TYPE);
  const status = page.getByLabel('โปรดระบุ สถานะงาน');
  await status.selectOption(CLOSE_STATUS);
  const why = `ยังเปลี่ยนเป็น "${CLOSE_STATUS}" ไม่ได้ — อะไหล่ที่ติ๊ก "เบิก" ยังไม่ได้จ่ายจากสต๊อก`;
  await expect(status).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(why)).toBeVisible();
  await page.getByRole('button', { name: 'ยืนยันปิดงาน' }).click();
  await expect(page.getByText('บันทึกไม่สำเร็จ')).toBeVisible();
  expect(closes, 'the page sends nothing').toEqual([]);

  // the server refuses the same close on its own (a stale page, another client)
  const r = await call(page, 'POST', `/api/jobs/${await jobUuid(no)}/close`, {
    status: CLOSE_STATUS,
    return: { type: RETURN_TYPE, date: today() },
  });
  expect(r.status).toBe(400);
  expect(r.body.details?.fields?.status).toContain(why);

  expect(await closeState(no)).toEqual(before); // the return fields written before the refusal rolled back too
  expect(await logsOf(no)).toEqual([]);
});

test('a job not in a closable status is said so as soon as it is loaded; no save button', async ({ page }) => {
  const no = await newJob({ status: 2 }); // กำลังดำเนินการ — not repaired yet
  await openClose(page, no);
  const why = 'งานนี้อยู่ในสถานะ "กำลังดำเนินการ" — ปิดงานได้เมื่อซ่อมเสร็จ (หรือรับคืนจาก Out-Source) แล้ว';
  await expect(page.getByRole('alert').filter({ hasText: why })).toBeVisible();
  await expect(page.getByRole('note').filter({ hasText: why })).toBeVisible(); // in the save bar, instead of the button
  await expect(page.getByRole('button', { name: 'ยืนยันปิดงาน' })).toHaveCount(0);
});

test('a closed job keeps its money for a role without Job Money After Close: inputs locked, the API says 409', async ({
  page,
}) => {
  const no = await newJob({ status: 24, service: 500, paid: 500, payType: 'เงินสด', closed: true });
  const before = await closeState(no);

  await openClose(page, no);
  await page.getByRole('tab', { name: 'รายละเอียดการรับชำระเงิน' }).click();
  const method = page.getByLabel('วิธีการชำระเงิน');
  await expect(method).toHaveValue('เงินสด');
  await expect(method).toBeDisabled();
  await expect(page.getByLabel('จำนวนเงินที่ชำระ (บาท)')).toHaveValue('500.00'); // shown as money
  await expect(page.getByLabel('จำนวนเงินที่ชำระ (บาท)')).toBeDisabled();
  await expect(
    page.getByText('งานปิดแล้ว — ช่องเงินแก้ได้เฉพาะผู้มีสิทธิ์พิเศษ "แก้ช่องเงินหลังปิดงาน"'),
  ).toBeVisible();

  // a client that sends a new amount anyway
  const r = await call(page, 'POST', `/api/jobs/${await jobUuid(no)}/close`, {
    status: CLOSE_STATUS,
    payment: { type: 'เงินสด', amount: 300, date: today() },
    return: { type: RETURN_TYPE, date: today() },
  });
  expect(r.status).toBe(409);
  expect(r.body.error).toBe(
    'งานปิดแล้ว — แก้จำนวนเงินที่ชำระ / เงินคืนได้เฉพาะผู้มีสิทธิ์พิเศษ "แก้ช่องเงินหลังปิดงาน" (Job Money After Close)',
  );
  expect(await closeState(no)).toEqual(before); // nothing of the save stuck — not even the return type
  expect(await logsOf(no)).toEqual([]);
});

test('a swapped job: Serial เครื่องใหม่ prefilled, optional, saved with the close and printed on the return note', async ({
  page,
}) => {
  const no = await newJob({ status: 18 }); // อยู่ระหว่างดำเนินการ - เบิกสินค้าใหม่แล้ว (Repaired)
  // as the Swap / Refund page stores it: the swap detail (what makes it a swap job) + job.new_serial_no (the serial)
  await rows(`UPDATE job SET swap_refund_detail = 'New S/N: OLD00001', new_serial_no = 'OLD00001' WHERE job_no = $1`, [
    no,
  ]);
  await openClose(page, no);
  const history = page.getByRole('heading', { name: 'ประวัติการแก้ไข' });
  await expect(history).toBeVisible();
  const serial = page.getByLabel('Serial เครื่องใหม่');
  await expect(serial).toHaveValue('OLD00001');
  await serial.fill('NEW00001');
  await page.getByLabel('วิธีการส่งคืนสินค้า').selectOption(RETURN_TYPE);
  await page.getByLabel('โปรดระบุ สถานะงาน').selectOption(CLOSE_STATUS);
  await page.getByRole('button', { name: 'ยืนยันปิดงาน' }).click();
  await expect(page.getByText('ปิดงานและบันทึกการส่งคืนเรียบร้อย')).toBeVisible();
  // the history section is refreshed by the save (the job the server answers with)
  await expect(page.getByText(`ล่าสุด:`).filter({ hasText: `เปลี่ยนสถานะงาน → ${CLOSE_STATUS}` })).toBeVisible();
  expect(
    await one(
      `SELECT new_serial_no AS serial, spare_part_replace AS parts, swap_refund_detail AS swap FROM job WHERE job_no = $1`,
      [no],
    ),
  ).toEqual({ serial: 'NEW00001', parts: null, swap: 'New S/N: OLD00001' }); // the close writes the serial column only

  await page.goto(`/print/job/${await jobUuid(no)}/return?auto=0`);
  await expect(page.getByRole('row', { name: /New S\/N : NEW00001/ }).first()).toBeVisible();
});

test('ประวัติการแก้ไข on the Out-Source, Swap / Refund and close pages', async ({ page }) => {
  const no = await newJob({ status: 5 });
  await signIn(page, OWNER_EMAIL);
  for (const path of ['/jobs/outsource', '/jobs/swap-refund', '/jobs/close']) {
    await page.goto(`${path}?id=${await jobUuid(no)}`);
    await expect(page.getByRole('heading', { name: 'ประวัติการแก้ไข' }), path).toBeVisible();
  }
});
