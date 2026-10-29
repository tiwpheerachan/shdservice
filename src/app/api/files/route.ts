import { NextResponse, type NextRequest } from 'next/server';
import { LRUCache } from 'lru-cache';
import {
  canViewAny,
  handle,
  parseQuery,
  requireUser,
  HttpError,
  JOB_MODULES,
  PRODUCT_MODULES,
  SALE_ORDER_READERS,
} from '@/server/auth';
import type { Module } from '@/lib/modules';
import { files } from '@/server/contract/misc';
import { signedUrl } from '@/server/storage';
import { rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/files?path=products/P00230/x.jpg → 302 to a short-lived signed URL.
 *
 * Only the folders the app actually writes (storage.ts `filePath`) can be signed —
 * never an arbitrary object in the bucket:
 *   jobs/{no}/attachments|slip/…   sale-orders/{no}/slip/…   products/{code}/…
 *   profiles/{id}/…                shippers/{id}/…
 * Courier logos (shippers/) and letterhead logos (profiles/, document profiles — nothing
 * else is stored there) are public: the customer tracking page and the customer's documents
 * (/track/doc) show them to visitors who are not signed in. Everything else needs a signed-in staff user
 * who may view its screen: jobs/ → any job screen, sale-orders/ → Sale Order or Product Pick Stock,
 * products/ → any product / stock screen.
 */
const STAFF_PATHS: [RegExp, readonly Module[]][] = [
  [/^jobs\/[^/]+\/(?:attachments|slip)\/[^/]+$/, JOB_MODULES],
  [/^sale-orders\/[^/]+\/slip\/[^/]+$/, SALE_ORDER_READERS],
  [/^products\/[^/]+\/[^/]+$/, PRODUCT_MODULES],
];
const PUBLIC_PATH = /^(?:shippers|profiles)\/\d+\/[^/]+$/;
const URL_TTL_S = 120;
// a video plays from the signed URL itself, fetching ranges while it plays and seeks — valid long enough to watch
const VIDEO_TTL_S = 15 * 60;
const VIDEO = /\.(?:mp4|mov|webm)$/i;
/**
 * A picture (photo, product image, logo, a video's thumbnail — never a slip: a customer's payment details) gets ONE
 * signed URL a day, shared by everyone who may see it: the browser keeps the redirect and the image, Supabase's CDN
 * serves the same URL again — reopening a job does not download its pictures again. The price: a copied link opens
 * for up to a day, and a browser keeps what it saw after its rights are taken away.
 */
const PICTURE_TTL_S = 24 * 60 * 60;
const PICTURE = /\.(?:jpe?g|png|webp|svg)$/i;
const SLIP = /\/slip\//;
// ponytail: per process (one Render instance) — a restart signs anew, the old URLs stay valid until they expire
const pictures = new LRUCache<string, { url: string; exp: number }>({ max: 5000, ttl: (PICTURE_TTL_S - 3600) * 1000 });

export const GET = handle(async (req: NextRequest) => {
  // leading "/" dropped; empty, over 300, "..", a control character or a backslash → 400 "path required"
  const { path, download } = parseQuery(req, files);

  const isPublic = PUBLIC_PATH.test(path);
  // anonymous callers get a Supabase signing call per request — cap it (a page shows a few logos)
  if (isPublic) await rateLimit(req, 'files-public', 120);
  else {
    const user = await requireUser(req);
    // a staff file is readable by whoever may view the screen it belongs to
    const modules = STAFF_PATHS.find(([re]) => re.test(path))?.[1];
    if (!modules) throw new HttpError(404, 'ไม่พบไฟล์');
    if (!(await canViewAny(user, modules))) throw new HttpError(403, 'ไม่มีสิทธิ์ดูข้อมูลส่วนนี้');
  }
  const picture = PICTURE.test(path) && !SLIP.test(path);
  const ttl = picture ? PICTURE_TTL_S : VIDEO.test(path) ? VIDEO_TTL_S : URL_TTL_S;
  // Which store signs it (storage.ts onR2): a video POST /api/attachments/video named — v{14 digits}{20 hex}.mp4|
  // mov|webm under jobs/{no}/attachments/ — and its thumbnail ({file}.jpg) are in Cloudflare R2 (a presigned GET;
  // download=1 adds response-content-disposition=attachment). Every other path is in Supabase — images, PDFs,
  // slips, logos, and the legacy .mp4 attachments (their names have no leading `v`), which keep opening from there.
  const key = `${path}\n${download ?? ''}`;
  let signed = picture ? pictures.get(key) : undefined;
  if (!signed) {
    const url = await signedUrl(path, ttl, download === '1');
    if (!url) throw new HttpError(404, 'ไม่พบไฟล์ (อาจอยู่บนระบบเก่า)'); // not kept: the next request tries again
    signed = { url, exp: Date.now() + ttl * 1000 };
    if (picture) pictures.set(key, signed);
  }
  // the browser may reuse the redirect only while the signed URL is still valid
  const maxAge = Math.floor((signed.exp - Date.now()) / 1000) - 60;
  return NextResponse.redirect(signed.url, {
    headers: { 'Cache-Control': `${isPublic ? 'public' : 'private'}, max-age=${maxAge}` },
  });
});
