import type { Page } from '@playwright/test';
import { E2E_CUSTOMER, OWNER_EMAIL } from './env';
import { jobUuid, newJob, newPart, one, rows, userId, userUuid } from './db';
import { call, expect } from './fixtures';

/** the บทสอน card */
export const card = (page: Page) => page.locator('[aria-describedby="tour-body"]');

/** the account asked afresh on every page (signIn turned the offer off for every other spec) */
export async function tourOn(email = OWNER_EMAIL) {
  await rows('DELETE FROM app_user_tour WHERE app_user_pk = $1', [await userId(email)]);
}

/** a legacy quotation of the e2e customer (Q97 + 5 digits: a series the app never issues) — its uuid (the link) */
async function newQuotation(): Promise<string> {
  const { no } = await one<{ no: string }>(
    `SELECT 'Q97' || lpad((coalesce(max(substring(quotation_no FROM 4)::int), 0) + 1)::text, 5, '0') AS no
       FROM quotation WHERE quotation_no ~ '^Q97[0-9]{5}$'`,
  );
  const [q] = await rows<{ id: string }>(
    `INSERT INTO quotation (quotation_no, customer_pk, create_date, remark, quotation_status_id, record_status)
     VALUES ($1, (SELECT pk FROM customer WHERE customer_code = $2), now(), 'E2E บทสอน', 1, 'ACTIVE')
     RETURNING id::text AS id`,
    [no, E2E_CUSTOMER],
  );
  return q!.id;
}

