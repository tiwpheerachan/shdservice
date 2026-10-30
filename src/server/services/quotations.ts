import 'server-only';
import { cached } from '@/server/cache';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  ne,
  not,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias, type PgSelect } from 'drizzle-orm/pg-core';
import { db, writeTx } from '@/db/client';
import { JS, QS } from '@/lib/status-ids';
import { QUOTE_VALID_DAYS } from '@/lib/company';
import { addDays, today } from '@/lib/dates';
import { quoteExpired } from '@/lib/quote-expiry';
import { MAX_EXPORT_ROWS } from '@/lib/export-limit';
import { appUser, brand, customer, job, model, product, quotation, quotationLine, quotationStatus } from '@/db/schema';
import type { Customer, Quotation } from '@/data/types';
import { HttpError, fullName } from '@/server/auth';
import { assertVersion } from '@/server/http-error';
import { nextRunningNo } from '@/db/running-no';
import { audit, diff } from '@/server/audit';
import { orderBy, likeTerm, offsetOf, totalOf, ymd, type Page, type PageQuery } from '@/server/paging';
import { fmtDateTime, money, nowThai, num, str, type FieldData } from '@/server/mappers/format';
import { customerForDocument, getCustomerById } from './customers';
import { issuingProfile, profileIdOf } from './document-profiles';
import { followQuotation, getJob, jobModelName, jobStatuses } from './jobs';
import { JOB_CLOSED_STATUSES } from './stock';
import { RS, statusFilter, statusStamp, type StatusMode } from '@/server/record-status';
import { computeTotals, lineAmount, parseDiscount, quotationSchema, quotedPartsKey } from '@/lib/validation/quotation';
import { clean, cleanCode, cleanText } from '@/lib/validation';
import { assertValid } from '@/server/validate';
import { assertFiguresEditable, isLegacyRow } from '@/server/legacy-lock';
import { z } from 'zod';
import type { quotationSave } from '@/server/contract/sales';

/** quotation_status ids (from the dump) */
export { QS };
const AGREED = new Set<number>([QS.AGREED, QS.AGREED_WAIT_PAY, QS.AGREED_WAIT_PARTS]);
const EXPIRED_NAME = 'พ้นกำหนดเสนอราคา';
/** the quotation a legacy job names as agreed (job.approved_quotation_pk — legacy snapshot, new rows NULL: the agreed
 *  quotation of a job is the one with its job_pk in an agreed status, ux_quotation_agreed_job) */
const approvedHd = alias(quotation, 'approved_hd');

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
  id: quotation.id,
  no: quotation.quotationNo,
  date: quotation.createDate,
  type: quotation.quotationType,
  customerCode: customer.customerCode,
  customer: customer.customerName,
  jobRef: job.jobNo,
  imei: job.productImeiNo,
  brand: brand.brandName,
  modelName: jobModelName, // the model's name (product_model_name: legacy rows only) — needs the model join
  amount: quotation.netAmount,
  status: quotationStatus.quotationStatusName,
  statusId: quotation.quotationStatusId,
  active: quotation.recordStatus,
  warranty: job.productWarranty,
  parts: quotation.sparePartAmount,
  service: quotation.serviceAmount,
  discount: quotation.discountAmount,
  vat: quotation.vatAmount,
  approveDate: quotation.customerApproveDate,
  jobStatusId: job.jobStatusId,
  createBy: appUser.firstName,
  createByLast: appUser.lastName,
};
type ListRow = { [K in keyof typeof listSelect]: FieldData<(typeof listSelect)[K]> | null };

