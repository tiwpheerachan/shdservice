import type { Page } from '@playwright/test';
import { TOURS } from '../../src/components/tour/tours';
import { OWNER_EMAIL } from './support/env';
import { rows, userId } from './support/db';
import { expect, signIn, test } from './support/fixtures';
import { card, demoUrl, stepTo, tourOn, walkTour } from './support/tour';

/**
 * บทสอน — what a new user sees must be right on every page and screen size: the steps in reading order, only
 * the fields the card names lit, the card clear of them, the page locked, nothing saved, the form (and a dialog
 * the tour opened) as it was before. เปิดงานใหม่ is checked in depth; every other tour by the walk below.
 */
const total = TOURS['/jobs/new']!.steps.length;

/** the เปิดงานใหม่ walk: every step there (nothing hidden for the owner) */
async function walk(page: Page) {
  await page.goto('/jobs/new');
  expect(await walkTour(page, 'offer'), 'no step left out on this screen').toBe(total);
}

for (const [path, tour] of Object.entries(TOURS))
  test(`บทสอน ${tour.title} (${path}): every step checked in every state of the page, nothing saved`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, OWNER_EMAIL);
    const writes: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (r.method() !== 'GET' && u.pathname.startsWith('/api/') && u.pathname !== '/api/me/tour')
        writes.push(`${r.method()} ${u.pathname}`);
    });
    // a write the page tried and the tour's last guard refused is a step that let it happen
    page.on('console', (m) => m.text().startsWith('[tour] refused') && writes.push(m.text()));
    for (const raw of [path, ...(tour.demo ?? [])]) {
      const url = await demoUrl(page, raw);
      writes.length = 0; // a demo's own fixture (a draft sale order) is made before the walk
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      const n = await walkTour(page);
      expect(n, `${url}: more than the welcome card`).toBeGreaterThan(1);
      await card(page).getByRole('button', { name: 'เสร็จสิ้น' }).click();
      await expect(card(page)).toHaveCount(0);
      await expect(
        page.locator('[role="dialog"][data-state="open"]'),
        `${url}: a dialog it opened is closed`,
      ).toHaveCount(0);
      expect(new URL(page.url()).pathname, `${url}: still on the page`).toBe(new URL(url, 'http://x').pathname);
      expect(writes, `${url}: nothing saved`).toEqual([]);
    }
  });

test('every step: reading order, only its own fields lit, the card clear of them (one profile, then several)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, OWNER_EMAIL);
  await tourOn();
  await walk(page);
  await card(page).getByRole('button', { name: 'เสร็จสิ้น' }).click();

  // several profiles: ออกเอกสารในนาม shows (and moves the row after it) — the same checks hold. Added to the
  // answer (the server caches the profile list, a row inserted now would show minutes later)
  await page.route('**/api/data/document_profiles*', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as unknown;
    const add = (list: Record<string, unknown>[]) => [
      ...list,
      { ...list[0], id: 99_999, code: 'E2ETOUR', nameTh: 'E2E บทสอน', isDefault: false },
    ];
    const out = Array.isArray(body)
      ? add(body as Record<string, unknown>[])
      : { ...(body as object), rows: add((body as { rows: Record<string, unknown>[] }).rows) };
    await route.fulfill({ response: res, json: out });
  });
  await tourOn();
  await page.goto('/jobs/new');
  await expect(page.getByText('ออกเอกสารในนาม').first()).toBeVisible();
  expect(await walkTour(page, 'offer')).toBe(total);
  await page.goto('/jobs/new'); // the ออกเอกสารในนาม sentence is there only when the field is
  await page.getByRole('button', { name: 'สอนการใช้งานหน้านี้' }).click();
  await card(page).getByRole('button', { name: 'เริ่มเลย' }).click();
  await card(page).getByRole('button', { name: 'ถัดไป' }).click();
  await expect(card(page)).toContainText('ออกเอกสารในนาม');
});

