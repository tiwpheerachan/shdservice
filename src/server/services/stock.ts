import 'server-only';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, type Tx } from '@/db/client';
import {
  appUser,
  category,
  inventoryDt,
  inventoryHd,
  inventoryType,
  job,
  jobOrderSparePartLog,
  jobStatus,
  manufacturer,
  model,
  product,
  productModel,
  productNoneSerial,
  saleOutDt,
  saleOutHd,
  storeLocation,
} from '@/db/schema';
import type { Movement, Product } from '@/data/mock';
import { HttpError, fullName, hasRight, type CurrentUser } from '@/server/auth';
import { assertVersion } from '@/server/http-error';
import { fmtDateTime, money, nowThai, num, str, SENTINEL_TS } from '@/server/mappers/format';
import { nextRunningNo } from '@/db/running-no';
import { audit, diff } from '@/server/audit';
import { RS, statusFilter, uiStatus, fromUiStatus, statusStamp, type StatusMode } from '@/server/record-status';
import { cached, invalidate, TTL_MASTER } from '@/server/cache';

export type DeletedMode = StatusMode;

/** The legacy system runs a single warehouse / condition and no serial control. */
export const STORE_LOCATION_ID = 1;
export const CONDITION_ID = 1;
export const ITEM_UNIT = 'Pcs.';

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
/** sale_out_hd.approve_status_id "อนุมัติ" (sale-orders.ts AS.APPROVED — not imported: that module imports this one) */
const SO_APPROVED = 4;

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
  active: product.recordStatus,
  createDate: product.createDate,
  createBy: product.createBy,
  ubOnly: product.isUbRepairOnly,
  serialControl: product.isSerialControl,
  forModelColor: product.forModelColor,
  picture: product.pictrueFileName,
  onhand: productNoneSerial.quantityRemain,
  available: productNoneSerial.quantityAvailable,
  used: productNoneSerial.quantityUsed,
  booking: productNoneSerial.quantityBooking,
  capital: productNoneSerial.capitalPrice,
  wholesale: productNoneSerial.wholesalePrice,
  retail: productNoneSerial.retailPrice,
  onhandItemId: productNoneSerial.itemId,
  stockRemark: productNoneSerial.remark,
  cancelRemark: product.cancelRemark,
  cancelDate: product.cancelDate,
  cancelBy: product.cancelBy,
};

type ProductRow = {
  [K in keyof typeof productSelect]: (typeof productSelect)[K]['_']['data'] | null;
};

function toProduct(r: ProductRow, creator?: string, canceller?: string): Product {
  return {
    stockRemark: r.stockRemark ?? '',
    cancelRemark: r.cancelRemark ?? '',
    cancelDate:
      r.cancelDate && !r.cancelDate.startsWith('1899') && !r.cancelDate.startsWith('1900')
        ? fmtDateTime(r.cancelDate)
        : '',
    cancelBy: canceller ?? '',
    sysCode: r.sysCode ?? '',
    mfgCode: r.mfgCode ?? '',
    name: r.name ?? '',
    category: r.category ?? '',
    brand: r.brand ?? '',
    onhand: r.onhand ?? 0,
    price: num(r.retail),
    status: uiStatus(r.active),
    id: r.id ?? 0,
    nameEn: r.nameEn ?? '',
    nameCn: r.nameCn ?? '',
    description: r.description ?? '',
    capitalPrice: num(r.capital),
    wholesalePrice: num(r.wholesale),
    received: r.available ?? 0,
    issued: r.used ?? 0,
    reserved: r.booking ?? 0,
    ubRepairOnly: !!r.ubOnly,
    serialControl: !!r.serialControl, // product.is_serial_control (คุม S/N) — null = False
    forModelColor: r.forModelColor ?? '',
    createdDate: fmtDateTime(r.createDate),
    createdBy: creator ?? '',
    image: r.picture ? (r.picture.includes('/') ? r.picture : `products/${r.sysCode}/${r.picture}`) : '',
  };
}

/** ราคาทุน: the special right Product Cost (System Admin always). The product API and the Excel export
 *  leave it out for everyone else — the screens only mirror that. */
export const canSeeCost = (u: CurrentUser) => hasRight(u, 'Product Cost');
/** ราคาทุน left out — and the edit `version`: productVersion hashes the cost, so the hash would give it away */
export const withoutCost = <T extends Product>(p: T): T => ({ ...p, capitalPrice: undefined, version: undefined });

const productQuery = (x: Tx | typeof db = db) =>
  x
    .select(productSelect)
    .from(product)
    .leftJoin(category, eq(category.categoryId, product.categoryId))
    .leftJoin(manufacturer, eq(manufacturer.manufacturerId, product.manufacturerId))
    .leftJoin(productNoneSerial, eq(productNoneSerial.productId, product.productId));

/** a name search looks in the Thai, English and Chinese names */
const nameLike = (t: string) =>
  or(
    ilike(product.productName, `%${t}%`),
    ilike(product.productNameEn, `%${t}%`),
    ilike(product.productNameCn, `%${t}%`),
  );
/** free-text search of every product list / picker: system code, vendor part no or any of the names */
const productSearch = (t: string) =>
  or(ilike(product.productCode, `%${t}%`), ilike(product.productVenderCode, `%${t}%`), nameLike(t));

export async function listProducts(opts: { deleted?: DeletedMode; q?: string } = {}): Promise<Product[]> {
  const { deleted = 'exclude', q = '' } = opts;
  const active = statusFilter(product.recordStatus, deleted);
  const term = q.trim();
  const search = term ? productSearch(term) : undefined;
  const rows = await productQuery().where(and(active, search)).orderBy(asc(product.productCode));
  return rows.map((r) => withoutCost(toProduct(r))); // list screens never show the cost
}

const modelsOf = async (x: Tx | typeof db, productId: number) =>
  (await x.select({ code: productModel.modelCode }).from(productModel).where(eq(productModel.productId, productId)))
    .map((m) => m.code ?? '')
    .filter(Boolean);

/**
 * Optimistic lock of the product form (assertVersion). product has no row_version column (drizzle/0026)
 * and the prices live in product_none_serial, whose counters every stock movement moves — so the version
 * is a hash of exactly what the form edits: a receipt / issue never makes an open form stale, another
 * save of the form always does, a save that changes nothing keeps it.
 */
function productVersion(r: ProductRow, models: string[]): number {
  const edited = [
    r.mfgCode,
    r.name,
    r.nameEn,
    r.nameCn,
    r.description,
    r.categoryId,
    r.manufacturerId,
    r.active,
    r.ubOnly,
    r.forModelColor,
    num(r.capital),
    num(r.wholesale),
    num(r.retail),
    [...models].sort(),
  ];
  return createHash('sha1').update(JSON.stringify(edited)).digest().readUInt32BE(0);
}

export async function getProduct(code: string): Promise<(Product & { models: string[]; version: number }) | null> {
  const [r] = await productQuery().where(eq(product.productCode, code)).limit(1);
  if (!r) return null;
  const [creator] = r.createBy
    ? await db.select({ f: appUser.firstName, l: appUser.lastName }).from(appUser).where(eq(appUser.userId, r.createBy))
    : [];
  const [canceller] =
    r.cancelBy && r.cancelBy > 0
      ? await db
          .select({ f: appUser.firstName, l: appUser.lastName })
          .from(appUser)
          .where(eq(appUser.userId, r.cancelBy))
      : [];
  const models = await modelsOf(db, r.id!);
  return {
    ...toProduct(r, creator ? fullName(creator.f, creator.l) : '', canceller ? fullName(canceller.f, canceller.l) : ''),
    models,
    version: productVersion(r, models),
  };
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
  /** `version` from getProduct as the edit form loaded it: another save since → 409; absent = no check */
  version?: number | string;
};

