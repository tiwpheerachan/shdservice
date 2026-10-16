import 'server-only';
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, type Tx } from '@/db/client';
import { appUser, approveStatus, product, productNoneSerial, saleOutDt, saleOutHd } from '@/db/schema';
import type { SaleOrder } from '@/data/mock';
import { HttpError, fullName, hasRight, rolesWithRight, type CurrentUser } from '@/server/auth';
import { ADMIN_USER_TYPE } from '@/lib/modules';
import { assertVersion } from '@/server/http-error';
import { nextRunningNo } from '@/db/running-no';
import { audit, diff } from '@/server/audit';
import { orderBy, likeTerm, offsetOf, totalOf, ymd, type Page, type PageQuery } from '@/server/paging';
import { fmtDateTime, money, nowThai, num, str, SENTINEL_TS } from '@/server/mappers/format';
import { getCustomerByCode, addressNames } from './customers';
import { issuingProfile, SHD_PROFILE_ID } from './document-profiles';
import { issueForSaleOrder, productsChanged } from './stock';
import { RS, statusFilter, type StatusMode } from '@/server/record-status';
import {
  cleanTracking,
  NOT_APPROVER,
  overpaidMessage,
  saleOrderSchema,
  SELF_APPROVE,
  SELF_APPROVE_SALES,
  SO_CANCELLED,
  SUBMIT_CREATOR_ONLY,
  WAITING_CREATOR_ONLY,
} from '@/lib/validation/sale-order';
import { trackingSchema } from '@/lib/validation/stock';
import { clean } from '@/lib/validation';
import { assertValid } from '@/server/validate';
import { staffOrKeep } from './users';

/** approve_status ids */
export const AS = { DRAFT: 1, WAIT: 2, REJECT: 3, APPROVED: 4, DENIED: 5 } as const;

// พนักงานขาย = sale_out_by (document_create_by = who keyed the order in). The SQL alias stays
// 'creator': reports.ts joins its own 'creator' for saleOrderWhere's name filter
const seller = alias(appUser, 'creator');
const approver = alias(appUser, 'approver');

const listSelect = {
  no: saleOutHd.saleOutHdNo,
  date: saleOutHd.documentCreateDate,
  customer: saleOutHd.customerName,
  customerCode: saleOutHd.customerCode,
  amount: saleOutHd.netAmount,
  salesFirst: seller.firstName,
  salesLast: seller.lastName,
  approve: approveStatus.approveNameTh,
  approveId: saleOutHd.approveStatusId,
  stockDoc: saleOutHd.referenceNo,
  tracking: saleOutHd.deliveryTrackingNo,
  paymentType: saleOutHd.paymentType,
  paymentAmount: saleOutHd.paymentAmount,
  status: saleOutHd.recordStatus,
  approveDate: saleOutHd.approveDate,
  approverFirst: approver.firstName,
  approverLast: approver.lastName,
  deliveryDate: saleOutHd.deliveryDate,
  remark: saleOutHd.remarkHd,
};
type ListRow = { [K in keyof typeof listSelect]: (typeof listSelect)[K]['_']['data'] | null };

/** approve_status 3 is named "แก้ไขข้อมูล" in the table — shown as what happened to the order */
const APPROVE_LABEL: Record<string, string> = { แก้ไขข้อมูล: 'ส่งกลับแก้ไข' };
const approveLabel = (name: string | null) => APPROVE_LABEL[name?.trim() ?? ''] ?? name?.trim() ?? '';

function toSaleOrder(r: ListRow): SaleOrder {
  return {
    no: r.no ?? '',
    date: fmtDateTime(r.date),
    customer: r.customer ?? '',
    amount: num(r.amount),
    sales: fullName(r.salesFirst, r.salesLast),
    approve: approveLabel(r.approve),
    stockDoc: r.stockDoc ?? '',
    tracking: r.tracking ?? '',
    approveId: r.approveId ?? 0,
    customerCode: r.customerCode ?? '',
    paymentType: r.paymentType ?? '',
    paymentAmount: num(r.paymentAmount),
    cancelled: r.status === RS.DELETED,
    approveDate: fmtDateTime(r.approveDate),
    approvedBy: fullName(r.approverFirst, r.approverLast),
    deliveryDate: fmtDateTime(r.deliveryDate),
    remark: r.remark ?? '',
  };
}

