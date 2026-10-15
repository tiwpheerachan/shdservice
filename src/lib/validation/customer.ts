import { z } from 'zod';
import { clean, maxText, type FieldErrors } from './index';
import { CUSTOMER_TYPES, PRICE_GROUPS } from '@/data/mock';

/**
 * Legacy phones carry invisible characters (zero-width space, bidi marks, BOM) and en/em dashes
 * pasted from chat apps: strip / map them before testing and before saving.
 */
export const normalizePhone = (v: unknown) =>
  String(v ?? '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
    .replace(/[\u2013\u2014]/g, '-')
    .trim();

/** Thai national ID / tax ID: 13 digits whose last one is the mod-11 check digit */
export function isThaiTaxId(v: string): boolean {
  if (!/^\d{13}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(v[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(v[12]);
}
/** a tax id as typed → what is stored: spaces / dashes dropped */
export const taxIdDigits = (v: unknown) => String(v ?? '').replace(/[\s-]/g, '');
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
/** one or more phone numbers: digits / spaces / dashes / "/" between numbers, at least 9 digits */
export const phoneFormatOk = (v: unknown) => {
  const p = normalizePhone(v);
  return /^[\d\s+\-/(),.]+$/.test(p) && digits(p).length >= 9;
};
/** a Thai mobile somewhere in the phone field (the /track OTP goes to it) — separators ignored */
export const hasThaiMobile = (v: unknown) =>
  /(?:^|\D)(?:0|\+?66)[689]\d{8}(?:\D|$)/.test(normalizePhone(v).replace(/[\s\-().]/g, ''));

/** the stored values the form opened with — an UNCHANGED legacy value still passes ("never worse") */
export type CustomerPrev = Partial<
  Record<'name' | 'phone' | 'taxId' | 'email' | 'line' | 'type' | 'priceGroup' | 'postalCode', string>
>;

/**
 * Customer form rules (ข้อมูลลูกค้า page + the quick add inside CustomerSelect) — payload = CustomerInput.
 * `prev` = the customer being edited (null / left out = a new customer).
 *  - name: 1–200 characters, not only digits
 *  - phone: a new customer needs one with a Thai mobile in it (the /track OTP key); an existing
 *    customer that has one must keep one; checked only when it changed (legacy phones stay savable)
 *  - tax ID 13 digits + check digit; postal code 5 digits; email ≤ 50; Line ID; lists for type / price group
 *  - text no longer than its column (address 100 each) — nothing is cut off silently
 */
/** the form's labels + the stored values (customers.ts maps one to the other) */
const PRICE_GROUP_VALUES = [...PRICE_GROUPS, 'Retail', 'Wholesale', 'Special'];

export function customerSchema(prev?: CustomerPrev | null) {
  const phoneRequired = !prev || !!normalizePhone(prev.phone);
  const same = (k: keyof CustomerPrev, v: unknown, norm: (x: unknown) => string = clean) =>
    prev != null && norm(v) === norm(prev[k]);
  return (
    z
      .looseObject({
        address1: maxText(100, 'ที่อยู่ '),
        address2: maxText(100, 'ซอย - ถนน '),
      })
      // required checks here, not on the fields: a missing key must not stop the other rules
      .superRefine((v, ctx) => {
        const bad = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
        const name = clean(v.name);
        if (!name) bad('name', 'ต้องระบุชื่อลูกค้า');
        else if (!same('name', v.name) && name.length > 200) bad('name', 'ชื่อลูกค้ายาวเกิน 200 ตัวอักษร');
        else if (!same('name', v.name) && /^\d+$/.test(name.replace(/\s/g, '')))
          bad('name', 'ชื่อลูกค้าต้องไม่เป็นตัวเลขอย่างเดียว');

        const phone = normalizePhone(v.phone);
        if (phoneRequired && !phone) bad('phone', 'ต้องระบุเบอร์โทรศัพท์');
        else if (phone && !same('phone', v.phone, digits)) {
          if (!phoneFormatOk(phone)) bad('phone', 'เบอร์โทรศัพท์ไม่ถูกต้อง (ตัวเลขอย่างน้อย 9 หลัก)');
          else if (phone.length > 50) bad('phone', 'เบอร์โทรศัพท์ยาวเกิน 50 ตัวอักษร');
          else if (!prev && !hasThaiMobile(phone))
            bad('phone', 'ลูกค้าใหม่ต้องมีเบอร์มือถือ (06 / 08 / 09 + 8 หลัก) — ใช้รับรหัส OTP ติดตามงาน');
        }

        const postal = clean(v.postalCode);
        if (postal && !/^\d{5}$/.test(postal) && !same('postalCode', postal))
          bad('postalCode', 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก');

        const taxId = taxIdDigits(v.taxId);
        if (taxId && !same('taxId', v.taxId, taxIdDigits)) {
          if (!/^\d{13}$/.test(taxId)) bad('taxId', 'เลขบัตร / ผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก');
          else if (!isThaiTaxId(taxId)) bad('taxId', 'เลขบัตร / ผู้เสียภาษีไม่ถูกต้อง (หลักสุดท้ายไม่ตรง)');
        }

        const email = clean(v.email).toLowerCase();
        if (email && !same('email', email, (x) => clean(x).toLowerCase())) {
          if (!z.email().safeParse(email).success) bad('email', 'รูปแบบอีเมลไม่ถูกต้อง');
          else if (email.length > 50) bad('email', 'อีเมลยาวเกิน 50 ตัวอักษร');
        }

        const line = clean(v.line);
        if (line && !same('line', line) && !/^@?[A-Za-z0-9._-]{1,20}$/.test(line))
          bad('line', 'Line ID ใช้ได้เฉพาะ A-Z a-z 0-9 . _ - (ไม่เกิน 20 ตัว ขึ้นต้นด้วย @ ได้)');

        const type = clean(v.type);
        if (type && !CUSTOMER_TYPES.includes(type) && !same('type', type)) bad('type', 'ประเภทลูกค้าไม่ถูกต้อง');
        const group = clean(v.priceGroup);
        if (group && !PRICE_GROUP_VALUES.includes(group) && !same('priceGroup', group))
          bad('priceGroup', 'กลุ่มราคาไม่ถูกต้อง');
      })
  );
}

/** the 409 "already belongs to another customer" answer → a message under each clashing field */
export function conflictErrors(conflicts: { field: string; code: string; name: string }[]): FieldErrors {
  const label: Record<string, string> = { phone: 'เบอร์โทรศัพท์', email: 'อีเมล', taxId: 'เลขบัตร / ผู้เสียภาษี' };
  const out: FieldErrors = {};
  for (const c of conflicts) out[c.field] ??= `${label[c.field] ?? c.field}นี้เป็นของลูกค้า ${c.code} ${c.name} แล้ว`;
  return out;
}