export async function saveProduct(i: ProductInput, byUserId: number): Promise<Product> {
  // an unchanged legacy vendor code still saves ("never worse"); a new / changed one must be clean
  const [cur] = i.sysCode
    ? await db
        .select({ mfgCode: product.productVenderCode })
        .from(product)
        .where(eq(product.productCode, i.sysCode))
        .limit(1)
    : [];
  assertValid(productSchema(cur), i);
  const name = clean(i.name);
  const [cat] = str(i.category)
    ? await db
        .select({ id: category.categoryId })
        .from(category)
        .where(sql`btrim(${category.categoryName}, E' \t\r\n') = ${str(i.category)}`)
        .limit(1)
    : [];
  const [mfg] = str(i.brand)
    ? await db
        .select({ id: manufacturer.manufacturerId })
        .from(manufacturer)
        .where(sql`btrim(${manufacturer.manufacturerName}, E' \t\r\n') = ${str(i.brand)}`) // legacy names carry trailing spaces
        .limit(1)
    : [];
  const modelCodes = Array.from(new Set((i.models ?? []).map((m) => str(m)).filter(Boolean)));
  const known = modelCodes.length
    ? new Set(
        (await db.select({ c: model.modelCode }).from(model).where(inArray(model.modelCode, modelCodes))).map(
          (r) => r.c,
        ),
      )
    : new Set();
  // a name that is not in the list used to be saved as "no brand" / category #1 without a word
  const fields: Record<string, string> = {};
  if (str(i.category) && !cat) fields.category = `ไม่พบหมวดหมู่ "${str(i.category)}" ในรายการ`;
  if (str(i.brand) && !mfg) fields.brand = `ไม่พบยี่ห้อ "${str(i.brand)}" ในรายการ`;
  const unknownModels = modelCodes.filter((c) => !known.has(c));
  if (unknownModels.length) fields.models = `ไม่พบรุ่นสินค้า ${unknownModels.join(', ')}`;
  if (Object.keys(fields).length) throw new HttpError(400, summary(fields), { fields });

  const code = await db.transaction(async (tx) => {
    const status = fromUiStatus(i.status);
    const values = {
      productVenderCode: cleanMfgCode(i.mfgCode),
      productName: name,
      productNameEn: clean(i.nameEn),
      productNameCn: clean(i.nameCn),
      productDescription: clean(i.description),
      categoryId: cat?.id ?? 1,
      manufacturerId: mfg?.id ?? null,
      isUbRepairOnly: !!i.ubRepairOnly,
      forModelColor: clean(i.forModelColor),
    };
    // on-hand row (prices live here)
    let prices = {
      capitalPrice: i.capitalPrice !== undefined ? money(num(i.capitalPrice)) : undefined,
      wholesalePrice: i.wholesalePrice !== undefined ? money(num(i.wholesalePrice)) : undefined,
      retailPrice: i.price !== undefined ? money(num(i.price)) : undefined,
    };
    let models = i.models ? modelCodes : undefined;
    let productId: number;
    let code = i.sysCode;
    if (code) {
      const [before] = await tx.select().from(product).where(eq(product.productCode, code)).for('update');
      if (!before) throw new HttpError(404, 'product not found');
      productId = before.productId;
      const [loaded] = await productQuery(tx).where(eq(product.productId, productId));
      const oldModels = await modelsOf(tx, productId);
      assertVersion(i.version, productVersion(loaded!, oldModels));
      // "never worse": only what really changes is written — a value equal to the stored one once both are
      // cleaned keeps the stored one (a legacy trailing space); saved unchanged = no write, no audit row
      const same: Record<string, boolean> = {
        productVenderCode: values.productVenderCode === cleanMfgCode(before.productVenderCode),
        productName: values.productName === clean(before.productName),
        productNameEn: values.productNameEn === clean(before.productNameEn),
        productNameCn: values.productNameCn === clean(before.productNameCn),
        productDescription: values.productDescription === clean(before.productDescription),
        categoryId: clean(i.category) === clean(loaded!.category), // the form sends the names it showed
        manufacturerId: clean(i.brand) === clean(loaded!.brand),
        isUbRepairOnly: values.isUbRepairOnly === !!before.isUbRepairOnly,
        forModelColor: values.forModelColor === clean(before.forModelColor),
      };
      const set: Partial<typeof product.$inferInsert> = Object.fromEntries(
        Object.entries(values).filter(([k]) => !same[k]),
      );
      if (uiStatus(before.recordStatus) !== uiStatus(status)) Object.assign(set, statusStamp(status, byUserId));
      const was = { capitalPrice: loaded!.capital, wholesalePrice: loaded!.wholesale, retailPrice: loaded!.retail };
      prices = {
        capitalPrice: num(prices.capitalPrice) !== num(was.capitalPrice) ? prices.capitalPrice : undefined,
        wholesalePrice: num(prices.wholesalePrice) !== num(was.wholesalePrice) ? prices.wholesalePrice : undefined,
        retailPrice: num(prices.retailPrice) !== num(was.retailPrice) ? prices.retailPrice : undefined,
      };
      if (models && [...models].sort().join('\n') === [...oldModels].sort().join('\n')) models = undefined;
      if (Object.keys(set).length) await tx.update(product).set(set).where(eq(product.productId, productId));
      const changes = diff(
        { ...before, ...was, models: oldModels } as Record<string, unknown>,
        { ...set, ...prices, models } as Record<string, unknown>,
      );
      if (changes)
        await audit(tx, byUserId, {
          action: 'UPDATE',
          module: 'Product',
          entity: 'product',
          key: code,
          summary: `แก้ไขอะไหล่ ${name}`,
          changes,
        });
    } else {
      code = await nextRunningNo(tx, 'Product');
      const [row] = await tx
        .insert(product)
        .values({
          ...values,
          ...statusStamp(status, byUserId),
          productCode: code,
          isSerialControl: false,
          pictrueFileName: '',
          createDate: nowThai(),
          createBy: byUserId,
          cancelRemark: '',
          cancelDate: SENTINEL_TS,
          cancelBy: -1,
        })
        .returning({ id: product.productId });
      if (!row) throw new Error('product insert returned no row');
      productId = row.id;
      await audit(tx, byUserId, {
        action: 'CREATE',
        module: 'Product',
        entity: 'product',
        key: code,
        summary: `เพิ่มอะไหล่ ${name}`,
      });
    }

    const [onhand] = await tx
      .select({ id: productNoneSerial.itemId })
      .from(productNoneSerial)
      .where(eq(productNoneSerial.productId, productId));
    const priceSent = Object.values(prices).some((v) => v !== undefined);
    if (onhand) {
      // no price changed / sent (an API call with names only) → nothing to set: drizzle refuses an empty SET
      if (priceSent) await tx.update(productNoneSerial).set(prices).where(eq(productNoneSerial.itemId, onhand.id));
    } else if (!i.sysCode || priceSent) {
      await tx.insert(productNoneSerial).values({
        productId,
        storeLocationId: STORE_LOCATION_ID,
        conditionId: CONDITION_ID,
        capitalPrice: prices.capitalPrice ?? '0.00',
        wholesalePrice: prices.wholesalePrice ?? '0.00',
        retailPrice: prices.retailPrice ?? '0.00',
        remark: '',
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

    if (models) {
      await tx.delete(productModel).where(eq(productModel.productId, productId));
      if (models.length) await tx.insert(productModel).values(models.map((c) => ({ productId, modelCode: c })));
    }
    return code;
  });
  productsChanged();
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
  opts: { allowNegative?: boolean } = {},
) {
  const [row] = await tx
    .select()
    .from(productNoneSerial)
    .where(eq(productNoneSerial.productId, productId))
    .for('update');
  if (!row) throw new HttpError(400, `ไม่มีข้อมูลสต๊อกของสินค้า #${productId}`);
  const available = (row.quantityAvailable ?? 0) + (d.available ?? 0);
  const used = (row.quantityUsed ?? 0) + (d.used ?? 0);
  const booking = Math.max(0, (row.quantityBooking ?? 0) + (d.booking ?? 0));
  // apply the delta to remain (a few legacy rows drifted from available-used; keep their numbers)
  const remain = (row.quantityRemain ?? 0) + (d.available ?? 0) - (d.used ?? 0);
  if (remain < 0 && !opts.allowNegative) {
    const [p] = await tx.select({ code: product.productCode }).from(product).where(eq(product.productId, productId));
    throw new HttpError(409, `สต๊อก ${p?.code ?? `#${productId}`} ไม่พอ (คงเหลือ ${row.quantityRemain ?? 0})`);
  }
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
  return new Map(rows.map((r) => [r.code ?? '', { id: r.id, name: r.name ?? '' }]));
}

/**
 * Lock the stock rows a write is about to change, all at once in product_id order, before any
 * adjustQty (which then re-locks rows this tx already holds). Locking line by line in request
 * order let two movements touching the same parts in opposite order deadlock (→ 500).
 */
async function lockStock(tx: Tx, productIds: number[]) {
  if (!productIds.length) return;
  await tx
    .select({ id: productNoneSerial.itemId })
    .from(productNoneSerial)
    .where(inArray(productNoneSerial.productId, productIds))
    .orderBy(asc(productNoneSerial.productId), asc(productNoneSerial.itemId))
    .for('update');
}

/** The picker list (listProductsLite) shows names + on-hand: drop it after a product / stock write
 *  has COMMITTED — dropped earlier, a request in between would cache the old numbers again. */
export const productsChanged = () => invalidate('master:products:lite');

async function insertMovement(
  tx: Tx,
  h: { typeId: number; ref?: string; outTo?: string; remark?: string; date?: string },
  lines: { code: string; qty: number }[],
  byUserId: number,
): Promise<string> {
  const no = await nextRunningNo(
    tx,
    h.typeId === INV.RECEIVE || h.typeId === INV.RETURN_FROM_JOB ? 'Inventory-In' : 'Inventory-Out',
  );
  await tx.insert(inventoryHd).values({
    inventoryNo: no,
    inventoryTypeId: h.typeId,
    itemType: 'SparePart',
    // the forms' schemas keep these within the columns; the slice is for derived values (SO payTo = customer name)
    referenceDocumentNo: cleanCode(h.ref).slice(0, 50),
    referenceOutTo: clean(h.outTo).slice(0, 50),
    inventoryRemark: clean(h.remark).slice(0, 100),
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
      receiveInventoryNo: '',
    })),
  );
  return no;
}

export type StockLine = { code: string; qty: number };

/** รับเข้าอะไหล่ → WHI (type 1), available += qty. */
export async function receiveStock(
  i: { date?: string; poRef?: string | null; supplier?: string | null; remark?: string | null; lines: StockLine[] },
  byUserId: number,
): Promise<{ no: string; total: number }> {
  const lines = i.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new HttpError(400, 'ยังไม่ได้ระบุจำนวนรับเข้า');
  return db
    .transaction(async (tx) => {
      const map = await productsByCode(
        tx,
        lines.map((l) => l.code),
      );
      await lockStock(
        tx,
        [...map.values()].map((p) => p.id),
      );
      for (const l of lines) {
        const p = map.get(l.code);
        if (!p) throw new HttpError(400, `ไม่พบรหัสอะไหล่ ${l.code}`);
        await adjustQty(tx, p.id, { available: l.qty });
      }
      // receiveSchema: supplier ≤ 40 + remark ≤ 47 → fits inventory_remark varchar(100)
      const remark = [clean(i.supplier) ? `Supplier: ${clean(i.supplier)}` : '', clean(i.remark)]
        .filter(Boolean)
        .join(' · ');
      const no = await insertMovement(
        tx,
        { typeId: INV.RECEIVE, ref: i.poRef ?? '', remark, date: i.date },
        lines,
        byUserId,
      );
      const total = lines.reduce((s, l) => s + l.qty, 0);
      await audit(tx, byUserId, {
        action: 'RECEIVE',
        module: 'Product Receive Stock',
        entity: 'inventory_hd',
        key: no,
        summary: `รับเข้าอะไหล่ ${lines.length} รายการ · ${total} ชิ้น${i.poRef ? ` · PO ${cleanCode(i.poRef)}` : ''}`,
        changes: { lines: [null, lines.map((l) => `${l.code} x${l.qty}`)] },
      });
      return { no, total };
    })
    .finally(productsChanged);
}

/** จ่ายออกอื่นๆ → WHO (type 5). */
export async function issueOther(
  i: { payTo: string; remark?: string; lines: StockLine[] },
  byUserId: number,
): Promise<{ no: string; total: number }> {
  const lines = i.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new HttpError(400, 'ยังไม่ได้ระบุจำนวนจ่ายออก');
  return db
    .transaction(async (tx) => {
      const map = await productsByCode(
        tx,
        lines.map((l) => l.code),
      );
      await lockStock(
        tx,
        [...map.values()].map((p) => p.id),
      );
      for (const l of lines) {
        const p = map.get(l.code);
        if (!p) throw new HttpError(400, `ไม่พบรหัสอะไหล่ ${l.code}`);
        await adjustQty(tx, p.id, { used: l.qty });
      }
      const no = await insertMovement(tx, { typeId: INV.OUT_OTHER, outTo: i.payTo, remark: i.remark }, lines, byUserId);
      const total = lines.reduce((s, l) => s + l.qty, 0);
      await audit(tx, byUserId, {
        action: 'ISSUE',
        module: 'Product Pick Stock',
        entity: 'inventory_hd',
        key: no,
        summary: `จ่ายออกอื่นๆ ให้ ${str(i.payTo)} · ${total} ชิ้น`,
        changes: { lines: [null, lines.map((l) => `${l.code} x${l.qty}`)] },
      });
      return { no, total };
    })
    .finally(productsChanged);
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
  /** returned to stock (รับคืนจากการเบิก) — billed qty = granted - returned */
  returned: number;
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
  1: 'รอเบิก',
  2: 'ขอคืน',
  3: 'จ่ายแล้ว',
  4: 'ยกเลิก',
  5: 'คืนแล้ว',
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
      returned: jobOrderSparePartLog.returnQty,
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
          ? and(
              eq(jobOrderSparePartLog.orderStatusId, PART.REQUESTED),
              eq(jobOrderSparePartLog.isSpecial, true), // เสนอ-only lines (not ticked เบิก) are not for stock
              sql`coalesce(${jobOrderSparePartLog.requestQty},0) > coalesce(${jobOrderSparePartLog.grantQty},0)`,
            )
          : ne(jobOrderSparePartLog.orderStatusId, PART.CANCELLED),
      ),
    )
    .orderBy(asc(jobOrderSparePartLog.jobOrderLogId));
  return rows.map((r) => {
    const requested = r.requested ?? 0;
    const granted = r.granted ?? 0;
    return {
      logId: r.logId,
      jobNo: r.jobNo ?? jobNo,
      code: r.code ?? '',
      name: r.name ?? '',
      onhand: r.onhand ?? 0,
      need: Math.max(0, requested - granted),
      requested,
      granted,
      returned: r.returned ?? 0,
      statusId: r.statusId ?? 1,
      status:
        r.statusId === PART.REQUESTED && granted > 0 && granted < requested
          ? 'เบิกบางส่วน'
          : r.statusId === PART.REQUESTED && (r.onhand ?? 0) === 0
            ? 'รออะไหล่'
            : (PART_STATUS_NAME[r.statusId ?? 1] ?? ''),
      unitPrice: num(r.unitPrice),
      isQuotation: !!r.isQuotation,
      isSpecial: !!r.isSpecial,
      requestQtyB: r.requestQtyB ?? 0,
      isQuotationB: !!r.isQuotationB,
      isSpecialB: !!r.isSpecialB,
    };
  });
}

