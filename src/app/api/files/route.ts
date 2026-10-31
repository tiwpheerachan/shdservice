import type { NextRequest } from 'next/server';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/db/client';
import { jobAttachment, job } from '@/db/schema';
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
import { fileRedirect, filePath, mediaOn, onR2 } from '@/server/storage';
import { log } from '@/lib/log';
import { RS } from '@/server/record-status';
import { rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 307 to a signed URL. Only the folders the app writes (storage.ts `filePath`) can be signed, never an arbitrary object.
 * shippers/ and profiles/ logos are public (the tracking page and /track/doc show them signed-out); everything else
 * needs a staff user who may view its screen: jobs/ → any job screen, sale-orders/ → Sale Order or Product Pick Stock,
 * products/ → any product / stock screen.
 */
const STAFF_PATHS: [RegExp, readonly Module[]][] = [
  [/^jobs\/[^/]+\/(?:attachments|slip)\/[^/]+$/, JOB_MODULES],
  [/^sale-orders\/[^/]+\/slip\/[^/]+$/, SALE_ORDER_READERS],
  [/^products\/[^/]+\/[^/]+$/, PRODUCT_MODULES],
];
// {id}: the int of a logo stored before ADR 0008, or the profile's uuid
const PUBLIC_PATH =
  /^(?:shippers|profiles)\/(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[^/]+$/;
const ATTACHMENT = /^jobs\/([^/]+)\/attachments\/([^/]+)$/;

export const GET = handle(async (req: NextRequest) => {
  // leading "/" dropped; empty, over 300, "..", a control character or a backslash → 400 "path required"
  const { path, download, direct, reason } = parseQuery(req, files);

  const isPublic = PUBLIC_PATH.test(path);
  let userPk: number | null = null;
  // anonymous callers get a Supabase signing call per request — cap it (a page shows a few logos)
  if (isPublic) await rateLimit(req, 'files-public', 120);
  else {
    const user = await requireUser(req);
    userPk = user.pk;
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
      .select({ name: jobAttachment.originalFileName })
      .from(jobAttachment)
      .innerJoin(job, eq(job.pk, jobAttachment.jobPk))
      .where(
        and(
          eq(job.jobNo, no),
          inArray(jobAttachment.systemFileName, [file, filePath.attachment(no, file)]),
          ne(jobAttachment.recordStatus, RS.DELETED),
        ),
      )
      .limit(1);
    if (!row) throw new HttpError(404, 'ไม่พบไฟล์');
    name = row.name;
  }
  // a video POST /api/attachments/video named (v{14 digits}{20 hex}.mp4|mov|webm under jobs/{no}/attachments/) and its thumbnail live in R2 (storage.ts onR2);
  // every other path — including legacy .mp4 attachments without the leading `v` — is in Supabase.
  // direct=1 (an R2 file only): the player's fallback when the media Worker's link failed — R2's own presigned URL,
  // capped per user so it cannot route around the edge cache at scale; one log line when it really was a fallback
  const isDirect = direct === '1' && onR2(path);
  if (isDirect) await rateLimit(req, 'files-direct', 60);
  const res = await fileRedirect(path, { download: download === '1' && (name || true), isPublic, direct: isDirect });
  if (isDirect && mediaOn()) log.warn('media fallback', { path, user: userPk, reason: reason ?? null });
  return res;
});
