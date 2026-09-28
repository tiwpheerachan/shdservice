import { z } from "zod";
import type { FieldErrors } from "./index";
import { isFilled } from "./job";

/**
 * Customer form rules (ข้อมูลลูกค้า page + the quick add inside CustomerSelect) — payload = CustomerInput.
 *  - name: always
 *  - phone: a new customer needs one; an existing customer that has one must keep one
 *    ("never worse" — some legacy customers have none)
 *  - email: optional, but a real address when given
 */
export function customerSchema(phoneRequired = true) {
  return z
    .looseObject({
      name: z.string({ error: "ต้องระบุชื่อลูกค้า" }).trim().min(1, "ต้องระบุชื่อลูกค้า"),
      phone: z.string().optional(),
      email: z.union([z.literal(""), z.email("รูปแบบอีเมลไม่ถูกต้อง")]).optional(),
    })
    .superRefine((v, ctx) => {
      if (phoneRequired && !isFilled(v.phone)) ctx.addIssue({ code: "custom", path: ["phone"], message: "ต้องระบุเบอร์โทรศัพท์" });
    });
}

/** the 409 "already belongs to another customer" answer → a message under each clashing field */
export function conflictErrors(conflicts: { field: string; code: string; name: string }[]): FieldErrors {
  const label: Record<string, string> = { phone: "เบอร์โทรศัพท์", email: "อีเมล", taxId: "เลขบัตร / ผู้เสียภาษี" };
  const out: FieldErrors = {};
  for (const c of conflicts) out[c.field] ??= `${label[c.field] ?? c.field}นี้เป็นของลูกค้า ${c.code} ${c.name} แล้ว`;
  return out;
}
