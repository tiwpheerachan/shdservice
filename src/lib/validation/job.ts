import * as z from 'zod';
import { addDays, today } from '@/lib/dates';
import { CHANNELS, CLOSE_STATUS_OPTIONS, JOB_STATUS_OPTIONS, RECEIVE_METHODS, WARRANTY_OPTIONS } from '@/data/options';
import { clean, codeField, cleanCode, isoDateString, maxNote, maxText, moneyField, trackingField } from './index';
import { rightLabel } from '@/lib/modules';
// only used inside the factories below (sale-order.ts imports isFilled from here — no top-level use, no cycle problem)

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
 * Field formats (SO / Serial / IMEI / tracking no, lists, dates, lengths = the column) apply to a new
 * or CHANGED value; the value stored now (`prev`) still passes, so an old job saves untouched.
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

/** job columns (+ the out-source row fields) as the audit log stores them → their name on the form (ประวัติการแก้ไข) */
export const JOB_COLUMN_LABEL: Record<string, string> = {
  customerId: JOB_FIELD_LABEL.customerCode,
  customerDetail: 'ข้อมูลลูกค้า',
  customerDueDate: JOB_FIELD_LABEL.dueDate,
  dueDateSetByUser: 'กำหนดวันประเมินเอง',
  jobTypeId: JOB_FIELD_LABEL.jobType,
  jobTypeDetail: 'งานย่อย',
  jobStatusId: 'สถานะงาน',
  productImeiNo: 'IMEI',
  productSerial: JOB_FIELD_LABEL.serial,
  productTypeId: 'ประเภทสินค้า',
  productBrandId: JOB_FIELD_LABEL.brand,
  productModelId: JOB_FIELD_LABEL.modelCode,
  productModelName: 'ชื่อรุ่น',
  productModelDetail: 'รุ่นย่อย',
  productColor: 'สี',
  productSymptomId: JOB_FIELD_LABEL.symptoms,
  productSymptomOther: 'อาการเสีย (อื่นๆ)',
  productEquipment: 'อุปกรณ์',
  productFault: 'จุดตำหนิ',
  productWarranty: 'Warranty',
  productSaleOutChannel: JOB_FIELD_LABEL.channel,
  productSaleOrderDate: JOB_FIELD_LABEL.saleOrderDate,
  productWarrantyMonth: JOB_FIELD_LABEL.warrantyMonth,
  productExpireDate: JOB_FIELD_LABEL.expireDate,
  productSaleOutShopName: 'Shop Name',
  jobReferenceNo: JOB_FIELD_LABEL.so,
  jobRemark: 'หมายเหตุ',
  jobReceptionType: 'รับสินค้าเข้าโดย',
  jobReceptionDate: 'วันที่รับเข้า',
  jobReceptionTrackingNo: 'เลขพัสดุจากลูกค้า',
  jobReceptionShipper: 'บริษัทขนส่ง (รับเข้า)',
  isJobBounce: 'งานซ่อมซ้ำ',
  engineerId: 'ช่างผู้รับผิดชอบ',
  engineerSymptomId: 'อาการเสียที่ตรวจพบ',
  engineerRepairDetail: 'วิธีการซ่อม',
  engineerRemark: 'หมายเหตุช่าง',
  sparePartReplace: 'อะไหล่ที่เปลี่ยน / New S/N',
  estimateCost: 'ค่าประเมินงานซ่อม',
  depositCost: 'ค่ามัดจำงานซ่อม',
  sparePartTotalCost: 'รวมค่าอะไหล่',
  serviceCost: 'ค่าบริการการซ่อม',
  serviceToolCost: 'ค่าเครื่องมือพิเศษ',
  deliveryCost: 'ค่าขนส่ง',
  cartonBoxCost: 'ค่ากล่องพัสดุ',
  jobTotalCost: 'รวมเป็นเงินสุทธิ',
  jobPaymentType: 'วิธีการชำระเงิน',
  jobPaymentNo: 'เลขที่ใบเสร็จ / อ้างอิง',
  jobPaymentAmount: 'จำนวนเงินที่ชำระ / เงินคืน',
  jobPaymentDetail: 'รายละเอียดการชำระเงิน',
  jobReturnDate: 'วันที่ส่งคืน',
  returnCustomerType: 'วิธีการส่งคืนสินค้า',
  returnCustomerTrackingNo: 'หมายเลขพัสดุ (ส่งคืน)',
  returnCustomerDetail: 'รายละเอียดการส่งคืน',
  returnShipperId: 'บริษัทขนส่ง (ส่งคืน)',
  jobReturnBy: 'ส่งคืนโดย',
  swapRefundDetail: 'รายละเอียด Swap / Refund',
  swapRefundDocumentNo: 'เลขที่เอกสาร Swap / Refund',
  sendTo: 'ส่งไปยัง',
  sendDate: 'วันที่ส่ง',
  sendBy: 'ส่งโดย',
  receiveFrom: 'รับจาก',
  receiveDate: 'วันที่รับ',
  receiveBy: 'รับโดย',
  receiveDetail: 'หมายเหตุการรับคืน',
  file: 'ไฟล์',
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
  jobTypeDetail: maxText(50, 'งานย่อย '),
  isBounce: z.boolean().optional(),
  status: text,
  so: text,
  channel: text,
  shopName: maxText(100, 'Shop Name '),
  saleOrderDate: date,
  warrantyMonth: wholeLike('รับประกัน (เดือน) '),
  expireDate: date,
  warranty: text,
  productType: text,
  imei: text,
  serial: text,
  brand: text,
  modelCode: text,
  modelDetail: maxText(200, 'รุ่นย่อย '),
  color: text,
  receptionDate: date,
  receptionTrackingNo: text,
  receptionShipper: text,
  receptionType: text,
  equipment: maxText(100, 'อุปกรณ์ '),
  fault: maxText(100, 'จุดตำหนิ '),
  symptoms: z.array(z.string()).optional(),
  symptomOther: maxText(200, 'อาการเสีย (อื่นๆ) '),
  remark: maxNote(2000, 'หมายเหตุ '),
  estimateCost: moneyField('ค่าประเมินงานซ่อม'),
  depositCost: moneyField('ค่ามัดจำงานซ่อม'),
  serviceCost: moneyField('ค่าบริการการซ่อม'),
  toolCost: moneyField('ค่าเครื่องมือพิเศษ'),
  deliveryCost: moneyField('ค่าขนส่ง'),
  boxCost: moneyField('ค่ากล่องพัสดุ'),
  engineerId: z.union([z.number(), z.string()]).optional(),
  engineerName: text,
  dueDate: date,
});

