import 'server-only';
import { customerAddressSql } from '@/server/services/customers';
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, ne, or, sql, type AnyColumn } from 'drizzle-orm';
import { alias, type PgSelect } from 'drizzle-orm/pg-core';
import { db, withStatementTimeout, type Tx } from '@/db/client';
import {
  appUser,
  approveStatus,
  category,
  customer,
  job,
  jobPart,
  jobPartStatus,
  jobOutsource,
  jobStatus,
  jobType,
  brand,
  model,
  product,
  productCompatibleModel,
  productStock,
  productType,
  quotationLine,
  quotation,
  quotationStatus,
  saleOrderLine,
  saleOrder,
  storeLocation,
  symptom,
} from '@/db/schema';
import { AS, JS, QS, STORE_LOCATION_ID } from '@/lib/status-ids';
import { quoteExpired } from '@/lib/quote-expiry';
import { fmtDate, fmtDateTime, num } from '@/server/mappers/format';
import { likeTerm, offsetOf, totalOf, ymd, type Page, type PageQuery } from '@/server/paging';
import { RS } from '@/server/record-status';
import { isUuid } from '@/server/audit';
import { JOB_MODULES, SALE_ORDER_READERS } from '@/server/auth';
import type { Module } from '@/lib/modules';
import { REPORT_SPECS, type ReportKey, type ReportRow } from '@/app/(app)/reports/report-specs';
import {
  filtersFromQuery,
  jobModelIs,
  jobModelName,
  jobWhere,
  kpiGroup,
  mainSymptomPk,
  partsReplacedText,
  partsReplaceShown,
  type JobFilters,
} from './jobs';
import { quotationFiltersFromQuery, quotationWhere, withQuotationJoins, type QuotationFilters } from './quotations';
import {
  saleOrderFiltersFromQuery,
  saleOrderWhere,
  stockDoc,
  withSaleOrderJoins,
  type SaleOrderFilters,
} from './sale-orders';

/**
 * KPI tiles for the report screens — computed in one query over the SAME
 * filters the paged table uses, so the numbers cover the whole range even
 * though the table only shows a page.
 */
const eng = alias(appUser, 'eng');
/** a closed job's TAT as the dashboard / Excel / the report's TAT column count it (jobs.ts tatDays): opening → the
 *  return, else the close — calendar days */
const tatDays = sql`((case when ${job.jobReturnDate} > '1901-01-01' then ${job.jobReturnDate} else ${job.jobClosedDate} end)::date - ${job.jobCreateDate}::date)`;

async function jobBase(tx: Tx, f: JobFilters, q = '', raw: Raw = {}) {
  return tx
    .select({
      total: count(),
      fresh: sql<string>`count(*) filter (where ${job.jobStatusId} = ${JS.NEW})`,
      // ลูกค้าไม่ซ่อม (JS.REPAIR_CANCELLED) is not a successful repair — kpiGroup counts it as Cancel
      done: sql<string>`count(*) filter (where ${kpiGroup} in ('Repaired','Finished'))`,
      amount: sql<string>`coalesce(sum(${job.jobTotalCost}),0)`,
      // net, as the table's ยอดรับชำระ column adds up: a refund (คืนมัดจำ, a negative payment) counts too
      paid: sql<string>`coalesce(sum(${job.jobPaymentAmount}),0)`,
      tatSum: sql<string>`coalesce(sum(greatest(0, ${tatDays})) filter (where ${job.jobClosedDate} > '1901-01-01'),0)`,
      tatN: sql<string>`count(*) filter (where ${job.jobClosedDate} > '1901-01-01')`,
      over30: sql<string>`count(*) filter (where ${job.jobClosedDate} > '1901-01-01' and ${tatDays} > 30)`,
      minDate: sql<string>`min(${job.jobCreateDate})`,
      maxDate: sql<string>`max(${job.jobCreateDate})`,
    })
    .from(job)
    .leftJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
    .leftJoin(jobType, eq(jobType.pk, job.jobTypePk))
    .leftJoin(eng, eq(eng.pk, job.engineerAppUserPk))
    .where(jobReportWhere(q, f, raw));
}

