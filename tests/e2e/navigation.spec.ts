import type { Page } from '@playwright/test';
import { E2E_CUSTOMER, OWNER_EMAIL, SELLER_EMAIL } from './support/env';
import { jobUuid, newJob, newPart, one, userUuid } from './support/db';
import { call, dismissToasts, expect, signIn, test } from './support/fixtures';

/**
 * Client-side navigation over pages whose first data came with them (<Prefetched>): back/forward replays a
 * page's payload, and a link to another record on the same route keeps the page mounted.
 */

/** a client-side navigation, as a <Link> makes it (Next's router, exposed on window for debugging) */
const push = (page: Page, href: string) =>
  page.evaluate(
    (h) => (window as unknown as { next: { router: { push(h: string): void } } }).next.router.push(h),
    href,
  );

const STATUS = 'อยู่ระหว่างการซ่อม - รอเสนอราคา';

test('Back after a save shows the saved job, and the repair page saves again after Forward (no 409)', async ({
  page,
}) => {
  const no = await newJob({ status: 2 }); // กำลังดำเนินการ
  await signIn(page, OWNER_EMAIL);
  await page.goto(`/jobs/list?no=${no}`);
  const row = page.getByRole('row', { name: new RegExp(no) });
  await expect(row).toContainText('กำลังดำเนินการ');

  // open the job from the list (client-side), change its status
  await row.getByRole('link', { name: no }).click();
  await expect(page.getByLabel('หมายเลขงานซ่อม')).toHaveText(no);
  await page.getByRole('combobox', { name: /^สถานะงานซ่อม/ }).click();
  await page.getByRole('option', { name: STATUS, exact: true }).click();
  await dismissToasts(page);
  await page.getByRole('button', { name: 'บันทึกงานซ่อม' }).click();
  await expect(page.getByText('บันทึกงานซ่อมเรียบร้อย')).toBeVisible();

  // Back replays the list's payload (the old status): the list shows the saved one
  await page.goBack();
  // the list re-reads after Back; under a full parallel run that answer can take longer than the default 10 s
  await expect(row).toContainText(STATUS, { timeout: 30_000 });
  await expect(row).not.toContainText('กำลังดำเนินการ');

  // Forward replays the repair page's payload (the job before the save): the job is read again, not taken
  // from the payload — and saves on the current version
  const id = await jobUuid(no);
  const reread = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().endsWith(`/api/jobs/${id}`));
  await page.goForward();
  await reread;
  await expect(page.getByLabel('สถานะงานซ่อม (ปัจจุบัน)')).toContainText(STATUS);
  await page.getByLabel('วิธีการซ่อม').fill('E2E after Forward');
  await dismissToasts(page);
  await page.getByRole('button', { name: 'บันทึกงานซ่อม' }).click();
  await expect(page.getByText('บันทึกงานซ่อมเรียบร้อย')).toBeVisible();
  expect(
    await one<{ remark: string }>('SELECT engineer_repair_detail AS remark FROM job WHERE job_no = $1', [no]),
  ).toEqual({
    remark: 'E2E after Forward',
  });
});

test('a link to another record on the same screen shows that record', async ({ page }) => {
  const [a, b] = [await newJob({ status: 2 }), await newJob({ status: 2 })];
  await signIn(page, OWNER_EMAIL);
  // repair: the page is keyed on the server
  await page.goto(`/jobs/repair?id=${await jobUuid(a)}`);
  await expect(page.getByLabel('หมายเลขงานซ่อม')).toHaveText(a);
  await push(page, `/jobs/repair?id=${await jobUuid(b)}`);
  await expect(page.getByLabel('หมายเลขงานซ่อม')).toHaveText(b);
  await expect(page.getByRole('textbox', { name: /^Serial No\./ })).toHaveValue(`SN-${b}`);

  // sale order: a client page, keyed by ?id= (<RecordKey>)
  const part = await newPart({ remain: 10, price: 100 });
  const order = async () => {
    const r = await call(page, 'POST', '/api/sale-orders', {
      customerCode: E2E_CUSTOMER,
      salesId: await userUuid(SELLER_EMAIL),
      lines: [{ code: part.code, qty: 1, price: 100, name: '', type: 'SparePart' }],
      paymentType: '',
      paymentAmount: '',
      slip: '',
      remark: '',
      submit: true,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.order as { no: string; id: string };
  };
  const [soA, soB] = [await order(), await order()];
  await page.goto(`/sale/orders/edit?id=${soA.id}`);
  await expect(page.getByText(soA.no, { exact: true })).toBeVisible();
  await push(page, `/sale/orders/edit?id=${soB.id}`);
  await expect(page.getByText(soB.no, { exact: true })).toBeVisible();
  await expect(page.getByText(soA.no, { exact: true })).toHaveCount(0);
});

test('a number with a literal % is just not found — the API and the print view, not a 500', async ({ page }) => {
  await signIn(page, OWNER_EMAIL);
  expect((await page.request.get('/api/jobs/A%25zz')).status()).toBe(404);
  expect((await page.request.get('/api/sale-orders/SO%25zz')).status()).toBe(404);
  expect((await page.request.get('/print/job/a%25zz')).status()).toBe(404);
  expect((await page.request.get('/print/sale-order/a%25zz')).status()).toBe(404);
});

test('an image-like path inside a page route is not public: no cookie → /login', async ({ request }) => {
  const r = await request.get('/quotation/edit.png', { maxRedirects: 0 });
  expect(r.status()).toBe(307);
  expect(new URL(r.headers().location!, 'http://x').pathname).toBe('/login');
});