/** does this value count as "filled"? ("", spaces, [], null → no) */
export function isFilled(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((x) => String(x ?? '').trim() !== '');
  return v !== undefined && v !== null && String(v).trim() !== '';
}

/** text fields where the legacy data wrote "0" / "-" / "ยังไม่ระบุ" for "none" — those count as empty */
const LEGACY_PLACEHOLDER_KEYS = new Set<JobRequiredKey>(['so', 'channel', 'serial']);
const LEGACY_PLACEHOLDERS = new Set(['0', '-', 'ยังไม่ระบุ']);

/**
 * Serial No. ticked "ไม่มี S/N / S/N เสียหาย": stored as the legacy "none" marker "-" (search, the
 * print-outs and reports already show it as "no serial"), but — unlike a typed "0" / "-" — it is an
 * answer, so it fills the required Serial (staff stop typing notes like "SN เสียหาย" into the field).
 */
export const NO_SERIAL = '-';

/** is this required field filled? (the one rule the page, the API and the old-job notice share) */
export function isRequiredFilled(key: JobRequiredKey, v: unknown): boolean {
  if (!isFilled(v)) return false;
  if (key === 'serial' && String(v).trim() === NO_SERIAL) return true;
  return !(LEGACY_PLACEHOLDER_KEYS.has(key) && LEGACY_PLACEHOLDERS.has(String(v).trim()));
}

