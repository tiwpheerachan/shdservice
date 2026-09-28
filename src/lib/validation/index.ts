import type { z } from "zod";

/**
 * Form validation shared by the browser and the API (zod). Every form's rules live in one schema
 * under src/lib/validation — the page checks with it before sending, the API checks the same
 * schema again, so a direct API call cannot skip a rule.
 *
 * Errors travel as { field: message } — field names are the API payload's keys. The API returns
 * them as HttpError(400, "กรอกข้อมูลไม่ครบ N ช่อง", { fields }) and the page shows each one under
 * its field (see src/lib/form-errors.ts).
 */
export type FieldErrors = Record<string, string>;

/** first message per field, in the schema's field order */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function validate<S extends z.ZodType>(
  schema: S,
  data: unknown
): { ok: true; data: z.output<S> } | { ok: false; errors: FieldErrors } {
  const r = schema.safeParse(data);
  return r.success ? { ok: true, data: r.data } : { ok: false, errors: toFieldErrors(r.error) };
}

/** "กรอกข้อมูลไม่ครบ N ช่อง" (missing) / "ข้อมูลไม่ถูกต้อง N ช่อง" (wrong values) / both */
export function summary(errors: FieldErrors): string {
  const msgs = Object.values(errors);
  const missing = msgs.filter((m) => /^(ต้อง(ระบุ|เลือก|ค้นหา|มี)|โปรดระบุ)/.test(m)).length;
  const what = missing === msgs.length ? "กรอกข้อมูลไม่ครบ" : missing === 0 ? "ข้อมูลไม่ถูกต้อง" : "กรอกข้อมูลไม่ครบหรือไม่ถูกต้อง";
  return `${what} ${msgs.length} ช่อง`;
}