const base = () =>
  db
    .select(listSelect)
    .from(saleOutHd)
    .leftJoin(seller, eq(seller.userId, saleOutHd.saleOutBy))
    .leftJoin(approver, eq(approver.userId, saleOutHd.approveBy))
    .leftJoin(approveStatus, eq(approveStatus.approveStatusId, saleOutHd.approveStatusId));

const SORT = {
  no: saleOutHd.saleOutHdNo,
  date: saleOutHd.documentCreateDate,
  customer: saleOutHd.customerName,
  amount: saleOutHd.netAmount,
  sales: seller.firstName,
  approve: saleOutHd.approveStatusId,
  stockDoc: saleOutHd.referenceNo,
  tracking: saleOutHd.deliveryTrackingNo,
};

export type SaleOrderFilters = {
  approve?: string;
  from?: string;
  to?: string;
  sales?: string;
  deleted?: StatusMode;
  /** the list page's own boxes — each its own condition (they used to be folded into one `q`) */
  no?: string;
  customer?: string;
  /** a part / accessory code on one of the order's lines */
  code?: string;
};

export function saleOrderWhere(q: string, f: SaleOrderFilters) {
  const term = q.trim();
  const from = ymd(f.from),
    to = ymd(f.to);
  return and(
    statusFilter(saleOutHd.recordStatus, f.deleted ?? 'exclude'),
    term
      ? or(
          ilike(saleOutHd.saleOutHdNo, likeTerm(term)),
          ilike(saleOutHd.customerName, likeTerm(term)),
          ilike(saleOutHd.customerCode, likeTerm(term)),
          ilike(saleOutHd.customerPhoneNumber, likeTerm(term)),
          ilike(saleOutHd.deliveryTrackingNo, likeTerm(term)),
        )
      : undefined,
    f.no?.trim() ? ilike(saleOutHd.saleOutHdNo, likeTerm(f.no.trim())) : undefined,
    f.customer?.trim()
      ? or(
          ilike(saleOutHd.customerName, likeTerm(f.customer.trim())),
          ilike(saleOutHd.customerCode, likeTerm(f.customer.trim())),
        )
      : undefined,
    f.code?.trim()
      ? sql`exists (select 1 from sale_out_dt d where d.sale_out_hd_no = ${saleOutHd.saleOutHdNo} and d.product_code ilike ${likeTerm(f.code.trim())})`
      : undefined,
    f.approve
      ? eq(
          approveStatus.approveNameTh,
          Object.keys(APPROVE_LABEL).find((k) => APPROVE_LABEL[k] === f.approve) ?? f.approve,
        )
      : undefined,
    from ? gte(saleOutHd.documentCreateDate, `${from} 00:00:00`) : undefined,
    to ? lte(saleOutHd.documentCreateDate, `${to} 23:59:59`) : undefined,
    f.sales
      ? /^\d+$/.test(f.sales)
        ? eq(saleOutHd.saleOutBy, Number(f.sales))
        : ilike(seller.firstName, likeTerm(f.sales))
      : undefined,
  );
}

export async function pageSaleOrders(p: PageQuery, f: SaleOrderFilters): Promise<Page<SaleOrder>> {
  const w = saleOrderWhere(p.q, f);
  // count + page in parallel: the response takes max(count, rows) instead of their sum
  const [counted, rows] = await Promise.all([
    db
      .select({ total: count() })
      .from(saleOutHd)
      .leftJoin(seller, eq(seller.userId, saleOutHd.saleOutBy))
      .leftJoin(approveStatus, eq(approveStatus.approveStatusId, saleOutHd.approveStatusId))
      .where(w),
    base()
      .where(w)
      .orderBy(...orderBy(p.sort, SORT, [desc(saleOutHd.documentCreateDate), desc(saleOutHd.saleOutHdId)]))
      .limit(p.pageSize)
      .offset(offsetOf(p)),
  ]);
  return { rows: rows.map(toSaleOrder), total: totalOf(counted), page: p.page, pageSize: p.pageSize };
}

