import "server-only";
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { customer, trackOtp, trackSession } from "@/db/schema";
import { RS } from "@/server/record-status";
import { hmac, sha256, normalizeUa, logEvent, hit, dbNow, dbNowPlus } from "./track-guard";
import { checkOtpSms, printDevOtp, requestOtpSms, smsProvider } from "./sms";

/**
 * /track by phone number + SMS OTP (drizzle/0017).
 *
 *   phone → OTP (6 digits, 5 min, 5 tries) → customer session → that customer's jobs
 *
 *  - the answer to "send me a code" is the same whether or not the number is a customer;
 *    a real SMS goes out ONLY to numbers in the customer table (no paid SMS to random
 *    numbers — SMS pumping) and the send happens after the response is decided
 *  - the code: ThaiBulkSMS's OTP service makes it, sends it and checks it — the row keeps its token
 *    (useless without the SMS); our 5-try cap comes first. Development `log` mode makes its own
 *    code and keeps only an HMAC of it bound to its request id
 *  - nothing else raw is stored: phone → HMAC, request id / session token → sha256
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
  const rows = await db
    .select({ id: customer.customerId })
    .from(customer)
    .where(
      and(
        ne(customer.recordStatus, RS.DELETED),
        sql`regexp_replace(coalesce(${customer.phoneNumber}, ''), '\\D', '', 'g') LIKE ${"%" + core + "%"}`
      )
    )
    .limit(50);
  return rows.map((x) => Number(x.id));
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
  // both counters always count (no short-circuit), exactly like the two separate upserts before
  const coolOk = await hit("otp_phone_min", key, 1, OTP_RESEND_SEC);
  const hourOk = await hit("otp_phone_hour", key, OTP_PER_PHONE_HOUR, 3600);
  if (!coolOk || !hourOk) {
    logEvent("otp_rate_limited", { ipHash: hmac(`ip:${ip}`), requestId: requestIdForLog });
    return { ok: false, reason: "rate" };
  }

  const requestId = randomBytes(32).toString("base64url");
  const ids = await customerIdsForPhone(phone);
  if (ids.length) {
    const rh = sha256(requestId);
    // development `log` mode makes its own code; ThaiBulkSMS makes the real one
    const own = smsProvider() === "log" ? String(randomInt(0, 1_000_000)).padStart(6, "0") : null;
    // a new code replaces any unused one for this number
    await db.update(trackOtp).set({ consumedAt: dbNow }).where(and(eq(trackOtp.phoneHash, key), isNull(trackOtp.consumedAt)));
    await db.insert(trackOtp).values({
      requestHash: rh,
      phoneHash: key,
      customerIds: ids,
      codeHash: own ? codeHash(requestId, own) : null,
      issuedIp: ip,
      expiresAt: dbNowPlus(OTP_TTL_SEC),
    });
    logEvent("otp_sent", { ipHash: hmac(`ip:${ip}`), requestId: requestIdForLog });
    if (own) printDevOtp(phone, own);
    // after the response is decided: the SMS round-trip must not reveal "this is a customer" by timing
    else
      void requestOtpSms(phone).then(async (token) => {
        if (!token) return logEvent("otp_send_failed", { ipHash: hmac(`ip:${ip}`), requestId: requestIdForLog });
        await db
          .update(trackOtp)
          .set({ providerToken: token })
          .where(eq(trackOtp.requestHash, rh))
          .catch((e) => console.error("[track_otp] token not saved", e instanceof Error ? e.message.split("\n")[0] : e));
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
  const [tried] = await db
    .update(trackOtp)
    .set({ attempts: sql`${trackOtp.attempts} + 1` })
    .where(
      and(
        eq(trackOtp.requestHash, rh),
        isNull(trackOtp.consumedAt),
        gt(trackOtp.expiresAt, dbNow),
        lt(trackOtp.attempts, OTP_MAX_ATTEMPTS)
      )
    )
    .returning({ codeHash: trackOtp.codeHash, providerToken: trackOtp.providerToken });
  if (!tried) return null;
  if (tried.providerToken) {
    const answer = await checkOtpSms(tried.providerToken, code);
    if (answer === "error") logEvent("otp_check_failed", { ipHash: hmac(`ip:${ip}`) });
    if (answer !== "ok") return null;
  } else if (tried.codeHash) {
    const given = codeHash(requestId, code);
    if (tried.codeHash.length !== given.length || !timingSafeEqual(tried.codeHash, given)) return null;
  } else return null; // the SMS never went out

  const [row] = await db
    .update(trackOtp)
    .set({ consumedAt: dbNow })
    .where(and(eq(trackOtp.requestHash, rh), isNull(trackOtp.consumedAt)))
    .returning({ customerIds: trackOtp.customerIds, phoneHash: trackOtp.phoneHash });
  if (!row) return null;

  await db.delete(trackSession).where(lt(trackSession.maxExpiresAt, dbNow)); // housekeeping
  const token = randomBytes(32).toString("base64url");
  const [s] = await db
    .insert(trackSession)
    .values({
      tokenHash: sha256(token),
      customerIds: row.customerIds,
      phoneHash: row.phoneHash,
      issuedIp: ip,
      uaHash: sha256(normalizeUa(ua)),
      expiresAt: dbNowPlus(SESSION_START_MIN * 60),
      maxExpiresAt: dbNowPlus(SESSION_MAX_MIN * 60),
    })
    .returning({ expiresAt: trackSession.expiresAt });
  return { token, expiresAt: s.expiresAt.toISOString() };
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
  const [row] = await db
    .update(trackSession)
    .set({
      expiresAt: active
        ? sql`LEAST(GREATEST(${trackSession.expiresAt}, ${dbNowPlus(SESSION_EXTEND_MIN * 60)}), ${trackSession.maxExpiresAt})`
        : sql`${trackSession.expiresAt}`,
    })
    .where(
      and(
        eq(trackSession.tokenHash, sha256(token)),
        gt(trackSession.expiresAt, dbNow),
        eq(trackSession.issuedIp, ip),
        eq(trackSession.uaHash, sha256(normalizeUa(ua)))
      )
    )
    .returning({ customerIds: trackSession.customerIds, expiresAt: trackSession.expiresAt, maxExpiresAt: trackSession.maxExpiresAt });
  if (!row) return null;
  return { customerIds: row.customerIds.map(Number), expiresAt: row.expiresAt.toISOString(), maxExpiresAt: row.maxExpiresAt.toISOString() };
}

export async function endSession(token: unknown): Promise<void> {
  if (typeof token !== "string" || !OPAQUE.test(token)) return;
  await db.delete(trackSession).where(eq(trackSession.tokenHash, sha256(token)));
}
