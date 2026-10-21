import type { Page } from '@playwright/test';
import { E2E_CUSTOMER, OWNER_EMAIL, STAFF_EMAIL } from './support/env';
import { newJob, newPart, newPartLine, one, rows } from './support/db';
import { expect, signIn, test } from './support/fixtures';

/**
 * A page's first data comes in the HTML (src/server/prefetch.ts → <Prefetched>): with every browser
 * request to the read API cut off, the rows / the record are still on screen. And it goes through the
 * API's own permission checks: a role that may not see a page gets none of its data in the HTML.
 */
const READ_API = /\/api\/(data|jobs|quotations)\//;

async function offline(page: Page) {
  const asked: string[] = [];
  await page.route(READ_API, (route) => {
    asked.push(new URL(route.request().url()).pathname);
    return route.abort();
  });
  return asked;
}

/** a quotation of the e2e customer, as a legacy row (Q97 + 5 digits: a series the app never issues) */
async function newQuotation(remark: string): Promise<string> {
  const { no } = await one<{ no: string }>(
    `SELECT 'Q97' || lpad((coalesce(max(substring(quotation_no FROM 4)::int), 0) + 1)::text, 5, '0') AS no
       FROM quotation_hd WHERE quotation_no ~ '^Q97[0-9]{5}$'`,
  );
  await rows(
    `INSERT INTO quotation_hd (quotation_no, customer_code, create_date, create_by, remark, quotation_status_id,
                               is_active, record_status)
     VALUES ($1, $2, now(), -1, $3, 1, true, 'ACTIVE')`,
    [no, E2E_CUSTOMER, remark],
  );
  return no;
}

