import { OWNER_EMAIL } from './support/env';
import { expect, signIn, test } from './support/fixtures';
import { tourOn } from './support/tour';

test('the tour offer never sits over an open form: hidden while it is open, back once it is closed', async ({
  page,
}) => {
  await signIn(page, OWNER_EMAIL);
  await tourOn();
  await page.goto('/customers');
  const offer = page.locator('[data-tour-offer]');
  const form = page.getByRole('dialog', { name: 'เพิ่มลูกค้าใหม่' });

  // the first tap of the visit opens the form: the offer it wakes stays out of the way
  await page.getByRole('button', { name: 'เพิ่มลูกค้า' }).click();
  await form.getByLabel('ชื่อลูกค้า').fill('E2E ลูกค้า ไม่หาย');
  await expect(offer).toBeAttached();
  await expect(offer).toBeHidden();

  await form.getByRole('button', { name: 'ปิด' }).first().click();
  await expect(form).toBeHidden();
  await expect(offer).toBeVisible();

  // the offer up when a form opens: it steps aside, and what is typed stays
  await page.getByRole('button', { name: 'เพิ่มลูกค้า' }).click();
  await form.getByLabel('ชื่อลูกค้า').fill('E2E ลูกค้า ยังอยู่');
  await expect(offer).toBeHidden();
  await page.waitForTimeout(500);
  await expect(form.getByLabel('ชื่อลูกค้า')).toHaveValue('E2E ลูกค้า ยังอยู่');
});

test('the tour offer steps aside for a view dialog too (product details), already up when it opens', async ({
  page,
}) => {
  await signIn(page, OWNER_EMAIL);
  await tourOn();
  await page.goto('/stock/products');
  const offer = page.locator('[data-tour-offer]');
  await page.getByRole('button', { name: 'ดูรายละเอียด' }).first().click();
  // the offer is a (non-modal) dialog itself: the modal is the one Radix marks open
  const dialog = page.getByRole('dialog').and(page.locator('[data-state="open"]'));
  await expect(dialog).toBeVisible();
  await expect(offer).toBeAttached();
  await expect(offer).toBeHidden();
  await dialog.getByRole('button', { name: 'ปิด' }).first().click();
  await expect(dialog).toBeHidden();
  await expect(offer).toBeVisible();
  await page.getByRole('button', { name: 'ดูรายละเอียด' }).first().click();
  await expect(dialog).toBeVisible();
  await expect(offer).toBeHidden();
});
