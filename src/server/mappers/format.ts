// Value helpers shared by every mapper. The legacy DB stores `timestamp` without
// time zone holding Thai wall-clock time and uses sentinels (1900-01-01, -1, 0)
// for "empty". The UI expects plain strings ("YYYY-MM-DD", "YYYY-MM-DD HH:mm").

const pad = (n: number) => String(n).padStart(2, "0");

/** Is this legacy value a "no value" sentinel? */
export function isSentinelDate(v: string | Date | null | undefined): boolean {
  if (!v) return true;
  const s = typeof v === "string" ? v : v.toISOString();
  return s.startsWith("1900-01-01") || s.startsWith("0001-01-01");
}

/** `timestamp` (string from pg, Thai local) → "YYYY-MM-DD" or "". */
export function fmtDate(v: string | Date | null | undefined): string {
  if (isSentinelDate(v)) return "";
  const s = typeof v === "string" ? v : v!.toISOString();
  return s.slice(0, 10);
}

/** → "YYYY-MM-DD HH:mm" or "". */
export function fmtDateTime(v: string | Date | null | undefined): string {
  if (isSentinelDate(v)) return "";
  const s = typeof v === "string" ? v : v!.toISOString();
  return s.slice(0, 16).replace("T", " ");
}

/** Current Thai wall-clock time as a pg-compatible `timestamp` string. */
export function nowThai(): string {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/** Today's Thai date "YYYY-MM-DD". */
export function todayThai(): string {
  return nowThai().slice(0, 10);
}

/** Thai calendar year (CE) used for yearly running numbers. */
export function thaiYear(): number {
  return Number(todayThai().slice(0, 4));
}

/** numeric/varchar money → number. */
export function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** number → numeric column string with 2 decimals. */
export function money(n: number | null | undefined): string {
  return (Number.isFinite(n as number) ? (n as number) : 0).toFixed(2);
}

export const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));
export const int = (v: unknown, d = 0): number => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
};
/** Date input ("YYYY-MM-DD" | "") → timestamp string or the legacy sentinel. */
export const dateOrSentinel = (v: unknown): string => {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) + (s.length > 10 ? s.slice(10, 19).replace("T", " ") : " 00:00:00") : "1900-01-01 00:00:00";
};
export const dateOrNull = (v: unknown): string | null => {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
export const SENTINEL_TS = "1900-01-01 00:00:00";
