import type { Page } from '@playwright/test';
import { E2E_CUSTOMER, MANAGER_EMAIL, SELLER_EMAIL } from './support/env';
import { movementsOf, newPart, one, stockOf, userId, userUuid } from './support/db';
import { call, expect, signIn, switchUser, test } from './support/fixtures';

/**
 * ใบสั่งขาย: a seller keys an order in and sends it for approval; a manager (special right SO Approve)
 * decides. Approval takes the stock out — one จ่ายออกตามใบสั่งขาย movement (inventory type 4), once, however
 * often it is sent. The creator never approves their own order; deny / send back need a reason and move nothing.
 */
const PRICE = 150;

/** what the order holds in the database */
const orderState = (no: string) =>
  one<{ approve: number; created_by: number; sales: number; approve_by: number; remark: string; lines: string }>(
    `SELECT h.approve_status_id AS approve, h.document_create_by AS created_by, h.sale_out_by AS sales,
            h.approve_by, coalesce(h.approve_remark, '') AS remark,
            (SELECT string_agg(d.product_code || ' x' || d.sale_out_quantity || ' @' || d.sale_out_price::float, ', ')
               FROM sale_out_dt d WHERE d.sale_out_hd_no = h.sale_out_hd_no) AS lines
       FROM sale_out_hd h WHERE h.sale_out_hd_no = $1`,
    [no],
  );

/** the order's uuid — its link (ADR 0008); the number is what's shown and what the rows reference */
const soId = async (no: string) =>
  (await one<{ id: string }>('SELECT id::text AS id FROM sale_out_hd WHERE sale_out_hd_no = $1', [no])).id;

/** an order sent for approval through the API, as the signed-in user (the UI path is the first test's) */
async function createOrder(page: Page, code: string, qty: number, salesEmail: string): Promise<string> {
  const r = await call(page, 'POST', '/api/sale-orders', {
    customerCode: E2E_CUSTOMER,
    salesId: await userUuid(salesEmail),
    lines: [{ code, qty, price: PRICE, name: '', type: 'SparePart' }],
    paymentType: '',
    paymentAmount: '',
    slip: '',
    remark: '',
    submit: true,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return (r.body.order as { no: string }).no;
}

async function approve(page: Page, no: string, decision: 'approve' | 'deny' | 'reject', remark = '') {
  const id = await soId(no);
  const { body } = await call(page, 'GET', `/api/sale-orders/${id}`);
  const version = (body.order as { version: number }).version;
  return call(page, 'POST', `/api/sale-orders/${id}/approve`, { decision, remark, version });
}

async function openOrder(page: Page, no: string) {
  await page.goto(`/sale/orders/edit?id=${await soId(no)}`);
  await expect(page.getByRole('heading', { name: 'แก้ไขใบสั่งขาย' })).toBeVisible();
  await expect(page.getByText(no, { exact: true })).toBeVisible();
}

test('a seller sends an order for approval; the manager approves it and the stock goes out once', async ({ page }) => {
  const part = await newPart({ remain: 10, price: PRICE });
  const [seller, manager] = [await userId(SELLER_EMAIL), await userId(MANAGER_EMAIL)];

  await signIn(page, SELLER_EMAIL);
  await page.goto('/sale/orders/new');
  await expect(page.getByRole('heading', { name: 'สร้างใบสั่งขาย' })).toBeVisible();
  // ลูกค้าเดิม: search-as-you-type
  await page.getByRole('combobox').filter({ hasText: 'พิมพ์ รหัส / ชื่อ / เบอร์โทร' }).click();
  await page.keyboard.type(E2E_CUSTOMER);
  await page.getByRole('option', { name: new RegExp(E2E_CUSTOMER) }).click();
  await expect(page.getByLabel('รหัสลูกค้า')).toHaveValue(E2E_CUSTOMER);
  await expect(page.getByLabel('พนักงานขาย')).toContainText('E2E Seller'); // the signed-in seller by default
  // the part picker searches on the server
  await page.getByLabel('รหัสสินค้า หรือ ชื่อสินค้า').click();
  await page.keyboard.type(part.code);
  await page.getByRole('option', { name: new RegExp(part.code) }).click();
  await page.getByLabel('จำนวน', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'เพิ่มรายการ' }).click();
  await expect(page.getByRole('row', { name: new RegExp(part.code) })).toContainText('คงเหลือ 10');
  await page.getByRole('radio', { name: 'ส่งขออนุมัติ' }).check();
  await page.getByRole('button', { name: 'บันทึกใบสั่งขาย' }).click();
  await page.waitForURL(/\/sale\/orders\/edit\?id=[0-9a-f-]{36}$/);
  const { no } = await one<{ no: string }>('SELECT sale_out_hd_no AS no FROM sale_out_hd WHERE id = $1', [
    new URL(page.url()).searchParams.get('id'),
  ]);
  await expect(page.getByText('รออนุมัติ', { exact: true })).toBeVisible();
  expect(await orderState(no)).toMatchObject({
    approve: 2,
    created_by: seller,
    sales: seller,
    lines: `${part.code} x3 @${PRICE}`,
  });
  expect(await movementsOf(no)).toEqual([]); // sending for approval moves nothing

  await switchUser(page, MANAGER_EMAIL);
  await openOrder(page, no);
  await page.getByRole('button', { name: 'อนุมัติ (ตัดสต๊อก)' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'อนุมัติ (ตัดสต๊อก)' }).click();
  await expect(page.getByText('อนุมัติแล้ว').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'อนุมัติ (ตัดสต๊อก)' })).toHaveCount(0); // final: no decision left

  expect(await orderState(no)).toMatchObject({ approve: 4, approve_by: manager });
  const out = await movementsOf(no);
  expect(out).toEqual([{ no: expect.stringMatching(/^WHO\d+$/), type: 4, code: part.code, qty: 3 }]);
  expect(await stockOf(part.code)).toEqual({ available: 10, used: 3, booking: 0, remain: 7 });

  // approving again (a second tab, a stale screen) is refused and takes nothing more
  const again = await approve(page, no, 'approve');
  expect(again.status).toBe(409);
  expect(again.body.error).toBe('อนุมัติไปแล้ว');
  expect(await movementsOf(no)).toEqual(out);
  expect((await stockOf(part.code)).remain).toBe(7);
});