export async function listSaleOrders(f: SaleOrderFilters & { q?: string; limit?: number } = {}): Promise<SaleOrder[]> {
  const rows = await base()
    .where(saleOrderWhere(f.q ?? '', f))
    .orderBy(desc(saleOutHd.documentCreateDate))
    .limit(Math.min(f.limit ?? 5000, 20000));
  return rows.map(toSaleOrder);
}

export type SaleOrderLine = {
  id?: number;
  listNo: number;
  productId: number;
  code: string;
  name: string;
  type: 'SparePart' | 'Service';
  qty: number;
  unit: string;
  price: number;
  amount: number;
  picked: string;
};

export type SaleOrderDetail = SaleOrder & {
  customerDetail: {
    code: string;
    taxId: string;
    name: string;
    address: string;
    phone: string;
    line: string;
    email: string;
    /** ตำบล / อำเภอ / จังหวัด names from the customer master (blank when the customer has no province picked) — for the shipping label's "ต. อ. จ." line */
    subDistrict: string;
    district: string;
    province: string;
  };
  lines: SaleOrderLine[];
  totalBase: number;
  fee: number;
  slip: string;
  approveRemark: string;
  /** who keyed the order in (document_create_by) — `sales` is the salesperson (sale_out_by) */
  createdBy: string;
  createdById: number;
  /** document_create_by + sale_out_by — neither may decide on the order (System Admin may) */
  creatorIds: number[];
  /** a waiting order: the roles that may decide on it (ticked SO Approve; System Admin always may, not listed) */
  approverRoles: string[];
  /** ออกเอกสารในนาม — document_profile.id (legacy rows = SHD) */
  documentProfileId: number;
  /** row_version + newest line id (versionOf) — the edit page sends it back with its save / decision */
  version: number;
  /** sale_out_by — the edit form picks the salesperson by id (a name may have changed or left) */
  salesId: number;
};

const linesOf = (x: Tx, no: string) =>
  x
    .select()
    .from(saleOutDt)
    .where(eq(saleOutDt.saleOutHdNo, no))
    .orderBy(asc(saleOutDt.listNo), asc(saleOutDt.saleOutDtId));

/**
 * The version an edit / approval sends back: row_version + the newest line id. A line-only edit
 * re-inserts the lines (new, higher ids) and may leave the header as it was, so row_version alone let
 * two line edits overwrite each other and an approval issue stock for lines it never showed. Both
 * parts only grow, so any save moves the sum.
 */
const versionOf = (rowVersion: number, lines: { saleOutDtId: number }[]) =>
  rowVersion + Math.max(0, ...lines.map((l) => l.saleOutDtId));