test('the page is locked, nothing is saved, the form goes back to how it was, the dropdown stays clear', async ({
  page,
}) => {
  await signIn(page, OWNER_EMAIL);
  await tourOn();
  await page.goto('/jobs/new');
  await page.getByRole('button', { name: 'ไม่ใช่ตอนนี้' }).click();
  // a real entry made before the tour stays; what is tried during it goes
  await page.getByRole('combobox', { name: 'จุดตำหนิ' }).fill('รอยจริงก่อนบทสอน');
  let posts = 0;
  page.on('request', (r) => r.method() === 'POST' && /\/api\/(jobs|customers|upload)/.test(r.url()) && posts++);

  await page.getByRole('button', { name: 'สอนการใช้งานหน้านี้' }).click();
  await card(page).getByRole('button', { name: 'เริ่มเลย' }).click();
  // the customer search opened from the lit field: the card never covers it
  await page.locator('[data-tour-target]').getByRole('combobox').first().click();
  const dropdown = page.locator('[data-radix-popper-content-wrapper]');
  await expect(dropdown).toBeVisible();
  await page.waitForTimeout(150);
  const [d, c] = [await dropdown.boundingBox(), await card(page).boundingBox()];
  const apart =
    !d || !c || c.y >= d.y + d.height || c.y + c.height <= d.y || c.x >= d.x + d.width || c.x + c.width <= d.x;
  expect(apart, 'the card is clear of the open dropdown').toBe(true);
  await page.keyboard.press('Escape'); // closes the dropdown only
  await expect(card(page)).toBeVisible();
  // the customer picker's own draft goes too: ลูกค้าใหม่ chosen and a name typed during the tour
  await page.getByRole('radio', { name: /^ลูกค้าใหม่/ }).check();
  await page
    .getByRole('textbox', { name: /^ชื่อลูกค้า/ })
    .first()
    .fill('ลูกค้าทดลองบทสอน');
  await page.getByRole('button', { name: 'บันทึกลูกค้าใหม่' }).click({ force: true }); // tried, never saved

  // ⌘K / Ctrl+K: the menu search does not open over the tour
  await card(page).getByRole('button', { name: 'ถัดไป' }).focus();
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(300);
  await expect(page.locator('[cmdk-root]')).toHaveCount(0);

  for (let k = 1; k < total - 1; k++) {
    const title = await card(page).locator('#tour-title').innerText();
    if (title.startsWith('ของที่มากับเครื่อง')) {
      await page.getByRole('combobox', { name: 'อุปกรณ์ (ที่นำส่ง)' }).fill('ลองระหว่างบทสอน');
      await page.getByRole('combobox', { name: 'จุดตำหนิ' }).fill('ลองแก้ระหว่างบทสอน');
    }
    if (title === 'งานเด้ง') {
      // a lit checkbox (a <button role=checkbox>) ticks like any lit field
      await page.getByRole('checkbox', { name: /เคยเข้าซ่อมแล้วกลับมาซ้ำ/ }).click();
      await expect(page.getByRole('checkbox', { name: /เคยเข้าซ่อมแล้วกลับมาซ้ำ/ })).toBeChecked();
    }
    if (title.startsWith('ประกันและเลขเครื่อง')) {
      await page.getByRole('checkbox', { name: /ไม่มี S\/N/ }).click();
      await expect(page.getByRole('checkbox', { name: /ไม่มี S\/N/ })).toBeChecked();
      // every lit field takes typing (lit = usable)
      await page.getByRole('textbox', { name: /^Imei No\./ }).fill('350000000000000');
      await expect(page.getByRole('textbox', { name: /^Imei No\./ })).toHaveValue('350000000000000');
    }
    if (title.startsWith('แนบรูป')) {
      const chooser = page.waitForEvent('filechooser', { timeout: 1000 }).then(
        () => true,
        () => false,
      );
      await page.getByText('เลือกไฟล์แนบ', { exact: false }).first().click({ force: true });
      expect(await chooser, 'no file chooser during the tour').toBe(false);
    }
    if (title === 'บันทึกเปิดงาน') {
      await page.getByRole('button', { name: 'บันทึกเปิดงาน' }).click({ force: true });
      await expect(page.locator('[id$="-error"]'), 'บันทึก never ran').toHaveCount(0);
    }
    await card(page).getByRole('button', { name: 'ถัดไป' }).click();
  }
  // something was tried: the last card says the form goes back — no toast over the form after it
  await expect(card(page)).toContainText('จบแล้วฟอร์มกลับเป็นเหมือนเดิม');
  await card(page).getByRole('button', { name: 'เสร็จสิ้น' }).click();
  await expect(card(page)).toHaveCount(0);
  expect(posts, 'nothing saved').toBe(0);
  await expect(page.locator('[data-sonner-toast]'), 'no toast after เสร็จสิ้น').toHaveCount(0);
  await expect.poll(() => page.evaluate(() => scrollY), { message: 'back at the top' }).toBe(0);
  await expect(page.getByRole('combobox', { name: 'จุดตำหนิ' })).toHaveValue('รอยจริงก่อนบทสอน');
  await expect(page.getByRole('combobox', { name: 'อุปกรณ์ (ที่นำส่ง)' })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: /^Imei No\./ })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'สอนการใช้งานหน้านี้' })).toBeFocused();
  await expect(page.getByRole('radio', { name: /^ลูกค้าเดิม/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /เคยเข้าซ่อมแล้วกลับมาซ้ำ/ })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /ไม่มี S\/N/ })).not.toBeChecked();
  await expect(page.getByText('ลูกค้าทดลองบทสอน')).toHaveCount(0);

  // asked once: not again on the next visit · Esc leaves
  await page.reload();
  await page.waitForTimeout(1200);
  await expect(page.getByRole('button', { name: 'เริ่มบทสอน' })).toHaveCount(0);
  await page.getByRole('button', { name: 'สอนการใช้งานหน้านี้' }).click();
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
  // skipped: one short note, at the top centre (clear of the form and its save bar)
  await expect(
    page.locator('[data-sonner-toaster][data-y-position="top"]').getByText('ดูบทสอนอีกครั้งได้ที่ปุ่ม ? ด้านบน'),
  ).toBeVisible();
});

