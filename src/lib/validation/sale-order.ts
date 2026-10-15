import { z } from 'zod';
import { maxText, moneyField, trackingField } from './index';
import { isFilled } from './job';
import { PAYMENT_METHODS } from '@/data/mock';

export { cleanTracking, trackingField } from './index'; // shared with job reception / return tracking

/**
 * Sale order rules (สร้าง / แก้ไขใบสั่งขาย) — payload = SaleOrderInput (sale-order-form payload()).
 * `prev` = the order being edited (an unchanged legacy payment type / tracking no still passes).
 *  - customer, salesperson (prefilled with the signed-in user) and at least one product line
 *  - qty a whole number 1–1000, prices money (≤ 1,000,000), the paid amount ≤ 10,000,000
 *    (payment_amount numeric(11,2) — 1e9 used to fail the save as a 500)
 *  - payment type from the list; remark ≤ 100 (the column — nothing is cut off silently)
 * Line errors are keyed "lines.<row>.qty" / "lines.<row>.price" (row = position on screen).
 */
export function saleOrderSchema(prev?: { paymentType?: string | null; tracking?: string | null } | null) {
  return (
    z
      .looseObject({
        customerCode: z.string().optional(),
        salesId: z.union([z.number(), z.string()]).optional(),
        lines: z
          .array(
            z.looseObject({
              code: z.string().optional(),
              qty: z
                .union([z.number(), z.string()])
                .refine(
                  (v) => /^\d+$/.test(String(v).trim()) && +v >= 1 && +v <= 1000,
                  'จำนวนต้องเป็นจำนวนเต็ม 1–1000',
                ),
              price: moneyField('ราคา'),
            }),
          )
          .optional(),
        paymentType: z
          .string()
          .nullish()
          .refine(
            (v) => !v?.trim() || PAYMENT_METHODS.includes(v.trim()) || v.trim() === prev?.paymentType?.trim(),
            'วิธีชำระเงินไม่ถูกต้อง',
          ),
        paymentAmount: moneyField('จำนวนเงินที่ชำระ', 10_000_000),
        fee: moneyField('ค่าธรรมเนียม'),
        remark: maxText(100, 'หมายเหตุ'),
        tracking: trackingField(prev?.tracking),
      })
      // required checks here, not on the fields: a missing key must not stop the other rules
      .superRefine((v, ctx) => {
        if (!isFilled(v.customerCode))
          ctx.addIssue({ code: 'custom', path: ['customerCode'], message: 'ต้องเลือกลูกค้า' });
        if (!(Number(v.salesId) > 0) || !Number.isInteger(Number(v.salesId)))
          ctx.addIssue({ code: 'custom', path: ['salesId'], message: 'ต้องเลือกพนักงานขาย' });
        if (!(v.lines ?? []).some((l) => isFilled(l.code)))
          ctx.addIssue({ code: 'custom', path: ['lines'], message: 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ' });
      })
  );
}
