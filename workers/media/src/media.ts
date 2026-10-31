/**
 * The media link — ONE spec for both sides: the app signs it (src/server/storage.ts), the Worker checks it (index.ts).
 *   {MEDIA_BASE_URL}/{key, each segment URI-encoded}?exp={unix seconds}&sig={base64url HMAC-SHA256(secret, key + '\n' + exp)}
 * key = the R2 object key as stored (jobs/{no}/attachments/v….mp4). The secret is used trimmed on both sides (a pasted
 * newline must not split them). A link lives at most MAX_LINK_S. Web Crypto only: runs in Node and in Workers.
 */
/** the longest a link may live (the app signs 15 min for a video, a day for a thumbnail) */
export const MAX_LINK_S = 2 * 24 * 60 * 60;
const enc = new TextEncoder();
const hmac = (secret: string) =>
  crypto.subtle.importKey('raw', enc.encode(secret.trim()), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
const signed = (key: string, exp: number | string) => enc.encode(`${key}\n${exp}`);

export async function mediaSig(secret: string, key: string, exp: number): Promise<string> {
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await hmac(secret), signed(key, exp)));
  return btoa(String.fromCharCode(...mac))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** a link to `key` valid `seconds` from `now` */
export async function mediaUrl(base: string, secret: string, key: string, seconds: number, now = Date.now()) {
  const exp = Math.floor(now / 1000) + seconds;
  const path = key.split('/').map(encodeURIComponent).join('/');
  return `${base.replace(/\/+$/, '')}/${path}?exp=${exp}&sig=${await mediaSig(secret, key, exp)}`;
}

// 32 bytes in unpadded base64url: the last character carries 4 bits — only its canonical form (low 2 bits 0) passes,
// so one link has exactly one valid signature
const SIG = /^[\w-]{42}[AEIMQUYcgkosw048]$/;
/** signed by `secret` for `key` and not expired — crypto.subtle.verify compares in constant time */
export async function mediaSigOk(
  secret: string,
  key: string,
  exp: string | null,
  sig: string | null,
  now = Date.now(),
): Promise<boolean> {
  if (!secret.trim() || !exp || !/^\d{1,12}$/.test(exp) || !sig || !SIG.test(sig)) return false;
  const ms = Number(exp) * 1000;
  if (ms <= now || ms > now + MAX_LINK_S * 1000) return false;
  const mac = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) => c.charCodeAt(0));
  return crypto.subtle.verify('HMAC', await hmac(secret), mac, signed(key, exp));
}

/**
 * One `Range: bytes=…` of an object of `size` bytes (RFC 9110 §14). null = send it whole (no header, several ranges,
 * another unit, or an invalid range — which is ignored); 'unsatisfiable' = 416.
 */
export function parseRange(
  header: string | null,
  size: number,
): { offset: number; length: number } | null | 'unsatisfiable' {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!m || (!m[1] && !m[2])) return null;
  if (!m[1]) {
    const n = Math.min(Number(m[2]), size); // the last n bytes
    return n > 0 ? { offset: size - n, length: n } : 'unsatisfiable';
  }
  const start = Number(m[1]);
  if (m[2] && Number(m[2]) < start) return null;
  if (start >= size) return 'unsatisfiable';
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return { offset: start, length: end - start + 1 };
}
