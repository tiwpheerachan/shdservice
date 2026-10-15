import { z } from 'zod';
import { isFilled } from './job';

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

/** a master list row — `nameLabel` is the list's own word (MASTER_NAME_LABEL) */
/** `days`: the master has a whole-number days field (job types: SLA, 1–365) */
export function masterSchema(nameLabel = 'ชื่อ', opts: { days?: boolean } = {}) {
  return z
    .looseObject({ name: z.string().optional(), days: z.union([z.string(), z.number()]).optional() })
    .superRefine((v, ctx) => {
      if (!isFilled(v.name)) ctx.addIssue({ code: 'custom', path: ['name'], message: `ต้องระบุ${nameLabel}` });
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
    if (!isFilled(v.name)) ctx.addIssue({ code: 'custom', path: ['name'], message: 'ต้องระบุ Model Name' });
    if (!isFilled(v.brand)) ctx.addIssue({ code: 'custom', path: ['brand'], message: 'ต้องเลือกยี่ห้อ' });
    if (!isFilled(v.price))
      ctx.addIssue({ code: 'custom', path: ['price'], message: 'ต้องระบุ Market Price (ใส่ 0 ได้)' });
  });

export const userSchema = z
  .looseObject({
    name: z.string().optional(),
    role: z.string().optional(),
    email: z.union([z.literal(''), z.email('รูปแบบอีเมลไม่ถูกต้อง')]).optional(),
  })
  .superRefine((v, ctx) => {
    if (!isFilled(v.name)) ctx.addIssue({ code: 'custom', path: ['name'], message: 'ต้องระบุชื่อ-สกุล' });
    if (!isFilled(v.role)) ctx.addIssue({ code: 'custom', path: ['role'], message: 'ต้องเลือกประเภทผู้ใช้งาน' });
  });

export const productSchema = z
  .looseObject({
    name: z.string().optional(),
    capitalPrice: nonNegative('ราคาทุน'),
    wholesalePrice: nonNegative('ราคาขายส่ง'),
    price: nonNegative('ราคาขายปลีก'),
  })
  .superRefine((v, ctx) => {
    if (!isFilled(v.name)) ctx.addIssue({ code: 'custom', path: ['name'], message: 'ต้องระบุชื่ออะไหล่ (TH)' });
  });

/** โปรไฟล์ผู้ออกเอกสาร: code + Thai company name */
export const documentProfileSchema = z
  .looseObject({ code: z.string().optional(), nameTh: z.string().optional() })
  .superRefine((v, ctx) => {
    if (!isFilled(v.code)) ctx.addIssue({ code: 'custom', path: ['code'], message: 'ต้องระบุรหัสโปรไฟล์ (เช่น SHD)' });
    if (!isFilled(v.nameTh)) ctx.addIssue({ code: 'custom', path: ['nameTh'], message: 'ต้องระบุชื่อบริษัท' });
  });

/** บริษัทขนส่ง: code + Thai name; the tracking link (optional) is https and has {no} where the parcel number goes */
export const shippingProfileSchema = z
  .looseObject({ code: z.string().optional(), nameTh: z.string().optional(), trackUrl: z.string().optional() })
  .superRefine((v, ctx) => {
    if (!isFilled(v.code)) ctx.addIssue({ code: 'custom', path: ['code'], message: 'ต้องระบุรหัส (เช่น FLASH)' });
    if (!isFilled(v.nameTh)) ctx.addIssue({ code: 'custom', path: ['nameTh'], message: 'ต้องระบุชื่อบริษัทขนส่ง' });
    const url = v.trackUrl?.trim() ?? '';
    if (url && !/^https:\/\//i.test(url))
      ctx.addIssue({ code: 'custom', path: ['trackUrl'], message: 'ลิงก์ติดตามต้องขึ้นต้นด้วย https://' });
    else if (url && !/\{no\}/i.test(url))
      ctx.addIssue({ code: 'custom', path: ['trackUrl'], message: 'ลิงก์ติดตามต้องมี {no} ตรงตำแหน่งเลขพัสดุ' });
  });
