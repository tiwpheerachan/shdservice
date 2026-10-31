import { readFileSync } from 'node:fs';
import type { Request } from '@playwright/test';
import { OWNER_EMAIL, SERVER_ENV } from './support/env';
import { jobUuid, newJob, rows } from './support/db';
import { expect, signIn, test } from './support/fixtures';

/**
 * A customer's clip attached to a job (src/components/shared/attachments.tsx, src/lib/video.ts): converted in the
 * browser to MP4 H.264 with its progress on screen, PUT straight to Cloudflare R2 (ยกเลิก stops it, the conversion
 * is kept for the next try), then played in a dialog. R2 is a dead end in e2e: the presigned URL, the PUT (on the
 * R2 origin — so the page's CSP connect-src must allow it), the confirm and the file served back are played here. tests/fixtures/test-pattern.webm: 2 s of colour bars, VP9,
 * 320×240, no sound — made with mediabunny's CanvasSource in this Chromium.
 */
test('a video is converted, uploaded straight to R2 (cancel, then again), and plays in its dialog', async ({
  page,
}) => {
  const no = await newJob({ status: 2 });
  const file = `v20261028120000${'ab'.repeat(10)}.mp4`;
  const upload = `https://${SERVER_ENV.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${SERVER_ENV.R2_BUCKET}/jobs/${no}/attachments/${file}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost%3Bif-none-match&X-Amz-Signature=e2e`;
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'PUT',
    'access-control-allow-headers': '*',
  };

  const asked: { size: number }[] = [];
  await page.route('**/api/attachments/video', (route) => {
    asked.push(route.request().postDataJSON());
    return route.fulfill({ json: { file, url: upload } });
  });
  const puts: { type: string; ifNoneMatch?: string; bytes: Buffer }[] = [];
  const waiting: (() => void)[] = [];
  const release = () => waiting.forEach((r) => r());
  await page.route(upload, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const h = route.request().headers();
    puts.push({
      type: h['content-type'] ?? '',
      ifNoneMatch: h['if-none-match'],
      bytes: route.request().postDataBuffer()!,
    });
    await new Promise<void>((r) => waiting.push(r)); // the first one is cancelled meanwhile
    await route.fulfill({ status: 200, headers: { ...cors, etag: '"e2e"' } }).catch(() => {});
  });
  const confirms: Request[] = [];
  await page.route('**/api/attachments/video/confirm', (route) => {
    confirms.push(route.request());
    return route.fulfill({
      json: { ok: true, row: { id: 999999, name: 'test-pattern.mp4', file, remark: 'คลิปจากลูกค้า' } },
    });
  });
  // the stored clip is what was PUT; no thumbnail stored here (the row hides its image)
  await page.route(
    (url) => url.pathname === '/api/files',
    (route) =>
      new URL(route.request().url()).searchParams.get('path')?.endsWith(file)
        ? route.fulfill({ body: puts.at(-1)!.bytes, contentType: 'video/mp4' })
        : route.fulfill({ status: 404, json: { error: 'ไม่พบไฟล์' } }),
  );

  await signIn(page, OWNER_EMAIL);
  await page.goto(`/jobs/edit?id=${await jobUuid(no)}`);
  // every progress line shown, however short it was on screen
  await page.evaluate(() => {
    const seen: string[] = ((window as unknown as { seen: string[] }).seen = []);
    new MutationObserver(() =>
      document.querySelectorAll('[role=status]').forEach((el) => {
        const t = el.textContent ?? '';
        if (t.startsWith('กำลัง') && seen.at(-1) !== t) seen.push(t);
      }),
    ).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const seen = () => page.evaluate(() => (window as unknown as { seen: string[] }).seen);

  await page
    .locator('label', { hasText: 'เลือกไฟล์แนบ' })
    .locator('input[type=file]')
    .setInputFiles('tests/fixtures/test-pattern.webm');
  await page.getByRole('textbox', { name: 'คำอธิบายไฟล์แนบ' }).fill('คลิปจากลูกค้า');
  const attach = page.getByRole('button', { name: 'แนบไฟล์', exact: true });
  const going = page.getByRole('status').filter({ hasText: 'กำลังอัปโหลด…' });

  // converted, then on its way — ยกเลิก stops it: nothing confirmed, the file stays picked
  await attach.click();
  await expect(going).toBeVisible();
  await going.getByRole('button', { name: 'ยกเลิกการแนบวิดีโอ' }).click();
  await expect(page.getByText('ยกเลิกการแนบวิดีโอแล้ว')).toBeVisible();
  await expect(going).toHaveCount(0);
  expect(confirms).toHaveLength(0);
  expect((await seen()).some((t) => /^กำลังแปลงวิดีโอ… \d+%/.test(t))).toBe(true);

  // again: the same converted clip goes (no second conversion), confirmed with its thumbnail
  const converts = (await seen()).filter((t) => t.startsWith('กำลังแปลงวิดีโอ')).length;
  await attach.click();
  await expect(going).toBeVisible();
  await expect.poll(() => puts.length).toBe(2);
  release();
  await expect(page.getByText('แนบไฟล์แล้ว')).toBeVisible();
  expect((await seen()).filter((t) => t.startsWith('กำลังแปลงวิดีโอ')).length).toBe(converts);
  expect(puts).toHaveLength(2);
  // an MP4 (the `ftyp` box), sent as one — not the WebM that was picked
  expect(puts[1]!.type).toBe('video/mp4');
  expect(puts[1]!.ifNoneMatch).toBe('*'); // signed into the URL: never over an existing object
  expect(puts[1]!.bytes.subarray(4, 8).toString('latin1')).toBe('ftyp');
  expect(puts[1]!.bytes.equals(puts[0]!.bytes)).toBe(true);
  expect(asked[1]!.size).toBe(puts[1]!.bytes.length); // the size signed into the URL is the one PUT
  const form = confirms[0]!.postDataBuffer()!.toString('latin1');
  expect(form).toContain(file);
  expect(form).toMatch(/name="thumb"; filename="thumb\.jpg"\r\nContent-Type: image\/jpeg/);

  // the row opens a player on the stored clip, with ดาวน์โหลด
  await page.getByRole('button', { name: 'test-pattern.mp4' }).click();
  const dialog = page.getByRole('dialog', { name: 'test-pattern.mp4' });
  const video = dialog.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  expect(await video.evaluate((v: HTMLVideoElement) => Math.round(v.duration))).toBe(2);
  await expect(dialog.getByRole('link', { name: 'ดาวน์โหลด' })).toHaveAttribute('href', /download=1/);
  await expect(dialog.getByText('เล่นวิดีโอนี้ไม่ได้')).toHaveCount(0);
});

