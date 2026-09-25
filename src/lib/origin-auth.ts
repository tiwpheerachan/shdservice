/**
 * Origin protection — Cloudflare adds `X-Origin-Auth: <ORIGIN_AUTH_SECRET>` to
 * every request it forwards (Transform Rule, "Set static"), so a request that
 * reaches Render without it came around Cloudflare (e.g. straight at
 * shdservice.onrender.com) and none of its headers can be trusted.
 *
 * Edge-safe (used by the middleware): no node:crypto.
 *
 * ORIGIN_AUTH_MODE
 *   off      no check (local dev)                 — default outside production
 *   log      check, log a miss, let it through    — rollout: confirm nothing legit misses it
 *   enforce  check, 403 on a miss                 — default in production
 * In production a missing secret is a misconfiguration: `enforce` then answers
 * 503 (fail closed) instead of silently opening the door.
 */
export type OriginAuthMode = "off" | "log" | "enforce";

export const ORIGIN_AUTH_HEADER = "x-origin-auth";

export function originAuthMode(): OriginAuthMode {
  const m = (process.env.ORIGIN_AUTH_MODE ?? "").trim().toLowerCase();
  if (m === "off" || m === "log" || m === "enforce") return m;
  return process.env.NODE_ENV === "production" ? "enforce" : "off";
}

export function originAuthSecret(): string {
  return (process.env.ORIGIN_AUTH_SECRET ?? "").trim();
}

/** constant-time string compare (no early exit on the first differing char) */
function sameString(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** true when the request carries the Cloudflare origin secret */
export function originAuthOk(headers: Headers): boolean {
  const secret = originAuthSecret();
  if (!secret) return false;
  return sameString(headers.get(ORIGIN_AUTH_HEADER) ?? "", secret);
}
