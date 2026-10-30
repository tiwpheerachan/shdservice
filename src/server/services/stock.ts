import 'server-only';
import { createHash } from 'node:crypto';
import {
  and,
  asc,
  count as countFn,
  desc,
  eq,
  getTableColumns,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, type Tx, writeTx } from '@/db/client';
import { AS, CONDITION_ID, INV, ITEM_UNIT, JS, PART, STORE_LOCATION_ID, STORE_LOCATION_NAME } from '@/lib/status-ids';
import {
  appUser,
  category,
  stockMoveLine,
  stockMove,
  stockMoveType,
  job,
  jobPart,
  jobStatus,
  brand,
  model,
  product,
  productCompatibleModel,
  productStock,
  saleOrderLine,
  saleOrder,
  storeLocation,
} from '@/db/schema';
import type { Movement, Product } from '@/data/types';
import { HttpError, fullName, hasRight, type CurrentUser } from '@/server/auth';
import { assertVersion } from '@/server/http-error';
import { fmtDateTime, money, nowThai, num, str, type FieldData } from '@/server/mappers/format';
import { MAX_EXPORT_ROWS } from '@/lib/export-limit';
import { nextRunningNo } from '@/db/running-no';
import { audit, diff, isUuid, type AuditEntry } from '@/server/audit';
import { isLegacyRow } from '@/server/legacy-lock';
import { RS, statusFilter, uiStatus, fromUiStatus, statusStamp, type StatusMode } from '@/server/record-status';
import { cached, invalidate, TTL_MASTER } from '@/server/cache';
import { orderBy as orderByCols, likeTerm, offsetOf, totalOf, ymd, type Page, type PageQuery } from '@/server/paging';
import { assertValid } from '@/server/validate';
import type { z } from 'zod';
import type { productSave } from '@/server/contract/stock';
import { cleanMfgCode, productSchema } from '@/lib/validation/admin';
import { clean, cleanCode, summary } from '@/lib/validation';

export type DeletedMode = StatusMode;

/** The legacy system runs a single warehouse / condition and no serial control. */
export { CONDITION_ID, INV, ITEM_UNIT, PART, STORE_LOCATION_ID };
/** category 1 = ยังไม่ระบุ: a product saved without a category (product.category_id is NOT NULL in the legacy app) */
const UNSPECIFIED_CATEGORY_ID = 1;
/** ใกล้หมด = 1..LOW_STOCK on hand (the products filter and the stock KPI) */
const LOW_STOCK = 3;

/* ------------------------------------------------------------------ *
 * Products
 * ------------------------------------------------------------------ */
const productSelect = {
  id: product.id,
  productId: product.pk,
  sysCode: product.productCode,
  mfgCode: product.productVendorCode,
  name: product.productName,
  nameEn: product.productNameEn,
  nameCn: product.productNameCn,
  description: product.productDescription,
  categoryId: product.categoryPk,
  category: category.categoryName,
  brandId: product.brandPk,
  brand: brand.brandName,
  active: product.recordStatus,
  createDate: product.createDate,
  createBy: product.createdByAppUserPk,
  ubOnly: product.isUbRepairOnly,
  forModelColor: product.forModelColor,
  picture: product.pictureFileName,
  onhand: productStock.quantityRemain,
  available: productStock.quantityAvailable,
  used: productStock.quantityUsed,
  booking: productStock.quantityBooking,
  capital: productStock.capitalPrice,
  wholesale: productStock.wholesalePrice,
  retail: productStock.retailPrice,
  onhandItemId: productStock.pk,
  stockRemark: productStock.remark,
  cancelRemark: product.cancelRemark,
  // ยกเลิก (not Active): when / who = the status change (new rows write only status_changed_*); legacy rows
  // without one keep their cancel_date / cancelled_by (ADR 0008 "no redundant data")
  cancelDate: sql<
    string | null
  >`case when ${product.recordStatus} <> 'ACTIVE' and ${product.statusChangedAt} is not null then ${product.statusChangedAt} else ${product.cancelDate} end`,
  cancelBy: sql<
    number | null
  >`case when ${product.recordStatus} <> 'ACTIVE' and ${product.statusChangedAt} is not null then ${product.statusChangedByAppUserPk} else ${product.cancelledByAppUserPk} end`.mapWith(
    Number,
  ),
};

type ProductRow = {
  [K in keyof typeof productSelect]: FieldData<(typeof productSelect)[K]> | null;
};

