import "server-only";
import { cached, TTL_MASTER } from "@/server/cache";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type Tx } from "@/db/client";
import {
  appUser,
  customer,
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
  symptom,
} from "@/db/schema";
import type { Job } from "@/data/mock";
import { HttpError, fullName, findAppUserByEmail } from "@/server/auth";
import { nextRunningNo } from "@/db/running-no";
import { audit, diff, auditFor, type AuditRow } from "@/server/audit";
import { orderBy, offsetOf, type Page, type PageQuery } from "@/server/paging";
import {
  dateOrNull,
  dateOrSentinel,
  fmtDate,
  fmtDateTime,
  int,
  money,
  nowThai,
  num,
  SENTINEL_TS,
  str,
} from "@/server/mappers/format";
import { getCustomerByCode, getCustomerById } from "./customers";
import { issuingProfile, SHD_PROFILE_ID } from "./document-profiles";
import { adjustQty, listPartRequests, PART, productsByCode } from "./stock";
import { RS, statusStamp } from "@/server/record-status";

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

const REPAIRED_GROUP = "Repaired";
const FINISHED_GROUP = "Finished";

const eng = alias(appUser, "eng");
const opener = alias(appUser, "opener");

/* ------------------------------------------------------------------ *
 * Status helpers (cached name ↔ id)
 * ------------------------------------------------------------------ */
let statusCache: { at: number; rows: { id: number; name: string; group: string; order: number; active: boolean }[] } | null = null;
export async function jobStatuses() {
  if (statusCache && Date.now() - statusCache.at < 300_000) return statusCache.rows;
  const rows = await db.select().from(jobStatus).orderBy(asc(jobStatus.displayOrder), asc(jobStatus.jobStatusId));
  statusCache = {
    at: Date.now(),
    rows: rows.map((r) => ({
      id: r.jobStatusId,
      name: r.jobStatusName?.trim() ?? "",
      group: r.jobStatusGroup?.trim() ?? "",
      order: r.displayOrder ?? 0,
      active: r.isActive !== false,
    })),
  };
  return statusCache.rows;
}

export async function statusIdByName(name: string): Promise<number> {
  const rows = await jobStatuses();
  const hit = rows.find((r) => r.name === name.trim());
  if (!hit) throw new HttpError(400, `ไม่รู้จักสถานะงาน "${name}"`);
  return hit.id;
}

async function statusGroup(id: number) {
  return (await jobStatuses()).find((r) => r.id === id)?.group ?? "";
}

/** Insert a job_log row — call on EVERY status change (legacy invariant). */
export async function logStatus(tx: Tx, jobNo: string, statusId: number, byUserId: number) {
  await tx.insert(jobLog).values({ jobNo, jobStatusId: statusId, jobLogDate: nowThai(), jobActionBy: byUserId });
}

