import * as z from 'zod';
import { clean, cleanCode, maxNote, maxText, moneyField } from './index';
import { isFilled } from './job';

/**
 * Quotation rules (สร้าง / แก้ไขใบเสนอราคา) — payload = QuotationInput (quotation-form payload()).
 * `prevJobNo` = the job no the quotation has now (left out = a new quotation).
 *  - customer: always
 *  - job no J + 7 digits (the only * on the form): a new quotation needs one; an existing one that
 *    has one must keep one ("never worse"); an unchanged legacy value passes; the API also checks
 *    that the job exists
 *  - lines: qty a whole 1–9999, unit price money, detail ≤ 100, type SparePart / Service / Delivery, unit ≤ 10,
 *    discount money ≤ qty × price, discount % 0–100; service money; discount 0–100 % (บาท: money); VAT 0 or 7 %;
 *    contact ≤ 100; remark ≤ 1000 — nothing is cut off silently
 *  - a new quotation starts as รอเสนอราคา / เสนอราคาแล้ว (the customer answers a quotation that was sent)
 *  - no minimum number of lines (service-only / draft quotations exist)
 * Line errors are keyed "lines.<row>.qty" / "lines.<row>.unitPrice" (row = position on screen).
 */
export const JOB_NO_RE = /^J\d{7}$/;
/** quotation_dt.item_type values */
export const LINE_TYPES = ['SparePart', 'Service', 'Delivery'] as const;
/** the statuses a new quotation may start as */
export const NEW_QUOTATION_STATUSES = ['รอเสนอราคา', 'เสนอราคาแล้ว'];

/** a quotation line's own rules (discount ≤ the line's amount: quotationSchema, it needs qty and price) */
export const quotationLine = z.looseObject({
  detail: maxText(100, 'รายละเอียด'),
  qty: z
    .union([z.number(), z.string()])
    .refine((v) => /^\d+$/.test(String(v).trim()) && +v >= 1 && +v <= 9999, 'จำนวนต้องเป็นจำนวนเต็ม 1–9999'),
  unitPrice: moneyField('ราคา/หน่วย'),
  itemType: z
    .string()
    .optional()
    .refine(
      (v) => v === undefined || (LINE_TYPES as readonly string[]).includes(v),
      'ประเภทรายการต้องเป็น อะไหล่ / บริการ / ค่าขนส่ง',
    ),
  unit: maxText(10, 'หน่วย'),
  // the form and the print carry no per-line discount (none in the legacy data either): a value sent here would
  // be stored, then shown nowhere and zeroed by the next save from the form — the header discount is the one
  discount: moneyField('ส่วนลดรายการ').refine((v) => !Number(v), 'ส่วนลดรายรายการยังไม่รองรับ — ใช้ส่วนลดท้ายใบ'),
  discountPercent: z
    .union([z.number(), z.string()])
    .nullish()
    .refine((v) => v == null || v === '' || (Number(v) >= 0 && Number(v) <= 100), 'ส่วนลด % ต้องเป็นตัวเลข 0–100')
    .refine((v) => !Number(v), 'ส่วนลดรายรายการยังไม่รองรับ — ใช้ส่วนลดท้ายใบ'),
});

/** the fields' own rules (no stored quotation) — the API reads the body with these (src/server/contract) */
export const quotationFields = z.looseObject({
  contactName: maxText(100, 'ชื่อผู้ติดต่อ'),
  lines: z.array(quotationLine).optional(),
  serviceAmount: moneyField('ค่าบริการ'),
  discountValue: moneyField('ส่วนลด'), // ≤ 100 unless in บาท (legacy quotations carry บาท discounts)
  vatRate: z
    .union([z.number(), z.string()])
    .optional()
    .refine((v) => v === undefined || v === '' || [0, 7].includes(Number(v)), 'ภาษีมูลค่าเพิ่มต้องเป็น 0 หรือ 7 %'),
  remark: maxNote(1000, 'หมายเหตุ'),
  approveRemark: maxText(100, 'หมายเหตุการตอบรับ'),
});

