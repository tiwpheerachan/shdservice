import { z } from "zod";
import { isFilled } from "./job";

/**
 * Back-office forms: master lists (หมวดหมู่ / ยี่ห้อ / สี / ประเภทงาน / ประเภทเครื่อง / อาการเสีย),
 * รุ่นสินค้า, ผู้ใช้ระบบ, อะไหล่. Required checks sit in superRefine so a missing key never stops
 * the other rules; numbers must not be negative; emails must be real when given.
 */
const nonNegative = (field: string) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .refine((v) => v === undefined || v === "" || Number.isFinite(Number(v)), `${field}ต้องเป็นตัวเลข`)
    .refine((v) => v === undefined || v === "" || Number(v) >= 0, `${field}ต้องไม่ติดลบ`);

/** a master list row — `nameLabel` is the list's own word ("ชื่อหมวดหมู่", "ชื่ออาการเสีย" …) */
export function masterSchema(nameLabel = "ชื่อ") {
  return z.looseObject({ name: z.string().optional() }).superRefine((v, ctx) => {
    if (!isFilled(v.name)) ctx.addIssue({ code: "custom", path: ["name"], message: `ต้องระบุ${nameLabel}` });
  });
}

export const modelSchema = z
  .looseObject({ name: z.string().optional(), brand: z.string().optional(), price: nonNegative("Market Price ") })
  .superRefine((v, ctx) => {
    if (!isFilled(v.name)) ctx.addIssue({ code: "custom", path: ["name"], message: "ต้องระบุ Model Name" });
    if (!isFilled(v.brand)) ctx.addIssue({ code: "custom", path: ["brand"], message: "ต้องเลือกยี่ห้อ" });
    if (!isFilled(v.price)) ctx.addIssue({ code: "custom", path: ["price"], message: "ต้องระบุ Market Price (ใส่ 0 ได้)" });
  });

export const userSchema = z
  .looseObject({
    name: z.string().optional(),
    role: z.string().optional(),
    email: z.union([z.literal(""), z.email("รูปแบบอีเมลไม่ถูกต้อง")]).optional(),
  })
  .superRefine((v, ctx) => {
    if (!isFilled(v.name)) ctx.addIssue({ code: "custom", path: ["name"], message: "ต้องระบุชื่อ-สกุล" });
    if (!isFilled(v.role)) ctx.addIssue({ code: "custom", path: ["role"], message: "ต้องเลือกประเภทผู้ใช้งาน" });
  });

export const productSchema = z
  .looseObject({
    name: z.string().optional(),
    capitalPrice: nonNegative("ราคาทุน"),
    wholesalePrice: nonNegative("ราคาขายส่ง"),
    price: nonNegative("ราคาขายปลีก"),
  })
  .superRefine((v, ctx) => {
    if (!isFilled(v.name)) ctx.addIssue({ code: "custom", path: ["name"], message: "ต้องระบุชื่ออะไหล่ (TH)" });
  });