test('dashboard TAT step: the table is scrolled to its last column (Over 30 Days / Total on a phone), the card clear of it', async ({
  page,
}) => {
  await signIn(page, OWNER_EMAIL);
  await page.goto('/jobs/dashboard');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'สอนการใช้งานหน้านี้' }).click();
  await stepTo(page, (t) => t === 'TAT');
  const table = page.locator('main [aria-label="จำนวนงานตามสถานะและ TAT"]');
  // the header row is lit, not the whole table (taller than a phone with 24 statuses)
  await expect(table.locator('thead')).toHaveAttribute('data-tour-target', '');
  await expect
    .poll(
      () =>
        table.evaluate((t) => {
          const th = t.querySelector('thead th:last-child')!.getBoundingClientRect();
          return th.right <= t.getBoundingClientRect().right + 1;
        }),
      { message: 'the last column is in view' },
    )
    .toBe(true);
  // the status column stays on the left while it scrolls sideways
  const [region, status] = await Promise.all([table.boundingBox(), table.locator('thead th').nth(1).boundingBox()]);
  expect((status?.x ?? -1) >= (region?.x ?? 0) - 1, 'สถานะงาน is not scrolled away').toBe(true);
});

test('a phone on its side (844×390): the card is shown small and covers none of the fields', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 844, height: 390 });
  await signIn(page, OWNER_EMAIL);
  await tourOn();
  // as many technicians as on the real data: the มอบหมายงานนี้ให้ list is taller than the room around its field
  await page.route('**/api/data/staff*', async (route) => {
    const res = await route.fetch();
    const list = (await res.json()) as Record<string, unknown>[];
    const one = list.find((x) => x.takesJobs) ?? list[0]!;
    const more = Array.from({ length: 30 }, (_, k) => ({
      ...one,
      id: 90_000 + k,
      userId: 90_000 + k,
      email: `tour-tech-${k}@e2e.test`,
      name: `ช่างทดสอบ ${k}`,
      takesJobs: true,
    }));
    await route.fulfill({ response: res, json: [...list, ...more] });
  });
  await walk(page);
  // the full text is one tap away, and can be put away again
  await card(page).getByRole('button', { name: 'ก่อนหน้า' }).click();
  await card(page).getByRole('button', { name: 'อ่านคำอธิบาย' }).click();
  await expect(card(page).locator('#tour-body')).toBeVisible();
  await card(page).getByRole('button', { name: 'ย่อคำอธิบาย' }).click();
  await expect(card(page).locator('#tour-body')).toBeHidden();
  // a dropdown of a field in the step's second row: its list opens on the screen, not past its top edge
  await card(page).getByRole('button', { name: 'ก่อนหน้า' }).click(); // 13 → 12
  await expect(card(page)).toContainText('ค่าใช้จ่าย ช่าง และวันเสร็จ');
  await page.waitForTimeout(450);
  await page.locator('[data-tour-target]').filter({ hasText: 'มอบหมายงานนี้ให้' }).getByRole('combobox').click();
  const list = page.locator('[data-radix-popper-content-wrapper]');
  await expect(list).toBeVisible();
  await expect
    .poll(async () => ((await list.boundingBox())?.y ?? -1) >= 0, { message: 'the list starts on the screen' })
    .toBe(true);
});

