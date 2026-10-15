import { z } from 'zod';
import { isoDateString } from './index';

/**
 * Job form rules (เปิดงาน / แก้ไขงาน / บันทึกซ่อม / Out-Source / Swap-Refund / ปิดงาน) —
 * the payload is the API's JobInput (keys from toJobInput in components/shared/job-form.tsx).
 *
 *  - new job: every field marked * on the form is required
 *  - existing job ("never worse"): a required field that already has a value must keep one; a field
 *    that was empty before may stay empty, so old jobs (e.g. swap jobs without a serial) can still
 *    move through the workflow — the form shows them as "ข้อมูลไม่ครบ"
 *
 * The same rules run in the browser before saving and in services/jobs.ts on the server.
 */
export const JOB_REQUIRED = {
  customerCode: 'ต้องค้นหาและเลือกลูกค้าก่อน',
  jobType: 'ต้องเลือกประเภทงานหลัก',
  so: 'ต้องระบุ Sale Order No.',
  channel: 'ต้องเลือก Channel',
  saleOrderDate: 'ต้องระบุ Sale Order Date',
  warrantyMonth: 'ต้องระบุจำนวนเดือนรับประกัน',
  expireDate: 'ต้องระบุ Expire Date',
  serial: 'ต้องระบุ Serial No.',
  brand: 'ต้องเลือกยี่ห้อ',
  modelCode: 'ต้องเลือกรุ่น',
  symptoms: 'ต้องเลือกอาการเสียหลักอย่างน้อย 1 อาการ',
  dueDate: 'ต้องระบุวันประเมินซ่อมเสร็จ',
} as const;
export type JobRequiredKey = keyof typeof JOB_REQUIRED;
export const JOB_REQUIRED_KEYS = Object.keys(JOB_REQUIRED) as JobRequiredKey[];

/** short names for the "ข้อมูลไม่ครบ" notice on old jobs */
export const JOB_FIELD_LABEL: Record<JobRequiredKey, string> = {
  customerCode: 'ลูกค้า',
  jobType: 'ประเภทงานหลัก',
  so: 'Sale Order No.',
  channel: 'Channel',
  saleOrderDate: 'Sale Order Date',
  warrantyMonth: 'รับประกัน (เดือน)',
  expireDate: 'Expire Date',
  serial: 'Serial No.',
  brand: 'ยี่ห้อ',
  modelCode: 'รุ่น',
  symptoms: 'อาการเสียหลัก',
  dueDate: 'วันประเมินซ่อมเสร็จ',
};

const text = z.string().optional();
const date = z.union([z.literal(''), isoDateString()]).optional();
// the message names the field: the toast lists messages without their field ("ต้องไม่ติดลบ" alone said nothing)
const numberLike = (field: string) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .refine((v) => v === undefined || v === '' || Number.isFinite(Number(v)), `${field}ต้องเป็นตัวเลข`)
    .refine((v) => v === undefined || v === '' || Number(v) >= 0, `${field}ต้องไม่ติดลบ`);
/** numberLike + no fractions (an integer column would silently drop them) */
const wholeLike = (field: string) =>
  numberLike(field).refine(
    (v) => v === undefined || v === '' || Number.isInteger(Number(v)),
    `${field}ต้องเป็นจำนวนเต็ม`,
  );

/** field types — everything optional here; what is required is decided per mode below */
const jobInputShape = z.object({
  customerCode: text,
  documentProfileId: z.number().optional(),
  jobType: text,
  jobTypeDetail: text,
  isBounce: z.boolean().optional(),
  status: text,
  so: text,
  channel: text,
  shopName: text,
  saleOrderDate: date,
  warrantyMonth: wholeLike('รับประกัน (เดือน) '),
  expireDate: date,
  warranty: text,
  productType: text,
  imei: text,
  serial: text,
  brand: text,
  modelCode: text,
  modelDetail: text,
  color: text,
  receptionDate: date,
  receptionTrackingNo: text,
  receptionShipper: text,
  receptionType: text,
  equipment: text,
  fault: text,
  symptoms: z.array(z.string()).optional(),
  symptomOther: text,
  remark: text,
  estimateCost: numberLike('ค่าประเมินงานซ่อม'),
  depositCost: numberLike('ค่ามัดจำงานซ่อม'),
  serviceCost: numberLike('ค่าบริการการซ่อม'),
  toolCost: numberLike('ค่าเครื่องมือพิเศษ'),
  deliveryCost: numberLike('ค่าขนส่ง'),
  boxCost: numberLike('ค่ากล่องพัสดุ'),
  engineerId: z.union([z.number(), z.string()]).optional(),
  engineerEmail: text,
  engineerName: text,
  dueDate: date,
});

