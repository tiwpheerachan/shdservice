'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { toLogin, waitForSignIn } from '@/lib/navigation';
import { qs } from '@/data/keys';

/**
 * Tiny fetch wrapper for the app's own API routes.
 *  - JSON in / JSON out, throws ApiError { status, message, details } on !ok
 *  - 401 → try to refresh the session once; then a read goes to our /login page (never straight to
 *    SSO), a write (save / upload) stays on the page with the "sign in again in a new tab" dialog and
 *    WAITS: once signed in again, บันทึกอีกครั้ง sends the same request (same body, same Idempotency-Key)
 *    and the page's save carries on as if nothing happened — what the user typed is never lost
 *  - 403 → surfaces the server's Thai permission message
 * Every call to the app's API goes through here (or exportXlsx) — no hand-rolled fetch + 401 logic.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** renewed, or why not (the 401's `reason` — /login says "signed out elsewhere" vs "idle") */
let refreshing: Promise<{ ok: boolean; reason?: string }> | null = null;
async function tryRefresh(): Promise<{ ok: boolean; reason?: string }> {
  refreshing ??= fetch('/api/sso/refresh', { cache: 'no-store' })
    .then(async (r) =>
      r.ok ? { ok: true } : { ok: false, reason: ((await r.json().catch(() => null)) as { reason?: string })?.reason },
    )
    .catch(() => ({ ok: false }))
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

type Send = (url: string, init: RequestInit) => Promise<Response>;
const send: Send = (url, init) => fetch(url, { cache: 'no-store', ...init });

/** fetch under the session rules: 401 → refresh once and retry; still 401 → a read goes to /login (throws), a
 *  write waits in the session-expired dialog and is sent again once the user signed in again (throws when the
 *  dialog is closed instead). `init` is re-sent as it is — same body, same Idempotency-Key. */
async function authedFetch(url: string, init: RequestInit, sendFn: Send = send): Promise<Response> {
  let res = await sendFn(url, init);
  if (res.status !== 401) return res;
  const r = await tryRefresh();
  if (r.ok) res = await sendFn(url, init);
  const write = (init.method ?? 'GET').toUpperCase() !== 'GET';
  while (res.status === 401) {
    if (!write) toLogin({ reason: r.reason });
    if (!write || !(await waitForSignIn()))
      throw new ApiError(401, 'เซสชันหมดอายุ — เข้าสู่ระบบใหม่ในแท็บใหม่ แล้วกดบันทึกอีกครั้ง');
    res = await sendFn(url, init);
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
  if ((init.method ?? 'GET').toUpperCase() !== 'GET') writeListeners.forEach((fn) => fn());
  return data as T;
}

const json =
  (method: string) =>
  <T = unknown>(url: string, body: unknown) =>
    api<T>(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

// randomUUID exists only on https / localhost — plain-http LAN access must still be able to save
const newKey = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Idempotency-Key of each POST not yet answered OK, by url + body: sending the same body again
 * (a retry after a network error / timeout, a second click) reuses the key, so the server
 * (src/server/idempotency.ts) answers with the first result instead of creating a second
 * document. An edited form is another body → a new key; after a success the key is dropped,
 * so the next submit — even an identical one — is a new document.
 */
const pendingKeys = new Map<string, string>();
export async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const payload = JSON.stringify(body ?? {});
  const id = `${url}\n${payload}`;
  const key = pendingKeys.get(id) ?? newKey();
  pendingKeys.set(id, key);
  const data = await api<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: payload,
  });
  pendingKeys.delete(id);
  return data;
}

/** 409 from optimistic locking (assertVersion): someone else saved this record after the form loaded it */
export const isStale = (e: unknown) =>
  e instanceof ApiError && e.status === 409 && (e.details as { stale?: boolean } | undefined)?.stale === true;

export const patchJson = json('PATCH');
export const del = <T = unknown>(url: string) => api<T>(url, { method: 'DELETE' });

