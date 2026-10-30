import { OWNER_EMAIL } from './support/env';
import { jobUuid, newJob, rows } from './support/db';
import { expect, signIn, test } from './support/fixtures';

/**
 * Call Log from the job list: on a phone the customer column (with its phone button) is hidden, the Action
 * column offers it instead. A double click on เพิ่มรายการ saves one line and shows no error beside the success.
 */
test('call log from the job list (a phone too); a double click on เพิ่มรายการ adds one line, no error', async ({
  page,
}) => {
  const no = await newJob({ status: 2 });
  await signIn(page, OWNER_EMAIL);
  await page.goto(`/jobs/list?no=${no}`);
  await page
    .getByRole('row')
    .filter({ hasText: no })
    .getByRole('button', { name: /^ข้อมูลลูกค้า / })
    .click();
  const dialog = page.getByRole('dialog', { name: 'รายละเอียดลูกค้า & Call Log' });
  await dialog.getByRole('tab', { name: /^Call Log/ }).click();

  // the answer held back a moment, as on a slow line: the second click lands while the first is on its way
  let posts = 0;
  await page.route(`**/api/jobs/${await jobUuid(no)}/calls`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts++;
    const res = await route.fetch();
    await new Promise((r) => setTimeout(r, 400));
    await route.fulfill({ response: res });
  });
  const detail = `โทรแจ้งลูกค้า e2e ${Date.now()}`;
  await dialog.getByPlaceholder('พิมพ์รายละเอียดการโทร แล้วกด Enter…').fill(detail);
  await dialog.getByRole('button', { name: 'เพิ่มรายการ' }).dblclick();
  await expect(dialog.getByRole('cell', { name: detail })).toBeVisible();
  await expect(page.getByText('เพิ่มบันทึกการโทรแล้ว').first()).toBeVisible();
  await page.waitForTimeout(500); // a second answer would be in by now
  await expect(page.getByText('บันทึกไม่สำเร็จ')).toHaveCount(0);
  expect(posts, 'one submit sent').toBe(1);
  expect(
    await rows('SELECT 1 FROM job_call_log WHERE job_pk = (SELECT pk FROM job WHERE job_no = $1)', [no]),
  ).toHaveLength(1);
});
