import { OWNER_EMAIL } from './support/env';
import { jobUuid, newJob, one } from './support/db';
import { expect, signIn, test } from './support/fixtures';

const THAI = 'หมู่บ้านสวนสยาม ซอยลาดพร้าว ถนนเจริญกรุง อาคารศูนย์การค้า ตำบลสำโรงเหนือ ';
const text = (n: number) => THAI.repeat(Math.ceil(n / THAI.length)).slice(0, n - 1) + 'ก';

test('a 500-character customer address: 501 keeps the text and is refused in Thai, 500 saves and comes back whole', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'chromium', 'the form rules are not viewport-dependent');
  const name = `E2E ที่อยู่ยาว ${Date.now()}`;
  const address = text(500);
  const lane = text(500);
  await signIn(page, OWNER_EMAIL);
  await page.goto('/customers');
  await page.getByRole('button', { name: 'เพิ่มลูกค้า' }).click();
  const form = page.getByRole('dialog', { name: 'เพิ่มลูกค้าใหม่' });
  await form.getByLabel('ชื่อลูกค้า').fill(name);
  await form.getByLabel('เบอร์โทรศัพท์').fill(`08${String(Date.now()).slice(-8)}`);
  const box = form.getByLabel('ที่อยู่ เลขที่');
  await box.fill(`${address}x`);
  await form.getByLabel('ซอย - ถนน').fill(lane);
  await form.getByRole('button', { name: 'บันทึกข้อมูล' }).click();
  await expect(form.getByText('ที่อยู่ ยาวเกิน 500 ตัวอักษร')).toBeVisible();
  await expect(box).toHaveValue(`${address}x`);

  await box.fill(address);
  await form.getByRole('button', { name: 'บันทึกข้อมูล' }).click();
  await expect(form).toBeHidden();
  const saved = await one<{ a: string; b: string; id: string }>(
    `SELECT customer_address1 AS a, customer_address2 AS b, customer_code AS id FROM customer WHERE customer_name = $1`,
    [name],
  );
  expect(saved.a).toBe(address.trim());
  expect(saved.b).toBe(lane.trim());
});

test('อุปกรณ์ / จุดตำหนิ / Shop Name: 501 keeps the text and is refused in Thai, 500 saves and comes back whole', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'chromium', 'the form rules are not viewport-dependent');
  const no = await newJob({ status: 2 });
  const url = `/jobs/edit?id=${await jobUuid(no)}`;
  await signIn(page, OWNER_EMAIL);
  await page.goto(url);
  const equipment = page.getByLabel('อุปกรณ์ (ที่นำส่ง)');
  const fault = page.getByLabel('จุดตำหนิ');
  const shop = page.getByLabel('Shop Name');
  await equipment.fill(`${text(500)}x`);
  await fault.fill(text(500));
  await shop.fill(text(500));
  await page.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
  await expect(page.getByText('อุปกรณ์ ยาวเกิน 500 ตัวอักษร').first()).toBeVisible();
  await expect(equipment).toHaveValue(`${text(500)}x`);

  await equipment.fill(text(500));
  await page.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
  await expect(page.getByText('บันทึกการแก้ไขงานแล้ว').first()).toBeVisible();
  await page.goto(url);
  await expect(equipment).toHaveValue(text(500).trim());
  await expect(fault).toHaveValue(text(500).trim());
  await expect(shop).toHaveValue(text(500).trim());
});