/* ---- identifier formats (checked on cleanCode(); services store the cleaned value) ---- */
const SO_RE = /^(?!0+$)[A-Z0-9][A-Z0-9/._-]{3,49}$/;
const SO_MSG = 'Sale Order No. ใช้ได้เฉพาะ A-Z 0-9 / . _ - (4–50 ตัว)';
/** a typed "S/N:" / "SN:" prefix is allowed here and dropped on save (cleanSerial) */
const SERIAL_BODY = String.raw`(?:S\/?N\s*:\s*)?[A-Z0-9][A-Z0-9/._:-]{3,49}`;
const NEW_SERIAL_RE = new RegExp(`^${SERIAL_BODY}$`);
const SERIAL_RE = new RegExp(`^(?:-|${SERIAL_BODY})$`); // "-" = NO_SERIAL
const NEW_SERIAL_MSG = 'Serial No. ใช้ได้เฉพาะ A-Z 0-9 / . _ : - (4–50 ตัว)';
const SERIAL_MSG = `${NEW_SERIAL_MSG} — ไม่มีหรืออ่านไม่ได้ ให้ติ๊ก "ไม่มี S/N / S/N เสียหาย"`;
/** Serial No. as stored: cleanCode() without a typed "S/N:" prefix */
export const cleanSerial = (v: unknown) => cleanCode(v).replace(/^S\/?N\s*:\s*/, '');
const PAY_NO_RE = /^[A-Z0-9 -]{1,50}$/;
const PAY_NO_MSG = 'ใช้ได้เฉพาะ A-Z 0-9 ช่องว่าง และ - (ไม่เกิน 50 ตัว)';