/** job.spare_part_total_cost = the job's charged part lines (cancelled ones and เสนอ-only lines excluded —
 *  only parts ticked เบิก are charged, owner 2026-10-15; same rule as partCharge in validation/job.ts) */
export async function partsTotalOf(tx: Tx, jobNo: string): Promise<number> {
  const [sum] = await tx
    .select({ s: sql<string>`coalesce(sum(${jobOrderSparePartLog.sparePartTotalPrice}),0)` })
    .from(jobOrderSparePartLog)
    .where(
      and(
        eq(jobOrderSparePartLog.jobNo, jobNo),
        ne(jobOrderSparePartLog.orderStatusId, PART.CANCELLED),
        eq(jobOrderSparePartLog.isSpecial, true),
      ),
    );
  return num(sum?.s);
}

/** job_status ids of a closed or cancelled job (jobs.ts JS — not imported: that module imports this one):
 *  0 ยกเลิกข้อมูล · 6 ยกเลิกซ่อม · 7 / 8 / 20 / 21 / 23 / 24 ปิดงาน ·
 *  22 ซ่อมเสร็จ (ไม่พบอาการเสีย ขอส่งคืน) — no fault found → no parts go out (owner 2026-10-15) */
export const JOB_CLOSED_STATUSES = [0, 6, 7, 8, 20, 21, 22, 23, 24];

/** No part goes out to a closed / cancelled job (returns from it stay allowed). In a transaction the
 *  job row is share-locked first (job → request rows → stock, the order the repair save locks in). */
