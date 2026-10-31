import { writeFile } from 'node:fs/promises';
import { E2E_CUSTOMER, OWNER_EMAIL } from './support/env';
import { one } from './support/db';
import { expect, signIn, test } from './support/fixtures';

test('a quotation too long for one A4 prints on more sheets, each numbered by the browser', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'page.pdf() is the desktop Chromium print path');
  const { no } = await one<{ no: string }>(
    `SELECT 'Q97' || lpad((coalesce(max(substring(quotation_no FROM 4)::int), 0) + 1)::text, 5, '0') AS no
       FROM quotation WHERE quotation_no ~ '^Q97[0-9]{5}$'`,
  );
  const { id } = await one<{ id: string }>(
    `WITH q AS (
       INSERT INTO quotation (quotation_no, customer_pk, create_date, quotation_status_id, record_status)
       VALUES ($1, (SELECT pk FROM customer WHERE customer_code = $2), now(), 1, 'ACTIVE') RETURNING pk, id)
     , l AS (
       INSERT INTO quotation_line (quotation_pk, line_number, item_type, item_code, item_detail, quantity, unit_price, unit_price_discount, total_price, unit_price_discount_percent)
       SELECT q.pk, n, 'Service', 'SV' || n, 'ค่าบริการตรวจเช็คและซ่อมแผงวงจร รายการที่ ' || n, 1, 100, 0, 100, 0
         FROM q, generate_series(1, 80) n)
     SELECT id::text AS id FROM q`,
    [no, E2E_CUSTOMER],
  );
  await signIn(page, OWNER_EMAIL);
  await page.goto(`/print/quotation/${id}?auto=0`);
  await expect(page.getByText(`SV80`, { exact: true })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true });
  await writeFile(info.outputPath('quotation.pdf'), pdf);
  const sheets = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
  expect(sheets).toBeGreaterThan(1);
});
