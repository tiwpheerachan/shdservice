import type { NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE } from '@/lib/session';
import { HttpError } from '@/server/http-error'; // not @/server/auth: keeps the db client out (and the test pure)
import { clientIp, ipBucket } from '@/lib/client-ip';

/**
 * Small in-memory sliding-window rate limiter — enough for a single Render
 * instance to stop one client (script, stuck tab, abuse) from pinning the CPU
 * with exports / searches / directory lookups. Keyed by the signed-in email
 * (cheap: HMAC check only, no DB) or, when anonymous, by the client IP.
 * Resets on deploy; not a security boundary — the auth guards still run.
 */
const buckets = new Map<string, number[]>();
let lastSweep = 0;
/** a ceiling, so the limiter cannot itself become the leak */
export const MAX_BUCKETS = 20_000;

function sweep(now: number, force = false) {
  if (!force && now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, hits] of buckets) {
    const last = hits.at(-1);
    if (last === undefined || now - last > 5 * 60_000) buckets.delete(k);
  }
  if (buckets.size < MAX_BUCKETS) return;
  // all still live → drop the oldest tenth (Map = insertion order), never the whole map:
  // whoever can open 20,000 keys would otherwise reset everyone's count
  let evict = Math.ceil(MAX_BUCKETS / 10);
  for (const k of buckets.keys()) {
    if (evict-- <= 0) break;
    buckets.delete(k);
  }
}

/** for the test only */
export const bucketCount = () => buckets.size;

export async function rateLimitKey(req: NextRequest): Promise<string> {
  const s = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (s?.email) return `u:${s.email.toLowerCase()}`;
  const ip = clientIp(req.headers); // CF-Connecting-IP once the origin check passed — see lib/client-ip
  return `ip:${ipBucket(ip)}`; // IPv6 by /64 — one client cannot rotate addresses past the limit
}

/** Throws 429 when `key` made more than `max` calls in the last `windowMs` for this `bucket`. */
export async function rateLimit(req: NextRequest, bucket: string, max: number, windowMs = 60_000): Promise<void> {
  const now = Date.now();
  sweep(now);
  const key = `${bucket}|${await rateLimitKey(req)}`;
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    const retry = Math.ceil((windowMs - (now - (hits[0] ?? now))) / 1000); // hits is empty only when max <= 0
    throw new HttpError(429, `เรียกใช้งานถี่เกินไป กรุณารอ ${retry} วินาที`, { retryAfter: retry });
  }
  hits.push(now);
  if (!buckets.has(key) && buckets.size >= MAX_BUCKETS) sweep(now, true);
  buckets.set(key, hits);
}
