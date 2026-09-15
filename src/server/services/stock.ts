import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, lte, ne, or, sql } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import {
  appUser,
  category,
  inventoryDt,
  inventoryHd,
  inventoryType,
  jobOrderSparePartLog,
  manufacturer,
  product,
  productModel,
  productNoneSerial,
  saleOutDt,
  saleOutHd,
  storeLocation,
} from "@/db/schema";
import type { Movement, Product } from "@/data/mock";
import { HttpError, fullName } from "@/server/auth";
import { fmtDateTime, money, nowThai, num, str, SENTINEL_TS } from "@/server/mappers/format";
import { nextRunningNo } from "@/db/running-no";

export type DeletedMode = "exclude" | "only" | "all";

/** The legacy system runs a single warehouse / condition and no serial control. */
export const STORE_LOCATION_ID = 1;
export const CONDITION_ID = 1;
export const ITEM_UNIT = "Pcs.";

/** inventory_type ids */
export const INV = {
  RECEIVE: 1, // รับเข้า
  RETURN_FROM_JOB: 2, // รับคืนจากการเบิก
  OUT_JOB: 3, // จ่ายออกตามงานซ่อม
  OUT_SALE: 4, // จ่ายออกตามใบสั่งขาย
  OUT_OTHER: 5, // จ่ายออกอื่นๆ
} as const;

/** job_order_spare_part_log.order_status_id */
export const PART = { REQUESTED: 1, RETURN_REQUESTED: 2, GRANTED: 3, CANCELLED: 4, RETURNED: 5 } as const;

/* ------------------------------------------------------------------ *
 * Products
 * ------------------------------------------------------------------ */
const productSelect = {
  id: product.productId,
  sysCode: product.productCode,
  mfgCode: product.productVenderCode,
  name: product.productName,
  nameEn: product.productNameEn,
  nameCn: product.productNameCn,
  description: product.productDescription,
  categoryId: product.categoryId,
  category: category.categoryName,
  manufacturerId: product.manufacturerId,
  brand: manufacturer.manufacturerName,
  active: product.isActive,
  createDate: product.createDate,
  createBy: product.createBy,
  ubOnly: product.isUbRepairOnly,
  forModelColor: product.forModelColor,
  onhand: productNoneSerial.quantityRemain,
  available: productNoneSerial.quantityAvailable,
  used: productNoneSerial.quantityUsed,
  booking: productNoneSerial.quantityBooking,
  capital: productNoneSerial.capitalPrice,
  wholesale: productNoneSerial.wholesalePrice,
  retail: productNoneSerial.retailPrice,
  onhandItemId: productNoneSerial.itemId,
};

type ProductRow = {
  [K in keyof typeof productSelect]: (typeof productSelect)[K]["_"]["data"] | null;
};

function toProduct(r: ProductRow, creator?: string): Product {
  return {
    sysCode: r.sysCode ?? "",
    mfgCode: r.mfgCode ?? "",
    name: r.name ?? "",
    category: r.category ?? "",
    brand: r.brand ?? "",
    onhand: r.onhand ?? 0,
    price: num(r.retail),
    status: r.active === false ? "Inactive" : "Active",
    id: r.id ?? 0,
    nameEn: r.nameEn ?? "",
    nameCn: r.nameCn ?? "",
    description: r.description ?? "",
    capitalPrice: num(r.capital),
    wholesalePrice: num(r.wholesale),
    received: r.available ?? 0,
    issued: r.used ?? 0,
    reserved: r.booking ?? 0,
    ubRepairOnly: !!r.ubOnly,
    forModelColor: r.forModelColor ?? "",
    createdDate: fmtDateTime(r.createDate),
    createdBy: creator ?? "",
  };
}

const productQuery = () =>
  db
    .select(productSelect)
    .from(product)
    .leftJoin(category, eq(category.categoryId, product.categoryId))
    .leftJoin(manufacturer, eq(manufacturer.manufacturerId, product.manufacturerId))
    .leftJoin(productNoneSerial, eq(productNoneSerial.productId, product.productId));