export async function getSaleOrder(no: string): Promise<SaleOrderDetail | null> {
  const [r] = await base().where(eq(saleOutHd.saleOutHdNo, no)).limit(1);
  if (!r) return null;
  const [hd] = await db.select().from(saleOutHd).where(eq(saleOutHd.saleOutHdNo, no)).limit(1);
  if (!hd) return null; // deleted between the two reads
  const dts = await db
    .select({ d: saleOutDt, name: product.productName })
    .from(saleOutDt)
    .leftJoin(product, eq(product.productId, saleOutDt.productId))
    .where(eq(saleOutDt.saleOutHdNo, no))
    .orderBy(asc(saleOutDt.listNo), asc(saleOutDt.saleOutDtId));
  const cust = hd.customerCode ? await getCustomerByCode(hd.customerCode) : null;
  const { subDistrict, district, province } = await addressNames(cust);
  const [made] =
    (hd.documentCreateBy ?? 0) > 0
      ? await db
          .select({ first: appUser.firstName, last: appUser.lastName })
          .from(appUser)
          .where(eq(appUser.userId, hd.documentCreateBy!))
      : [];
  return {
    ...toSaleOrder(r),
    customerDetail: {
      code: hd.customerCode ?? '',
      taxId: hd.customerCardId ?? '',
      name: hd.customerName ?? '',
      address: hd.customerAddress ?? '',
      phone: hd.customerPhoneNumber ?? '',
      line: cust?.line ?? '',
      email: cust?.email ?? '',
      subDistrict,
      district,
      province,
    },
    lines: dts.map(({ d, name }) => ({
      id: d.saleOutDtId,
      listNo: d.listNo ?? 0,
      productId: d.productId ?? 0,
      code: d.productCode ?? '',
      name: name ?? d.remarkDt ?? '',
      type: (d.productType as 'SparePart' | 'Service') ?? 'SparePart',
      qty: d.saleOutQuantity,
      unit: 'Pcs.',
      price: num(d.saleOutPrice),
      amount: num(d.amountDt),
      picked: d.pickInventoryNo ?? '',
    })),
    totalBase: num(hd.totalBaseAmount),
    fee: num(hd.feeAmount),
    slip: hd.slipFileName ?? '',
    approveRemark: hd.approveRemark ?? '',
    createdBy: fullName(made?.first, made?.last),
    createdById: hd.documentCreateBy ?? 0,
    approverRoles:
      hd.approveStatusId === AS.WAIT ? (await rolesWithRight('SO Approve')).filter((r) => r !== ADMIN_USER_TYPE) : [],
    creatorIds: [hd.documentCreateBy, hd.saleOutBy].filter((x): x is number => (x ?? 0) > 0),
    documentProfileId: hd.documentProfileId ?? SHD_PROFILE_ID,
    version: versionOf(
      hd.rowVersion,
      dts.map((x) => x.d),
    ),
    salesId: hd.saleOutBy ?? 0,
  };
}

export type SaleOrderInput = {
  /** ออกเอกสารในนาม (document_profile.id) — new orders only; fixed once numbered */
  documentProfileId?: number;
  no?: string;
  customerCode: string;
  salesId?: number | string; // app_user id of the salesperson (sale_out_by)
  lines: { code: string; qty: number; price?: number | string; name?: string; type?: 'SparePart' | 'Service' }[];
  paymentType?: string;
  paymentAmount?: number | string;
  /** ignored: the slip path is written only by /api/upload (a client-sent path could point at any file) */
  slip?: string;
  remark?: string;
  fee?: number | string;
  tracking?: string;
  submit?: boolean; // true → รออนุมัติ, false → กำลังดำเนินการจัดทำ (an edit by anyone but the creator keeps the status)
  /** row_version the edit page loaded: another save since → 409; absent = no check */
  version?: number;
};

