import "server-only";
import { and, asc, count, desc, eq, gte, ilike, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appUser, customer, job, manufacturer, quotationDt, quotationHd, quotationStatus } from "@/db/schema";
import type { Quotation } from "@/data/mock";
import { HttpError, fullName } from "@/server/auth";
import { nextRunningNo } from "@/db/running-no";
import { audit, diff } from "@/server/audit";
import { orderBy, offsetOf, type Page, type PageQuery } from "@/server/paging";
import { fmtDateTime, money, nowThai, num, str, SENTINEL_TS } from "@/server/mappers/format";
import { getCustomerByCode } from "./customers";
import { issuingProfile, SHD_PROFILE_ID } from "./document-profiles";
import { getJob } from "./jobs";
import { RS, statusFilter, statusStamp, type StatusMode } from "@/server/record-status";

/** quotation_status ids (from the dump) */
export const QS = { WAIT: 1, SENT: 2, AGREED: 3, DECLINED: 4, CANCELLED: 5, AGREED_WAIT_PAY: 6, EXPIRED: 8, AGREED_WAIT_PARTS: 9 } as const;
const AGREED = new Set<number>([QS.AGREED, QS.AGREED_WAIT_PAY, QS.AGREED_WAIT_PARTS]);

/** UI type labels ↔ legacy quotation_type values */
const TYPE_LABEL: Record<string, Quotation["type"]> = { Normal: "Type A (Normal)", VIP: "Type B (VIP)" };
const TYPE_VALUE: Record<string, string> = { "Type A (Normal)": "Normal", "Type B (VIP)": "VIP" };

