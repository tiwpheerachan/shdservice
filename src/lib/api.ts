"use client";

/**
 * Tiny fetch wrapper for the app's own API routes.
 *  - JSON in / JSON out, throws ApiError { status, message } on !ok
 *  - 401 → try to refresh the session once, then bounce to SSO login
 *  - 403 → surfaces the server's Thai permission message
 */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
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
  window.location.href = "/api/sso/login?next=" + encodeURIComponent(window.location.pathname + window.location.search);
}

export async function api<T = unknown>(url: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (res.status === 401) {
    if (retry && (await tryRefresh())) return api<T>(url, init, false);
    toLogin();
    throw new ApiError(401, "กรุณาเข้าสู่ระบบใหม่");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error || `เกิดข้อผิดพลาด (${res.status})`);
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
