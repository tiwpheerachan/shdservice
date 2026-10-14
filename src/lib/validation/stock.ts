import { z } from "zod";

/**
 * Bodies of the write routes that had no schema (stock in/out, assign, SO approve /
 * tracking, call log). Bounds, not business rules — those stay in the services:
 *  - qty: a whole number 0–100,000 (0 = "skip this line", the services filter qty > 0;
 *    stock columns are integers, so 1.5 or 1e9 used to reach the DB as a 500)
 *  - at most 500 lines; free text capped well above what the columns keep (services slice)
 *  - enums for the choices a typo used to fall through (decision "approvee" = reject)
 */
const qty = z.coerce.number().int("จำนวนต้องเป็นจำนวนเต็ม").min(0, "จำนวนต้องไม่ติดลบ").max(100_000, "จำนวนมากเกินไป");
const id = z.coerce.number().int().positive();
const text = (max: number) => z.string().max(max, `ยาวเกิน ${max} ตัวอักษร`).nullish().transform((v) => v ?? undefined);
const lines = <T extends z.ZodRawShape>(shape: T) =>
  z.array(z.looseObject(shape)).min(1, "ต้องมีอย่างน้อย 1 รายการ").max(500, "รายการมากเกิน 500 บรรทัด");

export const receiveSchema = z.looseObject({
  date: text(30),
  poRef: text(100),
  supplier: text(200),
  remark: text(500),
  lines: lines({ code: z.string().min(1, "ต้องระบุรหัสอะไหล่").max(50), qty }),
});

export const issueSchema = z.looseObject({
  type: z.enum(["job", "sale", "other", "return"], "ประเภทการเบิกไม่ถูกต้อง"),
  ref: text(50),
  payTo: text(200),
  remark: text(500),
  lines: lines({ logId: id.nullish(), dtId: id.nullish(), code: z.string().max(50).nullish(), qty }),
});

export const assignSchema = z.looseObject({
  jobNos: z.array(z.string().min(1).max(20)).min(1, "ยังไม่ได้เลือกงาน").max(500, "เลือกงานได้ไม่เกิน 500 งาน"),
  engineerId: id,
});

export const approveSchema = z.looseObject({
  decision: z.enum(["approve", "deny", "reject"], "การอนุมัติไม่ถูกต้อง"),
  remark: text(500),
});

export const trackingSchema = z.looseObject({ tracking: z.string().max(100, "เลขพัสดุยาวเกินไป") });

export const callLogSchema = z.looseObject({ detail: z.string().trim().min(1, "ต้องระบุรายละเอียด").max(1000, "ยาวเกิน 1000 ตัวอักษร") });