/** Change status + log (no-op when unchanged). Returns true if changed. */
async function setStatus(tx: Tx, jobNo: string, statusId: number, byUserId: number, current?: number | null) {
  if (current === statusId) return false;
  const extra: Partial<typeof job.$inferInsert> = {};
  const group = await statusGroup(statusId);
  if (group === REPAIRED_GROUP) {
    extra.jobRepairedDate = nowThai();
    extra.jobRepairedBy = byUserId;
  }
  if (group === FINISHED_GROUP) {
    extra.jobClosedDate = nowThai();
    extra.jobClosedBy = byUserId;
  }
  await tx.update(job).set({ jobStatusId: statusId, ...extra }).where(eq(job.jobNo, jobNo));
  await logStatus(tx, jobNo, statusId, byUserId);
  const name = (await jobStatuses()).find((r) => r.id === statusId)?.name ?? String(statusId);
  await audit(tx, byUserId, {
    action: "STATUS",
    module: "Job Management",
    entity: "job",
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
  dueDate: job.customerDueDate,
  openerFirst: opener.firstName,
  openerLast: opener.lastName,
  quotationNo: job.quotationNoApproved,
  serviceCost: job.serviceCost,
  partsCost: job.sparePartTotalCost,
};

type ListRow = { [K in keyof typeof listSelect]: (typeof listSelect)[K]["_"]["data"] | null };

function toJob(r: ListRow): Job {
  return {
    no: r.no ?? "",
    openDate: fmtDateTime(r.openDate),
    customer: r.customer?.trim() ?? "",
    so: r.so ?? "",
    brandModel: [r.brand, r.modelName].filter(Boolean).join(" "),
    jobType: r.jobType ?? "",
    owner: fullName(r.engFirst, r.engLast),
    status: r.status?.trim() ?? "",
    imei: r.imei ?? "",
    amount: num(r.amount),
    // extra DB-backed fields (optional on the UI type)
    statusId: r.statusId ?? 0,
    statusGroup: r.statusGroup ?? "",
    customerId: r.customerId ?? 0,
    engineerId: r.engineerId ?? 0,
    isBounce: !!r.isBounce,
    serial: r.serial ?? "",
    channel: r.channel ?? "",
    receptionType: r.receptionType ?? "",
    receptionDate: fmtDate(r.receptionDate),
    warranty: r.warranty ?? "",
    symptom: r.symptom ?? "",
    symptomOther: r.symptomOther ?? "",
    repairDetail: r.repairDetail ?? "",
    repairedDate: fmtDateTime(r.repairedDate),
    closedDate: fmtDateTime(r.closedDate),
    returnType: r.returnType ?? "",
    returnTracking: r.returnTracking ?? "",
    returnDate: fmtDateTime(r.returnDate),
    paymentType: r.paymentType ?? "",
    paymentAmount: num(r.paymentAmount),
    dueDate: fmtDate(r.dueDate),
    openedBy: fullName(r.openerFirst, r.openerLast),
    jobTypeDetail: r.jobTypeDetail ?? "",
    quotationNo: r.quotationNo ?? "",
    serviceCost: num(r.serviceCost),
    partsCost: num(r.partsCost),
    modelDetail: r.modelDetail ?? "",
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
  /** which date column from/to apply to (default create) */
  dateBy?: "create" | "repaired" | "closed";
  symptom?: string; // symptom name (engineer's or customer's)
  returnType?: string;
};

const dateCol = (by?: JobFilters["dateBy"]) => (by === "repaired" ? job.jobRepairedDate : by === "closed" ? job.jobClosedDate : job.jobCreateDate);

export function jobWhere(q: string, f: JobFilters) {
  const term = q.trim();
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
          ilike(job.productModelName, `%${term}%`)
        )
      : undefined,
    f.status ? eq(jobStatus.jobStatusName, f.status) : undefined,
    f.statusId !== undefined ? eq(job.jobStatusId, f.statusId) : undefined,
    f.statusGroup ? eq(jobStatus.jobStatusGroup, f.statusGroup) : undefined,
    f.open ? sql`${jobStatus.jobStatusGroup} not in ('Finished','Cancel')` : undefined,
    f.type ? eq(jobType.jobTypeName, f.type) : undefined,
    f.engineer
      ? /^\d+$/.test(f.engineer)
        ? eq(job.engineerId, Number(f.engineer))
        : sql`trim(coalesce(${eng.firstName},'') || ' ' || coalesce(${eng.lastName},'')) = ${f.engineer}`
      : undefined,
    f.channel ? eq(job.productSaleOutChannel, f.channel) : undefined,
    f.from ? gte(dateCol(f.dateBy), `${f.from} 00:00:00`) : undefined,
    f.to ? lte(dateCol(f.dateBy), `${f.to} 23:59:59`) : undefined,
    f.symptom ? or(eq(symptom.symptomName, f.symptom), sql`exists (select 1 from job_symptom js join symptom s2 on s2.symptom_id = js.symptom_id where js.job_no = ${job.jobNo} and s2.symptom_name = ${f.symptom})`) : undefined,
    f.returnType ? eq(job.returnCustomerType, f.returnType) : undefined,
    f.closedFrom ? gte(job.jobClosedDate, `${f.closedFrom} 00:00:00`) : undefined,
    f.closedTo ? lte(job.jobClosedDate, `${f.closedTo} 23:59:59`) : undefined,
    f.customerCode ? sql`${job.customerDetail} like ${f.customerCode + " %"}` : undefined,
    f.unassigned
      ? and(
          sql`${jobStatus.jobStatusGroup} not in ('Finished','Cancel')`,
          or(eq(job.jobStatusId, JS.NEW), sql`coalesce(${job.engineerId}, 0) <= 0`)
        )
      : undefined,
    f.closable
      ? or(eq(jobStatus.jobStatusGroup, "Repaired"), inArray(job.jobStatusId, [JS.CLOSED_WAIT_TRACKING, JS.CLOSED_WAIT_PICKUP]))
      : undefined
  );
}

export function filtersFromQuery(f: Record<string, string>): JobFilters {
  return {
    status: f.status,
    statusId: f.statusId ? Number(f.statusId) : undefined,
    statusGroup: f.statusGroup,
    open: f.open === "1",
    type: f.type,
    engineer: f.engineer,
    channel: f.channel,
    from: f.from,
    to: f.to,
    closedFrom: f.closedFrom,
    closedTo: f.closedTo,
    customerCode: f.customerCode,
    includeCancelled: f.includeCancelled === "1",
    unassigned: f.unassigned === "1",
    closable: f.closable === "1",
    dateBy: f.dateBy === "repaired" || f.dateBy === "closed" ? f.dateBy : undefined,
    symptom: f.symptom,
    returnType: f.returnType,
  };
}

export async function pageJobs(p: PageQuery, f: JobFilters): Promise<Page<Job>> {
  const where = jobWhere(p.q, f);
  // count + page in parallel: the response takes max(count, rows) instead of their sum
  const [[{ total }], rows] = await Promise.all([
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
  return { rows: rows.map(toJob), total: Number(total), page: p.page, pageSize: p.pageSize };
}

/** Un-paged list for reports (server-filtered, capped). */
export async function listJobs(f: JobFilters & { q?: string; limit?: number } = {}): Promise<Job[]> {
  const rows = await baseQuery()
    .where(jobWhere(f.q ?? "", f))
    .orderBy(desc(job.jobCreateDate), desc(job.jobNo))
    .limit(Math.min(f.limit ?? 5000, 20000));
  return rows.map(toJob);
}

/** Small helper for dropdowns: recent open job numbers. */
export async function recentJobNos(limit = 50): Promise<string[]> {
  const rows = await db
    .select({ no: job.jobNo })
    .from(job)
    .leftJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
    .where(sql`${jobStatus.jobStatusGroup} not in ('Finished','Cancel')`)
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
  dueDate: string;
  engineerId: number;
  engineer: string;
  engineerSymptomId: number;
  engineerSymptom: string;
  repairDetail: string;
  engineerRemark: string;
  repairedDate: string;
  closedDate: string;
  payment: { type: string; no: string; amount: number; detail: string; slip: string };
  return: { date: string; type: string; tracking: string; detail: string };
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
    receiveDate: string;
    receiveBy: string;
    receiveDetail: string;
    status: string;
  }[];
  parts: Awaited<ReturnType<typeof listPartRequests>>;
  attachments: { id: number; name: string; file: string; remark: string }[];
  logs: { statusId: number; status: string; date: string; by: string }[];
  /** audit_log entries for this job (newest first) — ประวัติการแก้ไข */
  history: AuditRow[];
};

export async function getJob(jobNo: string): Promise<JobDetail | null> {
  const engSym = alias(symptom, "eng_sym");
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

  const [cust, syms, fwd, parts, atts, logs, history] = await Promise.all([
    j.customerId ? getCustomerById(j.customerId) : Promise.resolve(null),
    db
      .select({ id: jobSymptom.symptomId, name: symptom.symptomName })
      .from(jobSymptom)
      .leftJoin(symptom, eq(symptom.symptomId, jobSymptom.symptomId))
      .where(eq(jobSymptom.jobNo, jobNo)),
    (async () => {
      const sendBy = alias(appUser, "send_by");
      const recvBy = alias(appUser, "recv_by");
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
      .where(and(eq(documentAttach.referenceTopic, "Jobs"), eq(documentAttach.referenceItemCode, jobNo), ne(documentAttach.recordStatus, RS.DELETED)))
      .orderBy(asc(documentAttach.documentAttachId)),
    db
      .select({ statusId: jobLog.jobStatusId, status: jobStatus.jobStatusName, date: jobLog.jobLogDate, f: appUser.firstName, l: appUser.lastName })
      .from(jobLog)
      .leftJoin(jobStatus, eq(jobStatus.jobStatusId, jobLog.jobStatusId))
      .leftJoin(appUser, eq(appUser.userId, jobLog.jobActionBy))
      .where(eq(jobLog.jobNo, jobNo))
      .orderBy(desc(jobLog.jobLogDate), desc(jobLog.jobLogId)), // newest first, like call log / audit
    auditFor("job", jobNo, 100),
  ]);

  const symptomIds = syms.length ? syms.map((s) => s.id) : j.productSymptomId && j.productSymptomId > 0 ? [j.productSymptomId] : [];
  const symptoms = syms.length ? syms.map((s) => s.name ?? "").filter(Boolean) : r.symptomName ? [r.symptomName] : [];

  return {
    no: j.jobNo,
    documentProfileId: j.documentProfileId ?? SHD_PROFILE_ID,
    statusId: j.jobStatusId ?? 0,
    status: r.status?.trim() ?? "",
    statusGroup: r.statusGroup ?? "",
    createDate: fmtDateTime(j.jobCreateDate),
    createBy: j.jobCreateBy ?? 0,
    createByName: fullName(r.openerFirst, r.openerLast),
    jobTypeId: j.jobTypeId ?? 0,
    jobType: r.jobType ?? "",
    jobTypeDetail: j.jobTypeDetail ?? "",
    customer: cust
      ? { id: cust.id ?? 0, code: cust.code, name: cust.name, taxId: cust.taxId, address: cust.address, phone: cust.phone, line: cust.line, email: cust.email }
      : null,
    customerDetail: j.customerDetail ?? "",
    so: j.jobReferenceNo ?? "",
    channel: j.productSaleOutChannel ?? "",
    shopName: j.productSaleOutShopName ?? "",
    saleOrderDate: fmtDate(j.productSaleOrderDate),
    warrantyMonth: j.productWarrantyMonth ?? 0,
    expireDate: fmtDate(j.productExpireDate),
    warranty: j.productWarranty ?? "",
    productTypeId: j.productTypeId ?? 0,
    productType: r.productType ?? "",
    imei: j.productImeiNo ?? "",
    serial: j.productSerial ?? "",
    brandId: j.productBrandId ?? 0,
    brand: r.brand ?? "",
    modelId: j.productModelId ?? 0,
    modelCode: r.modelCode ?? "",
    modelName: j.productModelName ?? "",
    modelDetail: j.productModelDetail ?? "",
    color: j.productColor ?? "",
    receptionDate: fmtDate(j.jobReceptionDate),
    receptionTrackingNo: j.jobReceptionTrackingNo ?? "",
    receptionShipper: j.jobReceptionShipper ?? "",
    receptionType: j.jobReceptionType ?? "",
    equipment: j.productEquipment ?? "",
    fault: j.productFault ?? "",
    symptomIds,
    symptoms,
    symptomOther: j.productSymptomOther ?? "",
    remark: j.jobRemark ?? "",
    estimateCost: num(j.estimateCost),
    depositCost: num(j.depositCost),
    partsCost: num(j.sparePartTotalCost),
    serviceCost: num(j.serviceCost),
    toolCost: num(j.serviceToolCost),
    deliveryCost: num(j.deliveryCost),
    boxCost: num(j.cartonBoxCost),
    totalCost: num(j.jobTotalCost),
    dueDate: fmtDate(j.customerDueDate),
    engineerId: j.engineerId ?? 0,
    engineer: fullName(r.engFirst, r.engLast),
    engineerSymptomId: j.engineerSymptomId ?? 0,
    engineerSymptom: r.engSymptom ?? "",
    repairDetail: j.engineerRepairDetail ?? "",
    engineerRemark: j.engineerRemark ?? "",
    repairedDate: fmtDateTime(j.jobRepairedDate),
    closedDate: fmtDateTime(j.jobClosedDate),
    payment: {
      type: j.jobPaymentType ?? "",
      no: j.jobPaymentNo ?? "",
      amount: num(j.jobPaymentAmount),
      detail: j.jobPaymentDetail ?? "",
      slip: j.jobPaymentSlipFileName ?? "",
    },
    return: {
      date: fmtDateTime(j.jobReturnDate),
      type: j.returnCustomerType ?? "",
      tracking: j.returnCustomerTrackingNo ?? "",
      detail: j.returnCustomerDetail ?? "",
    },
    swap: { detail: j.swapRefundDetail ?? "", docNo: j.swapRefundDocumentNo ?? "" },
    quotationNo: j.quotationNoApproved ?? "",
    isBounce: !!j.isJobBounce,
    gspnNo: j.jobReferenceNoGspn ?? "",
    outsource: fwd.map((x) => ({
      id: x.f.id,
      sendTo: x.f.sendToName ?? "",
      sendDetail: x.f.sendDetail ?? "",
      sendDate: fmtDate(x.f.sendDate),
      sendBy: fullName(x.sf, x.sl),
      receiveDate: fmtDate(x.f.receiveDate),
      receiveBy: fullName(x.rf, x.rl),
      receiveDetail: x.f.receiveDetail ?? "",
      status: x.f.sendStatus ?? "",
    })),
    parts,
    attachments: atts.map((a) => ({ id: a.documentAttachId, name: a.originalFileName ?? "", file: a.systemFileName ?? "", remark: a.remark ?? "" })),
    logs: logs.map((l) => ({ statusId: l.statusId ?? 0, status: l.status?.trim() ?? "", date: fmtDateTime(l.date), by: fullName(l.f, l.l) })),
    history,
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
};

/**
 * job.engineer_id must point at app_user. When the form only knows a directory
 * person (email + name), find that person in app_user or create a pending row
 * so the assignment is kept (they get their role when an admin approves).
 */
async function resolveEngineer(i: { engineerId?: number | string; engineerEmail?: string; engineerName?: string }): Promise<number> {
  const id = int(i.engineerId, 0);
  if (id > 0) return id;
  const email = str(i.engineerEmail).toLowerCase();
  if (!email) return 0;
  const found = await findAppUserByEmail(email);
  if (found) return found.userId;
  const name = str(i.engineerName) || email.split("@")[0];
  const [first, ...rest] = name.split(/\s+/);
  const [row] = await db
    .insert(appUser)
    .values({ username: email.split("@")[0].slice(0, 50), password: "", firstName: first.slice(0, 50), lastName: rest.join(" ").slice(0, 50), userType: null, isActive: true, emailAddress: email })
    .returning({ id: appUser.userId });
  return row.id;
}

async function lookups(i: JobInput) {
  const [jt] = i.jobType ? await db.select({ id: jobType.jobTypeId }).from(jobType).where(eq(jobType.jobTypeName, i.jobType)).limit(1) : [];
  const [pt] = i.productType ? await db.select({ id: productType.productTypeId }).from(productType).where(eq(productType.productTypeName, i.productType)).limit(1) : [];
  const [mf] = i.brand ? await db.select({ id: manufacturer.manufacturerId }).from(manufacturer).where(eq(manufacturer.manufacturerName, i.brand)).limit(1) : [];
  const [md] = i.modelCode
    ? await db.select({ id: model.modelId, name: model.modelName, mfg: model.manufacturerId }).from(model).where(eq(model.modelCode, i.modelCode)).limit(1)
    : [];
  const names = (i.symptoms ?? []).map((s) => str(s)).filter(Boolean);
  const syms = names.length ? await db.select({ id: symptom.symptomId, name: symptom.symptomName }).from(symptom).where(inArray(symptom.symptomName, names)) : [];
  const symIds = names.map((n) => syms.find((s) => s.name === n)?.id).filter((x): x is number => !!x);
  return { jobTypeId: jt?.id, productTypeId: pt?.id, brandId: mf?.id ?? md?.mfg ?? null, modelId: md?.id, modelName: md?.name, symIds };
}

function costFields(i: JobInput) {
  const service = num(i.serviceCost);
  const tool = num(i.toolCost);
  const delivery = num(i.deliveryCost);
  const box = num(i.boxCost);
  return { service, tool, delivery, box };
}

async function writeSymptoms(tx: Tx, jobNo: string, ids: number[]) {
  await tx.delete(jobSymptom).where(eq(jobSymptom.jobNo, jobNo));
  if (ids.length) await tx.insert(jobSymptom).values(ids.map((symptomId) => ({ jobNo, symptomId })));
}

export async function createJob(i: JobInput, byUserId: number): Promise<JobDetail> {
  const cust = await getCustomerByCode(str(i.customerCode));
  if (!cust) throw new HttpError(400, "ต้องเลือกลูกค้าก่อนเปิดงาน");
  const lk = await lookups(i);
  if (!lk.jobTypeId) throw new HttpError(400, "ต้องเลือกประเภทงานหลัก");
  const c = costFields(i);
  const now = nowThai();
  const engineerId = await resolveEngineer(i);
  const profile = await issuingProfile(i.documentProfileId);

  const jobNo = await db.transaction(async (tx) => {
    const no = await nextRunningNo(tx, "Job", { id: profile.id, prefix: profile.prefixJob });
    await tx.insert(job).values({
      jobNo: no,
      documentProfileId: profile.id,
      companyId: profile.id,
      branchId: 1,
      customerId: cust.id,
      customerDetail: `${cust.code} ${cust.name} ${cust.phone}`.trim().slice(0, 200),
      customerDueDate: dateOrSentinel(i.dueDate),
      jobCreateDate: now,
      jobCreateBy: byUserId,
      jobTypeId: lk.jobTypeId,
      jobTypeDetail: str(i.jobTypeDetail).slice(0, 50),
      jobStatusId: JS.NEW,
      jobRepairedDate: SENTINEL_TS,
      jobRepairedBy: 0,
      jobClosedDate: SENTINEL_TS,
      jobClosedBy: 0,
      productImeiNo: str(i.imei).slice(0, 50),
      productSerial: str(i.serial).slice(0, 50),
      productTypeId: lk.productTypeId ?? 0,
      productBrandId: lk.brandId ?? 0,
      productModelId: lk.modelId ?? 0,
      productModelName: (lk.modelName ?? str(i.modelCode)).slice(0, 50),
      productModelDetail: str(i.modelDetail).slice(0, 200),
      productColor: str(i.color).slice(0, 50),
      productSymptomId: lk.symIds[0] ?? 0,
      productSymptomOther: str(i.symptomOther).slice(0, 200),
      productEquipment: str(i.equipment).slice(0, 100),
      productFault: str(i.fault).slice(0, 100),
      estimateCost: money(num(i.estimateCost)),
      depositCost: money(num(i.depositCost)),
      sparePartTotalCost: "0.00",
      serviceCost: money(c.service),
      serviceToolCost: money(c.tool),
      deliveryCost: money(c.delivery),
      cartonBoxCost: money(c.box),
      jobTotalCost: money(c.service + c.tool + c.delivery + c.box),
      jobReferenceNo: str(i.so).slice(0, 50),
      jobReferenceNoGspn: "",
      jobGspnCreateDate: SENTINEL_TS,
      jobRemark: str(i.remark),
      engineerId,
      engineerSymptomId: 0,
      engineerRepairDetail: "",
      engineerRemark: "",
      jobPaymentType: "",
      jobPaymentNo: "",
      jobPaymentAmount: "0.00",
      jobPaymentDetail: "",
      jobReturnDate: SENTINEL_TS,
      returnCustomerType: "",
      returnCustomerTrackingNo: "",
      returnCustomerDetail: "",
      jobReturnBy: 0,
      sparePartReplace: "",
      productWarranty: str(i.warranty).slice(0, 50),
      quotationNoApproved: "",
      productSaleOutChannel: str(i.channel).slice(0, 50) || "ยังไม่ระบุ",
      productSaleOrderDate: dateOrNull(i.saleOrderDate),
      productWarrantyMonth: int(i.warrantyMonth, 0),
      productExpireDate: dateOrNull(i.expireDate),
      jobReceptionType: str(i.receptionType).slice(0, 50) || "ไม่ระบุ",
      jobReceptionDate: dateOrNull(i.receptionDate) ?? now.slice(0, 10),
      jobReceptionTrackingNo: str(i.receptionTrackingNo).slice(0, 50),
      jobReceptionShipper: str(i.receptionShipper).slice(0, 50),
      swapRefundDetail: "",
      jobPaymentSlipFileName: "",
      swapRefundDocumentNo: "",
      isJobBounce: !!i.isBounce,
      productSaleOutShopName: str(i.shopName).slice(0, 100),
    });
    await logStatus(tx, no, JS.NEW, byUserId);
    await writeSymptoms(tx, no, lk.symIds);
    await audit(tx, byUserId, {
      action: "CREATE",
      module: "Job Management",
      entity: "job",
      key: no,
      summary: `เปิดงานใหม่ · ${cust.code} ${cust.name} · ${str(i.brand)} ${str(i.modelCode)}`.trim(),
    });
    if (engineerId > 0) await setStatus(tx, no, JS.IN_PROGRESS, byUserId, JS.NEW);
    return no;
  });
  return (await getJob(jobNo))!;
}

export async function updateJob(jobNo: string, i: JobInput, byUserId: number): Promise<JobDetail> {
  const [cur] = await db.select({ status: job.jobStatusId, custId: job.customerId }).from(job).where(eq(job.jobNo, jobNo));
  if (!cur) throw new HttpError(404, "ไม่พบหมายเลขงาน " + jobNo);
  const cust = i.customerCode ? await getCustomerByCode(str(i.customerCode)) : null;
  const lk = await lookups(i);
  const c = costFields(i);
  const newStatus = i.status ? await statusIdByName(i.status) : undefined;
  const engineerId = i.engineerId !== undefined || i.engineerEmail ? await resolveEngineer(i) : undefined;

  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(job).where(eq(job.jobNo, jobNo));
    const parts = num(existing?.sparePartTotalCost);
    const values = {
        ...(cust ? { customerId: cust.id, customerDetail: `${cust.code} ${cust.name} ${cust.phone}`.trim().slice(0, 200) } : {}),
        customerDueDate: dateOrSentinel(i.dueDate),
        ...(lk.jobTypeId ? { jobTypeId: lk.jobTypeId } : {}),
        jobTypeDetail: str(i.jobTypeDetail).slice(0, 50),
        productImeiNo: str(i.imei).slice(0, 50),
        productSerial: str(i.serial).slice(0, 50),
        ...(lk.productTypeId ? { productTypeId: lk.productTypeId } : {}),
        ...(lk.brandId ? { productBrandId: lk.brandId } : {}),
        ...(lk.modelId ? { productModelId: lk.modelId, productModelName: (lk.modelName ?? "").slice(0, 50) } : {}),
        productModelDetail: str(i.modelDetail).slice(0, 200),
        productColor: str(i.color).slice(0, 50),
        ...(lk.symIds.length ? { productSymptomId: lk.symIds[0] } : {}),
        productSymptomOther: str(i.symptomOther).slice(0, 200),
        productEquipment: str(i.equipment).slice(0, 100),
        productFault: str(i.fault).slice(0, 100),
        estimateCost: money(num(i.estimateCost)),
        depositCost: money(num(i.depositCost)),
        serviceCost: money(c.service),
        serviceToolCost: money(c.tool),
        deliveryCost: money(c.delivery),
        cartonBoxCost: money(c.box),
        jobTotalCost: money(parts + c.service + c.tool + c.delivery + c.box),
        jobReferenceNo: str(i.so).slice(0, 50),
        jobRemark: str(i.remark),
        ...(engineerId !== undefined ? { engineerId } : {}),
        productWarranty: str(i.warranty).slice(0, 50),
        productSaleOutChannel: str(i.channel).slice(0, 50) || "ยังไม่ระบุ",
        productSaleOrderDate: dateOrNull(i.saleOrderDate),
        productWarrantyMonth: int(i.warrantyMonth, 0),
        productExpireDate: dateOrNull(i.expireDate),
        jobReceptionType: str(i.receptionType).slice(0, 50) || "ไม่ระบุ",
        jobReceptionDate: dateOrNull(i.receptionDate),
        jobReceptionTrackingNo: str(i.receptionTrackingNo).slice(0, 50),
        jobReceptionShipper: str(i.receptionShipper).slice(0, 50),
        productSaleOutShopName: str(i.shopName).slice(0, 100),
        ...(i.isBounce !== undefined ? { isJobBounce: !!i.isBounce } : {}),
      };
    await tx.update(job).set(values).where(eq(job.jobNo, jobNo));
    await audit(tx, byUserId, {
      action: "UPDATE",
      module: "Job Management",
      entity: "job",
      key: jobNo,
      summary: "แก้ไขข้อมูลงาน",
      changes: diff(existing as Record<string, unknown>, values as Record<string, unknown>),
    });
    if (lk.symIds.length || (i.symptoms && i.symptoms.length === 0)) await writeSymptoms(tx, jobNo, lk.symIds);
    if (newStatus !== undefined) await setStatus(tx, jobNo, newStatus, byUserId, cur.status);
  });
  return (await getJob(jobNo))!;
}

/* ------------------------------------------------------------------ *
 * Assign (จนท.รับมอบหมายงาน)
 * ------------------------------------------------------------------ */
export async function assignJobs(jobNos: string[], engineerId: number, byUserId: number): Promise<number> {
  if (!jobNos.length) throw new HttpError(400, "ยังไม่ได้เลือกงาน");
  if (!engineerId) throw new HttpError(400, "ต้องเลือกช่าง");
  let n = 0;
  await db.transaction(async (tx) => {
    const rows = await tx.select({ no: job.jobNo, status: job.jobStatusId }).from(job).where(inArray(job.jobNo, jobNos));
    for (const r of rows) {
      await tx.update(job).set({ engineerId }).where(eq(job.jobNo, r.no));
      await audit(tx, byUserId, {
        action: "ASSIGN",
        module: "Job Assign",
        entity: "job",
        key: r.no,
        summary: `มอบหมายงานให้ช่าง #${engineerId}`,
        changes: { engineerId: [null, engineerId] },
      });
      if (r.status === JS.NEW) await setStatus(tx, r.no, JS.IN_PROGRESS, byUserId, r.status);
      n++;
    }
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
 * Column mapping inferred from the dump: request_qty / is_quotation / is_special
 * (+ the *_b twins) — is_quotation = "เสนอ" (charged), is_special = "เบิก"
 * (requested from stock; booking += qty until the store issues it).
 */
export async function saveRepair(jobNo: string, i: RepairInput, byUserId: number): Promise<JobDetail> {
  const [cur] = await db.select({ status: job.jobStatusId, eng: job.engineerId }).from(job).where(eq(job.jobNo, jobNo));
  if (!cur) throw new HttpError(404, "ไม่พบหมายเลขงาน " + jobNo);
  const [es] = i.engineerSymptom
    ? await db.select({ id: symptom.symptomId }).from(symptom).where(eq(symptom.symptomName, i.engineerSymptom)).limit(1)
    : [];
  const newStatus = i.status ? await statusIdByName(i.status) : undefined;
  let newRequests = false;

  await db.transaction(async (tx) => {
    let partsTotal = 0;
    if (i.parts) {
      const existing = await tx.select().from(jobOrderSparePartLog).where(eq(jobOrderSparePartLog.jobNo, jobNo)).for("update");
      const keep = new Set(i.parts.map((p) => p.logId).filter((x): x is number => !!x));
      const codes = i.parts.map((p) => str(p.code)).filter(Boolean);
      const map = await productsByCode(tx, codes);

      // rows removed in the UI: cancel while still pending (nothing issued yet)
      for (const e of existing) {
        if (e.orderStatusId === PART.REQUESTED && (e.grantQty ?? 0) === 0 && !keep.has(e.jobOrderLogId)) {
          await tx.update(jobOrderSparePartLog).set({ orderStatusId: PART.CANCELLED }).where(eq(jobOrderSparePartLog.jobOrderLogId, e.jobOrderLogId));
          const pm = await productsByCode(tx, [e.sparePartCode ?? ""]);
          const prod = pm.get(e.sparePartCode ?? "");
          if (prod && e.isSpecial) await adjustQty(tx, prod.id, { booking: -(e.requestQty ?? 0) }, { allowNegative: true });
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
          if (e.orderStatusId === PART.REQUESTED && (e.grantQty ?? 0) === 0) {
            // still editable: re-book the delta
            const before = e.isSpecial ? (e.requestQty ?? 0) : 0;
            const after = values.isSpecial ? values.requestQty : 0;
            if (prod && after !== before) await adjustQty(tx, prod.id, { booking: after - before }, { allowNegative: true });
            await tx.update(jobOrderSparePartLog).set(values).where(eq(jobOrderSparePartLog.jobOrderLogId, p.logId));
            partsTotal += useA ? totalA : 0;
          } else {
            partsTotal += num(e.sparePartTotalPrice);
          }
          continue;
        }
        if (!useA && !useB) continue;
        if (!prod) throw new HttpError(400, `ไม่พบรหัสอะไหล่ ${p.code}`);
        if (values.isSpecial) await adjustQty(tx, prod.id, { booking: values.requestQty }, { allowNegative: true });
        await tx.insert(jobOrderSparePartLog).values({
          jobNo,
          sparePartCode: str(p.code),
          sparePartSerialNo: "",
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
      const [sum] = await tx
        .select({ s: sql<string>`coalesce(sum(spare_part_total_price),0)` })
        .from(jobOrderSparePartLog)
        .where(and(eq(jobOrderSparePartLog.jobNo, jobNo), ne(jobOrderSparePartLog.orderStatusId, PART.CANCELLED)));
      partsTotal = num(sum?.s);
    }

    // ---- job fields ----
    const [j] = await tx.select().from(job).where(eq(job.jobNo, jobNo));
    const service = i.serviceCost !== undefined ? num(i.serviceCost) : num(j.serviceCost);
    const tool = i.toolCost !== undefined ? num(i.toolCost) : num(j.serviceToolCost);
    const delivery = i.deliveryCost !== undefined ? num(i.deliveryCost) : num(j.deliveryCost);
    const box = i.boxCost !== undefined ? num(i.boxCost) : num(j.cartonBoxCost);
    const repairValues = {
        ...(es ? { engineerSymptomId: es.id } : {}),
        ...(i.repairDetail !== undefined ? { engineerRepairDetail: str(i.repairDetail).slice(0, 200) } : {}),
        ...(i.engineerRemark !== undefined ? { engineerRemark: str(i.engineerRemark).slice(0, 200) } : {}),
        ...(i.newSerial ? { sparePartReplace: `New S/N: ${str(i.newSerial)}`.slice(0, 300) } : {}),
        engineerId: cur.eng && cur.eng > 0 ? cur.eng : byUserId,
        sparePartTotalCost: money(partsTotal),
        serviceCost: money(service),
        serviceToolCost: money(tool),
        deliveryCost: money(delivery),
        cartonBoxCost: money(box),
        jobTotalCost: money(partsTotal + service + tool + delivery + box),
      };
    await tx.update(job).set(repairValues).where(eq(job.jobNo, jobNo));
    await audit(tx, byUserId, {
      action: "UPDATE",
      module: "Job Repair",
      entity: "job",
      key: jobNo,
      summary: `บันทึกงานซ่อม${i.parts ? ` · อะไหล่ ${i.parts.length} รายการ` : ""}`,
      changes: diff(j as unknown as Record<string, unknown>, repairValues as Record<string, unknown>),
    });

    // ---- status: explicit choice wins; new stock requests move a new/in-progress job to 11 ----
    let target = newStatus;
    if (target === undefined && newRequests && (cur.status === JS.NEW || cur.status === JS.IN_PROGRESS)) target = JS.PARTS_REQUESTED;
    if (target !== undefined) await setStatus(tx, jobNo, target, byUserId, cur.status);
  });
  return (await getJob(jobNo))!;
}

/** Called by stock after issuing all pending requests of a job. */
export async function markPartsIssued(jobNo: string, byUserId: number) {
  await db.transaction(async (tx) => {
    const [cur] = await tx.select({ status: job.jobStatusId }).from(job).where(eq(job.jobNo, jobNo));
    if (cur && cur.status === JS.PARTS_REQUESTED) await setStatus(tx, jobNo, JS.PARTS_ISSUED, byUserId, cur.status);
  });
}

/* ------------------------------------------------------------------ *
 * Outsource (บันทึกงานส่งซ่อมต่อ)
 * ------------------------------------------------------------------ */
export type OutsourceInput = {
  engineerSymptom?: string;
  symptomOther?: string;
  repairDetail?: string;
  send?: { to: string; date?: string; detail?: string };
  receive?: { from?: string; date?: string; detail?: string };
  status?: string;
};

export async function saveOutsource(jobNo: string, i: OutsourceInput, byUserId: number): Promise<JobDetail> {
  const [cur] = await db.select({ status: job.jobStatusId }).from(job).where(eq(job.jobNo, jobNo));
  if (!cur) throw new HttpError(404, "ไม่พบหมายเลขงาน " + jobNo);
  const [es] = i.engineerSymptom
    ? await db.select({ id: symptom.symptomId }).from(symptom).where(eq(symptom.symptomName, i.engineerSymptom)).limit(1)
    : [];
  const newStatus = i.status ? await statusIdByName(i.status) : undefined;

  await db.transaction(async (tx) => {
    const fields = {
      ...(es ? { engineerSymptomId: es.id } : {}),
      ...(i.symptomOther !== undefined ? { productSymptomOther: str(i.symptomOther).slice(0, 200) } : {}),
      ...(i.repairDetail !== undefined ? { engineerRepairDetail: str(i.repairDetail).slice(0, 200) } : {}),
    };
    if (Object.keys(fields).length) await tx.update(job).set(fields).where(eq(job.jobNo, jobNo));
    await audit(tx, byUserId, {
      action: "UPDATE",
      module: "Job Repair",
      entity: "job",
      key: jobNo,
      summary: i.send ? `ส่งซ่อมต่อ → ${str(i.send.to)}` : i.receive ? `รับคืนจาก Out-Source (${str(i.receive.from)})` : "บันทึกงานส่งซ่อมต่อ",
      changes: diff(null, { ...fields, ...(i.send ? { sendTo: str(i.send.to), sendDate: str(i.send.date) } : {}), ...(i.receive ? { receiveFrom: str(i.receive.from), receiveDate: str(i.receive.date) } : {}) }),
    });

    let target = newStatus;
    const open = await tx
      .select()
      .from(jobSendForwardDt)
      .where(and(eq(jobSendForwardDt.jobNo, jobNo), eq(jobSendForwardDt.sendStatus, "ส่งเครื่องซ่อมแล้ว")))
      .orderBy(desc(jobSendForwardDt.id))
      .limit(1);

    if (i.receive && (i.receive.date || i.receive.detail) && open[0]) {
      await tx
        .update(jobSendForwardDt)
        .set({
          receiveDate: dateOrSentinel(i.receive.date ?? nowThai()),
          receiveBy: byUserId,
          receiveDetail: str(i.receive.detail).slice(0, 100),
          sendStatus: "รับเครื่องซ่อมแล้ว",
        })
        .where(eq(jobSendForwardDt.id, open[0].id));
      target ??= JS.OUTSOURCE_RECEIVED;
    } else if (i.send?.to) {
      if (open[0]) {
        await tx
          .update(jobSendForwardDt)
          .set({ sendToName: str(i.send.to).slice(0, 50), sendDetail: str(i.send.detail).slice(0, 100), sendDate: dateOrSentinel(i.send.date ?? nowThai()) })
          .where(eq(jobSendForwardDt.id, open[0].id));
      } else {
        await tx.insert(jobSendForwardDt).values({
          jobNo,
          sendToName: str(i.send.to).slice(0, 50),
          sendDetail: str(i.send.detail).slice(0, 100),
          sendDate: dateOrSentinel(i.send.date ?? nowThai()),
          sendBy: byUserId,
          receiveDate: SENTINEL_TS,
          receiveBy: -1,
          receiveDetail: "",
          sendStatus: "ส่งเครื่องซ่อมแล้ว",
        });
      }
      target ??= JS.OUTSOURCE_SENT;
    }
    if (target !== undefined) await setStatus(tx, jobNo, target, byUserId, cur.status);
  });
  return (await getJob(jobNo))!;
}

/** Distinct outsource vendors seen in the data (for the dropdown). */
export function listOutsourceVendors(): Promise<string[]> {
  return cached("jobs:vendors", 5 * TTL_MASTER, loadOutsourceVendors);
}
async function loadOutsourceVendors(): Promise<string[]> {
  const rows = await db
    .select({ name: jobSendForwardDt.sendToName, n: count() })
    .from(jobSendForwardDt)
    .groupBy(jobSendForwardDt.sendToName)
    .orderBy(desc(count()));
  return rows.map((r) => r.name?.trim() ?? "").filter(Boolean);
}

/** งานย่อย (job.job_type_detail) — every value the legacy data uses, most common first. */
export function listJobTypeDetails(): Promise<string[]> {
  return cached("jobs:type_details", 5 * TTL_MASTER, loadJobTypeDetails);
}
async function loadJobTypeDetails(): Promise<string[]> {
  const rows = await db
    .select({ v: job.jobTypeDetail, n: count() })
    .from(job)
    .where(sql`coalesce(${job.jobTypeDetail},'') <> ''`)
    .groupBy(job.jobTypeDetail)
    .orderBy(desc(count()));
  return rows.map((r) => r.v?.trim() ?? "").filter(Boolean);
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
  return rows.map((r) => r.v?.trim() ?? "").filter(Boolean);
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
  const [cur] = await db.select({ status: job.jobStatusId }).from(job).where(eq(job.jobNo, jobNo));
  if (!cur) throw new HttpError(404, "ไม่พบหมายเลขงาน " + jobNo);
  const newStatus = i.status ? await statusIdByName(i.status) : undefined;
  const lines = [
    i.newSerial ? `New S/N: ${str(i.newSerial)}` : "",
    i.newModel ? `รุ่นที่เปลี่ยนให้: ${str(i.newModel)}` : "",
    i.swapDate ? `วันที่เปลี่ยนเครื่อง: ${str(i.swapDate)}` : "",
    num(i.refundAmount) > 0 ? `ยอดเงินคืน: ${num(i.refundAmount).toFixed(2)}` : "",
    i.refundMethod ? `วิธีการคืนเงิน: ${str(i.refundMethod)}` : "",
    i.refundRef ? `เลขที่บัญชี/อ้างอิง: ${str(i.refundRef)}` : "",
    i.refundDate ? `วันที่คืนเงิน: ${str(i.refundDate)}` : "",
    i.detail ? `รายละเอียด: ${str(i.detail)}` : "",
  ].filter(Boolean);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(job).where(eq(job.jobNo, jobNo));
    const swapValues = {
        ...(i.inspection !== undefined ? { engineerRepairDetail: str(i.inspection).slice(0, 200) } : {}),
        swapRefundDetail: lines.join("\n"),
        swapRefundDocumentNo: str(i.docNo).slice(0, 100),
        ...(i.newSerial ? { sparePartReplace: `New S/N: ${str(i.newSerial)}`.slice(0, 300) } : {}),
        ...(num(i.refundAmount) > 0
          ? {
              jobPaymentType: str(i.refundMethod).slice(0, 50),
              jobPaymentNo: str(i.refundRef).slice(0, 50),
              jobPaymentAmount: money(-Math.abs(num(i.refundAmount))),
              jobPaymentDetail: `Refund ${str(i.refundDate)}`.slice(0, 100),
            }
          : {}),
      };
    await tx.update(job).set(swapValues).where(eq(job.jobNo, jobNo));
    await audit(tx, byUserId, {
      action: "UPDATE",
      module: "Job Management",
      entity: "job",
      key: jobNo,
      summary: num(i.refundAmount) > 0 ? `บันทึก Refund ${num(i.refundAmount).toFixed(2)} บาท` : "บันทึก Swap / เปลี่ยนเครื่อง",
      changes: diff(before as Record<string, unknown>, swapValues as Record<string, unknown>),
    });
    if (newStatus !== undefined) await setStatus(tx, jobNo, newStatus, byUserId, cur.status);
  });
  return (await getJob(jobNo))!;
}

/* ------------------------------------------------------------------ *
 * Close (ปิดงาน-ส่งคืนสินค้า)
 * ------------------------------------------------------------------ */
export type CloseInput = {
  repairDetail?: string;
  payment?: { type?: string; amount?: number | string; date?: string; no?: string; detail?: string };
  return?: { type?: string; date?: string; courier?: string; tracking?: string; detail?: string };
  status: string;
};

export async function closeJob(jobNo: string, i: CloseInput, byUserId: number): Promise<JobDetail> {
  const [cur] = await db.select({ status: job.jobStatusId }).from(job).where(eq(job.jobNo, jobNo));
  if (!cur) throw new HttpError(404, "ไม่พบหมายเลขงาน " + jobNo);
  const newStatus = await statusIdByName(i.status);
  await db.transaction(async (tx) => {
    const pay = i.payment ?? {};
    const ret = i.return ?? {};
    const fields = {
        ...(i.repairDetail !== undefined ? { engineerRepairDetail: str(i.repairDetail).slice(0, 200) } : {}),
        ...(pay.type || num(pay.amount) > 0
          ? {
              jobPaymentType: str(pay.type).slice(0, 50),
              jobPaymentNo: str(pay.no).slice(0, 50),
              jobPaymentAmount: money(num(pay.amount)),
              jobPaymentDetail: [pay.date ? `ชำระ ${str(pay.date)}` : "", str(pay.detail)].filter(Boolean).join(" · ").slice(0, 100),
            }
          : {}),
        ...(ret.type || ret.tracking || ret.date
          ? {
              jobReturnDate: dateOrSentinel(ret.date ?? nowThai()),
              returnCustomerType: str(ret.type).slice(0, 50),
              returnCustomerTrackingNo: str(ret.tracking).slice(0, 50),
              returnCustomerDetail: [str(ret.courier), str(ret.detail)].filter(Boolean).join(" · ").slice(0, 100),
              jobReturnBy: byUserId,
            }
          : {}),
    };
    const [before] = await tx.select().from(job).where(eq(job.jobNo, jobNo));
    if (Object.keys(fields).length) await tx.update(job).set(fields).where(eq(job.jobNo, jobNo));
    await audit(tx, byUserId, {
      action: "UPDATE",
      module: "Job Closing",
      entity: "job",
      key: jobNo,
      summary: "บันทึกปิดงาน / ส่งคืนสินค้า",
      changes: diff(before as Record<string, unknown>, fields as Record<string, unknown>),
    });
    await setStatus(tx, jobNo, newStatus, byUserId, cur.status);
  });
  return (await getJob(jobNo))!;
}

/* ------------------------------------------------------------------ *
 * Attachments (document_attach) — files live in Supabase Storage
 * ------------------------------------------------------------------ */
export async function addAttachment(jobNo: string, originalName: string, systemName: string, remark = "", byUserId = 0) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(documentAttach)
      .values({
        referenceTopic: "Jobs",
        referenceItemCode: jobNo,
        originalFileName: originalName.slice(0, 50),
        systemFileName: systemName.slice(0, 50),
        remark: remark.slice(0, 100),
        isActive: true,
      })
      .returning({ id: documentAttach.documentAttachId });
    await audit(tx, byUserId, { action: "UPLOAD", module: "Job Management", entity: "job", key: jobNo, summary: `แนบไฟล์ ${originalName}`, changes: { file: [null, systemName] } });
    return row.id;
  });
}

export async function removeAttachment(id: number, byUserId = 0) {
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ jobNo: documentAttach.referenceItemCode, name: documentAttach.originalFileName }).from(documentAttach).where(eq(documentAttach.documentAttachId, id));
    await tx.update(documentAttach).set(statusStamp(RS.DELETED, byUserId)).where(eq(documentAttach.documentAttachId, id));
    await audit(tx, byUserId, { action: "DELETE", module: "Job Management", entity: "job", key: row?.jobNo ?? String(id), summary: `ลบไฟล์แนบ ${row?.name ?? id}` });
  });
}