/**
 * The media CDN down (MEDIA_BASE_URL is a dead origin in e2e — support/env.ts): the server sends the player there,
 * the browser cannot reach it, and the player asks once for the file straight from storage (api/files direct=1 →
 * R2's own presigned URL) and plays. R2 is out of reach here too, so the direct answer's target is served by the spec.
 */
test('the media CDN failing: the video falls back to R2 once and plays; the thumbnail falls back too', async ({
  page,
}) => {
  const no = await newJob({ status: 2 });
  const file = `v20261031120000${'cd'.repeat(10)}.webm`;
  await rows(
    `INSERT INTO job_attachment (job_pk, original_file_name, system_file_name, record_status)
     VALUES ((SELECT pk FROM job WHERE job_no = $1), 'คลิปลูกค้า.webm', $2, 'ACTIVE')`,
    [no, file],
  );
  const clip = readFileSync('tests/fixtures/test-pattern.webm');
  const media: string[] = [];
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(SERVER_ENV.MEDIA_BASE_URL)) media.push(r.url());
  });
  // only the direct asks are caught: the first ones go to the real server and on to the dead media origin
  const direct: { path: string; reason: string | null; location: string }[] = [];
  await page.route(
    (url) => url.pathname === '/api/files' && url.searchParams.get('direct') === '1',
    async (route) => {
      const q = new URL(route.request().url()).searchParams;
      const path = q.get('path')!;
      if (path.endsWith('.jpg')) {
        // no thumbnail was stored for this row (and the server would ask R2 whether there is one)
        direct.push({ path, reason: q.get('reason'), location: '' });
        return route.fulfill({ status: 404, json: { error: 'ไม่พบไฟล์' } });
      }
      const res = await route.fetch({ maxRedirects: 0 }); // the real server's answer
      direct.push({ path, reason: q.get('reason'), location: res.headers()['location'] ?? '' });
      return route.fulfill({ body: clip, contentType: 'video/webm' }); // what R2 would serve there
    },
  );

  await signIn(page, OWNER_EMAIL);
  await page.goto(`/jobs/edit?id=${await jobUuid(no)}`);
  const row = page.getByRole('button', { name: 'คลิปลูกค้า.webm' });
  await row.scrollIntoViewIfNeeded(); // its thumbnail is loading=lazy: below the fold on a phone it never loads
  await expect(row.locator('img')).toBeHidden(); // its thumbnail: media failed, then none in storage
  await row.click();
  const dialog = page.getByRole('dialog', { name: 'คลิปลูกค้า.webm' });
  const video = dialog.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  expect(await video.evaluate((v: HTMLVideoElement) => Math.round(v.duration))).toBe(2);
  await expect(dialog.getByText('เล่นวิดีโอนี้ไม่ได้')).toHaveCount(0);

  const path = `jobs/${no}/attachments/${file}`;
  // the server signed a media link (tried, unreachable) for both, then answered the one direct ask each with R2
  expect(media.some((u) => u.startsWith(`${SERVER_ENV.MEDIA_BASE_URL}/${path}?exp=`) && /&sig=/.test(u))).toBe(true);
  expect(media.some((u) => u.startsWith(`${SERVER_ENV.MEDIA_BASE_URL}/${path}.jpg?exp=`))).toBe(true);
  expect(direct.map((d) => [d.path, d.reason])).toEqual([
    [`${path}.jpg`, 'image'],
    [path, expect.stringMatching(/^(network|src)$/)],
  ]);
  expect(direct[1]!.location).toMatch(
    new RegExp(
      `^https://${SERVER_ENV.R2_ACCOUNT_ID}\\.r2\\.cloudflarestorage\\.com/${SERVER_ENV.R2_BUCKET}/${path}\\?.*X-Amz-Expires=900`,
    ),
  );
});
