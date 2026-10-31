import 'server-only';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { customer, trackOtp, trackSession } from '@/db/schema';
import { RS } from '@/server/record-status';
import { OTP_LENGTH, OTP_PATTERN } from '@/lib/track-public';
import {
  hmac,
  sha256,
  normalizeUa,
  logEvent,
  hit,
  claimCooldown,
  block,
  isBlocked,
  dbNow,
  dbNowPlus,
  ipKeyOf,
  newToken,
  TOKEN_SHAPE,
} from './track-guard';
import { checkOtpSms, printDevOtp, requestOtpSms, smsProvider } from './sms';
import { logError } from '@/lib/log';
import { ipBucket } from '@/lib/client-ip';

/**
 * /track by phone number + SMS OTP.
 *
 *   phone → OTP (4 digits — OTP_LENGTH, 5 min, 5 tries) → customer session → that customer's jobs
 *
 *  - the answer to "send me a code" is the same whether or not the number is a customer;
 *    a real SMS goes out ONLY to numbers in the customer table (no paid SMS to random
 *    numbers — SMS pumping) and the send happens after the response is decided. Any other
 *    number gets a decoy row (issueDecoy), so checking a code behaves the same too
 *  - the code: ThaiBulkSMS's OTP service makes it, sends it and checks it — the row keeps its token
 *    (useless without the SMS); our 5-try cap comes first. Development `log` mode makes its own
 *    code and keeps only an HMAC of it bound to its request id
 *  - nothing else raw is stored: phone → HMAC, request id / session token → sha256 (the issuing IP
 *    aside — db/schema/track.ts)
 *  - session: 15 min, activity keeps ≥ 5 min left, never past 60 min from sign-in;
 *    the token lives only in page memory (leaving the page = a new OTP)
 */
const OTP_TTL_SEC = 300;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SEC = 60;
const OTP_PER_PHONE_HOUR = 3;
/**
 * A 4-digit code: the hourly cap alone allows 15 guesses/h = 360/day per
 * target → daily caps + a lock after a few misses. Counted per number+IP first, so someone who knows a
 * customer's number cannot lock THAT customer out from their own IP; the per-number ceiling is higher and
 * only bites a guesser spread over many IPs (≤ 10 guesses/day = 0.1% per day).
 */
const OTP_PER_PHONE_DAY = 8; // per number + IP
const OTP_PER_PHONE_DAY_ALL = 20; // per number, any IP
const OTP_FAILS_PER_PHONE_DAY = 5; // per number + IP → that IP is locked out of the number
const OTP_FAILS_PER_PHONE_DAY_ALL = 10; // per number, any IP → the number is locked
const OTP_PHONE_LOCK_MIN = 24 * 60;
/** company-wide SMS spend cap (SMS pumping / a list of customer numbers) — real sends only */
const OTP_SMS_PER_HOUR = 200;
const OTP_SMS_PER_DAY = 500;
const SESSION_START_MIN = 15;
const SESSION_EXTEND_MIN = 5;
const SESSION_MAX_MIN = 60;

/** "081-234-5678" / "+66812345678" / "66 81 234 5678" / "812345678" → "0812345678"; null if not a Thai mobile */
export function normalizePhone(input: unknown): string | null {
  let d = String(input ?? '').replace(/\D/g, '');
  if (d.startsWith('66') && d.length === 11) d = '0' + d.slice(2);
  if (d.length === 9 && /^[689]/.test(d)) d = '0' + d;
  return /^0[689]\d{8}$/.test(d) ? d : null;
}

/** 0812345678 → 08x-xxx-5678 (what the page shows back) */
const maskOtpPhone = (p: string) => `${p.slice(0, 2)}x-xxx-${p.slice(-4)}`;

const phoneKey = (phone10: string) => hmac(`phone:${phone10}`);

/**
 * the mobiles a phone field holds: "081-234-5678 / +66 89 876 5432" → both. Every run of digit groups
 * (split on anything but space / dash / dot / brackets / +) that normalises on its own — never a window
 * across two numbers, which could be someone else's. Also the customer duplicate-phone check (services/customers.ts)
 */
