import { originAuthMode, originAuthOk } from "./origin-auth";

/**
 * The ONE place that decides the client IP (rate limits, ticket binding, logs).
 *
 * `CF-Connecting-IP` is trusted only AFTER the request proved it came through
 * Cloudflare (X-Origin-Auth) — anyone hitting the origin directly can send any
 * header. X-Forwarded-For / X-Real-IP are client-controlled and only used while
 * the origin check is off (local dev) or in `log` rollout mode, where nothing
 * is trusted anyway. In `enforce` mode a request without the secret never gets
 * past the proxy (src/proxy.ts) (only /api/health, which does not use the IP).
 */
export const UNKNOWN_IP = "0.0.0.0";

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-f:]{2,39}$/i;

export function normalizeIp(v: string | null | undefined): string | null {
  let s = (v ?? "").trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith("::ffff:") && IPV4.test(s.slice(7))) s = s.slice(7); // IPv4-mapped IPv6
  if (IPV4.test(s)) return s;
  if (s.includes(":") && IPV6.test(s)) return s.toLowerCase();
  return null;
}

/**
 * The address a RATE LIMIT counts against: IPv4 as itself, IPv6 by its /64 (one
 * household / VM allocation — a client rotates through it for free). Rate keys only:
 * logs and ticket binding keep the full clientIp(). (OneLink lib/redirect/rate-limit.ts bucketOf)
 * Expects normalizeIp() output: lower-case, IPv4-mapped already unwrapped.
 */
export function ipBucket(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = ip.includes("::") && tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export function clientIp(headers: Headers): string {
  const mode = originAuthMode();
  if (mode !== "off" && originAuthOk(headers)) {
    return normalizeIp(headers.get("cf-connecting-ip")) ?? UNKNOWN_IP;
  }
  if (mode === "enforce") return UNKNOWN_IP;
  // off / log: untrusted, best effort
  return (
    normalizeIp(headers.get("x-forwarded-for")?.split(",")[0]) ??
    normalizeIp(headers.get("x-real-ip")) ??
    (mode === "off" ? "127.0.0.1" : UNKNOWN_IP)
  );
}
