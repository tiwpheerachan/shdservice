import 'server-only';
import { invalidate } from '@/server/cache';
import { and, desc, eq, ne, or, sql } from 'drizzle-orm';
import { db, type Tx } from '@/db/client';
import { appUser, customer, job, jobLog, jobOrderSparePartLog, product, quotationHd, saleOutHd } from '@/db/schema';
import type { Module } from '@/lib/modules';
import { JS, PART } from '@/lib/status-ids';
import { HttpError, fullName, invalidateUserCache } from '@/server/auth';
import { audit, isUuid } from '@/server/audit';
import { pkOf } from '@/server/ids';
import { nowThai, SENTINEL_TS } from '@/server/mappers/format';
import { clean } from '@/lib/validation';
import { RS, statusStamp, statusSummary, type RecordStatus } from '@/server/record-status';
import { isSimpleKind, setModelStatus, setSimpleStatus, setSymptomStatus } from './masters';
import { productsChanged } from './stock';
import { AS } from './sale-orders';
import { DELETED_USER_MSG } from './users';
import { jobNotFound, logStatus } from './jobs';

export type RecordTable =
  | 'users'
  | 'categories'
  | 'manufacturers'
  | 'colors'
  | 'job_types'
  | 'product_types'
  | 'symptoms'
  | 'models'
  | 'products'
  | 'customers'
  | 'jobs'
  | 'quotations'
  | 'sale_orders';

/** Module whose `del` grant is required; null = System Admin only. */
export const RECORD_MODULES: Record<Exclude<RecordTable, 'users'>, Module | null> = {
  categories: null,
  manufacturers: null,
  colors: null,
  job_types: null,
  product_types: null,
  symptoms: null,
  models: null,
  products: 'Product',
  customers: 'Customer',
  jobs: 'Job Management',
  quotations: 'Quotation',
  sale_orders: 'Sale Order',
};

/**
 * Set record_status (ACTIVE / INACTIVE / DELETED) on any entity. Nothing is ever
 * hard-deleted. The legacy flag each table used before is mirrored so the old
 * reports still agree:
 *   masters / customers / products / quotations → is_active
 *   users → is_active + deleted
 *   jobs → DELETED also sets job_status 0 "ยกเลิกข้อมูล" (+ job_log), as the old app did; restoring
 *          puts back the last status before that (job_log; none → 1 งานใหม่, as the old app did) + job_log
 *   sale orders → document_status + cancel stamp (an approved one — stock issued — cannot be cancelled)
 * Restoring a DELETED row is done in SQL only (by decision) — the API still
 * accepts ACTIVE so the existing users-page restore button keeps working.
 * `mayRestore` = the caller holds `del` on the module (customers: is System Admin): taking a row out of DELETED
 * is the reverse of deleting it, so `edit` alone is refused (checked against the row as locked here).
 * `mayCancelOthers` = may cancel a sale order someone else created (System Admin / SO Approve) — a pending
 * order is its creator's, as its edits are.
 */