/* ------------------------------------------------------------------ *
 * Dashboard — computed live from job / job_log
 * ------------------------------------------------------------------ */
/** `type` = job type NAME (same convention as the job list filter) */
export type DashRange = { from?: string; to?: string; type?: string };

// 30 s memo per date range (the dashboard is opened constantly; the queries scan job by date)
const dashCache = new Map<string, { at: number; value: Awaited<ReturnType<typeof computeDashboard>> }>();
export async function dashboard(range: DashRange = {}) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(range.from ?? "") ? range.from! : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(range.to ?? "") ? range.to! : "";
  const type = (range.type ?? "").trim();
  const key = `${from}|${to}|${type}`;
  const hit = dashCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  const value = await computeDashboard(from, to, type);
  dashCache.set(key, { at: Date.now(), value });
  if (dashCache.size > 50) dashCache.delete(dashCache.keys().next().value!);
  return value;
}

const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/**
 * Everything except the TAT table follows the date range (job_create_date;
 * the "closed" line of the chart uses job_closed_date). Empty from/to = all time.
 * TAT is a snapshot of the jobs still open right now, by design.
 */
async function computeDashboard(from: string, to: string, type = "") {
  // optional job-type filter: resolve the name once, then filter every query by id (unknown name → no rows)
  const typeId = type ? ((await db.select({ id: jobType.jobTypeId }).from(jobType).where(eq(jobType.jobTypeName, type)).limit(1))[0]?.id ?? -1) : null;
  const typeSql = typeId === null ? sql`` : sql`AND job_type_id = ${typeId}`;
  const createdIn = and(
    ne(job.recordStatus, RS.DELETED),
    typeId === null ? undefined : eq(job.jobTypeId, typeId),
    from ? gte(job.jobCreateDate, `${from} 00:00:00`) : undefined,
    to ? lte(job.jobCreateDate, `${to} 23:59:59`) : undefined
  );
  const groups = await db
    .select({ group: jobStatus.jobStatusGroup, n: count() })
    .from(job)
    .innerJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
    .where(createdIn)
    .groupBy(jobStatus.jobStatusGroup);
  const total = groups.reduce((s, g) => s + Number(g.n), 0) || 1;
  const G: Record<string, { key: string; label: string; sub: string; tone: "primary" | "warning" | "info" | "success" | "danger"; ord: number }> = {
    Pending: { key: "pending", label: "งานระหว่างดำเนินการ", sub: "Pending", tone: "warning", ord: 1 },
    Repaired: { key: "repaired", label: "ซ่อมเสร็จ / รอปิดงาน", sub: "Repaired", tone: "info", ord: 2 },
    Finished: { key: "finished", label: "ปิดงานแล้ว", sub: "Finished", tone: "success", ord: 3 },
    Cancel: { key: "cancel", label: "ยกเลิก", sub: "Cancel", tone: "danger", ord: 4 },
  };
  const dashGroups = Object.entries(G)
    .map(([g, meta]) => {
      const n = Number(groups.find((x) => x.group === g)?.n ?? 0);
      return { ...meta, jobs: n, percent: Math.round((n / total) * 1000) / 10 };
    })
    .sort((a, b) => a.ord - b.ord);

  // TAT buckets for open jobs (days since job_create_date) per status — snapshot, not range-bound
  const tat = await db.execute(sql`
    SELECT s.job_status_name AS status, s.display_order AS ord,
           count(*) FILTER (WHERE d <= 3)  AS d13,
           count(*) FILTER (WHERE d BETWEEN 4 AND 7)  AS d47,
           count(*) FILTER (WHERE d BETWEEN 8 AND 14) AS d814,
           count(*) FILTER (WHERE d BETWEEN 15 AND 30) AS d1530,
           count(*) FILTER (WHERE d > 30) AS over30
      FROM (SELECT job_status_id, GREATEST(1, (current_date - job_create_date::date)) AS d
              FROM job WHERE record_status <> 'DELETED' ${typeSql}) j
      JOIN job_status s ON s.job_status_id = j.job_status_id
     WHERE s.job_status_group NOT IN ('Finished','Cancel')
     GROUP BY s.job_status_name, s.display_order
     ORDER BY s.display_order`);
  const tatRows = (tat.rows as Record<string, unknown>[]).map((r) => ({
    status: String(r.status ?? "").trim(),
    d13: Number(r.d13),
    d47: Number(r.d47),
    d814: Number(r.d814),
    d1530: Number(r.d1530),
    over30: Number(r.over30),
  }));

  // open / close trend: daily when the range is ≤ 62 days, otherwise monthly (all time = from the first job)
  const spanDays = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 : Infinity;
  const daily = spanDays <= 62;
  const lo = from ? sql`${from}::date` : sql`(SELECT coalesce(min(job_create_date)::date, current_date) FROM job)`;
  const hi = to ? sql`${to}::date` : sql`current_date`;
  const trend = await db.execute(
    daily
      ? sql`
    WITH d AS (SELECT generate_series(${lo}, ${hi}, interval '1 day')::date AS dt),
    o AS (SELECT job_create_date::date AS dt, count(*) AS n FROM job
           WHERE record_status <> 'DELETED' ${typeSql} AND job_create_date >= ${lo} AND job_create_date < ${hi} + 1 GROUP BY 1),
    c AS (SELECT job_closed_date::date AS dt, count(*) AS n FROM job
           WHERE record_status <> 'DELETED' ${typeSql} AND job_closed_date >= ${lo} AND job_closed_date < ${hi} + 1 GROUP BY 1)
    SELECT to_char(d.dt, 'YYYY-MM-DD') AS k, coalesce(o.n, 0) AS open, coalesce(c.n, 0) AS close
      FROM d LEFT JOIN o ON o.dt = d.dt LEFT JOIN c ON c.dt = d.dt ORDER BY d.dt`
      : sql`
    WITH m AS (SELECT generate_series(date_trunc('month', ${lo}), date_trunc('month', ${hi}), interval '1 month') AS mo),
    o AS (SELECT date_trunc('month', job_create_date) AS mo, count(*) AS n FROM job
           WHERE record_status <> 'DELETED' ${typeSql} AND job_create_date >= date_trunc('month', ${lo}) AND job_create_date < ${hi} + 1 GROUP BY 1),
    c AS (SELECT date_trunc('month', job_closed_date) AS mo, count(*) AS n FROM job
           WHERE record_status <> 'DELETED' ${typeSql} AND job_closed_date >= date_trunc('month', ${lo}) AND job_closed_date < ${hi} + 1 GROUP BY 1)
    SELECT to_char(m.mo, 'YYYY-MM') AS k, coalesce(o.n, 0) AS open, coalesce(c.n, 0) AS close
      FROM m LEFT JOIN o ON o.mo = m.mo LEFT JOIN c ON c.mo = m.mo ORDER BY m.mo`
  );
  const monthlyRows = (trend.rows as { k: string; open: string; close: string }[]).map((r) => {
    const [y, mo, d] = r.k.split("-");
    const label = daily ? `${Number(d)} ${TH_MONTH[Number(mo) - 1]}` : `${TH_MONTH[Number(mo) - 1]} ${String(Number(y) + 543).slice(-2)}`;
    return { m: label, open: Number(r.open), close: Number(r.close) };
  });

  const top = await db
    .select({ name: symptom.symptomName, n: count() })
    .from(job)
    .innerJoin(symptom, eq(symptom.symptomId, job.productSymptomId))
    .where(createdIn)
    .groupBy(symptom.symptomName)
    .orderBy(desc(count()))
    .limit(8);
  const topSymptoms = top.map((t) => ({ name: t.name ?? "", count: Number(t.n) }));

  return { groups: dashGroups, tat: tatRows, monthly: monthlyRows, granularity: daily ? ("day" as const) : ("month" as const), topSymptoms };
}