test('"ไม่ต้องถามอีก (ทุกหน้า)": kept for the account (a fresh page load reads it back), ? still starts a tour', async ({
  page,
}) => {
  await signIn(page, OWNER_EMAIL);
  await tourOn();
  await page.goto('/jobs/new');
  await page.getByRole('button', { name: 'ไม่ต้องถามอีก (ทุกหน้า)' }).click();
  await expect
    .poll(
      async () => (await rows('SELECT off FROM app_user_tour WHERE user_id = $1', [await userId(OWNER_EMAIL)]))[0]?.off,
    )
    .toBe(true);
  const other = Object.keys(TOURS).find((p) => p !== '/jobs/new') ?? '/jobs/new';
  await page.goto(other);
  await page.waitForTimeout(1200);
  await expect(page.getByRole('button', { name: 'เริ่มบทสอน' })).toHaveCount(0);
  await page.getByRole('button', { name: 'สอนการใช้งานหน้านี้' }).click();
  await expect(card(page)).toBeVisible();
});

test('unsaved edits and a link during a tour: no "leave?" dialog over it, the edit kept', async ({ page }) => {
  await signIn(page, OWNER_EMAIL);
  await page.goto(await demoUrl(page, '/jobs/repair?id={job}'));
  await page.getByLabel('วิธีการซ่อม').fill('ยังไม่บันทึก'); // the form has an unsaved edit before the tour
  await page.getByRole('button', { name: 'สอนการใช้งานหน้านี้' }).click();
  await expect(card(page)).toBeVisible();
  // a link (the sidebar's, hidden on a phone — dispatched): not followed, and nothing asks to leave
  await page.locator('a[href="/jobs/list"]').first().dispatchEvent('click');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/jobs/repair');
  await card(page).getByRole('button', { name: 'ข้ามบทสอน' }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByLabel('วิธีการซ่อม')).toHaveValue('ยังไม่บันทึก'); // what was there before stays
});

test('Enter in a lit box of a dialog step runs nothing: the dialog and the card stay (the page was left locked)', async ({
  page,
}) => {
  await signIn(page, OWNER_EMAIL);
  await page.goto('/admin/permissions');
  await page.getByRole('button', { name: 'สอนการใช้งานหน้านี้' }).click();
  await stepTo(page, (t) => t.startsWith('เพิ่มตำแหน่ง *')); // the dialog's first step (the tour opens it)
  const name = page.getByRole('dialog').getByLabel('ชื่อตำแหน่ง');
  await name.fill('ตำแหน่งทดสอบบทสอน');
  await name.press('Enter');
  await expect(name).toBeVisible(); // not added, the dialog still open
  await expect(card(page)).toBeVisible();
  await card(page).getByRole('button', { name: 'ข้ามบทสอน' }).click();
  await expect(page.locator('[role="dialog"][data-state="open"]')).toHaveCount(0);
  await expect(page.getByText('ตำแหน่งทดสอบบทสอน')).toHaveCount(0); // not left in the role picker
});
