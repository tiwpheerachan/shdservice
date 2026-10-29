import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { documentAttach } from '@/db/schema';
import { handle, requireCan, HttpError, requireView, JOB_MODULES, parseParams } from '@/server/auth';
import { attachmentDelete, attachmentGet } from '@/server/contract/jobs';
import { removeAttachment } from '@/server/services/jobs';
import { fileRedirect, filePath, resolvePath } from '@/server/storage';
import { RS } from '@/server/record-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Redirect to the file's signed URL — the same answer as GET /api/files (storage.ts fileRedirect). */
export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  await requireView(req, JOB_MODULES);
  const { id } = await parseParams(ctx, attachmentGet);
  const [row] = await db
    .select()
    .from(documentAttach)
    .where(eq(documentAttach.documentAttachId, Number(id)));
  // a legacy row without a file name has nothing to open (it would sign the job's folder)
  if (!row || row.recordStatus === RS.DELETED || !row.systemFileName?.trim()) throw new HttpError(404, 'not found');
  return fileRedirect(resolvePath(row.systemFileName, (f) => filePath.attachment(row.referenceItemCode ?? '', f)));
});

/** Soft delete (record_status DELETED + audit): the stored file stays — evidence, and restorable in SQL. */
export const DELETE = handle(async (req: NextRequest, ctx: Ctx) => {
  const me = await requireCan(req, 'Job Management', 'del');
  const { id } = await parseParams(ctx, attachmentDelete);
  await removeAttachment(Number(id), me.userId); // 404 when it is gone or already deleted
  return NextResponse.json({ ok: true });
});