export async function listProducts(opts: { deleted?: DeletedMode; q?: string } = {}): Promise<Product[]> {
  const { deleted = "exclude", q = "" } = opts;
  const active = deleted === "exclude" ? ne(product.isActive, false) : deleted === "only" ? eq(product.isActive, false) : undefined;
  const term = q.trim();
  const search = term
    ? or(ilike(product.productCode, `%${term}%`), ilike(product.productName, `%${term}%`), ilike(product.productVenderCode, `%${term}%`))
    : undefined;
  const rows = await productQuery().where(and(active, search)).orderBy(asc(product.productCode));
  return rows.map((r) => toProduct(r));
}

export async function getProduct(code: string): Promise<(Product & { models: string[] }) | null> {
  const [r] = await productQuery().where(eq(product.productCode, code)).limit(1);
  if (!r) return null;
  const [creator] = r.createBy
    ? await db.select({ f: appUser.firstName, l: appUser.lastName }).from(appUser).where(eq(appUser.userId, r.createBy))
    : [];
  const models = await db
    .select({ code: productModel.modelCode })
    .from(productModel)
    .where(eq(productModel.productId, r.id!));
  return { ...toProduct(r, creator ? fullName(creator.f, creator.l) : ""), models: models.map((m) => m.code ?? "").filter(Boolean) };
}

export type ProductInput = {
  sysCode?: string;
  mfgCode?: string;
  name: string;
  nameEn?: string;
  nameCn?: string;
  description?: string;
  category?: string;
  brand?: string;
  price?: number | string;
  capitalPrice?: number | string;
  wholesalePrice?: number | string;
  status?: string;
  ubRepairOnly?: boolean;
  forModelColor?: string;
  models?: string[];
};

export async function saveProduct(i: ProductInput, byUserId: number): Promise<Product> {
  const name = str(i.name).slice(0, 500);
  if (!name) throw new HttpError(400, "ต้องระบุชื่ออะไหล่");
  const [cat] = i.category
    ? await db.select({ id: category.categoryId }).from(category).where(eq(category.categoryName, str(i.category))).limit(1)
    : [];
  const [mfg] = i.brand
    ? await db.select({ id: manufacturer.manufacturerId }).from(manufacturer).where(eq(manufacturer.manufacturerName, str(i.brand))).limit(1)
    : [];

  const code = await db.transaction(async (tx) => {
    const values = {
      productVenderCode: str(i.mfgCode).slice(0, 50),
      productName: name,
      productNameEn: str(i.nameEn).slice(0, 200),
      productNameCn: str(i.nameCn).slice(0, 200),
      productDescription: str(i.description).slice(0, 200),
      categoryId: cat?.id ?? 1,
      manufacturerId: mfg?.id ?? null,
      isActive: (i.status ?? "Active") !== "Inactive",
      isUbRepairOnly: !!i.ubRepairOnly,
      forModelColor: str(i.forModelColor).slice(0, 50),
    };
    let productId: number;
    let code = i.sysCode;
    if (code) {
      const [row] = await tx.update(product).set(values).where(eq(product.productCode, code)).returning({ id: product.productId });
      if (!row) throw new HttpError(404, "product not found");
      productId = row.id;
    } else {
      code = await nextRunningNo(tx, "Product");
      const [row] = await tx
        .insert(product)
        .values({
          ...values,
          productCode: code,
          isSerialControl: false,
          pictrueFileName: "",
          createDate: nowThai(),
          createBy: byUserId,
          cancelRemark: "",
          cancelDate: SENTINEL_TS,
          cancelBy: -1,
        })
        .returning({ id: product.productId });
      productId = row.id;
    }

    // on-hand row (prices live here)
    const prices = {
      capitalPrice: i.capitalPrice !== undefined ? money(num(i.capitalPrice)) : undefined,
      wholesalePrice: i.wholesalePrice !== undefined ? money(num(i.wholesalePrice)) : undefined,
      retailPrice: i.price !== undefined ? money(num(i.price)) : undefined,
    };
    const [onhand] = await tx.select({ id: productNoneSerial.itemId }).from(productNoneSerial).where(eq(productNoneSerial.productId, productId));
    if (onhand) {
      await tx.update(productNoneSerial).set(prices).where(eq(productNoneSerial.itemId, onhand.id));
    } else {
      await tx.insert(productNoneSerial).values({
        productId,
        storeLocationId: STORE_LOCATION_ID,
        conditionId: CONDITION_ID,
        capitalPrice: prices.capitalPrice ?? "0.00",
        wholesalePrice: prices.wholesalePrice ?? "0.00",
        retailPrice: prices.retailPrice ?? "0.00",
        remark: "",
        isPublish: true,
        quantityInspection: 0,
        quantityNotAvailable: 0,
        quantityAvailable: 0,
        quantityUsed: 0,
        quantityBooking: 0,
        quantityLoss: 0,
        quantityRemain: 0,
      });
    }

    if (i.models) {
      await tx.delete(productModel).where(eq(productModel.productId, productId));
      const codes = Array.from(new Set(i.models.map((m) => str(m)).filter(Boolean)));
      if (codes.length) await tx.insert(productModel).values(codes.map((c) => ({ productId, modelCode: c })));
    }
    return code!;
  });
  return (await getProduct(code))!;
}

