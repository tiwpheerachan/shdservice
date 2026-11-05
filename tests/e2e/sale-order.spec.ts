import type { Page } from '@playwright/test';
import { E2E_CUSTOMER, MANAGER_EMAIL, SELLER_EMAIL, STOCK_EMAIL } from './support/env';
import { movementsOf, newPart, one, stockOf, userId, userUuid } from './support/db';
import { call, dismissToasts, expect, signIn, switchUser, test } from './support/fixtures';

/**
 * ใบสั่งขาย: a seller keys an order in and sends it for approval; a manager (special right SO Approve)
 * decides. Approval moves no stock: the Stock team then issues it on ตัดจ่ายอะไหล่ → จ่ายออกตามใบสั่งขาย — one
 * movement (inventory type 4), once. The creator never approves their own order; deny / send back need a reason.
 */
const PRICE = 150;

/** what the order holds in the database */
const orderState = (no: string) =>
  one<{ approve: number; created_by: number; sales: number; approve_by: number; remark: string; lines: string }>(
    `SELECT h.approve_status_id AS approve, h.created_by_app_user_pk::int AS created_by,
            h.sale_out_by_app_user_pk::int AS sales, h.approved_by_app_user_pk::int AS approve_by,
            coalesce(h.approve_remark, '') AS remark,
            -- a product line's code is the product's (sale_order_line.product_code: service lines / legacy only, ADR 0008)
            (SELECT string_agg(coalesce(p.product_code, d.product_code) || ' x' || d.sale_out_quantity || ' @' ||
                               d.sale_out_price::float, ', ')
               FROM sale_order_line d LEFT JOIN product p ON p.pk = d.product_pk WHERE d.sale_order_pk = h.pk) AS lines
       FROM sale_order h WHERE h.sale_order_no = $1`,
    [no],
  );

/** the order's uuid — its link; the number is what's shown and what the rows reference */
const soId = async (no: string) =>
  (await one<{ id: string }>('SELECT id::text AS id FROM sale_order WHERE sale_order_no = $1', [no])).id;

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

/** ตัดจ่ายอะไหล่ → จ่ายออกตามใบสั่งขาย: the order from the list of approved orders waiting, Get Data */
async function pickOrder(page: Page, no: string) {
  await page.goto('/stock/pick');
  await expect(page.getByRole('heading', { name: 'ตัดจ่ายอะไหล่' })).toBeVisible();
  await page.getByLabel('ประเภทเอกสาร').selectOption('จ่ายออกตามใบสั่งขาย');
  await page.getByRole('combobox', { name: /^อ้างอิงเลขเอกสาร/ }).click();
  await page.keyboard.type(no);
  await page.getByRole('option', { name: no }).click();
  await page.getByRole('button', { name: 'Get Data' }).click();
}

async function openOrder(page: Page, no: string) {
  await page.goto(`/sale/orders/edit?id=${await soId(no)}`);
  await expect(page.getByRole('heading', { name: 'แก้ไขใบสั่งขาย' })).toBeVisible();
  await expect(page.getByText(no, { exact: true })).toBeVisible();
}

