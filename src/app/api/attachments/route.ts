import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseForm, requireCan, HttpError } from '@/server/auth';
import { attachmentAdd } from '@/server/contract/jobs';
import { idempotent } from '@/server/idempotency';
import { rateLimit } from '@/server/rate-limit';
import { addAttachment, attachableJob } from '@/server/services/jobs';
import {
  systemFileName,
  uploadFile,
  removeFile,
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
    // 400 "expected multipart/form-data" / "ไม่พบไฟล์"; jobNo upper-cased, remark cut at 100
    const { file: sent, jobNo, remark } = await parseForm(req, attachmentAdd);
    // jobNo becomes part of the storage path — a real job (404), not deleted (409): refused before the upload
    const no = await attachableJob(jobNo);
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
    const path = filePath.attachment(no, sys);
    await uploadFile(path, file);
    // the job is checked again under its lock when the row goes in (deleted during the upload → 409): no orphan file
    const row = await addAttachment(no, file.name.slice(0, 200), sys, remark, user.userId).catch(async (e) => {
      await removeFile(path);
      throw e;
    });
    return NextResponse.json({ ok: true, row: { ...row, file: sys } });
  });
});