/** `raw` = the query as sent: the legacy-only filters jobReportWhere reads (warranty=NONE, dateBy=forward) */
export async function jobReportSummary(f: JobFilters, q = '', raw: Raw = {}) {
  const { r, top } = await withStatementTimeout(async (tx) => {
    const [r] = await jobBase(tx, f, q, raw);
    const [top] = await tx
      .select({ channel: job.productSaleOutChannel, n: count() })
      .from(job)
      .leftJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
      .leftJoin(jobType, eq(jobType.pk, job.jobTypePk))
      .leftJoin(eng, eq(eng.pk, job.engineerAppUserPk))
      .where(jobReportWhere(q, f, raw))
      .groupBy(job.productSaleOutChannel)
      .orderBy(sql`count(*) desc`)
      .limit(1);
    return { r, top };
  });
  if (!r) throw new Error('aggregate returned no row'); // no GROUP BY → always exactly one row
  const total = Number(r.total);
  const tatN = num(r.tatN);
  return {
    total,
    fresh: num(r.fresh),
    done: num(r.done),
    amount: num(r.amount),
    paid: num(r.paid),
    avgTat: tatN ? Math.round((num(r.tatSum) / tatN) * 10) / 10 : 0,
    over30: num(r.over30),
    topChannel: top?.channel?.trim() || '—',
  };
}

export async function quotationReportSummary(f: QuotationFilters, q = '', raw: Raw = {}) {
  const agreed = inArray(quotation.quotationStatusId, [QS.AGREED, QS.AGREED_WAIT_PAY, QS.AGREED_WAIT_PARTS]);
  const [r] = await withStatementTimeout((tx) =>
    withQuotationJoins(
      tx
        .select({
          total: count(),
          agreed: sql<string>`count(*) filter (where ${agreed})`,
          // มูลค่ารวม leaves out cancelled quotations (QS.CANCELLED ยกเลิกใบเสนอราคา); the card shows that amount apart
          amount: sql<string>`coalesce(sum(${quotation.netAmount}) filter (where ${quotation.quotationStatusId} is distinct from ${QS.CANCELLED}),0)`,
          cancelledAmount: sql<string>`coalesce(sum(${quotation.netAmount}) filter (where ${quotation.quotationStatusId} = ${QS.CANCELLED}),0)`,
          agreedAmount: sql<string>`coalesce(sum(${quotation.netAmount}) filter (where ${agreed}),0)`,
        })
        .from(quotation)
        .$dynamic(),
    ).where(and(quotationWhere(q, f), quotationExtra(raw))),
  );
  if (!r) throw new Error('aggregate returned no row');
  return {
    total: Number(r.total),
    agreed: num(r.agreed),
    amount: num(r.amount),
    cancelledAmount: num(r.cancelledAmount),
    agreedAmount: num(r.agreedAmount),
  };
}

export async function saleOrderReportSummary(f: SaleOrderFilters, q = '', raw: Raw = {}) {
  const [r] = await withStatementTimeout((tx) =>
    withSaleOrderJoins(
      tx
        .select({
          total: count(),
          approved: sql<string>`count(*) filter (where ${saleOrder.approveStatusId} = ${AS.APPROVED})`,
          // ยอดขายรวม = approved orders only (AS.APPROVED อนุมัติแล้ว); waiting / rejected / denied are shown apart
          amount: sql<string>`coalesce(sum(${saleOrder.netAmount}) filter (where ${saleOrder.approveStatusId} = ${AS.APPROVED}),0)`,
          notApprovedAmount: sql<string>`coalesce(sum(${saleOrder.netAmount}) filter (where ${saleOrder.approveStatusId} is distinct from ${AS.APPROVED}),0)`,
        })
        .from(saleOrder)
        .$dynamic(),
    ).where(and(saleOrderWhere(q, f), saleExtra(raw))),
  );
  if (!r) throw new Error('aggregate returned no row');
  const approved = num(r.approved);
  const amount = num(r.amount);
  return {
    total: Number(r.total),
    approved,
    amount,
    notApprovedAmount: num(r.notApprovedAmount),
    avg: approved ? amount / approved : 0, // per approved order, like ยอดขายรวม
  };
}

/* ------------------------------------------------------------------ *
 * Row-level report tables (the legacy reports' columns: src/app/(app)/reports/report-specs.ts) — the screen's
 * page and the Excel / Word / PDF exports read the same reportPage, under the same filters as the KPIs above.
 * ------------------------------------------------------------------ */
type Raw = Record<string, string>;
type Q = { rows: Record<string, unknown>[]; total: number };

