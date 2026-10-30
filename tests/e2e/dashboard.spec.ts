import { OWNER_EMAIL } from './support/env';
import { newJob, rows } from './support/db';
import { expect, signIn, test } from './support/fixtures';

const TAT = '[aria-label="จำนวนงานตามสถานะและ TAT"] tbody a';
/** a day no other spec (or device project) opens a job on: the jobs other workers open meanwhile can't move the
 *  count (the dashboard keeps its numbers 30 s, the list counts live) */
const DAYS: Record<string, string> = { chromium: '2001-03-05', phone: '2001-03-06', tablet: '2001-03-07' };

/**
 * A TAT number opens exactly its jobs, and Back comes home to the range that was chosen: the range lives in the URL
 * (the router's cached page under it still holds the first props — page-client reads the URL itself).
 */
test('a TAT number opens its jobs; Back and a reload keep the dashboard range', async ({ page }, info) => {
  const DAY = DAYS[info.project.name] ?? '2001-03-08';
  const no = await newJob({ status: 2 });
  await rows(
    `UPDATE job SET job_create_date = $2::date + time '10:00', job_reception_date = $2::date WHERE job_no = $1`,
    [no, DAY],
  );
  await signIn(page, OWNER_EMAIL);
  await page.goto('/jobs/dashboard');
  await page.getByRole('button', { name: 'ทั้งหมด' }).first().click();
  await expect(page).toHaveURL(/from=&to=/);

  await page.goto(`/jobs/dashboard?from=${DAY}&to=${DAY}`);
  const cell = page.locator(TAT).first();
  const n = (await cell.innerText()).trim();
  await cell.click();
  await expect(page).toHaveURL(/\/jobs\/list\?src=tat/);
  await expect(page.locator('main')).toContainText('จาก Dashboard TAT');
  await expect(page.locator('main')).toContainText(`จาก ${n}`);
  await expect(page.locator('main')).toContainText(no);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/jobs/dashboard\\?from=${DAY}&to=${DAY}`));
  await expect(page.locator(TAT).first()).toHaveText(n);
  await page.reload(); // a fresh load of that URL: the server reads the range too
  await expect(page.locator(TAT).first()).toHaveText(n);
});
