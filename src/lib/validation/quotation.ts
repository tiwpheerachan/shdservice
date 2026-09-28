import { z } from "zod";
import { isFilled } from "./job";

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
    .refine((v) => v === undefined || v === "" || Number.isFinite(Number(v)), `${field}ต้องเป็นตัวเลข`)
    .refine((v) => v === undefined || v === "" || Number(v) >= 0, `${field}ต้องไม่ติดลบ`)
    .refine((v) => max === undefined || v === undefined || v === "" || Number(v) <= max, `${field}ต้องไม่เกิน ${max}`);

export function quotationSchema(jobRequired = true) {
  return z
    .looseObject({
      customerCode: z.string().optional(),
      jobNo: z.string().optional(),
      lines: z
        .array(
          z.looseObject({
            qty: z.union([z.number(), z.string()]).refine((v) => Number(v) > 0, "จำนวนต้องมากกว่า 0"),
            unitPrice: amount("ราคา/หน่วย"),
          })
        )
        .optional(),
      serviceAmount: amount("ค่าบริการ"),
      discountValue: amount("ส่วนลด", 100),
      vatRate: amount("ภาษีมูลค่าเพิ่ม", 100),
    })
    // required checks here, not on the fields: a missing key must not stop the other rules
    .superRefine((v, ctx) => {
      if (!isFilled(v.customerCode)) ctx.addIssue({ code: "custom", path: ["customerCode"], message: "ต้องเลือกลูกค้า" });
      if (!isFilled(v.jobNo)) {
        if (jobRequired) ctx.addIssue({ code: "custom", path: ["jobNo"], message: "ต้องระบุหมายเลขงานซ่อมที่อ้างถึง" });
      } else if (!JOB_NO.test(String(v.jobNo).trim())) {
        ctx.addIssue({ code: "custom", path: ["jobNo"], message: "รูปแบบหมายเลขงานไม่ถูกต้อง (เช่น J2612164)" });
      }
    });
}