const opener = alias(appUser, 'r_opener');
const closer = alias(appUser, 'r_closer');
const qEng = alias(appUser, 'r_q_eng');
const keyer = alias(appUser, 'r_keyer');
const fromTo = (col: AnyColumn, f: Raw, a = 'from', b = 'to') => {
  const from = ymd(f[a]),
    to = ymd(f[b]);
  return and(from ? gte(col, `${from} 00:00:00`) : undefined, to ? lte(col, `${to} 23:59:59`) : undefined);
};
const has = (col: AnyColumn, v?: string) => (v?.trim() ? ilike(col, likeTerm(v.trim())) : undefined);
const fullNameSql = (u: { firstName: AnyColumn; lastName: AnyColumn }) =>
  sql<string>`concat_ws(' ', nullif(trim(${u.firstName}),''), nullif(trim(${u.lastName}),''))`;

/** jobWhere + what only the legacy reports filter by: Warranty "ยังไม่ได้ระบุ" (NONE) and วันที่ส่งต่อ (dateBy=forward:
 *  an out-source send in the range) */
function jobReportWhere(q: string, jf: JobFilters, raw: Raw) {
  const none = raw.warranty === 'NONE';
  const forward = raw.dateBy === 'forward';
  const sent = forward ? fromTo(jobOutsource.sendDate, raw) : undefined;
  return and(
    jobWhere(q, {
      ...jf,
      ...(none ? { warranty: undefined } : {}),
      ...(forward ? { from: undefined, to: undefined } : {}),
    }),
    none ? sql`coalesce(trim(${job.productWarranty}), '') not in ('IN', 'OUT')` : undefined,
    sent ? sql`exists (select 1 from ${jobOutsource} where ${jobOutsource.jobPk} = ${job.pk} and ${sent})` : undefined,
  );
}
const lastSend = (col: AnyColumn) =>
  sql<string | null>`(select max(${col}) from ${jobOutsource} where ${jobOutsource.jobPk} = ${job.pk})`;
/** TAT as the job list counts it: opening → the return, else the close, else today (calendar days) */
const rowTat =
  sql<number>`greatest(0, (case when ${job.jobReturnDate} > '1901-01-01' then ${job.jobReturnDate} when ${job.jobClosedDate} > '1901-01-01' then ${job.jobClosedDate} else now() at time zone 'Asia/Bangkok' end)::date - ${job.jobCreateDate}::date)`.mapWith(
    Number,
  );