/* ------------------------------------------------------------------ *
 * Quantities — the one place that touches product_none_serial counters.
 *   available = cumulative received, used = cumulative issued,
 *   booking   = requested-not-yet-granted, remain = available - used
 * ------------------------------------------------------------------ */
async function adjustQty(
  tx: Tx,
  productId: number,
  d: { available?: number; used?: number; booking?: number },
  opts: { allowNegative?: boolean } = {}
) {
  const [row] = await tx
    .select()
    .from(productNoneSerial)
    .where(eq(productNoneSerial.productId, productId))
    .for("update");
  if (!row) throw new HttpError(400, `ไม่มีข้อมูลสต๊อกของสินค้า #${productId}`);
  const available = (row.quantityAvailable ?? 0) + (d.available ?? 0);
  const used = (row.quantityUsed ?? 0) + (d.used ?? 0);
  const booking = Math.max(0, (row.quantityBooking ?? 0) + (d.booking ?? 0));
  // apply the delta to remain (a few legacy rows drifted from available-used; keep their numbers)
  const remain = (row.quantityRemain ?? 0) + (d.available ?? 0) - (d.used ?? 0);
  if (remain < 0 && !opts.allowNegative) throw new HttpError(409, "สต๊อกไม่พอ (คงเหลือติดลบ)");
  await tx
    .update(productNoneSerial)
    .set({ quantityAvailable: available, quantityUsed: used, quantityBooking: booking, quantityRemain: remain })
    .where(eq(productNoneSerial.itemId, row.itemId));
  return remain;
}

async function productsByCode(tx: Tx, codes: string[]) {
  if (!codes.length) return new Map<string, { id: number; name: string }>();
  const rows = await tx
    .select({ id: product.productId, code: product.productCode, name: product.productName })
    .from(product)
    .where(inArray(product.productCode, codes));
  return new Map(rows.map((r) => [r.code ?? "", { id: r.id, name: r.name ?? "" }]));
}

async function insertMovement(
  tx: Tx,
  h: { typeId: number; ref?: string; outTo?: string; remark?: string; date?: string },
  lines: { code: string; qty: number }[],
  byUserId: number
): Promise<string> {
  const no = await nextRunningNo(tx, h.typeId === INV.RECEIVE || h.typeId === INV.RETURN_FROM_JOB ? "Inventory-In" : "Inventory-Out");
  await tx.insert(inventoryHd).values({
    inventoryNo: no,
    inventoryTypeId: h.typeId,
    itemType: "SparePart",
    referenceDocumentNo: str(h.ref).slice(0, 50),
    referenceOutTo: str(h.outTo).slice(0, 50),
    inventoryRemark: str(h.remark).slice(0, 100),
    createDate: h.date ? `${h.date} ${nowThai().slice(11)}` : nowThai(),
    createBy: byUserId,
    isActive: true,
    companyId: null,
    branchId: null,
  });
  await tx.insert(inventoryDt).values(
    lines.map((l) => ({
      inventoryNo: no,
      itemCode: l.code,
      itemQuantity: l.qty.toFixed(4),
      itemUnit: ITEM_UNIT,
      storeLocationId: STORE_LOCATION_ID,
      stockTypeId: 1,
      receiveInventoryNo: "",
    }))
  );
  return no;
}

