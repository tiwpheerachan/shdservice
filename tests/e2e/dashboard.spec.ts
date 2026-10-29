import { OWNER_EMAIL } from './support/env';
import { expect, signIn, test } from './support/fixtures';

const TAT = '[aria-label="จำนวนงานตามสถานะและ TAT"] tbody a';

/**
 * A TAT number opens exactly its jobs, and Back comes home to the range that was chosen: the range lives in the URL
 * (the router's cached page under it still holds the first props — page-client reads the URL itself).
 */
test('a TAT number opens its jobs; Back and a reload keep the dashboard range', async ({ page }) => {
  await signIn(page, OWNER_EMAIL);
  await page.goto('/jobs/dashboard');
  await page.getByRole('button', { name: 'ทั้งหมด' }).first().click();
  await expect(page).toHaveURL(/from=&to=/);
  const cell = page.locator(TAT).first();
  const n = (await cell.innerText()).trim();
  await cell.click();
  await expect(page).toHaveURL(/\/jobs\/list\?src=tat/);
  await expect(page.locator('main')).toContainText('จาก Dashboard TAT');
  await expect(page.locator('main')).toContainText(`จาก ${n}`);
  await page.goBack();
  await expect(page).toHaveURL(/\/jobs\/dashboard\?from=&to=/);
  await expect(page.locator(TAT).first()).toHaveText(n);
  await page.reload(); // a fresh load of that URL: the server reads the range too
  await expect(page.locator(TAT).first()).toHaveText(n);
});
