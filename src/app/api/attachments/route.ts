import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { job } from '@/db/schema';
import { handle, parseForm, requireCan, HttpError } from '@/server/auth';
import { attachmentAdd } from '@/server/contract/jobs';
import { idempotent } from '@/server/idempotency';
import { rateLimit } from '@/server/rate-limit';
import { addAttachment } from '@/server/services/jobs';
import { RS } from '@/server/record-status';
import {
  systemFileName,
  uploadFile,
  filePath,
  fileProblem,
  optimizeImage,
  ImageTooLargeError,
  MAX_FILE_BYTES,
} from '@/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * multipart/form-data: file, jobNo, remark → stores the file in Supabase Storage
 * under jobs/{jobNo}/{system_file_name} and inserts a document_attach row.
 */
export const POST = handle(async (req: NextRequest) => {
  // cheap checks first (same order as /api/upload): who, how often, how big — before buffering
  const user = await requireCan(req, 'Job Management', 'edit');
  await rateLimit(req, 'upload', 30);
  if (Number(req.headers.get('content-length') ?? 0) > MAX_FILE_BYTES + 1024 * 1024)
    throw new HttpError(413, 'ไฟล์ใหญ่เกิน 10MB');
  // a retried upload (ลองอีกครั้ง after a lost answer) replays the stored answer instead of a second attachment
  return idempotent(req, user.userId, async () => {
    // 400 "expected multipart/form-data" / "ไม่พบไฟล์"; jobNo upper-cased, remark cut at 200
    const { file: sent, jobNo, remark } = await parseForm(req, attachmentAdd);
    // jobNo becomes part of the storage path — it must be a real job, not any string
    const [row] = jobNo
      ? await db.select({ no: job.jobNo, status: job.recordStatus }).from(job).where(eq(job.jobNo, jobNo)).limit(1)
      : [];
    if (!row) throw new HttpError(404, 'ไม่พบหมายเลขงาน ' + jobNo);
    // a deleted job takes no writes (lockJob's rule) — refused before the upload, so no orphan file is stored
    if (row.status === RS.DELETED) throw new HttpError(409, 'งานนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้');
    const problem = await fileProblem(sent);
    if (problem) throw new HttpError(problem.startsWith('ไฟล์ใหญ่') ? 413 : 415, problem);
    // photos resized + re-encoded (EXIF — GPS, camera serial — goes), as /api/upload; video / PDF untouched
    let file: File;
    try {
      file = await optimizeImage(sent);
    } catch (e) {
      if (e instanceof ImageTooLargeError) throw new HttpError(413, 'รูปมีความละเอียดสูงเกินไป (เกิน 40 ล้านพิกเซล)');
      throw e;
    }
    const sys = systemFileName(file.type); // after optimizeImage: a photo-PNG may now be a JPEG
    await uploadFile(filePath.attachment(row.no, sys), file);
    const id = await addAttachment(row.no, file.name.slice(0, 200), sys, remark, user.userId);
    return NextResponse.json({ ok: true, row: { id, name: file.name, file: sys, remark } });
  });
});
