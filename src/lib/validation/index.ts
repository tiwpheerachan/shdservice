import { z } from 'zod';

/**
 * Form validation shared by the browser and the API (zod). Every form's rules live in one schema
 * under src/lib/validation — the page checks with it before sending, the API checks the same
 * schema again, so a direct API call cannot skip a rule.
 *
 * Errors travel as { field: message } — field names are the API payload's keys. The API returns
 * them as HttpError(400, "กรอกข้อมูลไม่ครบ N ช่อง", { fields }) and the page shows each one under
 * its field (see src/lib/use-form-errors.ts).
 */
export type FieldErrors = Record<string, string>;

/** a real calendar day "YYYY-MM-DD" (same rule as ymd() in server/paging.ts) — 2026-02-30 or "abc"
 *  would reach a date column and fail the save as a 500 */
export function isRealDate(s: string): boolean {
  const [m, y, mo, d] = /^([12]\d{3})-(\d{2})-(\d{2})$/.exec(s) ?? [];
  if (!m || !y || !mo || !d) return false;
  const t = new Date(Date.UTC(+y, +mo - 1, +d));
  return t.getUTCMonth() === +mo - 1 && t.getUTCDate() === +d;
}

/** a date field: `msg` when missing / not YYYY-MM-DD, "วันที่ไม่ถูกต้อง" when there is no such day */
export const isoDateString = (msg = 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)') =>
  z
    .string({ error: msg })
    .regex(/^\d{4}-\d{2}-\d{2}$/, msg)
    .refine(isRealDate, 'วันที่ไม่ถูกต้อง (ไม่มีวันนี้ในปฏิทิน)');

/** first message per field, in the schema's field order */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function validate<S extends z.ZodType>(
  schema: S,
  data: unknown,
): { ok: true; data: z.output<S> } | { ok: false; errors: FieldErrors } {
  const r = schema.safeParse(data);
  return r.success ? { ok: true, data: r.data } : { ok: false, errors: toFieldErrors(r.error) };
}

/** "กรอกข้อมูลไม่ครบ N ช่อง" (missing) / "ข้อมูลไม่ถูกต้อง N ช่อง" (wrong values) / both */
export function summary(errors: FieldErrors): string {
  const msgs = Object.values(errors);
  const missing = msgs.filter((m) => /^(ต้อง(ระบุ|เลือก|ค้นหา|มี)|โปรดระบุ)/.test(m)).length;
  const what =
    missing === msgs.length
      ? 'กรอกข้อมูลไม่ครบ'
      : missing === 0
        ? 'ข้อมูลไม่ถูกต้อง'
        : 'กรอกข้อมูลไม่ครบหรือไม่ถูกต้อง';
  return `${what} ${msgs.length} ช่อง`;
}