export async function saveSaleOrder(
  i: SaleOrderInput,
  by: Pick<CurrentUser, 'userId' | 'isAdmin'>,
): Promise<SaleOrderDetail> {
  const byUserId = by.userId;
  const [cur] = i.no
    ? await db
        .select({
          salesId: saleOutHd.saleOutBy,
          paymentType: saleOutHd.paymentType,
          tracking: saleOutHd.deliveryTrackingNo,
          fee: saleOutHd.feeAmount,
        })
        .from(saleOutHd)
        .where(eq(saleOutHd.saleOutHdNo, i.no))
        .limit(1)
    : [];
  // same rules as the form (lib/validation/sale-order); an edit keeps a legacy payment type / tracking no
  assertValid(saleOrderSchema(cur && { ...cur, fee: num(cur.fee) }), i);
  const cust = await getCustomerByCode(str(i.customerCode));
  if (!cust) throw new HttpError(400, 'ต้องเลือกลูกค้า', { fields: { customerCode: 'ไม่พบลูกค้ารายนี้' } });
  // พนักงานขาย: an active user — or, on an edit, the one already on the order (who may have left since)
  const salesId = await staffOrKeep(Number(i.salesId), cur?.salesId, 'salesId', byUserId, 'ไม่พบพนักงานขาย');
  const codes = i.lines.map((l) => str(l.code)).filter(Boolean);
  const prods = await db
    .select({
      id: product.productId,
      code: product.productCode,
      name: product.productName,
      retail: productNoneSerial.retailPrice,
      capital: productNoneSerial.capitalPrice,
      wholesale: productNoneSerial.wholesalePrice,
      itemId: productNoneSerial.itemId,
    })
    .from(product)
    .leftJoin(productNoneSerial, eq(productNoneSerial.productId, product.productId))
    .where(inArray(product.productCode, codes));
  const byCode = new Map(prods.map((p) => [p.code ?? '', p]));

  const input = i.lines
    .filter((l) => str(l.code))
    .map((l) => {
      const p = byCode.get(str(l.code));
      // a service only when no product has the code: a real part sent as 'Service' skipped the approval's stock issue
      const isService = !p && (l.type === 'Service' || !!str(l.name));
      if (!p && !isService) throw new HttpError(400, `ไม่พบรหัสสินค้า ${l.code}`);
      return {
        p,
        isService,
        code: str(l.code),
        name: str(l.name) || p?.name || '',
        qty: Math.max(1, Math.trunc(num(l.qty) || 1)),
        price: l.price !== undefined && l.price !== '' ? num(l.price) : undefined,
      };
    });
  const approveId = i.submit === false ? AS.DRAFT : AS.WAIT;

  const no = await db.transaction(async (tx) => {
    const now = nowThai();
    let no = i.no;
    // edit — lock: an approval running now must finish first, so the APPROVED check below sees it
    const [prev] = no ? await tx.select().from(saleOutHd).where(eq(saleOutHd.saleOutHdNo, no)).for('update') : [];
    if (no && !prev) throw new HttpError(404, 'ไม่พบใบสั่งขาย ' + no);
    const old = prev ? await linesOf(tx, no!) : [];
    // a line the user left as it was keeps its stored row (price, cost snapshot, id): an unchanged legacy
    // order is never re-priced from today's product; a changed / new line takes the request's price
    const rows = input.map((l, idx) => {
      const o = old[idx];
      const sameCode = !!o && str(o.productCode) === l.code;
      const price = l.price ?? (sameCode ? num(o.saleOutPrice) : num(l.p?.retail));
      const amount = Math.round(l.qty * price * 100) / 100;
      const type = l.isService ? 'Service' : 'SparePart';
      if (
        sameCode &&
        o.saleOutQuantity === l.qty &&
        num(o.saleOutPrice) === price &&
        str(o.productType) === type &&
        (!l.isService || str(o.remarkDt) === l.name.slice(0, 100).trim())
      ) {
        return { kept: true, row: { ...o, saleOutDtId: undefined } };
      }
      return {
        kept: false,
        row: {
          productId: l.p?.id ?? null,
          storeLocationId: 1,
          conditionId: 1,
          serialNo: '',
          capitalPrice: money(num(l.p?.capital)),
          wholesalePrice: money(num(l.p?.wholesale)),
          retailPrice: money(num(l.p?.retail)),
          saleOutPrice: money(price),
          saleOutQuantity: l.qty,
          amountDt: money(amount),
          remarkDt: l.isService ? l.name.slice(0, 100) : '',
          onhandItemId: l.p?.itemId ?? null,
          productType: type,
          documentCreditNoteNo: '',
          productCode: l.code.slice(0, 50),
          pickInventoryNo: '',
          returnInventoryNo: '',
        },
      };
    });
    const linesChanged = !prev || old.length !== rows.length || rows.some((r) => !r.kept);
    const totalBase = Math.round(rows.reduce((s, r) => s + num(r.row.amountDt), 0) * 100) / 100;
    // the edit form sends neither fee nor tracking: left out → the order keeps its own (a save used to wipe them)
    const fee = i.fee !== undefined ? num(i.fee) : num(prev?.feeAmount);
    const net = Math.round((totalBase + fee) * 100) / 100;
    // ยอดชำระ: only what the user typed (no default type / amount), never more than the order total —
    // an edit that lowers the lines must lower the payment too (SO2600768 kept 3,900 on a 1,300 order)
    const paid =
      i.paymentAmount !== undefined && i.paymentAmount !== null && i.paymentAmount !== '' ? num(i.paymentAmount) : null;
    if (paid !== null && paid > net)
      throw new HttpError(400, overpaidMessage(net), { fields: { paymentAmount: overpaidMessage(net) } });
    // the customer snapshot (name / address / phone as printed) is taken when the customer is picked — an
    // edit that keeps the customer keeps the order's own copy
    const custChanged = !prev || str(prev.customerCode) !== cust.code;
    const hdValues = {
      ...(custChanged
        ? {
            customerId: cust.id,
            customerCode: cust.code,
            customerCardId: cust.taxId,
            customerName: cust.name,
            customerAddress: cust.address.slice(0, 500),
            customerPhoneNumber: cust.phone,
          }
        : {}),
      totalBaseAmount: money(totalBase),
      vatRat: '0.00',
      vatAmount: '0.00',
      totalAmount: money(totalBase),
      roundingAmount: '0.00',
      feeAmount: money(fee),
      netAmount: money(net),
      remarkHd: clean(i.remark),
      paymentType: clean(i.paymentType),
      paymentAmount: paid === null ? null : money(paid),
      ...(i.tracking !== undefined || !prev ? { deliveryTrackingNo: cleanTracking(i.tracking) } : {}),
    };
    if (no && prev) {
      assertVersion(i.version, versionOf(prev.rowVersion, old));
      if (prev.recordStatus === RS.DELETED) throw new HttpError(409, `${SO_CANCELLED} แก้ไขไม่ได้`);
      if (prev.approveStatusId === AS.APPROVED) throw new HttpError(409, 'ใบสั่งขายอนุมัติแล้ว แก้ไขไม่ได้');
      if (prev.approveStatusId === AS.DENIED) throw new HttpError(409, 'ใบสั่งขายถูกปฏิเสธแล้ว แก้ไขไม่ได้');
      // only the creator sends it for approval (else an approver submits someone's draft and approves it)
      const own = by.isAdmin || prev.documentCreateBy === byUserId;
      // … and only the creator edits it while it waits: an approver could change it (the salesperson, a
      // price) and approve what the creator never sent (owner decision)
      if (!own && prev.approveStatusId === AS.WAIT) throw new HttpError(403, WAITING_CREATOR_ONLY);
      if (!own && approveId === AS.WAIT && prev.approveStatusId !== AS.WAIT)
        throw new HttpError(403, SUBMIT_CREATOR_ONLY);
      const upd = {
        ...hdValues,
        // a sent-back (3) order saved without "ส่งขออนุมัติ" stays sent back (its reason still shows)
        approveStatusId: !own
          ? prev.approveStatusId
          : approveId === AS.DRAFT && prev.approveStatusId === AS.REJECT
            ? AS.REJECT
            : approveId,
        saleOutBy: salesId, // document_create_by stays the one who keyed the order in
      };
      // only what changed is written — an unchanged save writes nothing (no audit, no row_version bump)
      const changes = diff(prev as Record<string, unknown>, upd as Record<string, unknown>) ?? {};
      const keys = Object.keys(changes) as (keyof typeof upd)[];
      if (keys.length)
        await tx
          .update(saleOutHd)
          .set(Object.fromEntries(keys.map((k) => [k, upd[k]])))
          .where(eq(saleOutHd.saleOutHdNo, no));
      // diff() reads digit strings as numbers: the log keeps a phone / tax id as typed (leading 0)
      for (const k of ['customerPhoneNumber', 'customerCardId'] as const)
        if (changes[k]) changes[k] = [prev[k] ?? '', upd[k] ?? ''];
      if (linesChanged) {
        await tx.delete(saleOutDt).where(eq(saleOutDt.saleOutHdNo, no));
        const line = (r: { productCode: string | null; saleOutQuantity: number; saleOutPrice: string | null }) =>
          `${r.productCode} x${r.saleOutQuantity} @${num(r.saleOutPrice)}`;
        changes.lines = [old.map(line), rows.map((r) => line(r.row))];
      }
      if (keys.length || linesChanged)
        await audit(tx, byUserId, {
          action: 'UPDATE',
          module: 'Sale Order',
          entity: 'sale_out_hd',
          key: no,
          summary: `แก้ไขใบสั่งขาย · ${rows.length} รายการ · ${net.toFixed(2)} บาท`,
          changes,
        });
    } else {
      const profile = await issuingProfile(i.documentProfileId);
      no = await nextRunningNo(tx, 'SaleOrder');
      await audit(tx, byUserId, {
        action: 'CREATE',
        module: 'Sale Order',
        entity: 'sale_out_hd',
        key: no,
        summary: `สร้างใบสั่งขาย · ${cust.code} ${cust.name} · ${rows.length} รายการ · ${net.toFixed(2)} บาท`,
      });
      await tx.insert(saleOutHd).values({
        ...hdValues,
        documentProfileId: profile.id,
        saleOutHdNo: no,
        documentType: 'SaleOrder',
        documentCreateDate: now,
        documentCreateBy: byUserId,
        customerFaxNumber: '', // not on the form: written on create only, an edit keeps a legacy order's fax
        documentStatus: true,
        documentCreditNoteNo: '',
        documentCancelDate: SENTINEL_TS,
        documentCancelBy: -1,
        documentCancelRemark: '',
        isSaleOut: true,
        saleOutDate: now,
        saleOutBy: salesId,
        referenceNo: '',
        approveStatusId: approveId,
        approveDate: SENTINEL_TS,
        approveBy: -1,
        approveRemark: '',
        deliveryDate: SENTINEL_TS,
      });
    }
    // lines are re-written only when they changed (a rewrite gives them new, higher ids — see versionOf)
    if (linesChanged)
      await tx.insert(saleOutDt).values(rows.map((r, idx) => ({ ...r.row, saleOutHdNo: no!, listNo: idx + 1 })));
    return no!;
  });
  return (await getSaleOrder(no))!;
}