test('a seller sends an order for approval; the manager approves it (no stock moves); Stock issues it once', async ({
  page,
}) => {
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
  const { no } = await one<{ no: string }>('SELECT sale_order_no AS no FROM sale_order WHERE id = $1', [
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
  await page.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'อนุมัติ', exact: true }).click();
  await expect(page.getByText('อนุมัติแล้ว').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'อนุมัติ', exact: true })).toHaveCount(0); // final: no decision left

  expect(await orderState(no)).toMatchObject({ approve: 4, approve_by: manager });
  expect(await movementsOf(no)).toEqual([]); // approval moves no stock
  expect(await stockOf(part.code)).toEqual({ available: 10, used: 0, booking: 0, remain: 10 });

  // approving again (a second tab, a stale screen) is refused
  const again = await approve(page, no, 'approve');
  expect(again.status).toBe(409);
  expect(again.body.error).toBe('อนุมัติไปแล้ว');

  // ตัดจ่ายอะไหล่: Stock issues the approved order
  await switchUser(page, STOCK_EMAIL);
  await pickOrder(page, no);
  const row = page.getByRole('row', { name: new RegExp(part.code) });
  await expect(row).toContainText('รอจ่าย');
  // the whole order in one go: every line at its full qty, not editable
  await expect(row.getByLabel(`จำนวนจ่ายออก ${part.code}`)).toHaveValue('3');
  await expect(row.getByLabel(`จำนวนจ่ายออก ${part.code}`)).not.toBeEditable();
  await expect(page.getByLabel('จ่ายให้')).toHaveCount(0); // the order is the movement's party
  await dismissToasts(page);
  await page.getByRole('button', { name: 'บันทึกการจ่ายออก' }).click();
  await expect(page.getByText('บันทึกการจ่ายออกแล้ว 3 ชิ้น')).toBeVisible();

  const out = await movementsOf(no);
  expect(out).toEqual([{ no: expect.stringMatching(/^WHO\d+$/), type: 4, code: part.code, qty: 3 }]);
  expect(await stockOf(part.code)).toEqual({ available: 10, used: 3, booking: 0, remain: 7 });
  // the order shows its WHO (the list's เลขจ่ายสต๊อก) and is no longer waiting for Stock
  const { body } = await call(page, 'GET', `/api/sale-orders/${await soId(no)}`);
  expect((body.order as { stockDoc: string }).stockDoc).toBe(out[0]!.no);
  expect(((await call(page, 'GET', '/api/stock/pick-orders')).body.rows as string[]).includes(no)).toBe(false);
  const [line] = (await call(page, 'GET', `/api/stock/pick-lines?type=sale&ref=${no}`)).body.rows as { dtId: string }[];
  const twice = await call(page, 'POST', '/api/stock/issue', {
    type: 'sale',
    ref: no,
    lines: [{ dtId: line!.dtId, qty: 3 }],
  });
  expect(twice.status).toBe(409); // "ตัดสต๊อกครบแล้ว (WHO…)"
  expect(twice.body.error).toContain(out[0]!.no);
  expect(await movementsOf(no)).toEqual(out);
  expect((await stockOf(part.code)).remain).toBe(7);
});

test('an order approved with too little stock: the approval passes, Stock cannot issue it until the parts arrive', async ({
  page,
}) => {
  const part = await newPart({ remain: 1, price: PRICE });
  await signIn(page, SELLER_EMAIL);
  const no = await createOrder(page, part.code, 3, SELLER_EMAIL);

  await switchUser(page, MANAGER_EMAIL);
  expect((await approve(page, no, 'approve')).status).toBe(200);
  expect(await movementsOf(no)).toEqual([]);

  await switchUser(page, STOCK_EMAIL);
  await pickOrder(page, no);
  const row = page.getByRole('row', { name: new RegExp(part.code) });
  await expect(row).toContainText('รออะไหล่');
  await expect(row).toContainText('เกินจำนวนคงเหลือในสต๊อก (มี 1)');
  await dismissToasts(page);
  await page.getByRole('button', { name: 'บันทึกการจ่ายออก' }).click();
  await expect(page.getByText('สต๊อกไม่พอ 1 รายการ').first()).toBeVisible();
  // the API refuses it too: the whole order or nothing
  const [line] = (await call(page, 'GET', `/api/stock/pick-lines?type=sale&ref=${no}`)).body.rows as { dtId: string }[];
  const short = await call(page, 'POST', '/api/stock/issue', {
    type: 'sale',
    ref: no,
    lines: [{ dtId: line!.dtId, qty: 3 }],
  });
  expect(short.status).toBe(409);
  expect(short.body.error).toContain(`${part.code} ต้องการ 3 คงเหลือ 1`);
  expect(((await call(page, 'GET', '/api/stock/pick-orders')).body.rows as string[]).includes(no)).toBe(true);
  expect(await movementsOf(no)).toEqual([]);
  expect((await stockOf(part.code)).remain).toBe(1);
});

test('two approvals of the same order at once (double click): one wins, no stock moves', async ({ page }) => {
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
  expect((await orderState(no)).approve).toBe(4);
  expect(await movementsOf(no)).toEqual([]);
  expect(await stockOf(part.code)).toEqual({ available: 10, used: 0, booking: 0, remain: 10 });
});

test('the creator of an order cannot approve it: no buttons, the API refuses, nothing moves', async ({ page }) => {
  const part = await newPart({ remain: 10, price: PRICE });
  await signIn(page, MANAGER_EMAIL); // holds SO Approve, but keys this order in himself
  const no = await createOrder(page, part.code, 1, MANAGER_EMAIL);

  await openOrder(page, no);
  await expect(page.getByText('คุณเป็นผู้สร้างใบสั่งขายนี้ อนุมัติเองไม่ได้', { exact: false })).toBeVisible();
  for (const name of ['อนุมัติ', 'ปฏิเสธ', 'ส่งกลับแก้ไข'])
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
