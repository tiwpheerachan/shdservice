import { E2E_SHOP, OWNER_EMAIL } from './support/env';
import { newJob, one } from './support/db';
import { expect, signIn, test } from './support/fixtures';

/**
 * The job form's warnings (src/components/jobs/product-fields.tsx): shown under a field once the typing settles,
 * never stopping a save — and the two Serial ticks / the typed-before suggestions next to them.
 * Driven on แก้ไขข้อมูลงาน (the same fields as เปิดงานใหม่) with legacy rows from support/db.ts.
 */
const serialBox = (page: import('@playwright/test').Page) => page.getByRole('textbox', { name: /^Serial No\./ });
const saveEdit = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
  await expect(page.getByText('บันทึกการแก้ไขงานแล้ว').first()).toBeVisible();
};

test('a Serial typed with the keyboard left on Thai: one tap writes what was meant', async ({ page }) => {
  const no = await newJob({ status: 2 });
  await signIn(page, OWNER_EMAIL);
  await page.goto(`/jobs/edit?no=${no}`);
  // "sn145" on the Kedmanee layout (its / and - stay as typed: they are characters a serial may have)
  await serialBox(page).fill('หืๅภถ');
  await expect(page.getByRole('status').filter({ hasText: 'แป้นพิมพ์เป็นภาษาไทยหรือเปล่า' })).toContainText('SN145');
  await page.getByRole('button', { name: 'ใช่ แก้ให้' }).click();
  await expect(serialBox(page)).toHaveValue('SN145');
  await expect(page.getByText('แป้นพิมพ์เป็นภาษาไทยหรือเปล่า')).toHaveCount(0);
});

test('a Serial already on another job: the warning links that job, ติ๊กงานเด้ง in one tap, and the save still goes through', async ({
  page,
}) => {
  const earlier = await newJob({ status: 9 }); // its serial: SN-<no> (newJob)
  const no = await newJob({ status: 2 });
  await signIn(page, OWNER_EMAIL);
  await page.goto(`/jobs/edit?no=${no}`);
  // the loaded serial is nobody's warning: an edit only warns about what was changed
  await expect(page.getByText('S/N นี้เคยเข้าซ่อมแล้ว')).toHaveCount(0);

  await serialBox(page).fill(`SN-${earlier}`);
  const warning = page.getByRole('status').filter({ hasText: 'S/N นี้เคยเข้าซ่อมแล้ว' });
  await expect(warning).toContainText('ลูกค้าคนเดิม');
  const link = warning.getByRole('link', { name: earlier });
  await expect(link).toHaveAttribute('href', `/jobs/edit?no=${earlier}`);
  await expect(link).toHaveAttribute('target', '_blank');

  await warning.getByRole('button', { name: 'ติ๊กงานเด้ง' }).click();
  await expect(page.getByRole('checkbox', { name: 'สินค้าเครื่องนี้เคยเข้าซ่อมแล้วกลับมาซ้ำ' })).toBeChecked();
  await expect(warning.getByRole('button', { name: 'ติ๊กงานเด้ง' })).toHaveCount(0);

  await saveEdit(page); // a warning, not a refusal
  const saved = await one<{ serial: string; bounce: boolean }>(
    'SELECT product_serial AS serial, is_job_bounce AS bounce FROM job WHERE job_no = $1',
    [no],
  );
  expect(saved).toEqual({ serial: `SN-${earlier}`, bounce: true });
  await expect(page.getByText('S/N นี้เคยเข้าซ่อมแล้ว')).toHaveCount(0); // saved = the job as loaded now
});

test('"รอ S/N จากลูกค้า" saves as the note and loads ticked, with what to do next', async ({ page }) => {
  const no = await newJob({ status: 2 });
  await signIn(page, OWNER_EMAIL);
  await page.goto(`/jobs/edit?no=${no}`);
  const waiting = page.getByRole('checkbox', { name: 'รอ S/N จากลูกค้า' });
  const none = page.getByRole('checkbox', { name: 'ไม่มี S/N / S/N เสียหาย' });
  await none.check();
  await waiting.check();
  await expect(none).not.toBeChecked(); // one or the other
  await expect(serialBox(page)).toBeDisabled();
  await saveEdit(page);
  expect(
    (await one<{ serial: string }>('SELECT product_serial AS serial FROM job WHERE job_no = $1', [no])).serial,
  ).toBe('รอ SN จากลูกค้า');

  await page.reload();
  await expect(waiting).toBeChecked();
  await expect(page.getByText('ยังรอ S/N จากลูกค้า — ได้แล้วเอาติ๊กออกแล้วใส่ S/N')).toBeVisible();
  await waiting.uncheck();
  await expect(serialBox(page)).toBeEnabled();
  await expect(serialBox(page)).toHaveValue('');
});

test('Shop Name offers the names typed before that contain what is typed; the one picked is saved', async ({
  page,
}) => {
  // a name typed on an earlier job (support/seed.ts — the server reads the names once per 5 minutes, so it is
  // there before the first read of every run, whatever spec or viewport asks first)
  const shop = E2E_SHOP;
  const no = await newJob({ status: 2 });
  await signIn(page, OWNER_EMAIL);
  await page.goto(`/jobs/edit?no=${no}`);

  const input = page.getByRole('combobox', { name: 'Shop Name' }); // an input with a list = a combobox;
  await input.fill('ร้านแนะนำ');
  const list = await input.getAttribute('list');
  await expect(page.locator(`[id="${list}"] option[value="${shop}"]`)).toHaveCount(1);
  await input.fill(shop); // what picking the browser's suggestion does (its list cannot be clicked from here)
  await saveEdit(page);
  expect(
    (await one<{ shop: string }>('SELECT product_sale_out_shop_name AS shop FROM job WHERE job_no = $1', [no])).shop,
  ).toBe(shop);
});