/* ------------------------------------------------------------------ *
 * Symptom picker data — usage counts (job.product_symptom_id ∪ job_symptom)
 * ------------------------------------------------------------------ */
let symptomStatsCache: { at: number; value: { id: number; name: string; group: string; count: number }[] } | null = null;
/** Active symptoms ordered by how often they were used, most common first (5 min memo). */
export async function symptomStats() {
  if (symptomStatsCache && Date.now() - symptomStatsCache.at < 300_000) return symptomStatsCache.value;
  const r = await db.execute(sql`
    WITH u AS (
      SELECT product_symptom_id AS sid FROM job WHERE record_status <> 'DELETED' AND product_symptom_id > 0
      UNION ALL
      SELECT js.symptom_id FROM job_symptom js JOIN job j ON j.job_no = js.job_no
       WHERE j.record_status <> 'DELETED' AND js.symptom_id <> j.product_symptom_id
    )
    SELECT s.symptom_id AS id, s.symptom_name AS name, coalesce(s.symptom_group_name, '') AS grp, count(u.sid) AS n
      FROM symptom s LEFT JOIN u ON u.sid = s.symptom_id
     WHERE s.record_status = 'ACTIVE'
     GROUP BY s.symptom_id, s.symptom_name, s.symptom_group_name
     ORDER BY count(u.sid) DESC, s.symptom_name`);
  const value = (r.rows as { id: number; name: string; grp: string; n: string }[]).map((x) => ({ id: Number(x.id), name: (x.name ?? "").trim(), group: x.grp ?? "", count: Number(x.n) }));
  symptomStatsCache = { at: Date.now(), value };
  return value;
}

