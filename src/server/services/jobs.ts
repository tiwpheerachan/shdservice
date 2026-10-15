import 'server-only';
import { cached, TTL_MASTER } from '@/server/cache';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias, unionAll } from 'drizzle-orm/pg-core';
import { db, type Tx } from '@/db/client';
import {
  appUser,
  documentAttach,
  job,
  jobLog,
  jobOrderSparePartLog,
  jobSendForwardDt,
  jobStatus,
  jobSymptom,
  jobType,
  manufacturer,
  model,
  product,
  productType,
  shippingProfile,
  symptom,
} from '@/db/schema';
import type { Job } from '@/data/mock';
import { HttpError, fullName, findAppUserByEmail } from '@/server/auth';
import { assertVersion } from '@/server/http-error';
import { nextRunningNo } from '@/db/running-no';
import { audit, diff, auditFor, type AuditRow } from '@/server/audit';
import { orderBy, offsetOf, totalOf, ymd, type Page, type PageQuery } from '@/server/paging';
import {
  dateOrNull,
  dateOrSentinel,
  fmtDate,
  fmtDateTime,
  int,
  isSentinelDate,
  money,
  nowThai,
  num,
  SENTINEL_TS,
  str,
} from '@/server/mappers/format';
import { getCustomerByCode, getCustomerById } from './customers';
import { staffOrKeep } from './users';
import { issuingProfile, SHD_PROFILE_ID } from './document-profiles';
import { adjustQty, listPartRequests, lockStock, PART, partsTotalOf, productsByCode } from './stock';
import { RS, statusStamp } from '@/server/record-status';
import { ADMIN_USER_TYPE } from '@/lib/modules';
import { addDays } from '@/lib/dates';
import {
  jobSchema,
  filledRequired,
  repairActionSchema,
  outsourceActionSchema,
  swapRefundSchema,
  closeSchema,
  jobBalance,
  moneyLockedMsg,
  cleanSerial,
  parseSwap,
  paymentDetailOf,
  returnDetailOf,
  RECEIVE_BEFORE_SEND,
  OUTSOURCE_NOT_BACK,
  OUTSOURCE_STATUS_ONLY,
  RECEIVE_DATE_REQUIRED,
  TRACKING_REQUIRED,
  partsNotIssuedMsg,
  REOPEN_ADMIN_ONLY,
  type JobCheck,
  type JobRequiredKey,
} from '@/lib/validation/job';
import { cleanTracking } from '@/lib/validation';
import { callLogSchema } from '@/lib/validation/stock';
import { assertValid } from '@/server/validate';
import { clean, cleanCode, cleanText, summary, type FieldErrors } from '@/lib/validation';

/* ------------------------------------------------------------------ *
 * Status constants (job_status.job_status_id) — verified against the dump
 * ------------------------------------------------------------------ */
export const JS = {
  CANCELLED: 0,
  NEW: 1,
  IN_PROGRESS: 2,
  WAIT_PARTS: 3,
  QUOTED: 4,
  REPAIRED: 5,
  REPAIR_CANCELLED: 6,
  CLOSED_WAIT_TRACKING: 7,
  CLOSED_TRACKED: 8,
  REPAIRED_PAID: 9,
  PARTS_ISSUED: 10,
  PARTS_REQUESTED: 11,
  CUSTOMER_AGREED: 12,
  WAIT_QUOTE: 13,
  OUTSOURCE_SENT: 14,
  OUTSOURCE_RECEIVED: 15,
  QUOTE_EXPIRED: 16,
  RETURNED_TO_STOCK: 17,
  SWAP_ISSUED: 18,
  REFUND_PAID: 19,
  COMPLETE: 20,
  CLOSED_REFUND: 21,
  REPAIRED_NO_FAULT: 22,
  CLOSED_OUTSOURCE: 23,
  CLOSED_WAIT_PICKUP: 24,
} as const;

const REPAIRED_GROUP = 'Repaired';
const FINISHED_GROUP = 'Finished';

/**
 * The status group the dashboard cards / KPI links / report counts use: job_status_group, except
 * "ยกเลิกซ่อม (ลูกค้าไม่ตกลงซ่อม)" (6) — listed under Repaired in job_status, but the customer declined,
 * nothing was repaired — counts as Cancel. (Cancel's own status 0 = soft-deleted, hidden everywhere.)
 * Needs job_status joined.
 */
export const kpiGroup = sql<string>`(case when ${job.jobStatusId} = ${sql.raw(String(JS.REPAIR_CANCELLED))} then 'Cancel' else ${jobStatus.jobStatusGroup} end)`;

const eng = alias(appUser, 'eng');
const opener = alias(appUser, 'opener');

/** the job type's target turnaround in days (job_type.default_due_days; 7 when the job has no type) */
const slaDays = sql`coalesce((${db.select({ d: jobType.defaultDueDays }).from(jobType).where(eq(jobType.jobTypeId, job.jobTypeId))}), 7)`;

/**
 * The job's REAL due date (a date): the one a user picked in this app, else opened + its job type's
 * SLA. The legacy system writes "opened + 1 day" on every job — not an estimate (real repairs take
 * 3–30 days), see drizzle/0020_due_date_sla.sql. One definition for the overdue filter, the bell,
 * the job screens and the customer's /track page.
 */
export const effectiveDue = sql`(case when ${job.dueDateSetByUser} and ${job.customerDueDate} > '1901-01-01' then ${job.customerDueDate}::date else ${job.jobCreateDate}::date + ${slaDays} end)`;
/** effectiveDue as "YYYY-MM-DD" (a raw date column would come back as a JS Date) */
export const effectiveDueText = sql<string>`to_char(${effectiveDue}, 'YYYY-MM-DD')`;

/* ------------------------------------------------------------------ *
 * Status helpers (cached name ↔ id)
 * ------------------------------------------------------------------ */
export function jobStatuses() {
  return cached('jobstatus:all', 300_000, async () => {
    const rows = await db.select().from(jobStatus).orderBy(asc(jobStatus.displayOrder), asc(jobStatus.jobStatusId));
    return rows.map((r) => ({
      id: r.jobStatusId,
      name: r.jobStatusName?.trim() ?? '',
      group: r.jobStatusGroup?.trim() ?? '',
      order: r.displayOrder ?? 0,
      active: r.isActive !== false,
    }));
  });
}

export async function statusIdByName(name: string): Promise<number> {
  const rows = await jobStatuses();
  const hit = rows.find((r) => r.name === name.trim());
  if (!hit) throw new HttpError(400, `ไม่รู้จักสถานะงาน "${name}"`);
  return hit.id;
}

async function statusGroup(id: number) {
  return (await jobStatuses()).find((r) => r.id === id)?.group ?? '';
}

/** Insert a job_log row — call on EVERY status change (legacy invariant). */
export async function logStatus(tx: Tx, jobNo: string, statusId: number, byUserId: number) {
  await tx.insert(jobLog).values({ jobNo, jobStatusId: statusId, jobLogDate: nowThai(), jobActionBy: byUserId });
}

/**
 * Lock the job row for this transaction and return its CURRENT status. Every job write
 * calls it first: two people saving/closing the same job then run one after the other,
 * and setStatus compares against the status as it is now — not a read from before the
 * other save committed (duplicate job_log rows, lost parts totals).
 */
async function lockJob(tx: Tx, jobNo: string): Promise<number | null> {
  const [r] = await tx.select({ status: job.jobStatusId }).from(job).where(eq(job.jobNo, jobNo)).for('update');
  if (!r) throw new HttpError(404, 'ไม่พบหมายเลขงาน ' + jobNo);
  return r.status;
}

/** an out-source send not yet recorded as received (saveOutsource's open row) */
const outsourceOpen = (jobNo: string) =>
  and(eq(jobSendForwardDt.jobNo, jobNo), eq(jobSendForwardDt.sendStatus, 'ส่งเครื่องซ่อมแล้ว'));

/** Stamp job_repaired_date/by only while it is still the 1900 sentinel (never repaired-stamped). */
async function stampRepairedIfMissing(tx: Tx, jobNo: string, at: string, byUserId: number) {
  await tx
    .update(job)
    .set({ jobRepairedDate: at, jobRepairedBy: byUserId })
    .where(and(eq(job.jobNo, jobNo), sql`coalesce(${job.jobRepairedDate}, '1900-01-01') < '1901-01-01'`));
}

/** Change status + log (no-op when unchanged). Returns true if changed. */
async function setStatus(tx: Tx, jobNo: string, statusId: number, byUserId: number, current?: number | null) {
  if (current === statusId) return false;
  const group = await statusGroup(statusId);
  const fromGroup = current == null ? '' : await statusGroup(current);
  // a closed job back to an open status (a re-save picking the first status in the list did that by accident)
  if (fromGroup === FINISHED_GROUP && group !== FINISHED_GROUP && !(await isSystemAdmin(byUserId)))
    throw new HttpError(409, REOPEN_ADMIN_ONLY, { fields: { status: REOPEN_ADMIN_ONLY } });
  // 8 = "ลงเลขที่พัสดุแล้ว": every path into it (close, repair, swap, edit) needs the parcel no. stored
  if (statusId === JS.CLOSED_TRACKED) {
    const [r] = await tx.select({ t: job.returnCustomerTrackingNo }).from(job).where(eq(job.jobNo, jobNo));
    if (!r?.t?.trim()) throw new HttpError(400, TRACKING_REQUIRED, { fields: { status: TRACKING_REQUIRED } });
  }
  // repaired while a part requested from stock (เบิก) is still not issued: the charge would reach the close
  // with no part in the job. Only on a change INTO it — a job already repaired re-saves as before.
  if (statusId === JS.REPAIRED || statusId === JS.REPAIRED_PAID) {
    const waiting = await tx
      .select({ code: jobOrderSparePartLog.sparePartCode, name: product.productName })
      .from(jobOrderSparePartLog)
      .leftJoin(product, eq(product.productCode, jobOrderSparePartLog.sparePartCode))
      .where(
        and(
          eq(jobOrderSparePartLog.jobNo, jobNo),
          eq(jobOrderSparePartLog.orderStatusId, PART.REQUESTED),
          eq(jobOrderSparePartLog.isSpecial, true),
          sql`coalesce(${jobOrderSparePartLog.requestQty},0) > coalesce(${jobOrderSparePartLog.grantQty},0)`,
        ),
      );
    if (waiting.length) {
      const msg = partsNotIssuedMsg(waiting.map((w) => ({ code: w.code ?? '', name: w.name ?? '' })));
      throw new HttpError(400, msg, { fields: { status: msg } });
    }
  }
  const extra: Partial<typeof job.$inferInsert> = {};
  if (group === REPAIRED_GROUP) {
    extra.jobRepairedDate = nowThai();
    extra.jobRepairedBy = byUserId;
  }
  if (group === FINISHED_GROUP) {
    // a job sent out-source must come back before it is closed (owner, Dogfood round 2). Only on the way
    // INTO Finished: an already-closed legacy job (7 → 8, adding the tracking no.) is not blocked.
    const closing = fromGroup !== FINISHED_GROUP;
    const [out] = closing
      ? await tx.select({ id: jobSendForwardDt.id }).from(jobSendForwardDt).where(outsourceOpen(jobNo)).limit(1)
      : [];
    if (out) throw new HttpError(400, OUTSOURCE_NOT_BACK, { fields: { status: OUTSOURCE_NOT_BACK } });
    // closed → closed (7 → 8 when the parcel no. comes later) keeps the original close date / closer
    if (closing) {
      extra.jobClosedDate = nowThai();
      extra.jobClosedBy = byUserId;
      // safety net: closed without ever being repaired-stamped (e.g. out-source received → closed) — the
      // close is the repair date, so the job still shows up in the repair reports
      await stampRepairedIfMissing(tx, jobNo, extra.jobClosedDate, byUserId);
    }
  }
  await tx
    .update(job)
    .set({ jobStatusId: statusId, ...extra })
    .where(eq(job.jobNo, jobNo));
  await logStatus(tx, jobNo, statusId, byUserId);
  const name = (await jobStatuses()).find((r) => r.id === statusId)?.name ?? String(statusId);
  await audit(tx, byUserId, {
    action: 'STATUS',
    module: 'Job Management',
    entity: 'job',
    key: jobNo,
    summary: `เปลี่ยนสถานะงาน → ${name}`,
    changes: { jobStatusId: [current ?? null, statusId] },
  });
  return true;
}

/* ------------------------------------------------------------------ *
 * List (server-side paging)
 * ------------------------------------------------------------------ */
const listSelect = {
  no: job.jobNo,
  openDate: job.jobCreateDate,
  customer: job.customerDetail,
  customerId: job.customerId,
  so: job.jobReferenceNo,
  brand: manufacturer.manufacturerName,
  modelName: job.productModelName,
  modelDetail: job.productModelDetail,
  jobType: jobType.jobTypeName,
  jobTypeDetail: job.jobTypeDetail,
  engFirst: eng.firstName,
  engLast: eng.lastName,
  engineerId: job.engineerId,
  isBounce: job.isJobBounce,
  status: jobStatus.jobStatusName,
  statusId: job.jobStatusId,
  statusGroup: jobStatus.jobStatusGroup,
  imei: job.productImeiNo,
  serial: job.productSerial,
  amount: job.jobTotalCost,
  channel: job.productSaleOutChannel,
  receptionType: job.jobReceptionType,
  receptionDate: job.jobReceptionDate,
  warranty: job.productWarranty,
  symptom: symptom.symptomName,
  symptomOther: job.productSymptomOther,
  repairDetail: job.engineerRepairDetail,
  repairedDate: job.jobRepairedDate,
  closedDate: job.jobClosedDate,
  returnType: job.returnCustomerType,
  returnTracking: job.returnCustomerTrackingNo,
  returnDate: job.jobReturnDate,
  paymentType: job.jobPaymentType,
  paymentAmount: job.jobPaymentAmount,
  dueDate: effectiveDueText,
  openerFirst: opener.firstName,
  openerLast: opener.lastName,
  quotationNo: job.quotationNoApproved,
  serviceCost: job.serviceCost,
  partsCost: job.sparePartTotalCost,
  deposit: job.depositCost,
};

/** a select field's value: a column's data type, or an sql<T> expression's T */
type FieldData<F> = F extends SQL<infer T> ? T : F extends { _: { data: infer D } } ? D : never;
type ListRow = { [K in keyof typeof listSelect]: FieldData<(typeof listSelect)[K]> | null };

