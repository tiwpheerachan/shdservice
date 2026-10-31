import 'server-only';
import { and, asc, count, desc, eq, getTableColumns, gte, ilike, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { alias, type PgSelect } from 'drizzle-orm/pg-core';
import { db, type Tx, writeTx } from '@/db/client';
import { AS, INV, ITEM_UNIT } from '@/lib/status-ids';
import { MAX_EXPORT_ROWS } from '@/lib/export-limit';
import {
  appUser,
  approveStatus,
  customer,
  stockMove,
  product,
  productStock,
  saleOrderLine,
  saleOrder,
} from '@/db/schema';
import type { SaleOrder } from '@/data/types';
import { HttpError, fullName, grantsForUserType, hasRight, rolesWithRight, type CurrentUser } from '@/server/auth';
import { ADMIN_USER_TYPE, checkGrant } from '@/lib/modules';
import { assertVersion } from '@/server/http-error';
import { nextRunningNo } from '@/db/running-no';
import { actorName, audit, diff } from '@/server/audit';
import { orderBy, likeTerm, offsetOf, totalOf, ymd, type Page, type PageQuery } from '@/server/paging';
import { fmtDateTime, money, nowThai, num, str, type FieldData } from '@/server/mappers/format';
import { assertFiguresEditable, isLegacyRow } from '@/server/legacy-lock';
import { customerForDocument, getCustomerById, addressNames } from './customers';
import { issuingProfile, profileIdOf } from './document-profiles';
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
import { z } from 'zod';
import type { saleOrderSave } from '@/server/contract/sales';
import { staffOrKeep } from './users';

export { AS };

// พนักงานขาย = sale_out_by (document_create_by = who keyed the order in)
const seller = alias(appUser, 'creator');
const approver = alias(appUser, 'approver');
/** the stock document a line was picked on (sale_order_line.pick_stock_move_pk) */
const pickDoc = alias(stockMove, 'pick_doc');
/** the order's ใบเบิก: the WHO (type 4) issued for it */
export const stockDoc = sql<
  string | null
>`(select m.stock_move_no from stock_move m where m.sale_order_pk = ${saleOrder.pk}
  and m.stock_move_type_id = ${INV.OUT_SALE} order by m.pk limit 1)`;
/** the customer as the order shows it: the snapshot taken at approval, else (a draft / waiting order) the customer now */
const customerName = sql<string | null>`coalesce(${saleOrder.customerName}, ${customer.customerName})`;

const listSelect = {
  id: saleOrder.id,
  no: saleOrder.saleOrderNo,
  date: saleOrder.documentCreateDate,
  customer: customerName,
  customerCode: customer.customerCode,
  amount: saleOrder.netAmount,
  salesFirst: seller.firstName,
  salesLast: seller.lastName,
  approve: approveStatus.approveNameTh,
  approveId: saleOrder.approveStatusId,
  stockDoc,
  tracking: saleOrder.deliveryTrackingNo,
  paymentType: saleOrder.paymentType,
  paymentAmount: saleOrder.paymentAmount,
  status: saleOrder.recordStatus,
  approveDate: saleOrder.approveDate,
  salesUuid: seller.id,
  approverFirst: approver.firstName,
  approverLast: approver.lastName,
  deliveryDate: saleOrder.deliveryDate,
  remark: saleOrder.remark,
};
type ListRow = { [K in keyof typeof listSelect]: FieldData<(typeof listSelect)[K]> | null };

/** approve_status 3 is named "แก้ไขข้อมูล" in the table — shown as what happened to the order */
const APPROVE_LABEL: Record<string, string> = { แก้ไขข้อมูล: 'ส่งกลับแก้ไข' };
const approveLabel = (name: string | null) => APPROVE_LABEL[name?.trim() ?? ''] ?? name?.trim() ?? '';

function toSaleOrder(r: ListRow): SaleOrder {
  return {
    id: r.id ?? '',
    no: r.no ?? '',
    date: fmtDateTime(r.date),
    customer: r.customer ?? '',
    amount: num(r.amount),
    sales: fullName(r.salesFirst, r.salesLast),
    approve: r.status === RS.DELETED ? 'ยกเลิก' : approveLabel(r.approve), // list, export and filters alike
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

/** The list's joins — the list, its count and the report KPI (reports.ts) all take them, so saleOrderWhere
 *  never names a table one of them lacks (a count does not pay for the approver: Postgres drops an unused
 *  left join on a primary key). */
export const withSaleOrderJoins = <T extends PgSelect>(q: T) =>
  q
    .leftJoin(customer, eq(customer.pk, saleOrder.customerPk))
    .leftJoin(seller, eq(seller.pk, saleOrder.saleOutByAppUserPk))
    .leftJoin(approver, eq(approver.pk, saleOrder.approvedByAppUserPk))
    .leftJoin(approveStatus, eq(approveStatus.approveStatusId, saleOrder.approveStatusId));

const base = () => withSaleOrderJoins(db.select(listSelect).from(saleOrder).$dynamic());

const SORT = {
  no: saleOrder.saleOrderNo,
  date: saleOrder.documentCreateDate,
  customer: customerName,
  amount: saleOrder.netAmount,
  sales: seller.firstName,
  approve: saleOrder.approveStatusId,
  stockDoc,
  tracking: saleOrder.deliveryTrackingNo,
};

export type SaleOrderFilters = {
  approve?: string;
  from?: string;
  to?: string;
  sales?: string;
  deleted?: StatusMode;
  /** the list page's own boxes — each its own condition */
  no?: string;
  customer?: string;
  /** a part / accessory code on one of the order's lines */
  code?: string;
};

/** The page's query (?approve=&no=…) as filters — the list, its report KPI and the export all read it here. */
export const saleOrderFiltersFromQuery = (f: Record<string, string>, deleted: StatusMode): SaleOrderFilters => ({
  approve: f.approve,
  from: f.from,
  to: f.to,
  sales: f.sales,
  no: f.no,
  customer: f.customer,
  code: f.code,
  deleted,
});

export function saleOrderWhere(q: string, f: SaleOrderFilters) {
  const term = q.trim();
  const from = ymd(f.from),
    to = ymd(f.to);
  return and(
    statusFilter(saleOrder.recordStatus, f.deleted ?? 'exclude'),
    term
      ? or(
          ilike(saleOrder.saleOrderNo, likeTerm(term)),
          ilike(customerName, likeTerm(term)),
          ilike(customer.customerCode, likeTerm(term)),
          ilike(sql`coalesce(${saleOrder.customerPhoneNumber}, ${customer.phoneNumber})`, likeTerm(term)),
          ilike(saleOrder.deliveryTrackingNo, likeTerm(term)),
        )
      : undefined,
    f.no?.trim() ? ilike(saleOrder.saleOrderNo, likeTerm(f.no.trim())) : undefined,
    f.customer?.trim()
      ? or(ilike(customerName, likeTerm(f.customer.trim())), ilike(customer.customerCode, likeTerm(f.customer.trim())))
      : undefined,
    f.code?.trim()
      ? sql`exists (select 1 from sale_order_line d left join product p on p.pk = d.product_pk
          where d.sale_order_pk = ${saleOrder.pk} and coalesce(p.product_code, d.product_code) ilike ${likeTerm(f.code.trim())})`
      : undefined,
    f.approve
      ? eq(
          approveStatus.approveNameTh,
          Object.keys(APPROVE_LABEL).find((k) => APPROVE_LABEL[k] === f.approve) ?? f.approve,
        )
      : undefined,
    from ? gte(saleOrder.documentCreateDate, `${from} 00:00:00`) : undefined,
    to ? lte(saleOrder.documentCreateDate, `${to} 23:59:59`) : undefined,
    // a user's uuid (the report's salesperson picker) or a name
    f.sales
      ? z.uuid().safeParse(f.sales).success
        ? eq(seller.id, f.sales.toLowerCase())
        : ilike(seller.firstName, likeTerm(f.sales))
      : undefined,
  );
}

export async function pageSaleOrders(p: PageQuery, f: SaleOrderFilters): Promise<Page<SaleOrder>> {
  const w = saleOrderWhere(p.q, f);
  // count + page in parallel: the response takes max(count, rows) instead of their sum
  const [counted, rows] = await Promise.all([
    withSaleOrderJoins(db.select({ total: count() }).from(saleOrder).$dynamic()).where(w),
    base()
      .where(w)
      .orderBy(...orderBy(p.sort, SORT, [desc(saleOrder.documentCreateDate), desc(saleOrder.pk)]))
      .limit(p.pageSize)
      .offset(offsetOf(p)),
  ]);
  return { rows: rows.map(toSaleOrder), total: totalOf(counted), page: p.page, pageSize: p.pageSize };
}

export async function listSaleOrders(f: SaleOrderFilters & { q?: string; limit?: number } = {}): Promise<SaleOrder[]> {
  const rows = await base()
    .where(saleOrderWhere(f.q ?? '', f))
    .orderBy(desc(saleOrder.documentCreateDate))
    .limit(Math.min(f.limit ?? 5000, MAX_EXPORT_ROWS));
  return rows.map(toSaleOrder);
}

export type SaleOrderLine = {
  /** the line's uuid — an edit sends it back to keep this line */
  id: string;
  listNo: number;
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
    /** the customer's status now — an Inactive one gets the picker's notice on the form */
    status: string;
  };
  /** why it was cancelled (document_cancel_remark) */
  cancelRemark: string;
  lines: SaleOrderLine[];
  totalBase: number;
  fee: number;
  slip: string;
  approveRemark: string;
  /** who keyed the order in (document_create_by) — `sales` is the salesperson (sale_out_by) */
  createdBy: string;
  /** the creator's user uuid (null: none / unknown) */
  createdById: string | null;
  /** document_create_by + sale_out_by (user uuids) — neither may decide on the order (System Admin may) */
  creatorIds: string[];
  /** a waiting order: the roles that may decide on it (ticked SO Approve; System Admin always may, not listed) */
  approverRoles: string[];
  /** ออกเอกสารในนาม — the document profile's uuid (legacy rows = SHD's) */
  documentProfileId: string;
  /** row_version (a line-only edit bumps it too) — the edit page sends it back with its save / decision */
  version: number;
  /** sale_out_by's user uuid — the edit form picks the salesperson by id (a name may have changed or left) */
  salesId: string | null;
  /** came from the legacy system: its money / quantity figures are System Admin's alone (legacy-lock.ts) */
  figuresLocked: boolean;
};

/** a line's description: its product's name, else its remark (a service line = no product_pk); legacy service lines
 *  (SV0001) have neither */
const lineName = (
  productName: string | null,
  d: { remark: string | null; productPk: number | null; productCode: string | null },
) => productName || str(d.remark) || (d.productPk == null ? `ค่าบริการ/ค่าส่ง (${str(d.productCode)})` : '');

/**
 * An order's lines with the code each one prints: a product line's is its product's (product_code is NULL on new
 * product lines; legacy lines keep theirs), a service line's is its text.
 */
const linesOf = (x: Tx, hdPk: number) =>
  x
    .select({
      ...getTableColumns(saleOrderLine),
      code: sql<string>`coalesce(${product.productCode}, ${saleOrderLine.productCode}, '')`,
    })
    .from(saleOrderLine)
    .leftJoin(product, eq(product.pk, saleOrderLine.productPk))
    .where(eq(saleOrderLine.saleOrderPk, hdPk))
    .orderBy(asc(saleOrderLine.listNo), asc(saleOrderLine.pk));

/** the SO number of the order whose uuid is `id` (a link: page, API path, print, upload) — null: none, or not a uuid */
export async function saleOrderNoOf(id: string): Promise<string | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [r] = await db
    .select({ no: saleOrder.saleOrderNo })
    .from(saleOrder)
    .where(eq(saleOrder.id, id.toLowerCase()))
    .limit(1);
  return r?.no ?? null;
}

export async function getSaleOrder(no: string): Promise<SaleOrderDetail | null> {
  // the list row and the whole header in one read; the lines alongside
  const [[r], dts] = await Promise.all([
    withSaleOrderJoins(
      db
        .select({ ...listSelect, hd: saleOrder })
        .from(saleOrder)
        .$dynamic(),
    )
      .where(eq(saleOrder.saleOrderNo, no))
      .limit(1),
    db
      .select({
        d: saleOrderLine,
        name: product.productName,
        code: product.productCode,
        picked: pickDoc.stockMoveNo,
      })
      .from(saleOrderLine)
      .innerJoin(saleOrder, eq(saleOrder.pk, saleOrderLine.saleOrderPk))
      .leftJoin(product, eq(product.pk, saleOrderLine.productPk))
      .leftJoin(pickDoc, eq(pickDoc.pk, saleOrderLine.pickStockMovePk))
      .where(eq(saleOrder.saleOrderNo, no))
      .orderBy(asc(saleOrderLine.listNo), asc(saleOrderLine.pk)),
  ]);
  if (!r) return null;
  const { hd } = r;
  const [cust, [made], approverRoles, profileId, figuresLocked] = await Promise.all([
    hd.customerPk ? getCustomerById(hd.customerPk) : null,
    hd.createdByAppUserPk != null
      ? db
          .select({ id: appUser.id, first: appUser.firstName, last: appUser.lastName })
          .from(appUser)
          .where(eq(appUser.pk, hd.createdByAppUserPk))
      : [],
    hd.approveStatusId === AS.WAIT ? rolesWithRight('SO Approve') : [],
    profileIdOf(hd.documentProfilePk),
    isLegacyRow('sale_order', hd.pk),
  ]);
  const { subDistrict, district, province } = await addressNames(cust);
  // one source: the snapshot taken at approval (legacy orders: when the customer was picked), else the customer now
  const snap = hd.customerName != null;
  return {
    ...toSaleOrder(r),
    customerDetail: {
      code: r.customerCode ?? '',
      taxId: (snap ? hd.customerCardId : cust?.taxId) ?? '',
      name: (snap ? hd.customerName : cust?.name) ?? '',
      address: (snap ? hd.customerAddress : cust?.address) ?? '',
      phone: (snap ? hd.customerPhoneNumber : cust?.phone) ?? '',
      line: cust?.line ?? '',
      email: cust?.email ?? '',
      subDistrict,
      district,
      province,
      status: cust?.status ?? 'Active',
    },
    cancelRemark: hd.documentCancelRemark ?? '',
    lines: dts.map(({ d, name, code, picked }) => ({
      id: d.id,
      listNo: d.listNo ?? 0,
      code: code ?? d.productCode ?? '',
      name: lineName(name, d),
      type: d.productPk == null ? ('Service' as const) : ('SparePart' as const),
      qty: d.saleOutQuantity,
      unit: ITEM_UNIT,
      price: num(d.saleOutPrice),
      amount: num(d.amount),
      picked: picked ?? '',
    })),
    totalBase: num(hd.totalBaseAmount),
    fee: num(hd.feeAmount),
    slip: hd.slipFileName ?? '',
    approveRemark: hd.approveRemark ?? '',
    createdBy: fullName(made?.first, made?.last),
    createdById: made?.id ?? null,
    approverRoles: approverRoles.filter((r) => r !== ADMIN_USER_TYPE),
    creatorIds: [...new Set([made?.id, r.salesUuid].filter((x): x is string => !!x))],
    documentProfileId: profileId,
    version: hd.rowVersion,
    salesId: r.salesUuid ?? null,
    figuresLocked,
  };
}

/** sale_order.customer_* — the snapshot approval writes; NULL = the order reads the customer now */
const NO_SNAPSHOT = {
  customerCardId: null,
  customerName: null,
  customerAddress: null,
  customerPhoneNumber: null,
  customerFaxNumber: null,
};

/**
 * `slip` is ignored: the slip path is written only by /api/upload (a client-sent path could point at any file);
 * `submit` true → รออนุมัติ, false → กำลังดำเนินการจัดทำ (an edit by anyone but the creator keeps the status).
 */
export type SaleOrderInput = z.output<typeof saleOrderSave.body>;

/** may be named พนักงานขาย: the user's role has Sale Order add, or is System Admin */
async function sells(userPk: number) {
  const [u] = await db.select({ t: appUser.userType }).from(appUser).where(eq(appUser.pk, userPk)).limit(1);
  const t = u?.t?.trim() || null;
  return t === ADMIN_USER_TYPE || checkGrant(false, await grantsForUserType(t), 'Sale Order', 'add');
}

export async function saveSaleOrder(
  i: SaleOrderInput,
  by: Pick<CurrentUser, 'pk' | 'isAdmin'>,
): Promise<SaleOrderDetail> {
  const byUserId = by.pk;
  const [cur] = i.no
    ? await db
        .select({
          salesId: saleOrder.saleOutByAppUserPk,
          paymentType: saleOrder.paymentType,
          tracking: saleOrder.deliveryTrackingNo,
          fee: saleOrder.feeAmount,
          customerCode: customer.customerCode,
        })
        .from(saleOrder)
        .leftJoin(customer, eq(customer.pk, saleOrder.customerPk))
        .where(eq(saleOrder.saleOrderNo, i.no))
        .limit(1)
    : [];
  // same rules as the form (lib/validation/sale-order); an edit keeps a legacy payment type / tracking no
  assertValid(saleOrderSchema(cur && { ...cur, fee: num(cur.fee) }), i);
  const lines = i.lines ?? []; // never empty here: saleOrderSchema asks for a line
  const approveId = i.submit === false ? AS.DRAFT : AS.WAIT;

  const no = await writeTx(async (tx) => {
    const now = nowThai();
    let no = i.no;
    // edit — lock: an approval running now must finish first, so the APPROVED check below sees it
    const [prev] = no ? await tx.select().from(saleOrder).where(eq(saleOrder.saleOrderNo, no)).for('update') : [];
    if (no && !prev) throw new HttpError(404, 'ไม่พบใบสั่งขาย ' + no);
    // order → customer → product, under their locks: a delete running now finishes first, or waits for this save
    const cust = await customerForDocument(tx, str(i.customerCode), prev?.customerPk);
    if (!cust) throw new HttpError(400, 'ต้องเลือกลูกค้า', { fields: { customerCode: 'ไม่พบลูกค้ารายนี้' } });
    // พนักงานขาย: an active user — or, on an edit, the one already on the order (who may have left since)
    const salesId = await staffOrKeep(i.salesId, cur?.salesId, 'salesId', byUserId, 'ไม่พบพนักงานขาย');
    // … whose role sells (Sale Order add) or System Admin — the form lists the same (listStaff `sells`)
    if (salesId !== cur?.salesId && !(await sells(salesId)))
      throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง 1 ช่อง', {
        fields: { salesId: 'พนักงานคนนี้ไม่มีสิทธิ์เพิ่มใบสั่งขาย' },
      });
    const codes = lines.map((l) => str(l.code)).filter(Boolean);
    const prods = await tx
      .select({
        pk: product.pk,
        code: product.productCode,
        name: product.productName,
        retail: productStock.retailPrice,
        capital: productStock.capitalPrice,
        wholesale: productStock.wholesalePrice,
        nonSerialPk: productStock.pk,
        status: product.recordStatus,
      })
      .from(product)
      .leftJoin(productStock, eq(productStock.productPk, product.pk))
      .where(inArray(product.productCode, codes))
      .for('share', { of: product });
    const byCode = new Map(prods.map((p) => [p.code ?? '', p]));

    const input = lines
      .filter((l) => str(l.code))
      .map((l) => {
        const p = byCode.get(str(l.code));
        // a service only when no product has the code: a real part sent as 'Service' would skip the approval's stock issue
        const isService = !p && (l.type === 'Service' || !!str(l.name));
        if (!p && !isService) throw new HttpError(400, `ไม่พบรหัสสินค้า ${l.code}`);
        return {
          id: l.id,
          p,
          isService,
          code: str(l.code),
          name: str(l.name) || p?.name || '',
          qty: Math.max(1, Math.trunc(num(l.qty) || 1)),
          price: l.price !== undefined && l.price !== '' ? num(l.price) : undefined,
        };
      });
    const old = prev ? await linesOf(tx, prev.pk) : [];
    // each line the form sends ↔ the stored line it is, by the line's own id (none = a new line); a stored line whose
    // id is not sent is removed. A matched line is updated IN PLACE (its pk / uuid / legacy product_code / pick stay)
    // — only what changed: a legacy line never turns into a new row. A line the user left as it was keeps its stored
    // money (an unchanged legacy order is never re-priced from today's product); a changed / new one takes the
    // request's price
    const used = new Set<number>();
    // list_no: the stored numbers stay (a legacy order's 0s included) while the kept lines are in their stored order
    // and new lines come after them — new lines then take the next numbers; any other order renumbers 1..n
    const at = input.map((l) => (l.id ? old.findIndex((o) => o.id === l.id) : -1));
    const kept = at.filter((k) => k >= 0);
    const firstNew = at.indexOf(-1);
    const inOrder =
      kept.every((k, i) => i === 0 || k > kept[i - 1]!) && (firstNew < 0 || at.slice(firstNew).every((k) => k < 0));
    let nextNo = Math.max(0, ...old.map((o) => o.listNo ?? 0));
    const rows = input.map((l, idx) => {
      const k = at[idx]!;
      if (l.id && (k < 0 || used.has(k))) {
        const m = 'รายการนี้ไม่ใช่ของใบสั่งขายนี้ (หรือซ้ำ) — โหลดหน้าใหม่แล้วแก้อีกครั้ง';
        throw new HttpError(400, m, { fields: { lines: m } });
      }
      if (k >= 0) used.add(k);
      const o = k >= 0 ? old[k] : undefined;
      const sameCode = !!o && o.code === l.code;
      const listNo = !inOrder ? idx + 1 : o ? o.listNo : ++nextNo;
      const price = l.price ?? (sameCode ? num(o!.saleOutPrice) : num(l.p?.retail));
      const amount = Math.round(l.qty * price * 100) / 100;
      const remark = l.isService ? l.name.slice(0, 100) : '';
      // same product / service, qty and price: the stored money stays as it is (never recomputed)
      if (
        o &&
        sameCode &&
        o.saleOutQuantity === l.qty &&
        num(o.saleOutPrice) === price &&
        (o.productPk == null) === l.isService
      ) {
        // a service line whose text changed: only its text is re-written (and its place, if lines moved)
        const textSame = !l.isService || lineName(null, o) === l.name.slice(0, 100).trim();
        const set = { ...(textSame ? {} : { remark }), ...(o.listNo === listNo ? {} : { listNo }) };
        return { o, figures: false, code: o.code, set: Object.keys(set).length ? set : null, row: o };
      }
      // a deleted / Inactive product is not sold any more — an old order's unchanged line (above) keeps it
      if (l.p?.status === RS.DELETED) throw new HttpError(400, `รหัสสินค้า ${l.code} ถูกลบแล้ว — เลือกสินค้าอื่น`);
      if (l.p?.status === RS.INACTIVE)
        throw new HttpError(400, `รหัสสินค้า ${l.code} ปิดใช้งาน (Inactive) — เลือกสินค้าอื่น`);
      const figures = {
        capitalPrice: money(num(l.p?.capital)),
        wholesalePrice: money(num(l.p?.wholesale)),
        retailPrice: money(num(l.p?.retail)),
        saleOutPrice: money(price),
        saleOutQuantity: l.qty,
        amount: money(amount),
        remark,
        listNo,
      };
      if (o) {
        // another product on this line: its product_pk, and product_code NULL on a product line (as an insert)
        const set = sameCode
          ? figures
          : { ...figures, productPk: l.p?.pk ?? null, productCode: l.p ? null : l.code.slice(0, 50) };
        return { o, figures: true, code: l.code, set, row: { ...o, ...set } };
      }
      return {
        o,
        figures: true,
        code: l.code,
        set: null,
        row: {
          ...figures,
          productPk: l.p?.pk ?? null,
          // a product line prints its product's code (product_code NULL); a service line keeps its text
          productCode: l.p ? null : l.code.slice(0, 50),
          pickStockMovePk: null,
          returnStockMovePk: null,
        },
      };
    });
    const linesChanged = !prev || used.size !== old.length || rows.some((r) => !r.o || r.set);
    const totalBase = Math.round(rows.reduce((s, r) => s + num(r.row.amount), 0) * 100) / 100;
    // the edit form sends neither fee nor tracking: left out → the order keeps its own
    const fee = i.fee !== undefined ? num(i.fee) : num(prev?.feeAmount);
    const net = Math.round((totalBase + fee) * 100) / 100;
    // ยอดชำระ: only what the user typed (no default type / amount), never more than the order total — an edit that
    // lowers the lines must lower the payment too
    const paid =
      i.paymentAmount !== undefined && i.paymentAmount !== null && i.paymentAmount !== '' ? num(i.paymentAmount) : null;
    // the money / qty figures change (a line added, changed or deleted, the fee or the payment): only then are the
    // order's amounts written, by the same formula — an edit of anything else keeps the stored ones (never recomputed)
    const figuresChanged =
      !prev ||
      old.length !== rows.length ||
      rows.some((r) => r.figures) ||
      fee !== num(prev.feeAmount) ||
      (paid ?? 0) !== num(prev.paymentAmount); // none = 0 (the form sends "0" for a legacy order's NULL)
    // what a legacy order already recorded is System Admin's alone: a recorded line's product / qty / price (or deleting
    // it), a fee or a payment it holds — new lines and a first payment stay everyone's
    if (
      prev &&
      (old.some((_, i) => !used.has(i)) ||
        rows.some((r) => r.o && r.figures) ||
        (num(prev.feeAmount) !== 0 && fee !== num(prev.feeAmount)) ||
        (num(prev.paymentAmount) !== 0 && (paid ?? 0) !== num(prev.paymentAmount)))
    )
      await assertFiguresEditable(by, 'sale_order', prev.pk);
    if (figuresChanged && paid !== null && paid > net)
      throw new HttpError(400, overpaidMessage(net), { fields: { paymentAmount: overpaidMessage(net) } });
    // the customer snapshot (customer_* as printed) is written at approval (approveSaleOrder); until then the order
    // reads the customer now. Another customer picked → a legacy order's snapshot of the old one goes with it
    const custChanged = !prev || prev.customerPk !== cust.key;
    const hdValues = {
      ...(custChanged ? { customerPk: cust.key, ...NO_SNAPSHOT } : {}),
      ...(figuresChanged
        ? {
            totalBaseAmount: money(totalBase),
            vatRate: '0.00',
            vatAmount: '0.00',
            totalAmount: money(totalBase),
            roundingAmount: '0.00',
            feeAmount: money(fee),
            netAmount: money(net),
            paymentAmount: paid === null ? null : money(paid),
          }
        : {}),
      remark: clean(i.remark),
      paymentType: clean(i.paymentType),
      ...(i.tracking !== undefined || !prev ? { deliveryTrackingNo: cleanTracking(i.tracking) } : {}),
    };
    let hdPk = prev?.pk ?? 0;
    if (no && prev) {
      if (prev.recordStatus === RS.DELETED) throw new HttpError(409, `${SO_CANCELLED} แก้ไขไม่ได้`);
      // final states before the version: a save that lost to the approval says so, not "someone edited it"
      if (prev.approveStatusId === AS.APPROVED) throw new HttpError(409, 'ใบสั่งขายอนุมัติแล้ว แก้ไขไม่ได้');
      if (prev.approveStatusId === AS.DENIED) throw new HttpError(409, 'ใบสั่งขายถูกปฏิเสธแล้ว แก้ไขไม่ได้');
      assertVersion(i.version, prev.rowVersion);
      // only the creator sends it for approval (else an approver submits someone's draft and approves it)
      const own = by.isAdmin || prev.createdByAppUserPk === byUserId;
      // … and only the creator edits it while it waits: an approver could change it (the salesperson, a price) and
      // approve what the creator never sent
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
        saleOutByAppUserPk: salesId, // created_by_app_user_pk stays the one who keyed the order in
      };
      // only what changed is written — an unchanged save writes nothing (no audit, no row_version bump)
      const changes = diff(prev as Record<string, unknown>, upd as Record<string, unknown>) ?? {};
      const keys = Object.keys(changes) as (keyof typeof upd)[];
      if (keys.length)
        await tx
          .update(saleOrder)
          .set(Object.fromEntries(keys.map((k) => [k, upd[k]])))
          .where(eq(saleOrder.pk, prev.pk));
      // a legacy snapshot dropped with the old customer: the customer's code below says what changed
      for (const k of Object.keys(NO_SNAPSHOT)) delete changes[k];
      // the log names the customer by its code and the salesperson by name — never a pk
      if (changes.customerPk) {
        delete changes.customerPk;
        changes.customerCode = [cur?.customerCode ?? null, cust.code];
      }
      if (changes.saleOutByAppUserPk) {
        delete changes.saleOutByAppUserPk;
        changes.saleOutBy = [await actorName(prev.saleOutByAppUserPk, tx), await actorName(salesId, tx)];
      }
      if (linesChanged) {
        const line = (r: { code: string; row: { saleOutQuantity: number; saleOutPrice: string | null } }) =>
          `${r.code} x${r.row.saleOutQuantity} @${num(r.row.saleOutPrice)}`;
        changes.lines = [old.map((o) => line({ code: o.code, row: o })), rows.map(line)];
      }
      if (keys.length || linesChanged)
        await audit(tx, byUserId, {
          action: 'UPDATE',
          module: 'Sale Order',
          entity: 'sale_order',
          key: no,
          summary: `แก้ไขใบสั่งขาย · ${rows.length} รายการ · ${(figuresChanged ? net : num(prev.netAmount)).toFixed(2)} บาท`,
          changes,
        });
    } else {
      const profile = await issuingProfile(i.documentProfileId);
      no = await nextRunningNo(tx, 'SaleOrder');
      const [ins] = await tx
        .insert(saleOrder)
        .values({
          ...hdValues,
          documentProfilePk: profile.pk,
          saleOrderNo: no,
          documentCreateDate: now,
          createdByAppUserPk: byUserId,
          // not cancelled / approved / delivered yet = NULL (the legacy 1900-01-01 sentinel stays on legacy rows only)
          documentCancelDate: null,
          cancelledByAppUserPk: null,
          documentCancelRemark: '',
          saleOutByAppUserPk: salesId,
          approveStatusId: approveId,
          approveDate: null,
          approvedByAppUserPk: null,
          approveRemark: '',
          deliveryDate: null,
        })
        .returning({ pk: saleOrder.pk, id: saleOrder.id });
      hdPk = ins!.pk;
      // logged after the insert so the entry carries the new order's uuid (entity_id)
      await audit(tx, byUserId, {
        action: 'CREATE',
        module: 'Sale Order',
        entity: 'sale_order',
        key: no,
        id: ins!.id,
        summary: `สร้างใบสั่งขาย · ${cust.code} ${cust.name} · ${rows.length} รายการ · ${net.toFixed(2)} บาท`,
      });
    }
    if (linesChanged) {
      // a removed line goes; a matched one is updated in place (only what changed); a new one is inserted
      const gone = old.filter((_, i) => !used.has(i)).map((o) => o.pk);
      if (gone.length) await tx.delete(saleOrderLine).where(inArray(saleOrderLine.pk, gone));
      for (const r of rows)
        if (r.o && r.set) await tx.update(saleOrderLine).set(r.set).where(eq(saleOrderLine.pk, r.o.pk));
      const added = rows.flatMap((r) => (r.o ? [] : [{ ...r.row, saleOrderPk: hdPk }]));
      if (added.length) await tx.insert(saleOrderLine).values(added);
      // a line change is an edit of the order: its version moves (a stale edit / approval screen gets 409) — by
      // exactly one: set to the loaded version + 1, so a header this save already wrote (its trigger bumped it) is not
      // bumped twice
      if (prev)
        await tx
          .update(saleOrder)
          .set({ rowVersion: prev.rowVersion + 1 })
          .where(eq(saleOrder.pk, hdPk));
    }
    return no!;
  });
  return (await getSaleOrder(no))!;
}

