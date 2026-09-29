/**
 * Business calendar dates ("YYYY-MM-DD") — always Thai time (Asia/Bangkok), whatever time zone
 * the device or the server runs in. Job dates are stored as Thai wall-clock in the DB, so every
 * "today" default and date range comes from here. Safe on both the client and the server.
 *
 * Never derive a date from `Date#toISOString()` — that is UTC, and between 00:00 and 06:59 Thai
 * time it is still yesterday (ESLint blocks it outside this file).
 */
export const BUSINESS_TZ = "Asia/Bangkok";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const parts = (at: Date) => Object.fromEntries(partsFmt.formatToParts(at).map((x) => [x.type, x.value]));
const pad = (n: number) => String(n).padStart(2, "0");

/** the Thai calendar date of an instant */
export function isoDate(at: Date = new Date()): string {
  const p = parts(at);
  return `${p.year}-${p.month}-${p.day}`;
}

/** the Thai wall-clock "YYYY-MM-DD HH:mm" (or "…HH:mm:ss" with `seconds`) of an instant */
export function isoDateTime(at: Date = new Date(), opts: { seconds?: boolean } = {}): string {
  const p = parts(at);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}${opts.seconds ? `:${p.second}` : ""}`;
}

/** today on the Thai calendar */
export function today(): string {
  return isoDate(new Date());
}

/** calendar arithmetic on "YYYY-MM-DD" — "2026-09-30" + 1 → "2026-10-01" (no time zone involved) */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** n days before today on the Thai calendar */
export function daysAgo(n: number): string {
  return addDays(today(), -n);
}