/** a job-list row + มัดจำ / ค้างชำระ (the Excel export) */
export type JobListRow = Job & { deposit: number; outstanding: number };

function toJob(r: ListRow): JobListRow {
  return {
    no: r.no ?? '',
    openDate: fmtDateTime(r.openDate),
    customer: r.customer?.trim() ?? '',
    so: r.so ?? '',
    brandModel: [r.brand, r.modelName].filter(Boolean).join(' '),
    jobType: r.jobType ?? '',
    owner: fullName(r.engFirst, r.engLast),
    status: r.status?.trim() ?? '',
    imei: r.imei ?? '',
    amount: num(r.amount),
    // extra DB-backed fields (optional on the UI type)
    statusId: r.statusId ?? 0,
    statusGroup: r.statusGroup ?? '',
    customerId: r.customerId ?? 0,
    engineerId: r.engineerId ?? 0,
    isBounce: !!r.isBounce,
    serial: r.serial ?? '',
    channel: r.channel ?? '',
    receptionType: r.receptionType ?? '',
    receptionDate: fmtDate(r.receptionDate),
    warranty: r.warranty ?? '',
    symptom: r.symptom ?? '',
    symptomOther: r.symptomOther ?? '',
    repairDetail: r.repairDetail ?? '',
    repairedDate: fmtDateTime(r.repairedDate),
    closedDate: fmtDateTime(r.closedDate),
    returnType: r.returnType ?? '',
    returnTracking: r.returnTracking ?? '',
    returnDate: fmtDateTime(r.returnDate),
    paymentType: r.paymentType ?? '',
    paymentAmount: num(r.paymentAmount),
    dueDate: fmtDate(r.dueDate),
    openedBy: fullName(r.openerFirst, r.openerLast),
    jobTypeDetail: r.jobTypeDetail ?? '',
    quotationNo: r.quotationNo ?? '',
    serviceCost: num(r.serviceCost),
    partsCost: num(r.partsCost),
    modelDetail: r.modelDetail ?? '',
    deposit: num(r.deposit),
    outstanding: jobBalance(num(r.amount), num(r.deposit), num(r.paymentAmount)).outstanding,
  };
}

const baseQuery = () =>
  db
    .select(listSelect)
    .from(job)
    .leftJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
    .leftJoin(jobType, eq(jobType.jobTypeId, job.jobTypeId))
    .leftJoin(manufacturer, eq(manufacturer.manufacturerId, job.productBrandId))
    .leftJoin(eng, eq(eng.userId, job.engineerId))
    .leftJoin(opener, eq(opener.userId, job.jobCreateBy))
    .leftJoin(symptom, eq(symptom.symptomId, job.productSymptomId));

const SORT: Record<string, Parameters<typeof orderBy>[1][string]> = {
  no: job.jobNo,
  openDate: job.jobCreateDate,
  customer: job.customerDetail,
  so: job.jobReferenceNo,
  brandModel: job.productModelName,
  jobType: jobType.jobTypeName,
  owner: eng.firstName,
  status: jobStatus.displayOrder,
  imei: job.productImeiNo,
  amount: job.jobTotalCost,
  closedDate: job.jobClosedDate,
  repairedDate: job.jobRepairedDate,
};

export type JobFilters = {
  status?: string; // status name
  statusId?: number;
  statusGroup?: string; // Pending | Repaired | Finished | Cancel
  open?: boolean; // not Finished/Cancel
  overdue?: boolean; // still open and past its real due date — overdueWhere (the notification bell)
  type?: string; // job type name
  engineer?: string; // engineer full name or id
  channel?: string;
  from?: string; // job_create_date >=
  to?: string;
  closedFrom?: string;
  closedTo?: string;
  customerCode?: string;
  includeCancelled?: boolean;
  /** open jobs with no engineer yet, or still "งานใหม่" (assign screen) */
  unassigned?: boolean;
  /** jobs the close screen can act on: Repaired group, or closed but still waiting for a tracking no / pickup */
  closable?: boolean;
  /** which date column from/to apply to (default create) — reception = วันที่รับเครื่องซ่อม */
  dateBy?: 'create' | 'reception' | 'repaired' | 'closed';
  symptom?: string; // symptom name (engineer's or customer's)
  returnType?: string;
  /* ---- job-list filter bar (each one is AND-ed; text ones are partial matches) ---- */
  no?: string; // เลขที่งาน
  ref?: string; // เลขคำสั่งซื้อ (job_reference_no)
  brand?: string; // ยี่ห้อ — manufacturer name
  model?: string; // รุ่น — product_model_name
  typeDetail?: string; // งานย่อย
  createdBy?: string; // เปิดงานโดย — app_user id
  customer?: string; // ชื่อ-สกุลลูกค้า (matched inside customer_detail = "code name phone")
  phone?: string; // เบอร์โทร — digits, matched inside customer_detail
  tracking?: string; // เลขพัสดุจากลูกค้า (job_reception_tracking_no)
  imei?: string; // IMEI หรือ Serial
  warranty?: string; // IN | OUT
  bounce?: boolean; // งานซ่อมซ้ำ (is_job_bounce)
  within30?: boolean; // เปิดงานภายใน 30 วันหลังวันที่ขาย
  cost?: 'yes' | 'no'; // ค่าใช้จ่ายเก็บลูกค้า: มี (job_total_cost > 0) / ไม่มี
};

const dateCol = (by?: JobFilters['dateBy']) =>
  by === 'reception'
    ? job.jobReceptionDate
    : by === 'repaired'
      ? job.jobRepairedDate
      : by === 'closed'
        ? job.jobClosedDate
        : job.jobCreateDate;
/** job_reception_date is a DATE column — compare with plain dates, the others are timestamps */
const dayStart = (by: JobFilters['dateBy'], d: string) => (by === 'reception' ? d : `${d} 00:00:00`);
const dayEnd = (by: JobFilters['dateBy'], d: string) => (by === 'reception' ? d : `${d} 23:59:59`);

/** "today" on the Thai calendar — job dates are stored as Thai wall-clock */
const thaiToday = sql`(now() AT TIME ZONE 'Asia/Bangkok')::date`;

/**
 * Open job = its status is not in a closed group (Finished / Cancel).
 *
 * Written as `job_status_id = ANY(ARRAY(subquery))` on purpose: Postgres runs the subquery once,
 * then reads only the open jobs through ix_job_status — the cost follows the open work (~2k jobs),
 * not the history (48k and growing). Filtering on job_status_group through the join instead made
 * it scan every job (~105 ms vs ~6 ms on 2026-09-28). The status list stays live (no app cache).
 * Works with or without job_status joined.
 */
export const isOpenJob = sql`${job.jobStatusId} = ANY(ARRAY(${db
  .select({ id: jobStatus.jobStatusId })
  .from(jobStatus)
  .where(notInArray(jobStatus.jobStatusGroup, ['Finished', 'Cancel']))}))`;

/**
 * Overdue = still open, and its real due date (effectiveDue) is before today. isOpenJob narrows to
 * the open jobs through ix_job_status first, so the per-row due date stays cheap. Shared by the job
 * list filter and the notification bell (services/alerts.ts), so both always count the same jobs.
 */
export const overdueWhere = and(isOpenJob, sql`${effectiveDue} < ${thaiToday}`);
/** whole days past the real due date (1 = due yesterday) */
export const daysOverdue = sql<number>`(${thaiToday} - ${effectiveDue})`.mapWith(Number);

/** a phone's digits as stored ("+66 89 999 3466" → "0899993466": the country code typed for the leading 0) */
const phoneDigits = (v: string) => v.replace(/\D/g, '').replace(/^66(?=\d{8,9}$)/, '0');

export function jobWhere(q: string, f: JobFilters) {
  const term = q.trim();
  // a phone typed as digits ("0814969925") also finds "081-4969925" — same match as f.phone below
  const termDigits = /^[\d\s()+-]+$/.test(term) ? phoneDigits(term) : '';
  const phone = phoneDigits(f.phone ?? '');
  const from = ymd(f.from),
    to = ymd(f.to),
    closedFrom = ymd(f.closedFrom),
    closedTo = ymd(f.closedTo);
  return and(
    // soft-deleted jobs (record_status DELETED = legacy status 0) are hidden unless asked for
    f.includeCancelled ? undefined : ne(job.recordStatus, RS.DELETED),
    term
      ? or(
          ilike(job.jobNo, `%${term}%`),
          ilike(job.customerDetail, `%${term}%`),
          ilike(job.jobReferenceNo, `%${term}%`),
          ilike(job.productImeiNo, `%${term}%`),
          ilike(job.productSerial, `%${term}%`),
          ilike(job.productModelName, `%${term}%`),
          termDigits.length >= 4
            ? sql`regexp_replace(coalesce(${job.customerDetail}, ''), '\\D', '', 'g') LIKE ${'%' + termDigits + '%'}`
            : undefined,
        )
      : undefined,
    f.status ? eq(jobStatus.jobStatusName, f.status) : undefined,
    f.statusId !== undefined ? eq(job.jobStatusId, f.statusId) : undefined,
    f.statusGroup ? eq(kpiGroup, f.statusGroup) : undefined,
    f.open ? isOpenJob : undefined,
    f.overdue ? overdueWhere : undefined,
    f.type ? eq(jobType.jobTypeName, f.type) : undefined,
    f.engineer
      ? /^\d+$/.test(f.engineer)
        ? eq(job.engineerId, Number(f.engineer))
        : // the same name fullName() builds: each part trimmed, empty parts dropped
          sql`concat_ws(' ', nullif(trim(${eng.firstName}),''), nullif(trim(${eng.lastName}),'')) = ${f.engineer.trim()}`
      : undefined,
    f.channel ? eq(job.productSaleOutChannel, f.channel) : undefined,
    from ? gte(dateCol(f.dateBy), dayStart(f.dateBy, from)) : undefined,
    to ? lte(dateCol(f.dateBy), dayEnd(f.dateBy, to)) : undefined,
    f.symptom
      ? or(
          eq(symptom.symptomName, f.symptom),
          sql`exists (select 1 from job_symptom js join symptom s2 on s2.symptom_id = js.symptom_id where js.job_no = ${job.jobNo} and s2.symptom_name = ${f.symptom})`,
        )
      : undefined,
    f.returnType ? eq(job.returnCustomerType, f.returnType) : undefined,
    closedFrom ? gte(job.jobClosedDate, `${closedFrom} 00:00:00`) : undefined,
    closedTo ? lte(job.jobClosedDate, `${closedTo} 23:59:59`) : undefined,
    f.customerCode ? sql`${job.customerDetail} like ${f.customerCode + ' %'}` : undefined,
    f.unassigned
      ? and(isOpenJob, or(eq(job.jobStatusId, JS.NEW), sql`coalesce(${job.engineerId}, 0) <= 0`))
      : undefined,
    f.closable
      ? or(
          eq(jobStatus.jobStatusGroup, 'Repaired'),
          inArray(job.jobStatusId, [JS.CLOSED_WAIT_TRACKING, JS.CLOSED_WAIT_PICKUP]),
        )
      : undefined,
    // ---- job-list filter bar ----
    f.no ? ilike(job.jobNo, `%${f.no.trim()}%`) : undefined,
    f.ref ? ilike(job.jobReferenceNo, `%${f.ref.trim()}%`) : undefined,
    // brand/model are matched without adding joins to the count query
    f.brand
      ? sql`${job.productBrandId} in (select manufacturer_id from manufacturer where manufacturer_name = ${f.brand})`
      : undefined,
    f.model ? eq(job.productModelName, f.model) : undefined,
    f.typeDetail ? eq(job.jobTypeDetail, f.typeDetail) : undefined,
    f.createdBy && /^\d+$/.test(f.createdBy) ? eq(job.jobCreateBy, Number(f.createdBy)) : undefined,
    f.customer ? ilike(job.customerDetail, `%${f.customer.trim()}%`) : undefined,
    // digits only on both sides — customer_detail keeps the phone as typed ("081-4969925"); drizzle/0024 index
    phone
      ? sql`regexp_replace(coalesce(${job.customerDetail}, ''), '\\D', '', 'g') LIKE ${'%' + phone + '%'}`
      : undefined,
    f.tracking ? ilike(job.jobReceptionTrackingNo, `%${f.tracking.trim()}%`) : undefined,
    f.imei
      ? or(ilike(job.productImeiNo, `%${f.imei.trim()}%`), ilike(job.productSerial, `%${f.imei.trim()}%`))
      : undefined,
    f.warranty ? eq(job.productWarranty, f.warranty) : undefined,
    f.bounce ? eq(job.isJobBounce, true) : undefined,
    f.within30
      ? sql`${job.productSaleOrderDate} is not null and ${job.jobCreateDate}::date - ${job.productSaleOrderDate} between 0 and 30`
      : undefined,
    f.cost === 'yes'
      ? sql`coalesce(${job.jobTotalCost}, 0) > 0`
      : f.cost === 'no'
        ? sql`coalesce(${job.jobTotalCost}, 0) = 0`
        : undefined,
  );
}

export function filtersFromQuery(f: Record<string, string>): JobFilters {
  return {
    status: f.status,
    statusId: /^\d+$/.test(f.statusId ?? '') ? Number(f.statusId) : undefined, // junk → NaN would 500
    statusGroup: f.statusGroup,
    open: f.open === '1',
    type: f.type,
    engineer: f.engineer,
    channel: f.channel,
    from: f.from,
    to: f.to,
    closedFrom: f.closedFrom,
    closedTo: f.closedTo,
    customerCode: f.customerCode,
    includeCancelled: f.includeCancelled === '1',
    unassigned: f.unassigned === '1',
    overdue: f.overdue === '1',
    closable: f.closable === '1',
    dateBy: f.dateBy === 'reception' || f.dateBy === 'repaired' || f.dateBy === 'closed' ? f.dateBy : undefined,
    symptom: f.symptom,
    returnType: f.returnType,
    no: f.no,
    ref: f.ref,
    brand: f.brand,
    model: f.model,
    typeDetail: f.typeDetail,
    createdBy: f.createdBy,
    customer: f.customer,
    phone: f.phone,
    tracking: f.tracking,
    imei: f.imei,
    warranty: f.warranty,
    bounce: f.bounce === '1',
    within30: f.within30 === '1',
    cost: f.cost === 'yes' || f.cost === 'no' ? f.cost : undefined,
  };
}

