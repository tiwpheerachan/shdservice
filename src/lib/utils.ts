import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export type { ClassValue };

/** Merge class names; conflicting Tailwind utilities resolve to the last one (shadcn convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export const baht = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const int = (n: number) => n.toLocaleString("th-TH");

export const pct = (n: number) =>
  `${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

export function today(offsetDays = 0) {
  const d = new Date(2026, 8, 4);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function fmtDateTime(s: string) {
  return s;
}

export function slugTitle(s: string) {
  return s.replace(/-/g, " ");
}

/**
 * Minimum length before a free-text search is sent to the server. The
 * pg_trgm indexes need 3 consecutive characters — a 1–2 character term
 * cannot use them and falls back to scanning the whole table (≈400 ms on
 * 43k customers, worse on 48k jobs), for results nobody can use anyway.
 */
export const SEARCH_MIN_CHARS = 3;
export const SEARCH_MIN_HINT = `พิมพ์อย่างน้อย ${SEARCH_MIN_CHARS} ตัวอักษร`;