export function phonesIn(field: string): Set<string> {
  const out = new Set<string>();
  for (const part of field.split(/[^\d\s().+-]/)) {
    const g = part.match(/\d+/g) ?? [];
    for (let i = 0; i < g.length; i++)
      for (let j = i, d = ''; j < g.length && (d += g[j]).length <= 11; j++) {
        const p = normalizePhone(d);
        if (p) out.add(p);
      }
  }
  return out;
}

/** every customer row holding this number (legacy rows may keep two numbers in one field) — exported for scripts/test-track.mts */
export async function customerIdsForPhone(phone10: string): Promise<number[]> {
  const core = phone10.slice(1); // 9 digits without the leading 0 — a cheap prefilter for 0…, 66…, "a / b"; phonesIn decides
  const rows = await db
    .select({ id: customer.pk, phone: customer.phoneNumber })
    .from(customer)
    .where(
      and(
        ne(customer.recordStatus, RS.DELETED),
        sql`regexp_replace(coalesce(${customer.phoneNumber}, ''), '\\D', '', 'g') LIKE ${'%' + core + '%'}`,
      ),
    )
    .limit(50);
  return rows.filter((x) => phonesIn(x.phone ?? '').has(phone10)).map((x) => Number(x.id));
}

const codeHash = (requestId: string, code: string) =>
  createHmac('sha256', sha256(`otp:${requestId}`))
    .update(hmac(`code:${code}`))
    .digest();

export type OtpRequest =
  | { ok: true; requestId: string; masked: string; expiresIn: number; resendIn: number }
  | { ok: false; reason: 'rate' | 'invalid' };

/**
 * Always returns a request id for a well-formed number (real or decoy), so the page — and
 * an attacker — cannot tell whether the number belongs to a customer.
 */
export async function requestOtp(phoneInput: unknown, ip: string, requestIdForLog?: string): Promise<OtpRequest> {
  const phone = normalizePhone(phoneInput);
  if (!phone) return { ok: false, reason: 'invalid' };
  const key = phoneKey(phone);
  const ipHash = ipKeyOf(ip); // the route's c.ipKey: one request logs one hash

  // hourly / daily caps per number, counted for EVERY number; every counter always counts (no
  // short-circuit) — independent upserts / reads, so side by side
  const ipKey = hmac(`phone-ip:${key}:${ipBucket(ip)}`); // one hash (varchar(128)) · IPv6 per /64, like the other limits
  const [hourOk, dayOk, dayAllOk, blocked, ipBlocked] = await Promise.all([
    hit('otp_phone_hour', key, OTP_PER_PHONE_HOUR, 3600),
    hit('otp_phone_day', ipKey, OTP_PER_PHONE_DAY, 86400),
    hit('otp_phone_day_all', key, OTP_PER_PHONE_DAY_ALL, 86400),
    isBlocked(`phone:${key}`),
    isBlocked(`phone:${ipKey}`),
  ]);
  // then the resend cooldown: 60 s from the last ACCEPTED request (sliding, atomic — two at once get one
  // claim). Claimed only once the caps pass, so a refused request does not push the next code back; the
  // claim does not depend on whether the number is a customer, so timing stays the same for both
  if (!hourOk || !dayOk || !dayAllOk || blocked || ipBlocked || !(await claimCooldown(key, OTP_RESEND_SEC))) {
    logEvent('otp_rate_limited', { ipHash, requestId: requestIdForLog });
    return { ok: false, reason: 'rate' };
  }

  const requestId = newToken();
  const ids = await customerIdsForPhone(phone);
  // after the response is decided: the OTP row and the SMS must not reveal "this is a customer" by timing —
  // a customer's request and a stranger's do the same awaited work before the answer
  if (ids.length)
    void issueOtp(phone, key, ids, requestId, ip, ipHash, requestIdForLog).catch((e) =>
      logError(e, 'track_otp not issued'),
    );
  else {
    logEvent('otp_unknown_phone', { ipHash, requestId: requestIdForLog });
    void issueDecoy(key, requestId, ip).catch((e) => logError(e, 'track_otp decoy not stored'));
  }
  return { ok: true, requestId, masked: maskOtpPhone(phone), expiresIn: OTP_TTL_SEC, resendIn: OTP_RESEND_SEC };
}

