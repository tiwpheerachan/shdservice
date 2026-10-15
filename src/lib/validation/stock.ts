import { z } from 'zod';
import { cleanCode, codeField, isoDateString, maxText } from './index';
import { JOB_NO_RE } from './quotation';
import { trackingField } from './sale-order';
import { today } from '@/lib/dates';

/**
 * Bodies of the write routes that had no schema (stock in/out, assign, SO approve /
 * tracking, call log). Bounds, not business rules — those stay in the services:
 *  - qty: a whole number 0–100,000 (0 = "skip this line", the services filter qty > 0;
 *    stock columns are integers, so 1.5 or 1e9 used to reach the DB as a 500)
 *  - at most 500 lines; free text no longer than its column (nothing is cut off silently)
 *  - enums for the choices a typo used to fall through (decision "approvee" = reject)
 */
const qty = z.coerce.number().int('จำนวนต้องเป็นจำนวนเต็ม').min(0, 'จำนวนต้องไม่ติดลบ').max(100_000, 'จำนวนมากเกินไป');
const id = z.coerce.number().int().positive();
const text = (max: number) =>
  z
    .string()
    .max(max, `ยาวเกิน ${max} ตัวอักษร`)
    .nullish()
    .transform((v) => v ?? undefined);
const lines = <T extends z.ZodRawShape>(shape: T) =>
  z.array(z.looseObject(shape)).min(1, 'ต้องมีอย่างน้อย 1 รายการ').max(500, 'รายการมากเกิน 500 บรรทัด');

/** รับเข้า: supplier + remark share inventory_remark varchar(100) as "Supplier: X · remark" (10 + 40 + 3 + 47) */
export const receiveSchema = z.looseObject({
  date: isoDateString('ต้องระบุวันที่รับเข้า').refine((d) => d <= today(), 'วันที่รับเข้าต้องไม่เกินวันนี้'),
  poRef: codeField(/^[A-Z0-9][A-Z0-9/-]{0,49}$/, 'เลขที่ PO ใช้ได้เฉพาะ A-Z 0-9 / - (ไม่เกิน 50 ตัว)'),
  supplier: maxText(40, 'Supplier '),
  remark: maxText(47, 'หมายเหตุ '),
  lines: lines({ code: z.string().min(1, 'ต้องระบุรหัสอะไหล่').max(50), qty }),
});

/** อ้างอิงเลขเอกสาร per pick type: a job (J + 7 digits) or a sale order (SO + digits) */
const PICK_REF: Record<string, RegExp> = { job: JOB_NO_RE, return: JOB_NO_RE, sale: /^SO\d+$/ };

export const issueSchema = z
  .looseObject({
    type: z.enum(['job', 'sale', 'other', 'return'], 'ประเภทการเบิกไม่ถูกต้อง'),
    ref: text(50),
    // จ่ายให้ / รับคืนจาก: required — a stock-out document without a recipient was saved (inventory_hd.reference_out_to, 50)
    payTo: z
      .string()
      .trim()
      .max(50, 'ยาวเกิน 50 ตัวอักษร')
      .nullish()
      .transform((v) => v ?? ''),
    remark: maxText(100, 'หมายเหตุ '),
    lines: lines({ logId: id.nullish(), dtId: id.nullish(), code: z.string().max(50).nullish(), qty }),
  })
  .refine((v) => !!v.payTo, {
    path: ['payTo'],
    error: (iss) => ((iss.input as { type?: unknown }).type === 'return' ? 'ต้องเลือก รับคืนจาก' : 'ต้องเลือก จ่ายให้'),
    when: (p) => typeof p.value === 'object' && p.value !== null, // also when another field failed: every error at once
  })
  .refine((v) => !v.ref || !PICK_REF[v.type] || PICK_REF[v.type]!.test(cleanCode(v.ref)), {
    path: ['ref'],
    error: (iss) =>
      (iss.input as { type?: unknown }).type === 'sale'
        ? 'เลขใบสั่งขายไม่ถูกต้อง (SO + ตัวเลข)'
        : 'หมายเลขงานไม่ถูกต้อง (J + ตัวเลข 7 หลัก)',
    when: (p) => typeof p.value === 'object' && p.value !== null,
  });

export const assignSchema = z.looseObject({
  jobNos: z.array(z.string().min(1).max(20)).min(1, 'ยังไม่ได้เลือกงาน').max(500, 'เลือกงานได้ไม่เกิน 500 งาน'),
  engineerId: id,
});

export const approveSchema = z.looseObject({
  decision: z.enum(['approve', 'deny', 'reject'], 'การอนุมัติไม่ถูกต้อง'),
  remark: maxText(100, 'หมายเหตุ '), // sale_out_hd.approve_remark varchar(100)
});

/** เลขพัสดุของใบสั่งขาย — `prev` = the number stored now (an unchanged legacy value passes) */
export const trackingSchema = (prev?: string | null) => z.looseObject({ tracking: trackingField(prev) });

/** job_call_log.call_log_description is varchar(200): a longer note is refused (it used to lose the rest) */
export const callLogSchema = z.looseObject({
  detail: z.string().trim().min(1, 'ต้องระบุรายละเอียด').max(200, 'ยาวเกิน 200 ตัวอักษร'),
});
