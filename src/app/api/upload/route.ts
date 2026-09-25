import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { job, product, saleOutHd } from "@/db/schema";
import { handle, requireCan, requireAdmin, HttpError } from "@/server/auth";
import { getDocumentProfile, setDocumentProfileLogo } from "@/server/services/document-profiles";
import { getShippingProfile, setShippingProfileLogo } from "@/server/services/shipping-profiles";
import { systemFileName, uploadFile, removeFile, filePath, resolvePath, optimizeImage, ALLOWED_TYPES, MAX_FILE_BYTES } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Kind = "product-image" | "sale-order-slip" | "job-slip" | "profile-logo" | "shipper-logo";

/**
 * multipart/form-data: kind, id, file → stores the file in bucket `oneservice`
 * and writes the reference into the legacy column:
 *   product-image    → product.pictrue_file_name      (products/{code}/{file}; column keeps the file name)
 *   sale-order-slip  → sale_out_hd.slip_file_name     (full path)
 *   job-slip         → job.job_payment_slip_file_name (full path)
 * Replacing a file removes the previous object.
 */
export const POST = handle(async (req: NextRequest) => {
  const form = await req.formData().catch(() => null);
  if (!form) throw new HttpError(400, "expected multipart/form-data");
  const kind = String(form.get("kind") ?? "") as Kind;
  const id = String(form.get("id") ?? "").trim().toUpperCase();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "file required");
  if (!id) throw new HttpError(400, "id required");
  if (file.size > MAX_FILE_BYTES) throw new HttpError(413, "ไฟล์ใหญ่เกิน 10MB");
  if (file.type && !ALLOWED_TYPES.has(file.type)) throw new HttpError(415, "รองรับเฉพาะ JPG, PNG, WEBP, PDF");
  if ((kind === "product-image" || kind === "profile-logo" || kind === "shipper-logo") && file.type === "application/pdf") throw new HttpError(415, kind === "profile-logo" ? "โลโก้ต้องเป็นไฟล์ภาพ" : "รูปอะไหล่ต้องเป็นไฟล์ภาพ");

  // photos (product image / payment slips) are resized server-side; the logo is kept as uploaded
  const body = kind === "profile-logo" || kind === "shipper-logo" ? file : await optimizeImage(file);
  const sys = systemFileName(body.name); // after optimizeImage: a photo-PNG may now be .jpg
  switch (kind) {
    case "profile-logo": {
      // ออกเอกสารในนาม — logo printed on quotations / labels / return notes (System Admin)
      const me = await requireAdmin(req);
      const pid = Number(id);
      const prof = await getDocumentProfile(pid);
      if (!prof || prof.id !== pid) throw new HttpError(404, "ไม่พบโปรไฟล์ " + id);
      const path = filePath.profileLogo(pid, sys);
      await uploadFile(path, file);
      await setDocumentProfileLogo(pid, path, me.userId);
      if (prof.logoPath) await removeFile(prof.logoPath);
      return NextResponse.json({ ok: true, path, file: sys });
    }
    case "shipper-logo": {
      // โลโก้บริษัทขนส่ง — printed on the public tracking page (System Admin)
      const me = await requireAdmin(req);
      const sid = Number(id);
      const prof = await getShippingProfile(sid);
      if (!prof) throw new HttpError(404, "ไม่พบโปรไฟล์ขนส่ง " + id);
      const path = filePath.shipperLogo(sid, sys);
      await uploadFile(path, body);
      await setShippingProfileLogo(sid, path, me.userId);
      if (prof.logoPath) await removeFile(prof.logoPath);
      return NextResponse.json({ ok: true, path, file: sys });
    }
    case "product-image": {
      await requireCan(req, "Product", "edit");
      const [row] = await db.select({ old: product.pictrueFileName }).from(product).where(eq(product.productCode, id));
      if (!row) throw new HttpError(404, "ไม่พบรหัสอะไหล่ " + id);
      const path = filePath.productImage(id, sys);
      await uploadFile(path, body);
      await db.update(product).set({ pictrueFileName: sys }).where(eq(product.productCode, id));
      if (row.old) await removeFile(resolvePath(row.old, (f) => filePath.productImage(id, f)));
      return NextResponse.json({ ok: true, path, file: sys });
    }
    case "sale-order-slip": {
      await requireCan(req, "Sale Order", "edit");
      const [row] = await db.select({ old: saleOutHd.slipFileName }).from(saleOutHd).where(eq(saleOutHd.saleOutHdNo, id));
      if (!row) throw new HttpError(404, "ไม่พบใบสั่งขาย " + id);
      const path = filePath.saleOrderSlip(id, sys);
      await uploadFile(path, body);
      await db.update(saleOutHd).set({ slipFileName: path }).where(eq(saleOutHd.saleOutHdNo, id));
      if (row.old && row.old.includes("/")) await removeFile(row.old);
      return NextResponse.json({ ok: true, path, file: sys });
    }
    case "job-slip": {
      await requireCan(req, "Job Closing", "edit");
      const [row] = await db.select({ old: job.jobPaymentSlipFileName }).from(job).where(eq(job.jobNo, id));
      if (!row) throw new HttpError(404, "ไม่พบหมายเลขงาน " + id);
      const path = filePath.jobSlip(id, sys);
      await uploadFile(path, body);
      await db.update(job).set({ jobPaymentSlipFileName: path }).where(eq(job.jobNo, id));
      if (row.old && row.old.includes("/")) await removeFile(row.old);
      return NextResponse.json({ ok: true, path, file: sys });
    }
  }
  throw new HttpError(400, "unknown kind");
});
