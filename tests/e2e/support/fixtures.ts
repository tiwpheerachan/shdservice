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

/** Another person at the same browser: the session cookie goes, then a fresh SSO sign-in. */
export async function switchUser(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await signIn(page, email);
}

/**
 * Closes every toast (their × button). They stack bottom-right, over a page's bottom-right save button, and
 * pause while the pointer is on them — a click aimed at the button then waits on a toast that never goes.
 */
export async function dismissToasts(page: Page): Promise<void> {
  const toasts = page.getByRole('region', { name: /^Notifications/ }).getByRole('listitem');
  for (let left = await toasts.count(); left > 0; left = await toasts.count())
    await toasts
      .first()
      .getByRole('button', { name: 'Close toast' })
      .click({ timeout: 1000 })
      .catch(() => {}); // already on its way out
}

type CallResult = {
  status: number;
  body: { error?: string; details?: { fields?: Record<string, string> } } & Record<string, unknown>;
};

/**
 * A request sent from the page itself (same origin, the session cookie, Sec-Fetch-Site) — what a second tab,
 * a double click or a tampered client sends; the specs use it for what the UI does not offer (it is refused).
 */
export async function call(page: Page, method: string, path: string, body?: unknown): Promise<CallResult> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const r = await fetch(path, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    },
    { method, path, body },
  );
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
