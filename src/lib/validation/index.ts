import * as z from 'zod';

// browser: the CSP allows no eval, and zod's probe for it (new Function) is reported as a violation even
// though zod catches it — skip the probe and the JIT it would enable (every schema file imports this one)
if (typeof window !== 'undefined') z.config({ jitless: true });

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

/* ------------------------------------------------------------------ *
 * Text hygiene — shared by every form (browser) and every service (server write path).
 * The legacy data is full of invisible characters, non-breaking spaces, a Thai mark typed
 * before an English word ("ฺBlack"), and Greek/Cyrillic look-alikes in tracking numbers
 * ("ED006390635ΤΗ") — all of which look right and never match a search. Services must
 * WRITE clean()/cleanCode() values: assertValid only checks, it does not transform the input.
 * ------------------------------------------------------------------ */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;
const LEADING_THAI_MARK = /^[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]+/;

/** one-line text: no invisible chars, any whitespace run → one space, trimmed, no leading Thai mark */
export const clean = (v: unknown): string =>
  String(v ?? '')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEADING_THAI_MARK, '');

/** multi-line text (notes, remarks): same as clean() but keeps line breaks */
export const cleanText = (v: unknown): string =>
  String(v ?? '')
    .replace(INVISIBLE, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
    .replace(LEADING_THAI_MARK, '');

const LOOKALIKE: Record<string, string> = {
  Α: 'A',
  Β: 'B',
  Ε: 'E',
  Η: 'H',
  Ι: 'I',
  Κ: 'K',
  Μ: 'M',
  Ν: 'N',
  Ο: 'O',
  Ρ: 'P',
  Τ: 'T',
  Χ: 'X',
  Υ: 'Y',
  Ζ: 'Z',
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  Х: 'X',
};
/** an identifier (codes, serials, tracking numbers): clean(), look-alikes folded, upper-case */
export const cleanCode = (v: unknown): string =>
  clean(v)
    .replace(/[ΑΒΕΗΙΚΜΝΟΡΤΧΥΖАВЕКМНОРСТХ]/g, (c) => LOOKALIKE[c] ?? c)
    .toUpperCase();

/* the Thai Kedmanee keyboard over the US one, key by key (unshifted, then shifted): "หฟสำ" = "sale" typed with
   the keyboard left on Thai. Thai digits ๐–๙ (shift + the number row) count as the digits they are. */
const US_KEYS = "1234567890-=qwertyuiop[]asdfghjkl;'zxcvbnm,./" + '!@#$%^&*()_+QWERTYUIOP{}ASDFGHJKL:"ZXCVBNM<>?';
const TH_KEYS = 'ๅ/-ภถุึคตจขชๆไำพะัีรนยบลฟหกดเ้่าสวงผปแอิืทมใฝ' + '+๑๒๓๔ู฿๕๖๗๘๙๐"ฎฑธํ๊ณฯญฐ,ฤฆฏโฌ็๋ษศซ.()ฉฮฺ์?ฒฬฦ';
const THAI = /[\u0E00-\u0E7F]/;
const ON_THAI = new Map<string, string>(
  [...TH_KEYS].flatMap((t, i) => (THAI.test(t) ? [[t, US_KEYS[i]!] as const] : [])),
);
for (let d = 0; d <= 9; d++) ON_THAI.set(String.fromCharCode(0x0e50 + d), String(d));
/** on the Thai layout the number row's 2 and 3 keys type "/" and "-": an IMEI 35… comes out as "-ถ…" (QA 2026-10-27) */
const MARK_KEYS = new Map([
  ['/', '2'],
  ['-', '3'],
]);
/**
 * What `v` was meant to be when typed with the keyboard on Thai — null when it holds no Thai character. "/" and "-"
 * are read as the 2 / 3 keys they are on that layout, unless `keepMarks` (a value typed partly in English, where
 * they are the marks a serial may carry): offer the reading the field accepts.
 */
export const typedOnThai = (v: unknown, keepMarks = false): string | null => {
  const s = String(v ?? '');
  return THAI.test(s) ? [...s].map((c) => ON_THAI.get(c) ?? (keepMarks ? c : (MARK_KEYS.get(c) ?? c))).join('') : null;
};

/** a parcel number as stored: cleanCode() without spaces ("ED 0063 9063 5TH" → "ED006390635TH") */
export const cleanTracking = (v: unknown) => cleanCode(v).replace(/\s/g, '');
/** optional parcel number (job reception / return, sale-order delivery — varchar 50); an unchanged legacy value (`prev`) passes */
const TRACKING_RE = /^[A-Z0-9][A-Z0-9-]{5,39}$/;
/** a well-formed parcel number (the rule below, on the cleaned value) */
export const trackingAccepts = (v: unknown) => TRACKING_RE.test(cleanTracking(v));
export const trackingField = (prev?: string | null) =>
  z
    .string()
    .nullish()
    .refine((v) => {
      const c = cleanTracking(v);
      return !c || TRACKING_RE.test(c) || (prev != null && c === cleanTracking(prev));
    }, 'เลขพัสดุใช้ได้เฉพาะ A-Z 0-9 และ - (6–40 ตัว ไม่มีภาษาไทยหรือช่องว่าง)');

/** free text of at most `max` characters (after clean) — the column length, so nothing is cut silently */
export const maxText = (max: number, label = '') =>
  z
    .string()
    .nullish()
    .refine((v) => clean(v).length <= max, `${label}ยาวเกิน ${max} ตัวอักษร`);

/** like maxText for multi-line fields (keeps line breaks when counting) */
export const maxNote = (max: number, label = '') =>
  z
    .string()
    .nullish()
    .refine((v) => cleanText(v).length <= max, `${label}ยาวเกิน ${max} ตัวอักษร`);

/**
 * An optional identifier checked against `re` after cleanCode(). `prev` = the value stored now:
 * an UNCHANGED legacy value still passes ("never worse" — an old record can be saved without
 * first fixing a field nobody touched); a changed or new value must match.
 */
export const codeField = (re: RegExp, msg: string, prev?: string | null) =>
  z
    .string()
    .nullish()
    .refine((v) => {
      const c = cleanCode(v);
      return c === '' || re.test(c) || (prev != null && c === cleanCode(prev));
    }, msg);

/** money: 0–max, at most 2 decimals (numeric(18,2) columns; a bigger value would fail the save as a 500) */
export const moneyField = (label: string, max = 1_000_000) =>
  z
    .union([z.number(), z.string()])
    .nullish()
    .refine(
      (v) => v == null || v === '' || (/^\d+(\.\d{1,2})?$/.test(String(v).trim()) && Number(v) <= max),
      `${label}ต้องเป็นจำนวนเงิน 0–${max.toLocaleString('en-US')} (ทศนิยมไม่เกิน 2 ตำแหน่ง)`,
    );

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
