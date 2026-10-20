import { APP_ORIGIN, OWNER_EMAIL, STAFF_EMAIL } from './support/env';
import { expect, signIn, test } from './support/fixtures';

test('an owner signs in through the SSO and lands on the dashboard', async ({ page }) => {
  await signIn(page, OWNER_EMAIL);
  await expect(page).toHaveURL(`${APP_ORIGIN}/jobs/dashboard`);
  await expect(page.getByRole('heading', { name: 'ภาพรวมงานบริการ' })).toBeVisible();
  // the session is the app's own httpOnly cookie
  const cookies = await page.context().cookies(APP_ORIGIN);
  // a production build: the __Host- name (src/lib/session.ts hostCookie) — Secure, Path=/, no Domain
  expect(cookies.find((c) => c.name === '__Host-os_session')).toMatchObject({
    httpOnly: true,
    secure: true,
    path: '/',
  });
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

test('every page runs under a nonce CSP (no inline script without it) and nothing is refused', async ({ page }) => {
  const refused: string[] = [];
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (e) =>
      console.error(`csp-violation ${e.violatedDirective} ${e.blockedURI}`),
    ),
  );
  page.on('console', (m) => /csp-violation|Content Security Policy/i.test(m.text()) && refused.push(m.text()));
  const policyOf = async (path: string) => {
    const res = await page.goto(path);
    const csp = (await res!.allHeaders())['content-security-policy'] ?? '';
    expect(csp, path).toMatch(/script-src 'self' 'nonce-[^']+' 'sha256-[^']+' 'strict-dynamic'/);
    expect(csp, path).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    return csp;
  };
  await policyOf('/login');
  await page.waitForLoadState('networkidle');
  expect(await policyOf('/track')).toContain('frame-src https://challenges.cloudflare.com'); // Turnstile, /track only
  await page.waitForLoadState('networkidle');
  await signIn(page, OWNER_EMAIL);
  for (const path of ['/jobs/dashboard', '/jobs/repair', '/customers', '/admin/audit', '/no-such-page']) {
    expect(await policyOf(path)).not.toContain('challenges.cloudflare.com');
    await page.waitForLoadState('networkidle');
  }
  // a script the policy refused would be a violation here — Next's own chunks included
  expect(refused).toEqual([]);
});