export async function pageJobs(p: PageQuery, f: JobFilters): Promise<Page<Job>> {
  const where = jobWhere(p.q, f);
  // count + page in parallel: the response takes max(count, rows) instead of their sum
  const [counted, rows] = await Promise.all([
    db
      .select({ total: count() })
      .from(job)
      .leftJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
      .leftJoin(jobType, eq(jobType.jobTypeId, job.jobTypeId))
      .leftJoin(eng, eq(eng.userId, job.engineerId))
      .leftJoin(symptom, eq(symptom.symptomId, job.productSymptomId))
      .where(where),
    baseQuery()
      .where(where)
      .orderBy(...orderBy(p.sort, SORT, [desc(job.jobCreateDate), desc(job.jobNo)]))
      .limit(p.pageSize)
      .offset(offsetOf(p)),
  ]);
  return { rows: rows.map(toJob), total: totalOf(counted), page: p.page, pageSize: p.pageSize };
}

/** Un-paged list for reports (server-filtered, capped). */
export async function listJobs(f: JobFilters & { q?: string; limit?: number } = {}): Promise<JobListRow[]> {
  const rows = await baseQuery()
    .where(jobWhere(f.q ?? '', f))
    .orderBy(desc(job.jobCreateDate), desc(job.jobNo))
    .limit(Math.min(f.limit ?? 5000, 20000));
  return rows.map(toJob);
}

/** Small helper for dropdowns: recent open job numbers. */
export async function recentJobNos(limit = 50): Promise<string[]> {
  const rows = await db
    .select({ no: job.jobNo })
    .from(job)
    .where(isOpenJob)
    .orderBy(desc(job.jobCreateDate))
    .limit(limit);
  return rows.map((r) => r.no);
}

/* ------------------------------------------------------------------ *
 * Detail
 * ------------------------------------------------------------------ */
export type JobDetail = {
  no: string;
  /** ออกเอกสารในนาม — document_profile.id (NULL in legacy rows = SHD) */
  documentProfileId: number;
  statusId: number;
  status: string;
  statusGroup: string;
  createDate: string;
  createBy: number;
  createByName: string;
  jobTypeId: number;
  jobType: string;
  jobTypeDetail: string;
  customer: {
    id: number;
    code: string;
    name: string;
    taxId: string;
    address: string;
    phone: string;
    line: string;
    email: string;
  } | null;
  customerDetail: string;
  so: string;
  channel: string;
  shopName: string;
  saleOrderDate: string;
  warrantyMonth: number;
  expireDate: string;
  warranty: string;
  productTypeId: number;
  productType: string;
  imei: string;
  serial: string;
  brandId: number;
  brand: string;
  modelId: number;
  modelCode: string;
  modelName: string;
  modelDetail: string;
  color: string;
  receptionDate: string;
  receptionTrackingNo: string;
  receptionShipper: string;
  receptionType: string;
  equipment: string;
  fault: string;
  symptomIds: number[];
  symptoms: string[];
  symptomOther: string;
  remark: string;
  estimateCost: number;
  depositCost: number;
  partsCost: number;
  serviceCost: number;
  toolCost: number;
  deliveryCost: number;
  boxCost: number;
  totalCost: number;
  /** what the customer still pays: totalCost less the deposit (jobAmountDue) */
  amountDue: number;
  /** the deposit to give back: it is more than totalCost (jobBalance) */
  depositRefund: number;
  /** ค้างชำระ: amountDue less the payment recorded (jobBalance) — closing short is allowed, never silent */
  outstanding: number;
  /** the real due date (effectiveDue) */
  dueDate: string;
  /** true = no user picked it: opened + the job type's SLA (a legacy "+1 day" date is ignored) */
  dueDateAuto: boolean;
  engineerId: number;
  engineer: string;
  engineerSymptomId: number;
  engineerSymptom: string;
  repairDetail: string;
  engineerRemark: string;
  repairedDate: string;
  closedDate: string;
  payment: { type: string; no: string; amount: number; detail: string; slip: string };
  return: { date: string; type: string; tracking: string; detail: string; shipperId: number };
  swap: { detail: string; docNo: string };
  quotationNo: string;
  isBounce: boolean;
  gspnNo: string;
  outsource: {
    id: number;
    sendTo: string;
    sendDetail: string;
    sendDate: string;
    sendBy: string;
    /** app_user id of ส่งโดย / รับโดย (0 = none) — the page's dropdowns use these */
    sendById: number;
    receiveDate: string;
    receiveBy: string;
    receiveById: number;
    receiveDetail: string;
    status: string;
  }[];
  parts: Awaited<ReturnType<typeof listPartRequests>>;
  attachments: { id: number; name: string; file: string; remark: string }[];
  logs: { statusId: number; status: string; date: string; by: string }[];
  /** audit_log entries for this job (newest first) — ประวัติการแก้ไข */
  history: AuditRow[];
  /** job.row_version (drizzle/0026) — the edit form sends it back with its save */
  version: number;
};

/** audit fields holding an app_user id — the job history shows the person's name */
const USER_KEYS = new Set(['engineerId', 'sendBy', 'receiveBy', 'jobReturnBy', 'jobRepairedBy', 'jobClosedBy']);
const ASSIGNED_TO = /มอบหมายงานให้ช่าง #(\d+)/;

/** ประวัติการแก้ไข: user ids → names, status ids → status names (also in older "มอบหมายงานให้ช่าง #116" lines) */
async function readableHistory(rows: AuditRow[]): Promise<AuditRow[]> {
  const ids = new Set<number>();
  for (const r of rows) {
    for (const [k, pair] of Object.entries(r.changes ?? {}))
      if (USER_KEYS.has(k)) for (const v of pair) if (Number(v) > 0) ids.add(Number(v));
    const m = ASSIGNED_TO.exec(r.summary);
    if (m) ids.add(Number(m[1]));
  }
  const users = ids.size
    ? await db
        .select({ id: appUser.userId, f: appUser.firstName, l: appUser.lastName })
        .from(appUser)
        .where(inArray(appUser.userId, [...ids]))
    : [];
  const statuses = await jobStatuses();
  const person = (v: unknown) => {
    if (!(Number(v) > 0)) return null; // 0 / -1 = nobody
    const u = users.find((x) => x.id === Number(v));
    return (u && fullName(u.f, u.l)) || `#${v}`;
  };
  const status = (v: unknown) => (v == null ? null : (statuses.find((x) => x.id === Number(v))?.name ?? v));
  const readable = (k: string, v: unknown) => (USER_KEYS.has(k) ? person(v) : k === 'jobStatusId' ? status(v) : v);
  return rows.map((r) => ({
    ...r,
    summary: r.summary.replace(ASSIGNED_TO, (_, id: string) => `มอบหมายงานให้ช่าง ${person(id)}`),
    changes:
      r.changes &&
      Object.fromEntries(
        Object.entries(r.changes).map(([k, [a, b]]) => [k, [readable(k, a), readable(k, b)] as [unknown, unknown]]),
      ),
  }));
}

export async function getJob(jobNo: string): Promise<JobDetail | null> {
  const engSym = alias(symptom, 'eng_sym');
  const [r] = await db
    .select({
      j: job,
      status: jobStatus.jobStatusName,
      statusGroup: jobStatus.jobStatusGroup,
      jobType: jobType.jobTypeName,
      brand: manufacturer.manufacturerName,
      modelCode: model.modelCode,
      productType: productType.productTypeName,
      symptomName: symptom.symptomName,
      engSymptom: engSym.symptomName,
      engFirst: eng.firstName,
      engLast: eng.lastName,
      openerFirst: opener.firstName,
      openerLast: opener.lastName,
      due: effectiveDueText,
    })
    .from(job)
    .leftJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
    .leftJoin(jobType, eq(jobType.jobTypeId, job.jobTypeId))
    .leftJoin(manufacturer, eq(manufacturer.manufacturerId, job.productBrandId))
    .leftJoin(model, eq(model.modelId, job.productModelId))
    .leftJoin(productType, eq(productType.productTypeId, job.productTypeId))
    .leftJoin(symptom, eq(symptom.symptomId, job.productSymptomId))
    .leftJoin(engSym, eq(engSym.symptomId, job.engineerSymptomId))
    .leftJoin(eng, eq(eng.userId, job.engineerId))
    .leftJoin(opener, eq(opener.userId, job.jobCreateBy))
    .where(eq(job.jobNo, jobNo))
    .limit(1);
  if (!r) return null;
  const j = r.j;
  const bal = jobBalance(num(j.jobTotalCost), num(j.depositCost), num(j.jobPaymentAmount));

  const [cust, syms, fwd, parts, atts, logs, history] = await Promise.all([
    j.customerId ? getCustomerById(j.customerId) : Promise.resolve(null),
    db
      .select({ id: jobSymptom.symptomId, name: symptom.symptomName })
      .from(jobSymptom)
      .leftJoin(symptom, eq(symptom.symptomId, jobSymptom.symptomId))
      .where(eq(jobSymptom.jobNo, jobNo)),
    (async () => {
      const sendBy = alias(appUser, 'send_by');
      const recvBy = alias(appUser, 'recv_by');
      return db
        .select({
          f: jobSendForwardDt,
          sf: sendBy.firstName,
          sl: sendBy.lastName,
          rf: recvBy.firstName,
          rl: recvBy.lastName,
        })
        .from(jobSendForwardDt)
        .leftJoin(sendBy, eq(sendBy.userId, jobSendForwardDt.sendBy))
        .leftJoin(recvBy, eq(recvBy.userId, jobSendForwardDt.receiveBy))
        .where(eq(jobSendForwardDt.jobNo, jobNo))
        .orderBy(asc(jobSendForwardDt.id));
    })(),
    listPartRequests(jobNo),
    db
      .select()
      .from(documentAttach)
      .where(
        and(
          eq(documentAttach.referenceTopic, 'Jobs'),
          eq(documentAttach.referenceItemCode, jobNo),
          ne(documentAttach.recordStatus, RS.DELETED),
        ),
      )
      .orderBy(asc(documentAttach.documentAttachId)),
    db
      .select({
        statusId: jobLog.jobStatusId,
        status: jobStatus.jobStatusName,
        date: jobLog.jobLogDate,
        f: appUser.firstName,
        l: appUser.lastName,
      })
      .from(jobLog)
      .leftJoin(jobStatus, eq(jobStatus.jobStatusId, jobLog.jobStatusId))
      .leftJoin(appUser, eq(appUser.userId, jobLog.jobActionBy))
      .where(eq(jobLog.jobNo, jobNo))
      .orderBy(desc(jobLog.jobLogDate), desc(jobLog.jobLogId)), // newest first, like call log / audit
    auditFor('job', jobNo, 100).then(readableHistory),
  ]);

  const symptomIds = syms.length
    ? syms.map((s) => s.id)
    : j.productSymptomId && j.productSymptomId > 0
      ? [j.productSymptomId]
      : [];
  const symptoms = syms.length ? syms.map((s) => s.name ?? '').filter(Boolean) : r.symptomName ? [r.symptomName] : [];

  return {
    no: j.jobNo,
    documentProfileId: j.documentProfileId ?? SHD_PROFILE_ID,
    statusId: j.jobStatusId ?? 0,
    status: r.status?.trim() ?? '',
    statusGroup: r.statusGroup ?? '',
    createDate: fmtDateTime(j.jobCreateDate),
    createBy: j.jobCreateBy ?? 0,
    createByName: fullName(r.openerFirst, r.openerLast),
    jobTypeId: j.jobTypeId ?? 0,
    jobType: r.jobType ?? '',
    jobTypeDetail: j.jobTypeDetail ?? '',
    customer: cust
      ? {
          id: cust.id ?? 0,
          code: cust.code,
          name: cust.name,
          taxId: cust.taxId,
          address: cust.address,
          phone: cust.phone,
          line: cust.line,
          email: cust.email,
        }
      : null,
    customerDetail: j.customerDetail ?? '',
    so: j.jobReferenceNo ?? '',
    channel: j.productSaleOutChannel ?? '',
    shopName: j.productSaleOutShopName ?? '',
    saleOrderDate: fmtDate(j.productSaleOrderDate),
    warrantyMonth: j.productWarrantyMonth ?? 0,
    expireDate: fmtDate(j.productExpireDate),
    warranty: j.productWarranty ?? '',
    productTypeId: j.productTypeId ?? 0,
    productType: r.productType ?? '',
    imei: j.productImeiNo ?? '',
    serial: j.productSerial ?? '',
    brandId: j.productBrandId ?? 0,
    brand: r.brand ?? '',
    modelId: j.productModelId ?? 0,
    modelCode: r.modelCode ?? '',
    modelName: j.productModelName ?? '',
    modelDetail: j.productModelDetail ?? '',
    color: j.productColor ?? '',
    receptionDate: fmtDate(j.jobReceptionDate),
    receptionTrackingNo: j.jobReceptionTrackingNo ?? '',
    receptionShipper: j.jobReceptionShipper ?? '',
    receptionType: j.jobReceptionType ?? '',
    equipment: j.productEquipment ?? '',
    fault: j.productFault ?? '',
    symptomIds,
    symptoms,
    symptomOther: j.productSymptomOther ?? '',
    remark: j.jobRemark ?? '',
    estimateCost: num(j.estimateCost),
    depositCost: num(j.depositCost),
    partsCost: num(j.sparePartTotalCost),
    serviceCost: num(j.serviceCost),
    toolCost: num(j.serviceToolCost),
    deliveryCost: num(j.deliveryCost),
    boxCost: num(j.cartonBoxCost),
    totalCost: num(j.jobTotalCost),
    amountDue: bal.due,
    depositRefund: bal.refund,
    outstanding: bal.outstanding,
    dueDate: fmtDate(r.due),
    dueDateAuto: !j.dueDateSetByUser,
    engineerId: j.engineerId ?? 0,
    engineer: fullName(r.engFirst, r.engLast),
    engineerSymptomId: j.engineerSymptomId ?? 0,
    engineerSymptom: r.engSymptom ?? '',
    repairDetail: j.engineerRepairDetail ?? '',
    engineerRemark: j.engineerRemark ?? '',
    repairedDate: fmtDateTime(j.jobRepairedDate),
    closedDate: fmtDateTime(j.jobClosedDate),
    payment: {
      type: j.jobPaymentType ?? '',
      no: j.jobPaymentNo ?? '',
      amount: num(j.jobPaymentAmount),
      detail: j.jobPaymentDetail ?? '',
      slip: j.jobPaymentSlipFileName ?? '',
    },
    return: {
      date: fmtDateTime(j.jobReturnDate),
      type: j.returnCustomerType ?? '',
      tracking: j.returnCustomerTrackingNo ?? '',
      detail: j.returnCustomerDetail ?? '',
      shipperId: j.returnShipperId ?? 0,
    },
    swap: { detail: j.swapRefundDetail ?? '', docNo: j.swapRefundDocumentNo ?? '' },
    quotationNo: j.quotationNoApproved ?? '',
    isBounce: !!j.isJobBounce,
    gspnNo: j.jobReferenceNoGspn ?? '',
    outsource: fwd.map((x) => ({
      id: x.f.id,
      sendTo: x.f.sendToName ?? '',
      sendDetail: x.f.sendDetail ?? '',
      sendDate: fmtDate(x.f.sendDate),
      sendBy: fullName(x.sf, x.sl),
      sendById: Math.max(0, x.f.sendBy ?? 0),
      receiveDate: fmtDate(x.f.receiveDate),
      receiveBy: fullName(x.rf, x.rl),
      receiveById: Math.max(0, x.f.receiveBy ?? 0),
      receiveDetail: x.f.receiveDetail ?? '',
      status: x.f.sendStatus ?? '',
    })),
    parts,
    attachments: atts.map((a) => ({
      id: a.documentAttachId,
      name: a.originalFileName ?? '',
      file: a.systemFileName ?? '',
      remark: a.remark ?? '',
    })),
    logs: logs.map((l) => ({
      statusId: l.statusId ?? 0,
      status: l.status?.trim() ?? '',
      date: fmtDateTime(l.date),
      by: fullName(l.f, l.l),
    })),
    history,
    version: j.rowVersion,
  };
}