/** does this value count as "filled"? ("", spaces, [], null → no) */
export function isFilled(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((x) => String(x ?? '').trim() !== '');
  return v !== undefined && v !== null && String(v).trim() !== '';
}

/** text fields where the legacy data wrote "0" / "-" for "none" — those count as empty */
const LEGACY_PLACEHOLDER_KEYS = new Set<JobRequiredKey>(['so', 'channel', 'serial']);
const LEGACY_PLACEHOLDERS = new Set(['0', '-']);

/** is this required field filled? (the one rule the page, the API and the old-job notice share) */
export function isRequiredFilled(key: JobRequiredKey, v: unknown): boolean {
  if (!isFilled(v)) return false;
  return !(LEGACY_PLACEHOLDER_KEYS.has(key) && LEGACY_PLACEHOLDERS.has(String(v).trim()));
}

/** the required fields that have a value (the "before" of an edit) */
export function filledRequired(values: Partial<Record<JobRequiredKey, unknown>>): JobRequiredKey[] {
  return JOB_REQUIRED_KEYS.filter((k) => isRequiredFilled(k, values[k]));
}

/** required fields still empty — shown as the "ข้อมูลไม่ครบ" notice on an old job */
export function missingRequired(values: Partial<Record<JobRequiredKey, unknown>>): JobRequiredKey[] {
  return JOB_REQUIRED_KEYS.filter((k) => !isRequiredFilled(k, values[k]));
}

/**
 * Schema for a save: `mustKeep` = the required fields that must have a value.
 * New job → all of them; existing job → those that had a value before (filledRequired).
 */
export function jobSchema(mustKeep: readonly JobRequiredKey[] = JOB_REQUIRED_KEYS) {
  const keep = new Set(mustKeep);
  return jobInputShape.superRefine((v, ctx) => {
    for (const k of JOB_REQUIRED_KEYS) {
      if (keep.has(k) && !isRequiredFilled(k, v[k]))
        ctx.addIssue({ code: 'custom', path: [k], message: JOB_REQUIRED[k] });
    }
  });
}

/* ------------------------------------------------------------------ *
 * Workflow screens — their own action payloads (the * fields on each screen)
 * ------------------------------------------------------------------ */

const req = (msg: string) => z.string({ error: msg }).trim().min(1, msg);

/** ส่งโดย / รับโดย: an app_user id (left out → the server uses the person saving) */
const staffId = (msg: string) => z.number({ error: msg }).int(msg).positive(msg).optional();

/** an A / B quote of a part line: qty 0 = that option is not used */
const partOption = z.looseObject({ qty: wholeLike('จำนวนอะไหล่') }).optional();

/** บันทึกงานซ่อม → POST /api/jobs/:no/repair (costs and part prices not negative, part qty whole) */
export const repairActionSchema = z.looseObject({
  status: req('โปรดระบุสถานะงานซ่อม'),
  serviceCost: numberLike('ค่าบริการการซ่อม'),
  toolCost: numberLike('ค่าเครื่องมือพิเศษ'),
  deliveryCost: numberLike('ค่าขนส่ง'),
  boxCost: numberLike('ค่ากล่องพัสดุ'),
  parts: z.array(z.looseObject({ unitPrice: numberLike('ราคาอะไหล่'), a: partOption, b: partOption })).optional(),
});