export { SELF_APPROVE, SELF_APPROVE_SALES, NOT_APPROVER, SUBMIT_CREATOR_ONLY };
export const REASON_REQUIRED = 'ต้องระบุเหตุผล';

/**
 * Approval: 4 อนุมัติ → stock goes out (WHO type 4) at this moment, as the legacy
 * data shows; 5 ปฏิเสธ / 3 แก้ไขข้อมูล just stamp the decision (with a required reason).
 * Only a role with the special right SO Approve decides (System Admin always), only a waiting (2) order, not its creator or
 * salesperson (owner decisions 2026-10-15; System Admin may).
 */
export async function approveSaleOrder(
  no: string,
  decision: 'approve' | 'deny' | 'reject',
  remark: string,
  by: Pick<CurrentUser, 'userId' | 'isAdmin' | 'userType'>,
  /** the version the approver's screen shows: the creator saved since → 409, the approver looks again */
  version?: unknown,
): Promise<SaleOrderDetail> {
  const byUserId = by.userId;
  if (!(await hasRight(by, 'SO Approve'))) throw new HttpError(403, NOT_APPROVER);
  const statusId = decision === 'approve' ? AS.APPROVED : decision === 'deny' ? AS.DENIED : AS.REJECT;
  const reason = clean(remark);
  if (decision !== 'approve' && !reason)
    throw new HttpError(400, REASON_REQUIRED, { fields: { remark: REASON_REQUIRED } });
  await db.transaction(async (tx) => {
    const [hd] = await tx.select().from(saleOutHd).where(eq(saleOutHd.saleOutHdNo, no)).for('update');
    if (!hd) throw new HttpError(404, 'ไม่พบใบสั่งขาย ' + no);
    if (hd.recordStatus === RS.DELETED) throw new HttpError(409, `${SO_CANCELLED} อนุมัติหรือเปลี่ยนสถานะไม่ได้`);
    // 4 / 5 are final (approve_status.is_can_edit = f) — checked under the row lock, so two clicks can't both pass
    if (hd.approveStatusId === AS.APPROVED) throw new HttpError(409, 'อนุมัติไปแล้ว');
    if (hd.approveStatusId === AS.DENIED)
      throw new HttpError(409, 'ใบสั่งขายถูกปฏิเสธแล้ว อนุมัติหรือเปลี่ยนสถานะไม่ได้');
    if (hd.approveStatusId !== AS.WAIT)
      throw new HttpError(409, 'ใบสั่งขายยังไม่ได้ส่งขออนุมัติ — ผู้สร้างต้องบันทึกแบบ "ส่งขออนุมัติ" ก่อน');
    assertVersion(version, versionOf(hd.rowVersion, await linesOf(tx, no)));
    if (!by.isAdmin && hd.documentCreateBy === byUserId) throw new HttpError(403, SELF_APPROVE);
    if (!by.isAdmin && hd.saleOutBy === byUserId) throw new HttpError(403, SELF_APPROVE_SALES);
    await tx
      .update(saleOutHd)
      .set({
        approveStatusId: statusId,
        approveDate: nowThai(),
        approveBy: byUserId,
        approveRemark: reason, // approveSchema: ≤ 100 (the column)
      })
      .where(eq(saleOutHd.saleOutHdNo, no));
    await audit(tx, byUserId, {
      action: 'APPROVE',
      module: 'Sale Order',
      entity: 'sale_out_hd',
      key: no,
      summary:
        decision === 'approve'
          ? 'อนุมัติใบสั่งขาย (ตัดสต๊อก)'
          : decision === 'deny'
            ? `ปฏิเสธใบสั่งขาย · ${reason}`
            : `ส่งกลับแก้ไข · ${reason}`,
      changes: { approveStatusId: [hd.approveStatusId, statusId] },
    });
    if (decision === 'approve') {
      const hasGoods = await tx
        .select({ n: count() })
        .from(saleOutDt)
        .where(and(eq(saleOutDt.saleOutHdNo, no), ne(saleOutDt.productType, 'Service')));
      if (Number(hasGoods[0]?.n ?? 0) > 0)
        await issueForSaleOrder({ soNo: no, payTo: hd.customerName ?? '' }, byUserId, tx).catch((e) => {
          // adjustQty's "สต๊อก X ไม่พอ (คงเหลือ N)" — say what to do about it
          if (e instanceof HttpError && e.status === 409 && e.message.includes('ไม่พอ'))
            throw new HttpError(409, `${e.message} — รับเข้าอะไหล่ที่ เมนูรับเข้า ก่อนอนุมัติ`, e.details);
          throw e;
        });
    }
  });
  if (decision === 'approve') productsChanged(); // stock went out in our tx — now committed
  return (await getSaleOrder(no))!;
}

