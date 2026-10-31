import 'server-only';
import { invalidate } from '@/server/cache';
import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { db, type Tx, writeTx } from '@/db/client';
import { appUser, customer, job, jobStatusLog, jobPart, product, quotation, saleOrder } from '@/db/schema';
import type { Module } from '@/lib/modules';
import { JS, PART } from '@/lib/status-ids';
import { HttpError, fullName, invalidateUserCache } from '@/server/auth';
import { audit, isUuid } from '@/server/audit';
import { nowThai } from '@/server/mappers/format';
import { clean } from '@/lib/validation';
import { RS, statusStamp, statusSummary, type RecordStatus } from '@/server/record-status';
import { isSimpleKind, setModelStatus, setSimpleStatus, setSymptomStatus } from './masters';
import { productsChanged } from './stock';
import { AS } from './sale-orders';
import { DELETED_USER_MSG } from './users';
import { AGREED_QUOTATION_STATUSES, agreedQuotationPk, jobNotFound, logStatus } from './jobs';

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
 * Set record_status on any entity; nothing is ever hard-deleted. Jobs → DELETED also sets job_status 0
 * "ยกเลิกข้อมูล" (+ job_log), as legacy did; restoring puts back the last status before that (none → 1 งานใหม่).
 * Sale orders → + cancel stamp (an approved one — stock issued — cannot be cancelled).
 * `mayRestore` = the caller holds `del` on the module (customers: System Admin): leaving DELETED is the reverse of
 * deleting, so `edit` alone is refused. `mayCancelOthers` = may cancel a sale order someone else created (System Admin /
 * SO Approve) — a pending order is its creator's, as its edits are.
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
  // a part / job / quotation / sale order comes as its uuid — from here on its code / number (what the rest of this
  // function, its messages and its audit line work with); `pk` = the row's pk
  const DOC = { products: 'อะไหล่', jobs: 'งาน', quotations: 'ใบเสนอราคา', sale_orders: 'ใบสั่งขาย' } as const;
  let pk = 0;
  /** the row's uuid when `id` became its number (the audit line carries both) */
  let rowId: string | null = null;
  if (table in DOC) {
    const what = DOC[table as keyof typeof DOC];
    if (!isUuid(String(id))) throw new HttpError(404, `ไม่พบ${what}`);
    const uid = String(id).trim().toLowerCase();
    const [row] =
      table === 'products'
        ? await db.select({ pk: product.pk, no: product.productCode }).from(product).where(eq(product.id, uid))
        : table === 'jobs'
          ? await db.select({ pk: job.pk, no: job.jobNo }).from(job).where(eq(job.id, uid))
          : table === 'quotations'
            ? await db
                .select({ pk: quotation.pk, no: quotation.quotationNo })
                .from(quotation)
                .where(eq(quotation.id, uid))
            : await db
                .select({ pk: saleOrder.pk, no: saleOrder.saleOrderNo })
                .from(saleOrder)
                .where(eq(saleOrder.id, uid));
    if (!row) throw new HttpError(404, `ไม่พบ${what}`);
    pk = row.pk;
    rowId = uid;
    id = row.no ?? '';
  }
  const stamp = statusStamp(rs, byUserId);
  const ENTITY: Record<string, [string, string]> = {
    users: ['app_user', 'Admin'],
    products: ['product', 'Product'],
    customers: ['customer', 'Customer'],
    jobs: ['job', 'Job Management'],
    quotations: ['quotation', 'Quotation'],
    sale_orders: ['sale_order', 'Sale Order'],
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
    products: (tx) => tx.select({ rs: product.recordStatus }).from(product).where(eq(product.pk, pk)).for('update'),
    quotations: (tx) =>
      tx.select({ rs: quotation.recordStatus }).from(quotation).where(eq(quotation.pk, pk)).for('update'),
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
      id: rowId,
      // a customer's key is its uuid: its code is the number
      no: rowId ? String(id) : table === 'customers' ? String(label) || null : null,
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
      await writeTx(async (tx) => {
        const [cur] = await tx
          .select({ rs: appUser.recordStatus, first: appUser.firstName, last: appUser.lastName, u: appUser.username })
          .from(appUser)
          .where(eq(appUser.id, String(id)))
          .for('update');
        if (!cur) throw new HttpError(404, 'ไม่พบผู้ใช้');
        // out of DELETED only through กู้คืน (users.ts setUserDeleted → INACTIVE)
        if (cur.rs === RS.DELETED && rs !== RS.DELETED) throw new HttpError(409, DELETED_USER_MSG);
        // ACTIVE → ACTIVE changes nothing: who / when it last changed stays (and nothing is logged)
        if (cur.rs !== rs)
          await tx
            .update(appUser)
            .set(stamp)
            .where(eq(appUser.id, String(id)));
        await log(tx, cur.rs, '', fullName(cur.first, cur.last) || clean(cur.u));
      });
      invalidateUserCache();
      invalidate('staff');
      return;
    case 'products':
      await writeTx(async (tx) => {
        const old = await oldOf(tx);
        refuseRestore(old);
        if (rs === RS.DELETED) {
          // a request still waiting for this part could never be issued once it is gone, and its booking stays held
          const waiting = await tx
            .selectDistinct({ no: job.jobNo })
            .from(jobPart)
            .innerJoin(job, eq(job.pk, jobPart.jobPk))
            .where(
              and(
                eq(jobPart.productPk, pk),
                eq(jobPart.jobPartStatusId, PART.REQUESTED),
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
        if (old !== rs)
          await tx
            .update(product)
            .set(
              rs === RS.DELETED
                ? { ...stamp, cancelDate: nowThai(), cancelledByAppUserPk: byUserId }
                : { ...stamp, cancelDate: null, cancelledByAppUserPk: null, cancelRemark: '' },
            )
            .where(eq(product.pk, pk));
        await log(tx, old);
      });
      productsChanged();
      return;
    case 'customers':
      // `id` = the customer's uuid (the route checked it): the audit key; the summary names its code
      await writeTx(async (tx) => {
        const [cur] = await tx
          .select({ rs: customer.recordStatus, code: customer.customerCode })
          .from(customer)
          .where(eq(customer.id, String(id)))
          .for('update');
        if (!cur) throw new HttpError(404, 'ไม่พบลูกค้า');
        refuseRestore(cur.rs);
        if (cur.rs !== rs)
          await tx
            .update(customer)
            .set(stamp)
            .where(eq(customer.id, String(id)));
        await log(tx, cur.rs, '', cur.code ?? '');
      });
      return;
    case 'quotations':
      await writeTx(async (tx) => {
        const old = await oldOf(tx);
        refuseRestore(old);
        if (rs === RS.DELETED) {
          // the job's approved quotation (agreedQuotationPk): deleting it left the job pointing at a deleted document
          const [held] = await tx
            .select({ no: job.jobNo })
            .from(job)
            .where(
              and(
                or(
                  eq(job.approvedQuotationPk, pk),
                  inArray(
                    job.pk,
                    tx
                      .select({ j: quotation.jobPk })
                      .from(quotation)
                      .where(
                        and(eq(quotation.pk, pk), inArray(quotation.quotationStatusId, AGREED_QUOTATION_STATUSES)),
                      ),
                  ),
                ),
                sql`${agreedQuotationPk} = ${pk}`,
                ne(job.recordStatus, RS.DELETED),
              ),
            )
            .limit(1);
          if (held)
            throw new HttpError(
              409,
              `ใบเสนอราคานี้ลูกค้าตกลงแล้ว (งาน ${held.no}) — เปลี่ยนสถานะเป็นลูกค้าไม่ตกลงก่อน แล้วจึงลบ`,
            );
        }
        if (old !== rs) await tx.update(quotation).set(stamp).where(eq(quotation.pk, pk));
        await log(tx, old, rs === RS.DELETED ? clean(remark) : '');
      });
      return;
    case 'jobs': {
      await writeTx(async (tx) => {
        // locked like the job workflows (lockJob): a save running now finishes first
        const [cur] = await tx
          .select({ st: job.jobStatusId, rs: job.recordStatus })
          .from(job)
          .where(eq(job.pk, pk))
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
            .selectDistinct({ code: product.productCode })
            .from(jobPart)
            .leftJoin(product, eq(product.pk, jobPart.productPk))
            .where(
              and(
                eq(jobPart.jobPk, pk),
                or(
                  eq(jobPart.jobPartStatusId, PART.REQUESTED),
                  eq(jobPart.jobPartStatusId, PART.RETURN_REQUESTED),
                  sql`coalesce(${jobPart.grantQty}, 0) > coalesce(${jobPart.returnQty}, 0)`,
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
            .select({ st: jobStatusLog.jobStatusId })
            .from(jobStatusLog)
            .where(and(eq(jobStatusLog.jobPk, pk), ne(jobStatusLog.jobStatusId, JS.CANCELLED)))
            .orderBy(desc(jobStatusLog.pk))
            .limit(1);
          back = prev?.st ?? JS.NEW;
        }
        const st = rs === RS.DELETED ? JS.CANCELLED : back;
        if (st !== null || cur.rs !== rs)
          await tx
            .update(job)
            .set({ ...statusStamp(rs, byUserId), ...(st !== null ? { jobStatusId: st } : {}) })
            .where(eq(job.pk, pk));
        if (st !== null && st !== cur.st) await logStatus(tx, pk, st, byUserId);
        await log(tx, cur.rs, rs === RS.DELETED ? clean(remark) : '');
      });
      return;
    }
    case 'sale_orders': {
      const reason = rs === RS.DELETED ? clean(remark) : '';
      await writeTx(async (tx) => {
        // locked: an approval running now finishes first (approveSaleOrder locks the same row)
        const [cur] = await tx
          .select({ ap: saleOrder.approveStatusId, rs: saleOrder.recordStatus, by: saleOrder.createdByAppUserPk })
          .from(saleOrder)
          .where(eq(saleOrder.pk, pk))
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
        if (cur.rs !== rs)
          await tx
            .update(saleOrder)
            .set(
              rs === RS.DELETED
                ? {
                    ...statusStamp(rs, byUserId),
                    documentCancelDate: nowThai(),
                    cancelledByAppUserPk: byUserId,
                    documentCancelRemark: reason,
                  }
                : {
                    ...statusStamp(rs, byUserId),
                    documentCancelDate: null,
                    cancelledByAppUserPk: null,
                    documentCancelRemark: '',
                  },
            )
            .where(eq(saleOrder.pk, pk));
        await log(tx, cur.rs, reason);
      });
      return;
    }
  }
}
