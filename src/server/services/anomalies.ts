import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '@/db/client';
import {
  job,
  jobPart,
  product,
  productStock,
  quotation,
  quotationLine,
  saleOrder,
  saleOrderLine,
  stockMove,
  stockMoveLine,
  stockMoveType,
} from '@/db/schema';
import { cached } from '@/server/cache';
import { RS } from '@/server/record-status';
import { num } from '@/server/mappers/format';
import { PART } from '@/lib/status-ids';
import { offsetOf, type PageQuery } from '@/server/paging';

/**
 * ค่าที่ไม่สมเหตุสมผล — System Admin's section of the bell (+ /admin/anomalies): stored money / quantity that does not
 * add up by the app's OWN formulas. Report only: nothing here (or anywhere) rewrites a stored value. All checks are
 * ONE UNION ALL: counts + the bell sample cached 5 min; a list page is LIMIT/OFFSET in SQL, run live.
 *
 * The formulas are the ones the code writes with — nothing invented:
 *  - quotation: spare_part_amount = Σ non-Delivery line total_price; sum_exclude_amount = Σ every line
 *    total_price + service_amount (quotations.ts saveQuotation → computeTotals). Discount / VAT steps not checked.
 *  - sale_order: total_base_amount = Σ line amount; net_amount = total_base + fee_amount (sale-orders.ts save)
 *  - job: spare_part_total_cost = Σ spare_part_total_price of ticked-เบิก, not cancelled lines (stock.ts
 *    partsTotalOf); job_total_cost = parts + service + tool + delivery + box (jobs.ts withTotal) — the
 *    legacy rows that added 7% VAT show up here, as they should
 *  - product_stock: remain < 0; remain vs Σ stock_move_line qty × stock_move_type.movement_action; booking vs
 *    the open requests (status เบิก, ticked เบิก: request − granted) — legacy never booked them, so both
 *    numbers are shown without a verdict
 *  - a charged line at price 0 (job_part: เบิก + เสนอ = partCharge; every quotation / sale order line),
 *    a quotation line discount over its qty × price
 * Deleted / cancelled documents and jobs are left out (their money no longer counts).
 */
export const ANOMALY_CATEGORIES = {
  quotation_total: 'ยอดใบเสนอราคาไม่ตรงกับรายการ',
  sale_order_total: 'ยอดใบสั่งขายไม่ตรงกับรายการ',
  job_parts_total: 'ค่าอะไหล่ของงานไม่ตรงกับรายการเบิก',
  job_total: 'รวมเป็นเงินสุทธิของงานไม่ตรงกับค่าใช้จ่าย',
  stock_negative: 'สต๊อกคงเหลือติดลบ',
  stock_moves: 'สต๊อกคงเหลือไม่ตรงกับเอกสารรับ-จ่าย',
  stock_booking: 'ยอดจองไม่ตรงกับคำขอเบิกค้าง',
  zero_price: 'รายการคิดเงินราคา 0',
  discount_over: 'ส่วนลดเกินยอดเงิน',
} as const;
export type AnomalyCategory = keyof typeof ANOMALY_CATEGORIES;
export const ANOMALY_KEYS = Object.keys(ANOMALY_CATEGORIES) as AnomalyCategory[];

export type Anomaly = {
  category: AnomalyCategory;
  /** document no. / job no. / product code — what is shown */
  ref: string;
  /** Thai, with the two numbers */
  message: string;
  /** the stored value and what it should add up to (the expected one for a one-number check = 0) */
  stored: number;
  expected: number;
  /** the record's page, by its uuid */
  href: string;
};
export type AnomalyCounts = { total: number; categories: { key: AnomalyCategory; label: string; count: number }[] };
/** the bell: the counts + the first few of each category */
export type Anomalies = AnomalyCounts & { items: Anomaly[] };
/** /admin/anomalies: one page of one category (or all) — `total` = the rows matching, from the cached counts */
export type AnomalyPage = AnomalyCounts & { rows: Anomaly[]; matched: number; page: number; pageSize: number };