/* ------------------------------------------------------------------ *
 * Create / update (เปิดงานใหม่ / แก้ไขข้อมูลงาน)
 * ------------------------------------------------------------------ */
export type JobInput = {
  customerCode: string;
  /** ออกเอกสารในนาม (document_profile.id) — decides the J-number series; fixed once issued */
  documentProfileId?: number;
  jobType: string; // name
  jobTypeDetail?: string;
  /** งานเด้ง — สินค้ากลับมาซ่อมซ้ำ (job.is_job_bounce) */
  isBounce?: boolean;
  status?: string; // name (edit page only)
  so?: string;
  channel?: string;
  shopName?: string;
  saleOrderDate?: string;
  warrantyMonth?: number | string;
  expireDate?: string;
  warranty?: string;
  productType?: string; // name
  imei?: string;
  serial?: string;
  brand?: string; // name
  modelCode?: string; // model_code
  modelDetail?: string;
  color?: string;
  receptionDate?: string;
  receptionTrackingNo?: string;
  receptionShipper?: string;
  receptionType?: string;
  equipment?: string;
  fault?: string;
  symptoms?: string[]; // names
  symptomOther?: string;
  remark?: string;
  estimateCost?: number | string;
  depositCost?: number | string;
  serviceCost?: number | string;
  toolCost?: number | string;
  deliveryCost?: number | string;
  boxCost?: number | string;
  engineerId?: number | string;
  /** fallback when the UI picked a person from the Lark directory */
  engineerEmail?: string;
  engineerName?: string;
  dueDate?: string;
  /** row_version the form loaded (updateJob): another save since → 409; absent = no check */
  version?: number;
  /** the user confirmed giving a job that has someone else on it to the new engineer (takeOverError) */
  takeOver?: boolean;
};

/**
 * job.engineer_id must point at app_user. When the form only knows a directory
 * person (email + name), find that person in app_user or create a pending row
 * so the assignment is kept (they get their role when an admin approves).
 */
async function resolveEngineer(i: {
  engineerId?: number | string;
  engineerEmail?: string;
  engineerName?: string;
}): Promise<number> {
  const id = int(i.engineerId, 0);
  if (id > 0) return id;
  const email = str(i.engineerEmail).toLowerCase();
  if (!email) return 0;
  const found = await findAppUserByEmail(email);
  if (found) return found.userId;
  const local = email.split('@')[0] ?? email;
  const name = str(i.engineerName) || local;
  const [first = '', ...rest] = name.split(/\s+/); // split always yields at least one element
  const [row] = await db
    .insert(appUser)
    .values({
      username: local.slice(0, 50),
      password: '',
      firstName: first.slice(0, 50),
      lastName: rest.join(' ').slice(0, 50),
      userType: null,
      isActive: true,
      emailAddress: email,
    })
    .returning({ id: appUser.userId });
  if (!row) throw new Error('app_user insert returned no row');
  return row.id;
}

/**
 * Master names are compared trimmed on BOTH sides: legacy rows carry trailing spaces / "\n"
 * ("ได้รับสินค้าไม่ครบ ", "POCO ") while the input is trimmed (str), so a plain = never matched —
 * which, once unknown names became a 400, blocked saving every job that used them.
 */
const trimmed = (col: Parameters<typeof eq>[0]) => sql`btrim(${col}, E' \t\r\n')`;
const nameIs = (col: Parameters<typeof eq>[0], v: string) => sql`${trimmed(col)} = ${v.trim()}`;

/** `prevShipper` = the courier stored now: a legacy free-text name ("F", "flash") may stay as it is */
async function lookups(i: JobInput, prevShipper?: string | null) {
  const [jt] = i.jobType
    ? await db.select({ id: jobType.jobTypeId }).from(jobType).where(nameIs(jobType.jobTypeName, i.jobType)).limit(1)
    : [];
  const [pt] = i.productType
    ? await db
        .select({ id: productType.productTypeId })
        .from(productType)
        .where(nameIs(productType.productTypeName, i.productType))
        .limit(1)
    : [];
  const [mf] = i.brand
    ? await db
        .select({ id: manufacturer.manufacturerId })
        .from(manufacturer)
        .where(nameIs(manufacturer.manufacturerName, i.brand))
        .limit(1)
    : [];
  const [md] = i.modelCode
    ? await db
        .select({ id: model.modelId, name: model.modelName, mfg: model.manufacturerId })
        .from(model)
        .where(nameIs(model.modelCode, i.modelCode))
        .limit(1)
    : [];
  const names = (i.symptoms ?? []).map((s) => str(s)).filter(Boolean);
  const syms = names.length
    ? await db
        .select({ id: symptom.symptomId, name: sql<string>`${trimmed(symptom.symptomName)}` })
        .from(symptom)
        .where(inArray(trimmed(symptom.symptomName), names))
    : [];
  const symIds = names.map((n) => syms.find((s) => s.name === n)?.id).filter((x): x is number => !!x);
  // a name that was sent but is not in the list used to be saved as id 0 — refuse it under its field
  const fields: FieldErrors = {};
  if (i.productType && !pt) fields.productType = `ไม่พบประเภทสินค้า "${i.productType}" ในรายการ`;
  if (i.brand && !mf) fields.brand = `ไม่พบยี่ห้อ "${i.brand}" ในรายการ`;
  if (i.modelCode && !md) fields.modelCode = `ไม่พบรุ่น "${i.modelCode}" ในรายการ`;
  const unknown = names.filter((n) => !syms.some((s) => s.name === n));
  if (unknown.length) fields.symptoms = `ไม่พบอาการเสีย "${unknown.join('", "')}" ในรายการ`;
  const shipper = clean(i.receptionShipper);
  if (shipper && shipper !== clean(prevShipper)) {
    const [sp] = await db
      .select({ id: shippingProfile.id })
      .from(shippingProfile)
      .where(and(nameIs(shippingProfile.nameTh, shipper), sql`${shippingProfile.deletedAt} is null`))
      .limit(1);
    if (!sp) fields.receptionShipper = 'บริษัทขนส่งต้องเลือกจากโปรไฟล์บริษัทขนส่ง';
  }
  if (Object.keys(fields).length) throw new HttpError(400, summary(fields), { fields });
  return {
    jobTypeId: jt?.id,
    productTypeId: pt?.id,
    brandId: mf?.id ?? md?.mfg ?? null,
    modelId: md?.id,
    modelName: md?.name,
    symIds,
  };
}

function costFields(i: JobInput) {
  const service = num(i.serviceCost);
  const tool = num(i.toolCost);
  const delivery = num(i.deliveryCost);
  const box = num(i.boxCost);
  return { service, tool, delivery, box };
}

type JobRow = typeof job.$inferSelect;
/** the money a closed job keeps (owner 2026-10-15) → the name its 409 gives */
const MONEY_COLS = {
  estimateCost: 'ค่าประเมินงานซ่อม',
  depositCost: 'ค่ามัดจำงานซ่อม',
  serviceCost: 'ค่าบริการการซ่อม',
  serviceToolCost: 'ค่าเครื่องมือพิเศษ',
  deliveryCost: 'ค่าขนส่ง',
  cartonBoxCost: 'ค่ากล่องพัสดุ',
  jobPaymentType: 'วิธีการชำระเงิน',
  jobPaymentNo: 'เลขที่ใบเสร็จ / อ้างอิง',
  jobPaymentAmount: 'จำนวนเงินที่ชำระ / เงินคืน',
  jobPaymentDetail: 'รายละเอียดการชำระเงิน',
} as const satisfies Partial<Record<keyof JobRow, string>>;
const MONEY_TEXT = new Set<string>(['jobPaymentType', 'jobPaymentNo', 'jobPaymentDetail']);

async function isSystemAdmin(userId: number): Promise<boolean> {
  const [u] = await db.select({ t: appUser.userType }).from(appUser).where(eq(appUser.userId, userId)).limit(1);
  return u?.t?.trim() === ADMIN_USER_TYPE;
}

/** closed (Finished) and the user is not System Admin → the job's money may not change */
async function moneyLocked(statusId: number | null, byUserId: number): Promise<boolean> {
  return (await statusGroup(statusId ?? -1)) === FINISHED_GROUP && !(await isSystemAdmin(byUserId));
}

/**
 * A money-locked job: a money column whose new value differs from the stored one → 409 naming it, an
 * unchanged one passes. Returns `values` without the money columns and the totals summed from them, so
 * a re-save never rewrites them (a legacy total that does not add up stays as it is).
 */
function keepMoney<T extends Partial<JobRow>>(row: JobRow, values: T): T {
  const out: Partial<JobRow> = { ...values };
  for (const [k, label] of Object.entries(MONEY_COLS) as [keyof typeof MONEY_COLS, string][]) {
    if (!(k in values)) continue;
    const v = (values as Partial<JobRow>)[k];
    if (MONEY_TEXT.has(k) ? clean(row[k]) !== clean(v) : num(row[k]) !== num(v))
      throw new HttpError(409, moneyLockedMsg(label));
    delete out[k];
  }
  delete out.sparePartTotalCost;
  delete out.jobTotalCost;
  return out as T;
}

/** a job someone else already has: not taken silently (owner 2026-10-15) — the page asks, then sends takeOver */
async function takeOverError(rows: { no: string; eng: number }[]) {
  const users = await db
    .select({ id: appUser.userId, f: appUser.firstName, l: appUser.lastName })
    .from(appUser)
    .where(
      inArray(
        appUser.userId,
        rows.map((r) => r.eng),
      ),
    );
  const who = rows.map((r) => {
    const u = users.find((x) => x.id === r.eng);
    const name = (u && fullName(u.f, u.l)) || `#${r.eng}`;
    return rows.length > 1 ? `${r.no} ${name}` : name;
  });
  return new HttpError(409, `งานนี้มีผู้รับงานแล้ว (${who.join(', ')}) — มอบให้คนใหม่แทน?`, { takeOver: true });
}

async function writeSymptoms(tx: Tx, jobNo: string, ids: number[]) {
  await tx.delete(jobSymptom).where(eq(jobSymptom.jobNo, jobNo));
  if (ids.length) await tx.insert(jobSymptom).values(ids.map((symptomId) => ({ jobNo, symptomId })));
}

/**
 * The job as stored now, for an edit ("never worse"): `keep` = the required fields it has (they must
 * stay filled; fields the legacy data left empty may stay empty — 1900-01-01 and the "0" / "-"
 * placeholders count as empty), `check` = its values (an unchanged legacy value passes the format
 * rules) and its open date.
 */
async function jobNow(
  jobNo: string,
): Promise<{ keep: JobRequiredKey[]; check: JobCheck; shipper: string | null } | null> {
  const [r] = await db
    .select({
      customerId: job.customerId,
      jobTypeId: job.jobTypeId,
      so: job.jobReferenceNo,
      channel: job.productSaleOutChannel,
      saleOrderDate: job.productSaleOrderDate,
      warrantyMonth: job.productWarrantyMonth,
      expireDate: job.productExpireDate,
      serial: job.productSerial,
      brandId: job.productBrandId,
      modelId: job.productModelId,
      symptomId: job.productSymptomId,
      due: effectiveDueText,
      imei: job.productImeiNo,
      warranty: job.productWarranty,
      receptionDate: job.jobReceptionDate,
      receptionTrackingNo: job.jobReceptionTrackingNo,
      receptionType: job.jobReceptionType,
      shipper: job.jobReceptionShipper,
      opened: job.jobCreateDate,
    })
    .from(job)
    .where(eq(job.jobNo, jobNo))
    .limit(1);
  if (!r) return null;
  const txt = (v: string | null) => v ?? ''; // "0" / "-" placeholders: isRequiredFilled decides
  const id = (v: number | null) => ((v ?? 0) > 0 ? 'x' : '');
  const day = (v: string | null) => (v && !isSentinelDate(v) ? v.slice(0, 10) : '');
  const prev = {
    customerCode: id(r.customerId),
    jobType: id(r.jobTypeId),
    so: txt(r.so),
    channel: txt(r.channel),
    saleOrderDate: day(r.saleOrderDate),
    warrantyMonth: r.warrantyMonth ?? '',
    expireDate: day(r.expireDate),
    serial: txt(r.serial),
    brand: id(r.brandId),
    modelCode: id(r.modelId),
    symptoms: id(r.symptomId) ? ['x'] : [],
    dueDate: day(r.due),
    imei: txt(r.imei),
    warranty: txt(r.warranty),
    receptionDate: day(r.receptionDate),
    receptionTrackingNo: txt(r.receptionTrackingNo),
    receptionType: txt(r.receptionType),
  };
  return { keep: filledRequired(prev), check: { prev, openDate: fmtDate(r.opened) }, shipper: r.shipper };
}