export async function assertJobOpenForIssue(jobNo: string, x: Tx | typeof db = db) {
  const [j] = await x
    .select({ id: job.jobStatusId, name: jobStatus.jobStatusName })
    .from(job)
    .leftJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
    .where(eq(job.jobNo, jobNo))
    .for('share', { of: job });
  if (j?.id != null && JOB_CLOSED_STATUSES.includes(j.id))
    throw new HttpError(
      409,
      `งาน ${jobNo} อยู่ในสถานะ "${clean(j.name) || j.id}" (ปิดงาน ยกเลิก หรือไม่พบอาการเสีย) — ตัดจ่ายอะไหล่ให้งานนี้ไม่ได้`,
    );
}

/** จ่ายออกตามงานซ่อม → WHO (type 3) + grant on the request rows. */
export async function issueForJob(
  i: { jobNo: string; remark?: string; payTo?: string; lines: { logId: number; qty: number }[] },
  byUserId: number,
): Promise<{ no: string; total: number; allGranted: boolean }> {
  const lines = i.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new HttpError(400, 'ยังไม่ได้ระบุจำนวนจ่ายออก');
  return db
    .transaction(async (tx) => {
      await assertJobOpenForIssue(i.jobNo, tx);
      const reqs = await tx
        .select()
        .from(jobOrderSparePartLog)
        .where(
          and(
            eq(jobOrderSparePartLog.jobNo, i.jobNo),
            inArray(
              jobOrderSparePartLog.jobOrderLogId,
              lines.map((l) => l.logId),
            ),
          ),
        )
        .for('update');
      const byId = new Map(reqs.map((r) => [r.jobOrderLogId, r]));
      const map = await productsByCode(
        tx,
        reqs.map((r) => r.sparePartCode ?? ''),
      );
      await lockStock(
        tx,
        [...map.values()].map((p) => p.id),
      );
      const mvLines: StockLine[] = [];
      const now = nowThai();
      for (const l of lines) {
        const r = byId.get(l.logId);
        if (!r || r.orderStatusId !== PART.REQUESTED || !r.isSpecial)
          throw new HttpError(400, `รายการเบิก #${l.logId} ไม่อยู่ในสถานะรอเบิก`);
        const need = (r.requestQty ?? 0) - (r.grantQty ?? 0);
        if (l.qty > need) throw new HttpError(400, `จ่ายเกินจำนวนที่ขอ (${r.sparePartCode})`);
        const p = map.get(r.sparePartCode ?? '');
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
        mvLines.push({ code: r.sparePartCode ?? '', qty: l.qty });
      }
      const no = await insertMovement(
        tx,
        { typeId: INV.OUT_JOB, ref: i.jobNo, outTo: i.payTo, remark: i.remark },
        mvLines,
        byUserId,
      );
      await audit(tx, byUserId, {
        action: 'ISSUE',
        module: 'Job PickStock',
        entity: 'job',
        key: i.jobNo,
        summary: `ตัดจ่ายอะไหล่ ${no} · ${mvLines.reduce((s, l) => s + l.qty, 0)} ชิ้น`,
        changes: { lines: [null, mvLines.map((l) => `${l.code} x${l.qty}`)] },
      });
      const [pending] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(jobOrderSparePartLog)
        .where(
          and(
            eq(jobOrderSparePartLog.jobNo, i.jobNo),
            eq(jobOrderSparePartLog.orderStatusId, PART.REQUESTED),
            eq(jobOrderSparePartLog.isSpecial, true),
            sql`coalesce(${jobOrderSparePartLog.requestQty},0) > coalesce(${jobOrderSparePartLog.grantQty},0)`,
          ),
        );
      return { no, total: mvLines.reduce((s, l) => s + l.qty, 0), allGranted: (pending?.n ?? 0) === 0 };
    })
    .finally(productsChanged);
}

/* ---- job lists for the pick page reference dropdown ---- */
/** Open jobs (not closed / cancelled) that still have parts waiting to be issued, newest request first. */
export async function jobsWithPendingParts(limit = 300): Promise<string[]> {
  const rows = await db
    .select({ jobNo: jobOrderSparePartLog.jobNo, last: sql<string>`max(${jobOrderSparePartLog.requestDate})` })
    .from(jobOrderSparePartLog)
    .leftJoin(job, eq(job.jobNo, jobOrderSparePartLog.jobNo))
    .where(
      and(
        or(isNull(job.jobStatusId), notInArray(job.jobStatusId, JOB_CLOSED_STATUSES)),
        eq(jobOrderSparePartLog.orderStatusId, PART.REQUESTED),
        eq(jobOrderSparePartLog.isSpecial, true),
        sql`coalesce(${jobOrderSparePartLog.requestQty},0) > coalesce(${jobOrderSparePartLog.grantQty},0)`,
      ),
    )
    .groupBy(jobOrderSparePartLog.jobNo)
    .orderBy(sql`max(${jobOrderSparePartLog.requestDate}) desc`)
    .limit(limit);
  return rows.map((r) => r.jobNo ?? '').filter(Boolean);
}

/** Jobs with issued parts that can still be returned to stock (granted > returned), newest first. */
export async function jobsWithReturnableParts(limit = 300): Promise<string[]> {
  const rows = await db
    .select({ jobNo: jobOrderSparePartLog.jobNo, last: sql<string>`max(${jobOrderSparePartLog.grantDate})` })
    .from(jobOrderSparePartLog)
    .where(
      and(
        inArray(jobOrderSparePartLog.orderStatusId, [PART.GRANTED, PART.RETURN_REQUESTED]),
        sql`coalesce(${jobOrderSparePartLog.grantQty},0) > coalesce(${jobOrderSparePartLog.returnQty},0)`,
      ),
    )
    .groupBy(jobOrderSparePartLog.jobNo)
    .orderBy(sql`max(${jobOrderSparePartLog.grantDate}) desc`)
    .limit(limit);
  return rows.map((r) => r.jobNo ?? '').filter(Boolean);
}

/* ---- return from job (รับคืนจากการเบิก, inventory_type 2) ---- */
export type ReturnLine = {
  logId: number;
  jobNo: string;
  code: string;
  name: string;
  onhand: number;
  granted: number;
  returned: number;
  returnable: number;
  status: string;
};

export async function listReturnableLines(jobNo: string): Promise<ReturnLine[]> {
  const rows = await db
    .select({
      logId: jobOrderSparePartLog.jobOrderLogId,
      code: jobOrderSparePartLog.sparePartCode,
      name: product.productName,
      onhand: productNoneSerial.quantityRemain,
      granted: jobOrderSparePartLog.grantQty,
      returned: jobOrderSparePartLog.returnQty,
      statusId: jobOrderSparePartLog.orderStatusId,
    })
    .from(jobOrderSparePartLog)
    .leftJoin(product, eq(product.productCode, jobOrderSparePartLog.sparePartCode))
    .leftJoin(productNoneSerial, eq(productNoneSerial.productId, product.productId))
    .where(
      and(
        eq(jobOrderSparePartLog.jobNo, jobNo),
        inArray(jobOrderSparePartLog.orderStatusId, [PART.GRANTED, PART.RETURN_REQUESTED]),
        sql`coalesce(${jobOrderSparePartLog.grantQty},0) > coalesce(${jobOrderSparePartLog.returnQty},0)`,
      ),
    )
    .orderBy(asc(jobOrderSparePartLog.jobOrderLogId));
  return rows.map((r) => ({
    logId: r.logId,
    jobNo,
    code: r.code ?? '',
    name: r.name ?? '',
    onhand: r.onhand ?? 0,
    granted: r.granted ?? 0,
    returned: r.returned ?? 0,
    returnable: Math.max(0, (r.granted ?? 0) - (r.returned ?? 0)),
    status: PART_STATUS_NAME[r.statusId ?? 3] ?? '',
  }));
}

/**
 * รับคืนจากการเบิก → WHI (type 2), reverses the issue on the counters
 * (used -= qty → remain += qty) and records return_qty/date/by on the ใบเบิก row;
 * a fully returned line becomes status 5 (คืนแล้ว). A charged line is re-priced to what is still
 * used (granted - returned) and the job's parts / total cost follow in the same transaction.
 */
