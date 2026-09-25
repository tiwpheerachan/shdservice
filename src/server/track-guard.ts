import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Security plumbing for the public tracking flow (drizzle/0014):
 *
 *   linkToken → Turnstile → one-time ticket → PublicJob
 *
 *  - rate limits / blocks / tickets live in Postgres, so they hold across
 *    instances and survive deploys (Render runs old + new side by side)
 *  - keys are HMACs of the IP / link — a raw token or IP is never a DB key
 *  - a ticket is 32 random bytes; only sha256(ticket) is stored, and it is
 *    consumed by ONE atomic DELETE … RETURNING
 *  - Turnstile fails CLOSED: no secret, timeout, network error, odd reply → no ticket
 */

export const TICKET_TTL_SEC = 180;

/* ------------------------------------------------------------------ *
 * hashing
 * ------------------------------------------------------------------ */

export const sha256 = (v: string | Buffer) => createHash("sha256").update(v).digest();

let warnedLogSecret = false;
const fallbackSecret = randomBytes(32).toString("hex"); // per process: not correlatable, but never plain
function logSecret(): string {
  const s = (process.env.TRACK_LOG_SECRET ?? "").trim();
  if (s) return s;
  if (!warnedLogSecret) {
    warnedLogSecret = true;
    console.warn(JSON.stringify({ event: "track_log_secret_missing" }));
  }
  return fallbackSecret;
}
/** HMAC-SHA256 (hex) — correlates the same IP / link without storing it */
export const hmac = (v: string) => createHmac("sha256", logSecret()).update(v).digest("hex");

export const normalizeUa = (ua: string | null | undefined) => (ua ?? "").trim().replace(/\s+/g, " ").slice(0, 512);

/* ------------------------------------------------------------------ *
 * rate limits + blocks
 * ------------------------------------------------------------------ */

/**
 * Fixed-window counter. Returns true while `key` is within `limit` hits for the
 * current `windowSec` window (atomic upsert — concurrent requests all count).
 */
export async function hit(bucket: string, key: string, limit: number, windowSec: number): Promise<boolean> {
  const r = await db.execute<{ hits: number }>(sql`
    INSERT INTO track_rate (bucket, key, window_start, hits)
    VALUES (${bucket}, ${key}, to_timestamp(floor(extract(epoch FROM now()) / ${windowSec}) * ${windowSec}), 1)
    ON CONFLICT (bucket, key, window_start) DO UPDATE SET hits = track_rate.hits + 1
    RETURNING hits`);
  return Number(r.rows[0]?.hits ?? 0) <= limit;
}

export async function isBlocked(key: string): Promise<boolean> {
  const r = await db.execute(sql`SELECT 1 FROM track_block WHERE key = ${key} AND blocked_until > now() LIMIT 1`);
  return r.rows.length > 0;
}