function toQuotation(r: ListRow): Quotation {
  return {
    id: r.id ?? '',
    no: r.no ?? '',
    date: fmtDateTime(r.date),
    type: TYPE_LABEL[r.type?.trim() ?? 'Normal'] ?? 'Type A (Normal)',
    customer: r.customer ?? r.customerCode ?? '',
    jobRef: r.jobRef ?? '',
    imei: r.imei ?? '',
    brandModel: [r.brand, r.modelName].filter(Boolean).join(' '),
    amount: num(r.amount),
    // sent but past its validity reads as expired — the list, its filter (quotationWhere) and the export alike
    status: quoteExpired(r.statusId, r.date, r.jobStatusId) ? EXPIRED_NAME : (r.status?.trim() ?? ''),
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
    .leftJoin(customer, eq(customer.pk, quotation.customerPk))
    .leftJoin(job, eq(job.pk, quotation.jobPk))
    // the brand is the model's (job.brand_manufacturer_pk was a copy of it, dropped in drizzle/0006)
    .leftJoin(model, eq(model.pk, job.modelPk))
    .leftJoin(brand, eq(brand.pk, model.brandPk))
    .leftJoin(quotationStatus, eq(quotationStatus.quotationStatusId, quotation.quotationStatusId))
    .leftJoin(appUser, eq(appUser.pk, quotation.createdByAppUserPk));

const base = () => withQuotationJoins(db.select(listSelect).from(quotation).$dynamic());

const SORT = {
  no: quotation.quotationNo,
  date: quotation.createDate,
  customer: customer.customerName,
  jobRef: job.jobNo,
  amount: quotation.netAmount,
  status: quotation.quotationStatusId,
  type: quotation.quotationType,
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
  /** the list's text boxes — each its own condition (contains), ANDed with the rest */
  no?: string;
  customer?: string;
  customerCode?: string;
  imei?: string;
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
  no: f.no,
  customer: f.customer,
  customerCode: f.customerCode,
  imei: f.imei,
});

const contains = (col: Parameters<typeof ilike>[0], v?: string) =>
  v?.trim() ? ilike(col, likeTerm(v.trim())) : undefined;

/** quoteExpired (src/lib/quote-expiry.ts) in SQL: sent, and created before the validity window or its job says so */
const sentExpired = () =>
  and(
    eq(quotation.quotationStatusId, QS.SENT),
    or(
      lt(quotation.createDate, `${addDays(today(), -QUOTE_VALID_DAYS)} 00:00:00`),
      eq(job.jobStatusId, JS.QUOTE_EXPIRED),
    ),
  );

export function quotationWhere(q: string, f: QuotationFilters) {
  const term = q.trim();
  const status = f.status?.trim();
  const from = ymd(f.from),
    to = ymd(f.to);
  return and(
    statusFilter(quotation.recordStatus, f.deleted ?? 'exclude'),
    term
      ? or(
          ilike(quotation.quotationNo, likeTerm(term)),
          ilike(job.jobNo, likeTerm(term)),
          ilike(customer.customerName, likeTerm(term)),
          ilike(customer.customerCode, likeTerm(term)),
          ilike(job.productImeiNo, likeTerm(term)),
        )
      : undefined,
    // trimmed: the table pads some names ("รอเสนอราคา" + 24 spaces) — an exact match misses them
    // the status as the list shows it: expired = stored พ้นกำหนด or sent past its validity (and no longer "sent")
    !status
      ? undefined
      : status === EXPIRED_NAME
        ? or(eq(quotation.quotationStatusId, QS.EXPIRED), sentExpired())
        : and(
            sql`trim(${quotationStatus.quotationStatusName}) = ${status}`,
            status === 'เสนอราคาแล้ว' ? not(sentExpired()!) : undefined,
          ),
    from ? gte(quotation.createDate, `${from} 00:00:00`) : undefined,
    to ? lte(quotation.createDate, `${to} 23:59:59`) : undefined,
    f.jobNo ? eq(job.jobNo, f.jobNo) : undefined,
    f.type
      ? eq(quotation.quotationType, f.type.includes('VIP') ? 'VIP' : f.type.includes('Normal') ? 'Normal' : f.type)
      : undefined,
    // ข้อมูลเครื่องมาจากงานที่อ้างถึง (job) — กรองที่ server ให้ครบทุกหน้า ไม่ใช่เฉพาะหน้าที่โหลด
    f.warranty ? eq(job.productWarranty, f.warranty) : undefined,
    f.brand ? eq(brand.brandName, f.brand) : undefined,
    contains(quotation.quotationNo, f.no),
    contains(customer.customerName, f.customer),
    contains(customer.customerCode, f.customerCode),
    contains(job.productImeiNo, f.imei),
  );
}

export async function pageQuotations(p: PageQuery, f: QuotationFilters): Promise<Page<Quotation>> {
  const w = quotationWhere(p.q, f);
  // count + page in parallel: the response takes max(count, rows) instead of their sum
  const [counted, rows] = await Promise.all([
    withQuotationJoins(db.select({ total: count() }).from(quotation).$dynamic()).where(w),
    base()
      .where(w)
      .orderBy(...orderBy(p.sort, SORT, [desc(quotation.createDate), desc(quotation.pk)]))
      .limit(p.pageSize)
      .offset(offsetOf(p)),
  ]);
  return { rows: rows.map(toQuotation), total: totalOf(counted), page: p.page, pageSize: p.pageSize };
}

export async function listQuotations(f: QuotationFilters & { q?: string; limit?: number } = {}): Promise<Quotation[]> {
  const rows = await base()
    .where(quotationWhere(f.q ?? '', f))
    .orderBy(desc(quotation.createDate))
    .limit(Math.min(f.limit ?? 5000, MAX_EXPORT_ROWS));
  return rows.map(toQuotation);
}

export type QuotationLine = {
  /** the line's uuid — an edit sends it back to keep this line */
  id: string;
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
  customerDetail: Awaited<ReturnType<typeof getCustomerById>>;
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
  /** ออกเอกสารในนาม — the document profile's uuid (legacy rows = SHD's) */
  documentProfileId: string;
  /** contact printed on the document ("ท่านสามารถติดต่อสอบถาม…") = the user who created the quotation */
  createdByPhone: string;
  createdByEmail: string;
  /** row_version (a line change bumps it too) — the edit page sends it back with its save */
  version: number;
  /** came from the legacy system: its money / quantity figures are System Admin's alone (legacy-lock.ts) */
  figuresLocked: boolean;
};

/**
 * A quotation's lines with the code each one prints: a product line's is its product's (item_code is NULL on new
 * product lines — ADR 0008 "no redundant data"; legacy lines keep theirs), a service / delivery line's is its text.
 */
const linesOf = (q: Pick<typeof db, 'select'>, quotationPk: SQL | number) =>
  q
    .select({
      ...getTableColumns(quotationLine),
      code: sql<string | null>`coalesce(${product.productCode}, ${quotationLine.itemCode})`,
    })
    .from(quotationLine)
    .leftJoin(product, eq(product.pk, quotationLine.productPk))
    .where(eq(quotationLine.quotationPk, quotationPk))
    .orderBy(asc(quotationLine.lineNumber), asc(quotationLine.pk));

/** the number of the quotation whose uuid is `id` (a link: page, API path, print) — null: none, or not a uuid */
export async function quotationNoOf(id: string): Promise<string | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [r] = await db
    .select({ no: quotation.quotationNo })
    .from(quotation)
    .where(eq(quotation.id, id.toLowerCase()))
    .limit(1);
  return r?.no ?? null;
}

