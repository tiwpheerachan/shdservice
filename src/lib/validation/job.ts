import { z } from "zod";

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
  customerCode: "ต้องค้นหาและเลือกลูกค้าก่อน",
  jobType: "ต้องเลือกประเภทงานหลัก",
  so: "ต้องระบุ Sale Order No.",
  channel: "ต้องเลือก Channel",
  saleOrderDate: "ต้องระบุ Sale Order Date",
  warrantyMonth: "ต้องระบุจำนวนเดือนรับประกัน",
  expireDate: "ต้องระบุ Expire Date",
  serial: "ต้องระบุ Serial No.",
  brand: "ต้องเลือกยี่ห้อ",
  modelCode: "ต้องเลือกรุ่น",
  symptoms: "ต้องเลือกอาการเสียหลักอย่างน้อย 1 อาการ",
} as const;
export type JobRequiredKey = keyof typeof JOB_REQUIRED;
export const JOB_REQUIRED_KEYS = Object.keys(JOB_REQUIRED) as JobRequiredKey[];

/** short names for the "ข้อมูลไม่ครบ" notice on old jobs */
export const JOB_FIELD_LABEL: Record<JobRequiredKey, string> = {
  customerCode: "ลูกค้า",
  jobType: "ประเภทงานหลัก",
  so: "Sale Order No.",
  channel: "Channel",
  saleOrderDate: "Sale Order Date",
  warrantyMonth: "รับประกัน (เดือน)",
  expireDate: "Expire Date",
  serial: "Serial No.",
  brand: "ยี่ห้อ",
  modelCode: "รุ่น",
  symptoms: "อาการเสียหลัก",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = z.string().optional();
const date = z.union([z.literal(""), z.string().regex(ISO_DATE, "รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)")]).optional();
const numberLike = z
  .union([z.number(), z.string()])
  .optional()
  .refine((v) => v === undefined || v === "" || Number.isFinite(Number(v)), "ต้องเป็นตัวเลข")
  .refine((v) => v === undefined || v === "" || Number(v) >= 0, "ต้องไม่ติดลบ");

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
  warrantyMonth: numberLike,
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
  estimateCost: numberLike,
  depositCost: numberLike,
  serviceCost: numberLike,
  toolCost: numberLike,
  deliveryCost: numberLike,
  boxCost: numberLike,
  engineerId: z.union([z.number(), z.string()]).optional(),
  engineerEmail: text,
  engineerName: text,
  dueDate: date,
});

/** does this value count as "filled"? ("", spaces, [], null → no) */
export function isFilled(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((x) => String(x ?? "").trim() !== "");
  return v !== undefined && v !== null && String(v).trim() !== "";
}

/** text fields where the legacy data wrote "0" / "-" for "none" — those count as empty */
const LEGACY_PLACEHOLDER_KEYS = new Set<JobRequiredKey>(["so", "channel", "serial"]);
const LEGACY_PLACEHOLDERS = new Set(["0", "-"]);

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
      if (keep.has(k) && !isRequiredFilled(k, v[k])) ctx.addIssue({ code: "custom", path: [k], message: JOB_REQUIRED[k] });
    }
  });
}

/* ------------------------------------------------------------------ *
 * Workflow screens — their own action payloads (the * fields on each screen)
 * ------------------------------------------------------------------ */

const req = (msg: string) => z.string({ error: msg }).trim().min(1, msg);
const reqDate = (msg: string) => z.string({ error: msg }).regex(ISO_DATE, msg);

/** บันทึกงานซ่อม → POST /api/jobs/:no/repair */
export const repairActionSchema = z.looseObject({ status: req("โปรดระบุสถานะงานซ่อม") });

/** บันทึกงานส่งซ่อมต่อ → POST /api/jobs/:no/outsource (sending: to + date; receiving back: the receive block) */
export const outsourceActionSchema = z
  .looseObject({
    status: req("โปรดระบุสถานะงานซ่อม"),
    send: z.looseObject({ to: req("ต้องระบุ ส่งไปยัง"), date: reqDate("ต้องระบุวันที่ส่ง") }).optional(),
    receive: z.looseObject({}).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.send && !v.receive) ctx.addIssue({ code: "custom", path: ["send", "to"], message: "ต้องระบุ ส่งไปยัง" });
  });

/** บันทึกงาน Swap / Refund → POST /api/jobs/:no/swap-refund (refund = the body carries refund fields) */
export const swapRefundActionSchema = z
  .looseObject({
    status: req("โปรดระบุสถานะงาน"),
    newSerial: z.string().optional(),
    refundAmount: z.union([z.number(), z.string()]).optional(),
    refundMethod: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    const refund = v.refundAmount !== undefined || v.refundMethod !== undefined;
    if (refund) {
      if (!(Number(v.refundAmount) > 0)) ctx.addIssue({ code: "custom", path: ["refundAmount"], message: "ต้องระบุยอดเงินคืน (มากกว่า 0)" });
      if (!isFilled(v.refundMethod)) ctx.addIssue({ code: "custom", path: ["refundMethod"], message: "ต้องเลือกวิธีการคืนเงิน" });
    } else if (!isFilled(v.newSerial)) {
      ctx.addIssue({ code: "custom", path: ["newSerial"], message: "ต้องระบุ New Serial No." });
    }
  });

/** ปิดงาน-ส่งคืนสินค้า → POST /api/jobs/:no/close */
export const closeActionSchema = z.looseObject({
  status: req("โปรดระบุสถานะงาน"),
  payment: z.looseObject({ type: req("ต้องเลือกวิธีการชำระเงิน") }, { error: "ต้องเลือกวิธีการชำระเงิน" }),
  return: z.looseObject(
    { type: req("ต้องระบุวิธีการส่งคืนสินค้า"), date: reqDate("ต้องระบุวันที่ส่งคืน") },
    { error: "ต้องระบุวิธีการส่งคืนสินค้า" }
  ),
});