export async function block(key: string, minutes: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO track_block (key, blocked_until) VALUES (${key}, now() + make_interval(mins => ${minutes}))
    ON CONFLICT (key) DO UPDATE SET blocked_until = EXCLUDED.blocked_until`);
}

/* ------------------------------------------------------------------ *
 * Turnstile (fail closed)
 * ------------------------------------------------------------------ */

/** Cloudflare's documented test secrets (always pass / fail) — accepted outside production only */
const TEST_SECRET = /^[123]x0{33}AA$/;

function expectedHostname(): string {
  const explicit = (process.env.TURNSTILE_EXPECTED_HOSTNAME ?? "").trim();
  if (explicit) return explicit.toLowerCase();
  try {
    return new URL(process.env.APP_BASE_URL ?? "").hostname.toLowerCase();
  } catch {
    return "";
  }
}

export type TurnstileResult = "ok" | "fail" | "unavailable";

export async function verifyTurnstile(token: string, ip: string, fetchImpl: typeof fetch = fetch): Promise<TurnstileResult> {
  const secret = (process.env.TURNSTILE_SECRET_KEY ?? "").trim();
  const prod = process.env.NODE_ENV === "production";
  if (!secret || (prod && TEST_SECRET.test(secret))) return "unavailable";
  if (!token || token.length > 4096) return "fail";
  const testMode = !prod && TEST_SECRET.test(secret);
  const host = expectedHostname();
  if (!host && !testMode) return "unavailable"; // cannot check the hostname → do not trust the token

  let d: { success?: unknown; hostname?: unknown; action?: unknown };
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: ip });
    const r = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return "unavailable";
    d = (await r.json()) as typeof d;
  } catch {
    return "unavailable"; // timeout / DNS / network / malformed JSON
  }
  if (!d || typeof d !== "object" || d.success !== true) return "fail";
  if (testMode) return "ok"; // test keys answer hostname "example.com" and no action
  if (typeof d.hostname !== "string" || d.hostname.toLowerCase() !== host) return "fail";
  if (d.action !== "track") return "fail";
  return "ok";
}

/* ------------------------------------------------------------------ *
 * one-time tickets
 * ------------------------------------------------------------------ */

const TICKET_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** issue a 3-minute, single-use ticket bound to one job + IP + User-Agent */
export async function issueTicket(jobNo: string, ip: string, ua: string): Promise<string> {
  // expired rows go on every issue (indexed on expires_at — cheap at this volume)
  await db.execute(sql`DELETE FROM track_ticket WHERE expires_at < now()`);
  const raw = randomBytes(32).toString("base64url"); // 256 bits
  await db.execute(sql`
    INSERT INTO track_ticket (token_hash, job_no, issued_ip, ua_hash, expires_at)
    VALUES (${sha256(raw)}, ${jobNo}, ${ip}::inet, ${sha256(normalizeUa(ua))},
            now() + make_interval(secs => ${TICKET_TTL_SEC}))`);
  return raw;
}

/**
 * Consume a ticket: ONE statement, so two concurrent requests with the same
 * ticket cannot both succeed. null = invalid / used / expired / other IP / other UA
 * (the caller must not tell which).
 */
export async function consumeTicket(raw: unknown, ip: string, ua: string): Promise<string | null> {
  if (typeof raw !== "string" || !TICKET_SHAPE.test(raw)) return null;
  const r = await db.execute<{ job_no: string }>(sql`
    DELETE FROM track_ticket
     WHERE token_hash = ${sha256(raw)}
       AND expires_at > now()
       AND issued_ip = ${ip}::inet
       AND ua_hash = ${sha256(normalizeUa(ua))}
    RETURNING job_no`);
  return r.rows[0]?.job_no ?? null;
}

/* ------------------------------------------------------------------ *
 * security events (30 days)
 * ------------------------------------------------------------------ */

export type TrackEvent =
  | "track_page_open"
  | "page_rate_limited"
  | "turnstile_pass"
  | "turnstile_fail"
  | "turnstile_unavailable"
  | "session_rate_limited"
  | "link_invalid"
  | "form_locked"
  | "ticket_issued"
  | "ticket_consumed"
  | "ticket_invalid"
  | "ticket_block_triggered"
  | "data_rate_limited";

/**
 * Never pass a raw token / ticket / Turnstile token / secret here — only the
 * already-HMACed ip / link and a job number where the event needs it.
 */
export function logEvent(
  event: TrackEvent,
  f: { ipHash?: string; linkHash?: string; jobNo?: string; result?: string; requestId?: string } = {}
): void {
  void db
    .execute(sql`
      INSERT INTO track_event (event, result, ip_hash, link_hash, job_no, request_id)
      VALUES (${event}, ${f.result ?? ""}, ${f.ipHash ?? null}, ${f.linkHash ?? null}, ${f.jobNo ?? null}, ${f.requestId ?? null})`)
    .catch((e) => console.error("[track_event]", e instanceof Error ? e.message : e));
  // ~1 in 200 writes also trims old rows (counters > 2 h, blocks ended, events > 30 days)
  if (Math.random() < 0.005) void housekeeping();
}

async function housekeeping() {
  try {
    await db.execute(sql`DELETE FROM track_rate WHERE window_start < now() - interval '2 hours'`);
    await db.execute(sql`DELETE FROM track_block WHERE blocked_until < now()`);
    await db.execute(sql`DELETE FROM track_event WHERE at < now() - interval '30 days'`);
  } catch (e) {
    console.error("[track_housekeeping]", e instanceof Error ? e.message : e);
  }
}
