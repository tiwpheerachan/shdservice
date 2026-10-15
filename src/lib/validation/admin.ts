import { z } from 'zod';
import { clean, cleanCode, codeField, maxText, moneyField } from './index';
import { isFilled } from './job';
import { isThaiTaxId, phoneFormatOk, taxIdDigits } from './customer';

/**
 * Back-office forms: master lists (หมวดหมู่ / ยี่ห้อ / สี / ประเภทงาน / ประเภทเครื่อง / อาการเสีย),
 * รุ่นสินค้า, ผู้ใช้ระบบ, อะไหล่. Required checks sit in superRefine so a missing key never stops
 * the other rules; numbers must not be negative; emails must be real when given.
 */
const nonNegative = (field: string) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .refine((v) => v === undefined || v === '' || Number.isFinite(Number(v)), `${field}ต้องเป็นตัวเลข`)
    .refine((v) => v === undefined || v === '' || Number(v) >= 0, `${field}ต้องไม่ติดลบ`);

/** the name field's label per master list — the page shows it and both the page and the API say "ต้องระบุ<label>" */
export const MASTER_NAME_LABEL = {
  categories: 'ชื่อหมวดหมู่',
  manufacturers: 'ชื่อยี่ห้อ',
  colors: 'ชื่อสี',
  job_types: 'ประเภทงานซ่อม',
  product_types: 'ประเภทเครื่องซ่อม',
  symptoms: 'อาการเสีย',
} as const;

/** the detail column's length per master list (category_description and manufacturer.logo_name: 50) */
export const MASTER_DETAIL_MAX: Record<keyof typeof MASTER_NAME_LABEL, number> = {
  categories: 50,
  manufacturers: 50,
  colors: 100,
  job_types: 100,
  product_types: 100,
  symptoms: 100,
};

/** master / model names compare ignoring case and every space ("POCO F5" = "poco  f5" = "POCOF5") */
export const masterNameKey = (v: unknown) => clean(v).replace(/\s/g, '').toLowerCase();
export const DUPLICATE_NAME = 'มีชื่อนี้อยู่แล้ว';

/** a master list row — `nameLabel` is the list's own word (MASTER_NAME_LABEL); the name is one line of 1–50 */
/** `days`: the master has a whole-number days field (job types: SLA, 1–365); `detailMax`: MASTER_DETAIL_MAX */
export function masterSchema(nameLabel = 'ชื่อ', opts: { days?: boolean; detailMax?: number } = {}) {
  return z
    .looseObject({
      name: z.string().optional(),
      days: z.union([z.string(), z.number()]).optional(),
      detail: maxText(opts.detailMax ?? 100, 'รายละเอียด '),
      group: maxText(50, 'กลุ่ม '),
    })
    .superRefine((v, ctx) => {
      if (!clean(v.name)) ctx.addIssue({ code: 'custom', path: ['name'], message: `ต้องระบุ${nameLabel}` });
      else if (clean(v.name).length > 50)
        ctx.addIssue({ code: 'custom', path: ['name'], message: `${nameLabel}ยาวเกิน 50 ตัวอักษร` });
      if (opts.days) {
        const n = Number(v.days);
        if (!isFilled(v.days)) ctx.addIssue({ code: 'custom', path: ['days'], message: 'ต้องระบุ SLA (วัน)' });
        else if (!Number.isInteger(n) || n < 1 || n > 365)
          ctx.addIssue({ code: 'custom', path: ['days'], message: 'SLA ต้องเป็นจำนวนวันเต็ม 1–365' });
      }
    });
}

export const modelSchema = z
  .looseObject({ name: z.string().optional(), brand: z.string().optional(), price: nonNegative('Market Price ') })
  .superRefine((v, ctx) => {
    if (!clean(v.name)) ctx.addIssue({ code: 'custom', path: ['name'], message: 'ต้องระบุ Model Name' });
    else if (clean(v.name).length > 50)
      ctx.addIssue({ code: 'custom', path: ['name'], message: 'Model Name ยาวเกิน 50 ตัวอักษร' });
    if (!isFilled(v.brand)) ctx.addIssue({ code: 'custom', path: ['brand'], message: 'ต้องเลือกยี่ห้อ' });
    if (!isFilled(v.price))
      ctx.addIssue({ code: 'custom', path: ['price'], message: 'ต้องระบุ Market Price (ใส่ 0 ได้)' });
  });