/** a draft sale order (not sent for approval) through the API, as the signed-in user — its uuid (the link) */
async function newSaleOrder(page: Page): Promise<string> {
  const part = await newPart({ remain: 5, price: 150 });
  const r = await call(page, 'POST', '/api/sale-orders', {
    customerCode: E2E_CUSTOMER,
    salesId: await userUuid(OWNER_EMAIL),
    lines: [{ code: part.code, qty: 1, price: 150, name: '', type: 'SparePart' }],
    paymentType: '',
    paymentAmount: '',
    slip: '',
    remark: '',
    submit: false,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return (r.body.order as { id: string }).id;
}

/**
 * A tour's `demo` URL with its placeholders made real: {job} / {job:<status id>} = a new job in that status
 * (default 2) — its uuid (the link), {quotation}, {saleOrder} (a draft), {customer} = the e2e customer, {part} = a new spare part
 */
export async function demoUrl(page: Page, url: string): Promise<string> {
  let out = url;
  for (const m of [...url.matchAll(/\{job(?::(\d+))?\}/g)])
    out = out.replace(m[0], await jobUuid(await newJob({ status: Number(m[1] ?? 2) })));
  if (out.includes('{quotation}')) out = out.replace('{quotation}', await newQuotation());
  if (out.includes('{saleOrder}')) out = out.replace('{saleOrder}', await newSaleOrder(page));
  if (out.includes('{part}')) out = out.replace('{part}', (await newPart({ remain: 5, price: 100 })).code);
  return out.replace('{customer}', E2E_CUSTOMER);
}

/**
 * This step's geometry, in the open dialog when there is one: comes after the step before it (DOM = grid
 * reading order), no other field lit, the card over none of the lit fields, the lit fields on the screen.
 */
export async function checkStep(page: Page) {
  return page.evaluate(() => {
    type W = Window & { __tourPrev?: Element };
    const w = window as W;
    const targets = [...document.querySelectorAll<HTMLElement>('[data-tour-target]')];
    if (!targets.length) return { order: true, stray: [] as string[], cover: 0, off: [] as string[] };
    const pad = 4;
    /** what of `e` is on the screen: cut to the boxes around it that clip (a dialog's scrolling body, a wide table) */
    const rect = (e: Element) => {
      const r = e.getBoundingClientRect();
      let [l, t, rr, b] = [r.left, r.top, r.right, r.bottom];
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
        const c = p.getBoundingClientRect();
        [l, t, rr, b] = [Math.max(l, c.left), Math.max(t, c.top), Math.min(rr, c.right), Math.min(b, c.bottom)];
      }
      return new DOMRect(l, t, Math.max(0, rr - l), Math.max(0, b - t));
    };
    const hit = (a: DOMRect, b: DOMRect) =>
      Math.max(0, Math.min(a.right + pad, b.right + pad) - Math.max(a.left - pad, b.left - pad)) *
      Math.max(0, Math.min(a.bottom + pad, b.bottom + pad) - Math.max(a.top - pad, b.top - pad));
    // a step after a closed dialog has nothing to follow
    // reading order is within one surface: the page, or a dialog the tour opened (a new surface starts over)
    const surface = (e: Element) => e.closest('[role="dialog"]:not([aria-describedby="tour-body"])');
    const prev = w.__tourPrev?.isConnected && surface(w.__tourPrev) === surface(targets[0]!) ? w.__tourPrev : undefined;
    const order = !prev || !!(prev.compareDocumentPosition(targets[0]!) & 4);
    w.__tourPrev = targets.at(-1);
    const root =
      [
        ...document.querySelectorAll('[role="dialog"][data-state="open"]:not([data-radix-popper-content-wrapper] *)'),
      ].at(-1) ?? document.querySelector('main')!;
    const name = (e: Element) => (e.querySelector('label')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const stray = [...root.querySelectorAll('label')]
      .map((l) => l.parentElement!)
      .filter((f) => !targets.some((t) => t === f || t.contains(f) || f.contains(t)))
      // a folded filter bar's fields keep their boxes under what is below it, inert: not on the screen
      .filter((f) => rect(f).width > 0 && rect(f).height > 0 && !f.closest('[inert]'))
      .filter((f) => targets.some((t) => hit(rect(f), rect(t)) > 40))
      .map(name);
    const c = rect(document.querySelector('[aria-describedby="tour-body"]')!);
    const cover = targets.reduce((n, t) => {
      const r = rect(t);
      return (
        n +
        Math.max(0, Math.min(c.right, r.right) - Math.max(c.left, r.left)) *
          Math.max(0, Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top))
      );
    }, 0);
    // off the screen either way (a wide table's last column on a phone included)
    const off = targets
      .filter((t) => {
        const r = rect(t); // a lit field cut away by its dialog / table counts as off the screen
        return (
          r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth
        );
      })
      .map(name);
    return { order, stray: [...new Set(stray)], cover, off };
  });
}

/**
 * เริ่มเลย / ถัดไป until the step whose title passes `is`. Each click waits for the counter to move: a step that
 * opens a dialog takes a while, and a slow runner read the old title and clicked past the step (CI, phone).
 */
export async function stepTo(page: Page, is: (title: string) => boolean) {
  const num = card(page).locator('.num').locator('visible=true').first();
  while (!is(await card(page).locator('#tour-title').innerText())) {
    const at = await num.innerText();
    await card(page)
      .getByRole('button', { name: /^(เริ่มเลย|ถัดไป)$/ })
      .click();
    await expect(num).not.toHaveText(at);
  }
}

/**
 * Every step of the tour on the page that is open, started from `start` (the ? button or the first-visit
 * offer), each one checked; ends on the last step. Returns the number of steps.
 */
/** the first-visit offer shows only after the user's first tap / key (it must never be the page's LCP element) */
export async function wakeTourOffer(page: Page) {
  await page.keyboard.press('Shift');
}

export async function walkTour(page: Page, start: 'button' | 'offer' = 'button'): Promise<number> {
  await page.evaluate(() => delete (window as Window & { __tourPrev?: Element }).__tourPrev);
  if (start === 'offer') await wakeTourOffer(page);
  await page.getByRole('button', { name: start === 'offer' ? 'เริ่มบทสอน' : 'สอนการใช้งานหน้านี้' }).click();
  const n = Number((await card(page).locator('.num').locator('visible=true').first().innerText()).split('/')[1]);
  for (let k = 1; k <= n; k++) {
    await expect(card(page)).toContainText(`${k} / ${n}`);
    await page.waitForTimeout(450); // the scroll to the step (a dialog opening) settles
    const title = await card(page).locator('#tour-title').innerText();
    const g = await checkStep(page);
    expect(g.order, `"${title}" comes after the step before it in reading order`).toBe(true);
    expect(g.stray, `"${title}" lights only its own fields`).toEqual([]);
    expect(g.cover, `"${title}": the card covers none of its fields`).toBe(0);
    expect(g.off, `"${title}": its fields are on the screen`).toEqual([]);
    if (k < n)
      await card(page)
        .getByRole('button', { name: k === 1 ? 'เริ่มเลย' : 'ถัดไป' })
        .click();
  }
  return n;
}