export async function getQuotation(no: string): Promise<QuotationDetail | null> {
  // the list row, the whole header and the creator's contact in one read; the lines alongside
  const [[r], dts] = await Promise.all([
    withQuotationJoins(
      db
        .select({ ...listSelect, hd: quotation, creatorPhone: appUser.phoneNo, creatorEmail: appUser.emailAddress })
        .from(quotation)
        .$dynamic(),
    )
      .where(eq(quotation.quotationNo, no))
      .limit(1),
    linesOf(db, sql`(SELECT ${quotation.pk} FROM ${quotation} WHERE ${quotation.quotationNo} = ${no})`),
  ]);
  if (!r) return null;
  const { hd } = r;
  const [live, jb, profileId, figuresLocked] = await Promise.all([
    hd.customerPk ? getCustomerById(hd.customerPk) : null,
    r.jobRef ? getJob(r.jobRef) : null,
    profileIdOf(hd.documentProfilePk),
    isLegacyRow('quotation', hd.pk),
  ]);
  // the customer as the quotation prints it — one source: the snapshot taken when the customer agreed (its code /
  // contact from the customer row, when there is one), else the customer now
  const cust: Customer | null =
    hd.customerName != null
      ? {
          ...(live ?? { code: r.customerCode ?? '', email: '', line: '', status: 'Active' as const }),
          name: hd.customerName,
          address: hd.customerAddress ?? '',
          taxId: hd.customerTaxId ?? '',
          phone: hd.customerPhone ?? '',
        }
      : live;
  return {
    ...toQuotation(r),
    status: r.status?.trim() ?? '', // the form edits the stored status (the edit page derives "expired" itself)
    // customer_contact_name was dropped in drizzle/0006 (empty on every row) — kept in the response until clients drop it
    contactName: '',
    customerDetail: cust,
    job: jb,
    figuresLocked,
    lines: dts.map((d) => ({
      id: d.id,
      lineNumber: d.lineNumber ?? 0,
      itemType: (d.itemType as QuotationLine['itemType']) ?? 'SparePart',
      code: d.code ?? '',
      detail: d.itemDetail ?? '',
      qty: num(d.quantity),
      unit: 'หน่วย', // quotation_line.unit was 'หน่วย' on every row — dropped in drizzle/0006
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
    documentProfileId: profileId,
    createdByPhone: r.creatorPhone ?? '',
    createdByEmail: r.creatorEmail ?? '',
    version: hd.rowVersion,
  };
}

/** quotation.customer_* — the customer as they were when they agreed (lengths as the columns) */
const snapshotOf = (c: { name: string; address: string; taxId: string; phone: string }) => ({
  customerName: c.name.slice(0, 200),
  customerAddress: c.address.slice(0, 500),
  customerTaxId: c.taxId.slice(0, 20),
  customerPhone: c.phone.slice(0, 50),
});

/** the parsed body of POST /api/quotations (quotationSave in src/server/contract/sales.ts) */
export type QuotationInput = z.output<typeof quotationSave.body>;

/**
 * `isAdmin`: System Admin — the only one who may change what a quotation from the legacy system already recorded
 * (owner 2026-10-30, assertFiguresEditable): its lines' qty / price / discount (or delete them) and a service amount /
 * discount / VAT rate it holds. New lines, an empty figure filled in and the status flow stay everyone's; the totals
 * are then computed by the same formula from the lines (a recorded line counts with its stored figures). A save that
 * changes no figure keeps the stored totals (never recomputed).
 */
export async function saveQuotation(i: QuotationInput, byUserId: number, isAdmin = false): Promise<QuotationDetail> {
  // same rules as the form (lib/validation/quotation); an old quotation without a job may stay without one
  const [before] = i.no
    ? await db
        .select({ jobNo: job.jobNo })
        .from(quotation)
        .leftJoin(job, eq(job.pk, quotation.jobPk))
        .where(eq(quotation.quotationNo, i.no))
        .limit(1)
    : [];
  assertValid(quotationSchema(i.no ? (before?.jobNo ?? '') : undefined), i);
  const jobNo = cleanCode(i.jobNo); // stored upper-case
  const lines = (i.lines ?? [])
    .filter((l) => str(l.code) || str(l.detail))
    .map((l, idx) => {
      const qty = num(l.qty) || 1;
      const price = num(l.unitPrice);
      const discountPercent = num(l.discountPercent);
      const { discount, total } = lineAmount({ qty, unitPrice: price, discount: num(l.discount), discountPercent });
      return { ...l, lineNumber: idx + 1, qty, unitPrice: price, discount, discountPercent, total };
    });
  const service = num(i.serviceAmount);
  const discountType = str(i.discountType) || 'ไม่มีส่วนลด';
  const discountValue = num(i.discountValue);
  const discountUnit: 'บาท' | '%' = i.discountUnit === '%' ? '%' : 'บาท';
  const vatRate = num(i.vatRate);
  const statusId = i.status ? await statusIdByName(i.status) : QS.WAIT;
  const type = TYPE_VALUE[str(i.type)] ?? (str(i.type) || 'Normal');
  const dtRows = lines.map((l) => ({
    lineNumber: l.lineNumber,
    itemType: l.itemType ?? 'SparePart',
    itemCode: str(l.code).slice(0, 50),
    itemDetail: clean(l.detail),
    quantity: String(l.qty),
    unitPrice: l.unitPrice.toFixed(2),
    unitPriceDiscount: l.discount.toFixed(2),
    totalPrice: l.total.toFixed(2),
    unitPriceDiscountPercent: l.discountPercent.toFixed(2),
  }));

  const statusName = (await quotationStatuses()).find((q) => q.id === statusId)?.name ?? '';
  const no = await writeTx(async (tx) => {
    // checked under the locks, in the order quotation → job → customer → product (the running number is last):
    // a delete running now finishes first, or waits for this save
    // with the job number and customer code it names (the audit and messages show those, not the pks)
    const [cur] = i.no
      ? await tx
          .select({ hd: quotation, jobNo: job.jobNo, customerCode: customer.customerCode })
          .from(quotation)
          .leftJoin(job, eq(job.pk, quotation.jobPk))
          .leftJoin(customer, eq(customer.pk, quotation.customerPk))
          .where(eq(quotation.quotationNo, i.no))
          .for('update', { of: quotation })
      : [];
    const prev = cur?.hd;
    if (i.no && !prev) throw new HttpError(404, 'ไม่พบใบเสนอราคา ' + i.no);
    const [found] = jobNo
      ? await tx
          .select({
            pk: job.pk,
            profileId: job.documentProfilePk,
            statusId: job.jobStatusId,
            recordStatus: job.recordStatus,
          })
          .from(job)
          .where(eq(job.jobNo, jobNo))
          .for('update', { of: job })
      : [];
    if (jobNo && !found) throw new HttpError(400, 'ไม่พบหมายเลขงาน', { fields: { jobNo: `ไม่พบหมายเลขงาน ${jobNo}` } });
    // a quotation is raised for (or moved to) an open job only — not one closed, cancelled or the customer declined
    if (
      found &&
      found.pk !== prev?.jobPk &&
      (found.recordStatus === RS.DELETED || JOB_CLOSED_STATUSES.includes(found.statusId ?? -1))
    )
      throw new HttpError(
        409,
        // the name looked up after the lock: a row joined in the locking read is the one from before a wait
        `งาน ${jobNo} อยู่ในสถานะ "${(await jobStatuses()).find((s) => s.id === found.statusId)?.name || found.statusId}" (ปิดงาน ยกเลิก หรือลูกค้าไม่ตกลงซ่อม) — ออกใบเสนอราคาให้งานนี้ไม่ได้`,
      );
    const cust = await customerForDocument(tx, str(i.customerCode), prev?.customerPk);
    if (!cust) throw new HttpError(400, 'ต้องเลือกลูกค้า', { fields: { customerCode: 'ไม่พบลูกค้ารายนี้' } });
    // a deleted / Inactive product goes on no new line (owner 2026-10-21) — a code the quotation already had keeps it
    const old = prev ? await linesOf(tx, prev.pk) : [];
    const had = old.map((r) => str(r.code));
    const added = lines.map((l) => str(l.code).slice(0, 50)).filter((c) => c && !had.includes(c));
    // every added code locked (not only the off ones: a row being deleted now still reads ACTIVE until it commits)
    const prods = added.length
      ? await tx
          .select({ pk: product.pk, code: product.productCode, rs: product.recordStatus })
          .from(product)
          .where(inArray(product.productCode, added))
          .for('share')
      : [];
    const off = prods.find((p) => p.rs !== RS.ACTIVE);
    // a line's product_pk: an added code's product; a code the quotation had keeps the product its line named
    const pkOfCode = new Map<string, number | null>([
      ...old.map((r) => [str(r.code), r.productPk] as const),
      ...prods.map((p) => [p.code ?? '', p.pk] as const),
    ]);
    if (off)
      throw new HttpError(
        409,
        `รหัสสินค้า ${off.code} ${off.rs === RS.DELETED ? 'ถูกลบแล้ว' : 'ปิดใช้งาน (Inactive)'} — เลือกสินค้าอื่น`,
      );
    // the new-quotation form copied the job's quoted parts when it opened — they changed since → its copy is stale
    // (read under the job lock: part lines change under it)
    if (!i.no && jobNo && i.jobParts != null) {
      const j = await getJob(jobNo);
      if (j && quotedPartsKey(j.parts, type === 'VIP' ? 'B' : 'A') !== i.jobParts)
        throw new HttpError(409, `รายการอะไหล่ของงานเปลี่ยนแล้ว (${jobNo}) — โหลดใหม่ก่อนบันทึก`);
    }
    // a quotation raised from a job is issued under the job's profile unless the user picked another
    const jobProfileId = !i.no ? (found?.profileId ?? undefined) : undefined;
    let linesChanged = true;
    let statusChanged = true; // a new quotation, or another status than the stored one
    let wasAgreed = false;
    // each line the form sends ↔ the stored line it is, by the line's own id (none = a new line); a stored line whose
    // id is not sent is removed. Matched lines are updated IN PLACE (pk / uuid / an unchanged legacy item_code stay):
    // a legacy line never turns into a new row
    const used = new Set<number>();
    const matched = lines.map((l, row) => {
      if (!l.id) return undefined;
      const k = old.findIndex((o) => o.id === l.id);
      if (k < 0 || used.has(k)) {
        const m = 'รายการนี้ไม่ใช่ของใบเสนอราคานี้ (หรือซ้ำ) — โหลดหน้าใหม่แล้วแก้อีกครั้ง';
        throw new HttpError(400, m, { fields: { [`lines.${row}.code`]: m } });
      }
      used.add(k);
      return old[k];
    });
    // a recorded line the save leaves as it was (product, type, qty, price, discount): it keeps its stored figures — a legacy
    // rounding stays, and the totals below sum what is recorded
    const same = (k: number) => {
      const o = matched[k];
      const l = lines[k];
      return (
        !!o &&
        !!l &&
        str(o.code) === str(l.code).slice(0, 50) && // the same product (a swapped product changes the line)
        (o.itemType ?? 'SparePart') === (l.itemType ?? 'SparePart') &&
        num(o.quantity) === l.qty &&
        num(o.unitPrice) === l.unitPrice &&
        num(o.unitPriceDiscountPercent) === l.discountPercent &&
        // a % discount's บาท is derived from it (a legacy rounding may differ): only a บาท-only discount compares
        (!!l.discountPercent || num(o.unitPriceDiscount) === l.discount)
      );
    };
    lines.forEach((l, k) => {
      if (!same(k)) return;
      const o = matched[k]!;
      l.discount = num(o.unitPriceDiscount);
      l.total = num(o.totalPrice);
      Object.assign(dtRows[k]!, {
        quantity: o.quantity,
        unitPrice: o.unitPrice,
        unitPriceDiscount: o.unitPriceDiscount,
        totalPrice: o.totalPrice,
        unitPriceDiscountPercent: o.unitPriceDiscountPercent,
      });
    });
    const parts = lines.filter((l) => (l.itemType ?? 'SparePart') !== 'Delivery').reduce((s, l) => s + l.total, 0);
    const delivery = lines.filter((l) => l.itemType === 'Delivery').reduce((s, l) => s + l.total, 0);
    const t = computeTotals({ parts, service, delivery, discountType, discountValue, discountUnit, vatRate });
    // the discount as the form reads the stored one (legacy "200บาท" / "10%") — what it sends back unchanged
    const was = prev && parseDiscount(prev.discountType ?? 'ไม่มีส่วนลด', prev.discountFormula ?? '');
    const discountChanged =
      !!was &&
      (was.value > 0 || discountValue > 0) &&
      (was.type !== discountType || was.value !== discountValue || was.unit !== discountUnit);
    const linesSame = old.length === lines.length && lines.every((_, k) => same(k));
    // a matched line's changed columns, read as the audit diff reads them ("100" = "100.00", trimmed); its code as
    // printed (the product's on a product line) — an unchanged code keeps the stored item_code / product_pk
    const lineSets = dtRows.map((r, k) => (matched[k] ? diff({ ...matched[k], itemCode: matched[k].code }, r) : null));
    // what is already recorded changes: a recorded line (changed / deleted), or a service / discount / VAT it holds
    if (
      prev &&
      (old.some((_, i) => !used.has(i)) ||
        lines.some((_, k) => matched[k] && !same(k)) ||
        (num(prev.serviceAmount) !== 0 && num(prev.serviceAmount) !== service) ||
        (was!.value > 0 && discountChanged) ||
        ((prev.vatRate ?? 0) !== 0 && prev.vatRate !== vatRate))
    )
      await assertFiguresEditable({ isAdmin }, 'quotation', prev.pk);
    // no figure changed → the stored totals stay as they are
    const figuresChanged =
      !prev || !linesSame || num(prev.serviceAmount) !== service || discountChanged || (prev.vatRate ?? 0) !== vatRate;
    const figures = {
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
    };
    const values = {
      customerPk: cust.key,
      ...(figuresChanged ? figures : {}),
      remark: cleanText(i.remark),
      jobPk: found?.pk ?? null,
      quotationStatusId: statusId,
      customerApproveRemark: clean(i.approveRemark),
      quotationType: type,
    };
    // one agreed quotation per job (ux_quotation_agreed_job — deleted rows count too): checked before the write, under
    // the job's row lock taken above (found … FOR UPDATE), so two approvals at once queue there and the second gets
    // this 409 instead of the unique index's error
    if (AGREED.has(statusId) && found) {
      const [other] = await tx
        .select({ no: quotation.quotationNo })
        .from(quotation)
        .where(
          and(
            eq(quotation.jobPk, found.pk),
            i.no ? ne(quotation.quotationNo, i.no) : undefined,
            inArray(quotation.quotationStatusId, [...AGREED]),
          ),
        )
        .limit(1);
      if (other) throw new HttpError(409, `งานนี้มีใบเสนอราคาที่ลูกค้าตกลงแล้ว (${other.no}) — เปลี่ยนสถานะใบนั้นก่อน`);
    }
    let no = i.no;
    let hdPk: number;
    if (no && prev) {
      hdPk = prev.pk;
      // restored through the records page (Quotation del) — a status change here would stamp it ACTIVE
      if (prev.recordStatus === RS.DELETED) throw new HttpError(409, 'ใบเสนอราคานี้ถูกลบแล้ว แก้ไขไม่ได้');
      assertVersion(i.version, prev.rowVersion);
      linesChanged = used.size !== old.length || lines.some((_, k) => !matched[k] || lineSets[k]);
      statusChanged = prev.quotationStatusId !== statusId;
      wasAgreed = AGREED.has(prev.quotationStatusId ?? 0);
      // agreed (or its customer snapshot taken): the quotation is that customer's — another one would not match it
      if ((wasAgreed || prev.customerName != null) && prev.customerPk !== cust.key)
        throw new HttpError(
          409,
          'ใบเสนอราคานี้ลูกค้าตกลงแล้ว — เปลี่ยนลูกค้าไม่ได้ (ออกใบเสนอราคาใหม่ให้ลูกค้ารายอื่น)',
          {
            fields: { customerCode: 'ลูกค้าตกลงแล้ว — เปลี่ยนลูกค้าไม่ได้' },
          },
        );
      // the job points at its agreed quotation (and followed it): moving it would leave both jobs pointing at it
      if (wasAgreed && prev.jobPk != null && prev.jobPk !== found?.pk)
        throw new HttpError(
          409,
          `ใบเสนอราคานี้ลูกค้าตกลงแล้ว (งาน ${cur?.jobNo ?? ''}) — ย้ายไปงานอื่นไม่ได้ เปลี่ยนสถานะใบนี้ก่อน`,
        );
      const upd = {
        ...values,
        // the customer as they agreed — written once (the first agreement), never by a later edit; until then every
        // read takes the customer now (getQuotation)
        ...(AGREED.has(statusId) && !AGREED.has(prev.quotationStatusId ?? 0) && prev.customerName == null
          ? snapshotOf(cust)
          : {}),
        customerApproveDate:
          AGREED.has(statusId) && !AGREED.has(prev.quotationStatusId ?? 0) ? nowThai() : prev.customerApproveDate,
        // ยกเลิกใบเสนอราคา = INACTIVE (still listed with its status); DELETED only via records API. Stamped only when
        // the status moves: a re-save keeps record_status and who/when changed it
        ...(statusChanged ? statusStamp(statusId === QS.CANCELLED ? RS.INACTIVE : RS.ACTIVE, byUserId) : {}),
      };
      // only a save that changes something writes (and logs) anything — an unchanged re-save writes nothing
      const changes = diff(
        { ...prev, customerCode: cur?.customerCode ?? null, referenceJobNo: cur?.jobNo ?? null },
        { ...upd, customerCode: cust.code, referenceJobNo: jobNo || null },
        {
          skip: [
            'customerApproveDate',
            'customerPk',
            'jobPk',
            'customerName',
            'customerAddress',
            'customerTaxId',
            'customerPhone',
          ],
        },
      );
      const headerChanged = !!changes || statusChanged;
      if (headerChanged) await tx.update(quotation).set(upd).where(eq(quotation.pk, hdPk));
      if (headerChanged || linesChanged)
        await audit(tx, byUserId, {
          action: statusChanged ? 'STATUS' : 'UPDATE',
          module: 'Quotation',
          entity: 'quotation',
          key: no,
          // the customer's answer (ตกลง / ไม่ตกลง …) with its remark
          reason: statusChanged ? clean(i.approveRemark) || null : null,
          summary: statusChanged
            ? `สถานะใบเสนอราคา → ${statusName}`
            : `แก้ไขใบเสนอราคา · ${lines.length} รายการ · ${(figuresChanged ? t.net : num(prev.netAmount)).toFixed(2)} บาท`,
          // the customer and job as their codes (what the log showed before drizzle/0006), not their pks; the lines
          // before → after as sale orders log them ("P00291 x1 @100", a service line by its text)
          changes: linesChanged
            ? {
                ...changes,
                lines: [
                  old.map((o) => `${str(o.code) || clean(o.itemDetail)} x${num(o.quantity)} @${num(o.unitPrice)}`),
                  lines.map((l) => `${str(l.code) || clean(l.detail)} x${l.qty} @${l.unitPrice}`),
                ],
              }
            : changes,
        });
    } else {
      const profile = await issuingProfile(i.documentProfileId ?? jobProfileId);
      no = await nextRunningNo(tx, 'Quotation');
      const [ins] = await tx
        .insert(quotation)
        .values({
          ...values,
          ...(AGREED.has(statusId) ? snapshotOf(cust) : {}),
          documentProfilePk: profile.pk,
          quotationNo: no,
          createDate: nowThai(),
          createdByAppUserPk: byUserId,
          customerApproveDate: AGREED.has(statusId) ? nowThai() : null, // not agreed yet = NULL (no 1900 sentinel)
          ...statusStamp(statusId === QS.CANCELLED ? RS.INACTIVE : RS.ACTIVE, byUserId),
        })
        .returning({ pk: quotation.pk });
      hdPk = ins!.pk;
      await audit(tx, byUserId, {
        action: 'CREATE',
        module: 'Quotation',
        entity: 'quotation',
        key: no,
        summary: `สร้างใบเสนอราคา · งาน ${jobNo || '-'} · ${lines.length} รายการ · ${t.net.toFixed(2)} บาท`,
      });
    }
    if (linesChanged) {
      // a removed line goes; a matched one is updated in place, only the columns that changed; a new one is inserted
      const gone = old.filter((_, i) => !used.has(i)).map((o) => o.pk);
      if (gone.length) await tx.delete(quotationLine).where(inArray(quotationLine.pk, gone));
      for (const [k, r] of dtRows.entries()) {
        const set = lineSets[k];
        if (!matched[k] || !set) continue;
        const cols: Record<string, unknown> = Object.fromEntries(
          Object.keys(set).map((c) => [c, r[c as keyof typeof r]]),
        );
        if ('itemCode' in cols) {
          // another product on this line: its product_pk, and item_code NULL on a product line (as an insert)
          const productPk = pkOfCode.get(r.itemCode) ?? null;
          Object.assign(cols, { productPk, itemCode: productPk ? null : r.itemCode });
        }
        await tx.update(quotationLine).set(cols).where(eq(quotationLine.pk, matched[k].pk));
      }
      const added = dtRows.filter((_, k) => !matched[k]);
      if (added.length)
        await tx.insert(quotationLine).values(
          added.map((r) => {
            const productPk = pkOfCode.get(r.itemCode) ?? null;
            // a product line prints its product's code (item_code NULL); a service / delivery line keeps its text
            return { ...r, itemCode: productPk ? null : r.itemCode, productPk, quotationPk: hdPk };
          }),
        );
      // a line change is an edit of the quotation: its version moves (a stale edit page gets 409) — by exactly one:
      // set to the loaded version + 1, so a header this save already wrote (its trigger bumped it) is not bumped twice
      if (prev)
        await tx
          .update(quotation)
          .set({ rowVersion: prev.rowVersion + 1 })
          .where(eq(quotation.pk, hdPk));
    }
    // customer agreed → it is the job's agreed quotation (its status says so: job.approved_quotation_pk is a legacy
    // snapshot, no longer written). One agreed quotation per job, checked under the job's row lock (taken after the
    // quotation row, as followQuotation does) so two approvals at once queue and the second sees the first.
    // The job's history says when its agreed quotation changes; a legacy pointer at this quotation is cleared.
    const pointTo = async (jobNo: string, from: string, to: string) => {
      await tx
        .update(job)
        .set({ approvedQuotationPk: null })
        .where(and(eq(job.jobNo, jobNo), eq(job.approvedQuotationPk, hdPk)));
      await audit(tx, byUserId, {
        action: 'UPDATE',
        module: 'Job Management',
        entity: 'job',
        key: jobNo,
        summary: to
          ? `ใบเสนอราคาที่ลูกค้าตกลง → ${to}`
          : `ใบเสนอราคา ${from} ไม่ใช่ใบที่ลูกค้าตกลงแล้ว (${statusName})`,
        changes: { quotationNoApproved: [from, to] },
      });
    };
    if (AGREED.has(statusId) && found) {
      const [j] = await tx
        .select({ legacy: approvedHd.quotationNo, st: job.jobStatusId, rs: job.recordStatus })
        .from(job)
        .leftJoin(approvedHd, eq(approvedHd.pk, job.approvedQuotationPk))
        .where(eq(job.pk, found.pk))
        .for('update', { of: job });
      // agreeing now on a job already closed / cancelled / declined: the quotation would say agreed, the job not
      if (!wasAgreed && j && (j.rs === RS.DELETED || JOB_CLOSED_STATUSES.includes(j.st ?? -1)))
        throw new HttpError(
          409,
          `งาน ${jobNo} ปิดงาน ยกเลิก หรือลูกค้าไม่ตกลงซ่อมไปแล้ว — เปลี่ยนเป็นลูกค้าตกลงซ่อมไม่ได้ (เปิดงานกลับก่อน)`,
        );
      // the job's agreed quotation before this save: this one (already agreed on this job), else a legacy pointer
      const was = wasAgreed && prev?.jobPk === found.pk ? no! : (j?.legacy ?? '');
      if (was !== no) await pointTo(jobNo, was, no!);
    } else if (wasAgreed && !AGREED.has(statusId)) {
      // no longer agreed (declined / cancelled …) → its job (and a legacy job still naming it) has no agreed one
      const named = await tx
        .select({ jobNo: job.jobNo })
        .from(job)
        .where(or(eq(job.approvedQuotationPk, hdPk), prev?.jobPk != null ? eq(job.pk, prev.jobPk) : undefined))
        .for('update');
      for (const n of named) await pointTo(n.jobNo, no, '');
    }
    // sent / agreed moves the job forward (owner 2026-10-16) — only when the status was set now: an unchanged
    // re-save never touches the job
    if (statusChanged && jobNo) await followQuotation(tx, jobNo, no!, statusId, statusName, byUserId);
    return no!;
  });
  return (await getQuotation(no))!;
}

/** ใบเบิกสินค้า: at most this many quotations per print (one page each) */
export const PICK_SLIP_MAX = 50;

/**
 * ใบเบิกสินค้า (pick slip, legacy "พิมพ์ใบเบิกสินค้า" on the ticked quotations): one per quotation (`ids`: their
 * uuids), in the order asked — its spare-part lines only (service / delivery lines are not picked from stock), their
 * qty and amount; the totals box prints the quotation's stored amounts. Any status prints except a deleted or
 * ยกเลิกใบเสนอราคา one (owner 2026-10-29): those, unknown ids and any past PICK_SLIP_MAX come back in `skipped` with
 * the reason (`no`: the number, or the id asked when none is known).
 */
export async function pickSlips(ids: string[]) {
  const wanted = [...new Set(ids.map((n) => n.trim().toLowerCase()).filter(Boolean))];
  const nos = await Promise.all(wanted.slice(0, PICK_SLIP_MAX).map(quotationNoOf));
  const found = await Promise.all(nos.map((n) => (n ? getQuotation(n) : null)));
  const slips: { q: QuotationDetail; lines: QuotationLine[]; qty: number; parts: number }[] = [];
  const skipped: { no: string; why: string }[] = wanted
    .slice(PICK_SLIP_MAX)
    .map((no) => ({ no, why: `เกิน ${PICK_SLIP_MAX} ใบต่อครั้ง` }));
  found.forEach((q, k) => {
    const why = !q
      ? 'ไม่พบใบเสนอราคา'
      : !q.active
        ? 'ถูกลบแล้ว'
        : q.statusId === QS.CANCELLED
          ? 'ยกเลิกใบเสนอราคา'
          : '';
    if (why || !q) return void skipped.push({ no: nos[k] ?? wanted[k]!, why });
    const lines = q.lines.filter((l) => l.itemType === 'SparePart');
    slips.push({
      q,
      lines,
      qty: lines.reduce((s, l) => s + l.qty, 0),
      parts: Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100,
    });
  });
  return { slips, skipped };
}
