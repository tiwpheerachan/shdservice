import { z } from "zod";
import { isFilled } from "./job";

/**
 * Sale order rules (สร้าง / แก้ไขใบสั่งขาย) — payload = SaleOrderInput (sale-order-form payload()).
 *  - customer, salesperson (prefilled with the signed-in user) and at least one product line
 *  - qty > 0, prices and the paid amount not negative
 * Line errors are keyed "lines.<row>.qty" / "lines.<row>.price" (row = position on screen).
 */
const money = (field: string) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .refine((v) => v === undefined || v === "" || Number.isFinite(Number(v)), `${field}ต้องเป็นตัวเลข`)
    .refine((v) => v === undefined || v === "" || Number(v) >= 0, `${field}ต้องไม่ติดลบ`);

export const saleOrderSchema = z
  .looseObject({
    customerCode: z.string().optional(),
    salesId: z.union([z.number(), z.string()]).optional(),
    lines: z
      .array(
        z.looseObject({
          code: z.string().optional(),
          qty: z.union([z.number(), z.string()]).refine((v) => Number(v) > 0, "จำนวนต้องมากกว่า 0"),
          price: money("ราคา"),
        })
      )
      .optional(),
    paymentAmount: money("จำนวนเงินที่ชำระ"),
    fee: money("ค่าธรรมเนียม"),
  })
  // required checks here, not on the fields: a missing key must not stop the other rules
  .superRefine((v, ctx) => {
    if (!isFilled(v.customerCode)) ctx.addIssue({ code: "custom", path: ["customerCode"], message: "ต้องเลือกลูกค้า" });
    if (!(Number(v.salesId) > 0)) ctx.addIssue({ code: "custom", path: ["salesId"], message: "ต้องเลือกพนักงานขาย" });
    if (!(v.lines ?? []).some((l) => isFilled(l.code)))
      ctx.addIssue({ code: "custom", path: ["lines"], message: "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ" });
  });
