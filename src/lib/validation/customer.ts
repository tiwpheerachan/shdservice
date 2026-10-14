import { z } from "zod";
import type { FieldErrors } from "./index";
import { isFilled } from "./job";

/**
 * Customer form rules (ข้อมูลลูกค้า page + the quick add inside CustomerSelect) — payload = CustomerInput.
 *  - name: always
 *  - phone: a new customer needs one; an existing customer that has one must keep one
 *    ("never worse" — some legacy customers have none)
 *  - email: optional, but a real address when given
 *  - phone (when given): digits / spaces / dashes / "/" between two numbers, ≥ 9 digits — it is the
 *    /track OTP key; postal code 5 digits; tax ID 13 digits (dogfood 2026-10-14: "abcdefg" was saved)
 */
export function customerSchema(phoneRequired = true) {
  return z
    .looseObject({
      name: z.string().optional(),
      phone: z.string().optional(),
      email: z.union([z.literal(""), z.email("รูปแบบอีเมลไม่ถูกต้อง")]).optional(),
    })
    // required checks here, not on the fields: a missing key must not stop the other rules
    .superRefine((v, ctx) => {
      if (!isFilled(v.name)) ctx.addIssue({ code: "custom", path: ["name"], message: "ต้องระบุชื่อลูกค้า" });
      if (phoneRequired && !isFilled(v.phone)) ctx.addIssue({ code: "custom", path: ["phone"], message: "ต้องระบุเบอร์โทรศัพท์" });
      const phone = String(v.phone ?? "").trim();
      if (phone && (!/^[\d\s+\-/(),.]+$/.test(phone) || phone.replace(/\D/g, "").length < 9))
        ctx.addIssue({ code: "custom", path: ["phone"], message: "เบอร์โทรศัพท์ไม่ถูกต้อง (ตัวเลขอย่างน้อย 9 หลัก)" });
      const postal = String(v.postalCode ?? "").trim();
      if (postal && !/^\d{5}$/.test(postal)) ctx.addIssue({ code: "custom", path: ["postalCode"], message: "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก" });
      const taxId = String(v.taxId ?? "").replace(/[\s-]/g, "");
      if (taxId && !/^\d{13}$/.test(taxId)) ctx.addIssue({ code: "custom", path: ["taxId"], message: "เลขบัตร / ผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก" });
    });
}

/** the 409 "already belongs to another customer" answer → a message under each clashing field */
export function conflictErrors(conflicts: { field: string; code: string; name: string }[]): FieldErrors {
  const label: Record<string, string> = { phone: "เบอร์โทรศัพท์", email: "อีเมล", taxId: "เลขบัตร / ผู้เสียภาษี" };
  const out: FieldErrors = {};
  for (const c of conflicts) out[c.field] ??= `${label[c.field] ?? c.field}นี้เป็นของลูกค้า ${c.code} ${c.name} แล้ว`;
  return out;
}