export async function createJob(i: JobInput, byUserId: number): Promise<JobDetail> {
  assertValid(jobSchema(), i); // a new job: every required field (400 with every failing field under its box)
  const cust = await getCustomerByCode(str(i.customerCode));
  if (!cust) throw new HttpError(400, 'ต้องเลือกลูกค้าก่อนเปิดงาน');
  const lk = await lookups(i);
  if (!lk.jobTypeId) throw new HttpError(400, 'ต้องเลือกประเภทงานหลัก');
  const c = costFields(i);
  const now = nowThai();
  const engineerId = await resolveEngineer(i);
  const profile = await issuingProfile(i.documentProfileId);

  const jobNo = await db.transaction(async (tx) => {
    const no = await nextRunningNo(tx, 'Job');
    await tx.insert(job).values({
      jobNo: no,
      documentProfileId: profile.id,
      companyId: profile.id,
      branchId: 1,
      customerId: cust.id,
      customerDetail: `${cust.code} ${cust.name} ${cust.phone}`.trim().slice(0, 200),
      customerDueDate: dateOrSentinel(i.dueDate),
      dueDateSetByUser: true, // required on a new job — the user picked it
      jobCreateDate: now,
      jobCreateBy: byUserId,
      jobTypeId: lk.jobTypeId,
      jobTypeDetail: clean(i.jobTypeDetail),
      jobStatusId: JS.NEW,
      jobRepairedDate: SENTINEL_TS,
      jobRepairedBy: 0,
      jobClosedDate: SENTINEL_TS,
      jobClosedBy: 0,
      productImeiNo: cleanCode(i.imei),
      productSerial: cleanSerial(i.serial),
      productTypeId: lk.productTypeId ?? 0,
      productBrandId: lk.brandId ?? 0,
      productModelId: lk.modelId ?? 0,
      productModelName: (lk.modelName ?? str(i.modelCode)).slice(0, 50),
      productModelDetail: clean(i.modelDetail),
      productColor: clean(i.color).slice(0, 50), // not on the form (no schema): safety net only
      productSymptomId: lk.symIds[0] ?? 0,
      productSymptomOther: clean(i.symptomOther),
      productEquipment: clean(i.equipment),
      productFault: clean(i.fault),
      estimateCost: money(num(i.estimateCost)),
      depositCost: money(num(i.depositCost)),
      sparePartTotalCost: '0.00',
      serviceCost: money(c.service),
      serviceToolCost: money(c.tool),
      deliveryCost: money(c.delivery),
      cartonBoxCost: money(c.box),
      jobTotalCost: money(c.service + c.tool + c.delivery + c.box),
      jobReferenceNo: cleanCode(i.so),
      jobReferenceNoGspn: '',
      jobGspnCreateDate: SENTINEL_TS,
      jobRemark: cleanText(i.remark),
      engineerId,
      engineerSymptomId: 0,
      engineerRepairDetail: '',
      engineerRemark: '',
      jobPaymentType: '',
      jobPaymentNo: '',
      jobPaymentAmount: '0.00',
      jobPaymentDetail: '',
      jobReturnDate: SENTINEL_TS,
      returnCustomerType: '',
      returnCustomerTrackingNo: '',
      returnCustomerDetail: '',
      jobReturnBy: 0,
      sparePartReplace: '',
      productWarranty: clean(i.warranty),
      quotationNoApproved: '',
      productSaleOutChannel: clean(i.channel) || 'ยังไม่ระบุ',
      productSaleOrderDate: dateOrNull(i.saleOrderDate),
      productWarrantyMonth: int(i.warrantyMonth, 0),
      productExpireDate: dateOrNull(i.expireDate),
      jobReceptionType: clean(i.receptionType) || 'ไม่ระบุ',
      jobReceptionDate: dateOrNull(i.receptionDate) ?? now.slice(0, 10),
      jobReceptionTrackingNo: cleanTracking(i.receptionTrackingNo),
      jobReceptionShipper: clean(i.receptionShipper).slice(0, 50), // a profile name (≤ 200) — safety net
      swapRefundDetail: '',
      jobPaymentSlipFileName: '',
      swapRefundDocumentNo: '',
      isJobBounce: !!i.isBounce,
      productSaleOutShopName: clean(i.shopName),
    });
    await logStatus(tx, no, JS.NEW, byUserId);
    await writeSymptoms(tx, no, lk.symIds);
    await audit(tx, byUserId, {
      action: 'CREATE',
      module: 'Job Management',
      entity: 'job',
      key: no,
      summary: `เปิดงานใหม่ · ${cust.code} ${cust.name} · ${str(i.brand)} ${str(i.modelCode)}`.trim(),
    });
    if (engineerId > 0) await setStatus(tx, no, JS.IN_PROGRESS, byUserId, JS.NEW);
    return no;
  });
  return (await getJob(jobNo))!;
}

export async function updateJob(jobNo: string, i: JobInput, byUserId: number): Promise<JobDetail> {
  const [cur] = await db
    .select({ status: job.jobStatusId, custId: job.customerId, due: effectiveDueText })
    .from(job)
    .where(eq(job.jobNo, jobNo));
  if (!cur) throw new HttpError(404, 'ไม่พบหมายเลขงาน ' + jobNo);
  const was = await jobNow(jobNo);
  assertValid(jobSchema(was?.keep, was?.check), i); // never worse than it is now
  const cust = i.customerCode ? await getCustomerByCode(str(i.customerCode)) : null;
  const lk = await lookups(i, was?.shipper);
  const c = costFields(i);
  const newStatus = i.status ? await statusIdByName(i.status) : undefined;
  const engineerId = i.engineerId !== undefined || i.engineerEmail ? await resolveEngineer(i) : undefined;

  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(job).where(eq(job.jobNo, jobNo)).for('update');
    if (!existing) throw new HttpError(404, 'ไม่พบหมายเลขงาน ' + jobNo);
    assertVersion(i.version, existing.rowVersion);
    // a new engineer on a job that already has one: only when the user confirmed it (takeOver)
    const prevEng = existing.engineerId ?? 0;
    const assigning = engineerId !== undefined && engineerId > 0 && engineerId !== prevEng;
    if (assigning && prevEng > 0 && !i.takeOver) throw await takeOverError([{ no: jobNo, eng: prevEng }]);
    const parts = num(existing?.sparePartTotalCost);
    const values = {
      ...(cust
        ? { customerId: cust.id, customerDetail: `${cust.code} ${cust.name} ${cust.phone}`.trim().slice(0, 200) }
        : {}),
      // the due date is written (and becomes "picked by a user") only when it was changed: saving
      // an old job untouched keeps its SLA-based due date instead of freezing a date nobody chose
      ...(i.dueDate !== undefined && str(i.dueDate) !== (cur.due ?? '')
        ? { customerDueDate: dateOrSentinel(i.dueDate), dueDateSetByUser: true }
        : {}),
      ...(lk.jobTypeId ? { jobTypeId: lk.jobTypeId } : {}),
      jobTypeDetail: clean(i.jobTypeDetail),
      productImeiNo: cleanCode(i.imei),
      productSerial: cleanSerial(i.serial),
      ...(lk.productTypeId ? { productTypeId: lk.productTypeId } : {}),
      ...(lk.brandId ? { productBrandId: lk.brandId } : {}),
      ...(lk.modelId ? { productModelId: lk.modelId, productModelName: (lk.modelName ?? '').slice(0, 50) } : {}),
      productModelDetail: clean(i.modelDetail),
      // the form has no color field: not sent = keep it (it used to be blanked by every edit)
      ...(i.color !== undefined ? { productColor: clean(i.color).slice(0, 50) } : {}),
      ...(lk.symIds.length ? { productSymptomId: lk.symIds[0] } : {}),
      productSymptomOther: clean(i.symptomOther),
      productEquipment: clean(i.equipment),
      productFault: clean(i.fault),
      estimateCost: money(num(i.estimateCost)),
      depositCost: money(num(i.depositCost)),
      serviceCost: money(c.service),
      serviceToolCost: money(c.tool),
      deliveryCost: money(c.delivery),
      cartonBoxCost: money(c.box),
      jobTotalCost: money(parts + c.service + c.tool + c.delivery + c.box),
      jobReferenceNo: cleanCode(i.so),
      jobRemark: cleanText(i.remark),
      ...(engineerId !== undefined ? { engineerId } : {}),
      productWarranty: clean(i.warranty),
      productSaleOutChannel: clean(i.channel) || 'ยังไม่ระบุ',
      productSaleOrderDate: dateOrNull(i.saleOrderDate),
      productWarrantyMonth: int(i.warrantyMonth, 0),
      productExpireDate: dateOrNull(i.expireDate),
      jobReceptionType: clean(i.receptionType) || 'ไม่ระบุ',
      jobReceptionDate: dateOrNull(i.receptionDate),
      jobReceptionTrackingNo: cleanTracking(i.receptionTrackingNo),
      jobReceptionShipper: clean(i.receptionShipper).slice(0, 50), // a profile name (≤ 200) — safety net
      productSaleOutShopName: clean(i.shopName),
      ...(i.isBounce !== undefined ? { isJobBounce: !!i.isBounce } : {}),
    };
    const toWrite = (await moneyLocked(existing.jobStatusId, byUserId)) ? keepMoney(existing, values) : values;
    await tx.update(job).set(toWrite).where(eq(job.jobNo, jobNo));
    await audit(tx, byUserId, {
      action: 'UPDATE',
      module: 'Job Management',
      entity: 'job',
      key: jobNo,
      summary: 'แก้ไขข้อมูลงาน',
      changes: diff(existing as Record<string, unknown>, toWrite as Record<string, unknown>),
    });
    if (lk.symIds.length || (i.symptoms && i.symptoms.length === 0)) await writeSymptoms(tx, jobNo, lk.symIds);
    if (newStatus !== undefined) await setStatus(tx, jobNo, newStatus, byUserId, existing?.jobStatusId ?? null);
    // assigned here = the same as /jobs/assign: a new job moves to อยู่ระหว่างดำเนินการ (+ job_log)
    if (assigning && (newStatus ?? existing.jobStatusId) === JS.NEW)
      await setStatus(tx, jobNo, JS.IN_PROGRESS, byUserId, JS.NEW);
  });
  return (await getJob(jobNo))!;
}

/* ------------------------------------------------------------------ *
 * Assign (จนท.รับมอบหมายงาน)
 * ------------------------------------------------------------------ */
export async function assignJobs(
  jobNos: string[],
  engineerId: number,
  byUserId: number,
  takeOver = false,
): Promise<number> {
  if (!jobNos.length) throw new HttpError(400, 'ยังไม่ได้เลือกงาน');
  if (!engineerId) throw new HttpError(400, 'ต้องเลือกช่าง');
  await staffOrKeep(engineerId, undefined, 'engineerId', 0, 'ไม่พบช่างคนนี้ในรายชื่อปัจจุบัน'); // an active app_user
  const [who] = await db
    .select({ f: appUser.firstName, l: appUser.lastName })
    .from(appUser)
    .where(eq(appUser.userId, engineerId));
  const engName = (who && fullName(who.f, who.l)) || `#${engineerId}`;
  let n = 0;
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ no: job.jobNo, status: job.jobStatusId, eng: job.engineerId })
      .from(job)
      .where(inArray(job.jobNo, jobNos))
      .orderBy(job.jobNo)
      .for('update');
    if (!rows.length) return;
    const taken = rows.filter((r) => (r.eng ?? 0) > 0 && r.eng !== engineerId);
    if (taken.length && !takeOver) throw await takeOverError(taken.map((r) => ({ no: r.no, eng: r.eng ?? 0 })));
    // one UPDATE + one audit INSERT for the whole batch; only NEW jobs also change status
    await tx
      .update(job)
      .set({ engineerId })
      .where(
        inArray(
          job.jobNo,
          rows.map((r) => r.no),
        ),
      );
    await audit(
      tx,
      byUserId,
      rows.map((r) => ({
        action: 'ASSIGN' as const,
        module: 'Job Assign',
        entity: 'job',
        key: r.no,
        summary: `มอบหมายงานให้ช่าง ${engName}`,
        changes: { engineerId: [r.eng, engineerId] },
      })),
    );
    for (const r of rows) if (r.status === JS.NEW) await setStatus(tx, r.no, JS.IN_PROGRESS, byUserId, r.status);
    n = rows.length;
  });
  return n;
}

/* ------------------------------------------------------------------ *
 * Repair (บันทึกงานซ่อม) — details, costs, spare-part requests, status
 * ------------------------------------------------------------------ */
export type PartLineInput = {
  logId?: number; // existing job_order_spare_part_log row
  code: string;
  unitPrice?: number;
  /** ตาราง A (Normal): เบิก = request from stock, เสนอ = charge in quotation */
  a: { pick: boolean; quote: boolean; qty: number };
  /** ตาราง B (VIP) */
  b: { pick: boolean; quote: boolean; qty: number };
};

export type RepairInput = {
  engineerSymptom?: string; // name
  repairDetail?: string;
  engineerRemark?: string;
  newSerial?: string;
  serviceCost?: number | string;
  toolCost?: number | string;
  deliveryCost?: number | string;
  boxCost?: number | string;
  parts?: PartLineInput[];
  status?: string; // name
};

/**
 * job.spare_part_replace (varchar 300) holds the legacy part list ("มอเตอร์ดูดฝุ่น H11 MAX,H12" — 9,377
 * jobs): a new serial (บันทึกซ่อม / Swap) is one "New S/N: …" line ADDED to it (an earlier such line is
 * replaced), never written over it. No room left → 400 under newSerial instead of cutting either part.
 */
function withNewSerial(replace: string | null, serial: string): string {
  const kept = (replace ?? '')
    .split('\n')
    .filter((l) => !l.startsWith('New S/N:'))
    .join('\n')
    .trim();
  const v = [kept, `New S/N: ${serial}`].filter(Boolean).join('\n');
  if (v.length > 300) {
    const msg = 'ช่องรายการอะไหล่ที่เปลี่ยนของงานนี้เต็ม (300 ตัวอักษร) — บันทึก Serial ใหม่ในหมายเหตุแทน';
    throw new HttpError(400, msg, { fields: { newSerial: msg } });
  }
  return v;
}

/**
 * Column mapping inferred from the dump: request_qty / is_quotation / is_special
 * (+ the *_b twins) — is_quotation = "เสนอ" (charged), is_special = "เบิก"
 * (requested from stock; booking += qty until the store issues it).
 */
