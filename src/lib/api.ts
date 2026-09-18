"use client";

/**
 * Tiny fetch wrapper for the app's own API routes.
 *  - JSON in / JSON out, throws ApiError { status, message } on !ok
 *  - 401 → try to refresh the session once, then bounce to SSO login
 *  - 403 → surfaces the server's Thai permission message
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

function toLogin() {
  if (typeof window === "undefined") return;
  window.location.href = "/login?expired=1&next=" + encodeURIComponent(window.location.pathname + window.location.search);
}

export async function api<T = unknown>(url: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (res.status === 401) {
    if (retry && (await tryRefresh())) return api<T>(url, init, false);
    toLogin();
    throw new ApiError(401, "กรุณาเข้าสู่ระบบใหม่");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; details?: unknown };
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error || `เกิดข้อผิดพลาด (${res.status})`, (data as { details?: unknown })?.details);
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

/** Open an .xlsx download of a list under the given filters (same params as the data hook). */
export function exportXlsx(resource: string, params: Record<string, string | number | boolean | undefined | null> = {}) {
  if (typeof window === "undefined") return;
  window.location.href = `/api/export/${resource}${qs(params)}`;
}

/** Upload one file (product image / payment slip) → stored path. */
export async function uploadFile(kind: "product-image" | "sale-order-slip" | "job-slip" | "profile-logo", id: string, file: File) {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("id", id);
  fd.append("file", file);
  return api<{ ok: true; path: string; file: string }>("/api/upload", { method: "POST", body: fd });
}

/** URL that serves a stored file through the app (signed URL behind login). */
export const fileUrl = (path: string) => `/api/files${qs({ path })}`;