/** a new code replaces any unused one for this number */
const retireUnused = (key: string) =>
  db
    .update(trackOtp)
    .set({ consumedAt: dbNow })
    .where(and(eq(trackOtp.phoneHash, key), isNull(trackOtp.consumedAt)));

/**
 * A number no customer has: a row like a customer's, but for nobody (no customer ids) and with the hash of
 * a code nobody knows — and no SMS. Its verify then runs the same path as a real one: the try counter,
 * the wrong-code counters and the number lock all apply, so the answers cannot tell the two apart.
 */
async function issueDecoy(key: string, requestId: string, ip: string) {
  await retireUnused(key);
  await db.insert(trackOtp).values({
    requestHash: sha256(requestId),
    phoneHash: key,
    customerPks: [],
    codeHash: randomBytes(32), // the length of a real one — the comparison takes the same branch
    issuedIp: ip,
    expiresAt: dbNowPlus(OTP_TTL_SEC),
  });
}

/** a customer number's OTP: the row (replacing any unused one) + the SMS — runs after requestOtp answered */
async function issueOtp(
  phone: string,
  key: string,
  ids: number[],
  requestId: string,
  ip: string,
  ipHash: string,
  requestIdForLog?: string,
) {
  // over a company-wide cap: the answer was the usual one, just don't send (and say so in the log)
  const [hourOk, dayOk] = await Promise.all([
    hit('otp_sms_global_hour', 'all', OTP_SMS_PER_HOUR, 3600),
    hit('otp_sms_global_day', 'all', OTP_SMS_PER_DAY, 86400),
  ]);
  if (!hourOk || !dayOk)
    return logEvent('otp_sms_global_cap', { ipHash, requestId: requestIdForLog, result: dayOk ? 'hour' : 'day' });
  const rh = sha256(requestId);
  // development `log` mode makes its own code; ThaiBulkSMS makes the real one
  const own = smsProvider() === 'log' ? String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0') : null;
  await retireUnused(key);
  await db.insert(trackOtp).values({
    requestHash: rh,
    phoneHash: key,
    customerPks: ids,
    codeHash: own ? codeHash(requestId, own) : null,
    issuedIp: ip,
    expiresAt: dbNowPlus(OTP_TTL_SEC),
  });
  logEvent('otp_sent', { ipHash, requestId: requestIdForLog });
  if (own) return printDevOtp(phone, own);
  const token = await requestOtpSms(phone);
  if (!token) return logEvent('otp_send_failed', { ipHash, requestId: requestIdForLog });
  await db.update(trackOtp).set({ providerToken: token }).where(eq(trackOtp.requestHash, rh));
}

/**
 * Check a code. One atomic statement counts the attempt; a second consumes the OTP only if
 * it is still unused — two concurrent right answers yield one session.
 * null = wrong / expired / used / too many tries (the caller must not say which).
 */
