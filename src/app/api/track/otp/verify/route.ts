import type { NextRequest } from 'next/server';
import { hit, logEvent } from '@/server/track-guard';
import { bodyTooLarge, BodyTooLarge, trackJson, trackCtx } from '@/server/track-http';
import { verifyOtp } from '@/server/track-otp';
import { TRACK_MSG } from '@/lib/track-public';
import { logError } from '@/lib/log';
import { checked, parseTrackBody } from '@/server/auth';
import { trackOtpVerify } from '@/server/contract/track';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/track/otp/verify { requestId, code } → { session, expiresAt }
 * The session token is for the page's memory only (sent back as `x-track-session`).
 * Wrong / expired / used / too many tries all read the same — and take as long (MIN_ANSWER_MS).
 */
const MIN_ANSWER_MS = 800;

export const POST = checked(async (req: NextRequest) => {
  const c = trackCtx(req);
  const notBefore = Date.now() + MIN_ANSWER_MS;
  try {
    if (!(await hit('otp_verify_ip_min', c.ipKey, 10, 60))) {
      logEvent('otp_rate_limited', { ipHash: c.ipKey, result: 'verify', requestId: c.requestId });
      return trackJson({ ok: false, error: TRACK_MSG.rateLimited }, 429, { 'Retry-After': '60' });
    }
    const { requestId, code } = await parseTrackBody(req, trackOtpVerify); // a string code trimmed
    const s = await verifyOtp(requestId, code, c.ip, c.ua);
    if (!s) {
      logEvent('otp_invalid', { ipHash: c.ipKey, requestId: c.requestId });
      return trackJson({ ok: false, error: TRACK_MSG.otpFail }, 401);
    }
    logEvent('otp_verified', { ipHash: c.ipKey, requestId: c.requestId });
    return trackJson({ ok: true, session: s.token, expiresAt: s.expiresAt });
  } catch (e) {
    if (e instanceof BodyTooLarge) return bodyTooLarge();
    logError(e, 'track/otp/verify');
    return trackJson({ ok: false, error: TRACK_MSG.otpFail }, 500);
  } finally {
    // every answer waits until MIN_ANSWER_MS: the time the code check took (ThaiBulkSMS for a customer's
    // number, a local hash for a decoy) must not tell the two apart
    await new Promise((r) => setTimeout(r, notBefore - Date.now()));
  }
});
