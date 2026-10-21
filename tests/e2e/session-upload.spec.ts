import { statSync } from 'node:fs';
import type { Page } from '@playwright/test';
import sharp from 'sharp';
import { CLOSER_EMAIL, OWNER_EMAIL } from './support/env';
import { newJob } from './support/db';
import { call, expect, signIn, test } from './support/fixtures';

/**
 * Forms survive what a counter on a phone network does to them (src/lib/api.ts):
 *  - the session runs out before บันทึก: the page stays with what was typed, the save waits in the
 *    "sign in again in a new tab" dialog and goes once — same Idempotency-Key — after signing in again
 *  - a slow / failing upload: the photo is shrunk before it goes, a progress toast shows it going up,
 *    a failed attempt keeps the file and "ลองอีกครั้ง" sends it again
 */

/** the session ends as it does after 30 idle minutes / 12 h / a sign-out elsewhere: the cookie is gone */
async function expireSession(page: Page) {
  const session = (await page.context().cookies()).find((c) => /os_session$/.test(c.name));
  expect(session, 'session cookie').toBeTruthy();
  await page.context().clearCookies({ name: session!.name });
}

test('an expired session on save keeps the typed text, and the save after signing in again is stored once', async ({
  page,
}) => {
  await signIn(page, OWNER_EMAIL);
  await page.goto('/customers');
  await page.getByRole('button', { name: 'เพิ่มลูกค้า' }).click();
  const form = page.getByRole('dialog', { name: 'เพิ่มลูกค้าใหม่' });
  const name = `E2E หมดเซสชัน ${Date.now()}`;
  const phone = `09${String(Date.now()).slice(-8)}`;
  await form.getByRole('textbox', { name: /^ชื่อลูกค้า/ }).fill(name);
  await form.getByRole('textbox', { name: 'เบอร์โทรศัพท์ (จำเป็น)' }).fill(phone);

  const keys: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/customers')
      keys.push(r.headers()['idempotency-key'] ?? '');
  });
  await expireSession(page);
  await form.getByRole('button', { name: 'บันทึกข้อมูล' }).click();

  // no trip to /login: the page, the form and what was typed are all still here
  const expired = page.getByRole('dialog', { name: 'เซสชันหมดอายุ' });
  await expect(expired).toContainText('เข้าสู่ระบบอีกครั้งในแท็บใหม่ แล้วกดบันทึกอีกครั้ง');
  await expect(page).toHaveURL(/\/customers$/);
  // (the customer dialog sits under the session one — out of the accessibility tree meanwhile: read the inputs)
  const typed = () =>
    page.locator('[role=dialog] input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  await expect.poll(typed).toEqual(expect.arrayContaining([name, phone]));
  await expect(expired.getByRole('link', { name: 'เข้าสู่ระบบใหม่ (แท็บใหม่)' })).toHaveAttribute('target', '_blank');

  // signing in again in another tab (same cookie jar) — this tab notices by itself
  const other = await page.context().newPage();
  await signIn(other, OWNER_EMAIL);
  await other.close();
  const back = page.getByRole('dialog', { name: 'เข้าสู่ระบบแล้ว' });
  await back.getByRole('button', { name: 'บันทึกอีกครั้ง' }).click();
  await expect(page.getByText('บันทึกข้อมูลลูกค้าแล้ว')).toBeVisible();

  // refused once (401), sent again with the same key — one customer, with the typed name
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  const found = await call(page, 'GET', `/api/customers/lookup?q=${phone}`);
  const rows = (found.body.rows as { name: string }[]).filter((c) => c.name === name);
  expect(rows).toHaveLength(1);
});

test('a slip upload shows its progress, survives a failed first attempt, and sends the photo shrunk', async ({
  page,
}, testInfo) => {
  // a phone photo: 4032×3024 JPEG, several MB (noise does not compress — a worst case for the shrink)
  const photo = testInfo.outputPath('photo.jpg');
  await sharp({
    create: {
      width: 4032,
      height: 3024,
      channels: 3,
      background: '#808080',
      noise: { type: 'gaussian', mean: 128, sigma: 40 },
    },
  })
    .jpeg({ quality: 92 })
    .toFile(photo);
  const original = statSync(photo).size;
  expect(original).toBeGreaterThan(4 * 1024 * 1024);

  const no = await newJob({ status: 5, service: 500 });
  await signIn(page, CLOSER_EMAIL);
  await page.goto(`/jobs/close?job=${no}`);
  await expect(page.getByLabel('หมายเลขงาน', { exact: true })).toHaveText(no);
  await page.getByRole('tab', { name: 'รายละเอียดการรับชำระเงิน' }).click();

  // storage is a dead end in e2e — the upload answer is played here: the first attempt drops, the second is slow
  const sent: { bytes: number; jpeg: boolean }[] = [];
  await page.route('**/api/upload', async (route) => {
    const body = route.request().postDataBuffer() ?? Buffer.alloc(0);
    sent.push({ bytes: body.length, jpeg: body.includes('Content-Type: image/jpeg') });
    if (sent.length === 1) return route.abort('failed');
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ json: { ok: true, path: `jobs/${no}/slip/e2e.jpg`, file: 'e2e.jpg' } });
  });

  const slip = page.getByLabel('สลิปหลักฐานการชำระ');
  await slip.setInputFiles(photo);
  const failed = page.locator('[data-sonner-toast]').filter({ hasText: 'อัปโหลด photo.jpg ไม่สำเร็จ' });
  await expect(failed).toContainText('เชื่อมต่อไม่สำเร็จ');
  await expect(slip).toBeDisabled(); // the file is kept, nothing else goes up meanwhile
  await failed.getByRole('button', { name: 'ลองอีกครั้ง' }).click();

  const going = page.locator('[data-sonner-toast]').filter({ hasText: 'กำลังอัปโหลด photo.jpg' });
  await expect(going.locator('progress')).toBeVisible();
  await expect(page.getByText('อัปโหลดสลิปแล้ว')).toBeVisible();
  await expect(going).toHaveCount(0);
  await expect(slip).toBeEnabled();

  // the same shrunk JPEG both times, a fraction of the original
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
  expect(sent[0]!.jpeg).toBe(true);
  expect(sent[0]!.bytes).toBeLessThan(original / 5);
});