export async function returnFromJob(
  i: { jobNo: string; remark?: string; from?: string; lines: { logId: number; qty: number }[] },
  byUserId: number,
): Promise<{ no: string; total: number }> {
  const lines = i.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new HttpError(400, 'ยังไม่ได้ระบุจำนวนรับคืน');
  return db
    .transaction(async (tx) => {
      // the job row before its part rows — the order saveRepair locks them in
      const [j] = await tx.select().from(job).where(eq(job.jobNo, i.jobNo)).for('update');
      const reqs = await tx
        .select()
        .from(jobOrderSparePartLog)
        .where(
          and(
            eq(jobOrderSparePartLog.jobNo, i.jobNo),
            inArray(
              jobOrderSparePartLog.jobOrderLogId,
              lines.map((l) => l.logId),
            ),
          ),
        )
        .for('update');
      const byId = new Map(reqs.map((r) => [r.jobOrderLogId, r]));
      const map = await productsByCode(
        tx,
        reqs.map((r) => r.sparePartCode ?? ''),
      );
      await lockStock(
        tx,
        [...map.values()].map((p) => p.id),
      );
      const mvLines: StockLine[] = [];
      const now = nowThai();
      for (const l of lines) {
        const r = byId.get(l.logId);
        if (!r || (r.orderStatusId !== PART.GRANTED && r.orderStatusId !== PART.RETURN_REQUESTED))
          throw new HttpError(400, `รายการ #${l.logId} ไม่อยู่ในสถานะที่รับคืนได้`);
        const returnable = (r.grantQty ?? 0) - (r.returnQty ?? 0);
        if (l.qty > returnable) throw new HttpError(400, `รับคืนเกินจำนวนที่จ่ายไป (${r.sparePartCode})`);
        const p = map.get(r.sparePartCode ?? '');
        if (!p) throw new HttpError(400, `ไม่พบรหัสอะไหล่ ${r.sparePartCode}`);
        await adjustQty(tx, p.id, { used: -l.qty });
        const returned = (r.returnQty ?? 0) + l.qty;
        await tx
          .update(jobOrderSparePartLog)
          .set({
            returnQty: returned,
            returnDate: now,
            returnBy: byUserId,
            returnStockId: STORE_LOCATION_ID,
            orderStatusId: returned >= (r.grantQty ?? 0) ? PART.RETURNED : r.orderStatusId,
            ...(r.isQuotation
              ? { sparePartTotalPrice: money(num(r.sparePartUnitPrice) * Math.max(0, (r.grantQty ?? 0) - returned)) }
              : {}),
          })
          .where(eq(jobOrderSparePartLog.jobOrderLogId, r.jobOrderLogId));
        mvLines.push({ code: r.sparePartCode ?? '', qty: l.qty });
      }
      const no = await insertMovement(
        tx,
        { typeId: INV.RETURN_FROM_JOB, ref: i.jobNo, outTo: i.from, remark: i.remark },
        mvLines,
        byUserId,
      );
      let costs: Record<string, string> = {};
      // a closed job's money is locked (its bill is out): the return moves stock, not the job's costs
      const [st] = j
        ? await tx
            .select({ group: jobStatus.jobStatusGroup })
            .from(jobStatus)
            .where(eq(jobStatus.jobStatusId, j.jobStatusId ?? -1))
        : [];
      if (j && st?.group?.trim() !== 'Finished') {
        const parts = await partsTotalOf(tx, i.jobNo);
        const rest = num(j.serviceCost) + num(j.serviceToolCost) + num(j.deliveryCost) + num(j.cartonBoxCost);
        costs = { sparePartTotalCost: money(parts), jobTotalCost: money(parts + rest) };
        await tx.update(job).set(costs).where(eq(job.jobNo, i.jobNo));
      }
      await audit(tx, byUserId, {
        action: 'RETURN',
        module: 'Job ReturnStock',
        entity: 'job',
        key: i.jobNo,
        summary: `รับคืนอะไหล่ ${no} · ${mvLines.reduce((s, l) => s + l.qty, 0)} ชิ้น`,
        changes: { lines: [null, mvLines.map((l) => `${l.code} x${l.qty}`)], ...diff(j, costs) },
      });
      return { no, total: mvLines.reduce((s, l) => s + l.qty, 0) };
    })
    .finally(productsChanged);
}

/* ---- sale order picking ---- */
/** `pickNo`: the WHO that already issued the line ('' = still to issue) */
export type SoPickLine = {
  dtId: number;
  code: string;
  name: string;
  onhand: number;
  need: number;
  picked: boolean;
  pickNo: string;
};

/** a product line no WHO has issued yet (legacy rows carry '' as well as null) */
const soLineToPick = and(ne(saleOutDt.productType, 'Service'), sql`coalesce(${saleOutDt.pickInventoryNo}, '') = ''`);

/** จ่ายออกตามใบสั่งขาย's list: approved orders with a product line still to issue. Approving an order
 *  issues its stock (approveSaleOrder), so this is what approval left behind — usually nothing. */
export async function saleOrdersToPick(limit = 300): Promise<string[]> {
  const rows = await db
    .selectDistinct({ no: saleOutHd.saleOutHdNo })
    .from(saleOutHd)
    .innerJoin(saleOutDt, eq(saleOutDt.saleOutHdNo, saleOutHd.saleOutHdNo))
    .where(
      and(eq(saleOutHd.approveStatusId, SO_APPROVED), statusFilter(saleOutHd.recordStatus, 'exclude'), soLineToPick),
    )
    .orderBy(desc(saleOutHd.saleOutHdNo))
    .limit(limit);
  return rows.flatMap((r) => (r.no ? [r.no] : []));
}

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
    .where(and(eq(saleOutDt.saleOutHdNo, soNo), ne(saleOutDt.productType, 'Service')))
    .orderBy(asc(saleOutDt.listNo));
  return rows.map((r) => ({
    dtId: r.dtId,
    code: r.code ?? '',
    name: r.name ?? '',
    onhand: r.onhand ?? 0,
    need: r.qty,
    picked: !!r.pick,
    pickNo: r.pick ?? '',
  }));
}

/** จ่ายออกตามใบสั่งขาย → WHO (type 4); stamps pick_inventory_no / reference_no. */
export async function issueForSaleOrder(
  i: { soNo: string; remark?: string; payTo?: string; lines?: { dtId: number; qty: number }[] },
  byUserId: number,
  tx?: Tx,
): Promise<{ no: string; total: number }> {
  const run = async (t: Tx) => {
    // header first — the same lock order as saveSaleOrder / approveSaleOrder (no deadlock);
    // only an APPROVED order may take stock out (the UI filters, the API must too: a pick on a
    // waiting order, then an edit + approve, used to take the stock out twice)
    const [hd] = await t
      .select({ approve: saleOutHd.approveStatusId, status: saleOutHd.recordStatus })
      .from(saleOutHd)
      .where(eq(saleOutHd.saleOutHdNo, i.soNo))
      .for('update');
    if (!hd) throw new HttpError(404, 'ไม่พบใบสั่งขาย ' + i.soNo);
    if (hd.status === RS.DELETED) throw new HttpError(409, 'ใบสั่งขายนี้ถูกยกเลิกแล้ว จ่ายสินค้าไม่ได้');
    if (hd.approve !== SO_APPROVED) throw new HttpError(409, 'ใบสั่งขายยังไม่ได้รับอนุมัติ จ่ายสินค้าไม่ได้');
    const dts = await t
      .select()
      .from(saleOutDt)
      .where(and(eq(saleOutDt.saleOutHdNo, i.soNo), ne(saleOutDt.productType, 'Service')))
      .for('update');
    const want = i.lines ? new Map(i.lines.map((l) => [l.dtId, l.qty])) : null;
    await lockStock(
      t,
      dts.flatMap((d) => (!d.pickInventoryNo && d.productId ? [d.productId] : [])),
    );
    const mv: StockLine[] = [];
    const picked: number[] = [];
    for (const d of dts) {
      if (d.pickInventoryNo) continue;
      const qty = want ? (want.get(d.saleOutDtId) ?? 0) : d.saleOutQuantity;
      if (qty <= 0) continue;
      if (qty > d.saleOutQuantity) throw new HttpError(400, `จ่ายเกินจำนวนในใบสั่งขาย (${d.productCode})`);
      if (!d.productId) throw new HttpError(400, `รายการ ${d.productCode} ไม่มี product_id`);
      await adjustQty(t, d.productId, { used: qty });
      mv.push({ code: d.productCode ?? '', qty });
      picked.push(d.saleOutDtId);
    }
    if (!mv.length) {
      // approving the order issued it already — say so instead of a bare "nothing to issue"
      const done = [...new Set(dts.map((d) => d.pickInventoryNo).filter(Boolean))];
      if (dts.length && done.length && dts.every((d) => d.pickInventoryNo))
        throw new HttpError(
          409,
          `ใบสั่งขาย ${i.soNo} ตัดสต๊อกครบแล้ว (${done.join(', ')}) — ไม่มีรายการที่ต้องจ่ายออก`,
        );
      throw new HttpError(400, 'ไม่มีรายการที่ต้องจ่ายออก');
    }
    const no = await insertMovement(
      t,
      { typeId: INV.OUT_SALE, ref: i.soNo, outTo: i.payTo, remark: i.remark },
      mv,
      byUserId,
    );
    await audit(t, byUserId, {
      action: 'ISSUE',
      module: 'Sale Order',
      entity: 'sale_out_hd',
      key: i.soNo,
      summary: `ตัดสต๊อกตามใบสั่งขาย ${no} · ${mv.reduce((s, l) => s + l.qty, 0)} ชิ้น`,
      changes: { lines: [null, mv.map((l) => `${l.code} x${l.qty}`)] },
    });
    await t.update(saleOutDt).set({ pickInventoryNo: no }).where(inArray(saleOutDt.saleOutDtId, picked));
    await t.update(saleOutHd).set({ referenceNo: no }).where(eq(saleOutHd.saleOutHdNo, i.soNo));
    return { no, total: mv.reduce((s, l) => s + l.qty, 0) };
  };
  // with the caller's tx, the caller calls productsChanged() after its commit
  return tx ? run(tx) : db.transaction(run).finally(productsChanged);
}