async function jobRows(p: PageQuery, limit: number, offset: number): Promise<Q> {
  const w = jobReportWhere(p.q, filtersFromQuery(p.f), p.f);
  const joins = <T extends PgSelect>(x: T) =>
    x
      .leftJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
      .leftJoin(jobType, eq(jobType.pk, job.jobTypePk))
      .leftJoin(eng, eq(eng.pk, job.engineerAppUserPk));
  const [counted, rows] = await Promise.all([
    joins(db.select({ total: count() }).from(job).$dynamic()).where(w),
    joins(
      db
        .select({
          no: job.jobNo,
          openDate: job.jobCreateDate,
          openedBy: fullNameSql(opener),
          customerCode: customer.customerCode,
          customerName: customer.customerName,
          detail: job.customerDetail,
          phone: customer.phoneNumber,
          so: job.jobReferenceNo,
          soDate: job.productSaleOrderDate,
          serial: job.productSerial,
          imei: job.productImeiNo,
          brand: brand.brandName,
          model: jobModelName,
          productType: productType.productTypeName,
          warranty: job.productWarranty,
          bounce: job.isJobBounce,
          jobType: jobType.jobTypeName,
          jobTypeDetail: job.jobTypeDetail,
          outSent: lastSend(jobOutsource.sendDate),
          outReceived: lastSend(jobOutsource.receiveDate),
          symptom: symptom.symptomName,
          symptomOther: job.productSymptomOther,
          fault: job.productFault,
          equipment: job.productEquipment,
          remark: job.jobRemark,
          engineer: fullNameSql(eng),
          tracking: job.jobReceptionTrackingNo,
          partsCost: job.sparePartTotalCost,
          serviceCost: job.serviceCost,
          toolCost: job.serviceToolCost,
          deliveryCost: job.deliveryCost,
          boxCost: job.cartonBoxCost,
          totalCost: job.jobTotalCost,
          paid: job.jobPaymentAmount,
          status: jobStatus.jobStatusName,
          tat: rowTat,
          receptionDate: job.jobReceptionDate,
          partsReplaced: partsReplacedText,
          newSerialNo: job.newSerialNo,
          repairDetail: job.engineerRepairDetail,
          engineerRemark: job.engineerRemark,
          repairedDate: job.jobRepairedDate,
          closedBy: fullNameSql(closer),
          closedDate: job.jobClosedDate,
          paymentType: job.jobPaymentType,
          paymentNo: job.jobPaymentNo,
          paymentDetail: job.jobPaymentDetail,
        })
        .from(job)
        .$dynamic(),
    )
      .leftJoin(customer, eq(customer.pk, job.customerPk))
      .leftJoin(model, eq(model.pk, job.modelPk))
      .leftJoin(brand, eq(brand.pk, model.brandPk))
      .leftJoin(symptom, eq(symptom.pk, mainSymptomPk))
      .leftJoin(productType, eq(productType.pk, job.productTypePk))
      .leftJoin(opener, eq(opener.pk, job.createdByAppUserPk))
      .leftJoin(closer, eq(closer.pk, job.closedByAppUserPk))
      .where(w)
      .orderBy(desc(job.jobCreateDate), desc(job.jobNo))
      .limit(limit)
      .offset(offset),
  ]);
  return {
    total: totalOf(counted),
    rows: rows.map(({ newSerialNo, ...r }) => {
      // customer_detail = "code name phone" as it was at the opening — the fallback for a job with no customer row
      const [code = '', ...name] = (r.detail ?? '').trim().split(/\s+/);
      const phone = /^[\d+-]{6,}$/.test(name.at(-1) ?? '') ? name.pop() : '';
      return {
        ...r,
        openDate: fmtDateTime(r.openDate),
        customerCode: r.customerCode ?? code,
        customerName: r.customerName?.trim() || name.join(' '),
        phone: r.phone ?? phone,
        soDate: fmtDate(r.soDate),
        serial: r.serial?.trim() || r.imei || '',
        bounce: r.bounce ? 'Y' : 'N',
        outSent: fmtDateTime(r.outSent),
        outReceived: fmtDateTime(r.outReceived),
        status: r.status?.trim() ?? '',
        receptionDate: fmtDate(r.receptionDate),
        partsReplaced: partsReplaceShown({ sparePartReplace: r.partsReplaced, newSerialNo }),
        repairedDate: fmtDateTime(r.repairedDate),
        closedDate: fmtDateTime(r.closedDate),
      };
    }),
  };
}

/** quotation / quotation-detail filters beyond quotationWhere: รุ่น, วันที่เปิดงานซ่อม, วันที่ตกลงซ่อม */
const quotationExtra = (f: Raw) =>
  and(
    f.model ? jobModelIs(f.model) : undefined,
    fromTo(job.jobCreateDate, f, 'jobFrom', 'jobTo'),
    fromTo(quotation.customerApproveDate, f, 'agreedFrom', 'agreedTo'),
  );
const quotationReportWhere = (p: PageQuery) =>
  and(quotationWhere(p.q, quotationFiltersFromQuery(p.f, 'exclude')), quotationExtra(p.f));
/** the status as the quotation list shows it (sent past its validity = พ้นกำหนดเสนอราคา) */
const qStatus = (r: {
  statusId: number | null;
  date: string | null;
  jobStatusId: number | null;
  status: string | null;
}) => (quoteExpired(r.statusId, r.date, r.jobStatusId) ? 'พ้นกำหนดเสนอราคา' : (r.status?.trim() ?? ''));
const qHead = {
  no: quotation.quotationNo,
  date: quotation.createDate,
  status: quotationStatus.quotationStatusName,
  statusId: quotation.quotationStatusId,
  jobStatusId: job.jobStatusId,
  jobRef: job.jobNo,
  customerCode: customer.customerCode,
  // the snapshot taken when the customer agreed (drizzle/0006), else the customer as they are now
  customerName: sql<string | null>`coalesce(${quotation.customerName}, ${customer.customerName})`,
};
const qHeadOut = <T extends { [K in keyof typeof qHead]: unknown }>(r: T) => ({
  ...r,
  date: fmtDateTime(r.date as string | null),
  status: qStatus(r as never),
  customerDetail: [r.customerCode, (r.customerName as string | null)?.trim()].filter(Boolean).join(' : '),
});