export async function saveRepair(jobNo: string, i: RepairInput, byUserId: number): Promise<JobDetail> {
  assertValid(repairActionSchema, i);
  const [cur] = await db.select({ status: job.jobStatusId, eng: job.engineerId }).from(job).where(eq(job.jobNo, jobNo));
  if (!cur) throw new HttpError(404, 'ไม่พบหมายเลขงาน ' + jobNo);
  const [es] = i.engineerSymptom
    ? await db
        .select({ id: symptom.symptomId })
        .from(symptom)
        .where(eq(symptom.symptomName, i.engineerSymptom))
        .limit(1)
    : [];
  const newStatus = i.status ? await statusIdByName(i.status) : undefined;
  let newRequests = false;

  await db.transaction(async (tx) => {
    const status = await lockJob(tx, jobNo);
    const locked = await moneyLocked(status, byUserId);
    const partsLocked = () => new HttpError(409, moneyLockedMsg('รายการ / ราคา / จำนวนอะไหล่'));
    let partsTotal = 0;
    if (i.parts) {
      const existing = await tx
        .select()
        .from(jobOrderSparePartLog)
        .where(eq(jobOrderSparePartLog.jobNo, jobNo))
        .for('update');
      const keep = new Set(i.parts.map((p) => p.logId).filter((x): x is number => !!x));
      const codes = i.parts.map((p) => str(p.code)).filter(Boolean);
      // still-pending rows are the only existing ones whose booking can move (cancel / re-book)
      const pending = existing.filter((e) => e.orderStatusId === PART.REQUESTED && (e.grantQty ?? 0) === 0);
      const map = await productsByCode(tx, [...codes, ...pending.map((e) => e.sparePartCode ?? '')]);
      await lockStock(
        tx,
        [...map.values()].map((p) => p.id),
      );

      // rows removed in the UI: cancel while still pending (nothing issued yet)
      for (const e of pending) {
        if (!keep.has(e.jobOrderLogId)) {
          if (locked) throw partsLocked();
          await tx
            .update(jobOrderSparePartLog)
            .set({ orderStatusId: PART.CANCELLED })
            .where(eq(jobOrderSparePartLog.jobOrderLogId, e.jobOrderLogId));
          const prod = map.get(e.sparePartCode ?? '');
          if (prod && e.isSpecial)
            await adjustQty(tx, prod.id, { booking: -(e.requestQty ?? 0) }, { allowNegative: true });
        }
      }

      for (const p of i.parts) {
        const price = num(p.unitPrice);
        const qtyA = Math.max(0, int(p.a.qty, 0));
        const qtyB = Math.max(0, int(p.b.qty, 0));
        const useA = (p.a.pick || p.a.quote) && qtyA > 0;
        const useB = (p.b.pick || p.b.quote) && qtyB > 0;
        const totalA = p.a.quote ? qtyA * price : 0;
        const totalB = p.b.quote ? qtyB * price : 0;
        const values = {
          sparePartUnitPrice: money(price),
          isQuotation: useA && p.a.quote,
          isSpecial: useA && p.a.pick,
          requestQty: useA ? qtyA : 0,
          sparePartTotalPrice: money(useA ? totalA : 0),
          isQuotationB: useB && p.b.quote,
          isSpecialB: useB && p.b.pick,
          requestQtyB: useB ? qtyB : 0,
          sparePartTotalPriceB: money(useB ? totalB : 0),
        };
        const prod = map.get(str(p.code));

        if (p.logId) {
          const e = existing.find((x) => x.jobOrderLogId === p.logId);
          if (!e) continue;
          // a closed job: the line as loaded passes untouched, anything else is a money change
          const asLoaded =
            price === num(e.sparePartUnitPrice) &&
            !!p.a.pick === !!e.isSpecial &&
            !!p.a.quote === !!e.isQuotation &&
            qtyA === (e.requestQty ?? 0) &&
            !!p.b.pick === !!e.isSpecialB &&
            !!p.b.quote === !!e.isQuotationB &&
            qtyB === (e.requestQtyB ?? 0);
          if (locked && !asLoaded) throw partsLocked();
          if (!locked && e.orderStatusId === PART.REQUESTED && (e.grantQty ?? 0) === 0) {
            // still editable: re-book the delta
            const before = e.isSpecial ? (e.requestQty ?? 0) : 0;
            const after = values.isSpecial ? values.requestQty : 0;
            if (prod && after !== before)
              await adjustQty(tx, prod.id, { booking: after - before }, { allowNegative: true });
            await tx.update(jobOrderSparePartLog).set(values).where(eq(jobOrderSparePartLog.jobOrderLogId, p.logId));
            partsTotal += useA ? totalA : 0;
          } else {
            partsTotal += num(e.sparePartTotalPrice);
          }
          continue;
        }
        if (!useA && !useB) continue;
        if (locked) throw partsLocked();
        if (!prod) throw new HttpError(400, `ไม่พบรหัสอะไหล่ ${p.code}`);
        if (values.isSpecial) await adjustQty(tx, prod.id, { booking: values.requestQty }, { allowNegative: true });
        await tx.insert(jobOrderSparePartLog).values({
          jobNo,
          sparePartCode: str(p.code),
          sparePartSerialNo: '',
          stockId: 1,
          ...values,
          orderStatusId: PART.REQUESTED,
          requestDate: nowThai(),
          requestBy: byUserId,
          grantQty: 0,
          grantDate: SENTINEL_TS,
          grantBy: -1,
          returnQty: 0,
          returnDate: SENTINEL_TS,
          returnBy: -1,
          returnStockId: -1,
        });
        if (values.isSpecial) newRequests = true;
        partsTotal += useA ? totalA : 0;
      }
    } else {
      partsTotal = await partsTotalOf(tx, jobNo);
    }

    // ---- job fields ----
    const [j] = await tx.select().from(job).where(eq(job.jobNo, jobNo));
    if (!j) throw new HttpError(404, 'ไม่พบหมายเลขงาน ' + jobNo); // locked by lockJob above — cannot vanish
    const service = i.serviceCost !== undefined ? num(i.serviceCost) : num(j.serviceCost);
    const tool = i.toolCost !== undefined ? num(i.toolCost) : num(j.serviceToolCost);
    const delivery = i.deliveryCost !== undefined ? num(i.deliveryCost) : num(j.deliveryCost);
    const box = i.boxCost !== undefined ? num(i.boxCost) : num(j.cartonBoxCost);
    const repairValues = {
      ...(es ? { engineerSymptomId: es.id } : {}),
      ...(i.repairDetail !== undefined ? { engineerRepairDetail: cleanText(i.repairDetail) } : {}),
      ...(i.engineerRemark !== undefined ? { engineerRemark: cleanText(i.engineerRemark) } : {}),
      ...(cleanSerial(i.newSerial)
        ? { sparePartReplace: withNewSerial(j.sparePartReplace, cleanSerial(i.newSerial)) }
        : {}),
      engineerId: cur.eng && cur.eng > 0 ? cur.eng : byUserId,
      sparePartTotalCost: money(partsTotal),
      serviceCost: money(service),
      serviceToolCost: money(tool),
      deliveryCost: money(delivery),
      cartonBoxCost: money(box),
      jobTotalCost: money(partsTotal + service + tool + delivery + box),
    };
    const toWrite = locked ? keepMoney(j, repairValues) : repairValues;
    await tx.update(job).set(toWrite).where(eq(job.jobNo, jobNo));
    await audit(tx, byUserId, {
      action: 'UPDATE',
      module: 'Job Repair',
      entity: 'job',
      key: jobNo,
      summary: `บันทึกงานซ่อม${i.parts ? ` · อะไหล่ ${i.parts.length} รายการ` : ''}`,
      changes: diff(j as unknown as Record<string, unknown>, toWrite as Record<string, unknown>),
    });

    // ---- status: a changed choice wins (the page sends the current one back unchanged); new stock
    // requests move a new/in-progress job to 11 ----
    let target = newStatus === status ? undefined : newStatus;
    if (target === undefined && newRequests && (status === JS.NEW || status === JS.IN_PROGRESS))
      target = JS.PARTS_REQUESTED;
    if (target !== undefined) await setStatus(tx, jobNo, target, byUserId, status);
  });
  return (await getJob(jobNo))!;
}

/** Called by stock after issuing all pending requests of a job: เริ่มเบิก / รออะไหล่ → เบิกจ่ายอะไหล่ครบแล้ว. */
export async function markPartsIssued(jobNo: string, byUserId: number) {
  await db.transaction(async (tx) => {
    const [cur] = await tx.select({ status: job.jobStatusId }).from(job).where(eq(job.jobNo, jobNo)).for('update');
    if (!cur || (cur.status !== JS.PARTS_REQUESTED && cur.status !== JS.WAIT_PARTS)) return;
    // recount under the job lock: a repair saved since the issue may have requested more parts
    const [waiting] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(jobOrderSparePartLog)
      .where(
        and(
          eq(jobOrderSparePartLog.jobNo, jobNo),
          eq(jobOrderSparePartLog.orderStatusId, PART.REQUESTED),
          eq(jobOrderSparePartLog.isSpecial, true), // เสนอ-only lines are not for stock (listPartRequests)
          sql`coalesce(${jobOrderSparePartLog.requestQty},0) > coalesce(${jobOrderSparePartLog.grantQty},0)`,
        ),
      );
    if ((waiting?.n ?? 0) === 0) await setStatus(tx, jobNo, JS.PARTS_ISSUED, byUserId, cur.status);
  });
}

/* ------------------------------------------------------------------ *
 * Outsource (บันทึกงานส่งซ่อมต่อ)
 * ------------------------------------------------------------------ */
export type OutsourceInput = {
  engineerSymptom?: string;
  symptomOther?: string;
  repairDetail?: string;
  /** `by` = app_user id of ส่งโดย / รับโดย; left out → the user saving */
  send?: { to: string; date?: string; detail?: string; by?: number };
  receive?: { from?: string; date?: string; detail?: string; by?: number };
  status?: string;
};

export async function saveOutsource(jobNo: string, i: OutsourceInput, byUserId: number): Promise<JobDetail> {
  assertValid(outsourceActionSchema, i);
  const [cur] = await db.select({ status: job.jobStatusId }).from(job).where(eq(job.jobNo, jobNo));
  if (!cur) throw new HttpError(404, 'ไม่พบหมายเลขงาน ' + jobNo);
  const [es] = i.engineerSymptom
    ? await db
        .select({ id: symptom.symptomId })
        .from(symptom)
        .where(eq(symptom.symptomName, i.engineerSymptom))
        .limit(1)
    : [];
  const newStatus = i.status ? await statusIdByName(i.status) : undefined;
  // only the out-source statuses here — the job's own status re-saves unchanged ("never worse")
  const outsourceStatuses: number[] = [JS.OUTSOURCE_SENT, JS.OUTSOURCE_RECEIVED, cur.status ?? -1];
  if (newStatus !== undefined && !outsourceStatuses.includes(newStatus))
    throw new HttpError(400, OUTSOURCE_STATUS_ONLY, { fields: { status: OUTSOURCE_STATUS_ONLY } });
  if (i.receive && !i.receive.date)
    throw new HttpError(400, RECEIVE_DATE_REQUIRED, { fields: { 'receive.date': RECEIVE_DATE_REQUIRED } });
  // the people on the latest row (open, or already back and saved again) may stay even if they left
  const [lastRow] = await db
    .select({ sendBy: jobSendForwardDt.sendBy, receiveBy: jobSendForwardDt.receiveBy })
    .from(jobSendForwardDt)
    .where(eq(jobSendForwardDt.jobNo, jobNo))
    .orderBy(desc(jobSendForwardDt.id))
    .limit(1);
  const sendBy = await staffOrKeep(i.send?.by, lastRow?.sendBy, 'send.by', byUserId);
  const receiveBy = await staffOrKeep(i.receive?.by, lastRow?.receiveBy, 'receive.by', byUserId);

  await db.transaction(async (tx) => {
    const status = await lockJob(tx, jobNo);
    const open = await tx
      .select()
      .from(jobSendForwardDt)
      .where(outsourceOpen(jobNo))
      .orderBy(desc(jobSendForwardDt.id))
      .limit(1);
    // the send date is usually stored already (the page sends the receive block alone)
    const sentOn = fmtDate(open[0]?.sendDate);
    if (i.receive?.date && sentOn && i.receive.date < sentOn)
      throw new HttpError(400, RECEIVE_BEFORE_SEND, { fields: { 'receive.date': RECEIVE_BEFORE_SEND } });
    const fields = {
      ...(es ? { engineerSymptomId: es.id } : {}),
      ...(i.symptomOther !== undefined ? { productSymptomOther: clean(i.symptomOther) } : {}),
      ...(i.repairDetail !== undefined ? { engineerRepairDetail: cleanText(i.repairDetail) } : {}),
    };
    const [before] = await tx.select().from(job).where(eq(job.jobNo, jobNo));
    if (Object.keys(fields).length) await tx.update(job).set(fields).where(eq(job.jobNo, jobNo));
    // the latest send row: the open one, or the one already back (its fields saved again after the receive)
    const [last] = open[0]
      ? open
      : await tx
          .select()
          .from(jobSendForwardDt)
          .where(eq(jobSendForwardDt.jobNo, jobNo))
          .orderBy(desc(jobSendForwardDt.id))
          .limit(1);
    const back = last?.sendStatus === 'รับเครื่องซ่อมแล้ว';
    await audit(tx, byUserId, {
      action: 'UPDATE',
      module: 'Job Repair',
      entity: 'job',
      key: jobNo,
      summary: i.receive
        ? `รับคืนจาก Out-Source (${str(i.receive.from)})`
        : i.send
          ? `ส่งซ่อมต่อ → ${str(i.send.to)}`
          : 'บันทึกงานส่งซ่อมต่อ',
      // old values: the job row + the latest send row (none yet → null)
      changes: diff(
        {
          ...before,
          ...(last
            ? {
                sendTo: last.sendToName,
                sendDate: fmtDate(last.sendDate),
                sendBy: last.sendBy,
                ...(back
                  ? {
                      receiveFrom: last.sendToName,
                      receiveDate: fmtDate(last.receiveDate),
                      receiveBy: last.receiveBy,
                      receiveDetail: last.receiveDetail,
                    }
                  : {}),
              }
            : {}),
        },
        {
          ...fields,
          ...(i.send ? { sendTo: str(i.send.to), sendDate: str(i.send.date), sendBy } : {}),
          ...(i.receive
            ? {
                receiveFrom: str(i.receive.from),
                receiveDate: str(i.receive.date),
                receiveBy,
                receiveDetail: cleanText(i.receive.detail),
              }
            : {}),
        },
      ),
    });

    let target = newStatus;

    if (i.receive && open[0]) {
      await tx
        .update(jobSendForwardDt)
        .set({
          receiveDate: dateOrSentinel(i.receive.date ?? nowThai()),
          receiveBy,
          receiveDetail: cleanText(i.receive.detail),
          sendStatus: 'รับเครื่องซ่อมแล้ว',
        })
        .where(eq(jobSendForwardDt.id, open[0].id));
      // back from out-source = repaired (the receive form has no "not repaired" outcome): without this
      // the job is closed with job_repaired_date 1900 and drops out of the repair reports
      await stampRepairedIfMissing(tx, jobNo, dateOrSentinel(i.receive.date ?? nowThai()), byUserId);
      target ??= JS.OUTSOURCE_RECEIVED;
    } else if (i.send?.to) {
      // the page sends the send block again after the receive (+ the receive block, its note may be edited):
      // the same vendor + send date as the last row (already back) is that row saved again, not a new
      // trip — no second row, no going back to 14
      const again =
        !open[0] &&
        !!last &&
        clean(last.sendToName) === clean(i.send.to) &&
        fmtDate(last.sendDate) === str(i.send.date);
      const row = open[0] ?? (again ? last : undefined);
      if (row) {
        await tx
          .update(jobSendForwardDt)
          .set({
            sendToName: clean(i.send.to),
            sendDetail: cleanText(i.send.detail),
            sendDate: dateOrSentinel(i.send.date ?? nowThai()),
            sendBy,
            ...(again && back && i.receive
              ? {
                  receiveDate: dateOrSentinel(i.receive.date),
                  receiveBy,
                  receiveDetail: cleanText(i.receive.detail),
                }
              : {}),
          })
          .where(eq(jobSendForwardDt.id, row.id));
      } else {
        await tx.insert(jobSendForwardDt).values({
          jobNo,
          sendToName: clean(i.send.to),
          sendDetail: cleanText(i.send.detail),
          sendDate: dateOrSentinel(i.send.date ?? nowThai()),
          sendBy,
          receiveDate: SENTINEL_TS,
          receiveBy: -1,
          receiveDetail: '',
          sendStatus: 'ส่งเครื่องซ่อมแล้ว',
        });
      }
      if (!again) target ??= JS.OUTSOURCE_SENT;
    }
    if (target !== undefined) await setStatus(tx, jobNo, target, byUserId, status);
  });
  return (await getJob(jobNo))!;
}