/** a phone of a staff member: 0 + 8–9 digits (spaces / dashes allowed while typing) */
export const STAFF_PHONE_RE = /^0\d{8,9}$/;
const staffPhone = (v: unknown) => clean(v).replace(/[\s-]/g, '');
const issue = (ctx: z.RefinementCtx, path: string, message: string) =>
  ctx.addIssue({ code: 'custom', path: [path], message });

/**
 * ผู้ใช้ระบบ. `prev` = the user being edited: an unchanged legacy username / phone still passes.
 * email ≤ 100 (unique — the API answers 409), username 3–50 of A-Z a-z 0-9 . _ - (unique ignoring
 * case — 409), phone 0 + 8–9 digits, Lark ID ≤ 50, branch ≤ 100; the role must be one of the
 * roles (checked by the API against app_config).
 */
export function userSchema(prev?: { username?: string | null; phone?: string | null } | null) {
  return z
    .looseObject({
      email: z
        .string()
        .nullish()
        .refine((v) => !clean(v) || z.email().safeParse(clean(v).toLowerCase()).success, 'รูปแบบอีเมลไม่ถูกต้อง')
        .refine((v) => clean(v).length <= 100, 'อีเมลยาวเกิน 100 ตัวอักษร'),
      code: maxText(50, 'Lark ID '),
      branch: maxText(100, 'สาขา / หน่วยงาน '),
    })
    .superRefine((v, ctx) => {
      const [first = '', ...rest] = clean(v.name).split(' ');
      if (!first) issue(ctx, 'name', 'ต้องระบุชื่อ-สกุล');
      else if (first.length > 50 || rest.join(' ').length > 50)
        issue(ctx, 'name', 'ชื่อและนามสกุลต้องยาวไม่เกินอย่างละ 50 ตัวอักษร');
      if (!isFilled(v.role)) issue(ctx, 'role', 'ต้องเลือกประเภทผู้ใช้งาน');
      const username = clean(v.username);
      if (username && !/^[A-Za-z0-9._-]{3,50}$/.test(username) && username !== clean(prev?.username))
        issue(ctx, 'username', 'Username ใช้ได้เฉพาะ A-Z a-z 0-9 . _ - (3–50 ตัว)');
      const phone = staffPhone(v.phone);
      if (phone && !STAFF_PHONE_RE.test(phone) && phone !== staffPhone(prev?.phone))
        issue(ctx, 'phone', 'เบอร์โทรศัพท์ต้องเป็น 0 ตามด้วยตัวเลข 8–9 หลัก');
    });
}

/** รหัสอะไหล่ (ผู้ผลิต) — decided by the owner 2026-10-15: one code, A-Z 0-9 . _ / - only, upper-case;
 *  no Thai, spaces or commas (no lists, no notes), never a "CANCEL_" leftover; "-" means none */
export const MFG_CODE_RE = /^(?!CANCEL_)[A-Z0-9][A-Z0-9._/-]{0,49}$/;
export const MFG_CODE_MSG = 'รหัสผู้ผลิต: ใช้ได้เฉพาะ A-Z 0-9 . _ / - (ไม่มีภาษาไทย ช่องว่าง หรือหลายรหัส)';
/** the vendor code as stored: cleanCode(), "-" → "" */
export const cleanMfgCode = (v: unknown) => {
  const c = cleanCode(v);
  return c === '-' ? '' : c;
};

/**
 * อะไหล่. `prev` = the product being edited: an unchanged legacy vendor code still passes.
 * Names TH 1–500 / EN, CN ≤ 200, description ≤ 200 (the columns); prices money 0–1,000,000 and
 * retail not below capital when both are set. Category / brand / models must exist (the API checks).
 */
export function productSchema(prev?: { mfgCode?: string | null } | null) {
  return z
    .looseObject({
      mfgCode: z.preprocess((v) => (cleanMfgCode(v) ? v : ''), codeField(MFG_CODE_RE, MFG_CODE_MSG, prev?.mfgCode)),
      name: maxText(500, 'ชื่ออะไหล่ (TH) '),
      nameEn: maxText(200, 'ชื่ออะไหล่ (EN) '),
      nameCn: maxText(200, 'ชื่ออะไหล่ (CN) '),
      description: maxText(200, 'รายละเอียด'),
      forModelColor: maxText(50, 'สีสินค้า '),
      capitalPrice: moneyField('ราคาทุน'),
      wholesalePrice: moneyField('ราคาขายส่ง'),
      price: moneyField('ราคาขายปลีก'),
    })
    .superRefine((v, ctx) => {
      if (!clean(v.name)) issue(ctx, 'name', 'ต้องระบุชื่ออะไหล่ (TH)');
      if (Number(v.price) > 0 && Number(v.capitalPrice) > 0 && Number(v.price) < Number(v.capitalPrice))
        issue(ctx, 'price', 'ราคาขายปลีกต้องไม่ต่ำกว่าราคาทุน');
    });
}