async function quotationRows(p: PageQuery, limit: number, offset: number): Promise<Q> {
  const w = quotationReportWhere(p);
  const [counted, rows] = await Promise.all([
    withQuotationJoins(db.select({ total: count() }).from(quotation).$dynamic()).where(w),
    withQuotationJoins(
      db
        .select({
          ...qHead,
          brand: brand.brandName,
          model: jobModelName,
          serial: job.productSerial,
          symptom: symptom.symptomName,
          parts: sql<string>`(select string_agg(${quotationLine.itemDetail}, ', ' order by ${quotationLine.lineNumber}) from ${quotationLine} where ${quotationLine.quotationPk} = ${quotation.pk} and ${quotationLine.itemType} = 'SparePart')`,
          amount: quotation.netAmount,
          engineer: fullNameSql(qEng),
          remark: quotation.remark,
        })
        .from(quotation)
        .$dynamic(),
    )
      .leftJoin(symptom, eq(symptom.pk, mainSymptomPk))
      .leftJoin(qEng, eq(qEng.pk, job.engineerAppUserPk))
      .where(w)
      .orderBy(desc(quotation.createDate), desc(quotation.pk))
      .limit(limit)
      .offset(offset),
  ]);
  return { total: totalOf(counted), rows: rows.map(qHeadOut) };
}

async function quotationLineRows(p: PageQuery, limit: number, offset: number): Promise<Q> {
  const w = quotationReportWhere(p);
  const lines = <T extends PgSelect>(x: T) =>
    withQuotationJoins(x.innerJoin(quotation, eq(quotation.pk, quotationLine.quotationPk)));
  const [counted, rows] = await Promise.all([
    lines(db.select({ total: count() }).from(quotationLine).$dynamic()).where(w),
    lines(
      db
        .select({
          ...qHead,
          // the part's code now (product_pk); item_code = a service line's code / the legacy text
          itemCode: sql<string | null>`coalesce(${product.productCode}, ${quotationLine.itemCode})`,
          itemDetail: quotationLine.itemDetail,
          qty: quotationLine.quantity,
          unit: sql<string>`'หน่วย'`, // quotation_line.unit dropped (drizzle/0006): 'หน่วย' on every line
          unitPrice: quotationLine.unitPrice,
          totalPrice: quotationLine.totalPrice,
          jobRefNo: job.jobReferenceNo,
        })
        .from(quotationLine)
        .$dynamic(),
    )
      .leftJoin(product, eq(product.pk, quotationLine.productPk))
      .where(w)
      .orderBy(desc(quotation.createDate), desc(quotation.pk), asc(quotationLine.lineNumber))
      .limit(limit)
      .offset(offset),
  ]);
  return { total: totalOf(counted), rows: rows.map(qHeadOut) };
}

/** สร้างโดย = who keyed the order in (document_create_by) — saleOrderWhere's `sales` is the seller */
const saleExtra = (f: Raw) =>
  isUuid(f.createdBy ?? '') // the user's uuid (ADR 0008); anything else = no filter, as before
    ? inArray(
        saleOrder.createdByAppUserPk,
        db.select({ id: appUser.pk }).from(appUser).where(eq(appUser.id, f.createdBy!.trim().toLowerCase())),
      )
    : undefined;
const saleReportWhere = (p: PageQuery) =>
  and(saleOrderWhere(p.q, saleOrderFiltersFromQuery(p.f, 'exclude')), saleExtra(p.f));
const soHead = {
  no: saleOrder.saleOrderNo,
  date: saleOrder.documentCreateDate,
  customerCode: customer.customerCode, // withSaleOrderJoins joins the customer
  // the snapshot taken at approval, else (a draft / waiting order) the customer now
  customerName: sql<string | null>`coalesce(${saleOrder.customerName}, ${customer.customerName})`,
  createdBy: fullNameSql(keyer),
  approve: approveStatus.approveNameTh,
  rs: saleOrder.recordStatus,
};
/** as the sale-order list labels it: cancelled = ยกเลิก, approve_status 3 "แก้ไขข้อมูล" = ส่งกลับแก้ไข */
const soOut = <T extends { date: string | null; approve: string | null; rs: string | null }>({
  rs,
  approve,
  ...r
}: T) => ({
  ...r,
  date: fmtDateTime(r.date),
  status: rs === RS.DELETED ? 'ยกเลิก' : approve?.trim() === 'แก้ไขข้อมูล' ? 'ส่งกลับแก้ไข' : (approve?.trim() ?? ''),
});

