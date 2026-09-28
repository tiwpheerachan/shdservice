import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { trackBlock, trackDocTicket, trackEvent, trackRate, trackTicket } from "@/db/schema";

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

/** the database clock — every expiry is compared in Postgres, never against the app server's clock */
export const dbNow = sql`now()`;
export const dbNowPlus = (seconds: number) => sql`now() + make_interval(secs => ${seconds})`;

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
  const [r] = await db
    .insert(trackRate)
    .values({ bucket, key, hits: 1, windowStart: sql`to_timestamp(floor(extract(epoch FROM now()) / ${windowSec}) * ${windowSec})` })
    .onConflictDoUpdate({ target: [trackRate.bucket, trackRate.key, trackRate.windowStart], set: { hits: sql`${trackRate.hits} + 1` } })
    .returning({ hits: trackRate.hits });
  return Number(r?.hits ?? 0) <= limit;
}

export async function isBlocked(key: string): Promise<boolean> {
  const rows = await db
    .select({ key: trackBlock.key })
    .from(trackBlock)
    .where(and(eq(trackBlock.key, key), gt(trackBlock.blockedUntil, dbNow)))
    .limit(1);
  return rows.length > 0;
}

export async function block(key: string, minutes: number): Promise<void> {
  const until = dbNowPlus(minutes * 60);
  await db.insert(trackBlock).values({ key, blockedUntil: until }).onConflictDoUpdate({ target: trackBlock.key, set: { blockedUntil: until } });
}

/* ------------------------------------------------------------------ *
 * Turnstile (fail closed)
 * ------------------------------------------------------------------ */

/**
 * Cloudflare's documented test secrets — 1x…AA always passes, 2x…AA always fails, 3x…AA "token
 * already spent" (e.g. 1x0000000000000000000000000000000AA: 31 zeros). Accepted outside production only.
 */
export const TEST_SECRET = /^[123]x0{20,40}AA$/;

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
  await db.delete(trackTicket).where(lt(trackTicket.expiresAt, dbNow));
  const raw = randomBytes(32).toString("base64url"); // 256 bits
  await db.insert(trackTicket).values({
    tokenHash: sha256(raw),
    jobNo,
    issuedIp: ip,
    uaHash: sha256(normalizeUa(ua)),
    expiresAt: dbNowPlus(TICKET_TTL_SEC),
  });
  return raw;
}

/**
 * Consume a ticket: ONE statement, so two concurrent requests with the same
 * ticket cannot both succeed. null = invalid / used / expired / other IP / other UA
 * (the caller must not tell which).
 */
export async function consumeTicket(raw: unknown, ip: string, ua: string): Promise<string | null> {
  if (typeof raw !== "string" || !TICKET_SHAPE.test(raw)) return null;
  const [r] = await db
    .delete(trackTicket)
    .where(
      and(
        eq(trackTicket.tokenHash, sha256(raw)),
        gt(trackTicket.expiresAt, dbNow),
        eq(trackTicket.issuedIp, ip),
        eq(trackTicket.uaHash, sha256(normalizeUa(ua)))
      )
    )
    .returning({ jobNo: trackTicket.jobNo });
  return r?.jobNo ?? null;
}

/* ------------------------------------------------------------------ *
 * one-time document tickets (drizzle/0019)
 * ------------------------------------------------------------------ */

/** a document ticket is used right away (the page opens it in a new tab) */
export const DOC_TICKET_TTL_SEC = 60;

export type DocTicket = { jobNo: string; kind: string; ref: string };

/** issue a 60-second, single-use ticket for ONE document of one job, bound to IP + User-Agent */
export async function issueDocTicket(d: DocTicket, ip: string, ua: string): Promise<string> {
  await db.delete(trackDocTicket).where(lt(trackDocTicket.expiresAt, dbNow));
  const raw = randomBytes(32).toString("base64url"); // 256 bits
  await db.insert(trackDocTicket).values({
    tokenHash: sha256(raw),
    jobNo: d.jobNo,
    kind: d.kind,
    ref: d.ref,
    issuedIp: ip,
    uaHash: sha256(normalizeUa(ua)),
    expiresAt: dbNowPlus(DOC_TICKET_TTL_SEC),
  });
  return raw;
}

/** consume a document ticket (one atomic DELETE) — null = invalid / used / expired / other IP / other UA */
export async function consumeDocTicket(raw: unknown, ip: string, ua: string): Promise<DocTicket | null> {
  if (typeof raw !== "string" || !TICKET_SHAPE.test(raw)) return null;
  const [r] = await db
    .delete(trackDocTicket)
    .where(
      and(
        eq(trackDocTicket.tokenHash, sha256(raw)),
        gt(trackDocTicket.expiresAt, dbNow),
        eq(trackDocTicket.issuedIp, ip),
        eq(trackDocTicket.uaHash, sha256(normalizeUa(ua)))
      )
    )
    .returning({ jobNo: trackDocTicket.jobNo, kind: trackDocTicket.kind, ref: trackDocTicket.ref });
  return r ?? null;
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
  | "data_rate_limited"
  | "otp_rate_limited"
  | "otp_sent"
  | "otp_send_failed"
  | "otp_unknown_phone"
  | "otp_verified"
  | "otp_invalid"
  | "customer_session_invalid"
  | "doc_ticket_issued"
  | "doc_opened"
  | "doc_ticket_invalid"
  | "doc_rate_limited";

/**
 * Never pass a raw token / ticket / Turnstile token / secret here — only the
 * already-HMACed ip / link and a job number where the event needs it.
 */
export function logEvent(
  event: TrackEvent,
  f: { ipHash?: string; linkHash?: string; jobNo?: string; result?: string; requestId?: string } = {}
): void {
  void db
    .insert(trackEvent)
    .values({ event, result: f.result ?? "", ipHash: f.ipHash ?? null, linkHash: f.linkHash ?? null, jobNo: f.jobNo ?? null, requestId: f.requestId ?? null })
    .then(() => undefined)
    .catch((e) => console.error("[track_event]", e instanceof Error ? e.message : e));
  // ~1 in 200 writes also trims old rows (counters > 2 h, blocks ended, events > 30 days)
  if (Math.random() < 0.005) void housekeeping();
}

async function housekeeping() {
  try {
    await db.delete(trackRate).where(lt(trackRate.windowStart, sql`now() - interval '2 hours'`));
    await db.delete(trackBlock).where(lt(trackBlock.blockedUntil, dbNow));
    await db.delete(trackEvent).where(lt(trackEvent.at, sql`now() - interval '30 days'`));
  } catch (e) {
    console.error("[track_housekeeping]", e instanceof Error ? e.message : e);
  }
}