/** Distinct outsource vendors seen in the data (for the dropdown). */
export function listOutsourceVendors(): Promise<string[]> {
  return cached('jobs:vendors', 5 * TTL_MASTER, loadOutsourceVendors);
}
async function loadOutsourceVendors(): Promise<string[]> {
  const rows = await db
    .select({ name: jobSendForwardDt.sendToName, n: count() })
    .from(jobSendForwardDt)
    .groupBy(jobSendForwardDt.sendToName)
    .orderBy(desc(count()));
  return rows.map((r) => r.name?.trim() ?? '').filter(Boolean);
}

/** งานย่อย (job.job_type_detail) — every value the legacy data uses, most common first. */
export function listJobTypeDetails(): Promise<string[]> {
  return cached('jobs:type_details', 5 * TTL_MASTER, loadJobTypeDetails);
}
async function loadJobTypeDetails(): Promise<string[]> {
  const rows = await db
    .select({ v: job.jobTypeDetail, n: count() })
    .from(job)
    .where(sql`coalesce(${job.jobTypeDetail},'') <> ''`)
    .groupBy(job.jobTypeDetail)
    .orderBy(desc(count()));
  return rows.map((r) => r.v?.trim() ?? '').filter(Boolean);
}

/** บริษัทขนส่ง (job.job_reception_shipper) — free text in the legacy app; top values as suggestions. */
export function listShippers(limit = 15): Promise<string[]> {
  return cached(`jobs:shippers:${limit}`, 5 * TTL_MASTER, () => loadShippers(limit));
}
async function loadShippers(limit: number): Promise<string[]> {
  const rows = await db
    .select({ v: job.jobReceptionShipper, n: count() })
    .from(job)
    .where(sql`length(trim(coalesce(${job.jobReceptionShipper},''))) >= 2`)
    .groupBy(job.jobReceptionShipper)
    .orderBy(desc(count()))
    .limit(limit);
  return rows.map((r) => r.v?.trim() ?? '').filter(Boolean);
}

/** Shop Name (job.product_sale_out_shop_name) — free text in the legacy app (511 spellings);
 *  the most used ones (trimmed) are offered as suggestions, typing a new one still works. */
export function listShopNames(limit = 60): Promise<string[]> {
  return cached(`jobs:shop_names:${limit}`, 5 * TTL_MASTER, () => loadShopNames(limit));
}
async function loadShopNames(limit: number): Promise<string[]> {
  const v = sql<string>`trim(${job.productSaleOutShopName})`;
  const rows = await db
    .select({ v, n: count() })
    .from(job)
    .where(sql`length(trim(coalesce(${job.productSaleOutShopName},''))) >= 2`)
    .groupBy(v)
    .orderBy(desc(count()))
    .limit(limit);
  return rows.map((r) => r.v ?? '').filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * Swap / Refund
 * ------------------------------------------------------------------ */
export type SwapRefundInput = {
  inspection?: string; // ผลการตรวจสอบ → engineer_repair_detail
  newSerial?: string;
  newModel?: string;
  swapDate?: string;
  docNo?: string;
  refundAmount?: number | string;
  refundMethod?: string;
  refundRef?: string;
  refundDate?: string;
  detail?: string;
  status?: string;
};

export async function saveSwapRefund(jobNo: string, i: SwapRefundInput, byUserId: number): Promise<JobDetail> {
  const [cur] = await db
    .select({
      status: job.jobStatusId,
      total: job.jobTotalCost,
      detail: job.swapRefundDetail,
      docNo: job.swapRefundDocumentNo,
      payNo: job.jobPaymentNo,
    })
    .from(job)
    .where(eq(job.jobNo, jobNo));
  if (!cur) throw new HttpError(404, 'ไม่พบหมายเลขงาน ' + jobNo);
  const sw = parseSwap(cur.detail ?? '');
  assertValid(
    swapRefundSchema({
      total: num(cur.total),
      prev: { newSerial: sw['New S/N'], docNo: cur.docNo, refundRef: sw['เลขที่บัญชี/อ้างอิง'] ?? cur.payNo },
    }),
    i,
  );
  const newStatus = i.status ? await statusIdByName(i.status) : undefined;
  const newSerial = cleanSerial(i.newSerial);
  const refundRef = cleanCode(i.refundRef);
  const lines = [
    newSerial ? `New S/N: ${newSerial}` : '',
    i.newModel ? `รุ่นที่เปลี่ยนให้: ${clean(i.newModel)}` : '',
    i.swapDate ? `วันที่เปลี่ยนเครื่อง: ${str(i.swapDate)}` : '',
    num(i.refundAmount) > 0 ? `ยอดเงินคืน: ${num(i.refundAmount).toFixed(2)}` : '',
    i.refundMethod ? `วิธีการคืนเงิน: ${clean(i.refundMethod)}` : '',
    refundRef ? `เลขที่บัญชี/อ้างอิง: ${refundRef}` : '',
    i.refundDate ? `วันที่คืนเงิน: ${str(i.refundDate)}` : '',
    i.detail ? `รายละเอียด: ${clean(i.detail)}` : '',
  ].filter(Boolean);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(job).where(eq(job.jobNo, jobNo)).for('update');
    if (!before) throw new HttpError(404, 'ไม่พบหมายเลขงาน ' + jobNo);
    const swapValues = {
      ...(i.inspection !== undefined ? { engineerRepairDetail: cleanText(i.inspection) } : {}),
      swapRefundDetail: lines.join('\n'),
      swapRefundDocumentNo: /^0{1,2}$/.test(cleanCode(i.docNo)) ? '' : cleanCode(i.docNo), // "0" / "00" = none
      ...(newSerial ? { sparePartReplace: withNewSerial(before.sparePartReplace, newSerial) } : {}),
      ...(num(i.refundAmount) > 0
        ? {
            jobPaymentType: clean(i.refundMethod).slice(0, 50), // a list value — safety net
            jobPaymentNo: refundRef,
            jobPaymentAmount: money(-Math.abs(num(i.refundAmount))),
            jobPaymentDetail: `Refund ${str(i.refundDate)}`.slice(0, 100),
          }
        : {}),
    };
    const toWrite = (await moneyLocked(before.jobStatusId, byUserId)) ? keepMoney(before, swapValues) : swapValues;
    await tx.update(job).set(toWrite).where(eq(job.jobNo, jobNo));
    await audit(tx, byUserId, {
      action: 'UPDATE',
      module: 'Job Management',
      entity: 'job',
      key: jobNo,
      summary:
        num(i.refundAmount) > 0
          ? `บันทึก Refund ${num(i.refundAmount).toFixed(2)} บาท`
          : 'บันทึก Swap / เปลี่ยนเครื่อง',
      changes: diff(before as Record<string, unknown>, toWrite as Record<string, unknown>),
    });
    if (newStatus !== undefined) await setStatus(tx, jobNo, newStatus, byUserId, before.jobStatusId ?? null);
  });
  return (await getJob(jobNo))!;
}

/* ------------------------------------------------------------------ *
 * Close (ปิดงาน-ส่งคืนสินค้า)
 * ------------------------------------------------------------------ */
export type CloseInput = {
  repairDetail?: string;
  payment?: { type?: string; amount?: number | string; date?: string; no?: string; detail?: string };
  return?: { type?: string; date?: string; courier?: string; tracking?: string; detail?: string; shipperId?: number };
  status: string;
};

export async function closeJob(jobNo: string, i: CloseInput, byUserId: number): Promise<JobDetail> {
  const [cur] = await db
    .select({ status: job.jobStatusId, payNo: job.jobPaymentNo, tracking: job.returnCustomerTrackingNo })
    .from(job)
    .where(eq(job.jobNo, jobNo));
  if (!cur) throw new HttpError(404, 'ไม่พบหมายเลขงาน ' + jobNo);
  assertValid(closeSchema({ payNo: cur.payNo, tracking: cur.tracking }), i);
  let newStatus = await statusIdByName(i.status);
  // "รอลงเลขที่พัสดุ" + a parcel no. typed now = it is in: the guide's path (close as 7, add the no. later)
  if (newStatus === JS.CLOSED_WAIT_TRACKING && cleanTracking(i.return?.tracking)) newStatus = JS.CLOSED_TRACKED;
  await db.transaction(async (tx) => {
    const status = await lockJob(tx, jobNo);
    const pay = i.payment ?? {};
    const ret = i.return ?? {};
    const fields = {
      ...(i.repairDetail !== undefined ? { engineerRepairDetail: cleanText(i.repairDetail) } : {}),
      ...(pay.type || num(pay.amount) > 0
        ? {
            jobPaymentType: clean(pay.type).slice(0, 50), // a list value — safety net
            jobPaymentNo: cleanCode(pay.no),
            jobPaymentAmount: money(num(pay.amount)),
            jobPaymentDetail: paymentDetailOf(pay.date, pay.detail),
          }
        : {}),
      ...(ret.type || ret.tracking || ret.date
        ? {
            jobReturnDate: dateOrSentinel(ret.date ?? nowThai()),
            returnCustomerType: clean(ret.type).slice(0, 50), // a list value — safety net
            returnCustomerTrackingNo: cleanTracking(ret.tracking),
            returnCustomerDetail: returnDetailOf(ret.courier, ret.detail),
            // โปรไฟล์บริษัทขนส่ง (drizzle/0013) — drives the logo + tracking link on /track
            returnShipperId: Number(ret.shipperId) > 0 ? Number(ret.shipperId) : null,
            jobReturnBy: byUserId,
          }
        : {}),
    };
    const [before] = await tx.select().from(job).where(eq(job.jobNo, jobNo));
    if (!before) throw new HttpError(404, 'ไม่พบหมายเลขงาน ' + jobNo); // locked by lockJob above
    const toWrite = (await moneyLocked(status, byUserId)) ? keepMoney(before, fields) : fields;
    if (Object.keys(toWrite).length) await tx.update(job).set(toWrite).where(eq(job.jobNo, jobNo));
    // paying less than due is allowed (owner 2026-10-15) — the close page confirms it, the log says it
    const after = { ...before, ...toWrite };
    const { outstanding } = jobBalance(num(after.jobTotalCost), num(after.depositCost), num(after.jobPaymentAmount));
    await audit(tx, byUserId, {
      action: 'UPDATE',
      module: 'Job Closing',
      entity: 'job',
      key: jobNo,
      summary: `บันทึกปิดงาน / ส่งคืนสินค้า${outstanding > 0 ? ` · ค้างชำระ ${outstanding.toFixed(2)} บาท` : ''}`,
      changes: diff(before as Record<string, unknown>, toWrite as Record<string, unknown>),
    });
    await setStatus(tx, jobNo, newStatus, byUserId, status);
  });
  return (await getJob(jobNo))!;
}

/* ------------------------------------------------------------------ *
 * Attachments (document_attach) — files live in Supabase Storage
 * ------------------------------------------------------------------ */
export async function addAttachment(
  jobNo: string,
  originalName: string,
  systemName: string,
  remark = '',
  byUserId = 0,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(documentAttach)
      .values({
        referenceTopic: 'Jobs',
        referenceItemCode: jobNo,
        originalFileName: originalName.slice(0, 50),
        systemFileName: systemName.slice(0, 50),
        remark: remark.slice(0, 100),
        isActive: true,
      })
      .returning({ id: documentAttach.documentAttachId });
    if (!row) throw new Error('document_attach insert returned no row');
    await audit(tx, byUserId, {
      action: 'UPLOAD',
      module: 'Job Management',
      entity: 'job',
      key: jobNo,
      summary: `แนบไฟล์ ${originalName}`,
      changes: { file: [null, systemName] },
    });
    return row.id;
  });
}

export async function removeAttachment(id: number, byUserId = 0) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ jobNo: documentAttach.referenceItemCode, name: documentAttach.originalFileName })
      .from(documentAttach)
      .where(eq(documentAttach.documentAttachId, id));
    await tx
      .update(documentAttach)
      .set(statusStamp(RS.DELETED, byUserId))
      .where(eq(documentAttach.documentAttachId, id));
    await audit(tx, byUserId, {
      action: 'DELETE',
      module: 'Job Management',
      entity: 'job',
      key: row?.jobNo ?? String(id),
      summary: `ลบไฟล์แนบ ${row?.name ?? id}`,
    });
  });
}