export type StockLine = { code: string; qty: number };

/** รับเข้าอะไหล่ → WHI (type 1), available += qty. */
export async function receiveStock(
  i: { date?: string; poRef?: string; supplier?: string; remark?: string; lines: StockLine[] },
  byUserId: number
): Promise<{ no: string; total: number }> {
  const lines = i.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new HttpError(400, "ยังไม่ได้ระบุจำนวนรับเข้า");
  return db.transaction(async (tx) => {
    const map = await productsByCode(tx, lines.map((l) => l.code));
    for (const l of lines) {
      const p = map.get(l.code);
      if (!p) throw new HttpError(400, `ไม่พบรหัสอะไหล่ ${l.code}`);
      await adjustQty(tx, p.id, { available: l.qty });
    }
    const remark = [i.supplier ? `Supplier: ${i.supplier}` : "", i.remark ?? ""].filter(Boolean).join(" · ");
    const no = await insertMovement(tx, { typeId: INV.RECEIVE, ref: i.poRef, remark, date: i.date }, lines, byUserId);
    return { no, total: lines.reduce((s, l) => s + l.qty, 0) };
  });
}

/** จ่ายออกอื่นๆ → WHO (type 5). */
export async function issueOther(
  i: { payTo: string; remark?: string; lines: StockLine[] },
  byUserId: number
): Promise<{ no: string; total: number }> {
  const lines = i.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new HttpError(400, "ยังไม่ได้ระบุจำนวนจ่ายออก");
  return db.transaction(async (tx) => {
    const map = await productsByCode(tx, lines.map((l) => l.code));
    for (const l of lines) {
      const p = map.get(l.code);
      if (!p) throw new HttpError(400, `ไม่พบรหัสอะไหล่ ${l.code}`);
      await adjustQty(tx, p.id, { used: l.qty });
    }
    const no = await insertMovement(tx, { typeId: INV.OUT_OTHER, outTo: i.payTo, remark: i.remark }, lines, byUserId);
    return { no, total: lines.reduce((s, l) => s + l.qty, 0) };
  });
}

/* ---- job spare-part requests (ใบเบิก) ---- */
export type PartRequestLine = {
  logId: number;
  jobNo: string;
  code: string;
  name: string;
  onhand: number;
  need: number; // still to grant
  requested: number;
  granted: number;
  statusId: number;
  status: string;
  unitPrice: number;
  isQuotation: boolean;
  isSpecial: boolean;
  requestQtyB: number;
  isQuotationB: boolean;
  isSpecialB: boolean;
};

const PART_STATUS_NAME: Record<number, string> = {
  1: "รอเบิก",
  2: "ขอคืน",
  3: "จ่ายแล้ว",
  4: "ยกเลิก",
  5: "คืนแล้ว",
};

