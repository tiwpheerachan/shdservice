import "server-only";
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { hmac, sha256, normalizeUa, logEvent } from "./track-guard";
import { sendSms } from "./sms";

/**
 * /track by phone number + SMS OTP (drizzle/0017).
 *
 *   phone → OTP (6 digits, 5 min, 5 tries) → customer session → that customer's jobs
 *
 *  - the answer to "send me a code" is the same whether or not the number is a customer;
 *    a real SMS goes out ONLY to numbers in the customer table (no paid SMS to random
 *    numbers — SMS pumping) and the send happens after the response is decided
 *  - nothing raw is stored: phone → HMAC, code → HMAC bound to its request id,
 *    request id / session token → sha256
 *  - session: 15 min, activity keeps ≥ 5 min left, never past 60 min from sign-in;
 *    the token lives only in page memory (leaving the page = a new OTP)
 */
export const OTP_TTL_SEC = 300;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SEC = 60;
export const OTP_PER_PHONE_HOUR = 3;
export const SESSION_START_MIN = 15;
export const SESSION_EXTEND_MIN = 5;
export const SESSION_MAX_MIN = 60;

const OPAQUE = /^[A-Za-z0-9_-]{43}$/;
/** Postgres array literal for a bound parameter: [3, 7] → "{3,7}" */
const intArray = (ids: number[]) => `{${ids.map((n) => Math.trunc(Number(n))).filter(Number.isFinite).join(",")}}`;

/* ------------------------------------------------------------------ *
 * phone numbers
 * ------------------------------------------------------------------ */

/** "081-234-5678" / "+66812345678" / "66 81 234 5678" / "812345678" → "0812345678"; null if not a Thai mobile */
export function normalizePhone(input: unknown): string | null {
  let d = String(input ?? "").replace(/\D/g, "");
  if (d.startsWith("66") && d.length === 11) d = "0" + d.slice(2);
  if (d.length === 9 && /^[689]/.test(d)) d = "0" + d;
  return /^0[689]\d{8}$/.test(d) ? d : null;
}

/** 0812345678 → 08x-xxx-5678 (what the page shows back) */
export const maskPhone = (p: string) => `${p.slice(0, 2)}x-xxx-${p.slice(-4)}`;

const phoneKey = (phone10: string) => hmac(`phone:${phone10}`);

/** every customer row holding this number (legacy rows may keep two numbers in one field) */
async function customerIdsForPhone(phone10: string): Promise<number[]> {
  const core = phone10.slice(1); // 9 digits without the leading 0 — matches 0…, 66…, and "a / b" fields
  const r = await db.execute<{ id: number }>(sql`
    SELECT customer_id AS id FROM customer
     WHERE record_status <> 'DELETED'
       AND regexp_replace(coalesce(phone_number, ''), '\\D', '', 'g') LIKE ${"%" + core + "%"}
     LIMIT 50`);
  return r.rows.map((x) => Number(x.id));
}

/* ------------------------------------------------------------------ *
 * OTP
 * ------------------------------------------------------------------ */

const codeHash = (requestId: string, code: string) => createHmac("sha256", sha256(`otp:${requestId}`)).update(hmac(`code:${code}`)).digest();

export type OtpRequest =
  | { ok: true; requestId: string; masked: string; expiresIn: number; resendIn: number }
  | { ok: false; reason: "rate" | "invalid" };

/**
 * Always returns a request id for a well-formed number (real or decoy), so the page — and
 * an attacker — cannot tell whether the number belongs to a customer.
 */
export async function requestOtp(phoneInput: unknown, ip: string, requestIdForLog?: string): Promise<OtpRequest> {
  const phone = normalizePhone(phoneInput);
  if (!phone) return { ok: false, reason: "invalid" };
  const key = phoneKey(phone);

  // resend cooldown (1 per minute) + 3 per hour per number, counted for EVERY number
  const cool = await db.execute<{ hits: number }>(sql`
    INSERT INTO track_rate (bucket, key, window_start, hits)
    VALUES ('otp_phone_min', ${key}, to_timestamp(floor(extract(epoch FROM now()) / ${OTP_RESEND_SEC}) * ${OTP_RESEND_SEC}), 1)
    ON CONFLICT (bucket, key, window_start) DO UPDATE SET hits = track_rate.hits + 1 RETURNING hits`);
  const hour = await db.execute<{ hits: number }>(sql`
    INSERT INTO track_rate (bucket, key, window_start, hits)
    VALUES ('otp_phone_hour', ${key}, to_timestamp(floor(extract(epoch FROM now()) / 3600) * 3600), 1)
    ON CONFLICT (bucket, key, window_start) DO UPDATE SET hits = track_rate.hits + 1 RETURNING hits`);
  if (Number(cool.rows[0]?.hits) > 1 || Number(hour.rows[0]?.hits) > OTP_PER_PHONE_HOUR) {
    logEvent("otp_rate_limited", { ipHash: hmac(`ip:${ip}`), requestId: requestIdForLog });
    return { ok: false, reason: "rate" };
  }

  const requestId = randomBytes(32).toString("base64url");
  const ids = await customerIdsForPhone(phone);
  if (ids.length) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    // a new code replaces any unused one for this number
    await db.execute(sql`UPDATE track_otp SET consumed_at = now() WHERE phone_hash = ${key} AND consumed_at IS NULL`);
    await db.execute(sql`
      INSERT INTO track_otp (request_hash, phone_hash, customer_ids, code_hash, issued_ip, expires_at)
      VALUES (${sha256(requestId)}, ${key}, ${intArray(ids)}::integer[],
              ${codeHash(requestId, code)}, ${ip}::inet, now() + make_interval(secs => ${OTP_TTL_SEC}))`);
    logEvent("otp_sent", { ipHash: hmac(`ip:${ip}`), requestId: requestIdForLog });
    // after the response is decided: the SMS round-trip must not reveal "this is a customer" by timing
    void sendSms(phone, `รหัส OTP ของคุณคือ ${code} (ใช้ได้ 5 นาที) สำหรับติดตามสถานะงานซ่อม SHD — ห้ามบอกรหัสนี้กับผู้อื่น`).then((sent) => {
      if (!sent) logEvent("otp_send_failed", { ipHash: hmac(`ip:${ip}`), requestId: requestIdForLog });
    });
  } else {
    logEvent("otp_unknown_phone", { ipHash: hmac(`ip:${ip}`), requestId: requestIdForLog });
  }
  return { ok: true, requestId, masked: maskPhone(phone), expiresIn: OTP_TTL_SEC, resendIn: OTP_RESEND_SEC };
}

