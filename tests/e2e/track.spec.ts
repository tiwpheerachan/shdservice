import { TRACK_MSG } from '@/lib/track-public';
import { expect, test } from './support/fixtures';

/** Turnstile stand-in: the gate passes at once, nothing goes to Cloudflare from a test */
const TURNSTILE_STUB = `window.turnstile = {
  render: (el, o) => { setTimeout(() => o.callback('e2e-turnstile')); return 'e2e'; },
  reset() {}, remove() {}, execute() {},
};`;

test('/track link: a dropped connection or a proxy error page is told in Thai, with ลองอีกครั้ง', async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/**', (r) =>
    r.fulfill({ contentType: 'text/javascript', body: TURNSTILE_STUB }),
  );

  // offline: the browser's own "Failed to fetch" must never reach the customer
  await page.route('**/api/track/session', (r) => r.abort('internetdisconnected'));
  await page.goto('/track/e2e-no-such-link');
  // (Next's route announcer is a role=alert too)
  const alert = page.getByRole('alert').filter({ hasText: TRACK_MSG.network });
  await expect(alert).toBeVisible();
  const retry = page.getByRole('button', { name: 'ลองอีกครั้ง' });
  await expect(retry).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Failed to fetch');

  // a body that is not ours (a proxy's HTML error page) → the same message, not a parse error
  await page.unroute('**/api/track/session');
  await page.route('**/api/track/session', (r) =>
    r.fulfill({ status: 502, contentType: 'text/html', body: '<html><body>Bad Gateway</body></html>' }),
  );
  const sent = page.waitForRequest('**/api/track/session');
  await retry.click();
  await sent;
  await expect(alert).toBeVisible();
  await expect(retry).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/Bad Gateway|JSON|Unexpected token/);
});