export async function listPartRequests(jobNo: string, onlyPending = false): Promise<PartRequestLine[]> {
  const rows = await db
    .select({
      logId: jobOrderSparePartLog.jobOrderLogId,
      jobNo: jobOrderSparePartLog.jobNo,
      code: jobOrderSparePartLog.sparePartCode,
      name: product.productName,
      onhand: productNoneSerial.quantityRemain,
      requested: jobOrderSparePartLog.requestQty,
      granted: jobOrderSparePartLog.grantQty,
      statusId: jobOrderSparePartLog.orderStatusId,
      unitPrice: jobOrderSparePartLog.sparePartUnitPrice,
      isQuotation: jobOrderSparePartLog.isQuotation,
      isSpecial: jobOrderSparePartLog.isSpecial,
      requestQtyB: jobOrderSparePartLog.requestQtyB,
      isQuotationB: jobOrderSparePartLog.isQuotationB,
      isSpecialB: jobOrderSparePartLog.isSpecialB,
    })
    .from(jobOrderSparePartLog)
    .leftJoin(product, eq(product.productCode, jobOrderSparePartLog.sparePartCode))
    .leftJoin(productNoneSerial, eq(productNoneSerial.productId, product.productId))
    .where(
      and(
        eq(jobOrderSparePartLog.jobNo, jobNo),
        onlyPending
          ? and(eq(jobOrderSparePartLog.orderStatusId, PART.REQUESTED), sql`coalesce(${jobOrderSparePartLog.requestQty},0) > coalesce(${jobOrderSparePartLog.grantQty},0)`)
          : ne(jobOrderSparePartLog.orderStatusId, PART.CANCELLED)
      )
    )
    .orderBy(asc(jobOrderSparePartLog.jobOrderLogId));
  return rows.map((r) => {
    const requested = r.requested ?? 0;
    const granted = r.granted ?? 0;
    return {
      logId: r.logId,
      jobNo: r.jobNo ?? jobNo,
      code: r.code ?? "",
      name: r.name ?? "",
      onhand: r.onhand ?? 0,
      need: Math.max(0, requested - granted),
      requested,
      granted,
      statusId: r.statusId ?? 1,
      status:
        r.statusId === PART.REQUESTED && granted > 0 && granted < requested
          ? "เบิกบางส่วน"
          : r.statusId === PART.REQUESTED && (r.onhand ?? 0) === 0
            ? "รออะไหล่"
            : (PART_STATUS_NAME[r.statusId ?? 1] ?? ""),
      unitPrice: num(r.unitPrice),
      isQuotation: !!r.isQuotation,
      isSpecial: !!r.isSpecial,
      requestQtyB: r.requestQtyB ?? 0,
      isQuotationB: !!r.isQuotationB,
      isSpecialB: !!r.isSpecialB,
    };
  });
}

/** จ่ายออกตามงานซ่อม → WHO (type 3) + grant on the request rows. */
export async function issueForJob(
  i: { jobNo: string; remark?: string; payTo?: string; lines: { logId: number; qty: number }[] },
  byUserId: number
): Promise<{ no: string; total: number; allGranted: boolean }> {
  const lines = i.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new HttpError(400, "ยังไม่ได้ระบุจำนวนจ่ายออก");
  return db.transaction(async (tx) => {
    const reqs = await tx
      .select()
      .from(jobOrderSparePartLog)
      .where(and(eq(jobOrderSparePartLog.jobNo, i.jobNo), inArray(jobOrderSparePartLog.jobOrderLogId, lines.map((l) => l.logId))))
      .for("update");
    const byId = new Map(reqs.map((r) => [r.jobOrderLogId, r]));
    const mvLines: StockLine[] = [];
    const now = nowThai();
    for (const l of lines) {
      const r = byId.get(l.logId);
      if (!r || r.orderStatusId !== PART.REQUESTED) throw new HttpError(400, `รายการเบิก #${l.logId} ไม่อยู่ในสถานะรอเบิก`);
      const need = (r.requestQty ?? 0) - (r.grantQty ?? 0);
      if (l.qty > need) throw new HttpError(400, `จ่ายเกินจำนวนที่ขอ (${r.sparePartCode})`);
      const map = await productsByCode(tx, [r.sparePartCode ?? ""]);
      const p = map.get(r.sparePartCode ?? "");
      if (!p) throw new HttpError(400, `ไม่พบรหัสอะไหล่ ${r.sparePartCode}`);
      await adjustQty(tx, p.id, { used: l.qty, booking: -l.qty });
      const granted = (r.grantQty ?? 0) + l.qty;
      await tx
        .update(jobOrderSparePartLog)
        .set({
          grantQty: granted,
          grantDate: now,
          grantBy: byUserId,
          orderStatusId: granted >= (r.requestQty ?? 0) ? PART.GRANTED : PART.REQUESTED,
        })
        .where(eq(jobOrderSparePartLog.jobOrderLogId, r.jobOrderLogId));
      mvLines.push({ code: r.sparePartCode ?? "", qty: l.qty });
    }
    const no = await insertMovement(tx, { typeId: INV.OUT_JOB, ref: i.jobNo, outTo: i.payTo, remark: i.remark }, mvLines, byUserId);
    const [pending] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(jobOrderSparePartLog)
      .where(
        and(
          eq(jobOrderSparePartLog.jobNo, i.jobNo),
          eq(jobOrderSparePartLog.orderStatusId, PART.REQUESTED),
          sql`coalesce(${jobOrderSparePartLog.requestQty},0) > coalesce(${jobOrderSparePartLog.grantQty},0)`
        )
      );
    return { no, total: mvLines.reduce((s, l) => s + l.qty, 0), allGranted: (pending?.n ?? 0) === 0 };
  });
}

