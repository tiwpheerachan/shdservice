import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { documentAttach } from '@/db/schema';
import { handle, parseForm, requireCan, HttpError } from '@/server/auth';
import { attachmentVideoConfirm } from '@/server/contract/jobs';
import { rateLimit } from '@/server/rate-limit';
import { addAttachment, attachableJob } from '@/server/services/jobs';
import { checkStoredVideo, fileProblem, filePath, optimizeImage, removeFile, uploadFile } from '@/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const THUMB_TYPES: ReadonlySet<string> = new Set(['image/jpeg']);
const MAX_THUMB_BYTES = 1024 * 1024;

/**
 * multipart/form-data: jobNo, file (the name POST /api/attachments/video issued), name, remark, thumb? → checks
 * the video the browser uploaded to storage (checkStoredVideo: there, ≤ 200 MB, really MP4 / MOV / WebM), stores
 * the thumbnail next to it ({file}.jpg) and inserts the document_attach row. Refused → the upload is removed.
 */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireCan(req, 'Job Management', 'edit');
  await rateLimit(req, 'upload', 30);
  // the body is only the thumbnail (~20 KB) — the video itself never comes here
  if (Number(req.headers.get('content-length') ?? 0) > MAX_THUMB_BYTES)
    throw new HttpError(413, 'ภาพตัวอย่างใหญ่เกิน 1MB');
  const { jobNo, file, name, remark, thumb } = await parseForm(req, attachmentVideoConfirm);
  // a chunked body has no content-length: what was parsed is checked too (name / remark are cut to their columns)
  if (thumb && thumb.size > MAX_THUMB_BYTES) throw new HttpError(413, 'ภาพตัวอย่างใหญ่เกิน 1MB');
  const no = await attachableJob(jobNo); // 404 / 409 — nothing removed: an unchecked job is not this caller's
  // a confirmed video is never confirmed (nor removed below) again
  const [done] = await db
    .select({ id: documentAttach.id })
    .from(documentAttach)
    .where(and(eq(documentAttach.referenceItemCode, no), eq(documentAttach.systemFileName, file)))
    .limit(1);
  if (done) throw new HttpError(409, 'แนบวิดีโอนี้ไว้แล้ว');
  const path = filePath.attachment(no, file);
  const thumbPath = `${path}.jpg`;
  try {
    const problem = thumb && (await fileProblem(thumb, THUMB_TYPES));
    if (problem) throw new HttpError(problem.startsWith('ไฟล์ใหญ่') ? 413 : 415, `ภาพตัวอย่าง: ${problem}`);
    await checkStoredVideo(path);
    // re-encoded like every photo (sharp decodes it: a real JPEG, nothing else rides along)
    if (thumb) await uploadFile(thumbPath, await optimizeImage(thumb));
    const row = await addAttachment(no, name, file, remark, user.userId);
    return NextResponse.json({ ok: true, row: { ...row, file } });
  } catch (e) {
    // never attached: what was uploaded for it goes (the job deleted meanwhile, a wrong / oversize file)
    await Promise.all([removeFile(path), thumb && removeFile(thumbPath)]);
    throw e;
  }
});
