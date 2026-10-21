import { OWNER_EMAIL } from './support/env';
import { expect, signIn, test } from './support/fixtures';

test('the owner opens a job: a job number is issued and the job is in the list', async ({ page }) => {
  await signIn(page, OWNER_EMAIL);
  // POSTed from the page itself (same-origin, the session cookie, Sec-Fetch-Site) — what the
  // เปิดงานใหม่ form sends, minus driving its pickers; the master rows come from support/seed.ts
  const today = await page.evaluate(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }));
  const res = await page.evaluate(
    async (body) => {
      const r = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    },
    {
      customerCode: 'CE2E01',
      jobType: 'E2E ซ่อม',
      so: 'SO-E2E',
      channel: 'SHOPEE',
      saleOrderDate: today,
      warrantyMonth: 12,
      expireDate: today,
      serial: `SN-E2E-${Date.now()}`,
      brand: 'E2E Brand',
      modelCode: 'E2E-M1',
      symptoms: ['E2E เปิดไม่ติด'],
      dueDate: today,
    },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const no: string = res.body.job.no;
  expect(no).toMatch(/^J\d{7}$/); // J + Thai year (2 digits) + 5-digit running number

  await page.goto('/jobs/list');
  await expect(page.getByRole('heading', { name: 'รายการงานทั้งหมด' })).toBeVisible();
  await expect(page.getByText(no, { exact: true }).first()).toBeVisible();
});