/* ---- sale order picking ---- */
export type SoPickLine = { dtId: number; code: string; name: string; onhand: number; need: number; picked: boolean };

export async function listSaleOrderPickLines(soNo: string): Promise<SoPickLine[]> {
  const rows = await db
    .select({
      dtId: saleOutDt.saleOutDtId,
      code: saleOutDt.productCode,
      name: product.productName,
      onhand: productNoneSerial.quantityRemain,
      qty: saleOutDt.saleOutQuantity,
      pick: saleOutDt.pickInventoryNo,
      type: saleOutDt.productType,
    })
    .from(saleOutDt)
    .leftJoin(product, eq(product.productId, saleOutDt.productId))
    .leftJoin(productNoneSerial, eq(productNoneSerial.productId, product.productId))
    .where(and(eq(saleOutDt.saleOutHdNo, soNo), ne(saleOutDt.productType, "Service")))
    .orderBy(asc(saleOutDt.listNo));
  return rows.map((r) => ({
    dtId: r.dtId,
    code: r.code ?? "",
    name: r.name ?? "",
    onhand: r.onhand ?? 0,
    need: r.qty,
    picked: !!r.pick,
  }));
}

/** จ่ายออกตามใบสั่งขาย → WHO (type 4); stamps pick_inventory_no / reference_no. */
export async function issueForSaleOrder(
  i: { soNo: string; remark?: string; payTo?: string; lines?: { dtId: number; qty: number }[] },
  byUserId: number,
  tx?: Tx
): Promise<{ no: string; total: number }> {
  const run = async (t: Tx) => {
    const dts = await t
      .select()
      .from(saleOutDt)
      .where(and(eq(saleOutDt.saleOutHdNo, i.soNo), ne(saleOutDt.productType, "Service")))
      .for("update");
    const want = i.lines ? new Map(i.lines.map((l) => [l.dtId, l.qty])) : null;
    const mv: StockLine[] = [];
    const picked: number[] = [];
    for (const d of dts) {
      if (d.pickInventoryNo) continue;
      const qty = want ? (want.get(d.saleOutDtId) ?? 0) : d.saleOutQuantity;
      if (qty <= 0) continue;
      if (qty > d.saleOutQuantity) throw new HttpError(400, `จ่ายเกินจำนวนในใบสั่งขาย (${d.productCode})`);
      if (!d.productId) throw new HttpError(400, `รายการ ${d.productCode} ไม่มี product_id`);
      await adjustQty(t, d.productId, { used: qty });
      mv.push({ code: d.productCode ?? "", qty });
      picked.push(d.saleOutDtId);
    }
    if (!mv.length) throw new HttpError(400, "ไม่มีรายการที่ต้องจ่ายออก");
    const no = await insertMovement(t, { typeId: INV.OUT_SALE, ref: i.soNo, outTo: i.payTo, remark: i.remark }, mv, byUserId);
    await t.update(saleOutDt).set({ pickInventoryNo: no }).where(inArray(saleOutDt.saleOutDtId, picked));
    await t.update(saleOutHd).set({ referenceNo: no }).where(eq(saleOutHd.saleOutHdNo, i.soNo));
    return { no, total: mv.reduce((s, l) => s + l.qty, 0) };
  };
  return tx ? run(tx) : db.transaction(run);
}

/* ------------------------------------------------------------------ *
 * Movements (ประวัติการเคลื่อนไหว) — inventory_hd + summarised lines
 * ------------------------------------------------------------------ */