/** Top symptoms seen on jobs of one product model (by model_code) — "อาการที่พบบ่อยของรุ่นนี้". */
export async function modelSymptoms(modelCode: string, limit = 5) {
  if (!modelCode) return [];
  const r = await db.execute(sql`
    WITH u AS (
      SELECT j.product_symptom_id AS sid FROM job j JOIN model m ON m.model_id = j.product_model_id
       WHERE m.model_code = ${modelCode} AND j.record_status <> 'DELETED' AND j.product_symptom_id > 0
      UNION ALL
      SELECT js.symptom_id FROM job_symptom js JOIN job j ON j.job_no = js.job_no JOIN model m ON m.model_id = j.product_model_id
       WHERE m.model_code = ${modelCode} AND j.record_status <> 'DELETED' AND js.symptom_id <> j.product_symptom_id
    )
    SELECT s.symptom_id AS id, s.symptom_name AS name, count(*) AS n
      FROM u JOIN symptom s ON s.symptom_id = u.sid
     WHERE s.record_status = 'ACTIVE'
     GROUP BY s.symptom_id, s.symptom_name
     ORDER BY count(*) DESC LIMIT ${limit}`);
  return (r.rows as { id: number; name: string; n: string }[]).map((x) => ({ id: Number(x.id), name: (x.name ?? "").trim(), count: Number(x.n) }));
}