/* ------------------------------------------------------------------ *
 * Movements (ประวัติการเคลื่อนไหว) — inventory_hd + summarised lines
 * ------------------------------------------------------------------ */
export async function listMovements(
  opts: { limit?: number; q?: string; from?: string; to?: string; type?: string } = {},
): Promise<Movement[]> {
  const { limit = 1000, q = '', type } = opts;
  const from = ymd(opts.from),
    to = ymd(opts.to);
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
              sql`exists (select 1 from inventory_dt d where d.inventory_no = ${inventoryHd.inventoryNo} and d.item_code ilike ${'%' + term + '%'})`,
            )
          : undefined,
        from ? gte(inventoryHd.createDate, `${from} 00:00:00`) : undefined,
        to ? lte(inventoryHd.createDate, `${to} 23:59:59`) : undefined,
        type ? eq(inventoryType.inventoryTypeName, type) : undefined,
      ),
    )
    .orderBy(desc(inventoryHd.createDate), desc(inventoryHd.inventoryHdId))
    .limit(Math.min(limit, 20000)); // 20k = the Excel export cap (src/server/export.ts)
  return rows.map((r) => {
    const isIn = r.typeId === INV.RECEIVE || r.typeId === INV.RETURN_FROM_JOB;
    const wh = r.loc ?? 'คลังสินค้าดี';
    return {
      doc: r.doc ?? '',
      type: r.type ?? '',
      ref: r.ref ?? '',
      date: fmtDateTime(r.date),
      by: fullName(r.byFirst, r.byLast),
      from: isIn ? r.outTo || r.ref || 'Supplier' : wh,
      to: isIn ? wh : r.outTo || r.ref || '',
      remark: [r.items ? r.items : '', r.remark ?? ''].filter(Boolean).join(' · '),
      qty: num(r.qty),
      items: r.items ?? '',
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
  return rows
    .map((r) => {
      const q = num(r.qty);
      const inc = (r.action ?? 1) > 0 ? q : 0;
      const out = (r.action ?? 1) < 0 ? q : 0;
      const before = bal;
      bal = bal + inc - out;
      return {
        no: r.no ?? '',
        date: fmtDateTime(r.date),
        type: r.type ?? '',
        before,
        income: inc,
        outcome: out,
        after: bal,
        ref: r.ref ?? '',
        remark: r.remark ?? '',
      };
    })
    .reverse();
}

export { adjustQty, insertMovement, lockStock, productsByCode };

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
    code: r.code ?? '',
    name: r.name ?? '',
    qty: num(r.qty),
    unit: r.unit ?? ITEM_UNIT,
    supplier: (r.supplier ?? '').match(/Supplier:\s*([^·]+)/)?.[1]?.trim() ?? '',
    ref: r.ref ?? '',
  }));
}

/** รายงานการเบิกจ่ายอะไหล่ — every issued line (WHO types 3/4/5, returns 2 as negative qty) in a date range; the Excel export.
 *  Same filter (issuedWhere) and rows as the screen (pageIssuedLines), only not paged. */
export async function listIssuedLines(opts: IssuedFilters & { limit?: number } = {}) {
  const rows = await issuedBase()
    .where(issuedWhere('', opts))
    .orderBy(desc(inventoryHd.createDate), asc(inventoryDt.inventoryDtId))
    .limit(Math.min(opts.limit ?? 5000, 20000));
  return rows.map(toIssued);
}

/* ------------------------------------------------------------------ *
 * Paged products (รายการอะไหล่ / รายงานคงเหลือ) + lite list for dropdowns
 * ------------------------------------------------------------------ */
import { count as countFn } from 'drizzle-orm';
import { orderBy as orderByCols, offsetOf, totalOf, ymd, type Page, type PageQuery } from '@/server/paging';
import { assertValid } from '@/server/validate';
import { cleanMfgCode, productSchema } from '@/lib/validation/admin';
import { clean, cleanCode, summary } from '@/lib/validation';

/** other products that already carry this vendor code — a warning on save, not a block (legacy has pairs) */
export async function productsWithMfgCode(mfgCode: string, exceptSysCode: string): Promise<string[]> {
  const code = cleanMfgCode(mfgCode);
  if (!code) return [];
  const rows = await db
    .select({ c: product.productCode })
    .from(product)
    .where(and(sql`upper(btrim(${product.productVenderCode})) = ${code}`, ne(product.productCode, exceptSysCode)))
    .limit(5);
  return rows.map((r) => r.c ?? '');
}

export type ProductFilters = {
  mode?: DeletedMode;
  status?: string; // Active | Inactive (UI)
  sysCode?: string;
  mfgCode?: string;
  name?: string;
  brand?: string;
  category?: string;
  creator?: string;
  date?: string; // create_date = YYYY-MM-DD
  stock?: 'in' | 'low' | 'out'; // มีสินค้า / ใกล้หมด / หมด
  model?: string; // model_code — parts usable with that model (product_model)
};

const creatorUser = alias(appUser, 'product_creator');

function productWhere(q: string, f: ProductFilters) {
  const term = q.trim();
  const rs =
    f.status === 'Inactive'
      ? eq(product.recordStatus, 'INACTIVE')
      : f.status === 'Active'
        ? eq(product.recordStatus, 'ACTIVE')
        : statusFilter(product.recordStatus, f.mode ?? 'exclude');
  return and(
    rs,
    term ? productSearch(term) : undefined,
    f.sysCode ? ilike(product.productCode, `%${f.sysCode}%`) : undefined,
    f.mfgCode ? ilike(product.productVenderCode, `%${f.mfgCode}%`) : undefined,
    f.name ? nameLike(f.name) : undefined,
    f.brand ? eq(manufacturer.manufacturerName, f.brand) : undefined,
    f.category ? eq(category.categoryName, f.category) : undefined,
    f.creator?.trim()
      ? /^\d+$/.test(f.creator.trim())
        ? eq(product.createBy, Number(f.creator.trim()))
        : // the same name fullName() builds: each part trimmed, empty parts dropped
          sql`concat_ws(' ', nullif(trim(${creatorUser.firstName}),''), nullif(trim(${creatorUser.lastName}),'')) ilike ${'%' + f.creator.trim() + '%'}`
      : undefined,
    ymd(f.date) ? sql`${product.createDate}::date = ${f.date}::date` : undefined,
    f.model
      ? sql`exists (select 1 from product_model pm where pm.product_id = ${product.productId} and pm.model_code = ${f.model})`
      : undefined,
    f.stock === 'in' ? sql`coalesce(${productNoneSerial.quantityRemain},0) > 3` : undefined,
    f.stock === 'low' ? sql`coalesce(${productNoneSerial.quantityRemain},0) between 1 and 3` : undefined,
    f.stock === 'out' ? sql`coalesce(${productNoneSerial.quantityRemain},0) <= 0` : undefined,
  );
}