export { qs }; // pure, in src/data/keys — the server builds the same URLs

/** the message to show for a failed call: a request that never reached the server (offline, DNS) fails with
 *  a TypeError ("Failed to fetch") — say so in Thai; the server's own refusals (ApiError) keep their message */
export const errMsg = (e: unknown) =>
  e instanceof TypeError
    ? 'เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'
    : e instanceof Error
      ? e.message
      : String(e);

/**
 * Download an .xlsx of a list under the given filters (same params as the data hook).
 * Fetched first, saved after: a refusal (429 too many exports, 403, 500) throws an ApiError the
 * button shows as a toast — the page never navigates away to a JSON error.
 */
export async function exportXlsx(
  resource: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
) {
  const res = await authedFetch(`/api/export/${resource}${qs(params)}`, {});
  if (!res.ok) throw await failure(res);
  saveBlob(await res.blob(), filenameOf(res.headers.get('content-disposition')) ?? `${resource}.xlsx`);
}

/** filename from Content-Disposition (RFC 5987 filename*=UTF-8'' first, then filename="…") */
function filenameOf(cd: string | null): string | null {
  if (!cd) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1];
  if (star) return decodeURIComponent(star);
  return /filename="?([^";]+)"?/i.exec(cd)?.[1] ?? null;
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000); // the browser has taken the file by then
}

/** Upload one file (product image / payment slip / logo) → stored path. Logos go as chosen (the server keeps them). */
export async function uploadFile(
  kind: 'product-image' | 'sale-order-slip' | 'job-slip' | 'profile-logo' | 'shipper-logo',
  id: string,
  file: File,
) {
  return upload<{ ok: true; path: string; file: string }>('/api/upload', { kind, id }, file, !kind.endsWith('-logo'));
}

/**
 * A phone photo (JPEG, or HEIC where the browser decodes it — Safari) → longest edge ≤ 1600 px, JPEG 0.82: what the
 * server's optimizeImage (src/server/storage.ts) makes of it anyway, sent at a fraction of the bytes (a 7 MB photo
 * is ~140 s on a 400 kbps uplink). EXIF orientation applied; EXIF itself (GPS) dropped. PNG / WebP (may be
 * transparent), PDF, anything the browser cannot decode → the original. Never bigger than the original.
 */
export async function shrinkImage(file: File, edge = 1600): Promise<File> {
  if (!/^image\/(jpeg|hei[cf])$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, edge / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    // HEIC must become JPEG (the server takes jpg/png/webp/pdf); a JPEG only when that is smaller
    if (!blob || (file.type === 'image/jpeg' && blob.size >= file.size)) return file;
    return new File([blob], file.name.replace(/\.(jpe?g|hei[cf])$/i, '') + '.jpg', {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    return file; // no decoder (HEIC outside Safari), out of memory… — the server decides about the original
  }
}

/** XMLHttpRequest, not fetch: only it reports how much of the body has gone up. A network error / abort rejects
 *  with a TypeError, as fetch does (errMsg says "เชื่อมต่อไม่สำเร็จ…"). */
const xhrSend =
  (onProgress: (sent: number, total: number) => void): Send =>
  (url, init) =>
    new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open(init.method ?? 'POST', url);
      new Headers(init.headers).forEach((v, k) => x.setRequestHeader(k, v));
      x.responseType = 'blob';
      x.upload.onprogress = (e) => onProgress(e.loaded, e.total);
      x.onload = () =>
        resolve(
          new Response([204, 205, 304].includes(x.status) ? null : (x.response as Blob), {
            status: x.status,
            headers: { 'content-type': x.getResponseHeader('content-type') ?? '' },
          }),
        );
      x.onerror = x.onabort = x.ontimeout = () => reject(new TypeError('upload failed'));
      x.send(init.body as XMLHttpRequestBodyInit);
    });