/**
 * Check a code. One atomic statement counts the attempt; a second consumes the OTP only if
 * it is still unused — two concurrent right answers yield one session.
 * null = wrong / expired / used / too many tries (the caller must not say which).
 */
export async function verifyOtp(requestId: unknown, code: unknown, ip: string, ua: string): Promise<{ token: string; expiresAt: string } | null> {
  if (typeof requestId !== "string" || !OPAQUE.test(requestId)) return null;
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const rh = sha256(requestId);
  const tried = await db.execute<{ code_hash: Buffer }>(sql`
    UPDATE track_otp SET attempts = attempts + 1
     WHERE request_hash = ${rh} AND consumed_at IS NULL AND expires_at > now() AND attempts < ${OTP_MAX_ATTEMPTS}
    RETURNING code_hash`);
  const stored = tried.rows[0]?.code_hash;
  if (!stored) return null;
  const given = codeHash(requestId, code);
  if (stored.length !== given.length || !timingSafeEqual(stored, given)) return null;

  const won = await db.execute<{ customer_ids: number[]; phone_hash: string }>(sql`
    UPDATE track_otp SET consumed_at = now()
     WHERE request_hash = ${rh} AND consumed_at IS NULL
    RETURNING customer_ids, phone_hash`);
  const row = won.rows[0];
  if (!row) return null;

  await db.execute(sql`DELETE FROM track_session WHERE max_expires_at < now()`); // housekeeping
  const token = randomBytes(32).toString("base64url");
  const s = await db.execute<{ expires_at: string }>(sql`
    INSERT INTO track_session (token_hash, customer_ids, phone_hash, issued_ip, ua_hash, expires_at, max_expires_at)
    VALUES (${sha256(token)}, ${intArray(row.customer_ids)}::integer[], ${row.phone_hash},
            ${ip}::inet, ${sha256(normalizeUa(ua))},
            now() + make_interval(mins => ${SESSION_START_MIN}), now() + make_interval(mins => ${SESSION_MAX_MIN}))
    RETURNING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at`);
  return { token, expiresAt: s.rows[0].expires_at };
}

/* ------------------------------------------------------------------ *
 * customer session
 * ------------------------------------------------------------------ */

export type CustomerSession = { customerIds: number[]; expiresAt: string; maxExpiresAt: string };

/**
 * Validate a session (same IP + browser) and, when `active`, keep at least 5 minutes on
 * the clock — never past 60 minutes from sign-in. null = expired / unknown / other device.
 */
export async function touchSession(token: unknown, ip: string, ua: string, active: boolean): Promise<CustomerSession | null> {
  if (typeof token !== "string" || !OPAQUE.test(token)) return null;
  const r = await db.execute<{ customer_ids: number[]; expires_at: string; max_expires_at: string }>(sql`
    UPDATE track_session
       SET expires_at = CASE WHEN ${active}
             THEN LEAST(GREATEST(expires_at, now() + make_interval(mins => ${SESSION_EXTEND_MIN})), max_expires_at)
             ELSE expires_at END
     WHERE token_hash = ${sha256(token)} AND expires_at > now()
       AND issued_ip = ${ip}::inet AND ua_hash = ${sha256(normalizeUa(ua))}
    RETURNING customer_ids,
      to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at,
      to_char(max_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS max_expires_at`);
  const row = r.rows[0];
  if (!row) return null;
  return { customerIds: row.customer_ids.map(Number), expiresAt: row.expires_at, maxExpiresAt: row.max_expires_at };
}

export async function endSession(token: unknown): Promise<void> {
  if (typeof token !== "string" || !OPAQUE.test(token)) return;
  await db.execute(sql`DELETE FROM track_session WHERE token_hash = ${sha256(token)}`);
}