/** "YYYY-MM-DD" n years later (string order = date order) */
const plusYears = (d: string, n: number) => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`;
const ymdOf = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const has = (list: readonly string[], v: unknown) => list.includes(clean(v));

export type JobCheck = {
  /** the values stored now (an edit) — an unchanged value passes the format rules ("never worse") */
  prev?: Partial<Record<string, unknown>> | null;
  /** the job's open date "YYYY-MM-DD" (a new job: today) */
  openDate?: string;
  /** today on the Thai calendar (tests pin it) */
  today?: string;
};

/** walk-in (ช่องทาง หน้าร้าน): no sale order — SO no. / SO date / expire date may stay empty (owner 2026-10-15) */
export const WALK_IN_CHANNEL = 'หน้าร้าน';
const WALK_IN_OPTIONAL = new Set<JobRequiredKey>(['so', 'saleOrderDate', 'expireDate']);
/** is this field required for a job sold through `channel`? */
export const isRequiredFor = (key: JobRequiredKey, channel: unknown) =>
  !(clean(channel) === WALK_IN_CHANNEL && WALK_IN_OPTIONAL.has(key));

/** the required fields that have a value (the "before" of an edit) */
export function filledRequired(values: Partial<Record<JobRequiredKey, unknown>>): JobRequiredKey[] {
  return JOB_REQUIRED_KEYS.filter((k) => isRequiredFilled(k, values[k]));
}

/** required fields still empty — shown as the "ข้อมูลไม่ครบ" notice on an old job */
export function missingRequired(values: Partial<Record<JobRequiredKey | 'channel', unknown>>): JobRequiredKey[] {
  return JOB_REQUIRED_KEYS.filter((k) => isRequiredFor(k, values.channel) && !isRequiredFilled(k, values[k]));
}

/**
 * Schema for a save: `mustKeep` = the required fields that must have a value.
 * New job → all of them; existing job → those that had a value before (filledRequired).
 * `check` = the edited job's stored values + open date (see JobCheck).
 */
export function jobSchema(mustKeep: readonly JobRequiredKey[] = JOB_REQUIRED_KEYS, check: JobCheck = {}) {
  const keep = new Set(mustKeep);
  const prev = check.prev ?? null;
  const was = (k: string) => (prev?.[k] == null ? null : String(prev[k]));
  const now = check.today ?? today();
  const opened = check.openDate || now;
  return jobInputShape
    .extend({
      so: codeField(SO_RE, SO_MSG, was('so')),
      serial: codeField(SERIAL_RE, SERIAL_MSG, was('serial')),
      imei: codeField(/^\d{15}$/, 'IMEI ต้องเป็นตัวเลข 15 หลัก', was('imei')),
      receptionTrackingNo: trackingField(was('receptionTrackingNo')),
    })
    .superRefine((v, ctx) => {
      const add = (k: string, message: string) => ctx.addIssue({ code: 'custom', path: [k], message });
      for (const k of JOB_REQUIRED_KEYS)
        if (keep.has(k) && isRequiredFor(k, v.channel) && !isRequiredFilled(k, v[k])) add(k, JOB_REQUIRED[k]);
      const val = v as Record<string, unknown>;
      // a value given that differs from the stored one — only those must follow the rules below
      const changed = (k: string) => clean(val[k]) !== '' && (!prev || clean(val[k]) !== clean(prev[k]));
      if (changed('channel') && !has(CHANNELS, v.channel)) add('channel', 'Channel ต้องเลือกจากรายการ');
      if (changed('warranty') && !has(WARRANTY_OPTIONS, v.warranty)) add('warranty', 'Warranty ต้องเป็น IN หรือ OUT');
      if (changed('receptionType') && !has(RECEIVE_METHODS, v.receptionType))
        add('receptionType', 'รับสินค้าเข้าโดย ต้องเลือกจากรายการ');
      if (changed('warrantyMonth') && Number(v.warrantyMonth) > 60)
        add('warrantyMonth', 'รับประกัน (เดือน) ต้องไม่เกิน 60 เดือน');
      const sale = ymdOf(v.saleOrderDate);
      const expire = ymdOf(v.expireDate);
      const due = ymdOf(v.dueDate);
      const received = ymdOf(v.receptionDate);
      if (sale && changed('saleOrderDate') && (sale < '2015-01-01' || sale > opened))
        add('saleOrderDate', 'Sale Order Date ต้องอยู่ระหว่าง 2015-01-01 ถึงวันเปิดงาน');
      if (expire && sale && changed('expireDate') && (expire < sale || expire > plusYears(sale, 10)))
        add('expireDate', 'Expire Date ต้องไม่ก่อน Sale Order Date และไม่เกิน 10 ปี');
      // upper bound from today when the job is older than that: a long-running job can still get a new date
      if (due && changed('dueDate') && (due < opened || due > plusYears(opened > now ? opened : now, 1)))
        add('dueDate', 'วันประเมินซ่อมเสร็จต้องไม่ก่อนวันเปิดงาน และไม่เกิน 1 ปี');
      if (received && changed('receptionDate') && received > addDays(now, 1))
        add('receptionDate', 'วันที่รับเข้าต้องไม่เกินวันพรุ่งนี้');
    });
}

/* ------------------------------------------------------------------ *
 * Workflow screens — their own action payloads (the * fields on each screen)
 * ------------------------------------------------------------------ */

const req = (msg: string) => z.string({ error: msg }).trim().min(1, msg);

/** ส่งโดย / รับโดย: an app_user id (left out → the server uses the person saving) */
const staffId = (msg: string) => z.number({ error: msg }).int(msg).positive(msg).optional();

/** an A / B quote of a part line: qty 0 = that option is not used */
const partOption = z
  .looseObject({
    qty: wholeLike('จำนวนอะไหล่').refine(
      (v) => v === undefined || v === '' || Number(v) <= 1000,
      'จำนวนอะไหล่ต้องไม่เกิน 1,000',
    ),
  })
  .optional();

/**
 * What a part line adds to the job's money (spare_part_total_cost → job_total_cost → the close amount,
 * the return note, the export): only a line ticked เบิก (taken from stock) AND เสนอ (charged) — a เสนอ-only
 * line is in the quotation, not in the bill (owner 2026-10-15). The repair page and saveRepair share it.
 */
export const partCharge = (o: { pick?: boolean; quote?: boolean; qty: number }, price: number) =>
  o.pick && o.quote ? o.qty * price : 0;

/** มอบหมายงานนี้ให้ — only a role with the special right Job Take takes jobs; the job's current assignee may stay */
export const NOT_ENGINEER = `มอบหมายงานได้เฉพาะผู้ใช้ที่มี${rightLabel('Job Take')}`;

/** a stored line (logId) at most once per save: the services read each line once, so a repeat would count twice */
export const REPEATED_LINE = 'มีรายการซ้ำกัน — แต่ละรายการระบุได้ครั้งเดียว';
export const noRepeatedLine = (lines: Record<string, unknown>[]) => {
  const ids = lines.map((l) => l.logId).filter(Boolean);
  return new Set(ids.map(Number)).size === ids.length;
};

/** บันทึกงานซ่อม → POST /api/jobs/:no/repair (money 0–1,000,000, part qty whole 0–1000, text ≤ its column) */
export const repairActionSchema = z.looseObject({
  status: req('โปรดระบุสถานะงานซ่อม'),
  repairDetail: maxNote(200, 'วิธีการซ่อม '),
  engineerRemark: maxNote(200, 'หมายเหตุ '),
  newSerial: codeField(NEW_SERIAL_RE, NEW_SERIAL_MSG),
  serviceCost: moneyField('ค่าบริการการซ่อม'),
  toolCost: moneyField('ค่าเครื่องมือพิเศษ'),
  deliveryCost: moneyField('ค่าขนส่ง'),
  boxCost: moneyField('ค่ากล่องพัสดุ'),
  parts: z
    .array(z.looseObject({ unitPrice: moneyField('ราคาอะไหล่'), a: partOption, b: partOption }))
    .refine(noRepeatedLine, REPEATED_LINE)
    .optional(),
});

/** บันทึกงานส่งซ่อมต่อ → POST /api/jobs/:no/outsource (sending: to + date; receiving back: the receive block) */
export const outsourceActionSchema = z
  .looseObject({
    status: z.string().optional(),
    symptomOther: maxText(200, 'อาการเสีย (อื่นๆ) '),
    repairDetail: maxNote(200, 'วิธีการซ่อม '),
    send: z
      .looseObject({
        to: req('ต้องระบุ ส่งไปยัง').refine((v) => clean(v).length <= 50, 'ส่งไปยัง ยาวเกิน 50 ตัวอักษร'),
        date: isoDateString('ต้องระบุวันที่ส่ง'),
        by: staffId('ต้องเลือกผู้ส่ง'),
        detail: maxNote(100, 'หมายเหตุการส่ง '),
      })
      .optional(),
    receive: z
      .looseObject({ by: staffId('ต้องเลือกผู้รับ'), date, detail: maxNote(100, 'หมายเหตุการรับคืน ') })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (!isFilled(v.status)) ctx.addIssue({ code: 'custom', path: ['status'], message: 'โปรดระบุสถานะงานซ่อม' });
    if (!v.send && !v.receive) ctx.addIssue({ code: 'custom', path: ['send', 'to'], message: 'ต้องระบุ ส่งไปยัง' });
    // both dates are YYYY-MM-DD here, so string order = date order (the stored send date: saveOutsource)
    if (v.send?.date && v.receive?.date && v.receive.date < v.send.date)
      ctx.addIssue({ code: 'custom', path: ['receive', 'date'], message: RECEIVE_BEFORE_SEND });
  });

export const RECEIVE_BEFORE_SEND = 'วันที่รับต้องไม่ก่อนวันที่ส่ง';
/** รับคืนจาก Out-Source ต้องมีวันที่รับ (saveOutsource; หน้า Out-Source เช็กก่อนกด) — ไม่มีวันที่ = 1900 ในรายงาน */
export const RECEIVE_DATE_REQUIRED = 'ต้องระบุวันที่รับคืน';
/** หน้า Out-Source เปลี่ยนสถานะได้แค่ ส่งซ่อม / รับคืนจาก Out-Source (สถานะเดิมของงานบันทึกซ้ำได้) */
export const OUTSOURCE_STATUS_ONLY = 'หน้านี้เลือกได้เฉพาะสถานะ ส่งซ่อม Out-Source แล้ว / รับคืนจาก Out-Source แล้ว';
/** ปิดงานไม่ได้ระหว่างที่เครื่องยังอยู่ที่ Out-Source (setStatus → Finished; หน้า ปิดงาน เตือนก่อนกด) */
export const OUTSOURCE_NOT_BACK =
  'งานนี้ส่งซ่อมภายนอกอยู่ — บันทึก "รับคืนจาก Out-Source แล้ว" (วันที่รับคืน) ที่หน้า บันทึกงานส่งซ่อมต่อ (Out-Source) ก่อนปิดงาน';

/**
 * Statuses only one path sets (setStatus guards; the workflow pages offer neither): a closed one (Finished) only
 * through ปิดงาน-ส่งคืนสินค้า (the Job Closing right, return info, deposit refund), ยกเลิกข้อมูล (0) only by
 * System Admin deleting the job. The job's own status saved again unchanged still passes.
 */
export const STATUS_CLOSE_ONLY = 'เปลี่ยนเป็นสถานะปิดงานได้ที่หน้า ปิดงาน-ส่งคืนสินค้า เท่านั้น';
export const STATUS_DELETE_ONLY = 'ยกเลิกข้อมูลงานได้เฉพาะ System Admin (ลบงาน) เท่านั้น';
/** บันทึกงานซ่อม: REPAIR_STATUS_OPTIONS only (saveRepair, by id) */
export const REPAIR_STATUS_ONLY = 'หน้านี้เลือกได้เฉพาะสถานะในรายการของหน้า บันทึกงานซ่อม';
/** Swap / Refund's list: every status except the closed ones and ยกเลิกข้อมูล (what saveSwapRefund takes) */
export const SWAP_STATUS_OPTIONS = JOB_STATUS_OPTIONS.filter(
  (s) => !CLOSE_STATUS_OPTIONS.includes(s) && s !== 'ยกเลิกข้อมูล',
);
/** แก้ไขข้อมูลงาน shows the status only — it moves through the workflow pages (updateJob) */
export const EDIT_STATUS_ONLY =
  'หน้าแก้ไขข้อมูลงานเปลี่ยนสถานะไม่ได้ — ใช้หน้า บันทึกงานซ่อม / Out-Source / Swap-Refund / ปิดงาน';

/** the "key: value" lines this app writes into job.swap_refund_detail ("New S/N: …", "ยอดเงินคืน: …") */
export function parseSwap(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/**
 * The refund this page recorded ("ยอดเงินคืน: …" in swap_refund_detail), '' = none. Only that opens the page
 * in Refund mode — not any negative payment: a deposit given back at the close ("คืนมัดจำ …") is stored the
 * same way and is not the Swap / Refund page's to rewrite.
 */
export const swapRefundOf = (detail: string) => parseSwap(detail)['ยอดเงินคืน'] ?? '';

/**
 * บันทึกงาน Swap / Refund → POST /api/jobs/:no/swap-refund (refund = the body carries refund fields).
 * `job.prev` = what is stored now. (No cap at job_total_cost: a warranty job's total is 0 but the
 * refund is the purchase price.)
 */
export function swapRefundSchema(
  job: { total?: number; prev?: { newSerial?: string | null; docNo?: string | null; refundRef?: string | null } } = {},
) {
  const prev = job.prev ?? {};
  return z
    .looseObject({
      status: z.string().optional(),
      inspection: maxNote(200, 'ผลการตรวจสอบ '),
      newSerial: codeField(NEW_SERIAL_RE, NEW_SERIAL_MSG, prev.newSerial),
      docNo: codeField(
        /^[A-Z0-9][A-Z0-9/._-]{0,49}$/,
        'เลขที่เอกสารใช้ได้เฉพาะ A-Z 0-9 / . _ - (ไม่เกิน 50 ตัว)',
        prev.docNo,
      ),
      swapDate: date,
      refundDate: date,
      refundRef: codeField(PAY_NO_RE, `เลขที่บัญชี/อ้างอิง ${PAY_NO_MSG}`, prev.refundRef),
      refundAmount: moneyField('ยอดเงินคืน'),
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
}

/** job_status 8 — the parcel went out with a carrier and its number is recorded (7 = number still to come) */
export const STATUS_CLOSED_TRACKED = 'ปิดงาน-ส่งคืนสินค้า (ลงเลขที่พัสดุแล้ว)';
/** job_status 7 — closeJob moves it to 8 once a parcel no. is saved */
export const STATUS_CLOSED_WAIT_TRACKING = 'ปิดงาน-ส่งคืนสินค้า (รอลงเลขที่พัสดุ)';
export const TRACKING_REQUIRED = 'สถานะ "ลงเลขที่พัสดุแล้ว" ต้องมีหมายเลขพัสดุ — บันทึกที่หน้า ปิดงาน-ส่งคืนสินค้า';

/**
 * ซ่อมเสร็จ while parts requested from stock (เบิก) are not issued yet (setStatus; the repair page shows it
 * first, before anything is saved — stock only sees a request once the job is saved, so it says to save first)
 */
export const partsNotIssuedMsg = (parts: { code: string; name?: string }[]) =>
  `ยังเปลี่ยนเป็น "ซ่อมเสร็จ" ไม่ได้ — อะไหล่ที่ติ๊ก "เบิก" ยังไม่ได้จ่ายจากสต๊อก (${[
    ...new Set(parts.map((p) => [p.code, p.name].filter(Boolean).join(' '))),
  ].join(', ')}): บันทึกเป็น "รออะไหล่" ก่อน เพื่อส่งคำขอเบิกให้สต๊อก แล้วเปลี่ยนเป็น "ซ่อมเสร็จ" เมื่อสต๊อกจ่ายแล้ว ` +
  '— หรือเอาติ๊ก "เบิก" ออก / ลบรายการอะไหล่นั้น';

/**
 * Closed / declined / no-fault (Finished, 6, 22) while a part requested from stock (เบิก) is not issued: its
 * booking would stay forever and the job would carry a part never handed over (setStatus; the close and repair
 * pages show it first). Only on a change INTO those — a legacy job already there saves as before.
 */
export const partsWaitingMsg = (parts: { code: string; name?: string }[], status: string) =>
  `ยังเปลี่ยนเป็น "${status}" ไม่ได้ — อะไหล่ที่ติ๊ก "เบิก" ยังไม่ได้จ่ายจากสต๊อก (${[
    ...new Set(parts.map((p) => [p.code, p.name].filter(Boolean).join(' '))),
  ].join(', ')}): ยกเลิกรายการอะไหล่นั้นที่หน้า บันทึกงานซ่อม (เอาติ๊ก "เบิก" ออก / ลบรายการ) หรือรอสต๊อกจ่ายก่อน`;

/** a closed job (Finished) goes back to an open status only with the special right Job Reopen (setStatus) */
export const REOPEN_LOCKED = `งานปิดแล้ว — เปิดงานกลับได้เฉพาะผู้มี${rightLabel('Job Reopen')}`;

/** job_payment_detail = "ชำระ <date> · <note>" — a note loaded back from an earlier save drops its old date first */
export const paymentDetailOf = (date?: string | null, note?: string | null) =>
  [date ? `ชำระ ${clean(date)}` : '', clean(note).replace(/^ชำระ \d{4}-\d{2}-\d{2}(?: · |$)/, '')]
    .filter(Boolean)
    .join(' · ');
/**
 * return_customer_detail = "<courier> · <note>" — a note loaded back already starts with its courier
 * (or a longer name of it: "ไปรษณีย์ไทย · …" with courier "ไปรษณีย์") and is kept as it is, never prefixed again
 */
export function returnDetailOf(courier?: string | null, note?: string | null) {
  const c = clean(courier);
  const n = clean(note);
  return c && n.startsWith(c) ? n : [c, n].filter(Boolean).join(' · ');
}
/**
 * The maxLength of a note input the save puts something in front of (paymentDetailOf / returnDetailOf as
 * `detailOf`): 100 less what it adds — so what can be typed always saves. An empty note counts as typed
 * (the " · " comes with its first character).
 */
export function noteMaxLength(detailOf: (note: string) => string, note: string) {
  const n = clean(note) || '-';
  return 100 - detailOf(n).length + n.length;
}

/** the close page's payment fields (as loaded / as on screen) */
export type ClosePayment = { payType: string; payAmount: string; payDate: string; payNo: string; payDetail: string };
/**
 * ปิดงาน: is there a payment to send? Only fields the user changed from the form as loaded — the amount due
 * pre-filled on screen is not a payment until something is edited, and a stored refund (negative) is not
 * shown in the amount box, so it survives any re-save. A money-locked job (closed, no Job Money After Close) never sends one.
 */
export const closePaymentEdited = (d: ClosePayment, loaded: ClosePayment | null | undefined, locked: boolean) =>
  !locked &&
  !!loaded &&
  (['payType', 'payAmount', 'payDate', 'payNo', 'payDetail'] as const).some((k) => d[k] !== loaded[k]);

/** a deposit given back at close is stored as a negative payment with job_payment_detail "คืนมัดจำ <date>" */
export const REFUND_DETAIL = 'คืนมัดจำ';
export const refundDateOf = (detail: string) => /^คืนมัดจำ (\d{4}-\d{2}-\d{2})/.exec(detail)?.[1] ?? '';
export const REFUND_REQUIRED = 'ต้องบันทึกการคืนเงินมัดจำ (วิธี / จำนวน / วันที่)';

/**
 * ปิดงาน-ส่งคืนสินค้า → POST /api/jobs/:no/close. `prev` = the receipt / parcel no stored now.
 * `payment` is left out when nobody entered one (an in-warranty job): nothing is written then.
 * `refund` = the deposit to give back (jobBalance) — `max` caps the amount, `required` = nothing recorded
 * yet on an open job (closeJob decides it from the stored row).
 */
export function closeSchema(
  prev: { payNo?: string | null; tracking?: string | null; refund?: { max: number; required: boolean } } = {},
) {
  return z
    .looseObject({
      status: req('โปรดระบุสถานะงาน'),
      repairDetail: maxNote(200, 'วิธีการซ่อม '),
      payment: z
        .looseObject(
          {
            type: req('ต้องเลือกวิธีการชำระเงิน'),
            amount: moneyField('จำนวนเงินที่ชำระ'),
            date,
            no: codeField(PAY_NO_RE, `เลขที่ใบเสร็จ ${PAY_NO_MSG}`, prev.payNo),
            detail: z.string().nullish(),
          },
          { error: 'ต้องเลือกวิธีการชำระเงิน' },
        )
        .optional(),
      refund: z
        .looseObject(
          {
            type: req('ต้องเลือกวิธีการคืนเงิน'),
            amount: moneyField('จำนวนเงินที่คืน'),
            date: isoDateString('ต้องระบุวันที่คืนเงิน'),
          },
          { error: REFUND_REQUIRED },
        )
        .optional(),
      return: z.looseObject(
        {
          type: req('ต้องระบุวิธีการส่งคืนสินค้า'),
          date: isoDateString('ต้องระบุวันที่ส่งคืน'),
          tracking: trackingField(prev.tracking),
          courier: z.string().nullish(),
          detail: z.string().nullish(),
        },
        { error: 'ต้องระบุวิธีการส่งคืนสินค้า' },
      ),
    })
    .superRefine((v, ctx) => {
      const refund = prev.refund ?? { max: 0, required: false };
      if (!v.refund && refund.required)
        ctx.addIssue({ code: 'custom', path: ['refund', 'type'], message: REFUND_REQUIRED });
      const back = Number(v.refund?.amount);
      if (v.refund && !(back > 0 && Math.round(back * 100) <= Math.round(refund.max * 100)))
        ctx.addIssue({
          code: 'custom',
          path: ['refund', 'amount'],
          message: `จำนวนเงินที่คืนต้องมากกว่า 0 และไม่เกินเงินมัดจำที่ต้องคืน (${refund.max.toFixed(2)} บาท)`,
        });
      if (v.status === STATUS_CLOSED_TRACKED && !isFilled(v.return.tracking))
        ctx.addIssue({ code: 'custom', path: ['return', 'tracking'], message: 'ต้องระบุหมายเลขพัสดุ' });
      // both go into a varchar(100) with what is put in front of them
      if (v.payment && paymentDetailOf(v.payment.date, v.payment.detail).length > 100)
        ctx.addIssue({
          code: 'custom',
          path: ['payment', 'detail'],
          message: 'หมายเหตุยาวเกิน (รวมวันที่ชำระไม่เกิน 100 ตัวอักษร)',
        });
      if (returnDetailOf(v.return.courier, v.return.detail).length > 100)
        ctx.addIssue({
          code: 'custom',
          path: ['return', 'detail'],
          message: 'รายละเอียดการส่งคืนยาวเกิน (รวมชื่อบริษัทขนส่งไม่เกิน 100 ตัวอักษร)',
        });
    });
}

/**
 * What the customer still pays at close: the job total less the deposit taken at reception, never
 * below 0. job_total_cost keeps its legacy meaning (no deposit) — this is for display and defaults.
 */
export function jobAmountDue(total: number, deposit: number): number {
  return jobBalance(total, deposit, 0).due;
}

/**
 * The money at close (owner 2026-10-15), from stored values only: `due` = total − deposit (≥ 0),
 * `refund` = the deposit to give back when it is more than the total (an unrepaired job),
 * `outstanding` = ค้างชำระ, what is still unpaid after `paid` (a refund stored as a negative payment
 * counts as nothing paid).
 */
export function jobBalance(total: number, deposit: number, paid: number) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const net = r2(total - deposit);
  return { due: Math.max(0, net), refund: Math.max(0, -net), outstanding: Math.max(0, r2(net - Math.max(0, paid))) };
}

/** a closed job (Finished) keeps its money fields — only the special right Job Money After Close changes them */
const MONEY_RIGHT = `ผู้มี${rightLabel('Job Money After Close')}`;
export const MONEY_LOCKED = `งานปิดแล้ว — ช่องเงินแก้ได้เฉพาะ${MONEY_RIGHT}`;
export const moneyLockedMsg = (label: string) => `งานปิดแล้ว — แก้${label}ได้เฉพาะ${MONEY_RIGHT}`;