export async function listMovements(opts: { limit?: number; q?: string; from?: string; to?: string; type?: string } = {}): Promise<Movement[]> {
  const { limit = 1000, q = "", from, to, type } = opts;
  const term = q.trim();
  const rows = await db
    .select({
      doc: inventoryHd.inventoryNo,
      type: inventoryType.inventoryTypeName,
      typeId: inventoryHd.inventoryTypeId,
      ref: inventoryHd.referenceDocumentNo,
      outTo: inventoryHd.referenceOutTo,
      date: inventoryHd.createDate,
      remark: inventoryHd.inventoryRemark,
      byFirst: appUser.firstName,
      byLast: appUser.lastName,
      qty: sql<string>`(select coalesce(sum(d.item_quantity),0) from inventory_dt d where d.inventory_no = ${inventoryHd.inventoryNo})`,
      items: sql<string>`(select string_agg(d.item_code || ' x' || d.item_quantity::int, ', ' order by d.inventory_dt_id) from inventory_dt d where d.inventory_no = ${inventoryHd.inventoryNo})`,
      loc: storeLocation.storeLocationName,
    })
    .from(inventoryHd)
    .leftJoin(inventoryType, eq(inventoryType.inventoryTypeId, inventoryHd.inventoryTypeId))
    .leftJoin(appUser, eq(appUser.userId, inventoryHd.createBy))
    .leftJoin(storeLocation, eq(storeLocation.storeLocationId, STORE_LOCATION_ID))
    .where(
      and(
        ne(inventoryHd.isActive, false),
        term
          ? or(
              ilike(inventoryHd.inventoryNo, `%${term}%`),
              ilike(inventoryHd.referenceDocumentNo, `%${term}%`),
              sql`exists (select 1 from inventory_dt d where d.inventory_no = ${inventoryHd.inventoryNo} and d.item_code ilike ${"%" + term + "%"})`
            )
          : undefined,
        from ? gte(inventoryHd.createDate, `${from} 00:00:00`) : undefined,
        to ? lte(inventoryHd.createDate, `${to} 23:59:59`) : undefined,
        type ? eq(inventoryType.inventoryTypeName, type) : undefined
      )
    )
    .orderBy(desc(inventoryHd.createDate), desc(inventoryHd.inventoryHdId))
    .limit(Math.min(limit, 5000));
  return rows.map((r) => {
    const isIn = r.typeId === INV.RECEIVE || r.typeId === INV.RETURN_FROM_JOB;
    const wh = r.loc ?? "คลังสินค้าดี";
    return {
      doc: r.doc ?? "",
      type: r.type ?? "",
      ref: r.ref ?? "",
      date: fmtDateTime(r.date),
      by: fullName(r.byFirst, r.byLast),
      from: isIn ? r.outTo || r.ref || "Supplier" : wh,
      to: isIn ? wh : r.outTo || r.ref || "",
      remark: [r.items ? r.items : "", r.remark ?? ""].filter(Boolean).join(" · "),
      qty: num(r.qty),
      items: r.items ?? "",
    };
  });
}

/** Stock card for one product (product-detail modal). */
export async function productStockCard(code: string) {
  const rows = await db
    .select({
      no: inventoryHd.inventoryNo,
      date: inventoryHd.createDate,
      type: inventoryType.inventoryTypeName,
      action: inventoryType.movementAction,
      qty: inventoryDt.itemQuantity,
      ref: inventoryHd.referenceDocumentNo,
      remark: inventoryHd.inventoryRemark,
    })
    .from(inventoryDt)
    .innerJoin(inventoryHd, eq(inventoryHd.inventoryNo, inventoryDt.inventoryNo))
    .leftJoin(inventoryType, eq(inventoryType.inventoryTypeId, inventoryHd.inventoryTypeId))
    .where(and(eq(inventoryDt.itemCode, code), ne(inventoryHd.isActive, false)))
    .orderBy(asc(inventoryHd.createDate), asc(inventoryDt.inventoryDtId));
  let bal = 0;
  return rows.map((r) => {
    const q = num(r.qty);
    const inc = (r.action ?? 1) > 0 ? q : 0;
    const out = (r.action ?? 1) < 0 ? q : 0;
    const before = bal;
    bal = bal + inc - out;
    return { no: r.no ?? "", date: fmtDateTime(r.date), type: r.type ?? "", before, income: inc, outcome: out, after: bal, ref: r.ref ?? "", remark: r.remark ?? "" };
  }).reverse();
}

