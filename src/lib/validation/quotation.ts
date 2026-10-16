import { z } from 'zod';
import { clean, cleanCode, maxNote, maxText, moneyField } from './index';
import { isFilled } from './job';

/**
 * Quotation rules (สร้าง / แก้ไขใบเสนอราคา) — payload = QuotationInput (quotation-form payload()).
 * `prevJobNo` = the job no the quotation has now (left out = a new quotation).
 *  - customer: always
 *  - job no J + 7 digits (the only * on the form): a new quotation needs one; an existing one that
 *    has one must keep one ("never worse"); an unchanged legacy value passes; the API also checks
 *    that the job exists
 *  - lines: qty a whole 1–9999, unit price money, detail ≤ 100; service money; discount 0–100 %
 *    (บาท: money); VAT 0 or 7 %; contact ≤ 100; remark ≤ 1000 — nothing is cut off silently
 *  - no minimum number of lines (service-only / draft quotations exist)
 * Line errors are keyed "lines.<row>.qty" / "lines.<row>.unitPrice" (row = position on screen).
 */
export const JOB_NO_RE = /^J\d{7}$/;
const amount = (field: string) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .refine((v) => v === undefined || v === '' || Number.isFinite(Number(v)), `${field}ต้องเป็นตัวเลข`)
    .refine((v) => v === undefined || v === '' || Number(v) >= 0, `${field}ต้องไม่ติดลบ`);

/** a quotation line's own rules */
export const quotationLine = z.looseObject({
  detail: maxText(100, 'รายละเอียด'),
  qty: z
    .union([z.number(), z.string()])
    .refine((v) => /^\d+$/.test(String(v).trim()) && +v >= 1 && +v <= 9999, 'จำนวนต้องเป็นจำนวนเต็ม 1–9999'),
  unitPrice: moneyField('ราคา/หน่วย'),
});

/** the fields' own rules (no stored quotation) — the API reads the body with these (src/server/contract) */
export const quotationFields = z.looseObject({
  contactName: maxText(100, 'ชื่อผู้ติดต่อ'),
  lines: z.array(quotationLine).optional(),
  serviceAmount: moneyField('ค่าบริการ'),
  discountValue: amount('ส่วนลด'), // ≤ 100 unless in บาท (legacy quotations carry บาท discounts)
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
        if (v.discountUnit === 'บาท' && Number(v.discountValue) > 1_000_000)
          ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'ส่วนลดต้องไม่เกิน 1,000,000 บาท' });
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
        ? Math.round(baseForDiscount * i.discountValue) / 100
        : Math.min(i.discountValue, baseForDiscount);
  const afterDiscount = sumExclude - discount;
  const totalBase = afterDiscount;
  const vat = Math.round(totalBase * i.vatRate) / 100;
  const total = totalBase + vat;
  const net = Math.round(total * 100) / 100;
  const rounding = Math.round((net - total) * 100) / 100;
  return { sumExclude, discount, afterDiscount, totalBase, vat, total, rounding, net };
}

/**
 * The job's parts the technician ticked "เสนอ" in the repair screen → quotation lines, from the set
 * the quotation is for: type A = set A (is_quotation / request_qty), type B = set B (is_quotation_b /
 * request_qty_b). Type B used to take set A's lines, so a B quotation never counted the B lines.
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