export async function verifyOtp(
  requestId: unknown,
  code: unknown,
  ip: string,
  ua: string,
): Promise<{ token: string; expiresAt: string } | null> {
  if (typeof requestId !== 'string' || !TOKEN_SHAPE.test(requestId)) return null;
  if (typeof code !== 'string' || !OTP_PATTERN.test(code)) return null;
  const rh = sha256(requestId);
  const ipHash = ipKeyOf(ip);
  const [tried] = await db
    .update(trackOtp)
    .set({ attempts: sql`${trackOtp.attempts} + 1` })
    .where(
      and(
        eq(trackOtp.requestHash, rh),
        isNull(trackOtp.consumedAt),
        gt(trackOtp.expiresAt, dbNow),
        lt(trackOtp.attempts, OTP_MAX_ATTEMPTS),
      ),
    )
    .returning({ codeHash: trackOtp.codeHash, providerToken: trackOtp.providerToken, phoneHash: trackOtp.phoneHash });
  if (!tried) return null;
  // a wrong code counts against number+IP (locks that IP out of the number) and the number
  // (locks it only past the higher ceiling) — both for 24 h. A lock also retires the number's live
  // code (the one being guessed — a new code retires older ones), or its tries left would still count
  const wrong = async () => {
    const ipKey = hmac(`phone-ip:${tried.phoneHash}:${ipBucket(ip)}`);
    const ipOk = await hit('otp_fail_phone_day', ipKey, OTP_FAILS_PER_PHONE_DAY, 86400);
    const allOk = await hit('otp_fail_phone_day_all', tried.phoneHash, OTP_FAILS_PER_PHONE_DAY_ALL, 86400);
    if (!ipOk) await block(`phone:${ipKey}`, OTP_PHONE_LOCK_MIN);
    if (!allOk) await block(`phone:${tried.phoneHash}`, OTP_PHONE_LOCK_MIN);
    if (!ipOk || !allOk) {
      await retireUnused(tried.phoneHash);
      logEvent('otp_phone_locked', { ipHash, result: allOk ? 'ip' : 'number' });
    }
    return null;
  };
  if (tried.providerToken) {
    const answer = await checkOtpSms(tried.providerToken, code);
    if (answer === 'error') logEvent('otp_check_failed', { ipHash });
    if (answer === 'wrong') return wrong();
    if (answer !== 'ok') return null;
  } else if (tried.codeHash) {
    const given = codeHash(requestId, code);
    if (tried.codeHash.length !== given.length || !timingSafeEqual(tried.codeHash, given)) return wrong();
  } else return null; // the SMS never went out

  const [row] = await db
    .update(trackOtp)
    .set({ consumedAt: dbNow })
    .where(and(eq(trackOtp.requestHash, rh), isNull(trackOtp.consumedAt)))
    .returning({ customerPks: trackOtp.customerPks, phoneHash: trackOtp.phoneHash });
  if (!row?.customerPks.length) return null; // a decoy never matches; never a session for nobody either

  await db.delete(trackSession).where(lt(trackSession.maxExpiresAt, dbNow)); // housekeeping
  const token = newToken();
  const [s] = await db
    .insert(trackSession)
    .values({
      tokenHash: sha256(token),
      customerPks: row.customerPks,
      phoneHash: row.phoneHash,
      issuedIp: ip,
      uaHash: sha256(normalizeUa(ua)),
      expiresAt: dbNowPlus(SESSION_START_MIN * 60),
      maxExpiresAt: dbNowPlus(SESSION_MAX_MIN * 60),
    })
    .returning({ expiresAt: trackSession.expiresAt });
  if (!s) throw new Error('track_session insert returned no row');
  return { token, expiresAt: s.expiresAt.toISOString() };
}

export type CustomerSession = { customerIds: number[]; expiresAt: string; maxExpiresAt: string };

/**
 * Validate a session (same IP + browser) and, when `active`, keep at least 5 minutes on
 * the clock — never past 60 minutes from sign-in. null = expired / unknown / other device.
 */
export async function touchSession(
  token: unknown,
  ip: string,
  ua: string,
  active: boolean,
): Promise<CustomerSession | null> {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return null;
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
        eq(trackSession.uaHash, sha256(normalizeUa(ua))),
      ),
    )
    .returning({
      customerPks: trackSession.customerPks,
      expiresAt: trackSession.expiresAt,
      maxExpiresAt: trackSession.maxExpiresAt,
    });
  if (!row) return null;
  return {
    customerIds: row.customerPks.map(Number),
    expiresAt: row.expiresAt.toISOString(),
    maxExpiresAt: row.maxExpiresAt.toISOString(),
  };
}

export async function endSession(token: unknown): Promise<void> {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return;
  await db.delete(trackSession).where(eq(trackSession.tokenHash, sha256(token)));
}
