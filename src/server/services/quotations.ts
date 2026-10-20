import 'server-only';
import { cached } from '@/server/cache';
import { and, asc, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import type { PgSelect } from 'drizzle-orm/pg-core';
import { db } from '@/db/client';
import { QS } from '@/lib/status-ids';
import { MAX_EXPORT_ROWS } from '@/lib/export-limit';
import { appUser, customer, job, manufacturer, quotationDt, quotationHd, quotationStatus } from '@/db/schema';
import type { Quotation } from '@/data/types';
import { HttpError, fullName } from '@/server/auth';
import { assertVersion } from '@/server/http-error';
import { nextRunningNo } from '@/db/running-no';
import { audit, diff } from '@/server/audit';
import { orderBy, likeTerm, offsetOf, totalOf, ymd, type Page, type PageQuery } from '@/server/paging';
import { fmtDateTime, money, nowThai, num, str, SENTINEL_TS } from '@/server/mappers/format';
import { customerForDocument, getCustomerByCode } from './customers';
import { issuingProfile, SHD_PROFILE_ID } from './document-profiles';
import { followQuotation, getJob } from './jobs';
import { RS, statusFilter, statusStamp, type StatusMode } from '@/server/record-status';
import { computeTotals, quotationSchema } from '@/lib/validation/quotation';
import { clean, cleanCode, cleanText } from '@/lib/validation';
import { assertValid } from '@/server/validate';
import type { z } from 'zod';
import type { quotationSave } from '@/server/contract/sales';

/** quotation_status ids (from the dump) */
export { QS };
const AGREED = new Set<number>([QS.AGREED, QS.AGREED_WAIT_PAY, QS.AGREED_WAIT_PARTS]);

/** UI type labels ↔ legacy quotation_type values */
const TYPE_LABEL: Record<string, Quotation['type']> = { Normal: 'Type A (Normal)', VIP: 'Type B (VIP)' };
const TYPE_VALUE: Record<string, string> = { 'Type A (Normal)': 'Normal', 'Type B (VIP)': 'VIP' };

export function quotationStatuses() {
  return cached('quotationstatus:all', 300_000, async () => {
    const rows = await db.select().from(quotationStatus).orderBy(asc(quotationStatus.quotationStatusId));
    return rows.map((r) => ({ id: r.quotationStatusId, name: r.quotationStatusName.trim() }));
  });
}
async function statusIdByName(name: string) {
  const hit = (await quotationStatuses()).find((s) => s.name === name.trim());
  if (!hit) throw new HttpError(400, `ไม่รู้จักสถานะใบเสนอราคา "${name}"`);
  return hit.id;
}

const listSelect = {
  no: quotationHd.quotationNo,
  date: quotationHd.createDate,
  type: quotationHd.quotationType,
  customerCode: quotationHd.customerCode,
  customer: customer.customerName,
  jobRef: quotationHd.referenceJobNo,
  imei: job.productImeiNo,
  brand: manufacturer.manufacturerName,
  modelName: job.productModelName,
  amount: quotationHd.netAmount,
  status: quotationStatus.quotationStatusName,
  statusId: quotationHd.quotationStatusId,
  active: quotationHd.recordStatus,
  warranty: job.productWarranty,
  parts: quotationHd.sparePartAmount,
  service: quotationHd.serviceAmount,
  discount: quotationHd.discountAmount,
  vat: quotationHd.vatAmount,
  approveDate: quotationHd.customerApproveDate,
  createBy: appUser.firstName,
  createByLast: appUser.lastName,
};
type ListRow = { [K in keyof typeof listSelect]: (typeof listSelect)[K]['_']['data'] | null };

function toQuotation(r: ListRow): Quotation {
  return {
    no: r.no ?? '',
    date: fmtDateTime(r.date),
    type: TYPE_LABEL[r.type?.trim() ?? 'Normal'] ?? 'Type A (Normal)',
    customer: r.customer ?? r.customerCode ?? '',
    jobRef: r.jobRef ?? '',
    imei: r.imei ?? '',
    brandModel: [r.brand, r.modelName].filter(Boolean).join(' '),
    amount: num(r.amount),
    status: r.status?.trim() ?? '',
    statusId: r.statusId ?? 0,
    customerCode: r.customerCode ?? '',
    warranty: r.warranty ?? '',
    partsAmount: num(r.parts),
    serviceAmount: num(r.service),
    discountAmount: num(r.discount),
    vatAmount: num(r.vat),
    approveDate: fmtDateTime(r.approveDate),
    createdBy: fullName(r.createBy, r.createByLast),
    active: r.active !== RS.DELETED,
  };
}

/** The list's joins — the list, its count and the report KPI (reports.ts) all take them, so quotationWhere
 *  never names a table one of them lacks (a count does not pay for the creator: Postgres drops an unused
 *  left join on a primary key). */
export const withQuotationJoins = <T extends PgSelect>(q: T) =>
  q
    .leftJoin(customer, eq(customer.customerCode, quotationHd.customerCode))
    .leftJoin(job, eq(job.jobNo, quotationHd.referenceJobNo))
    .leftJoin(manufacturer, eq(manufacturer.manufacturerId, job.productBrandId))
    .leftJoin(quotationStatus, eq(quotationStatus.quotationStatusId, quotationHd.quotationStatusId))
    .leftJoin(appUser, eq(appUser.userId, quotationHd.createBy));

const base = () => withQuotationJoins(db.select(listSelect).from(quotationHd).$dynamic());

const SORT = {
  no: quotationHd.quotationNo,
  date: quotationHd.createDate,
  customer: customer.customerName,
  jobRef: quotationHd.referenceJobNo,
  amount: quotationHd.netAmount,
  status: quotationHd.quotationStatusId,
  type: quotationHd.quotationType,
};

export type QuotationFilters = {
  status?: string;
  from?: string;
  to?: string;
  deleted?: StatusMode;
  jobNo?: string;
  type?: string;
  warranty?: string;
  brand?: string;
};

/** The page's query (?status=&brand=…) as filters — the list, its report KPI and the export all read it here. */
export const quotationFiltersFromQuery = (f: Record<string, string>, deleted: StatusMode): QuotationFilters => ({
  status: f.status,
  from: f.from,
  to: f.to,
  deleted,
  jobNo: f.jobNo,
  type: f.type,
  warranty: f.warranty,
  brand: f.brand,
});

export function quotationWhere(q: string, f: QuotationFilters) {
  const term = q.trim();
  const from = ymd(f.from),
    to = ymd(f.to);
  return and(
    statusFilter(quotationHd.recordStatus, f.deleted ?? 'exclude'),
    term
      ? or(
          ilike(quotationHd.quotationNo, likeTerm(term)),
          ilike(quotationHd.referenceJobNo, likeTerm(term)),
          ilike(customer.customerName, likeTerm(term)),
          ilike(quotationHd.customerCode, likeTerm(term)),
          ilike(job.productImeiNo, likeTerm(term)),
        )
      : undefined,
    // trimmed: the table pads some names ("รอเสนอราคา" + 24 spaces) — an exact match misses them
    f.status ? sql`trim(${quotationStatus.quotationStatusName}) = ${f.status.trim()}` : undefined,
    from ? gte(quotationHd.createDate, `${from} 00:00:00`) : undefined,
    to ? lte(quotationHd.createDate, `${to} 23:59:59`) : undefined,
    f.jobNo ? eq(quotationHd.referenceJobNo, f.jobNo) : undefined,
    f.type
      ? eq(quotationHd.quotationType, f.type.includes('VIP') ? 'VIP' : f.type.includes('Normal') ? 'Normal' : f.type)
      : undefined,
    // ข้อมูลเครื่องมาจากงานที่อ้างถึง (job) — กรองที่ server ให้ครบทุกหน้า ไม่ใช่เฉพาะหน้าที่โหลด
    f.warranty ? eq(job.productWarranty, f.warranty) : undefined,
    f.brand ? eq(manufacturer.manufacturerName, f.brand) : undefined,
  );
}

export async function pageQuotations(p: PageQuery, f: QuotationFilters): Promise<Page<Quotation>> {
  const w = quotationWhere(p.q, f);
  // count + page in parallel: the response takes max(count, rows) instead of their sum
  const [counted, rows] = await Promise.all([
    withQuotationJoins(db.select({ total: count() }).from(quotationHd).$dynamic()).where(w),
    base()
      .where(w)
      .orderBy(...orderBy(p.sort, SORT, [desc(quotationHd.createDate), desc(quotationHd.quotationHdId)]))
      .limit(p.pageSize)
      .offset(offsetOf(p)),
  ]);
  return { rows: rows.map(toQuotation), total: totalOf(counted), page: p.page, pageSize: p.pageSize };
}

export async function listQuotations(f: QuotationFilters & { q?: string; limit?: number } = {}): Promise<Quotation[]> {
  const rows = await base()
    .where(quotationWhere(f.q ?? '', f))
    .orderBy(desc(quotationHd.createDate))
    .limit(Math.min(f.limit ?? 5000, MAX_EXPORT_ROWS));
  return rows.map(toQuotation);
}

export type QuotationLine = {
  id?: number;
  lineNumber: number;
  itemType: 'SparePart' | 'Service' | 'Delivery';
  code: string;
  detail: string;
  qty: number;
  unit: string;
  unitPrice: number;
  discount: number;
  discountPercent: number;
  total: number;
};

export type QuotationDetail = Quotation & {
  contactName: string;
  customerDetail: Awaited<ReturnType<typeof getCustomerByCode>>;
  job: Awaited<ReturnType<typeof getJob>>;
  lines: QuotationLine[];
  remark: string;
  discountType: string;
  discountFormula: string;
  sumExclude: number;
  afterDiscount: number;
  totalBase: number;
  vatRate: number;
  totalAmount: number;
  rounding: number;
  netAmount: number;
  approveRemark: string;
  /** ออกเอกสารในนาม — document_profile.id (legacy rows = SHD) */
  documentProfileId: number;
  /** contact printed on the document ("ท่านสามารถติดต่อสอบถาม…") = the user who created the quotation */
  createdByPhone: string;
  createdByEmail: string;
  /** row_version + newest line id (versionOf) — the edit page sends it back with its save */
  version: number;
};

/** row_version + the newest line id: a line-only edit re-inserts the lines (new, higher ids) without moving
 *  row_version (same as sale orders' versionOf). ponytail: lines saved empty drop the id part — a stale
 *  version could only match again if row_version grew by exactly that id. */
const versionOf = (rowVersion: number, lines: { quotationDtId: number }[]) =>
  rowVersion + Math.max(0, ...lines.map((l) => l.quotationDtId));

export async function getQuotation(no: string): Promise<QuotationDetail | null> {
  // the list row, the whole header and the creator's contact in one read; the lines alongside
  const [[r], dts] = await Promise.all([
    withQuotationJoins(
      db
        .select({ ...listSelect, hd: quotationHd, creatorPhone: appUser.phoneNo, creatorEmail: appUser.emailAddress })
        .from(quotationHd)
        .$dynamic(),
    )
      .where(eq(quotationHd.quotationNo, no))
      .limit(1),
    db
      .select()
      .from(quotationDt)
      .where(eq(quotationDt.quotationNo, no))
      .orderBy(asc(quotationDt.lineNumber), asc(quotationDt.quotationDtId)),
  ]);
  if (!r) return null;
  const { hd } = r;
  const [cust, jb] = await Promise.all([
    hd.customerCode ? getCustomerByCode(hd.customerCode) : null,
    hd.referenceJobNo ? getJob(hd.referenceJobNo) : null,
  ]);
  return {
    ...toQuotation(r),
    contactName: hd.customerContactName ?? '',
    customerDetail: cust,
    job: jb,
    lines: dts.map((d) => ({
      id: d.quotationDtId,
      lineNumber: d.lineNumber ?? 0,
      itemType: (d.itemType as QuotationLine['itemType']) ?? 'SparePart',
      code: d.itemCode ?? '',
      detail: d.itemDetail ?? '',
      qty: num(d.quantity),
      unit: d.unit ?? 'หน่วย',
      unitPrice: num(d.unitPrice),
      discount: num(d.unitPriceDiscount),
      discountPercent: num(d.unitPriceDiscountPercent),
      total: num(d.totalPrice),
    })),
    remark: hd.remark ?? '',
    discountType: hd.discountType ?? 'ไม่มีส่วนลด',
    discountFormula: hd.discountFormula ?? '0%',
    sumExclude: num(hd.sumExcludeAmount),
    afterDiscount: num(hd.afterDiscountAmount),
    totalBase: num(hd.totalBaseAmount),
    vatRate: hd.vatRate ?? 0,
    totalAmount: num(hd.totalAmount),
    rounding: num(hd.roundingAmount),
    netAmount: num(hd.netAmount),
    approveRemark: hd.customerApproveRemark ?? '',
    documentProfileId: hd.documentProfileId ?? SHD_PROFILE_ID,
    createdByPhone: r.creatorPhone ?? '',
    createdByEmail: r.creatorEmail ?? '',
    version: versionOf(hd.rowVersion, dts),
  };
}

/** the parsed body of POST /api/quotations (quotationSave in src/server/contract/sales.ts) */
export type QuotationInput = z.output<typeof quotationSave.body>;

export async function saveQuotation(i: QuotationInput, byUserId: number): Promise<QuotationDetail> {
  // same rules as the form (lib/validation/quotation); an old quotation without a job may stay without one
  const [before] = i.no
    ? await db
        .select({ jobNo: quotationHd.referenceJobNo, customerCode: quotationHd.customerCode })
        .from(quotationHd)
        .where(eq(quotationHd.quotationNo, i.no))
        .limit(1)
    : [];
  assertValid(quotationSchema(i.no ? (before?.jobNo ?? '') : undefined), i);
  const jobNo = cleanCode(i.jobNo); // stored upper-case
  const [found] = jobNo
    ? await db.select({ profileId: job.documentProfileId }).from(job).where(eq(job.jobNo, jobNo)).limit(1)
    : [];
  if (jobNo && !found) throw new HttpError(400, 'ไม่พบหมายเลขงาน', { fields: { jobNo: `ไม่พบหมายเลขงาน ${jobNo}` } });
  const cust = await customerForDocument(str(i.customerCode), before?.customerCode);
  if (!cust) throw new HttpError(400, 'ต้องเลือกลูกค้า', { fields: { customerCode: 'ไม่พบลูกค้ารายนี้' } });
  const lines = (i.lines ?? [])
    .filter((l) => str(l.code) || str(l.detail))
    .map((l, idx) => {
      const qty = num(l.qty) || 1;
      const price = num(l.unitPrice);
      const disc = num(l.discount);
      return {
        ...l,
        lineNumber: idx + 1,
        qty,
        unitPrice: price,
        discount: disc,
        total: Math.round((qty * price - disc) * 100) / 100,
      };
    });
  const parts = lines.filter((l) => (l.itemType ?? 'SparePart') !== 'Delivery').reduce((s, l) => s + l.total, 0);
  const delivery = lines.filter((l) => l.itemType === 'Delivery').reduce((s, l) => s + l.total, 0);
  const service = num(i.serviceAmount);
  const discountType = str(i.discountType) || 'ไม่มีส่วนลด';
  const discountValue = num(i.discountValue);
  const discountUnit: 'บาท' | '%' = i.discountUnit === '%' ? '%' : 'บาท';
  const vatRate = num(i.vatRate);
  const t = computeTotals({ parts, service, delivery, discountType, discountValue, discountUnit, vatRate });
  const statusId = i.status ? await statusIdByName(i.status) : QS.WAIT;
  const type = TYPE_VALUE[str(i.type)] ?? (str(i.type) || 'Normal');
  // a quotation raised from a job is issued under the job's profile unless the user picked another
  const jobProfileId = !i.no ? (found?.profileId ?? undefined) : undefined;

  const dtRows = lines.map((l) => ({
    lineNumber: l.lineNumber,
    itemType: l.itemType ?? 'SparePart',
    itemCode: str(l.code).slice(0, 50),
    itemDetail: clean(l.detail),
    quantity: String(l.qty),
    unit: (str(l.unit) || 'หน่วย').slice(0, 10),
    unitPrice: l.unitPrice.toFixed(2),
    unitPriceDiscount: l.discount.toFixed(2),
    totalPrice: l.total.toFixed(2),
    unitPriceDiscountPercent: num(l.discountPercent).toFixed(2),
  }));

  const statusName = (await quotationStatuses()).find((q) => q.id === statusId)?.name ?? '';
  const no = await db.transaction(async (tx) => {
    let linesChanged = true;
    let statusChanged = true; // a new quotation, or another status than the stored one
    let wasAgreed = false;
    const values = {
      customerCode: cust.code,
      customerContactName: clean(i.contactName),
      sparePartAmount: money(parts),
      serviceAmount: money(service),
      sumExcludeAmount: money(t.sumExclude),
      discountType,
      discountFormula: discountType === 'ไม่มีส่วนลด' ? '0%' : `${discountValue}${discountUnit}`,
      discountAmount: money(t.discount),
      afterDiscountAmount: money(t.afterDiscount),
      totalBaseAmount: money(t.totalBase),
      vatRate,
      vatAmount: money(t.vat),
      totalAmount: money(t.total),
      roundingAmount: money(t.rounding),
      netAmount: money(t.net),
      remark: cleanText(i.remark),
      referenceJobNo: jobNo,
      quotationStatusId: statusId,
      customerApproveRemark: clean(i.approveRemark),
      quotationType: type,
    };
    let no = i.no;
    if (no) {
      const [prev] = await tx.select().from(quotationHd).where(eq(quotationHd.quotationNo, no)).for('update');
      if (!prev) throw new HttpError(404, 'ไม่พบใบเสนอราคา ' + no);
      const old = await tx
        .select()
        .from(quotationDt)
        .where(eq(quotationDt.quotationNo, no))
        .orderBy(asc(quotationDt.lineNumber), asc(quotationDt.quotationDtId));
      // restored through the records page (Quotation del) — a status change here would stamp it ACTIVE
      if (prev.recordStatus === RS.DELETED) throw new HttpError(409, 'ใบเสนอราคานี้ถูกลบแล้ว แก้ไขไม่ได้');
      assertVersion(i.version, versionOf(prev.rowVersion, old));
      // lines are re-written only when they changed (same value read the same way as the audit diff:
      // "100" = "100.00", trimmed) — an unchanged save keeps the rows, their ids and the version
      linesChanged = old.length !== dtRows.length || dtRows.some((r, k) => diff(old[k], r) !== null);
      statusChanged = prev.quotationStatusId !== statusId;
      wasAgreed = AGREED.has(prev.quotationStatusId ?? 0);
      const upd = {
        ...values,
        customerApproveDate:
          AGREED.has(statusId) && !AGREED.has(prev.quotationStatusId ?? 0) ? nowThai() : prev.customerApproveDate,
        // ยกเลิกใบเสนอราคา = INACTIVE (still listed with its status); DELETED only via records API. Stamped only when
        // the status moves: a re-save keeps record_status and who/when changed it
        ...(statusChanged ? statusStamp(statusId === QS.CANCELLED ? RS.INACTIVE : RS.ACTIVE, byUserId) : {}),
      };
      await tx.update(quotationHd).set(upd).where(eq(quotationHd.quotationNo, no));
      if (linesChanged) await tx.delete(quotationDt).where(eq(quotationDt.quotationNo, no));
      await audit(tx, byUserId, {
        action: statusChanged ? 'STATUS' : 'UPDATE',
        module: 'Quotation',
        entity: 'quotation_hd',
        key: no,
        summary: statusChanged
          ? `สถานะใบเสนอราคา → ${statusName}`
          : `แก้ไขใบเสนอราคา · ${lines.length} รายการ · ${t.net.toFixed(2)} บาท`,
        changes: diff(prev as Record<string, unknown>, upd as Record<string, unknown>, {
          skip: ['customerApproveDate'],
        }),
      });
    } else {
      const profile = await issuingProfile(i.documentProfileId ?? jobProfileId);
      no = await nextRunningNo(tx, 'Quotation');
      await tx.insert(quotationHd).values({
        ...values,
        documentProfileId: profile.id,
        quotationNo: no,
        createDate: nowThai(),
        createBy: byUserId,
        customerApproveDate: AGREED.has(statusId) ? nowThai() : SENTINEL_TS,
        ...statusStamp(statusId === QS.CANCELLED ? RS.INACTIVE : RS.ACTIVE, byUserId),
      });
      await audit(tx, byUserId, {
        action: 'CREATE',
        module: 'Quotation',
        entity: 'quotation_hd',
        key: no,
        summary: `สร้างใบเสนอราคา · งาน ${values.referenceJobNo || '-'} · ${lines.length} รายการ · ${t.net.toFixed(2)} บาท`,
      });
    }
    if (linesChanged && dtRows.length)
      await tx.insert(quotationDt).values(dtRows.map((r) => ({ ...r, quotationNo: no! })));
    // customer agreed → remember the approved quotation on the job
    if (AGREED.has(statusId) && values.referenceJobNo) {
      await tx.update(job).set({ quotationNoApproved: no }).where(eq(job.jobNo, values.referenceJobNo));
    } else if (wasAgreed && !AGREED.has(statusId)) {
      // no longer agreed (declined / cancelled …) → a job still naming it as the approved one forgets it
      await tx.update(job).set({ quotationNoApproved: '' }).where(eq(job.quotationNoApproved, no!));
    }
    // sent / agreed moves the job forward (owner 2026-10-16) — only when the status was set now: an unchanged
    // re-save never touches the job
    if (statusChanged && values.referenceJobNo)
      await followQuotation(tx, values.referenceJobNo, no!, statusId, statusName, byUserId);
    return no!;
  });
  return (await getQuotation(no))!;
}
