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

export const summary = (errors: FieldErrors) => `กรอกข้อมูลไม่ครบ ${Object.keys(errors).length} ช่อง`;