export async function setTracking(no: string, tracking: string, byUserId: number): Promise<SaleOrderDetail> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ tracking: saleOutHd.deliveryTrackingNo, approve: saleOutHd.approveStatusId })
      .from(saleOutHd)
      .where(eq(saleOutHd.saleOutHdNo, no))
      .for('update');
    if (!before) throw new HttpError(404, 'ไม่พบใบสั่งขาย ' + no);
    if (before.approve !== AS.APPROVED) throw new HttpError(409, 'ใส่เลขพัสดุได้เมื่อใบสั่งขายอนุมัติแล้วเท่านั้น');
    assertValid(trackingSchema(before.tracking), { tracking });
    await tx
      .update(saleOutHd)
      .set({ deliveryTrackingNo: cleanTracking(tracking), deliveryDate: nowThai() })
      .where(eq(saleOutHd.saleOutHdNo, no));
    await audit(tx, byUserId, {
      action: 'UPDATE',
      module: 'Sale Order',
      entity: 'sale_out_hd',
      key: no,
      summary: `บันทึกเลขพัสดุ ${cleanTracking(tracking)}`,
      changes: { deliveryTrackingNo: [before.tracking ?? null, cleanTracking(tracking)] },
    });
  });
  return (await getSaleOrder(no))!;
}

export async function approveStatuses() {
  return db.select().from(approveStatus).orderBy(asc(approveStatus.approveStatusId));
}