const BELL_PER_CATEGORY = 2;
const TTL = 5 * 60_000;
const notDeleted = (c: AnyPgColumn) => sql`${c} <> ${RS.DELETED}`;
const r2 = (v: SQL) => sql`round(coalesce(${v}, 0), 2)`;
const baht = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: number) => v.toLocaleString('en-US');
const link = {
  job: (id: string) => `/jobs/repair?id=${id}`,
  quotation: (id: string) => `/quotation/edit?id=${id}`,
  saleOrder: (id: string) => `/sale/orders/edit?id=${id}`,
  product: (id: string) => `/stock/products?id=${id}`,
};
const code = (k: string | null) => k || 'ไม่มีรหัส';

/** each check: its category, the record's page, the message — and its query (id, ref, a = stored, b = expected, k, ord) */
type Check = {
  category: AnomalyCategory;
  href: (id: string) => string;
  say: (a: number, b: number, k: string | null) => string;
  q: SQL;
};

const qLines = sql`(select ${quotationLine.quotationPk} as qpk,
    sum(coalesce(${quotationLine.totalPrice}, 0)) filter (where coalesce(${quotationLine.itemType}, 'SparePart') <> 'Delivery') as parts,
    sum(coalesce(${quotationLine.totalPrice}, 0)) as lines
  from ${quotationLine} group by ${quotationLine.quotationPk})`;
const soLines = sql`(select ${saleOrderLine.saleOrderPk} as spk, sum(coalesce(${saleOrderLine.amount}, 0)) as lines
  from ${saleOrderLine} group by ${saleOrderLine.saleOrderPk})`;
const jobParts = sql`(select ${jobPart.jobPk} as jpk, sum(${jobPart.sparePartTotalPrice}) as parts from ${jobPart}
  where ${jobPart.isSpecial} and ${jobPart.jobPartStatusId} <> ${PART.CANCELLED} group by ${jobPart.jobPk})`;
const jobRest = sql`coalesce(${job.serviceCost}, 0) + coalesce(${job.serviceToolCost}, 0) + coalesce(${job.deliveryCost}, 0) + coalesce(${job.cartonBoxCost}, 0)`;
const moves = sql`(select ${stockMoveLine.productPk} as ppk,
    sum(coalesce(${stockMoveLine.itemQuantity}, 0) * coalesce(${stockMoveType.movementAction}, 0)) as net
  from ${stockMoveLine}
  join ${stockMove} on ${stockMove.pk} = ${stockMoveLine.stockMovePk}
  join ${stockMoveType} on ${stockMoveType.stockMoveTypeId} = ${stockMove.stockMoveTypeId}
  group by ${stockMoveLine.productPk})`;
const booked = sql`(select ${jobPart.productPk} as ppk, sum(coalesce(${jobPart.requestQty}, 0) - coalesce(${jobPart.grantQty}, 0)) as open
  from ${jobPart} where ${jobPart.isSpecial} and ${jobPart.jobPartStatusId} = ${PART.REQUESTED}
  group by ${jobPart.productPk})`;
const remain = sql`coalesce(${productStock.quantityRemain}, 0)`;
const stockFrom = sql`from ${productStock} join ${product} on ${product.pk} = ${productStock.productPk}`;
/** a line's code as printed: its product's (item_code / product_code are NULL on new lines), else the legacy /
 *  service text (a quotation line without one: its detail) */
const productCodeOf = (pk: AnyPgColumn) =>
  sql`(select ${product.productCode} from ${product} where ${product.pk} = ${pk})`;
const qLineCode = sql`coalesce(${productCodeOf(quotationLine.productPk)}, nullif(${quotationLine.itemCode}, ''), ${quotationLine.itemDetail})`;
const soLineCode = sql`coalesce(${productCodeOf(saleOrderLine.productPk)}, ${saleOrderLine.productCode})`;