/** บันทึกงานส่งซ่อมต่อ → POST /api/jobs/:no/outsource (sending: to + date; receiving back: the receive block) */
export const outsourceActionSchema = z
  .looseObject({
    status: z.string().optional(),
    send: z
      .looseObject({
        to: req('ต้องระบุ ส่งไปยัง'),
        date: isoDateString('ต้องระบุวันที่ส่ง'),
        by: staffId('ต้องเลือกผู้ส่ง'),
      })
      .optional(),
    receive: z.looseObject({ by: staffId('ต้องเลือกผู้รับ'), date }).optional(),
  })
  .superRefine((v, ctx) => {
    if (!isFilled(v.status)) ctx.addIssue({ code: 'custom', path: ['status'], message: 'โปรดระบุสถานะงานซ่อม' });
    if (!v.send && !v.receive) ctx.addIssue({ code: 'custom', path: ['send', 'to'], message: 'ต้องระบุ ส่งไปยัง' });
    // both dates are YYYY-MM-DD here, so string order = date order (the stored send date: saveOutsource)
    if (v.send?.date && v.receive?.date && v.receive.date < v.send.date)
      ctx.addIssue({ code: 'custom', path: ['receive', 'date'], message: RECEIVE_BEFORE_SEND });
  });

export const RECEIVE_BEFORE_SEND = 'วันที่รับต้องไม่ก่อนวันที่ส่ง';
/** ปิดงานไม่ได้ระหว่างที่เครื่องยังอยู่ที่ Out-Source (setStatus → Finished; หน้า ปิดงาน เตือนก่อนกด) */
export const OUTSOURCE_NOT_BACK = 'งานนี้ส่งซ่อมภายนอกอยู่ — ต้องบันทึก "รับคืนจาก Out-Source แล้ว" ก่อนปิดงาน';

/** บันทึกงาน Swap / Refund → POST /api/jobs/:no/swap-refund (refund = the body carries refund fields) */
export const swapRefundActionSchema = z
  .looseObject({
    status: z.string().optional(),
    newSerial: z.string().optional(),
    refundAmount: z.union([z.number(), z.string()]).optional(),
    refundMethod: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (!isFilled(v.status)) ctx.addIssue({ code: 'custom', path: ['status'], message: 'โปรดระบุสถานะงาน' });
    const refund = v.refundAmount !== undefined || v.refundMethod !== undefined;
    if (refund) {
      if (!(Number(v.refundAmount) > 0))
        ctx.addIssue({ code: 'custom', path: ['refundAmount'], message: 'ต้องระบุยอดเงินคืน (มากกว่า 0)' });
      if (!isFilled(v.refundMethod))
        ctx.addIssue({ code: 'custom', path: ['refundMethod'], message: 'ต้องเลือกวิธีการคืนเงิน' });
    } else if (!isFilled(v.newSerial)) {
      ctx.addIssue({ code: 'custom', path: ['newSerial'], message: 'ต้องระบุ New Serial No.' });
    }
  });

/** job_status 8 — the parcel went out with a carrier and its number is recorded (7 = number still to come) */
export const STATUS_CLOSED_TRACKED = 'ปิดงาน-ส่งคืนสินค้า (ลงเลขที่พัสดุแล้ว)';

/** ปิดงาน-ส่งคืนสินค้า → POST /api/jobs/:no/close */
export const closeActionSchema = z
  .looseObject({
    status: req('โปรดระบุสถานะงาน'),
    payment: z.looseObject(
      { type: req('ต้องเลือกวิธีการชำระเงิน'), amount: numberLike('จำนวนเงินที่ชำระ') },
      { error: 'ต้องเลือกวิธีการชำระเงิน' },
    ),
    return: z.looseObject(
      { type: req('ต้องระบุวิธีการส่งคืนสินค้า'), date: isoDateString('ต้องระบุวันที่ส่งคืน'), tracking: text },
      { error: 'ต้องระบุวิธีการส่งคืนสินค้า' },
    ),
  })
  .superRefine((v, ctx) => {
    if (v.status === STATUS_CLOSED_TRACKED && !isFilled(v.return.tracking))
      ctx.addIssue({ code: 'custom', path: ['return', 'tracking'], message: 'ต้องระบุหมายเลขพัสดุ' });
  });

/**
 * What the customer still pays at close: the job total less the deposit taken at reception, never
 * below 0. job_total_cost keeps its legacy meaning (no deposit) — this is for display and defaults.
 */
export function jobAmountDue(total: number, deposit: number): number {
  return Math.max(0, Math.round((total - deposit) * 100) / 100);
}