function toProduct(r: ProductRow, creator?: string, canceller?: string): Product {
  return {
    stockRemark: r.stockRemark ?? '',
    cancelRemark: r.cancelRemark ?? '',
    cancelDate: fmtDateTime(r.cancelDate), // '' for the 1900-01-01 sentinel (isSentinelDate)
    cancelBy: canceller ?? '',
    sysCode: r.sysCode ?? '',
    mfgCode: r.mfgCode ?? '',
    name: r.name ?? '',
    category: r.category ?? '',
    brand: r.brand ?? '',
    onhand: r.onhand ?? 0,
    price: num(r.retail),
    status: uiStatus(r.active),
    id: r.id ?? undefined,
    nameEn: r.nameEn ?? '',
    nameCn: r.nameCn ?? '',
    description: r.description ?? '',
    capitalPrice: num(r.capital),
    wholesalePrice: num(r.wholesale),
    received: r.available ?? 0,
    issued: r.used ?? 0,
    reserved: r.booking ?? 0,
    ubRepairOnly: !!r.ubOnly,
    serialControl: false, // product.is_serial_control was false on every row — dropped in drizzle/0006
    forModelColor: r.forModelColor ?? '',
    createdDate: fmtDateTime(r.createDate),
    createdBy: creator ?? '',
    // the legacy placeholder name (no file behind it) = no picture
    image:
      r.picture && !/^no-image\.gif$/i.test(r.picture.trim())
        ? r.picture.includes('/')
          ? r.picture
          : `products/${r.sysCode}/${r.picture}`
        : '',
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
    .leftJoin(category, eq(category.pk, product.categoryPk))
    .leftJoin(brand, eq(brand.pk, product.brandPk))
    .leftJoin(productStock, eq(productStock.productPk, product.pk));

/** a name search looks in the Thai, English and Chinese names */
const nameLike = (t: string) =>
  or(
    ilike(product.productName, likeTerm(t)),
    ilike(product.productNameEn, likeTerm(t)),
    ilike(product.productNameCn, likeTerm(t)),
  );
/** free-text search of every product list / picker: system code, vendor part no, any of the names, brand or
 *  category (the picker types "Dreame" or "มอเตอร์") — every caller joins category + brand */
const productSearch = (t: string) =>
  or(
    ilike(product.productCode, likeTerm(t)),
    ilike(product.productVendorCode, likeTerm(t)),
    nameLike(t),
    ilike(brand.brandName, likeTerm(t)),
    ilike(category.categoryName, likeTerm(t)),
  );

export async function listProducts(opts: { deleted?: DeletedMode; q?: string } = {}): Promise<Product[]> {
  const { deleted = 'exclude', q = '' } = opts;
  const active = statusFilter(product.recordStatus, deleted);
  const term = q.trim();
  const search = term ? productSearch(term) : undefined;
  const rows = await productQuery().where(and(active, search)).orderBy(asc(product.productCode));
  return rows.map((r) => withoutCost(toProduct(r))); // list screens never show the cost
}

const modelsOf = async (x: Tx | typeof db, productPk: number) =>
  (
    await x
      .select({ code: model.modelCode })
      .from(productCompatibleModel)
      .innerJoin(model, eq(model.pk, productCompatibleModel.modelPk))
      .where(eq(productCompatibleModel.productPk, productPk))
  )
    .map((m) => m.code ?? '')
    .filter(Boolean);

/**
 * Optimistic lock of the product form (assertVersion). product has no row_version column (drizzle/0026)
 * and the prices live in product_stock, whose counters every stock movement moves — so the version
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
    r.brandId,
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
  const nameOf = (userPk: number | null) =>
    userPk != null
      ? db.select({ f: appUser.firstName, l: appUser.lastName }).from(appUser).where(eq(appUser.pk, userPk))
      : [];
  const [[creator], [canceller], models] = await Promise.all([
    nameOf(r.createBy),
    nameOf(r.cancelBy),
    modelsOf(db, r.productId!),
  ]);
  return {
    ...toProduct(r, creator ? fullName(creator.f, creator.l) : '', canceller ? fullName(canceller.f, canceller.l) : ''),
    models,
    version: productVersion(r, models),
  };
}

/** the parsed body of POST /api/products (productSave in src/server/contract/stock.ts) */
export type ProductInput = z.output<typeof productSave.body>;

export async function saveProduct(i: ProductInput, byUserId: number): Promise<Product> {
  // an unchanged legacy vendor code still saves ("never worse"); a new / changed one must be clean
  const [cur] = i.sysCode
    ? await db
        .select({ mfgCode: product.productVendorCode })
        .from(product)
        .where(eq(product.productCode, i.sysCode))
        .limit(1)
    : [];
  assertValid(productSchema(cur), i);
  const name = clean(i.name);
  const [cat] = str(i.category)
    ? await db
        .select({ id: category.pk })
        .from(category)
        .where(sql`btrim(${category.categoryName}, E' \t\r\n') = ${str(i.category)}`)
        .limit(1)
    : [];
  const [mfg] = str(i.brand)
    ? await db
        .select({ id: brand.pk })
        .from(brand)
        .where(sql`btrim(${brand.brandName}, E' \t\r\n') = ${str(i.brand)}`) // legacy names carry trailing spaces
        .limit(1)
    : [];
  const modelCodes = Array.from(new Set((i.models ?? []).map((m) => str(m)).filter(Boolean)));
  // model_code → model.pk (product_model links by pk)
  const known = new Map(
    modelCodes.length
      ? (
          await db.select({ c: model.modelCode, pk: model.pk }).from(model).where(inArray(model.modelCode, modelCodes))
        ).map((r) => [r.c ?? '', r.pk])
      : [],
  );
  // a name that is not in the list is refused, never saved silently as "no brand" / category #1
  const fields: Record<string, string> = {};
  if (str(i.category) && !cat) fields.category = `ไม่พบหมวดหมู่ "${str(i.category)}" ในรายการ`;
  if (str(i.brand) && !mfg) fields.brand = `ไม่พบยี่ห้อ "${str(i.brand)}" ในรายการ`;
  const unknownModels = modelCodes.filter((c) => !known.has(c));
  if (unknownModels.length) fields.models = `ไม่พบรุ่นสินค้า ${unknownModels.join(', ')}`;
  if (Object.keys(fields).length) throw new HttpError(400, summary(fields), { fields });

  const code = await writeTx(async (tx) => {
    const status = fromUiStatus(i.status);
    const values = {
      productVendorCode: cleanMfgCode(i.mfgCode),
      productName: name,
      productNameEn: clean(i.nameEn),
      productNameCn: clean(i.nameCn),
      productDescription: clean(i.description),
      categoryPk: cat?.id ?? UNSPECIFIED_CATEGORY_ID,
      brandPk: mfg?.id ?? null,
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
      // restored through the records page (Product del) — the form's status would revive it with edit only
      if (before.recordStatus === RS.DELETED) throw new HttpError(409, 'อะไหล่นี้ถูกลบแล้ว แก้ไขไม่ได้');
      productId = before.pk;
      const [loaded] = await productQuery(tx).where(eq(product.pk, productId));
      const oldModels = await modelsOf(tx, productId);
      assertVersion(i.version, productVersion(loaded!, oldModels));
      // "never worse": only what really changes is written — a value equal to the stored one once both are
      // cleaned keeps the stored one (a legacy trailing space); saved unchanged = no write, no audit row
      const same: Record<string, boolean> = {
        productVendorCode: values.productVendorCode === cleanMfgCode(before.productVendorCode),
        productName: values.productName === clean(before.productName),
        productNameEn: values.productNameEn === clean(before.productNameEn),
        productNameCn: values.productNameCn === clean(before.productNameCn),
        productDescription: values.productDescription === clean(before.productDescription),
        categoryPk: clean(i.category) === clean(loaded!.category), // the form sends the names it showed
        brandPk: clean(i.brand) === clean(loaded!.brand),
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
      if (Object.keys(set).length) await tx.update(product).set(set).where(eq(product.pk, productId));
      // category / brand by name: their pk never leaves the server (the audit page shows `changes`)
      const changes = diff(
        { ...before, ...was, models: oldModels, category: loaded!.category, brand: loaded!.brand } as Record<
          string,
          unknown
        >,
        {
          ...set,
          ...prices,
          models,
          category: 'categoryPk' in set ? clean(i.category) : undefined,
          brand: 'brandPk' in set ? clean(i.brand) : undefined,
        } as Record<string, unknown>,
        { skip: ['categoryPk', 'brandPk'] },
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
          pictureFileName: '',
          createDate: nowThai(),
          createdByAppUserPk: byUserId,
          // cancel_remark / cancel_date / cancelled_by: legacy only — a status change is status_changed_* (NULL here)
        })
        .returning({ id: product.pk });
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
      .select({ id: productStock.pk })
      .from(productStock)
      .where(eq(productStock.productPk, productId));
    const priceSent = Object.values(prices).some((v) => v !== undefined);
    if (onhand) {
      // no price changed / sent (an API call with names only) → nothing to set: drizzle refuses an empty SET
      if (priceSent) await tx.update(productStock).set(prices).where(eq(productStock.pk, onhand.id));
    } else {
      // missing row (legacy product) → create it on any save, or every receive / issue refuses it (adjustQty 400)
      await tx.insert(productStock).values({
        productPk: productId,
        capitalPrice: prices.capitalPrice ?? '0.00',
        wholesalePrice: prices.wholesalePrice ?? '0.00',
        retailPrice: prices.retailPrice ?? '0.00',
        remark: '',
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
      await tx.delete(productCompatibleModel).where(eq(productCompatibleModel.productPk, productId));
      if (models.length)
        await tx
          .insert(productCompatibleModel)
          .values(models.map((c) => ({ productPk: productId, modelPk: known.get(c) ?? null })));
    }
    return code;
  });
  productsChanged();
  return (await getProduct(code))!;
}

/* ------------------------------------------------------------------ *
 * Quantities — the one place that touches product_stock counters.
 *   available = cumulative received (returns from a job included, as legacy), used = cumulative issued,
 *   booking   = requested-not-yet-granted, remain = available - used
 * ------------------------------------------------------------------ */
type QtyDelta = { available?: number; used?: number; booking?: number };
type StockRow = typeof productStock.$inferSelect;

const codeOf = async (tx: Tx, productId: number) =>
  (await tx.select({ code: product.productCode }).from(product).where(eq(product.pk, productId)))[0]?.code ??
  `#${productId}`;
const noStockRow = async (tx: Tx, productId: number) =>
  new HttpError(400, `ไม่มีข้อมูลสต๊อกของอะไหล่ ${await codeOf(tx, productId)}`);

/** The counters after a delta — the one rule adjustQty and lockedStock share. */
function nextQty(row: StockRow, d: QtyDelta) {
  return {
    quantityAvailable: (row.quantityAvailable ?? 0) + (d.available ?? 0),
    quantityUsed: (row.quantityUsed ?? 0) + (d.used ?? 0),
    // never below 0: a legacy เบิก request was never booked (the old app kept no booking), so issuing / cancelling /
    // returning one in this app takes off a booking that was never added — clamped here, the normal +/- unchanged
    quantityBooking: Math.max(0, (row.quantityBooking ?? 0) + (d.booking ?? 0)),
    // apply the delta to remain (a few legacy rows drifted from available-used; keep their numbers)
    quantityRemain: (row.quantityRemain ?? 0) + (d.available ?? 0) - (d.used ?? 0),
  };
}

/** 409 "สต๊อก X ไม่พอ (คงเหลือ N)" — N = what the row held before this line. */
async function notEnough(tx: Tx, productId: number, remain: number | null) {
  return new HttpError(409, `สต๊อก ${await codeOf(tx, productId)} ไม่พอ (คงเหลือ ${remain ?? 0})`);
}

async function adjustQty(tx: Tx, productId: number, d: QtyDelta, opts: { allowNegative?: boolean } = {}) {
  const [row] = await tx.select().from(productStock).where(eq(productStock.productPk, productId)).for('update');
  if (!row) throw await noStockRow(tx, productId);
  const next = nextQty(row, d);
  if (next.quantityRemain < 0 && !opts.allowNegative) throw await notEnough(tx, productId, row.quantityRemain);
  await tx.update(productStock).set(next).where(eq(productStock.pk, row.pk));
  return next.quantityRemain;
}

/**
 * adjustQty for a whole movement: ONE select locks every stock row it touches, in product_id order
 * (line-by-line locking in request order let two movements over the same parts deadlock → 500);
 * adjust() applies a line in memory with adjustQty's rules (same 400 / 409, never below zero, a later
 * line sees an earlier one) and flush() writes every changed row in ONE update.
 */
async function lockedStock(tx: Tx, productIds: number[]) {
  const rows = productIds.length
    ? await tx
        .select()
        .from(productStock)
        .where(inArray(productStock.productPk, productIds))
        .orderBy(asc(productStock.productPk), asc(productStock.pk))
        .for('update')
    : [];
  const byProduct = new Map<number, StockRow>();
  for (const r of rows) if (r.productPk != null && !byProduct.has(r.productPk)) byProduct.set(r.productPk, r);
  // the 409 says what is on hand, not what an earlier line of this movement left in memory
  const onhand = new Map(rows.map((r) => [r.pk, r.quantityRemain]));
  const changed = new Set<StockRow>();
  return {
    async adjust(productId: number, d: QtyDelta) {
      const row = byProduct.get(productId);
      if (!row) throw await noStockRow(tx, productId);
      const next = nextQty(row, d);
      if (next.quantityRemain < 0) throw await notEnough(tx, productId, onhand.get(row.pk) ?? null);
      Object.assign(row, next);
      changed.add(row);
    },
    async flush() {
      if (!changed.size) return;
      const values = sql.join(
        [...changed].map(
          (r) =>
            sql`(${r.pk}::bigint, ${r.quantityAvailable}::int, ${r.quantityUsed}::int, ${r.quantityBooking}::int, ${r.quantityRemain}::int)`,
        ),
        sql`, `,
      );
      await tx.execute(sql`
        update product_stock s
           set quantity_available = v.a, quantity_used = v.u, quantity_booking = v.b, quantity_remain = v.r
          from (values ${values}) as v(id, a, u, b, r)
         where s.pk = v.id`);
    },
  };
}

/** `price` = ราคาขาย (retail — what the pickers show); `deleted` = ยกเลิกแล้ว: no new movement or request (gone());
 *  `inactive` = ปิดใช้งาน: still moves, but no new / bigger job request (jobs.ts) */
async function productsWhere(tx: Tx, where: SQL | undefined) {
  const rows = await tx
    .select({
      id: product.pk,
      code: product.productCode,
      name: product.productName,
      price: productStock.retailPrice,
      rs: product.recordStatus,
    })
    .from(product)
    .leftJoin(productStock, eq(productStock.productPk, product.pk))
    .where(where)
    .orderBy(desc(productStock.pk)) // a legacy second stock row: the Map keeps the lowest pk, as lockedStock
    // every caller is a write transaction, and locks the product rows before their stock rows (lockedStock):
    // a product delete (records.ts, FOR UPDATE) running now finishes first, or waits for this write
    .for('share', { of: product });
  return rows.map((r) => ({
    id: r.id,
    code: r.code ?? '',
    name: r.name ?? '',
    price: num(r.price),
    deleted: r.rs === RS.DELETED,
    inactive: r.rs === RS.INACTIVE,
  }));
}
type ProductRef = Awaited<ReturnType<typeof productsWhere>>[number];
/** products by code (`id` = product.pk) */
async function productsByCode(tx: Tx, codes: string[]) {
  if (!codes.length) return new Map<string, ProductRef>();
  return new Map((await productsWhere(tx, inArray(product.productCode, codes))).map((p) => [p.code, p]));
}
/** productsByCode keyed by product.pk (a job part line / sale-order line links by pk) */
async function productsByPk(tx: Tx, pks: (number | null)[]) {
  const want = pks.filter((p): p is number => p != null);
  if (!want.length) return new Map<number, ProductRef>();
  return new Map((await productsWhere(tx, inArray(product.pk, want))).map((p) => [p.id, p]));
}

/** a product deleted (ยกเลิก) since: nothing new is received, issued or requested for it — what it already
 *  issued may still come back (returnFromJob) and a request for it may still be cancelled */
const gone = (code: string | null) =>
  new HttpError(409, `อะไหล่ ${code} ถูกยกเลิกแล้ว — รับเข้า จ่ายออก หรือเบิกเพิ่มไม่ได้`);

/** lockedStock's lock alone, for a write that then calls adjustQty itself (jobs.ts): adjustQty re-locks rows
 *  this tx already holds, so the product_id order holds. */
async function lockStock(tx: Tx, productIds: number[]) {
  await lockedStock(tx, productIds);
}

/** The picker list (listProductsLite) shows names + on-hand: drop it after a product / stock write
 *  has COMMITTED — dropped earlier, a request in between would cache the old numbers again. */
export const productsChanged = () => invalidate('master:products:lite');

/** `jobPk` / `saleOrderPk` / `poNo` = what the movement is for (stock_move.reference_document_no before 0006) */
async function insertMovement(
  tx: Tx,
  h: {
    typeId: number;
    jobPk?: number | null;
    poNo?: string;
    saleOrderPk?: number | null;
    outTo?: string;
    remark?: string;
    date?: string;
  },
  lines: { pk: number; qty: number }[],
  byUserId: number,
): Promise<{ no: string; pk: number }> {
  const no = await nextRunningNo(
    tx,
    h.typeId === INV.RECEIVE || h.typeId === INV.RETURN_FROM_JOB ? 'Inventory-In' : 'Inventory-Out',
  );
  const [hd] = await tx
    .insert(stockMove)
    .values({
      stockMoveNo: no,
      stockMoveTypeId: h.typeId,
      jobPk: h.jobPk ?? null,
      saleOrderPk: h.saleOrderPk ?? null,
      poNo: cleanCode(h.poNo).slice(0, 50),
      // a job / sale-order movement's reference IS that document (job_pk / sale_order_pk): NULL here (ADR 0008); จ่ายออกอื่นๆ /
      // a receipt keep the typed name. The forms' schemas keep it within the column
      referenceOutTo: h.jobPk != null || h.saleOrderPk != null ? null : clean(h.outTo).slice(0, 50),
      remark: clean(h.remark).slice(0, 100),
      createDate: h.date ? `${h.date} ${nowThai().slice(11)}` : nowThai(),
      createdByAppUserPk: byUserId,
    })
    .returning({ pk: stockMove.pk });
  if (!hd) throw new Error('stock_move insert returned no row');
  await tx.insert(stockMoveLine).values(
    lines.map((l) => ({
      stockMovePk: hd.pk,
      productPk: l.pk,
      itemQuantity: l.qty.toFixed(4),
    })),
  );
  return { no, pk: hd.pk };
}

export type StockLine = { code: string; qty: number };

/** รับเข้า / จ่ายออกอื่นๆ: the same movement by product code, one counter apart. */
async function moveByCode(
  input: StockLine[],
  empty: string,
  counter: 'available' | 'used',
  h: Parameters<typeof insertMovement>[1],
  entry: (total: number, lines: StockLine[]) => Pick<AuditEntry, 'action' | 'module' | 'summary'>,
  byUserId: number,
): Promise<{ no: string; total: number }> {
  const lines = input.filter((l) => l.qty > 0);
  if (!lines.length) throw new HttpError(400, empty);
  return writeTx(async (tx) => {
    const map = await productsByCode(
      tx,
      lines.map((l) => l.code),
    );
    const stock = await lockedStock(
      tx,
      [...map.values()].map((p) => p.id),
    );
    const mv: { pk: number; qty: number }[] = [];
    for (const l of lines) {
      const p = map.get(l.code);
      if (!p) throw new HttpError(400, `ไม่พบรหัสอะไหล่ ${l.code}`);
      if (p.deleted) throw gone(l.code);
      await stock.adjust(p.id, { [counter]: l.qty });
      mv.push({ pk: p.id, qty: l.qty });
    }
    await stock.flush();
    const { no } = await insertMovement(tx, h, mv, byUserId);
    const total = lines.reduce((s, l) => s + l.qty, 0);
    await audit(tx, byUserId, {
      ...entry(total, lines),
      entity: 'stock_move',
      key: no,
      changes: { lines: [null, lines.map((l) => `${l.code} x${l.qty}`)] },
    });
    return { no, total };
  }).finally(productsChanged);
}

/** รับเข้าอะไหล่ → WHI (type 1), available += qty. */
export async function receiveStock(
  i: { date?: string; poRef?: string | null; supplier?: string | null; remark?: string | null; lines: StockLine[] },
  byUserId: number,
): Promise<{ no: string; total: number }> {
  // receiveSchema: supplier ≤ 40 + remark ≤ 47 → fits stock_move.remark varchar(100)
  const remark = [clean(i.supplier) ? `Supplier: ${clean(i.supplier)}` : '', clean(i.remark)]
    .filter(Boolean)
    .join(' · ');
  return moveByCode(
    i.lines,
    'ยังไม่ได้ระบุจำนวนรับเข้า',
    'available',
    { typeId: INV.RECEIVE, poNo: i.poRef ?? '', remark, date: i.date },
    (total, lines) => ({
      action: 'RECEIVE',
      module: 'Product Receive Stock',
      summary: `รับเข้าอะไหล่ ${lines.length} รายการ · ${total} ชิ้น${i.poRef ? ` · PO ${cleanCode(i.poRef)}` : ''}`,
    }),
    byUserId,
  );
}

/** จ่ายออกอื่นๆ → WHO (type 5). */
export async function issueOther(
  i: { payTo: string; remark?: string; lines: StockLine[] },
  byUserId: number,
): Promise<{ no: string; total: number }> {
  return moveByCode(
    i.lines,
    'ยังไม่ได้ระบุจำนวนจ่ายออก',
    'used',
    { typeId: INV.OUT_OTHER, outTo: i.payTo, remark: i.remark },
    (total) => ({
      action: 'ISSUE',
      module: 'Product Pick Stock',
      summary: `จ่ายออกอื่นๆ ให้ ${str(i.payTo)} · ${total} ชิ้น`,
    }),
    byUserId,
  );
}

/* ---- job spare-part requests (ใบเบิก) ---- */
export type PartRequestLine = {
  /** job_part.id (uuid) */
  logId: string;
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

/** job_part rows of the job numbered `jobNo` (the log links by job.pk) */
const partsOfJob = (jobNo: string) =>
  sql`${jobPart.jobPk} = (select ${job.pk} from ${job} where ${job.jobNo} = ${jobNo})`;

export async function listPartRequests(jobNo: string, onlyPending = false): Promise<PartRequestLine[]> {
  const rows = await db
    .select({
      logId: jobPart.id,
      code: product.productCode,
      name: product.productName,
      onhand: productStock.quantityRemain,
      requested: jobPart.requestQty,
      granted: jobPart.grantQty,
      returned: jobPart.returnQty,
      statusId: jobPart.jobPartStatusId,
      unitPrice: jobPart.sparePartUnitPrice,
      isQuotation: jobPart.isQuotation,
      isSpecial: jobPart.isSpecial,
      requestQtyB: jobPart.requestQtyB,
      isQuotationB: jobPart.isQuotationB,
      isSpecialB: jobPart.isSpecialB,
    })
    .from(jobPart)
    .leftJoin(product, eq(product.pk, jobPart.productPk))
    .leftJoin(productStock, eq(productStock.productPk, product.pk))
    .where(
      and(
        partsOfJob(jobNo),
        onlyPending
          ? and(
              eq(jobPart.jobPartStatusId, PART.REQUESTED),
              eq(jobPart.isSpecial, true), // เสนอ-only lines (not ticked เบิก) are not for stock
              sql`coalesce(${jobPart.requestQty},0) > coalesce(${jobPart.grantQty},0)`,
            )
          : ne(jobPart.jobPartStatusId, PART.CANCELLED),
      ),
    )
    .orderBy(asc(jobPart.pk));
  return rows.map((r) => {
    const requested = r.requested ?? 0;
    const granted = r.granted ?? 0;
    return {
      logId: r.logId,
      jobNo,
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
    .select({ s: sql<string>`coalesce(sum(${jobPart.sparePartTotalPrice}),0)` })
    .from(jobPart)
    .where(and(partsOfJob(jobNo), ne(jobPart.jobPartStatusId, PART.CANCELLED), eq(jobPart.isSpecial, true)));
  return num(sum?.s);
}

/** job_status ids of a closed or cancelled job: ยกเลิกข้อมูล · ยกเลิกซ่อม · ปิดงาน (7 / 8 / 20 / 21 / 23 / 24) ·
 *  ซ่อมเสร็จ (ไม่พบอาการเสีย ขอส่งคืน) — no fault found → no parts go out (owner 2026-10-15) */
export const JOB_CLOSED_STATUSES: number[] = [
  JS.CANCELLED,
  JS.REPAIR_CANCELLED,
  JS.CLOSED_WAIT_TRACKING,
  JS.CLOSED_TRACKED,
  JS.COMPLETE,
  JS.CLOSED_REFUND,
  JS.REPAIRED_NO_FAULT,
  JS.CLOSED_OUTSOURCE,
  JS.CLOSED_WAIT_PICKUP,
];

/** No part goes out to a closed / cancelled job (returns from it stay allowed). In a transaction the
 *  job row is locked first (job → request rows → stock, the order the repair save locks in) — for update:
 *  the issue moves the job's status in the same transaction (followParts). */
export async function assertJobOpenForIssue(jobNo: string, x: Tx | typeof db = db): Promise<number | undefined> {
  const [j] = await x
    .select({ pk: job.pk, id: job.jobStatusId, name: jobStatus.jobStatusName })
    .from(job)
    .leftJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
    .where(eq(job.jobNo, jobNo))
    .for('update', { of: job });
  if (j?.id != null && JOB_CLOSED_STATUSES.includes(j.id))
    throw new HttpError(
      409,
      `งาน ${jobNo} อยู่ในสถานะ "${clean(j.name) || j.id}" (ปิดงาน ยกเลิก หรือไม่พบอาการเสีย) — ตัดจ่ายอะไหล่ให้งานนี้ไม่ได้`,
    );
  return j?.pk;
}

/** จ่ายออกตามงานซ่อม → WHO (type 3) + grant on the request rows; every request issued → the job's status moves
 *  (followParts) in the SAME transaction — done after, a save in between adopted the moved version. */
export async function issueForJob(
  i: { jobNo: string; remark?: string; payTo?: string; lines: { logId: string; qty: number }[] },
  byUserId: number,
): Promise<{ no: string; total: number; allGranted: boolean }> {
  const lines = i.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new HttpError(400, 'ยังไม่ได้ระบุจำนวนจ่ายออก');
  return writeTx(async (tx) => {
    const jobPk = await assertJobOpenForIssue(i.jobNo, tx);
    const reqs = await tx
      .select()
      .from(jobPart)
      .where(
        and(
          partsOfJob(i.jobNo),
          inArray(
            jobPart.id,
            lines.map((l) => l.logId).filter(isUuid), // none sent → 404 below, not a pg cast error
          ),
        ),
      )
      .for('update');
    const byId = new Map(reqs.map((r) => [r.id, r]));
    const map = await productsByPk(
      tx,
      reqs.map((r) => r.productPk),
    );
    const stock = await lockedStock(
      tx,
      [...map.values()].map((p) => p.id),
    );
    const mvLines: (StockLine & { pk: number })[] = [];
    const now = nowThai();
    for (const l of lines) {
      const r = byId.get(l.logId);
      if (!r) throw new HttpError(404, `ไม่พบรายการเบิกในงาน ${i.jobNo} — โหลดรายการใหม่`);
      const p = r.productPk != null ? map.get(r.productPk) : undefined;
      const code = p?.code ?? '';
      if (!r.isSpecial) throw new HttpError(400, `${code} ไม่ได้ติ๊ก "เบิก" — ไม่ใช่รายการขอเบิก`);
      // issued / cancelled since the list was loaded
      if (r.jobPartStatusId !== PART.REQUESTED)
        throw new HttpError(409, `${code} ไม่อยู่ในสถานะรอเบิกแล้ว — โหลดรายการใหม่`);
      const need = (r.requestQty ?? 0) - (r.grantQty ?? 0);
      if (l.qty > need) throw new HttpError(400, `จ่ายเกินจำนวนที่ขอ (${code})`);
      if (!p) throw new HttpError(400, `ไม่พบรหัสอะไหล่ ${code}`);
      if (p.deleted) throw gone(code);
      await stock.adjust(p.id, { used: l.qty, booking: -l.qty });
      const granted = (r.grantQty ?? 0) + l.qty;
      await tx
        .update(jobPart)
        .set({
          grantQty: granted,
          grantDate: now,
          grantedByAppUserPk: byUserId,
          jobPartStatusId: granted >= (r.requestQty ?? 0) ? PART.GRANTED : PART.REQUESTED,
        })
        .where(eq(jobPart.pk, r.pk));
      mvLines.push({ code, qty: l.qty, pk: p.id });
    }
    await stock.flush();
    const { no } = await insertMovement(
      tx,
      { typeId: INV.OUT_JOB, jobPk, outTo: i.payTo, remark: i.remark },
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
      .from(jobPart)
      .where(
        and(
          partsOfJob(i.jobNo),
          eq(jobPart.jobPartStatusId, PART.REQUESTED),
          eq(jobPart.isSpecial, true),
          sql`coalesce(${jobPart.requestQty},0) > coalesce(${jobPart.grantQty},0)`,
        ),
      );
    const allGranted = (pending?.n ?? 0) === 0;
    // jobs.ts imports this module — loaded when called, not at import (no import cycle)
    const moved = allGranted && (await (await import('./jobs')).followParts(tx, i.jobNo, byUserId));
    // a partial issue writes no job column: the version moves anyway, a repair page opened before is stale (0036)
    if (!moved)
      await tx
        .update(job)
        .set({ rowVersion: sql`${job.rowVersion} + 1` })
        .where(eq(job.jobNo, i.jobNo));
    return { no, total: mvLines.reduce((s, l) => s + l.qty, 0), allGranted };
  }).finally(productsChanged);
}

/* ---- job lists for the pick page reference dropdown ---- */
/** Open jobs (not closed / cancelled) that still have parts waiting to be issued, newest request first. */
export async function jobsWithPendingParts(limit = 300): Promise<string[]> {
  const rows = await db
    .select({ jobNo: job.jobNo, last: sql<string>`max(${jobPart.requestDate})` })
    .from(jobPart)
    .innerJoin(job, eq(job.pk, jobPart.jobPk))
    .where(
      and(
        or(isNull(job.jobStatusId), notInArray(job.jobStatusId, JOB_CLOSED_STATUSES)),
        eq(jobPart.jobPartStatusId, PART.REQUESTED),
        eq(jobPart.isSpecial, true),
        sql`coalesce(${jobPart.requestQty},0) > coalesce(${jobPart.grantQty},0)`,
      ),
    )
    .groupBy(job.jobNo)
    .orderBy(sql`max(${jobPart.requestDate}) desc`)
    .limit(limit);
  return rows.map((r) => r.jobNo ?? '').filter(Boolean);
}

/** Jobs with issued parts that can still be returned to stock (granted > returned), newest first. */
export async function jobsWithReturnableParts(limit = 300): Promise<string[]> {
  const rows = await db
    .select({ jobNo: job.jobNo, last: sql<string>`max(${jobPart.grantDate})` })
    .from(jobPart)
    .innerJoin(job, eq(job.pk, jobPart.jobPk))
    .where(returnableLine)
    .groupBy(job.jobNo)
    .orderBy(sql`max(${jobPart.grantDate}) desc`)
    .limit(limit);
  return rows.map((r) => r.jobNo ?? '').filter(Boolean);
}

/* ---- return from job (รับคืนจากการเบิก, inventory_type 2) ---- */
/** a line stock may take parts back from: issued (จ่ายแล้ว / ขอคืน) or partly issued (still รอเบิก for the rest) —
 *  with issued pieces not yet back */
const RETURNABLE: number[] = [PART.GRANTED, PART.RETURN_REQUESTED, PART.REQUESTED];
const returnableLine = and(
  inArray(jobPart.jobPartStatusId, RETURNABLE),
  sql`coalesce(${jobPart.grantQty},0) > coalesce(${jobPart.returnQty},0)`,
);
export type ReturnLine = {
  /** job_part.id (uuid) */
  logId: string;
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
      logId: jobPart.id,
      code: product.productCode,
      name: product.productName,
      onhand: productStock.quantityRemain,
      granted: jobPart.grantQty,
      returned: jobPart.returnQty,
      statusId: jobPart.jobPartStatusId,
    })
    .from(jobPart)
    .leftJoin(product, eq(product.pk, jobPart.productPk))
    .leftJoin(productStock, eq(productStock.productPk, product.pk))
    .where(and(partsOfJob(jobNo), returnableLine))
    .orderBy(asc(jobPart.pk));
  return rows.map((r) => ({
    logId: r.logId,
    jobNo,
    code: r.code ?? '',
    name: r.name ?? '',
    onhand: r.onhand ?? 0,
    granted: r.granted ?? 0,
    returned: r.returned ?? 0,
    returnable: Math.max(0, (r.granted ?? 0) - (r.returned ?? 0)),
    status: r.statusId === PART.REQUESTED ? 'เบิกบางส่วน' : (PART_STATUS_NAME[r.statusId ?? 3] ?? ''),
  }));
}

/**
 * รับคืนจากการเบิก → WHI (type 2), counted in like a receive, as legacy did
 * (available += qty → remain += qty; used keeps the issue) and records return_qty/date/by on the ใบเบิก row;
 * a fully returned line becomes status 5 (คืนแล้ว). A charged line is re-priced to what is still
 * used (granted - returned) and the job's parts / total cost follow in the same transaction.
 */
export async function returnFromJob(
  i: { jobNo: string; remark?: string; from?: string; lines: { logId: string; qty: number }[] },
  byUserId: number,
): Promise<{ no: string; total: number }> {
  const lines = i.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new HttpError(400, 'ยังไม่ได้ระบุจำนวนรับคืน');
  return writeTx(async (tx) => {
    // the job row before its part rows — the order saveRepair locks them in
    const [j] = await tx.select().from(job).where(eq(job.jobNo, i.jobNo)).for('update');
    const reqs = await tx
      .select()
      .from(jobPart)
      .where(
        and(
          partsOfJob(i.jobNo),
          inArray(
            jobPart.id,
            lines.map((l) => l.logId).filter(isUuid), // none sent → 404 below, not a pg cast error
          ),
        ),
      )
      .for('update');
    const byId = new Map(reqs.map((r) => [r.id, r]));
    const map = await productsByPk(
      tx,
      reqs.map((r) => r.productPk),
    );
    const stock = await lockedStock(
      tx,
      [...map.values()].map((p) => p.id),
    );
    const mvLines: (StockLine & { pk: number })[] = [];
    const now = nowThai();
    let partsDelta = 0; // the charged lines' change (a legacy job's totals move by it)
    for (const l of lines) {
      const r = byId.get(l.logId);
      if (!r) throw new HttpError(404, `ไม่พบรายการเบิกในงาน ${i.jobNo} — โหลดรายการใหม่`);
      const p = r.productPk != null ? map.get(r.productPk) : undefined;
      const code = p?.code ?? '';
      if (!RETURNABLE.includes(r.jobPartStatusId ?? -1))
        throw new HttpError(409, `${code} ไม่อยู่ในสถานะที่รับคืนได้ — โหลดรายการใหม่`);
      const returnable = (r.grantQty ?? 0) - (r.returnQty ?? 0);
      if (l.qty > returnable) throw new HttpError(400, `รับคืนเกินจำนวนที่จ่ายไป (${code})`);
      if (!p) throw new HttpError(400, `ไม่พบรหัสอะไหล่ ${code}`);
      await stock.adjust(p.id, { available: l.qty });
      const returned = (r.returnQty ?? 0) + l.qty;
      // a partly issued line still waits for the rest: it stays รอเบิก, charged for what it will use
      const partly = r.jobPartStatusId === PART.REQUESTED;
      const using = Math.max(0, (partly ? (r.requestQty ?? 0) : (r.grantQty ?? 0)) - returned);
      const price = r.isQuotation ? money(num(r.sparePartUnitPrice) * using) : null;
      // what this line's charge moves partsTotalOf by: only a line it counts (เบิก ticked, not cancelled)
      if (price !== null && r.isSpecial && r.jobPartStatusId !== PART.CANCELLED)
        partsDelta += num(price) - num(r.sparePartTotalPrice);
      await tx
        .update(jobPart)
        .set({
          returnQty: returned,
          returnDate: now,
          returnedByAppUserPk: byUserId,
          returnStockId: STORE_LOCATION_ID,
          jobPartStatusId: !partly && returned >= (r.grantQty ?? 0) ? PART.RETURNED : r.jobPartStatusId,
          ...(price !== null ? { sparePartTotalPrice: price } : {}),
        })
        .where(eq(jobPart.pk, r.pk));
      mvLines.push({ code, qty: l.qty, pk: p.id });
    }
    await stock.flush();
    const { no } = await insertMovement(
      tx,
      { typeId: INV.RETURN_FROM_JOB, jobPk: j?.pk, outTo: i.from, remark: i.remark },
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
      if (await isLegacyRow('job', j.pk)) {
        // a legacy job's recorded totals may hold VAT / a discount or have no lines behind them (owner 2026-10-30:
        // never recomputed): they move by what this return changed in the charged lines (as jobs.ts withTotal)
        if (partsDelta !== 0)
          costs = {
            sparePartTotalCost: money(num(j.sparePartTotalCost) + partsDelta),
            jobTotalCost: money(num(j.jobTotalCost) + partsDelta),
          };
      } else {
        const parts = await partsTotalOf(tx, i.jobNo);
        const rest = num(j.serviceCost) + num(j.serviceToolCost) + num(j.deliveryCost) + num(j.cartonBoxCost);
        costs = { sparePartTotalCost: money(parts), jobTotalCost: money(parts + rest) };
      }
    }
    // the version moves even when the costs stay (one UPDATE: +1 either way, 0036) — a repair page opened before is stale
    if (j)
      await tx
        .update(job)
        .set({ ...costs, rowVersion: sql`${job.rowVersion} + 1` })
        .where(eq(job.jobNo, i.jobNo));
    await audit(tx, byUserId, {
      action: 'RETURN',
      module: 'Job ReturnStock',
      entity: 'job',
      key: i.jobNo,
      summary: `รับคืนอะไหล่ ${no} · ${mvLines.reduce((s, l) => s + l.qty, 0)} ชิ้น`,
      changes: { lines: [null, mvLines.map((l) => `${l.code} x${l.qty}`)], ...diff(j, costs) },
    });
    return { no, total: mvLines.reduce((s, l) => s + l.qty, 0) };
  }).finally(productsChanged);
}

/* ---- sale order picking ---- */
/** `pickNo`: the WHO that already issued the line ('' = still to issue) */
export type SoPickLine = {
  /** sale_order_line.id (uuid) */
  dtId: string;
  code: string;
  name: string;
  onhand: number;
  need: number;
  picked: boolean;
  pickNo: string;
};

/** a product line (a service line has no product_pk — product_type was dropped in drizzle/0006) */
const soGoodsLine = isNotNull(saleOrderLine.productPk);
/** a product line no WHO has issued yet (legacy '' became NULL in drizzle/0006) */
const soLineToPick = and(soGoodsLine, isNull(saleOrderLine.pickStockMovePk));

/** จ่ายออกตามใบสั่งขาย's list: approved orders with a product line still to issue. Approving an order
 *  issues its stock (approveSaleOrder), so this is what approval left behind — usually nothing. */
export async function saleOrdersToPick(limit = 300): Promise<string[]> {
  const rows = await db
    .selectDistinct({ no: saleOrder.saleOrderNo })
    .from(saleOrder)
    .innerJoin(saleOrderLine, eq(saleOrderLine.saleOrderPk, saleOrder.pk))
    .where(
      and(eq(saleOrder.approveStatusId, AS.APPROVED), statusFilter(saleOrder.recordStatus, 'exclude'), soLineToPick),
    )
    .orderBy(desc(saleOrder.saleOrderNo))
    .limit(limit);
  return rows.flatMap((r) => (r.no ? [r.no] : []));
}

export async function listSaleOrderPickLines(soNo: string): Promise<SoPickLine[]> {
  const rows = await db
    .select({
      dtId: saleOrderLine.id,
      // the product's code (product_code is NULL on a new product line — ADR 0008 "no redundant data")
      code: sql<string | null>`coalesce(${product.productCode}, ${saleOrderLine.productCode})`,
      name: product.productName,
      onhand: productStock.quantityRemain,
      qty: saleOrderLine.saleOutQuantity,
      pick: stockMove.stockMoveNo,
    })
    .from(saleOrderLine)
    .innerJoin(saleOrder, eq(saleOrder.pk, saleOrderLine.saleOrderPk))
    .leftJoin(stockMove, eq(stockMove.pk, saleOrderLine.pickStockMovePk))
    .leftJoin(product, eq(product.pk, saleOrderLine.productPk))
    .leftJoin(productStock, eq(productStock.productPk, product.pk))
    .where(and(eq(saleOrder.saleOrderNo, soNo), soGoodsLine))
    .orderBy(asc(saleOrderLine.listNo));
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

/** จ่ายออกตามใบสั่งขาย → WHO (type 4, its sale_order_pk = the order — what the order's ใบเบิก reads); stamps the
 *  lines' pick_stock_move_pk. `payTo` is not stored: the order is the movement's reference (reference_out_to ''). */
export async function issueForSaleOrder(
  i: { soNo: string; remark?: string; payTo?: string; lines?: { dtId: string; qty: number }[] },
  byUserId: number,
  tx?: Tx,
): Promise<{ no: string; total: number }> {
  const run = async (t: Tx) => {
    // header first — the same lock order as saveSaleOrder / approveSaleOrder (no deadlock);
    // only an APPROVED order may take stock out (the UI filters, the API must too: a pick on a
    // waiting order, then an edit + approve, would take the stock out twice)
    const [hd] = await t
      .select({ pk: saleOrder.pk, approve: saleOrder.approveStatusId, status: saleOrder.recordStatus })
      .from(saleOrder)
      .where(eq(saleOrder.saleOrderNo, i.soNo))
      .for('update');
    if (!hd) throw new HttpError(404, 'ไม่พบใบสั่งขาย ' + i.soNo);
    if (hd.status === RS.DELETED) throw new HttpError(409, 'ใบสั่งขายนี้ถูกยกเลิกแล้ว จ่ายสินค้าไม่ได้');
    if (hd.approve !== AS.APPROVED) throw new HttpError(409, 'ใบสั่งขายยังไม่ได้รับอนุมัติ จ่ายสินค้าไม่ได้');
    const dts = await t
      .select({ ...getTableColumns(saleOrderLine), code: product.productCode })
      .from(saleOrderLine)
      .innerJoin(product, eq(product.pk, saleOrderLine.productPk))
      .where(eq(saleOrderLine.saleOrderPk, hd.pk))
      .for('update', { of: saleOrderLine });
    const want = i.lines ? new Map(i.lines.map((l) => [l.dtId, l.qty])) : null;
    const stock = await lockedStock(
      t,
      dts.flatMap((d) => (d.pickStockMovePk == null && d.productPk ? [d.productPk] : [])),
    );
    const mv: (StockLine & { pk: number })[] = [];
    const picked: number[] = [];
    for (const d of dts) {
      if (d.pickStockMovePk != null) continue;
      const qty = want ? (want.get(d.id) ?? 0) : d.saleOutQuantity;
      if (qty <= 0) continue;
      if (qty > d.saleOutQuantity) throw new HttpError(400, `จ่ายเกินจำนวนในใบสั่งขาย (${d.code})`);
      if (!d.productPk) throw new HttpError(400, `รายการ ${d.code} ไม่มี product_id`);
      await stock.adjust(d.productPk, { used: qty });
      mv.push({ code: d.code ?? '', qty, pk: d.productPk });
      picked.push(d.pk);
    }
    await stock.flush();
    if (!mv.length) {
      // approving the order issued it already — say so instead of a bare "nothing to issue"
      if (dts.length && dts.every((d) => d.pickStockMovePk != null)) {
        const done = await t
          .select({ no: stockMove.stockMoveNo })
          .from(stockMove)
          .where(
            inArray(
              stockMove.pk,
              dts.map((d) => d.pickStockMovePk!),
            ),
          )
          .orderBy(asc(stockMove.pk))
          .then((rows) => rows.map((r) => r.no));
        throw new HttpError(
          409,
          `ใบสั่งขาย ${i.soNo} ตัดสต๊อกครบแล้ว (${done.join(', ')}) — ไม่มีรายการที่ต้องจ่ายออก`,
        );
      }
      throw new HttpError(400, 'ไม่มีรายการที่ต้องจ่ายออก');
    }
    const { no, pk: pickPk } = await insertMovement(
      t,
      { typeId: INV.OUT_SALE, saleOrderPk: hd.pk, remark: i.remark },
      mv,
      byUserId,
    );
    await audit(t, byUserId, {
      action: 'ISSUE',
      module: 'Sale Order',
      entity: 'sale_order',
      key: i.soNo,
      summary: `ตัดสต๊อกตามใบสั่งขาย ${no} · ${mv.reduce((s, l) => s + l.qty, 0)} ชิ้น`,
      changes: { lines: [null, mv.map((l) => `${l.code} x${l.qty}`)] },
    });
    await t.update(saleOrderLine).set({ pickStockMovePk: pickPk }).where(inArray(saleOrderLine.pk, picked));
    return { no, total: mv.reduce((s, l) => s + l.qty, 0) };
  };
  // with the caller's tx, the caller calls productsChanged() after its commit
  return tx ? run(tx) : writeTx(run).finally(productsChanged);
}

/* ------------------------------------------------------------------ *
 * Movements (ประวัติการเคลื่อนไหว) — stock_move + summarised lines
 * ------------------------------------------------------------------ */
/**
 * Word search like the product picker's: every typed word ("P02556 ฝาหลัง") must match the document no /
 * reference (`docs`) or a line's part code or Thai / English / Chinese name — the words in any order.
 */
const movementSearch = (text: string, docs: boolean) =>
  and(
    ...text
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) =>
        or(
          docs ? ilike(stockMove.stockMoveNo, likeTerm(w)) : undefined,
          docs ? refLike(likeTerm(w)) : undefined,
          // the matching lines' movements, collected once (a per-movement EXISTS runs the line search per row)
          sql`${stockMove.pk} = ANY(ARRAY(select d.stock_move_pk from stock_move_line d join ${product} on ${product.pk} = d.product_pk
            where ${product.productCode} ilike ${likeTerm(w)} or ${nameLike(w)}))`,
        ),
      ),
  );

/** what the movement is for — the job or sale order no., or a receipt's PO no. (inventory_hd.reference_document_no
 *  before drizzle/0006) */
const refNo = sql<string | null>`coalesce(
  (select j.job_no from job j where j.pk = ${stockMove.jobPk}),
  (select s.sale_order_no from sale_order s where s.pk = ${stockMove.saleOrderPk}),
  nullif(${stockMove.poNo}, ''))`;
/** refNo ilike t, each source on its own index (job_no / sale_order_no / po_no trigram) instead of the coalesce of
 *  two subqueries per movement: job_pk and sale_order_pk are never both set and po_no is '' when either is */
const refLike = (t: string) => sql`(${stockMove.jobPk} = ANY(ARRAY(select j.pk from job j where j.job_no ilike ${t}))
  or ${stockMove.saleOrderPk} = ANY(ARRAY(select s.pk from sale_order s where s.sale_order_no ilike ${t}))
  or ${stockMove.poNo} ilike ${t})`;
/** a movement's total qty / its lines as "P00012 x2, P00345 x1" */
const movementQty = sql<string>`(select coalesce(sum(d.item_quantity),0) from stock_move_line d where d.stock_move_pk = ${stockMove.pk})`;
const movementItems = sql<string>`(select string_agg(p.product_code || ' x' || d.item_quantity::int, ', ' order by d.pk)
  from stock_move_line d left join product p on p.pk = d.product_pk where d.stock_move_pk = ${stockMove.pk})`;

/** Unpaged (Excel export / JSON list) — the same movementWhere as the paged screen, so the file matches it. */
export async function listMovements(opts: MovementFilters & { limit?: number } = {}): Promise<Movement[]> {
  const { limit = 1000 } = opts;
  const rows = await db
    .select({
      doc: stockMove.stockMoveNo,
      type: stockMoveType.stockMoveTypeName,
      typeId: stockMove.stockMoveTypeId,
      ref: refNo,
      outTo: stockMove.referenceOutTo,
      date: stockMove.createDate,
      remark: stockMove.remark,
      byFirst: appUser.firstName,
      byLast: appUser.lastName,
      qty: movementQty,
      items: movementItems,
      loc: storeLocation.storeLocationName,
    })
    .from(stockMove)
    .leftJoin(stockMoveType, eq(stockMoveType.stockMoveTypeId, stockMove.stockMoveTypeId))
    .leftJoin(appUser, eq(appUser.pk, stockMove.createdByAppUserPk))
    .leftJoin(storeLocation, eq(storeLocation.storeLocationId, STORE_LOCATION_ID))
    .where(movementWhere(opts))
    .orderBy(desc(stockMove.createDate), desc(stockMove.pk))
    .limit(Math.min(limit, MAX_EXPORT_ROWS));
  return rows.map((r) => {
    const isIn = r.typeId === INV.RECEIVE || r.typeId === INV.RETURN_FROM_JOB;
    const wh = r.loc ?? STORE_LOCATION_NAME;
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
/** a movement line's signed qty on the stock card: a type that adds (+) / takes (−); an unknown type counts as in */
const cardSigned = sql`case when coalesce(${stockMoveType.movementAction}, 1) > 0 then ${stockMoveLine.itemQuantity}
  when coalesce(${stockMoveType.movementAction}, 1) < 0 then -${stockMoveLine.itemQuantity} else 0 end`;
const cardFrom = (code: string) =>
  db
    .select({
      no: stockMove.stockMoveNo,
      date: stockMove.createDate,
      type: stockMoveType.stockMoveTypeName,
      action: stockMoveType.movementAction,
      qty: stockMoveLine.itemQuantity,
      ref: refNo.as('ref'),
      remark: stockMove.remark,
      // the running balance after this line, oldest first — computed in SQL so a page needs only its own rows
      after: sql<string>`sum(${cardSigned}) over (order by ${stockMove.createDate}, ${stockMoveLine.pk})`.as('after'),
      k: stockMoveLine.pk,
    })
    .from(stockMoveLine)
    .innerJoin(stockMove, eq(stockMove.pk, stockMoveLine.stockMovePk))
    .innerJoin(product, eq(product.pk, stockMoveLine.productPk))
    .leftJoin(stockMoveType, eq(stockMoveType.stockMoveTypeId, stockMove.stockMoveTypeId))
    .where(eq(product.productCode, code));

/** Stock card for one product (product-detail modal), newest first: `limit` lines from `offset` (a page — a busy
 *  part has hundreds); every line's before / after is the running balance over all of its movements. */
export async function productStockCard(code: string, page: { offset?: number; limit?: number } = {}) {
  const c = cardFrom(code).as('c');
  const rows = await db
    .select()
    .from(c)
    .orderBy(desc(c.date), desc(c.k))
    .limit(Math.min(page.limit ?? MAX_EXPORT_ROWS, MAX_EXPORT_ROWS))
    .offset(Math.max(0, page.offset ?? 0));
  return rows.map((r) => {
    const q = num(r.qty);
    const inc = (r.action ?? 1) > 0 ? q : 0;
    const out = (r.action ?? 1) < 0 ? q : 0;
    const after = num(r.after);
    return {
      no: r.no ?? '',
      date: fmtDateTime(r.date),
      type: r.type ?? '',
      before: after - inc + out,
      income: inc,
      outcome: out,
      after,
      ref: r.ref ?? '',
      remark: r.remark ?? '',
    };
  });
}

/** how many lines the product's stock card has (its "load more" stops there) */
export async function productStockCardTotal(code: string): Promise<number> {
  const [r] = await db
    .select({ n: countFn() })
    .from(stockMoveLine)
    .innerJoin(product, eq(product.pk, stockMoveLine.productPk))
    .where(eq(product.productCode, code));
  return Number(r?.n ?? 0);
}

export { adjustQty, insertMovement, lockStock, productsByCode, productsByPk };

/** Line items of one movement document (stock_move_line joined to product). */
export async function movementLines(no: string) {
  const rows = await db
    .select({
      code: product.productCode,
      name: product.productName,
      qty: stockMoveLine.itemQuantity,
      supplier: stockMove.remark,
      ref: refNo,
    })
    .from(stockMoveLine)
    .innerJoin(stockMove, eq(stockMove.pk, stockMoveLine.stockMovePk))
    .leftJoin(product, eq(product.pk, stockMoveLine.productPk))
    .where(eq(stockMove.stockMoveNo, no))
    .orderBy(asc(stockMoveLine.pk));
  return rows.map((r) => ({
    code: r.code ?? '',
    name: r.name ?? '',
    qty: num(r.qty),
    unit: ITEM_UNIT, // stock_move_line.item_unit was 'Pcs.' on every row — dropped in drizzle/0006
    supplier: (r.supplier ?? '').match(/Supplier:\s*([^·]+)/)?.[1]?.trim() ?? '',
    ref: r.ref ?? '',
  }));
}

/** รายงานการเบิกจ่ายอะไหล่ — every issued line (WHO types 3/4/5, returns 2 as negative qty) in a date range; the Excel export.
 *  Same filter (issuedWhere) and rows as the screen (pageIssuedLines), only not paged. */
export async function listIssuedLines(opts: IssuedFilters & { limit?: number } = {}) {
  const rows = await issuedBase()
    .where(issuedWhere('', opts))
    .orderBy(desc(stockMove.createDate), asc(stockMoveLine.pk))
    .limit(Math.min(opts.limit ?? 5000, MAX_EXPORT_ROWS));
  return rows.map(toIssued);
}

/* ------------------------------------------------------------------ *
 * Paged products (รายการอะไหล่ / รายงานคงเหลือ) + lite list for dropdowns
 * ------------------------------------------------------------------ */

/** other products that already carry this vendor code — a warning on save, not a block (legacy has pairs) */
export async function productsWithMfgCode(mfgCode: string, exceptSysCode: string): Promise<string[]> {
  const code = cleanMfgCode(mfgCode);
  if (!code) return [];
  const rows = await db
    .select({ c: product.productCode })
    .from(product)
    .where(and(sql`upper(btrim(${product.productVendorCode})) = ${code}`, ne(product.productCode, exceptSysCode)))
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

/** The page's query (?category=&stock=…) as filters — the list, its KPI and the export all read it here. */
export const productFiltersFromQuery = (f: Record<string, string>, mode: DeletedMode): ProductFilters => ({
  mode,
  status: f.status,
  sysCode: f.sysCode,
  mfgCode: f.mfgCode,
  name: f.name,
  brand: f.brand,
  category: f.category,
  creator: f.creator,
  date: f.date,
  model: f.model,
  stock: f.stock === 'in' || f.stock === 'low' || f.stock === 'out' ? f.stock : undefined,
});

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
    f.sysCode ? ilike(product.productCode, likeTerm(f.sysCode)) : undefined,
    f.mfgCode ? ilike(product.productVendorCode, likeTerm(f.mfgCode)) : undefined,
    f.name ? nameLike(f.name) : undefined,
    f.brand ? eq(brand.brandName, f.brand) : undefined,
    f.category ? eq(category.categoryName, f.category) : undefined,
    f.creator?.trim()
      ? isUuid(f.creator.trim())
        ? eq(creatorUser.id, f.creator.trim().toLowerCase())
        : // the same name fullName() builds: each part trimmed, empty parts dropped
          sql`concat_ws(' ', nullif(trim(${creatorUser.firstName}),''), nullif(trim(${creatorUser.lastName}),'')) ilike ${likeTerm(f.creator.trim())}`
      : undefined,
    ymd(f.date) ? sql`${product.createDate}::date = ${f.date}::date` : undefined,
    f.model
      ? sql`exists (select 1 from product_compatible_model pm join model m on m.pk = pm.model_pk where pm.product_pk = ${product.pk} and m.model_code = ${f.model})`
      : undefined,
    f.stock === 'in' ? sql`coalesce(${productStock.quantityRemain},0) > ${LOW_STOCK}` : undefined,
    f.stock === 'low' ? sql`coalesce(${productStock.quantityRemain},0) between 1 and ${LOW_STOCK}` : undefined,
    f.stock === 'out' ? sql`coalesce(${productStock.quantityRemain},0) <= 0` : undefined,
  );
}

const productPagedQuery = () =>
  db
    .select({ ...productSelect, creatorFirst: creatorUser.firstName, creatorLast: creatorUser.lastName })
    .from(product)
    .leftJoin(category, eq(category.pk, product.categoryPk))
    .leftJoin(brand, eq(brand.pk, product.brandPk))
    .leftJoin(productStock, eq(productStock.productPk, product.pk))
    .leftJoin(creatorUser, eq(creatorUser.pk, product.createdByAppUserPk));

const PRODUCT_SORT = {
  sysCode: product.productCode,
  mfgCode: product.productVendorCode,
  name: product.productName,
  category: category.categoryName,
  brand: brand.brandName,
  onhand: productStock.quantityRemain,
  price: productStock.retailPrice,
  status: product.recordStatus,
  value: sql`coalesce(${productStock.quantityRemain},0) * coalesce(${productStock.retailPrice},0)`,
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
      .leftJoin(category, eq(category.pk, product.categoryPk))
      .leftJoin(brand, eq(brand.pk, product.brandPk))
      .leftJoin(productStock, eq(productStock.productPk, product.pk))
      .leftJoin(creatorUser, eq(creatorUser.pk, product.createdByAppUserPk))
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
      qty: sql<string>`coalesce(sum(greatest(coalesce(${productStock.quantityRemain},0),0)),0)`,
      value: sql<string>`coalesce(sum(greatest(coalesce(${productStock.quantityRemain},0),0) * coalesce(${productStock.retailPrice},0)),0)`,
      low: sql<string>`count(*) filter (where coalesce(${productStock.quantityRemain},0) between 1 and ${LOW_STOCK})`,
      out: sql<string>`count(*) filter (where coalesce(${productStock.quantityRemain},0) <= 0)`,
      // in stock but no retail price: left out of value — the page says how many
      noPrice: sql<string>`count(*) filter (where coalesce(${productStock.quantityRemain},0) > 0 and coalesce(${productStock.retailPrice},0) = 0)`,
    })
    .from(product)
    .leftJoin(category, eq(category.pk, product.categoryPk))
    .leftJoin(brand, eq(brand.pk, product.brandPk))
    .leftJoin(productStock, eq(productStock.productPk, product.pk))
    .leftJoin(creatorUser, eq(creatorUser.pk, product.createdByAppUserPk))
    .where(productWhere(q, f));
  if (!r) throw new Error('aggregate returned no row'); // no GROUP BY → always exactly one row
  return {
    total: Number(r.total),
    qty: num(r.qty),
    value: num(r.value),
    low: num(r.low),
    out: num(r.out),
    noPrice: num(r.noPrice),
  };
}

/** Lite rows for dropdowns / pickers — a few fields instead of ~25 (the EN / CN names: the pickers search them). */
export type ProductLite = Pick<
  Product,
  'sysCode' | 'mfgCode' | 'name' | 'nameEn' | 'nameCn' | 'onhand' | 'price' | 'status' | 'category' | 'brand'
>;
export function listProductsLite(q = '', mode: 'active' | 'exclude' = 'active'): Promise<ProductLite[]> {
  // no term = the whole catalog (stock receive / pick grids); with a term = the picker's server search.
  // `exclude` = INACTIVE too (stock receive: a part no new document may use still arrives).
  // Both memoised; productsChanged() drops every key.
  const term = q.trim();
  return cached(`master:products:lite:${mode}:${term}`, TTL_MASTER, () => loadProductsLite(term, mode));
}
async function loadProductsLite(term: string, mode: 'active' | 'exclude'): Promise<ProductLite[]> {
  const rows = await db
    .select({
      sysCode: product.productCode,
      mfgCode: product.productVendorCode,
      name: product.productName,
      nameEn: product.productNameEn,
      nameCn: product.productNameCn,
      onhand: productStock.quantityRemain,
      price: productStock.retailPrice,
      category: category.categoryName,
      brand: brand.brandName,
      rs: product.recordStatus,
    })
    .from(product)
    .leftJoin(productStock, eq(productStock.productPk, product.pk))
    .leftJoin(category, eq(category.pk, product.categoryPk))
    .leftJoin(brand, eq(brand.pk, product.brandPk))
    .where(and(statusFilter(product.recordStatus, mode), term ? productSearch(term) : undefined))
    .orderBy(asc(product.productCode));
  return rows.map((r) => ({
    sysCode: r.sysCode ?? '',
    mfgCode: r.mfgCode ?? '',
    name: r.name ?? '',
    nameEn: r.nameEn ?? '',
    nameCn: r.nameCn ?? '',
    onhand: r.onhand ?? 0,
    price: num(r.price),
    status: uiStatus(r.rs),
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
    movementSearch(term, true),
    f.doc ? ilike(stockMove.stockMoveNo, likeTerm(f.doc)) : undefined,
    f.ref ? refLike(likeTerm(f.ref)) : undefined,
    // รหัส / ชื่ออะไหล่ filter: the lines' part codes and names only
    movementSearch(f.code ?? '', false),
    from ? gte(stockMove.createDate, `${from} 00:00:00`) : undefined,
    to ? lte(stockMove.createDate, `${to} 23:59:59`) : undefined,
    f.type ? eq(stockMoveType.stockMoveTypeName, f.type) : undefined,
  );
}

const MOVE_SORT = {
  doc: stockMove.stockMoveNo,
  type: stockMoveType.stockMoveTypeName,
  ref: refNo,
  date: stockMove.createDate,
  by: appUser.firstName,
};

export async function pageMovements(p: PageQuery, f: MovementFilters): Promise<Page<Movement>> {
  const w = movementWhere({ ...f, q: p.q || f.q });
  const [counted, rows] = await Promise.all([
    db
      .select({ total: countFn() })
      .from(stockMove)
      .leftJoin(stockMoveType, eq(stockMoveType.stockMoveTypeId, stockMove.stockMoveTypeId))
      .where(w),
    db
      .select({
        doc: stockMove.stockMoveNo,
        type: stockMoveType.stockMoveTypeName,
        typeId: stockMove.stockMoveTypeId,
        ref: refNo,
        outTo: stockMove.referenceOutTo,
        date: stockMove.createDate,
        remark: stockMove.remark,
        byFirst: appUser.firstName,
        byLast: appUser.lastName,
        qty: movementQty,
        items: movementItems,
      })
      .from(stockMove)
      .leftJoin(stockMoveType, eq(stockMoveType.stockMoveTypeId, stockMove.stockMoveTypeId))
      .leftJoin(appUser, eq(appUser.pk, stockMove.createdByAppUserPk))
      .where(w)
      .orderBy(...orderByCols(p.sort, MOVE_SORT, [desc(stockMove.createDate), desc(stockMove.pk)]))
      .limit(p.pageSize)
      .offset(offsetOf(p)),
  ]);
  const wh = STORE_LOCATION_NAME;
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
const issuedQty = sql<string>`(case when ${stockMove.stockMoveTypeId} = ${sql.raw(String(INV.RETURN_FROM_JOB))} then -${stockMoveLine.itemQuantity} else ${stockMoveLine.itemQuantity} end)`;
/**
 * The unit price stored when the part went out: the job's part line (job_part, issue and
 * return reference the job no.) or the sale-order line (sale_order_line.retail_price). stock_move_line itself has
 * no price. 0 = not stored (warranty lines are often 0) → null, and the report falls back to today's price.
 */
const storedPrice = sql<string | null>`coalesce(
  (select l.spare_part_unit_price from job_part l
    where l.job_pk = ${stockMove.jobPk} and l.product_pk = ${stockMoveLine.productPk} and l.spare_part_unit_price > 0
    order by l.pk desc limit 1),
  (select s.retail_price from sale_order_line s
    where s.sale_order_pk = ${stockMove.saleOrderPk} and s.product_pk = ${stockMoveLine.productPk} and s.retail_price > 0
    order by s.pk desc limit 1))`;
const issuedValue = sql`${issuedQty} * coalesce(${storedPrice}, ${productStock.retailPrice}, 0)`;

function issuedWhere(q: string, f: IssuedFilters) {
  const code = (f.code || q).trim();
  const from = ymd(f.from),
    to = ymd(f.to);
  return and(
    inArray(stockMove.stockMoveTypeId, [INV.OUT_JOB, INV.OUT_SALE, INV.OUT_OTHER, INV.RETURN_FROM_JOB]),
    from ? gte(stockMove.createDate, `${from} 00:00:00`) : undefined,
    to ? lte(stockMove.createDate, `${to} 23:59:59`) : undefined,
    f.category ? eq(category.categoryName, f.category) : undefined,
    code
      ? or(
          ilike(product.productCode, likeTerm(code)),
          ilike(product.productName, likeTerm(code)),
          ilike(stockMove.stockMoveNo, likeTerm(code)),
        )
      : undefined,
  );
}

const issuedBase = () =>
  db
    .select({
      doc: stockMove.stockMoveNo,
      date: stockMove.createDate,
      type: stockMoveType.stockMoveTypeName,
      ref: refNo,
      code: product.productCode,
      item: product.productName,
      category: category.categoryName,
      qty: issuedQty,
      stored: storedPrice,
      today: productStock.retailPrice,
      byFirst: appUser.firstName,
      byLast: appUser.lastName,
    })
    .from(stockMoveLine)
    .innerJoin(stockMove, eq(stockMove.pk, stockMoveLine.stockMovePk))
    .leftJoin(stockMoveType, eq(stockMoveType.stockMoveTypeId, stockMove.stockMoveTypeId))
    .leftJoin(product, eq(product.pk, stockMoveLine.productPk))
    .leftJoin(category, eq(category.pk, product.categoryPk))
    .leftJoin(productStock, eq(productStock.productPk, product.pk))
    .leftJoin(appUser, eq(appUser.pk, stockMove.createdByAppUserPk));

function toIssued(r: Awaited<ReturnType<typeof issuedBase>>[number]) {
  const qty = num(r.qty);
  const price = r.stored != null ? num(r.stored) : num(r.today);
  return {
    doc: r.doc ?? '',
    date: fmtDateTime(r.date),
    type: r.type ?? '',
    ref: r.ref ?? '',
    by: fullName(r.byFirst, r.byLast),
    from: STORE_LOCATION_NAME,
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
    .from(stockMoveLine)
    .innerJoin(stockMove, eq(stockMove.pk, stockMoveLine.stockMovePk))
    .leftJoin(product, eq(product.pk, stockMoveLine.productPk))
    .leftJoin(category, eq(category.pk, product.categoryPk));

const ISSUED_SORT = {
  doc: stockMove.stockMoveNo,
  date: stockMove.createDate,
  type: stockMoveType.stockMoveTypeName,
  code: product.productCode,
  item: product.productName,
  qty: issuedQty,
  value: issuedValue,
  by: appUser.firstName,
};

export async function pageIssuedLines(p: PageQuery, f: IssuedFilters) {
  const w = issuedWhere(p.q, f);
  const [counted, rows] = await Promise.all([
    issuedCountBase().where(w),
    issuedBase()
      .where(w)
      .orderBy(...orderByCols(p.sort, ISSUED_SORT, [desc(stockMove.createDate), asc(stockMoveLine.pk)]))
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
    .from(stockMoveLine)
    .innerJoin(stockMove, eq(stockMove.pk, stockMoveLine.stockMovePk))
    .leftJoin(product, eq(product.pk, stockMoveLine.productPk))
    .leftJoin(category, eq(category.pk, product.categoryPk))
    .leftJoin(productStock, eq(productStock.productPk, product.pk))
    .where(w);
  if (!r) throw new Error('aggregate returned no row');
  const [top] = await db
    .select({ code: product.productCode, n: sql<string>`sum(${issuedQty})` })
    .from(stockMoveLine)
    .innerJoin(stockMove, eq(stockMove.pk, stockMoveLine.stockMovePk))
    .leftJoin(product, eq(product.pk, stockMoveLine.productPk))
    .leftJoin(category, eq(category.pk, product.categoryPk))
    .where(w)
    .groupBy(product.productCode)
    .orderBy(desc(sql`sum(${issuedQty})`), asc(product.productCode)) // a tie → the lowest code, every time
    .limit(1);
  return {
    lines: Number(r.lines),
    qty: num(r.qty),
    value: num(r.value),
    todayPriced: num(r.todayPriced),
    top: top?.code ?? '—',
  };
}
