import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, type Tx } from '@/db/client';
import { job, product, saleOutHd } from '@/db/schema';
import { handle, parseForm, requireUser, requireCan, requireAdmin, HttpError } from '@/server/auth';
import { upload } from '@/server/contract/misc';
import { rateLimit } from '@/server/rate-limit';
import { audit } from '@/server/audit';
import { AS } from '@/server/services/sale-orders';
import { overpaidMessage, SO_CANCELLED, WAITING_CREATOR_ONLY } from '@/lib/validation/sale-order';
import { money, num } from '@/server/mappers/format';
import { moneyLockedMsg } from '@/lib/validation/job';
import { jobClosed, moneyLocked } from '@/server/services/jobs';
import { RS } from '@/server/record-status';
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

/**
 * multipart/form-data: kind, id, file → stores the file in bucket `oneservice`
 * and writes the reference into the legacy column:
 *   product-image    → product.pictrue_file_name      (products/{code}/{file}; column keeps the file name)
 *   sale-order-slip  → sale_out_hd.slip_file_name     (full path; + payment_amount when `paymentAmount` is sent)
 *   job-slip         → job.job_payment_slip_file_name (full path)
 * Replacing a file removes the previous object — except a closed job's slip, kept as evidence.
 */
export const POST = handle(async (req: NextRequest) => {
  // cheap checks first: an anonymous caller must not make us buffer or decode anything
  await requireUser(req);
  await rateLimit(req, 'upload', 30);
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_FILE_BYTES + 1024 * 1024) throw new HttpError(413, 'ไฟล์ใหญ่เกิน 10MB');

  // 400 "expected multipart/form-data" / "file required" / "id required"; id upper-cased; an unknown kind
  // reads as none — refused below ("unknown kind"), after the file checks
  const { kind, id, file, paymentAmount } = await parseForm(req, upload);
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
      await db.transaction(async (tx) => {
        await tx.update(product).set({ pictrueFileName: sys }).where(eq(product.productCode, id));
        await audit(tx, me.userId, {
          action: 'UPDATE',
          module: 'Product',
          entity: 'product',
          key: id,
          summary: `เปลี่ยนรูปอะไหล่ ${id}`,
          changes: { pictrueFileName: [row.old, sys] },
        });
      });
      if (row.old) await removeFile(resolvePath(row.old, (f) => filePath.productImage(id, f)));
      return NextResponse.json({ ok: true, path, file: sys });
    }
    case 'sale-order-slip': {
      const cols = {
        old: saleOutHd.slipFileName,
        approve: saleOutHd.approveStatusId,
        status: saleOutHd.recordStatus,
        createdBy: saleOutHd.documentCreateBy,
        net: saleOutHd.netAmount,
        paid: saleOutHd.paymentAmount,
      };
      // the amount paid, sent with the slip (an approved order's customer paying later) — never over the total
      const paid = paymentAmount != null && paymentAmount !== '' ? num(paymentAmount) : null;
      const guard = <
        R extends {
          old: string | null;
          approve: number | null;
          status: string | null;
          createdBy: number | null;
          net: string | null;
        },
      >(
        row?: R,
      ) => {
        if (!row) throw new HttpError(404, 'ไม่พบใบสั่งขาย ' + id);
        // a denied / cancelled order is final, an approved one once it has a slip: the slip the approver saw is
        // the evidence, never swapped (and the old one deleted) — an approved order without one takes it (paid later)
        if (row.status === RS.DELETED) throw new HttpError(409, `${SO_CANCELLED} — เปลี่ยนสลิปไม่ได้`);
        if (row.approve === AS.APPROVED && row.old)
          throw new HttpError(409, 'ใบสั่งขายอนุมัติแล้ว — เปลี่ยนสลิปไม่ได้');
        if (row.approve === AS.DENIED) throw new HttpError(409, 'ใบสั่งขายถูกปฏิเสธแล้ว — เปลี่ยนสลิปไม่ได้');
        // … and a waiting one is its creator's (or System Admin's), as editing it is (saveSaleOrder)
        if (row.approve === AS.WAIT && !me.isAdmin && row.createdBy !== me.userId)
          throw new HttpError(403, WAITING_CREATOR_ONLY);
        if (paid !== null && paid > num(row.net))
          throw new HttpError(400, overpaidMessage(num(row.net)), {
            fields: { paymentAmount: overpaidMessage(num(row.net)) },
          });
        return row;
      };
      // before the upload (a refused one stores nothing), and again under the row lock (swapSlip)
      guard((await db.select(cols).from(saleOutHd).where(eq(saleOutHd.saleOutHdNo, id)))[0]);
      const path = filePath.saleOrderSlip(id, sys);
      await uploadFile(path, body);
      await swapSlip(path, async (tx) => {
        const row = guard(
          (await tx.select(cols).from(saleOutHd).where(eq(saleOutHd.saleOutHdNo, id)).for('update'))[0],
        );
        await tx
          .update(saleOutHd)
          .set({ slipFileName: path, ...(paid !== null ? { paymentAmount: money(paid) } : {}) })
          .where(eq(saleOutHd.saleOutHdNo, id));
        await audit(tx, me.userId, {
          action: 'UPDATE',
          module: 'Sale Order',
          entity: 'sale_out_hd',
          key: id,
          summary:
            `แนบสลิปใบสั่งขาย ${id}` +
            (row.approve === AS.APPROVED ? ' (หลังอนุมัติ)' : '') +
            (paid !== null ? ` · ชำระ ${paid.toFixed(2)} บาท` : ''),
          changes: {
            slipFileName: [row.old, path],
            ...(paid !== null ? { paymentAmount: [row.paid === null ? null : num(row.paid), paid] } : {}),
          },
        });
        // only ever delete this order's own slip folder (a stored path is data, not a command)
        return row.old?.startsWith(`sale-orders/${id}/slip/`) ? row.old : null;
      });
      return NextResponse.json({ ok: true, path, file: sys });
    }
    case 'job-slip': {
      const cols = { old: job.jobPaymentSlipFileName, status: job.jobStatusId, rs: job.recordStatus };
      const guard = async <R extends { status: number | null; rs: string | null }>(row?: R) => {
        if (!row) throw new HttpError(404, 'ไม่พบหมายเลขงาน ' + id);
        if (row.rs === RS.DELETED) throw new HttpError(409, 'งานนี้ถูกยกเลิกแล้ว — เปลี่ยนสลิปไม่ได้');
        // the slip is part of the job's money: a closed job's needs Job Money After Close, like the payment fields
        if (await moneyLocked(row.status, me.userId)) throw new HttpError(409, moneyLockedMsg('สลิปการชำระเงิน'));
        return row;
      };
      await guard((await db.select(cols).from(job).where(eq(job.jobNo, id)))[0]);
      const path = filePath.jobSlip(id, sys);
      await uploadFile(path, body);
      await swapSlip(path, async (tx) => {
        const row = await guard((await tx.select(cols).from(job).where(eq(job.jobNo, id)).for('update'))[0]);
        await tx.update(job).set({ jobPaymentSlipFileName: path }).where(eq(job.jobNo, id));
        await audit(tx, me.userId, {
          action: 'UPDATE',
          module: 'Job Closing',
          entity: 'job',
          key: id,
          summary: `แนบสลิปชำระเงินงาน ${id}`,
          changes: { jobPaymentSlipFileName: [row.old, path] },
        });
        // a closed job's previous slip stays in storage as evidence (the audit line names it)
        return !(await jobClosed(row.status)) && row.old?.startsWith(`jobs/${id}/slip/`) ? row.old : null;
      });
      return NextResponse.json({ ok: true, path, file: sys });
    }
  }
  throw new HttpError(400, 'unknown kind');
});

/**
 * Writes a slip path under its row's lock: `write` re-reads and re-checks the row there (an approval / a
 * job close racing the upload is then wholly before it — refused — or after it) and returns the stored
 * path it replaced. Refused → the new file is removed; saved → the replaced one, after the commit (of two
 * uploads at once, the second replaces the first's file, read under the lock — none is orphaned).
 */
async function swapSlip(path: string, write: (tx: Tx) => Promise<string | null | undefined>) {
  let old: string | null | undefined;
  try {
    old = await db.transaction(write);
  } catch (e) {
    await removeFile(path);
    throw e;
  }
  if (old && old !== path) await removeFile(old);
}