const CHECKS: Check[] = [
  {
    category: 'quotation_total',
    href: link.quotation,
    say: (a, b) => `ยอดอะไหล่ ${baht(a)} ≠ รวมรายการ ${baht(b)}`,
    q: sql`select ${quotation.id}, ${quotation.quotationNo}, ${quotation.sparePartAmount}, coalesce(l.parts, 0), null, ${quotation.pk}
      from ${quotation} left join ${qLines} l on l.qpk = ${quotation.pk}
      where ${notDeleted(quotation.recordStatus)} and ${r2(sql`${quotation.sparePartAmount}`)} <> ${r2(sql`l.parts`)}`,
  },
  {
    category: 'quotation_total',
    href: link.quotation,
    say: (a, b) => `ยอดรวมก่อนส่วนลด ${baht(a)} ≠ รวมรายการ + ค่าบริการ ${baht(b)}`,
    q: sql`select ${quotation.id}, ${quotation.quotationNo}, ${quotation.sumExcludeAmount},
        coalesce(l.lines, 0) + coalesce(${quotation.serviceAmount}, 0), null, ${quotation.pk}
      from ${quotation} left join ${qLines} l on l.qpk = ${quotation.pk}
      where ${notDeleted(quotation.recordStatus)}
        and ${r2(sql`${quotation.sumExcludeAmount}`)} <> ${r2(sql`coalesce(l.lines, 0) + coalesce(${quotation.serviceAmount}, 0)`)}`,
  },
  {
    category: 'sale_order_total',
    href: link.saleOrder,
    say: (a, b) => `ยอดรวม ${baht(a)} ≠ รวมรายการ ${baht(b)}`,
    q: sql`select ${saleOrder.id}, ${saleOrder.saleOrderNo}, ${saleOrder.totalBaseAmount}, coalesce(l.lines, 0), null, ${saleOrder.pk}
      from ${saleOrder} left join ${soLines} l on l.spk = ${saleOrder.pk}
      where ${notDeleted(saleOrder.recordStatus)} and ${r2(sql`${saleOrder.totalBaseAmount}`)} <> ${r2(sql`l.lines`)}`,
  },
  {
    category: 'sale_order_total',
    href: link.saleOrder,
    say: (a, b) => `ยอดสุทธิ ${baht(a)} ≠ รวมรายการ + ค่าธรรมเนียม ${baht(b)}`,
    q: sql`select ${saleOrder.id}, ${saleOrder.saleOrderNo}, ${saleOrder.netAmount},
        coalesce(l.lines, 0) + coalesce(${saleOrder.feeAmount}, 0), null, ${saleOrder.pk}
      from ${saleOrder} left join ${soLines} l on l.spk = ${saleOrder.pk}
      where ${notDeleted(saleOrder.recordStatus)}
        and ${r2(sql`${saleOrder.netAmount}`)} <> ${r2(sql`coalesce(l.lines, 0) + coalesce(${saleOrder.feeAmount}, 0)`)}`,
  },
  {
    category: 'job_parts_total',
    href: link.job,
    say: (a, b) => `ค่าอะไหล่ ${baht(a)} ≠ รวมอะไหล่ที่เบิก (คิดเงิน) ${baht(b)}`,
    q: sql`select ${job.id}, ${job.jobNo}, ${job.sparePartTotalCost}, coalesce(p.parts, 0), null, ${job.pk}
      from ${job} left join ${jobParts} p on p.jpk = ${job.pk}
      where ${notDeleted(job.recordStatus)} and ${r2(sql`${job.sparePartTotalCost}`)} <> ${r2(sql`p.parts`)}`,
  },
  {
    category: 'job_total',
    href: link.job,
    say: (a, b) => `รวมเป็นเงินสุทธิ ${baht(a)} ≠ อะไหล่ + บริการ + เครื่องมือ + ส่ง + กล่อง ${baht(b)}`,
    q: sql`select ${job.id}, ${job.jobNo}, ${job.jobTotalCost}, coalesce(${job.sparePartTotalCost}, 0) + ${jobRest}, null, ${job.pk}
      from ${job}
      where ${notDeleted(job.recordStatus)}
        and ${r2(sql`${job.jobTotalCost}`)} <> ${r2(sql`coalesce(${job.sparePartTotalCost}, 0) + ${jobRest}`)}`,
  },
  {
    category: 'stock_negative',
    href: link.product,
    say: (a) => `คงเหลือ ${qty(a)} (ติดลบ)`,
    q: sql`select ${product.id}, ${product.productCode}, ${remain}, 0, null, ${product.pk} ${stockFrom} where ${remain} < 0`,
  },
  {
    category: 'stock_moves',
    href: link.product,
    say: (a, b) => `คงเหลือ ${qty(a)} ≠ รับเข้า − จ่ายออกตามเอกสาร ${qty(b)}`,
    q: sql`select ${product.id}, ${product.productCode}, ${remain}, coalesce(m.net, 0), null, ${product.pk}
      ${stockFrom} left join ${moves} m on m.ppk = ${productStock.productPk}
      where ${remain} <> coalesce(m.net, 0)`,
  },
  {
    category: 'stock_booking',
    href: link.product,
    say: (a, b) => `จองไว้ ${qty(a)} · คำขอเบิกค้าง ${qty(b)}`,
    q: sql`select ${product.id}, ${product.productCode}, ${productStock.quantityBooking}, coalesce(o.open, 0), null, ${product.pk}
      ${stockFrom} left join ${booked} o on o.ppk = ${productStock.productPk}
      where ${productStock.quantityBooking} <> coalesce(o.open, 0)`,
  },
  {
    category: 'zero_price',
    href: link.job,
    say: (a, _b, k) => `${code(k)} จำนวน ${qty(a)} ราคา 0 บาท`,
    q: sql`select ${job.id}, ${job.jobNo}, ${jobPart.requestQty}, 0, ${product.productCode}, ${job.pk}
      from ${jobPart} join ${job} on ${job.pk} = ${jobPart.jobPk} left join ${product} on ${product.pk} = ${jobPart.productPk}
      where ${jobPart.isSpecial} and ${jobPart.isQuotation} and ${jobPart.requestQty} > 0
        and ${jobPart.jobPartStatusId} <> ${PART.CANCELLED} and coalesce(${jobPart.sparePartUnitPrice}, 0) = 0
        and ${notDeleted(job.recordStatus)}`,
  },
  {
    category: 'zero_price',
    href: link.quotation,
    say: (a, _b, k) => `${code(k)} จำนวน ${qty(a)} ราคา 0 บาท`,
    q: sql`select ${quotation.id}, ${quotation.quotationNo}, ${quotationLine.quantity}, 0, ${qLineCode}, ${quotation.pk}
      from ${quotationLine} join ${quotation} on ${quotation.pk} = ${quotationLine.quotationPk}
      where ${quotationLine.quantity} > 0 and coalesce(${quotationLine.unitPrice}, 0) = 0 and ${notDeleted(quotation.recordStatus)}`,
  },
  {
    category: 'zero_price',
    href: link.saleOrder,
    say: (a, _b, k) => `${code(k)} จำนวน ${qty(a)} ราคา 0 บาท`,
    q: sql`select ${saleOrder.id}, ${saleOrder.saleOrderNo}, ${saleOrderLine.saleOutQuantity}, 0, ${soLineCode}, ${saleOrder.pk}
      from ${saleOrderLine} join ${saleOrder} on ${saleOrder.pk} = ${saleOrderLine.saleOrderPk}
      where ${saleOrderLine.saleOutQuantity} > 0 and coalesce(${saleOrderLine.saleOutPrice}, 0) = 0
        and ${notDeleted(saleOrder.recordStatus)}`,
  },
  {
    category: 'discount_over',
    href: link.quotation,
    say: (a, b, k) => `${code(k)} ส่วนลด ${baht(a)} > จำนวน × ราคา ${baht(b)}`,
    q: sql`select ${quotation.id}, ${quotation.quotationNo}, ${quotationLine.unitPriceDiscount},
        coalesce(${quotationLine.quantity}, 0) * coalesce(${quotationLine.unitPrice}, 0), ${qLineCode}, ${quotation.pk}
      from ${quotationLine} join ${quotation} on ${quotation.pk} = ${quotationLine.quotationPk}
      where coalesce(${quotationLine.unitPriceDiscount}, 0)
          > coalesce(${quotationLine.quantity}, 0) * coalesce(${quotationLine.unitPrice}, 0)
        and ${notDeleted(quotation.recordStatus)}`,
  },
];

