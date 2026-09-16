import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan, HttpError } from "@/server/auth";
import { addAttachment } from "@/server/services/jobs";
import { systemFileName, uploadFile, filePath, ALLOWED_TYPES, MAX_FILE_BYTES } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/**
 * multipart/form-data: file, jobNo, remark → stores the file in Supabase Storage
 * under jobs/{jobNo}/{system_file_name} and inserts a document_attach row.
 */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireCan(req, "Job Management", "edit");
  void user;
  const form = await req.formData().catch(() => null);
  if (!form) throw new HttpError(400, "expected multipart/form-data");
  const file = form.get("file");
  const jobNo = String(form.get("jobNo") ?? "").trim().toUpperCase();
  const remark = String(form.get("remark") ?? "");
  if (!(file instanceof File)) throw new HttpError(400, "file required");
  if (!jobNo) throw new HttpError(400, "jobNo required");
  if (file.size > MAX_FILE_BYTES) throw new HttpError(413, "ไฟล์ใหญ่เกิน 10MB");
  if (file.type && !ALLOWED_TYPES.has(file.type)) throw new HttpError(415, "รองรับเฉพาะ JPG, PNG, WEBP, PDF");
  const sys = systemFileName(file.name);
  await uploadFile(filePath.attachment(jobNo, sys), file);
  const id = await addAttachment(jobNo, file.name, sys, remark);
  return NextResponse.json({ ok: true, row: { id, name: file.name, file: sys, remark } });
});