test('two approvals of the same order at once (double click): one wins, the stock goes out once', async ({ page }) => {
  const part = await newPart({ remain: 10, price: PRICE });
  await signIn(page, SELLER_EMAIL);
  const no = await createOrder(page, part.code, 2, SELLER_EMAIL);

  await switchUser(page, MANAGER_EMAIL);
  await openOrder(page, no);
  const id = await soId(no);
  const { body } = await call(page, 'GET', `/api/sale-orders/${id}`);
  const version = (body.order as { version: number }).version;
  const statuses = await page.evaluate(
    async ({ id, version }) => {
      const post = () =>
        fetch(`/api/sale-orders/${id}/approve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'approve', remark: '', version }),
        }).then((r) => r.status);
      return Promise.all([post(), post()]);
    },
    { id, version },
  );
  expect(statuses.sort()).toEqual([200, 409]);
  expect(await movementsOf(no)).toEqual([{ no: expect.stringMatching(/^WHO\d+$/), type: 4, code: part.code, qty: 2 }]);
  expect(await stockOf(part.code)).toEqual({ available: 10, used: 2, booking: 0, remain: 8 });
});

test('the creator of an order cannot approve it: no buttons, the API refuses, nothing moves', async ({ page }) => {
  const part = await newPart({ remain: 10, price: PRICE });
  await signIn(page, MANAGER_EMAIL); // holds SO Approve, but keys this order in himself
  const no = await createOrder(page, part.code, 1, MANAGER_EMAIL);

  await openOrder(page, no);
  await expect(page.getByText('คุณเป็นผู้สร้างใบสั่งขายนี้ อนุมัติเองไม่ได้', { exact: false })).toBeVisible();
  for (const name of ['อนุมัติ (ตัดสต๊อก)', 'ปฏิเสธ', 'ส่งกลับแก้ไข'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);

  const r = await approve(page, no, 'approve');
  expect(r.status).toBe(403);
  expect(r.body.error).toBe('คุณเป็นผู้สร้างใบสั่งขายนี้ อนุมัติเองไม่ได้ — ให้ผู้มีสิทธิ์อนุมัติคนอื่นทำ');
  expect((await orderState(no)).approve).toBe(2);
  expect(await movementsOf(no)).toEqual([]);
  expect((await stockOf(part.code)).remain).toBe(10);
});

test('the manager denies an order with a reason: final, no stock moves', async ({ page }) => {
  const part = await newPart({ remain: 10, price: PRICE });
  await signIn(page, SELLER_EMAIL);
  const no = await createOrder(page, part.code, 4, SELLER_EMAIL);
  const reason = `ราคาไม่ถูกต้อง ${no}`;

  await switchUser(page, MANAGER_EMAIL);
  await openOrder(page, no);
  await page.getByRole('button', { name: 'ปฏิเสธ', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'ปฏิเสธ', exact: true })).toBeDisabled(); // no reason yet
  await dialog.getByLabel('เหตุผล').fill(reason);
  await dialog.getByRole('button', { name: 'ปฏิเสธ', exact: true }).click();
  await expect(page.getByText('ปฏิเสธแล้ว')).toBeVisible();
  await expect(page.getByRole('note').filter({ hasText: reason })).toHaveText(
    new RegExp(`^ปฏิเสธ: ${reason} — โดย E2E Manager`),
  );

  expect(await orderState(no)).toMatchObject({ approve: 5, remark: reason, approve_by: await userId(MANAGER_EMAIL) });
  expect(await movementsOf(no)).toEqual([]);
  expect(await stockOf(part.code)).toEqual({ available: 10, used: 0, booking: 0, remain: 10 });
  expect((await approve(page, no, 'approve')).status).toBe(409); // denied is final
});

test('the manager sends an order back with a reason (none → refused); nothing moves', async ({ page }) => {
  const part = await newPart({ remain: 10, price: PRICE });
  await signIn(page, SELLER_EMAIL);
  const no = await createOrder(page, part.code, 1, SELLER_EMAIL);
  const reason = `แก้จำนวน ${no}`;

  await switchUser(page, MANAGER_EMAIL);
  await openOrder(page, no);
  const bare = await approve(page, no, 'reject'); // the server asks for the reason too
  expect(bare.status).toBe(400);
  expect(bare.body.details?.fields?.remark).toBe('ต้องระบุเหตุผล');

  await page.getByRole('button', { name: 'ส่งกลับแก้ไข', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('เหตุผล').fill(reason);
  await dialog.getByRole('button', { name: 'ส่งกลับแก้ไข', exact: true }).click();
  await expect(page.getByText('ส่งกลับแก้ไขแล้ว')).toBeVisible();
  await expect(page.getByRole('note').filter({ hasText: reason })).toHaveText(
    new RegExp(`^ส่งกลับแก้ไข: ${reason} — โดย E2E Manager`),
  );

  expect(await orderState(no)).toMatchObject({ approve: 3, remark: reason });
  expect(await movementsOf(no)).toEqual([]);
  expect((await stockOf(part.code)).remain).toBe(10);
});