export function quotationSchema(prevJobNo?: string | null) {
  const jobRequired = prevJobNo == null || !!clean(prevJobNo);
  return (
    quotationFields
      // required checks here, not on the fields: a missing key must not stop the other rules
      .superRefine((v, ctx) => {
        if (v.discountUnit !== 'บาท' && Number(v.discountValue) > 100)
          ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'ส่วนลดต้องไม่เกิน 100' });
        (Array.isArray(v.lines) ? v.lines : []).forEach((l: Record<string, unknown>, k: number) => {
          // in satang: 0.1 + 0.2 style float error must not refuse a discount of exactly the line's amount
          if (Math.round(Number(l.discount) * 100) > Math.round(Number(l.qty) * Number(l.unitPrice) * 100))
            ctx.addIssue({
              code: 'custom',
              path: ['lines', k, 'discount'],
              message: 'ส่วนลดต้องไม่เกินราคารวมของรายการ',
            });
        });
        if (prevJobNo === undefined && clean(v.status) && !NEW_QUOTATION_STATUSES.includes(clean(v.status)))
          ctx.addIssue({
            code: 'custom',
            path: ['status'],
            message: 'ใบเสนอราคาใหม่ต้องเริ่มที่ "รอเสนอราคา" หรือ "เสนอราคาแล้ว"',
          });
        if (!isFilled(v.customerCode))
          ctx.addIssue({ code: 'custom', path: ['customerCode'], message: 'ต้องเลือกลูกค้า' });
        const jobNo = cleanCode(v.jobNo);
        if (!jobNo) {
          if (jobRequired)
            ctx.addIssue({ code: 'custom', path: ['jobNo'], message: 'ต้องระบุหมายเลขงานซ่อมที่อ้างถึง' });
        } else if (!JOB_NO_RE.test(jobNo) && jobNo !== cleanCode(prevJobNo)) {
          ctx.addIssue({
            code: 'custom',
            path: ['jobNo'],
            message: 'รูปแบบหมายเลขงานไม่ถูกต้อง (J + ตัวเลข 7 หลัก เช่น J2612164)',
          });
        }
      })
  );
}

/**
 * quotation_hd discount_type + discount_formula ("10%", legacy "200บาท") → the form's discount, kept
 * as the record has it (unit and base: total / parts / service). None → 0 % on the total.
 */
export function parseDiscount(type: string, formula: string): { type: string; value: number; unit: '%' | 'บาท' } {
  const m = type !== 'ไม่มีส่วนลด' ? formula.trim().match(/^([\d.]+)\s*(%|บาท)$/) : null;
  return m
    ? { type, value: Number(m[1]), unit: m[2] === 'บาท' ? 'บาท' : '%' }
    : { type: 'ส่วนลดรวม', value: 0, unit: '%' };
}

/** `rate` % of `amount`, half a satang rounded up — on whole satang × hundredths of a percent, so 15 % of
 *  33.30 is 5.00, not the 4.99 a float product (499.4999…) rounds to */
const percentOf = (amount: number, rate: number) =>
  Math.round((Math.round(amount * 100) * Math.round(rate * 100)) / 10_000) / 100;

/**
 * Amount rules reverse-engineered from quotation_hd columns — the server stores these and the print
 * shows the stored values, so the form previews with the same function.
 */
export function computeTotals(i: {
  parts: number;
  service: number;
  /** Delivery lines (SVD0001) — legacy keeps them out of spare_part_amount but inside sum_exclude_amount */
  delivery?: number;
  discountType: string;
  discountValue: number;
  discountUnit: 'บาท' | '%';
  vatRate: number;
}) {
  const sumExclude = i.parts + i.service + (i.delivery ?? 0);
  let baseForDiscount = sumExclude;
  if (i.discountType === 'ส่วนลดค่าบริการ') baseForDiscount = i.service;
  else if (i.discountType === 'ส่วนลดค่าอะไหล่') baseForDiscount = i.parts;
  else if (i.discountType === 'ไม่มีส่วนลด') baseForDiscount = 0;
  const discount =
    i.discountType === 'ไม่มีส่วนลด'
      ? 0
      : i.discountUnit === '%'
        ? percentOf(baseForDiscount, i.discountValue)
        : Math.min(i.discountValue, baseForDiscount);
  const afterDiscount = sumExclude - discount;
  const totalBase = afterDiscount;
  const vat = percentOf(totalBase, i.vatRate);
  const total = totalBase + vat;
  const net = Math.round(total * 100) / 100;
  const rounding = Math.round((net - total) * 100) / 100;
  return { sumExclude, discount, afterDiscount, totalBase, vat, total, rounding, net };
}

/**
 * The job's parts the technician ticked "เสนอ" in the repair screen → quotation lines, from the set
 * the quotation is for: type A = set A (is_quotation / request_qty), type B = set B (is_quotation_b /
 * request_qty_b).
 */
export function quotedParts(
  parts: {
    code: string;
    name: string;
    unitPrice: number;
    isQuotation: boolean;
    requested: number;
    isQuotationB: boolean;
    requestQtyB: number;
  }[],
  type: 'A' | 'B',
) {
  return parts
    .map((p) =>
      type === 'B'
        ? { code: p.code, name: p.name, price: p.unitPrice, qty: p.isQuotationB ? p.requestQtyB : 0 }
        : { code: p.code, name: p.name, price: p.unitPrice, qty: p.isQuotation ? p.requested : 0 },
    )
    .filter((l) => l.qty > 0);
}

/** the job's quoted parts as one string — the new-quotation form sends the one it copied (jobParts), the server
 *  compares it with the job's parts now (they changed → 409) */
export const quotedPartsKey = (parts: Parameters<typeof quotedParts>[0], type: 'A' | 'B') =>
  quotedParts(parts, type)
    .map((p) => `${p.code}×${p.qty}@${p.price}`)
    .join('|');