async function saleRows(p: PageQuery, limit: number, offset: number): Promise<Q> {
  const w = saleReportWhere(p);
  const [counted, rows] = await Promise.all([
    withSaleOrderJoins(db.select({ total: count() }).from(saleOrder).$dynamic()).where(w),
    withSaleOrderJoins(
      db
        .select({
          ...soHead,
          // the customer's address now (customers.ts composes it the same way the customer screens show it)
          address: sql<string | null>`coalesce(${saleOrder.customerAddress}, ${customerAddressSql})`,
          phone: sql<string | null>`coalesce(${saleOrder.customerPhoneNumber}, ${customer.phoneNumber})`,
          base: saleOrder.totalBaseAmount,
          vat: saleOrder.vatAmount,
          total: saleOrder.netAmount,
          remark: saleOrder.remark,
          approveDate: saleOrder.approveDate,
          stockDoc,
          tracking: saleOrder.deliveryTrackingNo,
          deliveryDate: saleOrder.deliveryDate,
        })
        .from(saleOrder)
        .$dynamic(),
    )
      .leftJoin(keyer, eq(keyer.pk, saleOrder.createdByAppUserPk))
      .where(w)
      .orderBy(desc(saleOrder.documentCreateDate), desc(saleOrder.pk))
      .limit(limit)
      .offset(offset),
  ]);
  return {
    total: totalOf(counted),
    rows: rows.map((r) => ({
      ...soOut(r),
      approveDate: fmtDateTime(r.approveDate),
      deliveryDate: fmtDateTime(r.deliveryDate),
    })),
  };
}

async function saleLineRows(p: PageQuery, limit: number, offset: number): Promise<Q> {
  const w = saleReportWhere(p);
  const lines = <T extends PgSelect>(x: T) =>
    withSaleOrderJoins(x.innerJoin(saleOrder, eq(saleOrder.pk, saleOrderLine.saleOrderPk)));
  const [counted, rows] = await Promise.all([
    lines(db.select({ total: count() }).from(saleOrderLine).$dynamic()).where(w),
    lines(
      db
        .select({
          ...soHead,
          // the part's code now (product_pk); product_code = a service line's code / the legacy text
          itemCode: sql<string | null>`coalesce(${product.productCode}, ${saleOrderLine.productCode})`,
          itemName: product.productName,
          qty: saleOrderLine.saleOutQuantity,
          unitPrice: saleOrderLine.saleOutPrice,
          amount: saleOrderLine.amount,
        })
        .from(saleOrderLine)
        .$dynamic(),
    )
      .leftJoin(keyer, eq(keyer.pk, saleOrder.createdByAppUserPk))
      .leftJoin(product, eq(product.pk, saleOrderLine.productPk))
      .where(w)
      .orderBy(desc(saleOrder.documentCreateDate), desc(saleOrder.pk), asc(saleOrderLine.listNo))
      .limit(limit)
      .offset(offset),
  ]);
  return { total: totalOf(counted), rows: rows.map(soOut) };
}

