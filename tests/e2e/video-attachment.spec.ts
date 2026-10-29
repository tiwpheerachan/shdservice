import type { Request } from '@playwright/test';
import { OWNER_EMAIL, SERVER_ENV } from './support/env';
import { newJob } from './support/db';
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
  const upload = `https://${SERVER_ENV.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${SERVER_ENV.R2_BUCKET}/jobs/${no}/attachments/${file}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-SignedHeaders=content-type%3Bhost%3Bif-none-match&X-Amz-Signature=e2e`;
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'PUT',
    'access-control-allow-headers': '*',
  };

  await page.route('**/api/attachments/video', (route) => route.fulfill({ json: { file, url: upload } }));
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
  await page.goto(`/jobs/edit?no=${no}`);
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
  await going.getByRole('button', { name: 'ยกเลิก' }).click();
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
