import { E2E_CUSTOMER, OWNER_EMAIL } from './support/env';
import { one, rows } from './support/db';
import { expect, signIn, test } from './support/fixtures';

/**
 * Cloudflare's Email Address Obfuscation (kept ON) rewrites every address it finds in the HTML — and the decode
 * script it injects is blocked by our CSP (hydration error #418, "[email protected]" on paper). So no address is
 * ever in the server HTML (src/lib/obscure.ts, <Email>): the raw HTML has none, the browser shows it after load.
 */
const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const PROFILE_EMAIL = 'print-e2e@shd-e2e.test';

test('no e-mail address in the server HTML; the browser shows it after load', async ({ page }) => {
  // a print with an address on it: the default issuing profile's e-mail on a quotation
  const [profile] = await rows<{ pk: number; email: string }>(
    `SELECT pk::int AS pk, email FROM document_profile WHERE is_default AND deleted_at IS NULL LIMIT 1`,
  );
  await one(`UPDATE document_profile SET email = $1 WHERE pk = $2 RETURNING pk`, [PROFILE_EMAIL, profile!.pk]);
  try {
    const { no } = await one<{ no: string }>(
      `SELECT 'Q96' || lpad((coalesce(max(substring(quotation_no FROM 4)::int), 0) + 1)::text, 5, '0') AS no
         FROM quotation WHERE quotation_no ~ '^Q96[0-9]{5}$'`,
    );
    const { id } = await one<{ id: string }>(
      `INSERT INTO quotation (quotation_no, customer_pk, create_date, quotation_status_id, record_status)
       VALUES ($1, (SELECT pk FROM customer WHERE customer_code = $2), now(), 1, 'ACTIVE') RETURNING id::text AS id`,
      [no, E2E_CUSTOMER],
    );
    await signIn(page, OWNER_EMAIL);

    // the raw HTML (no JS ran): the audit log (its rows carry the actors' e-mails) and the print
    for (const url of ['/admin/audit', `/print/quotation/${id}?auto=0`]) {
      const res = await page.request.get(url);
      expect(res.ok(), url).toBe(true);
      const html = await res.text();
      const hit = ADDRESS.exec(html);
      // the message shows where it is (which part of the page leaked it)
      expect(hit && html.slice(Math.max(0, hit.index - 160), hit.index + 60), url).toBeNull();
    }

    // after load the address is there — on paper too (the print waits for hydration)
    await page.goto(`/print/quotation/${id}?auto=0`);
    await expect(page.getByText(PROFILE_EMAIL).first()).toBeVisible();
  } finally {
    await one(`UPDATE document_profile SET email = $1 WHERE pk = $2 RETURNING pk`, [profile!.email, profile!.pk]);
  }
});
