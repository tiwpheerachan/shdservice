import { OWNER_EMAIL } from './support/env';
import { expect, signIn, test } from './support/fixtures';

test('a date box is dd/mm/yyyy: 05/10 is 5 October, on the form and on its calendar', async ({ page }) => {
  await signIn(page, OWNER_EMAIL);
  await page.goto('/jobs/new');
  const sale = page.getByLabel('Sale Order Date');
  const expire = page.getByLabel('Expire Date');
  const native = sale.locator('xpath=following-sibling::input[@type="date"]');

  await sale.pressSequentially('05102026');
  await expect(sale).toHaveValue('05/10/2026');
  await expect(native).toHaveValue('2026-10-05');
  await page.getByLabel('รับประกัน (เดือน)').fill('24');
  await expect(expire).toHaveValue('05/10/2028');

  // half-typed: the form keeps the last whole day, and the box shows it again once left
  await sale.fill('05/1');
  await expect(native).toHaveValue('2026-10-05');
  await expire.focus();
  await expect(sale).toHaveValue('05/10/2026');

  // no such day (and mm/dd typed by habit): never saved, never guessed
  for (const wrong of ['31/02/2026', '10/13/2026', '05/10/2569']) {
    await sale.fill(wrong);
    await expire.focus();
    await expect(sale).toHaveValue('05/10/2026');
    await expect(native).toHaveValue('2026-10-05');
  }

  // the icon opens the browser's calendar; what it picks shows day first
  await page.evaluate(() => {
    HTMLInputElement.prototype.showPicker = function () {
      document.body.dataset.picker = this.type;
    };
  });
  await native.click();
  await expect(page.locator('body')).toHaveAttribute('data-picker', 'date');
  await page.keyboard.press('Escape'); // a real click on the icon opens the real calendar too
  await native.fill('2026-01-02');
  await expect(sale).toHaveValue('02/01/2026');

  await sale.fill('');
  await expect(native).toHaveValue('');
});

test('filter bar: a typed from after to is refused', async ({ page }) => {
  await signIn(page, OWNER_EMAIL);
  await page.goto('/jobs/list');
  if (page.viewportSize()!.width < 768) await page.getByRole('button', { name: /แสดงตัวกรอง/ }).click();
  await page.getByLabel('ตั้งแต่วันที่').fill('05/10/2026');
  await page.getByLabel('ถึงวันที่').fill('01/10/2026');
  await page.getByRole('button', { name: 'ค้นหา', exact: true }).click();
  await expect(page.getByText('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด')).toBeVisible();
});
