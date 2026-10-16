import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { job, product, saleOutHd } from '@/db/schema';
import { handle, requireUser, requireCan, requireAdmin, HttpError } from '@/server/auth';
import { rateLimit } from '@/server/rate-limit';
import { AS } from '@/server/services/sale-orders';
import { WAITING_CREATOR_ONLY } from '@/lib/validation/sale-order';
import { getDocumentProfile, setDocumentProfileLogo } from '@/server/services/document-profiles';
import { getShippingProfile, setShippingProfileLogo } from '@/server/services/shipping-profiles';
import {
  systemFileName,
  uploadFile,
  removeFile,
  filePath,
  resolvePath,
  optimizeImage,
  ImageTooLargeError,
  fileProblem,
  MAX_FILE_BYTES,
} from '@/server/storage';

const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Kind = 'product-image' | 'sale-order-slip' | 'job-slip' | 'profile-logo' | 'shipper-logo';

/**
 * multipart/form-data: kind, id, file → stores the file in bucket `oneservice`
 * and writes the reference into the legacy column:
 *   product-image    → product.pictrue_file_name      (products/{code}/{file}; column keeps the file name)
 *   sale-order-slip  → sale_out_hd.slip_file_name     (full path)
 *   job-slip         → job.job_payment_slip_file_name (full path)
 * Replacing a file removes the previous object.
 */
export const POST = handle(async (req: NextRequest) => {
  // cheap checks first: an anonymous caller must not make us buffer or decode anything
  await requireUser(req);
  await rateLimit(req, 'upload', 30);
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_FILE_BYTES + 1024 * 1024) throw new HttpError(413, 'ไฟล์ใหญ่เกิน 10MB');

  const form = await req.formData().catch(() => null);
  if (!form) throw new HttpError(400, 'expected multipart/form-data');
  const kind = String(form.get('kind') ?? '') as Kind;
  const id = String(form.get('id') ?? '')
    .trim()
    .toUpperCase();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'file required');
  if (!id) throw new HttpError(400, 'id required');
  // images only for pictures/logos; slips may also be PDF. Checked against the bytes BEFORE sharp sees them.
  const problem = await fileProblem(
    file,
    kind === 'product-image' || kind === 'profile-logo' || kind === 'shipper-logo' ? IMAGE_TYPES : undefined,
  );
  if (problem) throw new HttpError(problem.startsWith('ไฟล์ใหญ่') ? 413 : 415, problem);

  // the permission for this kind BEFORE any image processing
  const me =
    kind === 'profile-logo' || kind === 'shipper-logo'
      ? await requireAdmin(req)
      : kind === 'product-image'
        ? await requireCan(req, 'Product', 'edit')
        : kind === 'sale-order-slip'
          ? await requireCan(req, 'Sale Order', 'edit')
          : kind === 'job-slip'
            ? await requireCan(req, 'Job Closing', 'edit')
            : null;
  if (!me) throw new HttpError(400, 'unknown kind');

  // photos (product image / payment slips) are resized server-side; the logo is kept as uploaded
  let body: File;
  try {
    body = kind === 'profile-logo' || kind === 'shipper-logo' ? file : await optimizeImage(file);
  } catch (e) {
    if (e instanceof ImageTooLargeError) throw new HttpError(413, 'รูปมีความละเอียดสูงเกินไป (เกิน 40 ล้านพิกเซล)');
    throw e;
  }
  const sys = systemFileName(body.type); // after optimizeImage: a photo-PNG may now be a JPEG
  switch (kind) {
    case 'profile-logo': {
      // ออกเอกสารในนาม — logo printed on quotations / labels / return notes (System Admin)
      const pid = Number(id);
      const prof = await getDocumentProfile(pid);
      if (!prof || prof.id !== pid) throw new HttpError(404, 'ไม่พบโปรไฟล์ ' + id);
      const path = filePath.profileLogo(pid, sys);
      await uploadFile(path, file);
      await setDocumentProfileLogo(pid, path, me.userId);
      if (prof.logoPath) await removeFile(prof.logoPath);
      return NextResponse.json({ ok: true, path, file: sys });
    }
    case 'shipper-logo': {
      // โลโก้บริษัทขนส่ง — printed on the public tracking page (System Admin)
      const sid = Number(id);
      const prof = await getShippingProfile(sid);
      if (!prof) throw new HttpError(404, 'ไม่พบโปรไฟล์ขนส่ง ' + id);
      const path = filePath.shipperLogo(sid, sys);
      await uploadFile(path, body);
      await setShippingProfileLogo(sid, path, me.userId);
      if (prof.logoPath) await removeFile(prof.logoPath);
      return NextResponse.json({ ok: true, path, file: sys });
    }
    case 'product-image': {
      const [row] = await db.select({ old: product.pictrueFileName }).from(product).where(eq(product.productCode, id));
      if (!row) throw new HttpError(404, 'ไม่พบรหัสอะไหล่ ' + id);
      const path = filePath.productImage(id, sys);
      await uploadFile(path, body);
      await db.update(product).set({ pictrueFileName: sys }).where(eq(product.productCode, id));
      if (row.old) await removeFile(resolvePath(row.old, (f) => filePath.productImage(id, f)));
      return NextResponse.json({ ok: true, path, file: sys });
    }
    case 'sale-order-slip': {
      const [row] = await db
        .select({
          old: saleOutHd.slipFileName,
          approve: saleOutHd.approveStatusId,
          status: saleOutHd.recordStatus,
          createdBy: saleOutHd.documentCreateBy,
        })
        .from(saleOutHd)
        .where(eq(saleOutHd.saleOutHdNo, id));
      if (!row) throw new HttpError(404, 'ไม่พบใบสั่งขาย ' + id);
      // an approved / denied / cancelled order is final: its slip is the evidence, not to be swapped (and the old one deleted)
      if (row.approve === AS.APPROVED || row.approve === AS.DENIED || row.status === 'DELETED')
        throw new HttpError(409, 'ใบสั่งขายนี้อนุมัติ ปฏิเสธ หรือยกเลิกแล้ว — เปลี่ยนสลิปไม่ได้');
      // … and a waiting one is its creator's (or System Admin's), as editing it is (saveSaleOrder)
      if (row.approve === AS.WAIT && !me.isAdmin && row.createdBy !== me.userId)
        throw new HttpError(403, WAITING_CREATOR_ONLY);
      const path = filePath.saleOrderSlip(id, sys);
      await uploadFile(path, body);
      await db.update(saleOutHd).set({ slipFileName: path }).where(eq(saleOutHd.saleOutHdNo, id));
      // only ever delete this order's own slip folder (a stored path is data, not a command)
      if (row.old && row.old.startsWith(`sale-orders/${id}/slip/`)) await removeFile(row.old);
      return NextResponse.json({ ok: true, path, file: sys });
    }
    case 'job-slip': {
      const [row] = await db.select({ old: job.jobPaymentSlipFileName }).from(job).where(eq(job.jobNo, id));
      if (!row) throw new HttpError(404, 'ไม่พบหมายเลขงาน ' + id);
      const path = filePath.jobSlip(id, sys);
      await uploadFile(path, body);
      await db.update(job).set({ jobPaymentSlipFileName: path }).where(eq(job.jobNo, id));
      if (row.old && row.old.startsWith(`jobs/${id}/slip/`)) await removeFile(row.old);
      return NextResponse.json({ ok: true, path, file: sys });
    }
  }
  throw new HttpError(400, 'unknown kind');
});