/**
 * Every check as one relation: (c = index in CHECKS, cat = category order, id, ref, a, b, k, ord = the record's pk).
 * Only the checks of `category` when given — the others are not even planned.
 */
function all(category?: AnomalyCategory) {
  const parts = CHECKS.flatMap((c, i) =>
    category && c.category !== category
      ? []
      : [
          sql`select ${sql.raw(String(i))} as c, ${sql.raw(String(ANOMALY_KEYS.indexOf(c.category)))} as cat, t.*
            from (${c.q}) as t(id, ref, a, b, k, ord)`,
        ],
  );
  return sql`(${sql.join(
    parts.map((p) => sql`(${p})`),
    sql` union all `,
  )}) u`;
}

type Row = {
  c: number;
  id: string;
  ref: string | null;
  a: string | number | null;
  b: string | number | null;
  k: string | null;
};
function toItem(r: Row): Anomaly {
  const c = CHECKS[r.c]!;
  const stored = num(r.a);
  const expected = num(r.b);
  return {
    category: c.category,
    ref: (r.ref ?? '').trim(),
    message: c.say(stored, expected, r.k),
    stored,
    expected,
    href: c.href(r.id),
  };
}
const ORDER = sql`order by cat, ord desc, c, k`;

/** counts by category + the bell's first BELL_PER_CATEGORY of each — the 5-min cache (a few KB) */
function summary(): Promise<Anomalies> {
  return cached('alerts:anomalies', TTL, async () => {
    const [counts, sample] = await Promise.all([
      db.execute<{ cat: number; n: number }>(sql`select cat, count(*)::int as n from ${all()} group by cat`),
      db.execute<Row>(sql`select * from (select u.*, row_number() over (partition by cat order by ord desc, c, k) as rn
        from ${all()}) x where rn <= ${BELL_PER_CATEGORY} ${ORDER}`),
    ]);
    const n = new Map(counts.rows.map((r) => [Number(r.cat), Number(r.n)]));
    const categories = ANOMALY_KEYS.map((key, i) => ({ key, label: ANOMALY_CATEGORIES[key], count: n.get(i) ?? 0 }));
    return {
      total: categories.reduce((s, c) => s + c.count, 0),
      categories,
      items: sample.rows.map(toItem),
    };
  });
}

/** The bell (System Admin only — the route checks). */
export const anomalies = summary;

/** One page of /admin/anomalies, the category filtered in SQL; run live (admin only, ~100 ms), never cached. */
export async function anomalyPage(p: PageQuery, category?: AnomalyCategory): Promise<AnomalyPage> {
  const [{ total, categories }, rows] = await Promise.all([
    summary(),
    db.execute<Row>(sql`select * from ${all(category)} ${ORDER} limit ${p.pageSize} offset ${offsetOf(p)}`),
  ]);
  const matched = category ? (categories.find((c) => c.key === category)?.count ?? 0) : total;
  return { total, categories, rows: rows.rows.map(toItem), matched, page: p.page, pageSize: p.pageSize };
}
