import { NextResponse, type NextRequest } from 'next/server';
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

export const GET = handle(async (req: NextRequest) => {
  // leading "/" dropped; empty, over 300, "..", a control character or a backslash → 400 "path required"
  const { path } = parseQuery(req, files);

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
  const url = await signedUrl(path, URL_TTL_S);
  if (!url) throw new HttpError(404, 'ไม่พบไฟล์ (อาจอยู่บนระบบเก่า)');
  // the browser may reuse the redirect only while the signed URL is still valid
  return NextResponse.redirect(url, {
    headers: { 'Cache-Control': `${isPublic ? 'public' : 'private'}, max-age=${URL_TTL_S - 60}` },
  });
});