export { SELF_APPROVE, SELF_APPROVE_SALES, NOT_APPROVER, SUBMIT_CREATOR_ONLY };
export const REASON_REQUIRED = 'ต้องระบุเหตุผล';

/**
 * Approval: 4 อนุมัติ → stock goes out (WHO type 4) at this moment, as the legacy data shows; 5 ปฏิเสธ / 3 แก้ไขข้อมูล
 * just stamp the decision (with a required reason). Only SO Approve (System Admin always) decides, only a waiting (2)
 * order, never its creator or salesperson (System Admin may).
 */
export async function approveSaleOrder(
  no: string,
  decision: 'approve' | 'deny' | 'reject',
  remark: string,
  by: Pick<CurrentUser, 'pk' | 'isAdmin' | 'userType'>,
  /** the version the approver's screen shows: the creator saved since → 409, the approver looks again */
  version?: unknown,
): Promise<SaleOrderDetail> {
  const byUserId = by.pk;
  if (!(await hasRight(by, 'SO Approve'))) throw new HttpError(403, NOT_APPROVER);
  const statusId = decision === 'approve' ? AS.APPROVED : decision === 'deny' ? AS.DENIED : AS.REJECT;
  const reason = clean(remark);
  if (decision !== 'approve' && !reason)
    throw new HttpError(400, REASON_REQUIRED, { fields: { remark: REASON_REQUIRED } });
  await writeTx(async (tx) => {
    const [hd] = await tx.select().from(saleOrder).where(eq(saleOrder.saleOrderNo, no)).for('update');
    if (!hd) throw new HttpError(404, 'ไม่พบใบสั่งขาย ' + no);
    if (hd.recordStatus === RS.DELETED) throw new HttpError(409, `${SO_CANCELLED} อนุมัติหรือเปลี่ยนสถานะไม่ได้`);
    // 4 / 5 are final (approve_status.is_can_edit = f) — checked under the row lock, so two clicks can't both pass
    if (hd.approveStatusId === AS.APPROVED) throw new HttpError(409, 'อนุมัติไปแล้ว');
    if (hd.approveStatusId === AS.DENIED)
      throw new HttpError(409, 'ใบสั่งขายถูกปฏิเสธแล้ว อนุมัติหรือเปลี่ยนสถานะไม่ได้');
    // sent back while this decision was on screen (another approver was first) — say what it is now
    if (hd.approveStatusId === AS.REJECT)
      throw new HttpError(
        409,
        'ใบสั่งขายถูกส่งกลับแก้ไขไปแล้ว (มีผู้ดำเนินการก่อน) — รอผู้สร้างแก้ไขแล้วส่งขออนุมัติใหม่',
      );
    if (hd.approveStatusId !== AS.WAIT)
      throw new HttpError(409, 'ใบสั่งขายยังไม่ได้ส่งขออนุมัติ — ผู้สร้างต้องบันทึกแบบ "ส่งขออนุมัติ" ก่อน');
    assertVersion(version, hd.rowVersion);
    if (!by.isAdmin && hd.createdByAppUserPk === byUserId) throw new HttpError(403, SELF_APPROVE);
    if (!by.isAdmin && hd.saleOutByAppUserPk === byUserId) throw new HttpError(403, SELF_APPROVE_SALES);
    // approved → the customer as the order prints it from now on (customer_* snapshot, taken once: a legacy order
    // already holds its own)
    const live =
      decision === 'approve' && hd.customerName == null && hd.customerPk ? await getCustomerById(hd.customerPk) : null;
    const snapshot = live && {
      customerCardId: live.taxId.slice(0, 50),
      customerName: live.name.slice(0, 200),
      customerAddress: live.address.slice(0, 500),
      customerPhoneNumber: live.phone.slice(0, 50),
    };
    await tx
      .update(saleOrder)
      .set({
        approveStatusId: statusId,
        approveDate: nowThai(),
        approvedByAppUserPk: byUserId,
        approveRemark: reason, // approveSchema: ≤ 100 (the column)
        ...snapshot,
      })
      .where(eq(saleOrder.pk, hd.pk));
    await audit(tx, byUserId, {
      action: decision === 'approve' ? 'APPROVE' : 'STATUS', // ปฏิเสธ / ส่งกลับแก้ไข approve nothing
      module: 'Sale Order',
      entity: 'sale_order',
      key: no,
      summary:
        decision === 'approve'
          ? 'อนุมัติใบสั่งขาย (ตัดสต๊อก)'
          : decision === 'deny'
            ? `ปฏิเสธใบสั่งขาย · ${reason}`
            : `ส่งกลับแก้ไข · ${reason}`,
      reason: reason || null,
      changes: { approveStatusId: [hd.approveStatusId, statusId] },
    });
    if (decision === 'approve') {
      const hasGoods = await tx
        .select({ n: count() })
        .from(saleOrderLine)
        .where(and(eq(saleOrderLine.saleOrderPk, hd.pk), isNotNull(saleOrderLine.productPk)));
      if (Number(hasGoods[0]?.n ?? 0) > 0)
        await issueForSaleOrder({ soNo: no }, byUserId, tx).catch((e) => {
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

export async function setTracking(
  no: string,
  tracking: string,
  byUserId: number,
  /** the version the screen shows: another save since → 409, never a number overwritten unseen */
  version?: unknown,
): Promise<SaleOrderDetail> {
  await writeTx(async (tx) => {
    const [before] = await tx
      .select({
        pk: saleOrder.pk,
        tracking: saleOrder.deliveryTrackingNo,
        approve: saleOrder.approveStatusId,
        rowVersion: saleOrder.rowVersion,
      })
      .from(saleOrder)
      .where(eq(saleOrder.saleOrderNo, no))
      .for('update');
    if (!before) throw new HttpError(404, 'ไม่พบใบสั่งขาย ' + no);
    if (before.approve !== AS.APPROVED) throw new HttpError(409, 'ใส่เลขพัสดุได้เมื่อใบสั่งขายอนุมัติแล้วเท่านั้น');
    assertVersion(version, before.rowVersion);
    assertValid(trackingSchema(before.tracking), { tracking });
    const next = cleanTracking(tracking);
    await tx
      .update(saleOrder)
      // no number → no delivery date (NULL, as on create)
      .set({ deliveryTrackingNo: next || null, deliveryDate: next ? nowThai() : null })
      .where(eq(saleOrder.pk, before.pk));
    await audit(tx, byUserId, {
      action: 'UPDATE',
      module: 'Sale Order',
      entity: 'sale_order',
      key: no,
      summary: `บันทึกเลขพัสดุ ${next}`,
      changes: { deliveryTrackingNo: [before.tracking ?? null, next || null] },
    });
  });
  return (await getSaleOrder(no))!;
}