export { adjustQty, insertMovement, productsByCode };

/** Line items of one movement document (inventory_dt joined to product). */
export async function movementLines(no: string) {
  const rows = await db
    .select({
      code: inventoryDt.itemCode,
      name: product.productName,
      qty: inventoryDt.itemQuantity,
      unit: inventoryDt.itemUnit,
      supplier: inventoryHd.inventoryRemark,
      ref: inventoryHd.referenceDocumentNo,
    })
    .from(inventoryDt)
    .innerJoin(inventoryHd, eq(inventoryHd.inventoryNo, inventoryDt.inventoryNo))
    .leftJoin(product, eq(product.productCode, inventoryDt.itemCode))
    .where(eq(inventoryDt.inventoryNo, no))
    .orderBy(asc(inventoryDt.inventoryDtId));
  return rows.map((r) => ({
    code: r.code ?? "",
    name: r.name ?? "",
    qty: num(r.qty),
    unit: r.unit ?? ITEM_UNIT,
    supplier: (r.supplier ?? "").match(/Supplier:\s*([^·]+)/)?.[1]?.trim() ?? "",
    ref: r.ref ?? "",
  }));
}

/** รายงานการเบิกจ่ายอะไหล่ — every issued line (WHO types 3/4/5) in a date range. */
export async function listIssuedLines(opts: { from?: string; to?: string; category?: string; code?: string; limit?: number } = {}) {
  const rows = await db
    .select({
      doc: inventoryHd.inventoryNo,
      date: inventoryHd.createDate,
      type: inventoryType.inventoryTypeName,
      ref: inventoryHd.referenceDocumentNo,
      code: inventoryDt.itemCode,
      item: product.productName,
      category: category.categoryName,
      qty: inventoryDt.itemQuantity,
      price: productNoneSerial.retailPrice,
      byFirst: appUser.firstName,
      byLast: appUser.lastName,
    })
    .from(inventoryDt)
    .innerJoin(inventoryHd, eq(inventoryHd.inventoryNo, inventoryDt.inventoryNo))
    .leftJoin(inventoryType, eq(inventoryType.inventoryTypeId, inventoryHd.inventoryTypeId))
    .leftJoin(product, eq(product.productCode, inventoryDt.itemCode))
    .leftJoin(category, eq(category.categoryId, product.categoryId))
    .leftJoin(productNoneSerial, eq(productNoneSerial.productId, product.productId))
    .leftJoin(appUser, eq(appUser.userId, inventoryHd.createBy))
    .where(
      and(
        inArray(inventoryHd.inventoryTypeId, [INV.OUT_JOB, INV.OUT_SALE, INV.OUT_OTHER]),
        ne(inventoryHd.isActive, false),
        opts.from ? gte(inventoryHd.createDate, `${opts.from} 00:00:00`) : undefined,
        opts.to ? lte(inventoryHd.createDate, `${opts.to} 23:59:59`) : undefined,
        opts.category ? eq(category.categoryName, opts.category) : undefined,
        opts.code ? or(ilike(inventoryDt.itemCode, `%${opts.code}%`), ilike(product.productName, `%${opts.code}%`)) : undefined
      )
    )
    .orderBy(desc(inventoryHd.createDate), asc(inventoryDt.inventoryDtId))
    .limit(Math.min(opts.limit ?? 5000, 20000));
  return rows.map((r) => {
    const qty = num(r.qty);
    const price = num(r.price);
    return {
      doc: r.doc ?? "",
      date: fmtDateTime(r.date),
      type: r.type ?? "",
      ref: r.ref ?? "",
      by: fullName(r.byFirst, r.byLast),
      from: "คลังสินค้าดี",
      to: r.ref ?? "",
      remark: "",
      code: r.code ?? "",
      item: r.item ?? "",
      category: r.category ?? "",
      qty,
      value: qty * price,
    };
  });
}
