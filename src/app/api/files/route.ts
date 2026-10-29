import type { NextRequest } from 'next/server';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/db/client';
import { documentAttach } from '@/db/schema';
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
import { fileRedirect, filePath } from '@/server/storage';
import { RS } from '@/server/record-status';
import { rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/files?path=products/P00230/x.jpg → 307 to a signed URL (storage.ts fileRedirect: a picture a day, a video
 * 15 minutes, anything else 2).
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
const ATTACHMENT = /^jobs\/([^/]+)\/attachments\/([^/]+)$/;

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
  // a job attachment opens only while its row is there (not once removed — a soft delete keeps the file), on every
  // request, before any cached URL; a video's thumbnail ({file}.jpg) belongs to the video's row; a legacy row may
  // hold the full path (storage.ts resolvePath). A download is saved under the attachment's own name.
  let name: string | null = null;
  const att = ATTACHMENT.exec(path);
  if (att) {
    const [, no = '', f = ''] = att;
    const file = f.replace(/(\.(?:mp4|mov|webm))\.jpg$/i, '$1');
    const [row] = await db
      .select({ name: documentAttach.originalFileName })
      .from(documentAttach)
      .where(
        and(
          eq(documentAttach.referenceTopic, 'Jobs'),
          eq(documentAttach.referenceItemCode, no),
          inArray(documentAttach.systemFileName, [file, filePath.attachment(no, file)]),
          ne(documentAttach.recordStatus, RS.DELETED),
        ),
      )
      .limit(1);
    if (!row) throw new HttpError(404, 'ไม่พบไฟล์');
    name = row.name;
  }
  // Which store signs it (storage.ts onR2): a video POST /api/attachments/video named — v{14 digits}{20 hex}.mp4|
  // mov|webm under jobs/{no}/attachments/ — and its thumbnail ({file}.jpg) are in Cloudflare R2 (a presigned GET;
  // download=1 adds response-content-disposition=attachment). Every other path is in Supabase — images, PDFs,
  // slips, logos, and the legacy .mp4 attachments (their names have no leading `v`), which keep opening from there.
  return fileRedirect(path, { download: download === '1' && (name || true), isPublic });
});
