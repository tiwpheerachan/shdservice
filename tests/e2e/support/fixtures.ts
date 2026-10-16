import { test as base, expect, type Page } from '@playwright/test';
import { APP_ORIGIN, SSO_ORIGIN } from './env';

/** Signs in the way a person does: /login → the SSO button → the (fake) SSO form → back to the app. */
export async function signIn(page: Page, email: string, loginUrl = '/login'): Promise<void> {
  await page.goto(loginUrl);
  if (!page.url().startsWith(SSO_ORIGIN)) await page.getByRole('link', { name: 'เข้าสู่ระบบด้วย SHD SSO' }).click();
  await expect(page).toHaveURL(new RegExp(`^${SSO_ORIGIN}/api/v1/sso/authorize\\?`));
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL((url) => url.origin === APP_ORIGIN && !url.pathname.startsWith('/api/'));
}

/** Every spec fails on a CSP violation — a blocked script/style is a broken page in production. */
export const test = base.extend<{ csp: void }>({
  csp: [
    async ({ page }, provide) => {
      const violations: string[] = [];
      // Chrome says "…violates the following Content Security Policy directive" (spaces, not dashes)
      const csp = /Content[- ]Security[- ]Policy/i;
      page.on('console', (m) => csp.test(m.text()) && violations.push(m.text()));
      page.on('pageerror', (e) => csp.test(e.message) && violations.push(e.message));
      // `provide` is Playwright's `use`, renamed so the React hooks lint rule does not take it for one
      await provide();
      expect(violations, 'CSP violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
