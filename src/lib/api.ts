"use client";

import { toLogin } from "@/lib/navigation";

/**
 * Tiny fetch wrapper for the app's own API routes.
 *  - JSON in / JSON out, throws ApiError { status, message, details } on !ok
 *  - 401 → try to refresh the session once, then our /login page (never straight to SSO)
 *  - 403 → surfaces the server's Thai permission message
 * Every call to the app's API goes through here (or exportXlsx) — no hand-rolled fetch + 401 logic.
 */
export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  refreshing ??= fetch("/api/sso/refresh", { cache: "no-store" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 1000));
  return refreshing;
}

/**
 * Listeners run after every successful non-GET call (create/update/delete/
 * upload) — the data hooks use this to drop their cached lists so the next
 * screen shows the new rows. Registered from src/data/db.ts.
 */
const writeListeners = new Set<() => void>();
export function onApiWrite(fn: () => void) {
  writeListeners.add(fn);
  return () => writeListeners.delete(fn);
}

/** fetch under the session rules: 401 → refresh once and retry; still 401 → /login (throws) */
async function authedFetch(url: string, init: RequestInit): Promise<Response> {
  let res = await fetch(url, { cache: "no-store", ...init });
  if (res.status === 401 && (await tryRefresh())) res = await fetch(url, { cache: "no-store", ...init });
  if (res.status === 401) {
    toLogin();
    throw new ApiError(401, "กรุณาเข้าสู่ระบบใหม่");
  }
  return res;
}

/** a non-2xx answer → ApiError with the server's message (+ details such as { fields }) */
async function failure(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
  return new ApiError(res.status, data.error || `เกิดข้อผิดพลาด (${res.status})`, data.details);
}

export async function api<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await authedFetch(url, init);
  if (!res.ok) throw await failure(res);
  const data = (await res.json().catch(() => ({}))) as T;
  if ((init.method ?? "GET").toUpperCase() !== "GET") writeListeners.forEach((fn) => fn());
  return data as T;
}

const json = (method: string) => <T = unknown>(url: string, body: unknown) =>
  api<T>(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

export const postJson = json("POST");
export const patchJson = json("PATCH");
export const putJson = json("PUT");
export const del = <T = unknown>(url: string) => api<T>(url, { method: "DELETE" });

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Download an .xlsx of a list under the given filters (same params as the data hook).
 * Fetched first, saved after: a refusal (429 too many exports, 403, 500) throws an ApiError the
 * button shows as a toast — the page never navigates away to a JSON error.
 */
export async function exportXlsx(resource: string, params: Record<string, string | number | boolean | undefined | null> = {}) {
  const res = await authedFetch(`/api/export/${resource}${qs(params)}`, {});
  if (!res.ok) throw await failure(res);
  saveBlob(await res.blob(), filenameOf(res.headers.get("content-disposition")) ?? `${resource}.xlsx`);
}

/** filename from Content-Disposition (RFC 5987 filename*=UTF-8'' first, then filename="…") */
function filenameOf(cd: string | null): string | null {
  if (!cd) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) return decodeURIComponent(star[1]);
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain ? plain[1] : null;
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000); // the browser has taken the file by then
}

/** Upload one file (product image / payment slip) → stored path. */
export async function uploadFile(kind: "product-image" | "sale-order-slip" | "job-slip" | "profile-logo" | "shipper-logo", id: string, file: File) {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("id", id);
  fd.append("file", file);
  return api<{ ok: true; path: string; file: string }>("/api/upload", { method: "POST", body: fd });
}

/** URL that serves a stored file through the app (signed URL behind login). */
export const fileUrl = (path: string) => `/api/files${qs({ path })}`;
