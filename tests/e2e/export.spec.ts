import { readFile } from 'node:fs/promises';
import { readSheet } from 'read-excel-file/node';
import { OWNER_EMAIL } from './support/env';
import { newJob } from './support/db';
import { expect, signIn, test } from './support/fixtures';

test('ส่งออก Excel on the job list downloads a real .xlsx of the filtered list', async ({ page }) => {
  const no = await newJob({ status: 2 });
  await signIn(page, OWNER_EMAIL);
  await page.goto(`/jobs/list?no=${no}`);
  await expect(page.getByRole('row', { name: new RegExp(no) })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'ส่งออก Excel' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^jobs-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const [head, ...rows] = await readSheet(await readFile((await download.path())!));
  expect(head).toContain('เลขที่งาน');
  expect(rows.map((r) => r[head!.indexOf('เลขที่งาน')])).toContain(no);
});