const productPagedQuery = () =>
  db
    .select({ ...productSelect, creatorFirst: creatorUser.firstName, creatorLast: creatorUser.lastName })
    .from(product)
    .leftJoin(category, eq(category.categoryId, product.categoryId))
    .leftJoin(manufacturer, eq(manufacturer.manufacturerId, product.manufacturerId))
    .leftJoin(productNoneSerial, eq(productNoneSerial.productId, product.productId))
    .leftJoin(creatorUser, eq(creatorUser.userId, product.createBy));

const PRODUCT_SORT = {
  sysCode: product.productCode,
  mfgCode: product.productVenderCode,
  name: product.productName,
  category: category.categoryName,
  brand: manufacturer.manufacturerName,
  onhand: productNoneSerial.quantityRemain,
  price: productNoneSerial.retailPrice,
  status: product.recordStatus,
  value: sql`coalesce(${productNoneSerial.quantityRemain},0) * coalesce(${productNoneSerial.retailPrice},0)`,
};

/** `cost`: keep ราคาทุน (the export, for a user who may see it — canSeeCost); the list screens never show it */
export async function pageProducts(
  p: PageQuery,
  f: ProductFilters,
  cost = false,
): Promise<Page<Product & { value: number }>> {
  const w = productWhere(p.q, f);
  // count + page in parallel: the response takes max(count, rows) instead of their sum
  const [counted, rows] = await Promise.all([
    db
      .select({ total: countFn() })
      .from(product)
      .leftJoin(category, eq(category.categoryId, product.categoryId))
      .leftJoin(manufacturer, eq(manufacturer.manufacturerId, product.manufacturerId))
      .leftJoin(productNoneSerial, eq(productNoneSerial.productId, product.productId))
      .leftJoin(creatorUser, eq(creatorUser.userId, product.createBy))
      .where(w),
    productPagedQuery()
      .where(w)
      .orderBy(...orderByCols(p.sort, PRODUCT_SORT, [asc(product.productCode)]))
      .limit(p.pageSize)
      .offset(offsetOf(p)),
  ]);
  return {
    rows: rows.map((r) => {
      const pr = toProduct(r, fullName(r.creatorFirst, r.creatorLast));
      return { ...(cost ? pr : withoutCost(pr)), value: Math.max(0, pr.onhand) * pr.price };
    }),
    total: totalOf(counted),
    page: p.page,
    pageSize: p.pageSize,
  };
}

/** KPI tiles of the product list / on-hand report for the same filter set. */
export async function productStats(q: string, f: ProductFilters) {
  const [r] = await db
    .select({
      total: countFn(),
      qty: sql<string>`coalesce(sum(greatest(coalesce(${productNoneSerial.quantityRemain},0),0)),0)`,
      value: sql<string>`coalesce(sum(greatest(coalesce(${productNoneSerial.quantityRemain},0),0) * coalesce(${productNoneSerial.retailPrice},0)),0)`,
      low: sql<string>`count(*) filter (where coalesce(${productNoneSerial.quantityRemain},0) between 1 and 3)`,
      out: sql<string>`count(*) filter (where coalesce(${productNoneSerial.quantityRemain},0) <= 0)`,
    })
    .from(product)
    .leftJoin(category, eq(category.categoryId, product.categoryId))
    .leftJoin(manufacturer, eq(manufacturer.manufacturerId, product.manufacturerId))
    .leftJoin(productNoneSerial, eq(productNoneSerial.productId, product.productId))
    .leftJoin(creatorUser, eq(creatorUser.userId, product.createBy))
    .where(productWhere(q, f));
  if (!r) throw new Error('aggregate returned no row'); // no GROUP BY → always exactly one row
  return { total: Number(r.total), qty: num(r.qty), value: num(r.value), low: num(r.low), out: num(r.out) };
}

/** Lite rows for dropdowns / pickers — a few fields instead of ~25 (the EN / CN names: the pickers search them). */
export type ProductLite = Pick<
  Product,
  'sysCode' | 'mfgCode' | 'name' | 'nameEn' | 'nameCn' | 'onhand' | 'price' | 'status' | 'category' | 'brand'
>;
export function listProductsLite(q = ''): Promise<ProductLite[]> {
  // every form with a part picker loads the whole catalog — memo it; productsChanged() drops it
  const term = q.trim();
  return cached(`master:products:lite:${term}`, TTL_MASTER, () => loadProductsLite(term));
}
async function loadProductsLite(term: string): Promise<ProductLite[]> {
  const rows = await db
    .select({
      sysCode: product.productCode,
      mfgCode: product.productVenderCode,
      name: product.productName,
      nameEn: product.productNameEn,
      nameCn: product.productNameCn,
      onhand: productNoneSerial.quantityRemain,
      price: productNoneSerial.retailPrice,
      category: category.categoryName,
      brand: manufacturer.manufacturerName,
    })
    .from(product)
    .leftJoin(productNoneSerial, eq(productNoneSerial.productId, product.productId))
    .leftJoin(category, eq(category.categoryId, product.categoryId))
    .leftJoin(manufacturer, eq(manufacturer.manufacturerId, product.manufacturerId))
    .where(and(eq(product.recordStatus, 'ACTIVE'), term ? productSearch(term) : undefined))
    .orderBy(asc(product.productCode));
  return rows.map((r) => ({
    sysCode: r.sysCode ?? '',
    mfgCode: r.mfgCode ?? '',
    name: r.name ?? '',
    nameEn: r.nameEn ?? '',
    nameCn: r.nameCn ?? '',
    onhand: r.onhand ?? 0,
    price: num(r.price),
    status: 'Active',
    category: r.category ?? '',
    brand: r.brand ?? '',
  }));
}

/* ------------------------------------------------------------------ *
 * Paged movements (ประวัติสต๊อก) and issued lines (รายงานเบิกจ่าย)
 * ------------------------------------------------------------------ */
export type MovementFilters = {
  q?: string;
  from?: string;
  to?: string;
  type?: string;
  code?: string;
  doc?: string;
  ref?: string;
};

function movementWhere(f: MovementFilters) {
  const term = (f.q ?? '').trim();
  const from = ymd(f.from),
    to = ymd(f.to);
  return and(
    ne(inventoryHd.isActive, false),
    term
      ? or(
          ilike(inventoryHd.inventoryNo, `%${term}%`),
          ilike(inventoryHd.referenceDocumentNo, `%${term}%`),
          sql`exists (select 1 from inventory_dt d where d.inventory_no = ${inventoryHd.inventoryNo} and d.item_code ilike ${'%' + term + '%'})`,
        )
      : undefined,
    f.doc ? ilike(inventoryHd.inventoryNo, `%${f.doc}%`) : undefined,
    f.ref ? ilike(inventoryHd.referenceDocumentNo, `%${f.ref}%`) : undefined,
    // รหัสอะไหล่ filter: the code, or a part whose Thai / English / Chinese name has the words
    f.code
      ? sql`exists (select 1 from inventory_dt d where d.inventory_no = ${inventoryHd.inventoryNo} and (d.item_code ilike ${'%' + f.code.trim() + '%'}
          or d.item_code in (select ${product.productCode} from ${product} where ${nameLike(f.code.trim())})))`
      : undefined,
    from ? gte(inventoryHd.createDate, `${from} 00:00:00`) : undefined,
    to ? lte(inventoryHd.createDate, `${to} 23:59:59`) : undefined,
    f.type ? eq(inventoryType.inventoryTypeName, f.type) : undefined,
  );
}

const MOVE_SORT = {
  doc: inventoryHd.inventoryNo,
  type: inventoryType.inventoryTypeName,
  ref: inventoryHd.referenceDocumentNo,
  date: inventoryHd.createDate,
  by: appUser.firstName,
};

