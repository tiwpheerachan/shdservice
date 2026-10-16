import { APP_ORIGIN, OWNER_EMAIL, STAFF_EMAIL } from './support/env';
import { expect, signIn, test } from './support/fixtures';

test('an owner signs in through the SSO and lands on the dashboard', async ({ page }) => {
  await signIn(page, OWNER_EMAIL);
  await expect(page).toHaveURL(`${APP_ORIGIN}/jobs/dashboard`);
  await expect(page.getByRole('heading', { name: 'ภาพรวมงานบริการ' })).toBeVisible();
  // the session is the app's own httpOnly cookie
  const cookies = await page.context().cookies(APP_ORIGIN);
  expect(cookies.find((c) => c.name === 'os_session')).toMatchObject({ httpOnly: true });
});

test('an unknown email waits for approval', async ({ page }) => {
  await signIn(page, `stranger-${Date.now()}@e2e.test`);
  await expect(page).toHaveURL(`${APP_ORIGIN}/pending`);
  await expect(page.getByText('รอการอนุมัติเข้าใช้งาน')).toBeVisible();
  expect((await page.request.get('/api/data/customers')).status()).toBe(403);
});

test('a role without Customer view sees no customers menu, and the API refuses', async ({ page }) => {
  await signIn(page, STAFF_EMAIL);
  await expect(page).toHaveURL(`${APP_ORIGIN}/jobs/dashboard`);
  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('button', { name: 'ข้อมูลงานบริการ' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'ข้อมูลลูกค้า' })).toHaveCount(0);
  expect((await page.request.get('/api/data/customers')).status()).toBe(403);
});

test('a login link cannot send the browser to another site afterwards', async ({ page }) => {
  // "/.//evil.example" folds to "//evil.example" — protocol-relative (src/lib/sso.ts safeNext)
  await signIn(page, OWNER_EMAIL, '/api/sso/login?next=/.//evil.example');
  expect(new URL(page.url()).origin).toBe(APP_ORIGIN);
  await expect(page).toHaveURL(`${APP_ORIGIN}/jobs/dashboard`);
});
