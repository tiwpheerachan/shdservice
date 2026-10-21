import { OWNER_EMAIL } from './support/env';
import { newJob } from './support/db';
import { expect, signIn, test } from './support/fixtures';

/**
 * Two people issue a tracking link for one job: the later one wins and the earlier one's link is dead.
 * The 60 s re-read alone would let the loser copy that dead link meanwhile — คัดลอกลิงก์ re-checks first.
 */
test('a link replaced by someone else since the last read is not copied', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const no = await newJob({ status: 2 });
  await signIn(page, OWNER_EMAIL);
  await page.goto(`/jobs/edit?no=${no}`);
  await page.getByRole('button', { name: 'สร้างลิงก์ใหม่' }).click();
  await expect(page.getByText('สร้างลิงก์ใหม่แล้ว').first()).toBeVisible();
  const copy = page.getByRole('button', { name: 'คัดลอกลิงก์' });
  await expect(copy).toBeEnabled();
  await page.waitForLoadState('networkidle'); // this page's own re-read after issuing is done

  // another user issues one now — after this page last read the status
  const other = await page.evaluate(
    async (url) =>
      (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status,
    `/api/jobs/${no}/track-link`,
  );
  expect(other).toBe(200);
  await page.evaluate(() => navigator.clipboard.writeText('before'));

  await copy.click();
  await expect(page.getByText('ไม่ได้คัดลอก — ลิงก์นี้ถูกแทนที่แล้ว')).toBeVisible();
  await expect(page.getByText(/ลิงก์นี้ถูกแทนที่แล้ว — มีผู้สร้างลิงก์ใหม่/)).toBeVisible();
  await expect(copy).toBeDisabled();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('before');
});