export async function pageMovements(p: PageQuery, f: MovementFilters): Promise<Page<Movement>> {
  const w = movementWhere({ ...f, q: p.q || f.q });
  // count + page in parallel: the response takes max(count, rows) instead of their sum
  const [counted, rows] = await Promise.all([
    db
      .select({ total: countFn() })
      .from(inventoryHd)
      .leftJoin(inventoryType, eq(inventoryType.inventoryTypeId, inventoryHd.inventoryTypeId))
      .where(w),
    db
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
      })
      .from(inventoryHd)
      .leftJoin(inventoryType, eq(inventoryType.inventoryTypeId, inventoryHd.inventoryTypeId))
      .leftJoin(appUser, eq(appUser.userId, inventoryHd.createBy))
      .where(w)
      .orderBy(...orderByCols(p.sort, MOVE_SORT, [desc(inventoryHd.createDate), desc(inventoryHd.inventoryHdId)]))
      .limit(p.pageSize)
      .offset(offsetOf(p)),
  ]);
  const wh = 'คลังสินค้าดี';
  return {
    rows: rows.map((r) => {
      const isIn = r.typeId === INV.RECEIVE || r.typeId === INV.RETURN_FROM_JOB;
      return {
        doc: r.doc ?? '',
        type: r.type ?? '',
        ref: r.ref ?? '',
        date: fmtDateTime(r.date),
        by: fullName(r.byFirst, r.byLast),
        from: isIn ? r.outTo || r.ref || 'Supplier' : wh,
        to: isIn ? wh : r.outTo || r.ref || '',
        remark: [r.items ? r.items : '', r.remark ?? ''].filter(Boolean).join(' · '),
        qty: num(r.qty),
        items: r.items ?? '',
      };
    }),
    total: totalOf(counted),
    page: p.page,
    pageSize: p.pageSize,
  };
}

export type IssuedFilters = { from?: string; to?: string; category?: string; code?: string };

/** a line's qty in the report: issued (3/4/5) counts up, รับคืนจากการเบิก (2) counts back down */
const issuedQty = sql<string>`(case when ${inventoryHd.inventoryTypeId} = ${sql.raw(String(INV.RETURN_FROM_JOB))} then -${inventoryDt.itemQuantity} else ${inventoryDt.itemQuantity} end)`;
/**
 * The unit price stored when the part went out: the job's part line (job_order_spare_part_log, issue and
 * return reference the job no.) or the sale-order line (sale_out_dt.retail_price). inventory_dt itself has
 * no price. 0 = not stored (warranty lines are often 0) → null, and the report falls back to today's price.
 */
const storedPrice = sql<string | null>`coalesce(
  (select l.spare_part_unit_price from job_order_spare_part_log l
    where l.job_no = ${inventoryHd.referenceDocumentNo} and l.spare_part_code = ${inventoryDt.itemCode} and l.spare_part_unit_price > 0
    order by l.job_order_log_id desc limit 1),
  (select s.retail_price from sale_out_dt s
    where s.sale_out_hd_no = ${inventoryHd.referenceDocumentNo} and s.product_code = ${inventoryDt.itemCode} and s.retail_price > 0
    order by s.sale_out_dt_id desc limit 1))`;
const issuedValue = sql`${issuedQty} * coalesce(${storedPrice}, ${productNoneSerial.retailPrice}, 0)`;

function issuedWhere(q: string, f: IssuedFilters) {
  const code = (f.code || q).trim();
  const from = ymd(f.from),
    to = ymd(f.to);
  return and(
    inArray(inventoryHd.inventoryTypeId, [INV.OUT_JOB, INV.OUT_SALE, INV.OUT_OTHER, INV.RETURN_FROM_JOB]),
    ne(inventoryHd.isActive, false),
    from ? gte(inventoryHd.createDate, `${from} 00:00:00`) : undefined,
    to ? lte(inventoryHd.createDate, `${to} 23:59:59`) : undefined,
    f.category ? eq(category.categoryName, f.category) : undefined,
    code
      ? or(
          ilike(inventoryDt.itemCode, `%${code}%`),
          ilike(product.productName, `%${code}%`),
          ilike(inventoryHd.inventoryNo, `%${code}%`),
        )
      : undefined,
  );
}

const issuedBase = () =>
  db
    .select({
      doc: inventoryHd.inventoryNo,
      date: inventoryHd.createDate,
      type: inventoryType.inventoryTypeName,
      ref: inventoryHd.referenceDocumentNo,
      code: inventoryDt.itemCode,
      item: product.productName,
      category: category.categoryName,
      qty: issuedQty,
      stored: storedPrice,
      today: productNoneSerial.retailPrice,
      byFirst: appUser.firstName,
      byLast: appUser.lastName,
    })
    .from(inventoryDt)
    .innerJoin(inventoryHd, eq(inventoryHd.inventoryNo, inventoryDt.inventoryNo))
    .leftJoin(inventoryType, eq(inventoryType.inventoryTypeId, inventoryHd.inventoryTypeId))
    .leftJoin(product, eq(product.productCode, inventoryDt.itemCode))
    .leftJoin(category, eq(category.categoryId, product.categoryId))
    .leftJoin(productNoneSerial, eq(productNoneSerial.productId, product.productId))
    .leftJoin(appUser, eq(appUser.userId, inventoryHd.createBy));

function toIssued(r: Awaited<ReturnType<typeof issuedBase>>[number]) {
  const qty = num(r.qty);
  const price = r.stored != null ? num(r.stored) : num(r.today);
  return {
    doc: r.doc ?? '',
    date: fmtDateTime(r.date),
    type: r.type ?? '',
    ref: r.ref ?? '',
    by: fullName(r.byFirst, r.byLast),
    from: 'คลังสินค้าดี',
    to: r.ref ?? '',
    remark: '',
    code: r.code ?? '',
    item: r.item ?? '',
    category: r.category ?? '',
    qty,
    price,
    /** where `price` came from: stored on the job / sale-order line, or today's price (none stored) */
    priceBasis: r.stored != null ? 'ราคา ณ วันเบิก' : 'ราคาปัจจุบัน',
    value: qty * price,
  };
}

const issuedCountBase = () =>
  db
    .select({ total: countFn() })
    .from(inventoryDt)
    .innerJoin(inventoryHd, eq(inventoryHd.inventoryNo, inventoryDt.inventoryNo))
    .leftJoin(product, eq(product.productCode, inventoryDt.itemCode))
    .leftJoin(category, eq(category.categoryId, product.categoryId));

const ISSUED_SORT = {
  doc: inventoryHd.inventoryNo,
  date: inventoryHd.createDate,
  type: inventoryType.inventoryTypeName,
  code: inventoryDt.itemCode,
  item: product.productName,
  qty: issuedQty,
  value: issuedValue,
  by: appUser.firstName,
};

export async function pageIssuedLines(p: PageQuery, f: IssuedFilters) {
  const w = issuedWhere(p.q, f);
  // count + page in parallel: the response takes max(count, rows) instead of their sum
  const [counted, rows] = await Promise.all([
    issuedCountBase().where(w),
    issuedBase()
      .where(w)
      .orderBy(...orderByCols(p.sort, ISSUED_SORT, [desc(inventoryHd.createDate), asc(inventoryDt.inventoryDtId)]))
      .limit(p.pageSize)
      .offset(offsetOf(p)),
  ]);
  return {
    rows: rows.map(toIssued),
    total: totalOf(counted),
    page: p.page,
    pageSize: p.pageSize,
  };
}

export async function issuedStats(q: string, f: IssuedFilters) {
  const w = issuedWhere(q, f);
  const [r] = await db
    .select({
      lines: countFn(),
      qty: sql<string>`coalesce(sum(${issuedQty}),0)`,
      value: sql<string>`coalesce(sum(${issuedValue}),0)`,
      todayPriced: sql<string>`count(*) filter (where ${storedPrice} is null)`,
    })
    .from(inventoryDt)
    .innerJoin(inventoryHd, eq(inventoryHd.inventoryNo, inventoryDt.inventoryNo))
    .leftJoin(product, eq(product.productCode, inventoryDt.itemCode))
    .leftJoin(category, eq(category.categoryId, product.categoryId))
    .leftJoin(productNoneSerial, eq(productNoneSerial.productId, product.productId))
    .where(w);
  if (!r) throw new Error('aggregate returned no row'); // no GROUP BY → always exactly one row
  const [top] = await db
    .select({ code: inventoryDt.itemCode, n: sql<string>`sum(${issuedQty})` })
    .from(inventoryDt)
    .innerJoin(inventoryHd, eq(inventoryHd.inventoryNo, inventoryDt.inventoryNo))
    .leftJoin(product, eq(product.productCode, inventoryDt.itemCode))
    .leftJoin(category, eq(category.categoryId, product.categoryId))
    .where(w)
    .groupBy(inventoryDt.itemCode)
    .orderBy(desc(sql`sum(${issuedQty})`), asc(inventoryDt.itemCode)) // a tie → the lowest code, every time
    .limit(1);
  return {
    lines: Number(r.lines),
    qty: num(r.qty),
    value: num(r.value),
    todayPriced: num(r.todayPriced),
    top: top?.code ?? '—',
  };
}