/** uploads in flight — FileInput is disabled meanwhile (useUploading) and closing the tab asks first */
let uploading = 0;
const uploadWatchers = new Set<() => void>();
function setUploading(d: number) {
  uploading += d;
  uploadWatchers.forEach((fn) => fn());
}
const holdUnload = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = ''; // Safari / older Chrome
};
function watchUploads(fn: () => void) {
  uploadWatchers.add(fn);
  return () => void uploadWatchers.delete(fn);
}
/** true while any upload of this tab is in flight */
export const useUploading = () =>
  React.useSyncExternalStore(
    watchUploads,
    () => uploading > 0,
    () => false,
  );

let toastNo = 0;
const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

/**
 * POST multipart `fields` + `file` (field "file") — every upload goes through here: the photo shrunk first
 * (`shrink`), a progress toast while it goes up, the session rules of authedFetch (an expired session waits in
 * the sign-in-again dialog), closing the tab asks first. A failure worth trying again (network, timeout, 5xx,
 * 429) keeps the file and asks "ลองอีกครั้ง" — the caller's promise waits for that answer; closing the toast
 * rejects. A refusal (413 / 415 / 403 …) rejects at once with the server's message.
 */
export async function upload<T>(url: string, fields: Record<string, string>, file: File, shrink = true): Promise<T> {
  const f = shrink ? await shrinkImage(file) : file;
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  body.append('file', f);
  const key = newKey(); // one per file: ลองอีกครั้ง after a lost answer gets the stored one, not a second copy
  setUploading(1);
  if (uploading === 1) window.addEventListener('beforeunload', holdUnload);
  try {
    for (;;) {
      let id = '';
      let pct = -1;
      const progress = (sent: number, total: number) => {
        const p = total ? Math.floor((sent / total) * 100) : 0;
        if (p === pct) return;
        pct = p;
        toast.loading(`กำลังอัปโหลด ${file.name}`, {
          id,
          duration: Infinity,
          description: React.createElement(
            'span',
            { className: 'mt-1 flex items-center gap-2' },
            React.createElement('progress', { value: p, max: 100, className: 'h-1.5 flex-1 accent-primary' }),
            `${p}% · ${mb(sent)}/${mb(total)} MB`,
          ),
        });
      };
      try {
        const res = await authedFetch(
          url,
          { method: 'POST', body, headers: { 'Idempotency-Key': key } },
          async (u, i) => {
            // every send (a re-send after a refresh / the sign-in dialog too) gets a toast of its own — a new id:
            // sonner may still be removing the last one
            id = `upload-${++toastNo}`;
            pct = -1;
            progress(0, f.size);
            const r = await xhrSend(progress)(u, i);
            if (r.status === 401) toast.dismiss(id); // on its way to the sign-in dialog — no stale "uploading"
            return r;
          },
        );
        if (!res.ok) throw await failure(res);
        toast.dismiss(id);
        const data = (await res.json()) as T;
        writeListeners.forEach((fn) => fn());
        return data;
      } catch (e) {
        toast.dismiss(id);
        const again = e instanceof TypeError || (e instanceof ApiError && (e.status >= 500 || e.status === 429));
        if (!again || !(await askAgain(file.name, e))) throw e;
      }
    }
  } finally {
    setUploading(-1);
    if (!uploading) window.removeEventListener('beforeunload', holdUnload);
  }
}

/** the failed upload's toast: true = ลองอีกครั้ง (same file), false = closed */
const askAgain = (name: string, e: unknown) =>
  new Promise<boolean>((resolve) =>
    toast.error(`อัปโหลด ${name} ไม่สำเร็จ`, {
      id: `upload-${++toastNo}`,
      description: errMsg(e),
      duration: Infinity,
      action: { label: 'ลองอีกครั้ง', onClick: () => resolve(true) },
      onDismiss: () => resolve(false),
    }),
  );

/** URL that serves a stored file through the app (signed URL behind login). */
export const fileUrl = (path: string) => `/api/files${qs({ path })}`;
