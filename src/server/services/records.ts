import 'server-only';
import { invalidate } from '@/server/cache';
import { and, desc, eq, ne } from 'drizzle-orm';
import { db, type Tx } from '@/db/client';
import { appUser, customer, job, jobLog, product, quotationHd, saleOutHd } from '@/db/schema';
import type { Module } from '@/lib/modules';
import { JS } from '@/lib/status-ids';
import { HttpError, invalidateUserCache } from '@/server/auth';
import { audit } from '@/server/audit';
import { nowThai, SENTINEL_TS } from '@/server/mappers/format';
import { RS, statusStamp, type RecordStatus } from '@/server/record-status';
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
 */
export async function setRecordStatus(
  table: RecordTable,
  id: string | number,
  rs: RecordStatus,
  byUserId: number,
): Promise<void> {
  const stamp = statusStamp(rs, byUserId);
  const ENTITY: Record<string, [string, string]> = {
    users: ['app_user', 'Admin'],
    products: ['product', 'Product'],
    customers: ['customer', 'Customer'],
    jobs: ['job', 'Job Management'],
    quotations: ['quotation_hd', 'Quotation'],
    sale_orders: ['sale_out_hd', 'Sale Order'],
  };
  // the record_status before this change (read in the change's transaction) — the audit keeps [old, new], not [null, new]
  const OLD: Partial<Record<RecordTable, (tx: Tx) => Promise<{ rs: string }[]>>> = {
    users: (tx) =>
      tx
        .select({ rs: appUser.recordStatus })
        .from(appUser)
        .where(eq(appUser.userId, Number(id)))
        .for('update'),
    products: (tx) =>
      tx
        .select({ rs: product.recordStatus })
        .from(product)
        .where(eq(product.productCode, String(id)))
        .for('update'),
    customers: (tx) =>
      tx
        .select({ rs: customer.recordStatus })
        .from(customer)
        .where(eq(customer.customerCode, String(id)))
        .for('update'),
    quotations: (tx) =>
      tx
        .select({ rs: quotationHd.recordStatus })
        .from(quotationHd)
        .where(eq(quotationHd.quotationNo, String(id)))
        .for('update'),
  };
  const oldOf = async (tx: Tx) => (await OLD[table]?.(tx))?.[0]?.rs ?? null;
  const log = async (w: Tx, old: string | null) => {
    const e = ENTITY[table];
    if (!e) return;
    await audit(w, byUserId, {
      action: rs === RS.DELETED ? 'DELETE' : 'STATUS',
      module: e[1],
      entity: e[0],
      key: id,
      summary: rs === RS.DELETED ? `ลบ (soft delete) ${e[0]} ${id}` : `${e[0]} ${id} → ${rs}`,
      changes: { recordStatus: [old, rs] },
    });
  };
  if (isSimpleKind(table)) return setSimpleStatus(table, Number(id), rs, byUserId);
  switch (table) {
    case 'symptoms':
      return setSymptomStatus(Number(id), rs, byUserId);
    case 'models':
      return setModelStatus(String(id), rs, byUserId);
    case 'users':
      await db.transaction(async (tx) => {
        const old = await oldOf(tx);
        // out of DELETED only through กู้คืน (users.ts setUserDeleted → INACTIVE)
        if (old === RS.DELETED && rs !== RS.DELETED) throw new HttpError(409, DELETED_USER_MSG);
        await tx
          .update(appUser)
          .set({ ...stamp, deleted: rs === RS.DELETED })
          .where(eq(appUser.userId, Number(id)));
        await log(tx, old);
      });
      invalidateUserCache();
      invalidate('staff');
      return;
    case 'products':
      await db.transaction(async (tx) => {
        const old = await oldOf(tx);
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
      await db.transaction(async (tx) => {
        const old = await oldOf(tx);
        await tx
          .update(customer)
          .set(stamp)
          .where(eq(customer.customerCode, String(id)));
        await log(tx, old);
      });
      return;
    case 'quotations':
      await db.transaction(async (tx) => {
        const old = await oldOf(tx);
        await tx
          .update(quotationHd)
          .set(stamp)
          .where(eq(quotationHd.quotationNo, String(id)));
        await log(tx, old);
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
        await log(tx, cur.rs);
      });
      return;
    }
    case 'sale_orders':
      await db.transaction(async (tx) => {
        // locked: an approval running now finishes first (approveSaleOrder locks the same row)
        const [cur] = await tx
          .select({ ap: saleOutHd.approveStatusId, rs: saleOutHd.recordStatus })
          .from(saleOutHd)
          .where(eq(saleOutHd.saleOutHdNo, String(id)))
          .for('update');
        if (!cur) throw new HttpError(404, 'ไม่พบใบสั่งขาย ' + id);
        if (rs === RS.DELETED && cur.ap === AS.APPROVED)
          throw new HttpError(
            409,
            'ใบสั่งขายนี้อนุมัติแล้ว ตัดสต็อกไปแล้ว — ยกเลิกไม่ได้ ต้องรับคืนสินค้าเข้าสต็อกก่อน',
          );
        await tx
          .update(saleOutHd)
          .set(
            rs === RS.DELETED
              ? {
                  ...statusStamp(rs, byUserId, false),
                  documentStatus: false,
                  documentCancelDate: nowThai(),
                  documentCancelBy: byUserId,
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
        await log(tx, cur.rs);
      });
      return;
  }
}
