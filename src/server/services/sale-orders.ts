import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { appUser, approveStatus, product, productNoneSerial, saleOutDt, saleOutHd } from "@/db/schema";
import type { SaleOrder } from "@/data/mock";
import { HttpError, fullName } from "@/server/auth";
import { nextRunningNo } from "@/db/running-no";
import { orderBy, offsetOf, type Page, type PageQuery } from "@/server/paging";
import { fmtDateTime, money, nowThai, num, str, SENTINEL_TS } from "@/server/mappers/format";
import { getCustomerByCode } from "./customers";
import { issueForSaleOrder } from "./stock";
import { RS, statusFilter, type StatusMode } from "@/server/record-status";

/** approve_status ids */
export const AS = { DRAFT: 1, WAIT: 2, REJECT: 3, APPROVED: 4, DENIED: 5 } as const;

const creator = alias(appUser, "creator");
const approver = alias(appUser, "approver");

const listSelect = {
  no: saleOutHd.saleOutHdNo,
  date: saleOutHd.documentCreateDate,
  customer: saleOutHd.customerName,
  customerCode: saleOutHd.customerCode,
  amount: saleOutHd.netAmount,
  salesFirst: creator.firstName,
  salesLast: creator.lastName,
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
type ListRow = { [K in keyof typeof listSelect]: (typeof listSelect)[K]["_"]["data"] | null };

function toSaleOrder(r: ListRow): SaleOrder {
  return {
    no: r.no ?? "",
    date: fmtDateTime(r.date),
    customer: r.customer ?? "",
    amount: num(r.amount),
    sales: fullName(r.salesFirst, r.salesLast),
    approve: r.approve?.trim() ?? "",
    stockDoc: r.stockDoc ?? "",
    tracking: r.tracking ?? "",
    approveId: r.approveId ?? 0,
    customerCode: r.customerCode ?? "",
    paymentType: r.paymentType ?? "",
    paymentAmount: num(r.paymentAmount),
    cancelled: r.status === RS.DELETED,
    approveDate: fmtDateTime(r.approveDate),
    approvedBy: fullName(r.approverFirst, r.approverLast),
    deliveryDate: fmtDateTime(r.deliveryDate),
    remark: r.remark ?? "",
  };
}

const base = () =>
  db
    .select(listSelect)
    .from(saleOutHd)
    .leftJoin(creator, eq(creator.userId, saleOutHd.documentCreateBy))
    .leftJoin(approver, eq(approver.userId, saleOutHd.approveBy))
    .leftJoin(approveStatus, eq(approveStatus.approveStatusId, saleOutHd.approveStatusId));

const SORT = {
  no: saleOutHd.saleOutHdNo,
  date: saleOutHd.documentCreateDate,
  customer: saleOutHd.customerName,
  amount: saleOutHd.netAmount,
  sales: creator.firstName,
  approve: saleOutHd.approveStatusId,
  stockDoc: saleOutHd.referenceNo,
  tracking: saleOutHd.deliveryTrackingNo,
};

export type SaleOrderFilters = { approve?: string; from?: string; to?: string; sales?: string; deleted?: StatusMode };

function where(q: string, f: SaleOrderFilters) {
  const term = q.trim();
  return and(
    statusFilter(saleOutHd.recordStatus, f.deleted ?? "exclude"),
    term
      ? or(
          ilike(saleOutHd.saleOutHdNo, `%${term}%`),
          ilike(saleOutHd.customerName, `%${term}%`),
          ilike(saleOutHd.customerCode, `%${term}%`),
          ilike(saleOutHd.customerPhoneNumber, `%${term}%`),
          ilike(saleOutHd.deliveryTrackingNo, `%${term}%`)
        )
      : undefined,
    f.approve ? eq(approveStatus.approveNameTh, f.approve) : undefined,
    f.from ? gte(saleOutHd.documentCreateDate, `${f.from} 00:00:00`) : undefined,
    f.to ? lte(saleOutHd.documentCreateDate, `${f.to} 23:59:59`) : undefined,
    f.sales ? (/^\d+$/.test(f.sales) ? eq(saleOutHd.documentCreateBy, Number(f.sales)) : ilike(creator.firstName, `%${f.sales}%`)) : undefined
  );
}

export async function pageSaleOrders(p: PageQuery, f: SaleOrderFilters): Promise<Page<SaleOrder>> {
  const w = where(p.q, f);
  const [{ total }] = await db
    .select({ total: count() })
    .from(saleOutHd)
    .leftJoin(creator, eq(creator.userId, saleOutHd.documentCreateBy))
    .leftJoin(approveStatus, eq(approveStatus.approveStatusId, saleOutHd.approveStatusId))
    .where(w);
  const rows = await base()
    .where(w)
    .orderBy(...orderBy(p.sort, SORT, [desc(saleOutHd.documentCreateDate), desc(saleOutHd.saleOutHdId)]))
    .limit(p.pageSize)
    .offset(offsetOf(p));
  return { rows: rows.map(toSaleOrder), total: Number(total), page: p.page, pageSize: p.pageSize };
}

export async function listSaleOrders(f: SaleOrderFilters & { q?: string; limit?: number } = {}): Promise<SaleOrder[]> {
  const rows = await base()
    .where(where(f.q ?? "", f))
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
  type: "SparePart" | "Service";
  qty: number;
  unit: string;
  price: number;
  amount: number;
  picked: string;
};

export type SaleOrderDetail = SaleOrder & {
  customerDetail: { code: string; taxId: string; name: string; address: string; phone: string; line: string; email: string };
  lines: SaleOrderLine[];
  totalBase: number;
  fee: number;
  slip: string;
  approveRemark: string;
  createdBy: string;
};

export async function getSaleOrder(no: string): Promise<SaleOrderDetail | null> {
  const [r] = await base().where(eq(saleOutHd.saleOutHdNo, no)).limit(1);
  if (!r) return null;
  const [hd] = await db.select().from(saleOutHd).where(eq(saleOutHd.saleOutHdNo, no)).limit(1);
  const dts = await db
    .select({ d: saleOutDt, name: product.productName })
    .from(saleOutDt)
    .leftJoin(product, eq(product.productId, saleOutDt.productId))
    .where(eq(saleOutDt.saleOutHdNo, no))
    .orderBy(asc(saleOutDt.listNo), asc(saleOutDt.saleOutDtId));
  const cust = hd.customerCode ? await getCustomerByCode(hd.customerCode) : null;
  return {
    ...toSaleOrder(r),
    customerDetail: {
      code: hd.customerCode ?? "",
      taxId: hd.customerCardId ?? "",
      name: hd.customerName ?? "",
      address: hd.customerAddress ?? "",
      phone: hd.customerPhoneNumber ?? "",
      line: cust?.line ?? "",
      email: cust?.email ?? "",
    },
    lines: dts.map(({ d, name }) => ({
      id: d.saleOutDtId,
      listNo: d.listNo ?? 0,
      productId: d.productId ?? 0,
      code: d.productCode ?? "",
      name: name ?? d.remarkDt ?? "",
      type: (d.productType as "SparePart" | "Service") ?? "SparePart",
      qty: d.saleOutQuantity,
      unit: "Pcs.",
      price: num(d.saleOutPrice),
      amount: num(d.amountDt),
      picked: d.pickInventoryNo ?? "",
    })),
    totalBase: num(hd.totalBaseAmount),
    fee: num(hd.feeAmount),
    slip: hd.slipFileName ?? "",
    approveRemark: hd.approveRemark ?? "",
    createdBy: fullName(r.salesFirst, r.salesLast),
  };
}

export type SaleOrderInput = {
  no?: string;
  customerCode: string;
  salesId?: number | string; // app_user id of the salesperson (document_create_by)
  lines: { code: string; qty: number; price?: number | string; name?: string; type?: "SparePart" | "Service" }[];
  paymentType?: string;
  paymentAmount?: number | string;
  slip?: string;
  remark?: string;
  fee?: number | string;
  tracking?: string;
  submit?: boolean; // true → รออนุมัติ, false → กำลังดำเนินการจัดทำ
};

export async function saveSaleOrder(i: SaleOrderInput, byUserId: number): Promise<SaleOrderDetail> {
  const cust = await getCustomerByCode(str(i.customerCode));
  if (!cust) throw new HttpError(400, "ต้องเลือกลูกค้า");
  const codes = i.lines.map((l) => str(l.code)).filter(Boolean);
  if (!codes.length) throw new HttpError(400, "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ");
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
  const byCode = new Map(prods.map((p) => [p.code ?? "", p]));

  const lines = i.lines
    .filter((l) => str(l.code))
    .map((l, idx) => {
      const p = byCode.get(str(l.code));
      const isService = l.type === "Service" || (!p && !!l.name);
      if (!p && !isService) throw new HttpError(400, `ไม่พบรหัสสินค้า ${l.code}`);
      const qty = Math.max(1, Math.trunc(num(l.qty) || 1));
      const price = l.price !== undefined && l.price !== "" ? num(l.price) : num(p?.retail);
      return { listNo: idx + 1, p, isService, code: str(l.code), name: str(l.name) || p?.name || "", qty, price, amount: Math.round(qty * price * 100) / 100 };
    });
  const totalBase = lines.reduce((s, l) => s + l.amount, 0);
  const fee = num(i.fee);
  const net = Math.round((totalBase + fee) * 100) / 100;
  const approveId = i.submit === false ? AS.DRAFT : AS.WAIT;

  const no = await db.transaction(async (tx) => {
    const now = nowThai();
    const hdValues = {
      customerId: cust.id,
      customerCode: cust.code,
      customerCardId: cust.taxId,
      customerName: cust.name,
      customerAddress: cust.address.slice(0, 500),
      customerPhoneNumber: cust.phone,
      customerFaxNumber: "",
      totalBaseAmount: money(totalBase),
      vatRat: "0.00",
      vatAmount: "0.00",
      totalAmount: money(totalBase),
      roundingAmount: "0.00",
      feeAmount: money(fee),
      netAmount: money(net),
      remarkHd: str(i.remark).slice(0, 100),
      paymentType: str(i.paymentType) || "โอนเงิน",
      paymentAmount: money(i.paymentAmount !== undefined && i.paymentAmount !== "" ? num(i.paymentAmount) : net),
      slipFileName: str(i.slip).slice(0, 100),
      deliveryTrackingNo: str(i.tracking).slice(0, 50),
    };
    let no = i.no;
    if (no) {
      const [prev] = await tx.select({ st: saleOutHd.approveStatusId }).from(saleOutHd).where(eq(saleOutHd.saleOutHdNo, no));
      if (!prev) throw new HttpError(404, "ไม่พบใบสั่งขาย " + no);
      if (prev.st === AS.APPROVED) throw new HttpError(409, "ใบสั่งขายอนุมัติแล้ว แก้ไขไม่ได้");
      await tx
        .update(saleOutHd)
        .set({ ...hdValues, approveStatusId: approveId, ...(i.salesId ? { documentCreateBy: Number(i.salesId) } : {}) })
        .where(eq(saleOutHd.saleOutHdNo, no));
      await tx.delete(saleOutDt).where(eq(saleOutDt.saleOutHdNo, no));
    } else {
      no = await nextRunningNo(tx, "SaleOrder");
      await tx.insert(saleOutHd).values({
        ...hdValues,
        saleOutHdNo: no,
        documentType: "SaleOrder",
        documentCreateDate: now,
        documentCreateBy: i.salesId ? Number(i.salesId) : byUserId,
        documentStatus: true,
        documentCreditNoteNo: "",
        documentCancelDate: SENTINEL_TS,
        documentCancelBy: -1,
        documentCancelRemark: "",
        isSaleOut: true,
        saleOutDate: now,
        saleOutBy: byUserId,
        referenceNo: "",
        approveStatusId: approveId,
        approveDate: SENTINEL_TS,
        approveBy: -1,
        approveRemark: "",
        deliveryDate: SENTINEL_TS,
      });
    }
    await tx.insert(saleOutDt).values(
      lines.map((l) => ({
        saleOutHdNo: no!,
        listNo: l.listNo,
        productId: l.p?.id ?? null,
        storeLocationId: 1,
        conditionId: 1,
        serialNo: "",
        capitalPrice: money(num(l.p?.capital)),
        wholesalePrice: money(num(l.p?.wholesale)),
        retailPrice: money(num(l.p?.retail)),
        saleOutPrice: money(l.price),
        saleOutQuantity: l.qty,
        amountDt: money(l.amount),
        remarkDt: l.isService ? l.name.slice(0, 100) : "",
        onhandItemId: l.p?.itemId ?? null,
        productType: l.isService ? "Service" : "SparePart",
        documentCreditNoteNo: "",
        productCode: l.code.slice(0, 50),
        pickInventoryNo: "",
        returnInventoryNo: "",
      }))
    );
    return no!;
  });
  return (await getSaleOrder(no))!;
}

/**
 * Approval: 4 อนุมัติ → stock goes out (WHO type 4) at this moment, as the legacy
 * data shows; 5 ปฏิเสธ / 3 แก้ไขข้อมูล just stamp the decision.
 */
export async function approveSaleOrder(no: string, decision: "approve" | "deny" | "reject", remark: string, byUserId: number): Promise<SaleOrderDetail> {
  const statusId = decision === "approve" ? AS.APPROVED : decision === "deny" ? AS.DENIED : AS.REJECT;
  await db.transaction(async (tx) => {
    const [hd] = await tx.select().from(saleOutHd).where(eq(saleOutHd.saleOutHdNo, no)).for("update");
    if (!hd) throw new HttpError(404, "ไม่พบใบสั่งขาย " + no);
    if (hd.approveStatusId === AS.APPROVED) throw new HttpError(409, "อนุมัติไปแล้ว");
    await tx
      .update(saleOutHd)
      .set({ approveStatusId: statusId, approveDate: nowThai(), approveBy: byUserId, approveRemark: str(remark).slice(0, 100) })
      .where(eq(saleOutHd.saleOutHdNo, no));
    if (decision === "approve") {
      const hasGoods = await tx
        .select({ n: count() })
        .from(saleOutDt)
        .where(and(eq(saleOutDt.saleOutHdNo, no), ne(saleOutDt.productType, "Service")));
      if (Number(hasGoods[0]?.n ?? 0) > 0) await issueForSaleOrder({ soNo: no, payTo: hd.customerName ?? "" }, byUserId, tx);
    }
  });
  return (await getSaleOrder(no))!;
}

export async function setTracking(no: string, tracking: string, byUserId: number): Promise<SaleOrderDetail> {
  const r = await db
    .update(saleOutHd)
    .set({ deliveryTrackingNo: str(tracking).slice(0, 50), deliveryDate: nowThai() })
    .where(eq(saleOutHd.saleOutHdNo, no))
    .returning({ no: saleOutHd.saleOutHdNo });
  if (!r[0]) throw new HttpError(404, "ไม่พบใบสั่งขาย " + no);
  void byUserId;
  return (await getSaleOrder(no))!;
}

export async function approveStatuses() {
  return db.select().from(approveStatus).orderBy(asc(approveStatus.approveStatusId));
}
