import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { documentAttach } from '@/db/schema';
import { handle, requireCan, HttpError, requireView, JOB_MODULES, parseParams } from '@/server/auth';
import { attachmentDelete, attachmentGet } from '@/server/contract/jobs';
import { removeAttachment } from '@/server/services/jobs';
import { signedUrl, filePath, resolvePath } from '@/server/storage';
import { RS } from '@/server/record-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Redirect to a short-lived signed URL for the stored file. */
export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  await requireView(req, JOB_MODULES);
  const { id } = await parseParams(ctx, attachmentGet);
  const [row] = await db
    .select()
    .from(documentAttach)
    .where(eq(documentAttach.documentAttachId, Number(id)));
  if (!row || row.recordStatus === RS.DELETED) throw new HttpError(404, 'not found');
  const url = await signedUrl(
    resolvePath(row.systemFileName ?? '', (f) => filePath.attachment(row.referenceItemCode ?? '', f)),
    120, // a leaked link (history, a forwarded URL) stops working soon
  );
  if (!url) throw new HttpError(404, 'ไฟล์นี้อยู่บนระบบเก่า ยังไม่ได้ย้ายมา');
  return NextResponse.redirect(url);
});

/** Soft delete (record_status DELETED + audit): the stored file stays — evidence, and restorable in SQL. */
export const DELETE = handle(async (req: NextRequest, ctx: Ctx) => {
  const me = await requireCan(req, 'Job Management', 'del');
  const { id } = await parseParams(ctx, attachmentDelete);
  const [row] = await db
    .select()
    .from(documentAttach)
    .where(eq(documentAttach.documentAttachId, Number(id)));
  if (!row || row.recordStatus === RS.DELETED) throw new HttpError(404, 'not found');
  await removeAttachment(row.documentAttachId, me.userId);
  return NextResponse.json({ ok: true });
});
