import { z } from 'zod';
import { maxText, moneyField, trackingField } from './index';
import { isFilled } from './job';
import { PAYMENT_METHODS } from '@/data/options';
import { noRight } from '@/lib/modules';

export { cleanTracking, trackingField } from './index'; // shared with job reception / return tracking

const num = (v: unknown) => Number(v) || 0;

/** approval refused to the order's own people (System Admin may) — the page says the same */
export const SELF_APPROVE = 'คุณเป็นผู้สร้างใบสั่งขายนี้ อนุมัติเองไม่ได้ — ให้ผู้มีสิทธิ์อนุมัติคนอื่นทำ';
export const SELF_APPROVE_SALES = 'คุณเป็นพนักงานขายของใบนี้ อนุมัติเองไม่ได้ — ให้ผู้มีสิทธิ์อนุมัติคนอื่นทำ';
/** who may approve / deny / send back a sale order: the special right SO Approve — not any Sale Order edit grant */
export const NOT_APPROVER = noRight('SO Approve');
/** only who keyed the order in (document_create_by) sends it for approval (System Admin may) */
export const SUBMIT_CREATOR_ONLY = 'ส่งขออนุมัติได้เฉพาะผู้สร้างใบสั่งขาย';
/** a waiting (2) order: only its creator (or System Admin) edits it (owner decision) — the page is read-only for others */
export const WAITING_CREATOR_ONLY =
  'ใบสั่งขายที่รออนุมัติแก้ได้เฉพาะผู้สร้าง — ถ้าต้องแก้ ให้ผู้อนุมัติกด ส่งกลับแก้ไข';
export const SO_CANCELLED = 'ใบสั่งขายนี้ถูกยกเลิกแล้ว';
export const overpaidMessage = (total: number) =>
  `จำนวนเงินที่ชำระมากกว่ายอดรวม (${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท)`;

/**
 * Sale order rules (สร้าง / แก้ไขใบสั่งขาย) — payload = SaleOrderInput (sale-order-form payload()).
 * `prev` = the order being edited (an unchanged legacy payment type / tracking no still passes).
 *  - customer, salesperson (prefilled with the signed-in user) and at least one product line
 *  - qty a whole number 1–1000, prices money (≤ 1,000,000), the paid amount ≤ 10,000,000
 *    (payment_amount numeric(11,2) — 1e9 used to fail the save as a 500)
 *  - payment type from the list; no default type or amount (nothing paid until the user says so);
 *    an amount needs its type and may not exceed the lines' total + `prev.fee` (the server re-checks the net)
 *  - remark ≤ 100 (the column — nothing is cut off silently)
 * Line errors are keyed "lines.<row>.qty" / "lines.<row>.price" (row = position on screen).
 */
export function saleOrderSchema(
  prev?: { paymentType?: string | null; tracking?: string | null; fee?: number | null } | null,
) {
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
        const paid = num(v.paymentAmount);
        if (paid > 0 && !v.paymentType?.trim())
          ctx.addIssue({ code: 'custom', path: ['paymentType'], message: 'เลือกวิธีชำระเงิน' });
        // a line without a price takes the product's price on the server — only the server knows that total
        const lines = (v.lines ?? []).filter((l) => isFilled(l.code));
        if (lines.every((l) => l.price != null && l.price !== '')) {
          const total =
            lines.reduce((s, l) => s + Math.round(num(l.qty) * num(l.price) * 100) / 100, 0) + num(v.fee ?? prev?.fee);
          if (paid > Math.round(total * 100) / 100)
            ctx.addIssue({ code: 'custom', path: ['paymentAmount'], message: overpaidMessage(total) });
        }
      })
  );
}
