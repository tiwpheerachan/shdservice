import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { job } from "@/db/schema";
import { handle, requireCan, HttpError } from "@/server/auth";
import { rateLimit } from "@/server/rate-limit";
import { addAttachment } from "@/server/services/jobs";
import { systemFileName, uploadFile, filePath, fileProblem, MAX_FILE_BYTES } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/**
 * multipart/form-data: file, jobNo, remark → stores the file in Supabase Storage
 * under jobs/{jobNo}/{system_file_name} and inserts a document_attach row.
 */
export const POST = handle(async (req: NextRequest) => {
  // cheap checks first (same order as /api/upload): who, how often, how big — before buffering
  const user = await requireCan(req, "Job Management", "edit");
  await rateLimit(req, "upload", 30);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 1024 * 1024) throw new HttpError(413, "ไฟล์ใหญ่เกิน 10MB");
  const form = await req.formData().catch(() => null);
  if (!form) throw new HttpError(400, "expected multipart/form-data");
  const file = form.get("file");
  const jobNo = String(form.get("jobNo") ?? "").trim().toUpperCase();
  const remark = String(form.get("remark") ?? "").slice(0, 200);
  if (!(file instanceof File)) throw new HttpError(400, "ไม่พบไฟล์");
  // jobNo becomes part of the storage path — it must be a real job, not any string
  const [row] = jobNo ? await db.select({ no: job.jobNo }).from(job).where(eq(job.jobNo, jobNo)).limit(1) : [];
  if (!row) throw new HttpError(404, "ไม่พบหมายเลขงาน " + jobNo);
  const problem = await fileProblem(file);
  if (problem) throw new HttpError(problem.startsWith("ไฟล์ใหญ่") ? 413 : 415, problem);
  const sys = systemFileName(file.type);
  await uploadFile(filePath.attachment(row.no, sys), file);
  const id = await addAttachment(row.no, file.name.slice(0, 200), sys, remark, user.userId);
  return NextResponse.json({ ok: true, row: { id, name: file.name, file: sys, remark } });
});