export { eq };

/* ------------------------------------------------------------------ *
 * Call log (job_call_log)
 * ------------------------------------------------------------------ */
export async function listCallLogs(jobNo: string) {
  const { jobCallLog } = await import("@/db/schema");
  const rows = await db
    .select({ id: jobCallLog.jobCallLogId, detail: jobCallLog.callLogDescription, date: jobCallLog.callLogDate, f: appUser.firstName, l: appUser.lastName })
    .from(jobCallLog)
    .leftJoin(appUser, eq(appUser.userId, jobCallLog.callLogBy))
    .where(eq(jobCallLog.jobNo, jobNo))
    .orderBy(desc(jobCallLog.callLogDate), desc(jobCallLog.jobCallLogId));
  return rows.map((r) => ({ id: r.id, detail: r.detail ?? "", date: fmtDateTime(r.date), by: fullName(r.f, r.l) }));
}

export async function addCallLog(jobNo: string, detail: string, byUserId: number) {
  const { jobCallLog } = await import("@/db/schema");
  const text = str(detail).slice(0, 200);
  if (!text) throw new HttpError(400, "ต้องระบุรายละเอียด");
  await db.transaction(async (tx) => {
    await tx.insert(jobCallLog).values({ jobNo, callLogDescription: text, callLogDate: nowThai(), callLogBy: byUserId });
    await audit(tx, byUserId, { action: "CREATE", module: "Job Management", entity: "job", key: jobNo, summary: `บันทึกการโทร: ${text}`.slice(0, 200) });
  });
  return listCallLogs(jobNo);
}

/** Header chips of the job list — counts over the whole table. */
export async function jobStats() {
  const rows = await db
    .select({ id: job.jobStatusId, group: jobStatus.jobStatusGroup, n: count() })
    .from(job)
    .leftJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
    .groupBy(job.jobStatusId, jobStatus.jobStatusGroup);
  let total = 0;
  let fresh = 0;
  let done = 0;
  for (const r of rows) {
    if (r.id === JS.CANCELLED) continue; // = DELETED
    const n = Number(r.n);
    total += n;
    if (r.id === JS.NEW) fresh += n;
    else if (r.group === "Finished" || r.group === "Repaired") done += n;
  }
  return { total, fresh, done, progress: total - fresh - done };
}
