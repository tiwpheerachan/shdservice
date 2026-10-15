import { z } from 'zod';
import { isFilled } from './job';

/**
 * Quotation rules (สร้าง / แก้ไขใบเสนอราคา) — payload = QuotationInput (quotation-form payload()).
 *  - customer: always
 *  - job no (the only * on the form): a new quotation needs one; an existing one that has one must
 *    keep one ("never worse"); the API also checks that the job exists
 *  - numbers: qty > 0, prices / service not negative, discount and VAT 0–100 %
 *  - no minimum number of lines (service-only / draft quotations exist)
 * Line errors are keyed "lines.<row>.qty" / "lines.<row>.unitPrice" (row = position on screen).
 */
const JOB_NO = /^[A-Z]{1,6}\d{5,}$/i;
const amount = (field: string, max?: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .refine((v) => v === undefined || v === '' || Number.isFinite(Number(v)), `${field}ต้องเป็นตัวเลข`)
    .refine((v) => v === undefined || v === '' || Number(v) >= 0, `${field}ต้องไม่ติดลบ`)
    .refine((v) => max === undefined || v === undefined || v === '' || Number(v) <= max, `${field}ต้องไม่เกิน ${max}`);

export function quotationSchema(jobRequired = true) {
  return (
    z
      .looseObject({
        customerCode: z.string().optional(),
        jobNo: z.string().optional(),
        lines: z
          .array(
            z.looseObject({
              qty: z.union([z.number(), z.string()]).refine((v) => Number(v) > 0, 'จำนวนต้องมากกว่า 0'),
              unitPrice: amount('ราคา/หน่วย'),
            }),
          )
          .optional(),
        serviceAmount: amount('ค่าบริการ'),
        discountValue: amount('ส่วนลด'), // ≤ 100 unless in บาท (legacy quotations carry บาท discounts)
        vatRate: amount('ภาษีมูลค่าเพิ่ม', 100),
      })
      // required checks here, not on the fields: a missing key must not stop the other rules
      .superRefine((v, ctx) => {
        if (v.discountUnit !== 'บาท' && Number(v.discountValue) > 100)
          ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'ส่วนลดต้องไม่เกิน 100' });
        if (!isFilled(v.customerCode))
          ctx.addIssue({ code: 'custom', path: ['customerCode'], message: 'ต้องเลือกลูกค้า' });
        if (!isFilled(v.jobNo)) {
          if (jobRequired)
            ctx.addIssue({ code: 'custom', path: ['jobNo'], message: 'ต้องระบุหมายเลขงานซ่อมที่อ้างถึง' });
        } else if (!JOB_NO.test(String(v.jobNo).trim())) {
          ctx.addIssue({ code: 'custom', path: ['jobNo'], message: 'รูปแบบหมายเลขงานไม่ถูกต้อง (เช่น J2612164)' });
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