/** the job part log (job_part): every เบิก / ขอคืน / จ่ายแล้ว / คืนแล้ว line, dated by its request */
async function partLogRows(p: PageQuery, limit: number, offset: number): Promise<Q> {
  const f = p.f;
  const L = jobPart;
  const term = p.q.trim();
  const w = and(
    term ? or(has(product.productCode, term), has(product.productName, term), has(job.jobNo, term)) : undefined,
    f.code?.trim() ? or(has(product.productCode, f.code), has(product.productVendorCode, f.code)) : undefined,
    f.name?.trim() ? or(has(product.productName, f.name), has(product.productNameEn, f.name)) : undefined,
    has(job.jobNo, f.jobNo),
    f.status ? sql`trim(${jobPartStatus.jobPartStatusName}) = ${f.status.trim()}` : undefined,
    fromTo(L.requestDate, f),
  );
  const joins = <T extends PgSelect>(x: T) =>
    x
      .innerJoin(job, eq(job.pk, L.jobPk))
      .leftJoin(product, eq(product.pk, L.productPk))
      .leftJoin(jobPartStatus, eq(jobPartStatus.jobPartStatusId, L.jobPartStatusId));
  const [counted, rows] = await Promise.all([
    joins(db.select({ total: count() }).from(L).$dynamic()).where(w),
    joins(
      db
        .select({
          code: product.productCode,
          name: product.productName,
          nameEn: product.productNameEn,
          isQuotation: L.isQuotation,
          requestQty: L.requestQty,
          requestDate: L.requestDate,
          grantQty: L.grantQty,
          grantDate: L.grantDate,
          returnQty: L.returnQty,
          returnDate: L.returnDate,
          status: jobPartStatus.jobPartStatusName,
          jobNo: job.jobNo,
        })
        .from(L)
        .$dynamic(),
    )
      .where(w)
      .orderBy(desc(L.requestDate), desc(L.pk))
      .limit(limit)
      .offset(offset),
  ]);
  return {
    total: totalOf(counted),
    rows: rows.map((r) => ({
      ...r,
      isQuotation: r.isQuotation ? 'Y' : 'N',
      requestQty: r.requestQty ?? 0,
      grantQty: r.grantQty ?? 0,
      returnQty: r.returnQty ?? 0,
      requestDate: fmtDateTime(r.requestDate),
      grantDate: fmtDateTime(r.grantDate),
      returnDate: fmtDateTime(r.returnDate),
      status: r.status?.trim() ?? '',
    })),
  };
}

/** a product's models (product_compatible_model) — codes, and their names from the model master */
const modelsOf = (col: AnyColumn) =>
  sql<string>`(select string_agg(distinct ${col}, ', ') from ${productCompatibleModel} join ${model} on ${model.pk} = ${productCompatibleModel.modelPk} where ${productCompatibleModel.productPk} = ${product.pk})`;

/** the on-hand report: ACTIVE parts by default; สี + "และอะไหล่ที่ใช้ได้กับทุกสี" (allColors=1: no colour = fits all) */
async function onhandRows(p: PageQuery, limit: number, offset: number, cost: boolean): Promise<Q> {
  const f = p.f;
  const term = p.q.trim();
  const LOW = 3; // ใกล้หมด = 1..3, as the product list (stock.ts LOW_STOCK)
  const remain = sql`coalesce(${productStock.quantityRemain}, 0)`;
  const w = and(
    f.status === 'Inactive'
      ? eq(product.recordStatus, RS.INACTIVE)
      : f.status === 'Active'
        ? eq(product.recordStatus, RS.ACTIVE)
        : ne(product.recordStatus, RS.DELETED),
    term
      ? or(has(product.productCode, term), has(product.productVendorCode, term), has(product.productName, term))
      : undefined,
    has(product.productCode, f.sysCode),
    has(product.productVendorCode, f.mfgCode),
    f.name?.trim()
      ? or(has(product.productName, f.name), has(product.productNameEn, f.name), has(product.productNameCn, f.name))
      : undefined,
    f.category ? eq(category.categoryName, f.category) : undefined,
    f.brand ? eq(brand.brandName, f.brand) : undefined,
    // a รุ่น of another ยี่ห้อ than the one chosen: no rows (the job / quotation reports behave so by themselves)
    f.model
      ? sql`exists (select 1 from ${productCompatibleModel} join ${model} on ${model.pk} = ${productCompatibleModel.modelPk} where ${productCompatibleModel.productPk} = ${product.pk} and ${model.modelCode} = ${f.model}${f.brand ? sql` and ${model.brandPk} in (select ${brand.pk} from ${brand} where ${brand.brandName} = ${f.brand})` : sql``})`
      : undefined,
    f.color
      ? or(
          sql`trim(${product.forModelColor}) = ${f.color.trim()}`,
          f.allColors === '1' ? sql`coalesce(trim(${product.forModelColor}), '') = ''` : undefined,
        )
      : undefined,
    f.stock === 'in' ? sql`${remain} > ${LOW}` : undefined,
    f.stock === 'low' ? sql`${remain} between 1 and ${LOW}` : undefined,
    f.stock === 'out' ? sql`${remain} <= 0` : undefined,
  );
  const joins = <T extends PgSelect>(x: T) =>
    x
      .leftJoin(category, eq(category.pk, product.categoryPk))
      .leftJoin(brand, eq(brand.pk, product.brandPk))
      .leftJoin(productStock, eq(productStock.productPk, product.pk));
  const [counted, rows] = await Promise.all([
    joins(db.select({ total: count() }).from(product).$dynamic()).where(w),
    joins(
      db
        .select({
          code: product.productCode,
          mfgCode: product.productVendorCode,
          name: product.productName,
          description: product.productDescription,
          category: category.categoryName,
          brand: brand.brandName,
          modelCode: modelsOf(model.modelCode),
          modelName: modelsOf(model.modelName),
          color: product.forModelColor,
          available: productStock.quantityAvailable,
          used: productStock.quantityUsed,
          booking: productStock.quantityBooking,
          remain: productStock.quantityRemain,
          capitalPrice: productStock.capitalPrice,
          price: productStock.retailPrice,
          location: storeLocation.storeLocationName,
        })
        .from(product)
        .$dynamic(),
    )
      // the one store every stock row is in (product_stock.store_location_id dropped, drizzle/0006)
      .leftJoin(storeLocation, eq(storeLocation.storeLocationId, STORE_LOCATION_ID))
      .where(w)
      .orderBy(asc(product.productCode))
      .limit(limit)
      .offset(offset),
  ]);
  return {
    total: totalOf(counted),
    rows: rows.map(({ capitalPrice, ...r }) => ({
      ...r,
      available: r.available ?? 0,
      used: r.used ?? 0,
      booking: r.booking ?? 0,
      remain: r.remain ?? 0,
      price: num(r.price),
      // ราคาทุน: only for a user with Product Cost — left out of the row, not zeroed
      ...(cost ? { capitalPrice: num(capitalPrice) } : {}),
    })),
  };
}

