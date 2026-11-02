import { ENGINEER_EMAIL } from './support/env';
import { jobUuid, newJob, newPart, one, rows } from './support/db';
import { expect, signIn, test } from './support/fixtures';

/**
 * บันทึกงานซ่อม's เลือกจากรายการอะไหล่ของรุ่นนี้ (the legacy เบิกอะไหล่ popup): every ACTIVE part bound to the job's
 * model, ticked several at once — each lands in the parts table as a search pick would, with the plan ticked here.
 */
const linkToJobModel = (code: string) =>
  rows(
    `INSERT INTO product_compatible_model (product_pk, model_pk)
     VALUES ((SELECT pk FROM product WHERE product_code = $1), (SELECT pk FROM model WHERE model_code = 'E2E-M1'))`,
    [code],
  );

/** one() fails on a second line of the part */
const lineOf = (no: string, code: string) =>
  one(
    `SELECT l.spare_part_unit_price::float AS "unitPrice",
            l.is_special AS "aPick", l.is_quotation AS "aQuote", l.request_qty AS "aQty",
            l.is_special_b AS "bPick", l.is_quotation_b AS "bQuote", l.request_qty_b AS "bQty"
       FROM job_part l JOIN product p ON p.pk = l.product_pk
      WHERE l.job_pk = (SELECT pk FROM job WHERE job_no = $1) AND p.product_code = $2`,
    [no, code],
  );

test("the model's parts are listed in one click and several are added at once", async ({ page }) => {
  const inStock = await newPart({ remain: 3, price: 120 });
  const out = await newPart({ remain: 0, price: 80 });
  const unbound = await newPart({ remain: 1, price: 50 });
  const inactive = await newPart({ remain: 1, price: 60 });
  await rows(`UPDATE product SET record_status = 'INACTIVE' WHERE product_code = $1`, [inactive.code]);
  // a legacy second product_stock row: the products list left-joins it, so the part comes back twice
  const twoStock = await newPart({ remain: 5, price: 250 });
  await rows(
    `INSERT INTO product_stock (product_pk, quantity_available, quantity_used, quantity_booking, quantity_remain,
                                retail_price, wholesale_price, capital_price)
     SELECT pk, 0, 0, 0, 0, 250, 0, 0 FROM product WHERE product_code = $1`,
    [twoStock.code],
  );
  for (const p of [inStock, out, inactive, twoStock]) await linkToJobModel(p.code);
  const no = await newJob({ status: 2 }); // model E2E-M1

  await signIn(page, ENGINEER_EMAIL);
  await page.goto(`/jobs/repair?id=${await jobUuid(no)}`);
  await page.getByRole('button', { name: 'เลือกจากรายการอะไหล่ของรุ่นนี้' }).click();
  const dialog = page.getByRole('dialog', { name: /^อะไหล่ของรุ่น / });
  const list = dialog.getByRole('region', { name: 'อะไหล่ของรุ่น' });
  const row = (code: string) => list.getByRole('row', { name: new RegExp(code) });
  // cells: # · รหัส · ชื่อ · คงเหลือ · ราคา · A เบิก / เสนอ / จำนวน / เป็นเงิน · B the same
  const cell = (code: string, n: number) => row(code).getByRole('cell').nth(n);
  await expect(cell(inStock.code, 3)).toHaveText('3');
  await expect(cell(out.code, 3)).toHaveText('0');
  await expect(row(twoStock.code)).toHaveCount(1);
  await expect(row(unbound.code)).toHaveCount(0);
  await expect(row(inactive.code)).toHaveCount(0);

  // เบิก without เสนอ is not charged — the row says so before it is added
  await dialog.getByLabel(`เบิก แบบ A ${inStock.code}`).click();
  await dialog.getByLabel(`จำนวน แบบ A ${inStock.code}`).fill('2');
  await expect(cell(inStock.code, 8)).toHaveText('0.00');
  // a Qty with nothing ticked asks for nothing
  await dialog.getByLabel(`จำนวน แบบ A ${out.code}`).fill('4');
  await dialog.getByLabel(`เสนอ แบบ B ${out.code}`).click();
  await dialog.getByLabel(`เบิก แบบ A ${twoStock.code}`).click();
  await dialog.getByLabel(`เสนอ แบบ A ${twoStock.code}`).click();
  await expect(cell(twoStock.code, 8)).toHaveText('250.00');
  await dialog.getByRole('button', { name: 'เพิ่ม 3 รายการ' }).click();
  await expect(dialog).toHaveCount(0);

  // the table on a desktop; the phone cards carry the same labels but are hidden
  const field = (label: string) => page.getByLabel(label).filter({ visible: true });
  await expect(field(`เบิก แบบ A ${inStock.code}`)).toBeChecked();
  await expect(field(`เสนอ แบบ A ${inStock.code}`)).not.toBeChecked();
  await expect(field(`จำนวน แบบ A ${inStock.code}`)).toHaveValue('2');
  await expect(field(`เบิก แบบ A ${out.code}`)).not.toBeChecked();
  await expect(field(`จำนวน แบบ A ${out.code}`)).toHaveValue('');
  await expect(field(`เสนอ แบบ B ${out.code}`)).toBeChecked();
  await expect(field(`จำนวน แบบ B ${out.code}`)).toHaveValue('1');
  await expect(field(`เบิก แบบ A ${twoStock.code}`)).toHaveCount(1);

  // a part already in the table is shown as such, not offered twice
  await page.getByRole('button', { name: 'เลือกจากรายการอะไหล่ของรุ่นนี้' }).click();
  await expect(row(inStock.code)).toContainText('อยู่ในรายการแล้ว');
  await expect(dialog.getByLabel(`เบิก แบบ A ${inStock.code}`)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'ยกเลิก' }).click();

  await page.getByRole('button', { name: 'บันทึกงานซ่อม' }).click();
  await expect(page.getByText('บันทึกงานซ่อมเรียบร้อย')).toBeVisible();
  // the stored unit price is the part's retail price, as for a part picked in the search
  expect(await lineOf(no, inStock.code)).toEqual({
    unitPrice: 120,
    aPick: true,
    aQuote: false,
    aQty: 2,
    bPick: false,
    bQuote: false,
    bQty: 0,
  });
  expect(await lineOf(no, out.code)).toEqual({
    unitPrice: 80,
    aPick: false,
    aQuote: false,
    aQty: 0,
    bPick: false,
    bQuote: true,
    bQty: 1,
  });
  expect(await lineOf(no, twoStock.code)).toEqual({
    unitPrice: 250,
    aPick: true,
    aQuote: true,
    aQty: 1,
    bPick: false,
    bQuote: false,
    bQty: 0,
  });
});