let statusCache: { id: number; name: string }[] | null = null;
export async function quotationStatuses() {
  if (statusCache) return statusCache;
  const rows = await db.select().from(quotationStatus).orderBy(asc(quotationStatus.quotationStatusId));
  statusCache = rows.map((r) => ({ id: r.quotationStatusId, name: r.quotationStatusName.trim() }));
  return statusCache;
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
type ListRow = { [K in keyof typeof listSelect]: (typeof listSelect)[K]["_"]["data"] | null };

function toQuotation(r: ListRow): Quotation {
  return {
    no: r.no ?? "",
    date: fmtDateTime(r.date),
    type: TYPE_LABEL[r.type?.trim() ?? "Normal"] ?? "Type A (Normal)",
    customer: r.customer ?? r.customerCode ?? "",
    jobRef: r.jobRef ?? "",
    imei: r.imei ?? "",
    brandModel: [r.brand, r.modelName].filter(Boolean).join(" "),
    amount: num(r.amount),
    status: r.status?.trim() ?? "",
    statusId: r.statusId ?? 0,
    customerCode: r.customerCode ?? "",
    warranty: r.warranty ?? "",
    partsAmount: num(r.parts),
    serviceAmount: num(r.service),
    discountAmount: num(r.discount),
    vatAmount: num(r.vat),
    approveDate: fmtDateTime(r.approveDate),
    createdBy: fullName(r.createBy, r.createByLast),
    active: r.active !== RS.DELETED,
  };
}

const base = () =>
  db
    .select(listSelect)
    .from(quotationHd)
    .leftJoin(customer, eq(customer.customerCode, quotationHd.customerCode))
    .leftJoin(job, eq(job.jobNo, quotationHd.referenceJobNo))
    .leftJoin(manufacturer, eq(manufacturer.manufacturerId, job.productBrandId))
    .leftJoin(quotationStatus, eq(quotationStatus.quotationStatusId, quotationHd.quotationStatusId))
    .leftJoin(appUser, eq(appUser.userId, quotationHd.createBy));

const SORT = {
  no: quotationHd.quotationNo,
  date: quotationHd.createDate,
  customer: customer.customerName,
  jobRef: quotationHd.referenceJobNo,
  amount: quotationHd.netAmount,
  status: quotationHd.quotationStatusId,
  type: quotationHd.quotationType,
};

export type QuotationFilters = { status?: string; from?: string; to?: string; deleted?: StatusMode; jobNo?: string; type?: string; warranty?: string; brand?: string };

export function quotationWhere(q: string, f: QuotationFilters) {
  const term = q.trim();
  return and(
    statusFilter(quotationHd.recordStatus, f.deleted ?? "exclude"),
    term
      ? or(
          ilike(quotationHd.quotationNo, `%${term}%`),
          ilike(quotationHd.referenceJobNo, `%${term}%`),
          ilike(customer.customerName, `%${term}%`),
          ilike(quotationHd.customerCode, `%${term}%`),
          ilike(job.productImeiNo, `%${term}%`)
        )
      : undefined,
    f.status ? eq(quotationStatus.quotationStatusName, f.status) : undefined,
    f.from ? gte(quotationHd.createDate, `${f.from} 00:00:00`) : undefined,
    f.to ? lte(quotationHd.createDate, `${f.to} 23:59:59`) : undefined,
    f.jobNo ? eq(quotationHd.referenceJobNo, f.jobNo) : undefined,
    f.type ? eq(quotationHd.quotationType, f.type.includes("VIP") ? "VIP" : f.type.includes("Normal") ? "Normal" : f.type) : undefined,
    // ข้อมูลเครื่องมาจากงานที่อ้างถึง (job) — กรองที่ server ให้ครบทุกหน้า ไม่ใช่เฉพาะหน้าที่โหลด
    f.warranty ? eq(job.productWarranty, f.warranty) : undefined,
    f.brand ? eq(manufacturer.manufacturerName, f.brand) : undefined
  );
}

export async function pageQuotations(p: PageQuery, f: QuotationFilters): Promise<Page<Quotation>> {
  const w = quotationWhere(p.q, f);
  // count + page in parallel: the response takes max(count, rows) instead of their sum
  const [[{ total }], rows] = await Promise.all([
    db
      .select({ total: count() })
      .from(quotationHd)
      .leftJoin(customer, eq(customer.customerCode, quotationHd.customerCode))
      .leftJoin(job, eq(job.jobNo, quotationHd.referenceJobNo))
      .leftJoin(manufacturer, eq(manufacturer.manufacturerId, job.productBrandId))
      .leftJoin(quotationStatus, eq(quotationStatus.quotationStatusId, quotationHd.quotationStatusId))
      .where(w),
    base()
      .where(w)
      .orderBy(...orderBy(p.sort, SORT, [desc(quotationHd.createDate), desc(quotationHd.quotationHdId)]))
      .limit(p.pageSize)
      .offset(offsetOf(p)),
  ]);
  return { rows: rows.map(toQuotation), total: Number(total), page: p.page, pageSize: p.pageSize };
}

export async function listQuotations(f: QuotationFilters & { q?: string; limit?: number } = {}): Promise<Quotation[]> {
  const rows = await base()
    .where(quotationWhere(f.q ?? "", f))
    .orderBy(desc(quotationHd.createDate))
    .limit(Math.min(f.limit ?? 5000, 20000));
  return rows.map(toQuotation);
}

export type QuotationLine = {
  id?: number;
  lineNumber: number;
  itemType: "SparePart" | "Service" | "Delivery";
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
};

export async function getQuotation(no: string): Promise<QuotationDetail | null> {
  const [r] = await base().where(eq(quotationHd.quotationNo, no)).limit(1);
  if (!r) return null;
  const [hd] = await db.select().from(quotationHd).where(eq(quotationHd.quotationNo, no)).limit(1);
  const dts = await db.select().from(quotationDt).where(eq(quotationDt.quotationNo, no)).orderBy(asc(quotationDt.lineNumber), asc(quotationDt.quotationDtId));
  const [cust, jb, [creator]] = await Promise.all([
    hd.customerCode ? getCustomerByCode(hd.customerCode) : null,
    hd.referenceJobNo ? getJob(hd.referenceJobNo) : null,
    hd.createBy ? db.select({ phone: appUser.phoneNo, email: appUser.emailAddress }).from(appUser).where(eq(appUser.userId, hd.createBy)).limit(1) : Promise.resolve([undefined]),
  ]);
  return {
    ...toQuotation(r),
    contactName: hd.customerContactName ?? "",
    customerDetail: cust,
    job: jb,
    lines: dts.map((d) => ({
      id: d.quotationDtId,
      lineNumber: d.lineNumber ?? 0,
      itemType: (d.itemType as QuotationLine["itemType"]) ?? "SparePart",
      code: d.itemCode ?? "",
      detail: d.itemDetail ?? "",
      qty: num(d.quantity),
      unit: d.unit ?? "หน่วย",
      unitPrice: num(d.unitPrice),
      discount: num(d.unitPriceDiscount),
      discountPercent: num(d.unitPriceDiscountPercent),
      total: num(d.totalPrice),
    })),
    remark: hd.remark ?? "",
    discountType: hd.discountType ?? "ไม่มีส่วนลด",
    discountFormula: hd.discountFormula ?? "0%",
    sumExclude: num(hd.sumExcludeAmount),
    afterDiscount: num(hd.afterDiscountAmount),
    totalBase: num(hd.totalBaseAmount),
    vatRate: hd.vatRate ?? 0,
    totalAmount: num(hd.totalAmount),
    rounding: num(hd.roundingAmount),
    netAmount: num(hd.netAmount),
    approveRemark: hd.customerApproveRemark ?? "",
    documentProfileId: hd.documentProfileId ?? SHD_PROFILE_ID,
    createdByPhone: creator?.phone ?? "",
    createdByEmail: creator?.email ?? "",
  };
}

export type QuotationInput = {
  no?: string;
  /** ออกเอกสารในนาม (document_profile.id) — new quotations only; fixed once numbered */
  documentProfileId?: number;
  type?: string; // UI label or legacy value
  customerCode: string;
  contactName?: string;
  jobNo?: string;
  lines: Omit<QuotationLine, "lineNumber" | "total">[];
  serviceAmount?: number | string;
  discountType?: string;
  discountValue?: number | string; // number in บาท or %
  discountUnit?: "บาท" | "%";
  vatRate?: number | string;
  remark?: string;
  status?: string; // name
  approveRemark?: string;
};

/** Amount rules reverse-engineered from quotation_hd columns. */
export function computeTotals(i: {
  parts: number;
  service: number;
  /** Delivery lines (SVD0001) — legacy keeps them out of spare_part_amount but inside sum_exclude_amount */
  delivery?: number;
  discountType: string;
  discountValue: number;
  discountUnit: "บาท" | "%";
  vatRate: number;
}) {
  const sumExclude = i.parts + i.service + (i.delivery ?? 0);
  let baseForDiscount = sumExclude;
  if (i.discountType === "ส่วนลดค่าบริการ") baseForDiscount = i.service;
  else if (i.discountType === "ส่วนลดค่าอะไหล่") baseForDiscount = i.parts;
  else if (i.discountType === "ไม่มีส่วนลด") baseForDiscount = 0;
  const discount =
    i.discountType === "ไม่มีส่วนลด" ? 0 : i.discountUnit === "%" ? Math.round(baseForDiscount * i.discountValue) / 100 : Math.min(i.discountValue, baseForDiscount);
  const afterDiscount = sumExclude - discount;
  const totalBase = afterDiscount;
  const vat = Math.round(totalBase * i.vatRate) / 100;
  const total = totalBase + vat;
  const net = Math.round(total * 100) / 100;
  const rounding = Math.round((net - total) * 100) / 100;
  return { sumExclude, discount, afterDiscount, totalBase, vat, total, rounding, net };
}

export async function saveQuotation(i: QuotationInput, byUserId: number): Promise<QuotationDetail> {
  const cust = await getCustomerByCode(str(i.customerCode));
  if (!cust) throw new HttpError(400, "ต้องเลือกลูกค้า");
  const lines = (i.lines ?? []).filter((l) => str(l.code) || str(l.detail)).map((l, idx) => {
    const qty = num(l.qty) || 1;
    const price = num(l.unitPrice);
    const disc = num(l.discount);
    return { ...l, lineNumber: idx + 1, qty, unitPrice: price, discount: disc, total: Math.round((qty * price - disc) * 100) / 100 };
  });
  const parts = lines.filter((l) => (l.itemType ?? "SparePart") !== "Delivery").reduce((s, l) => s + l.total, 0);
  const delivery = lines.filter((l) => l.itemType === "Delivery").reduce((s, l) => s + l.total, 0);
  const service = num(i.serviceAmount);
  const discountType = str(i.discountType) || "ไม่มีส่วนลด";
  const discountValue = num(i.discountValue);
  const discountUnit: "บาท" | "%" = i.discountUnit === "%" ? "%" : "บาท";
  const vatRate = num(i.vatRate);
  const t = computeTotals({ parts, service, delivery, discountType, discountValue, discountUnit, vatRate });
  const statusId = i.status ? await statusIdByName(i.status) : QS.WAIT;
  const type = TYPE_VALUE[str(i.type)] ?? (str(i.type) || "Normal");
  // a quotation raised from a job is issued under the job's profile unless the user picked another
  const jobProfileId = !i.no && str(i.jobNo)
    ? (await db.select({ p: job.documentProfileId }).from(job).where(eq(job.jobNo, str(i.jobNo).toUpperCase())).limit(1))[0]?.p ?? undefined
    : undefined;

  const no = await db.transaction(async (tx) => {
    const values = {
      customerCode: cust.code,
      customerContactName: str(i.contactName).slice(0, 100),
      sparePartAmount: money(parts),
      serviceAmount: money(service),
      sumExcludeAmount: money(t.sumExclude),
      discountType,
      discountFormula: discountType === "ไม่มีส่วนลด" ? "0%" : `${discountValue}${discountUnit}`,
      discountAmount: money(t.discount),
      afterDiscountAmount: money(t.afterDiscount),
      totalBaseAmount: money(t.totalBase),
      vatRate,
      vatAmount: money(t.vat),
      totalAmount: money(t.total),
      roundingAmount: money(t.rounding),
      netAmount: money(t.net),
      remark: str(i.remark),
      referenceJobNo: str(i.jobNo).slice(0, 50),
      quotationStatusId: statusId,
      customerApproveRemark: str(i.approveRemark).slice(0, 100),
      quotationType: type,
    };
    let no = i.no;
    if (no) {
      const [prev] = await tx.select().from(quotationHd).where(eq(quotationHd.quotationNo, no));
      if (!prev) throw new HttpError(404, "ไม่พบใบเสนอราคา " + no);
      const upd = {
        ...values,
        customerApproveDate: AGREED.has(statusId) && !AGREED.has(prev.quotationStatusId ?? 0) ? nowThai() : prev.customerApproveDate,
        // ยกเลิกใบเสนอราคา = INACTIVE (still listed with its status); DELETED only via records API
        ...statusStamp(statusId === QS.CANCELLED ? RS.INACTIVE : RS.ACTIVE, byUserId),
      };
      await tx.update(quotationHd).set(upd).where(eq(quotationHd.quotationNo, no));
      await tx.delete(quotationDt).where(eq(quotationDt.quotationNo, no));
      const statusName = (await quotationStatuses()).find((q) => q.id === statusId)?.name ?? "";
      await audit(tx, byUserId, {
        action: prev.quotationStatusId !== statusId ? "STATUS" : "UPDATE",
        module: "Quotation",
        entity: "quotation_hd",
        key: no,
        summary: prev.quotationStatusId !== statusId ? `สถานะใบเสนอราคา → ${statusName}` : `แก้ไขใบเสนอราคา · ${lines.length} รายการ · ${t.net.toFixed(2)} บาท`,
        changes: diff(prev as Record<string, unknown>, upd as Record<string, unknown>, { skip: ["customerApproveDate"] }),
      });
    } else {
      const profile = await issuingProfile(i.documentProfileId ?? jobProfileId);
      no = await nextRunningNo(tx, "Quotation");
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
        action: "CREATE",
        module: "Quotation",
        entity: "quotation_hd",
        key: no,
        summary: `สร้างใบเสนอราคา · งาน ${values.referenceJobNo || "-"} · ${lines.length} รายการ · ${t.net.toFixed(2)} บาท`,
      });
    }
    if (lines.length) {
      await tx.insert(quotationDt).values(
        lines.map((l) => ({
          quotationNo: no!,
          lineNumber: l.lineNumber,
          itemType: l.itemType ?? "SparePart",
          itemCode: str(l.code).slice(0, 50),
          itemDetail: str(l.detail).slice(0, 100),
          quantity: String(l.qty),
          unit: (str(l.unit) || "หน่วย").slice(0, 10),
          unitPrice: l.unitPrice.toFixed(2),
          unitPriceDiscount: l.discount.toFixed(2),
          totalPrice: l.total.toFixed(2),
          unitPriceDiscountPercent: num(l.discountPercent).toFixed(2),
        }))
      );
    }
    // customer agreed → remember the approved quotation on the job (no status sync — decided 2026-09-15)
    if (AGREED.has(statusId) && values.referenceJobNo) {
      await tx.update(job).set({ quotationNoApproved: no }).where(eq(job.jobNo, values.referenceJobNo));
    }
    return no!;
  });
  return (await getQuotation(no))!;
}

export { sql };