export async function setRecordStatus(
  table: RecordTable,
  id: string | number,
  rs: RecordStatus,
  byUserId: number,
  mayRestore = true,
  mayCancelOthers = true,
  /** the reason for a DELETED: a sale order's document_cancel_remark; jobs / quotations: on the audit line
   *  (ประวัติการแก้ไข) — required for these three by the API (route.ts) */
  remark?: string | null,
): Promise<void> {
  // a document is ACTIVE or DELETED — INACTIVE left a quotation listed as open with nothing to show it
  if (rs === RS.INACTIVE && (table === 'quotations' || table === 'sale_orders'))
    throw new HttpError(400, 'เอกสารปิดใช้งานไม่ได้ — ลบ (ยกเลิก) หรือกู้คืนเท่านั้น');
  // ADR 0008: a part / job / quotation / sale order comes as its uuid — from here on its code / number
  // (what the rest of this function, its messages and its audit line work with)
  const DOC = { products: 'อะไหล่', jobs: 'งาน', quotations: 'ใบเสนอราคา', sale_orders: 'ใบสั่งขาย' } as const;
  if (table in DOC) {
    const what = DOC[table as keyof typeof DOC];
    if (!isUuid(String(id))) throw new HttpError(404, `ไม่พบ${what}`);
    const uid = String(id).trim().toLowerCase();
    id =
      table === 'products'
        ? await pkOf(product, product.productCode, uid, what)
        : table === 'jobs'
          ? await pkOf(job, job.jobNo, uid, what)
          : table === 'quotations'
            ? await pkOf(quotationHd, quotationHd.quotationNo, uid, what)
            : await pkOf(saleOutHd, saleOutHd.saleOutHdNo, uid, what);
  }
  const stamp = statusStamp(rs, byUserId);
  const ENTITY: Record<string, [string, string]> = {
    users: ['app_user', 'Admin'],
    products: ['product', 'Product'],
    customers: ['customer', 'Customer'],
    jobs: ['job', 'Job Management'],
    quotations: ['quotation_hd', 'Quotation'],
    sale_orders: ['sale_out_hd', 'Sale Order'],
  };
  // what the audit page says (not the table name): a sale order is cancelled, the rest deleted / made Active …
  const NOUN: Record<string, string> = {
    users: 'ผู้ใช้งาน',
    products: 'อะไหล่',
    customers: 'ลูกค้า',
    jobs: 'งาน',
    quotations: 'ใบเสนอราคา',
    sale_orders: 'ใบสั่งขาย',
  };
  // the record_status before this change (read in the change's transaction) — the audit keeps [old, new], not [null, new]
  const OLD: Partial<Record<RecordTable, (tx: Tx) => Promise<{ rs: string }[]>>> = {
    products: (tx) =>
      tx
        .select({ rs: product.recordStatus })
        .from(product)
        .where(eq(product.productCode, String(id)))
        .for('update'),
    quotations: (tx) =>
      tx
        .select({ rs: quotationHd.recordStatus })
        .from(quotationHd)
        .where(eq(quotationHd.quotationNo, String(id)))
        .for('update'),
  };
  const oldOf = async (tx: Tx) => (await OLD[table]?.(tx))?.[0]?.rs ?? null;
  const refuseRestore = (old: string | null) => {
    if (old === RS.DELETED && rs !== RS.DELETED && !mayRestore)
      throw new HttpError(
        403,
        table === 'customers'
          ? 'กู้คืนลูกค้าที่ลบแล้วได้เฉพาะผู้ดูแลระบบ'
          : `กู้คืนรายการที่ลบแล้วได้เฉพาะผู้มีสิทธิ์ลบใน ${ENTITY[table]?.[1]}`,
      );
  };
  /** `label` = what the summary names (users: the name, customers: the code); the key stays `id` */
  const log = async (w: Tx, old: string | null, why = '', label: string | number = id) => {
    const e = ENTITY[table];
    if (!e || old === rs) return; // nothing changed (ACTIVE → ACTIVE): nothing to record
    await audit(w, byUserId, {
      action: rs === RS.DELETED ? 'DELETE' : 'STATUS',
      module: e[1],
      entity: e[0],
      key: id,
      summary:
        statusSummary({ noun: NOUN[table] ?? e[0], key: label, old, rs, cancel: table === 'sale_orders' }) +
        (why && ` · ${why}`),
      changes: { recordStatus: [old, rs] },
      meta: why ? { remark: why } : null, // the summary is cut at 200 characters — the reason whole
    });
  };
  if (isSimpleKind(table)) return setSimpleStatus(table, String(id), rs, byUserId);
  switch (table) {
    case 'symptoms':
      return setSymptomStatus(String(id), rs, byUserId);
    case 'models':
      return setModelStatus(String(id), rs, byUserId);
    case 'users':
      // `id` = the user's uuid (the route checked it); the audit key stays the uuid, the summary names the person
      await db.transaction(async (tx) => {
        const [cur] = await tx
          .select({ rs: appUser.recordStatus, first: appUser.firstName, last: appUser.lastName, u: appUser.username })
          .from(appUser)
          .where(eq(appUser.id, String(id)))
          .for('update');
        if (!cur) throw new HttpError(404, 'ไม่พบผู้ใช้');
        // out of DELETED only through กู้คืน (users.ts setUserDeleted → INACTIVE)
        if (cur.rs === RS.DELETED && rs !== RS.DELETED) throw new HttpError(409, DELETED_USER_MSG);
        await tx
          .update(appUser)
          .set({ ...stamp, deleted: rs === RS.DELETED })
          .where(eq(appUser.id, String(id)));
        await log(tx, cur.rs, '', fullName(cur.first, cur.last) || clean(cur.u));
      });
      invalidateUserCache();
      invalidate('staff');
      return;
    case 'products':
      await db.transaction(async (tx) => {
        const old = await oldOf(tx);
        refuseRestore(old);
        if (rs === RS.DELETED) {
          // a request still waiting for this part could never be issued once it is gone, and its booking stays held
          const waiting = await tx
            .selectDistinct({ no: jobOrderSparePartLog.jobNo })
            .from(jobOrderSparePartLog)
            .innerJoin(job, eq(job.jobNo, jobOrderSparePartLog.jobNo))
            .where(
              and(
                eq(jobOrderSparePartLog.sparePartCode, String(id)),
                eq(jobOrderSparePartLog.orderStatusId, PART.REQUESTED),
                ne(job.recordStatus, RS.DELETED),
              ),
            )
            .limit(5);
          if (waiting.length)
            throw new HttpError(
              409,
              `อะไหล่ ${id} มีงานรอเบิกอยู่ (${waiting.map((w) => w.no).join(', ')}) — ยกเลิกคำขอเบิกก่อนลบ`,
            );
        }
        await tx
          .update(product)
          .set(
            rs === RS.DELETED
              ? { ...stamp, cancelDate: nowThai(), cancelBy: byUserId }
              : { ...stamp, cancelDate: SENTINEL_TS, cancelBy: -1, cancelRemark: '' },
          )
          .where(eq(product.productCode, String(id)));
        await log(tx, old);
      });
      productsChanged();
      return;
    case 'customers':
      // `id` = the customer's uuid (the route checked it): the audit key; the summary names its code
      await db.transaction(async (tx) => {
        const [cur] = await tx
          .select({ rs: customer.recordStatus, code: customer.customerCode })
          .from(customer)
          .where(eq(customer.id, String(id)))
          .for('update');
        if (!cur) throw new HttpError(404, 'ไม่พบลูกค้า');
        refuseRestore(cur.rs);
        await tx
          .update(customer)
          .set(stamp)
          .where(eq(customer.id, String(id)));
        await log(tx, cur.rs, '', cur.code ?? '');
      });
      return;
    case 'quotations':
      await db.transaction(async (tx) => {
        const old = await oldOf(tx);
        refuseRestore(old);
        if (rs === RS.DELETED) {
          // the job's approved quotation: deleting it left the job pointing at a deleted document
          const [held] = await tx
            .select({ no: job.jobNo })
            .from(job)
            .where(and(eq(job.quotationNoApproved, String(id)), ne(job.recordStatus, RS.DELETED)))
            .limit(1);
          if (held)
            throw new HttpError(
              409,
              `ใบเสนอราคานี้ลูกค้าตกลงแล้ว (งาน ${held.no}) — เปลี่ยนสถานะเป็นลูกค้าไม่ตกลงก่อน แล้วจึงลบ`,
            );
        }
        await tx
          .update(quotationHd)
          .set(stamp)
          .where(eq(quotationHd.quotationNo, String(id)));
        await log(tx, old, rs === RS.DELETED ? clean(remark) : '');
      });
      return;
    case 'jobs': {
      await db.transaction(async (tx) => {
        // locked like the job workflows (lockJob): a save running now finishes first
        const [cur] = await tx
          .select({ st: job.jobStatusId, rs: job.recordStatus })
          .from(job)
          .where(eq(job.jobNo, String(id)))
          .for('update');
        if (!cur) throw jobNotFound(String(id));
        refuseRestore(cur.rs);
        // a second cancel (a stale list) must not add a second reason to the history
        if (rs === RS.DELETED && cur.rs === RS.DELETED)
          throw new HttpError(409, 'งานนี้ถูกยกเลิกไปแล้ว — โหลดหน้าใหม่');
        if (rs === RS.DELETED) {
          // parts still waiting for stock, or issued and not back: deleting would leave the booking held and the
          // stock out against a job no list shows
          const open = await tx
            .selectDistinct({ code: jobOrderSparePartLog.sparePartCode })
            .from(jobOrderSparePartLog)
            .where(
              and(
                eq(jobOrderSparePartLog.jobNo, String(id)),
                or(
                  eq(jobOrderSparePartLog.orderStatusId, PART.REQUESTED),
                  eq(jobOrderSparePartLog.orderStatusId, PART.RETURN_REQUESTED),
                  sql`coalesce(${jobOrderSparePartLog.grantQty}, 0) > coalesce(${jobOrderSparePartLog.returnQty}, 0)`,
                ),
              ),
            );
          if (open.length)
            throw new HttpError(
              409,
              `งานนี้ยังมีอะไหล่รอเบิก หรือจ่ายไปแล้วยังไม่รับคืน (${open.map((p) => p.code).join(', ')}) — ยกเลิกคำขอเบิก / รับคืนอะไหล่เข้าสต๊อกก่อนลบ`,
            );
        }
        // restored → the status it had before it was deleted (a job left on 0 "ยกเลิกข้อมูล" matched no list)
        let back: number | null = null;
        if (rs !== RS.DELETED && cur.rs === RS.DELETED && cur.st === JS.CANCELLED) {
          const [prev] = await tx
            .select({ st: jobLog.jobStatusId })
            .from(jobLog)
            .where(and(eq(jobLog.jobNo, String(id)), ne(jobLog.jobStatusId, JS.CANCELLED)))
            .orderBy(desc(jobLog.jobLogId))
            .limit(1);
          back = prev?.st ?? JS.NEW;
        }
        const st = rs === RS.DELETED ? JS.CANCELLED : back;
        await tx
          .update(job)
          .set({ ...statusStamp(rs, byUserId, false), ...(st !== null ? { jobStatusId: st } : {}) })
          .where(eq(job.jobNo, String(id)));
        if (st !== null && st !== cur.st) await logStatus(tx, String(id), st, byUserId);
        await log(tx, cur.rs, rs === RS.DELETED ? clean(remark) : '');
      });
      return;
    }
    case 'sale_orders': {
      const reason = rs === RS.DELETED ? clean(remark) : '';
      await db.transaction(async (tx) => {
        // locked: an approval running now finishes first (approveSaleOrder locks the same row)
        const [cur] = await tx
          .select({ ap: saleOutHd.approveStatusId, rs: saleOutHd.recordStatus, by: saleOutHd.documentCreateBy })
          .from(saleOutHd)
          .where(eq(saleOutHd.saleOutHdNo, String(id)))
          .for('update');
        if (!cur) throw new HttpError(404, 'ไม่พบใบสั่งขาย ' + id);
        refuseRestore(cur.rs);
        // the creator cancels their own while it is draft / waiting / sent back
        if (rs === RS.DELETED && !mayCancelOthers && cur.by !== byUserId)
          throw new HttpError(403, 'ยกเลิกได้เฉพาะผู้สร้างใบสั่งขาย ผู้อนุมัติ หรือผู้ดูแลระบบ');
        if (rs === RS.DELETED && cur.ap === AS.APPROVED)
          throw new HttpError(
            409,
            'ใบสั่งขายนี้อนุมัติแล้ว ตัดสต็อกไปแล้ว — ยกเลิกไม่ได้ ต้องรับคืนสินค้าเข้าสต็อกก่อน',
          );
        // denied is final, as approved (saveSaleOrder / approveSaleOrder refuse it too; legacy never cancelled one)
        if (rs === RS.DELETED && cur.ap === AS.DENIED)
          throw new HttpError(409, 'ใบสั่งขายนี้ถูกปฏิเสธแล้ว — ยกเลิกไม่ได้');
        // a second cancel (two people at once, a stale page) must not overwrite who cancelled it and why
        if (rs === RS.DELETED && cur.rs === RS.DELETED)
          throw new HttpError(409, 'ใบสั่งขายนี้ถูกยกเลิกไปแล้ว — โหลดหน้าใหม่');
        // the edit page asks for it and shows it — the API must not cancel without one either
        if (rs === RS.DELETED && !reason)
          throw new HttpError(400, 'ระบุเหตุผลที่ยกเลิก', { fields: { remark: 'ระบุเหตุผลที่ยกเลิก' } });
        // document_cancel_remark is varchar(100); the API takes 200 (a job's / quotation's reason)
        if (reason.length > 100)
          throw new HttpError(400, 'เหตุผลยาวเกิน 100 ตัวอักษร', { fields: { remark: 'เหตุผลยาวเกิน 100 ตัวอักษร' } });
        await tx
          .update(saleOutHd)
          .set(
            rs === RS.DELETED
              ? {
                  ...statusStamp(rs, byUserId, false),
                  documentStatus: false,
                  documentCancelDate: nowThai(),
                  documentCancelBy: byUserId,
                  documentCancelRemark: reason,
                }
              : {
                  ...statusStamp(rs, byUserId, false),
                  documentStatus: true,
                  documentCancelDate: SENTINEL_TS,
                  documentCancelBy: -1,
                  documentCancelRemark: '',
                },
          )
          .where(eq(saleOutHd.saleOutHdNo, String(id)));
        await log(tx, cur.rs, reason);
      });
      return;
    }
  }
}
