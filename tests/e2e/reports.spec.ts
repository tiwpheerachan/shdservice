import type { Locator } from '@playwright/test';
import { ENGINEER_EMAIL, OWNER_EMAIL } from './support/env';
import { jobUuid, newJob, one } from './support/db';
import { dismissToasts, expect, signIn, switchUser, test } from './support/fixtures';
import { isoToDmy, today } from '../../src/lib/dates';

const SHORT =
  'เปลี่ยน อะไหล่-Wanbo LCD Mozart1/1Pro และ อะไหล่-Wanbo Mainboard Mozart1Pro พร้อมทำความสะอาดเครื่อง ทดสอบทุกฟังก์ชันแล้วใช้งานได้ปกติ';
const LONG = `${'รายละเอียดการซ่อมยาวมาก '.repeat(80)}จบข้อความ`;

/** repaired today, with this repair text; the report's own filters narrowed to the job */
async function repairedJob(detail: string) {
  const no = await newJob({ status: 5 });
  await one(`UPDATE job SET engineer_repair_detail = $2, job_repaired_date = now() WHERE job_no = $1 RETURNING pk`, [
    no,
    detail,
  ]);
  return no;
}

/** a phone folds the filter bar */
async function showFilters(page: import('@playwright/test').Page) {
  await expect(page.getByRole('heading', { name: 'รายงานการซ่อม' })).toBeVisible();
  const show = page.getByRole('button', { name: 'แสดงตัวกรอง' });
  if (await show.isVisible()) await show.click();
}

async function openReport(page: import('@playwright/test').Page, no: string) {
  await page.goto('/reports/repair-job');
  await showFilters(page);
  await page.getByLabel('เลขที่งาน').fill(no);
  await page.getByRole('button', { name: 'ค้นหา', exact: true }).click();
  const row = page.getByRole('row', { name: new RegExp(no) });
  await expect(row).toBeVisible();
  return row;
}

test('รายงานการซ่อม: a cell shows its whole text, and a long note leaves its row a sane height', async ({ page }) => {
  const no = await repairedJob(SHORT);
  await signIn(page, OWNER_EMAIL);
  const row = await openReport(page, no);
  const cell = row.getByText(SHORT);
  await expect(cell).toBeVisible();
  const clipped = await cell.evaluate((el) => el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);
  expect(clipped, 'nothing cut').toBe(false);

  const longNo = await repairedJob(LONG);
  const longRow = await openReport(page, longNo);
  const note = longRow.getByText('จบข้อความ');
  await expect(note).toHaveText(LONG);
  expect((await longRow.boundingBox())!.height, 'the row is not a page tall').toBeLessThan(280);
  await note.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const end = await note.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
  expect(end, 'scrolling the cell reaches its last line').toBe(true);
});

test('รายงานการซ่อม: dragging over a cell selects its text and Ctrl+C copies it', async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(isMobile, 'mouse drag and Ctrl+C: desktop');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const no = await repairedJob(SHORT);
  await signIn(page, OWNER_EMAIL);
  const row = await openReport(page, no);
  const cell = row.getByText(SHORT);
  await cell.scrollIntoViewIfNeeded();
  const box = (await cell.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height - 4, { steps: 8 });
  await page.mouse.up();
  const picked = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  expect(picked.length, 'most of the cell selected').toBeGreaterThan(SHORT.length * 0.9);
  await page.keyboard.press('ControlOrMeta+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(picked);
});

test('รายงานการซ่อม: date = today + the assigned engineer + ซ่อมเสร็จ finds a job opened earlier, cards = rows', async ({
  page,
  isMobile,
}) => {
  const no = await newJob({ status: 2 }); // opened two days ago
  const engineer = await one<{ pk: number; name: string }>(
    `SELECT pk, concat_ws(' ', nullif(trim(first_name), ''), nullif(trim(last_name), '')) AS name
       FROM app_user WHERE email_address = $1`,
    [ENGINEER_EMAIL],
  );
  await one(`UPDATE job SET engineer_app_user_pk = $2 WHERE job_no = $1 RETURNING pk`, [no, engineer.pk]);

  await signIn(page, ENGINEER_EMAIL);
  await page.goto(`/jobs/repair?id=${await jobUuid(no)}`);
  await page.getByRole('combobox', { name: /^สถานะงานซ่อม/ }).click();
  await page.getByRole('option', { name: 'ซ่อมเสร็จ', exact: true }).click();
  await dismissToasts(page);
  await page.getByRole('button', { name: 'บันทึกงานซ่อม' }).click();
  await expect(page.getByText('บันทึกงานซ่อมเรียบร้อย')).toBeVisible();

  await switchUser(page, OWNER_EMAIL);
  await page.goto('/reports/repair-job');
  await showFilters(page);
  await page.getByLabel('วันที่ซ่อมเสร็จ (ตั้งแต่)').fill(isoToDmy(today()));
  // a phone taps: a scripted click on the long unfolded form leaves the popup scrolled away
  const press = (l: Locator) => (isMobile ? l.tap() : l.click());
  const pick = async (field: string, option: string) => {
    await press(page.getByRole('combobox', { name: field }));
    await press(page.locator('[cmdk-input]'));
    await page.keyboard.type(option); // the list shows the first 100 people
    await press(page.getByRole('option', { name: option, exact: true }));
    await expect(page.locator('[cmdk-input]')).toHaveCount(0);
  };
  await pick('พนง.ช่างซ่อม', engineer.name);
  await pick('สถานะงาน', 'ซ่อมเสร็จ');
  await page.getByRole('button', { name: 'ค้นหา', exact: true }).click();

  await expect(page.getByRole('row', { name: new RegExp(no) })).toBeVisible();
  const footer = page.getByText(/จาก [\d,]+ รายการ/);
  const rows = /จาก ([\d,]+) รายการ/.exec((await footer.textContent()) ?? '')![1];
  await expect(page.getByText('งานที่ดำเนินการ').locator('..')).toContainText(rows!);
});