/* ------------------------------------------------------------------ *
 * Dashboard — computed live from job / job_log
 * ------------------------------------------------------------------ */
/** `type` = job type NAME (same convention as the job list filter) */
export type DashRange = { from?: string; to?: string; type?: string };

// 30 s memo per date range (the dashboard is opened constantly). cached() gives parallel callers the
// same in-flight computation, so the page's panels never compute it more than once.
export function dashboard(range: DashRange = {}) {
  const from = ymd(range.from) ?? '';
  const to = ymd(range.to) ?? '';
  const type = (range.type ?? '').trim();
  return cached(`dashboard:${from}|${to}|${type}`, 30_000, () => computeDashboard(from, to, type));
}

/** every day ("YYYY-MM-DD") or month ("YYYY-MM") from lo to hi, inclusive */
function periodKeys(lo: string, hi: string, daily: boolean): string[] {
  const keys: string[] = [];
  if (daily) {
    for (let d = lo; d <= hi && keys.length < 400; d = addDays(d, 1)) keys.push(d);
    return keys;
  }
  let [y = NaN, m = NaN] = lo.slice(0, 7).split('-').map(Number); // missing part → NaN, as before
  const end = hi.slice(0, 7);
  for (let k = lo.slice(0, 7); k <= end && keys.length < 1200;) {
    keys.push(k);
    m += 1;
    if (m > 12) [y, m] = [y + 1, 1];
    k = `${y}-${String(m).padStart(2, '0')}`;
  }
  return keys;
}

const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/**
 * Everything except the TAT table follows the date range (job_create_date;
 * the "closed" line of the chart uses job_closed_date). Empty from/to = all time.
 * TAT is a snapshot of the jobs still open right now, by design.
 */
async function computeDashboard(from: string, to: string, type = '') {
  // optional job-type filter: resolve the name once, then filter every query by id (unknown name → no rows)
  const typeId = type
    ? ((await db.select({ id: jobType.jobTypeId }).from(jobType).where(eq(jobType.jobTypeName, type)).limit(1))[0]
        ?.id ?? -1)
    : null;
  const ofType = typeId === null ? undefined : eq(job.jobTypeId, typeId);
  const createdIn = and(
    ne(job.recordStatus, RS.DELETED),
    typeId === null ? undefined : eq(job.jobTypeId, typeId),
    from ? gte(job.jobCreateDate, `${from} 00:00:00`) : undefined,
    to ? lte(job.jobCreateDate, `${to} 23:59:59`) : undefined,
  );
  // TAT buckets for open jobs (days since job_create_date) per status — snapshot, not range-bound.
  // "today" is the Thai calendar day (job dates are stored as Thai wall-clock), so each bucket maps
  // exactly onto a create-date range in the job list (dashboard cells deep-link there).
  const age = sql`GREATEST(1, ((now() AT TIME ZONE 'Asia/Bangkok')::date - ${job.jobCreateDate}::date))`;
  const bucket = (cond: SQL) => sql<string>`count(*) filter (where ${cond})`;
  // open / close trend: daily when the range is ≤ 62 days, otherwise monthly (all time = from the first job).
  // Counts come grouped from Postgres; the empty days / months in between are filled in here.
  const spanDays = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 : Infinity;
  const daily = spanDays <= 62;
  const trendQ = async () => {
    const [bounds] =
      from && to
        ? [{ first: from, today: to }]
        : await db
            .select({
              first: sql<string>`to_char(coalesce(min(${job.jobCreateDate})::date, current_date), 'YYYY-MM-DD')`,
              today: sql<string>`to_char(current_date, 'YYYY-MM-DD')`,
            })
            .from(job);
    if (!bounds) throw new Error('min(job_create_date) returned no row'); // an aggregate always returns one
    const lo = daily ? from || bounds.first : `${(from || bounds.first).slice(0, 7)}-01`;
    const hi = to || bounds.today;
    const perPeriod = async (col: typeof job.jobCreateDate | typeof job.jobClosedDate) => {
      // the format is literal SQL (not a bound parameter) so SELECT and GROUP BY are the same expression
      const k = daily ? sql<string>`to_char(${col}, 'YYYY-MM-DD')` : sql<string>`to_char(${col}, 'YYYY-MM')`;
      const rows = await db
        .select({ k, n: count() })
        .from(job)
        .where(
          and(
            ne(job.recordStatus, RS.DELETED),
            ofType,
            gte(col, `${lo} 00:00:00`),
            lt(col, `${addDays(hi, 1)} 00:00:00`),
          ),
        )
        .groupBy(k);
      return new Map(rows.map((r) => [r.k, Number(r.n)]));
    };
    const [opened, closed] = await Promise.all([perPeriod(job.jobCreateDate), perPeriod(job.jobClosedDate)]);
    return periodKeys(lo, hi, daily).map((k) => ({ k, open: opened.get(k) ?? 0, close: closed.get(k) ?? 0 }));
  };
  // the four panels are independent: run them side by side (the page waits for the slowest, not the sum)
  const [groups, tat, trend, top] = await Promise.all([
    db
      .select({ group: kpiGroup, n: count() })
      .from(job)
      .innerJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
      .where(createdIn)
      .groupBy(kpiGroup),
    db
      .select({
        statusId: jobStatus.jobStatusId,
        status: jobStatus.jobStatusName,
        d13: bucket(sql`${age} <= 3`),
        d47: bucket(sql`${age} between 4 and 7`),
        d814: bucket(sql`${age} between 8 and 14`),
        d1530: bucket(sql`${age} between 15 and 30`),
        over30: bucket(sql`${age} > 30`),
      })
      .from(job)
      .innerJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
      .where(and(ne(job.recordStatus, RS.DELETED), ofType, isOpenJob))
      .groupBy(jobStatus.jobStatusId, jobStatus.jobStatusName, jobStatus.displayOrder)
      .orderBy(asc(jobStatus.displayOrder)),
    trendQ(),
    db
      .select({ name: symptom.symptomName, n: count() })
      .from(job)
      .innerJoin(symptom, eq(symptom.symptomId, job.productSymptomId))
      .where(createdIn)
      .groupBy(symptom.symptomName)
      .orderBy(desc(count()))
      .limit(8),
  ]);
  const total = groups.reduce((s, g) => s + Number(g.n), 0) || 1;
  const G: Record<
    string,
    {
      key: string;
      label: string;
      sub: string;
      tone: 'primary' | 'warning' | 'info' | 'success' | 'danger';
      ord: number;
    }
  > = {
    Pending: { key: 'pending', label: 'งานระหว่างดำเนินการ', sub: 'Pending', tone: 'warning', ord: 1 },
    Repaired: { key: 'repaired', label: 'ซ่อมเสร็จ / รอปิดงาน', sub: 'Repaired', tone: 'info', ord: 2 },
    Finished: { key: 'finished', label: 'ปิดงานแล้ว', sub: 'Finished', tone: 'success', ord: 3 },
    // = ยกเลิกซ่อม (ลูกค้าไม่ตกลงซ่อม) — see kpiGroup
    Cancel: { key: 'cancel', label: 'ยกเลิก / ลูกค้าไม่ซ่อม', sub: 'Cancel', tone: 'danger', ord: 4 },
  };
  const dashGroups = Object.entries(G)
    .map(([g, meta]) => {
      const n = Number(groups.find((x) => x.group === g)?.n ?? 0);
      return { ...meta, jobs: n, percent: Math.round((n / total) * 1000) / 10 };
    })
    .sort((a, b) => a.ord - b.ord);

  const tatRows = tat.map((r) => ({
    statusId: Number(r.statusId),
    status: String(r.status ?? '').trim(),
    d13: Number(r.d13),
    d47: Number(r.d47),
    d814: Number(r.d814),
    d1530: Number(r.d1530),
    over30: Number(r.over30),
  }));

  const monthlyRows = trend.map((r) => {
    const [y, mo, d] = r.k.split('-');
    const label = daily
      ? `${Number(d)} ${TH_MONTH[Number(mo) - 1]}`
      : `${TH_MONTH[Number(mo) - 1]} ${String(Number(y) + 543).slice(-2)}`;
    return { m: label, open: Number(r.open), close: Number(r.close) };
  });

  const topSymptoms = top.map((t) => ({ name: t.name ?? '', count: Number(t.n) }));

  return {
    groups: dashGroups,
    tat: tatRows,
    monthly: monthlyRows,
    granularity: daily ? ('day' as const) : ('month' as const),
    topSymptoms,
  };
}

/* ------------------------------------------------------------------ *
 * Symptom picker data — usage counts (job.product_symptom_id ∪ job_symptom)
 * ------------------------------------------------------------------ */
/** Active symptoms ordered by how often they were used, most common first (5 min memo; a symptom edit drops it). */
export function symptomStats() {
  return cached('master:symptoms:stats', 300_000, async () => {
    // every use of a symptom: the job's main symptom + its extra ones (not counting the main one twice)
    const used = unionAll(
      db
        .select({ sid: job.productSymptomId })
        .from(job)
        .where(and(ne(job.recordStatus, RS.DELETED), gt(job.productSymptomId, 0))),
      db
        .select({ sid: jobSymptom.symptomId })
        .from(jobSymptom)
        .innerJoin(job, eq(job.jobNo, jobSymptom.jobNo))
        .where(and(ne(job.recordStatus, RS.DELETED), ne(jobSymptom.symptomId, job.productSymptomId))),
    ).as('u');
    const rows = await db
      .select({ id: symptom.symptomId, name: symptom.symptomName, grp: symptom.symptomGroupName, n: count(used.sid) })
      .from(symptom)
      .leftJoin(used, eq(used.sid, symptom.symptomId))
      .where(eq(symptom.recordStatus, RS.ACTIVE))
      .groupBy(symptom.symptomId, symptom.symptomName, symptom.symptomGroupName)
      .orderBy(desc(count(used.sid)), asc(symptom.symptomName));
    return rows.map((x) => ({ id: Number(x.id), name: (x.name ?? '').trim(), group: x.grp ?? '', count: Number(x.n) }));
  });
}

/** Top symptoms seen on jobs of one product model (by model_code) — "อาการที่พบบ่อยของรุ่นนี้". */
export async function modelSymptoms(modelCode: string, limit = 5) {
  if (!modelCode) return [];
  const ofModel = and(eq(model.modelCode, modelCode), ne(job.recordStatus, RS.DELETED));
  const used = unionAll(
    db
      .select({ sid: job.productSymptomId })
      .from(job)
      .innerJoin(model, eq(model.modelId, job.productModelId))
      .where(and(ofModel, gt(job.productSymptomId, 0))),
    db
      .select({ sid: jobSymptom.symptomId })
      .from(jobSymptom)
      .innerJoin(job, eq(job.jobNo, jobSymptom.jobNo))
      .innerJoin(model, eq(model.modelId, job.productModelId))
      .where(and(ofModel, ne(jobSymptom.symptomId, job.productSymptomId))),
  ).as('u');
  const rows = await db
    .select({ id: symptom.symptomId, name: symptom.symptomName, n: count() })
    .from(used)
    .innerJoin(symptom, eq(symptom.symptomId, used.sid))
    .where(eq(symptom.recordStatus, RS.ACTIVE))
    .groupBy(symptom.symptomId, symptom.symptomName)
    .orderBy(desc(count()))
    .limit(limit);
  return rows.map((x) => ({ id: Number(x.id), name: (x.name ?? '').trim(), count: Number(x.n) }));
}

export { eq };

/* ------------------------------------------------------------------ *
 * Call log (job_call_log)
 * ------------------------------------------------------------------ */
export async function listCallLogs(jobNo: string) {
  const { jobCallLog } = await import('@/db/schema');
  const rows = await db
    .select({
      id: jobCallLog.jobCallLogId,
      detail: jobCallLog.callLogDescription,
      date: jobCallLog.callLogDate,
      f: appUser.firstName,
      l: appUser.lastName,
    })
    .from(jobCallLog)
    .leftJoin(appUser, eq(appUser.userId, jobCallLog.callLogBy))
    .where(eq(jobCallLog.jobNo, jobNo))
    .orderBy(desc(jobCallLog.callLogDate), desc(jobCallLog.jobCallLogId));
  return rows.map((r) => ({ id: r.id, detail: r.detail ?? '', date: fmtDateTime(r.date), by: fullName(r.f, r.l) }));
}

export async function addCallLog(jobNo: string, detail: string, byUserId: number) {
  const { jobCallLog } = await import('@/db/schema');
  assertValid(callLogSchema, { detail }); // ≤ 200 = the column: a longer note is refused, not cut
  const text = clean(detail);
  await db.transaction(async (tx) => {
    await tx
      .insert(jobCallLog)
      .values({ jobNo, callLogDescription: text, callLogDate: nowThai(), callLogBy: byUserId });
    await audit(tx, byUserId, {
      action: 'CREATE',
      module: 'Job Management',
      entity: 'job',
      key: jobNo,
      summary: `บันทึกการโทร: ${text}`.slice(0, 200),
    });
  });
  return listCallLogs(jobNo);
}

/** Header chips of the job list — counts over the whole table (a GROUP BY over every job, so 30 s memo
 *  like the dashboard; job writes have no cache invalidation, the chips may lag by up to 30 s). */
export function jobStats() {
  return cached('jobs:stats', 30_000, loadJobStats);
}
async function loadJobStats() {
  const rows = await db
    .select({ id: job.jobStatusId, group: jobStatus.jobStatusGroup, n: count() })
    .from(job)
    .leftJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
    .groupBy(job.jobStatusId, jobStatus.jobStatusGroup);
  let total = 0;
  let fresh = 0;
  let done = 0;
  let declined = 0;
  for (const r of rows) {
    if (r.id === JS.CANCELLED) continue; // = DELETED
    const n = Number(r.n);
    total += n;
    if (r.id === JS.NEW) fresh += n;
    else if (r.id === JS.REPAIR_CANCELLED)
      declined += n; // ลูกค้าไม่ซ่อม: neither repaired nor in progress (kpiGroup)
    else if (r.group === 'Finished' || r.group === 'Repaired') done += n;
  }
  return { total, fresh, done, progress: total - fresh - done - declined };
}