/** the list a report's table reads, on top of Report (view on any one) — null = Report alone */
export const REPORT_READ: Record<ReportKey, readonly Module[] | null> = {
  open_job: JOB_MODULES,
  repair_job: JOB_MODULES,
  close_job: JOB_MODULES,
  quotation: ['Quotation'],
  quotation_detail: ['Quotation'],
  sale_order: SALE_ORDER_READERS,
  sale_order_detail: SALE_ORDER_READERS,
  product_used: null,
  product_onhand: null,
};
/** the module whose view (plus Export) a report's Excel / Word / PDF needs — as the report pages always exported */
export const REPORT_MODULE: Record<ReportKey, Module> = {
  open_job: 'Job Management',
  repair_job: 'Job Management',
  close_job: 'Job Management',
  quotation: 'Quotation',
  quotation_detail: 'Quotation',
  sale_order: 'Sale Order',
  sale_order_detail: 'Sale Order',
  product_used: 'Report',
  product_onhand: 'Product',
};

/**
 * One page of a report's rows, each with its running number `idx` and every value a string or a number (what the
 * spec's columns read). `cost` = the user may see ราคาทุน (canSeeCost). The exports call it with one page of
 * MAX_EXPORT_ROWS.
 */
export async function reportPage(report: ReportKey, p: PageQuery, cost = false): Promise<Page<ReportRow>> {
  const offset = offsetOf(p);
  const run = (): Promise<Q> => {
    switch (report) {
      case 'open_job':
      case 'repair_job':
      case 'close_job':
        return jobRows(p, p.pageSize, offset);
      case 'quotation':
        return quotationRows(p, p.pageSize, offset);
      case 'quotation_detail':
        return quotationLineRows(p, p.pageSize, offset);
      case 'sale_order':
        return saleRows(p, p.pageSize, offset);
      case 'sale_order_detail':
        return saleLineRows(p, p.pageSize, offset);
      case 'product_used':
        return partLogRows(p, p.pageSize, offset);
      case 'product_onhand':
        return onhandRows(p, p.pageSize, offset, cost);
    }
  };
  const { rows, total } = await run();
  const cols = REPORT_SPECS[report].cols;
  return {
    rows: rows.map((r, i) => {
      const out: ReportRow = {};
      for (const c of cols) {
        if (c.cost && !cost) continue;
        const v = r[c.key];
        out[c.key] = c.money || c.num ? num(v as string | number | null) : v == null ? '' : String(v).trim();
      }
      out.idx = offset + i + 1;
      return out;
    }),
    total,
    page: p.page,
    pageSize: p.pageSize,
  };
}