/** short code of a profile / courier (SHD, FLASH): A-Z 0-9 _ - , 2–20 */
export const PROFILE_CODE_RE = /^[A-Z0-9_-]{2,20}$/;
const sortOrder = z
  .union([z.number(), z.string()])
  .nullish()
  .refine(
    (v) => v == null || v === '' || (/^\d+$/.test(String(v).trim()) && +v <= 999),
    'ลำดับต้องเป็นจำนวนเต็ม 0–999',
  );

/** โปรไฟล์ผู้ออกเอกสาร: code + Thai company name; tax id / email / phone / bank account when given */
export const documentProfileSchema = z
  .looseObject({
    nameEn: maxText(200, 'ชื่อบริษัท (EN) '),
    addressLine1: maxText(200, 'ที่อยู่ '),
    addressLine2: maxText(200, 'ที่อยู่ '),
    email: z
      .string()
      .nullish()
      .refine((v) => !clean(v) || z.email().safeParse(clean(v).toLowerCase()).success, 'รูปแบบอีเมลไม่ถูกต้อง')
      .refine((v) => clean(v).length <= 100, 'อีเมลยาวเกิน 100 ตัวอักษร'),
    bankName: maxText(100, 'ธนาคาร '),
    bankAccountType: maxText(50, 'ประเภทบัญชี '),
    bankAccountName: maxText(200, 'ชื่อบัญชี '),
    sortOrder,
  })
  .superRefine((v, ctx) => {
    const code = cleanCode(v.code);
    if (!code) issue(ctx, 'code', 'ต้องระบุรหัสโปรไฟล์ (เช่น SHD)');
    else if (!PROFILE_CODE_RE.test(code)) issue(ctx, 'code', 'รหัสใช้ได้เฉพาะ A-Z 0-9 _ - (2–20 ตัว)');
    const nameTh = clean(v.nameTh);
    if (!nameTh) issue(ctx, 'nameTh', 'ต้องระบุชื่อบริษัท');
    else if (nameTh.length > 200) issue(ctx, 'nameTh', 'ชื่อบริษัทยาวเกิน 200 ตัวอักษร');
    const taxId = taxIdDigits(v.taxId);
    if (taxId && !isThaiTaxId(taxId)) issue(ctx, 'taxId', 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลักที่ถูกต้อง');
    const phone = clean(v.phone);
    if (phone && (!phoneFormatOk(phone) || phone.length > 50))
      issue(ctx, 'phone', 'เบอร์โทรศัพท์ไม่ถูกต้อง (เบอร์ละ 9–10 หลัก หลายเบอร์คั่นด้วย /)');
    const account = clean(v.bankAccountNo);
    if (account && !/^[0-9-]{10,20}$/.test(account))
      issue(ctx, 'bankAccountNo', 'เลขที่บัญชีใช้ได้เฉพาะตัวเลขและ - (10–20 ตัว)');
  });

/** บริษัทขนส่ง: code + Thai name; the tracking link (optional) is https and has {no} where the parcel number goes */
export const shippingProfileSchema = z
  .looseObject({ nameEn: maxText(200, 'ชื่อ (EN) '), sortOrder })
  .superRefine((v, ctx) => {
    const code = cleanCode(v.code);
    if (!code) issue(ctx, 'code', 'ต้องระบุรหัส (เช่น FLASH)');
    else if (!PROFILE_CODE_RE.test(code)) issue(ctx, 'code', 'รหัสใช้ได้เฉพาะ A-Z 0-9 _ - (2–20 ตัว)');
    const nameTh = clean(v.nameTh);
    if (!nameTh) issue(ctx, 'nameTh', 'ต้องระบุชื่อบริษัทขนส่ง');
    else if (nameTh.length > 200) issue(ctx, 'nameTh', 'ชื่อบริษัทขนส่งยาวเกิน 200 ตัวอักษร');
    const url = clean(v.trackUrl);
    if (url.length > 300) issue(ctx, 'trackUrl', 'ลิงก์ติดตามยาวเกิน 300 ตัวอักษร');
    else if (url && !/^https:\/\//i.test(url)) issue(ctx, 'trackUrl', 'ลิงก์ติดตามต้องขึ้นต้นด้วย https://');
    else if (url && !/\{no\}/i.test(url)) issue(ctx, 'trackUrl', 'ลิงก์ติดตามต้องมี {no} ตรงตำแหน่งเลขพัสดุ');
  });