test('the job list, a job and a quotation open with the read API cut off', async ({ page }) => {
  const no = await newJob({ status: 2 });
  const remark = `E2E prefetch ${Date.now()}`;
  const qno = await newQuotation(remark);
  await signIn(page, OWNER_EMAIL);
  const asked = await offline(page);

  await page.goto(`/jobs/list?no=${no}`);
  await expect(page.getByRole('heading', { name: 'รายการงานทั้งหมด' })).toBeVisible();
  await expect(page.getByRole('cell', { name: no, exact: true }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  // the list and its counts came with the page; only the lookups (staff) were asked for
  expect(asked.filter((p) => /\/api\/data\/(jobs|job_stats)$/.test(p))).toEqual([]);

  await page.goto(`/jobs/repair?job=${no}`);
  await expect(page.getByRole('heading', { name: 'บันทึกงานซ่อม' })).toBeVisible();
  await expect(page.getByLabel('หมายเลขงานซ่อม')).toHaveText(no);
  await expect(page.getByLabel('ประเภทงานซ่อม')).toContainText('E2E ซ่อม');
  // the form is filled from the job that came with the page (onRecord), as after a read
  await expect(page.getByLabel('รหัสลูกค้า')).toHaveValue(E2E_CUSTOMER);

  await page.goto(`/quotation/edit?no=${qno}`);
  await expect(page.getByRole('heading', { name: 'แก้ไขใบเสนอราคา' })).toBeVisible();
  await expect(page.getByLabel('หมายเหตุ')).toHaveValue(remark);

  expect(asked.filter((p) => p.startsWith('/api/jobs/') || p.startsWith('/api/quotations/'))).toEqual([]);
});

test('the other list pages open with their first page and counts from the HTML', async ({ page }) => {
  await signIn(page, OWNER_EMAIL);
  expect(await (await page.request.get('/customers')).text()).toContain(E2E_CUSTOMER); // the rows are in the HTML
  const asked = await offline(page);
  await page.goto('/customers');
  await expect(page.getByRole('cell', { name: E2E_CUSTOMER, exact: true }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  for (const path of ['/jobs/dashboard', '/stock/products', '/sale/orders', '/reports/open-job']) {
    await page.goto(path);
    await expect(page.locator('main h1').first()).toBeVisible();
    await page.waitForLoadState('networkidle'); // hydrated, and every hook that wanted to read has asked
  }
  // every one of these came with its page (a key the hook builds differently would be asked for here)
  expect(
    asked.filter((p) =>
      /^\/api\/data\/(customers|dashboard|jobs|products|product_stats|sale_orders|job_summary)$/.test(p),
    ),
  ).toEqual([]);
});

test('a role that may not see a page gets none of its data in the HTML', async ({ page }) => {
  // the owner's customers page carries the rows in its HTML (the test above) — a role without Customer
  // view gets the same refusal as before (the API says 403 → nothing prefetched), and no customer in the HTML
  await signIn(page, STAFF_EMAIL);
  expect(await (await page.request.get('/customers')).text()).not.toContain(E2E_CUSTOMER);
  await page.goto('/customers');
  await expect(page.getByText('ไม่มีสิทธิ์เข้าหน้า', { exact: false }).first()).toBeVisible();
  await expect(page).not.toHaveURL(/\/customers/);
});

/** React's hydration-mismatch reports (production: minified errors #418 / #423 / #425) */
function hydrationErrors(page: Page): string[] {
  const seen: string[] = [];
  const mismatch = /hydrat|#418|#423|#425/i;
  page.on('console', (m) => m.type() === 'error' && mismatch.test(m.text()) && seen.push(m.text()));
  page.on('pageerror', (e) => mismatch.test(e.message) && seen.push(e.message));
  return seen;
}

/** a role holding Job Take and one active person in it, so มอบหมายงานนี้ให้'s hint names a role (kept between
 *  runs: the server caches the staff list, an earlier spec may have read it before this one inserts) */
async function ensureTaker() {
  await rows(`INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view)
              SELECT 'E2E Taker', 'Job Take', false, false, false, true
               WHERE NOT EXISTS (SELECT 1 FROM app_config WHERE user_type = 'E2E Taker' AND module_name = 'Job Take')`);
  await rows(`INSERT INTO app_user (username, password, first_name, user_type, is_active, email_address, record_status)
              SELECT 'e2e-taker', '', 'E2E Taker', 'E2E Taker', true, 'taker@e2e-prefetch.test', 'ACTIVE'
               WHERE NOT EXISTS (SELECT 1 FROM app_user WHERE email_address = 'taker@e2e-prefetch.test')`);
}

test('the repair form is filled in the HTML itself, and hydrates without a mismatch', async ({ page }) => {
  const no = await newJob({ status: 2 });
  const { name } = await one<{ name: string }>('SELECT customer_name AS name FROM customer WHERE customer_code = $1', [
    E2E_CUSTOMER,
  ]);
  const part = await newPart({ remain: 5, price: 1500 });
  await newPartLine({ jobNo: no, code: part.code, price: 1500, qty: 1, granted: 0 });
  const file = `e2e-prefetch-${no}.pdf`;
  // id from the sequence: an explicit max+1 leaves it behind and the next insert (app or test:db) collides
  await rows(
    `INSERT INTO document_attach (reference_topic, reference_item_code, original_file_name,
                                  system_file_name, remark, is_active, record_status)
     VALUES ('Jobs', $1, $2, $2, '', true, 'ACTIVE')`,
    [no, file],
  );
  await ensureTaker();
  const qno = await newQuotation(`E2E hydrate ${Date.now()}`);
  await signIn(page, OWNER_EMAIL);
  // มอบหมายงานนี้ให้'s hint as the staff list makes it (the roles holding รับงานซ่อม right now)
  const staff = (await (await page.request.get('/api/data/staff?deleted=exclude')).json()) as {
    userType: string;
    takesJobs: boolean;
  }[];
  const takers = [...new Set(staff.filter((s) => s.takesJobs && s.userType).map((s) => s.userType))].join(', ');
  const hint = `เฉพาะผู้มีสิทธิ์ "รับงานซ่อม"${takers ? ` (ตอนนี้: ${takers})` : ''}`;

  // the server-rendered form already holds the job's values (built at first render, not by an effect) —
  // its part line, its file and the hint made from the staff lookup too
  const html = await (await page.request.get(`/jobs/repair?job=${no}`)).text();
  expect(html).toContain(`value="${name}"`);
  expect(html).toContain(`value="SN-${no}"`);
  expect(html).toContain(`>${part.code}</td>`); // rendered, not only in the page's data payload
  expect(html).toContain(`${file}</a>`);
  expect(html).toContain(hint.replaceAll('"', '&quot;'));

  // nothing from the API at all (lookups included): the form is still filled
  const asked: string[] = [];
  await page.route('**/api/**', (route) => {
    asked.push(new URL(route.request().url()).pathname);
    return route.abort();
  });
  const errors = hydrationErrors(page);
  await page.goto(`/jobs/repair?job=${no}`);
  await expect(page.getByRole('textbox', { name: /^ชื่อลูกค้า/ })).toHaveValue(name);
  await expect(page.getByRole('textbox', { name: /^Serial No\./ })).toHaveValue(`SN-${no}`);
  // the part line: a table row from md up, a card (list item) on a phone — only one of them is shown
  const parts = page.getByRole('region', { name: 'รายการอะไหล่' });
  const line = parts
    .getByRole('row', { name: new RegExp(part.code) })
    .or(page.getByRole('listitem').filter({ hasText: part.code }));
  await expect(line).toContainText('1,500.00');
  await expect(line.getByLabel(`จำนวน แบบ A ${part.code}`)).toHaveValue('1');
  await expect(page.getByRole('link', { name: file })).toBeVisible();
  await expect(page.getByText(hint, { exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  // the symptom lists are read once a symptom picker is used, not with the page
  const symptomLists = (p: string) => /^\/api\/data\/(symptoms|symptom_stats|model_symptoms)$/.test(p);
  expect(asked.filter(symptomLists)).toEqual([]);
  await page.getByRole('combobox', { name: /อาการเสียที่ตรวจพบ/ }).focus();
  await expect.poll(() => asked.filter(symptomLists).length).toBeGreaterThan(0);

  await page.goto(`/quotation/edit?no=${qno}`);
  await expect(page.getByRole('heading', { name: 'แก้ไขใบเสนอราคา' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(errors, 'hydration mismatches').toEqual([]);
});
