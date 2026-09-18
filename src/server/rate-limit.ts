import type { NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { HttpError } from "@/server/auth";

/**
 * Small in-memory sliding-window rate limiter — enough for a single Render
 * instance to stop one client (script, stuck tab, abuse) from pinning the CPU
 * with exports / searches / directory lookups. Keyed by the signed-in email
 * (cheap: HMAC check only, no DB) or, when anonymous, by the client IP.
 * Resets on deploy; not a security boundary — the auth guards still run.
 */
const buckets = new Map<string, number[]>();
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, hits] of buckets) if (!hits.length || now - hits[hits.length - 1] > 5 * 60_000) buckets.delete(k);
}

export async function rateLimitKey(req: NextRequest): Promise<string> {
  const s = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (s?.email) return `u:${s.email.toLowerCase()}`;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return `ip:${ip}`;
}

/** Throws 429 when `key` made more than `max` calls in the last `windowMs` for this `bucket`. */
export async function rateLimit(req: NextRequest, bucket: string, max: number, windowMs = 60_000): Promise<void> {
  const now = Date.now();
  sweep(now);
  const key = `${bucket}|${await rateLimitKey(req)}`;
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    const retry = Math.ceil((windowMs - (now - hits[0])) / 1000);
    throw new HttpError(429, `เรียกใช้งานถี่เกินไป กรุณารอ ${retry} วินาที`, { retryAfter: retry });
  }
  hits.push(now);
  buckets.set(key, hits);
}
