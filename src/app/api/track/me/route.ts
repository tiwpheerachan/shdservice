import type { NextRequest } from 'next/server';
import { logEvent } from '@/server/track-guard';
import { trackJson, trackCtx, meIpOk } from '@/server/track-http';
import { touchSession, endSession } from '@/server/track-otp';
import { listJobsForCustomers } from '@/server/services/tracking';
import { TRACK_MSG } from '@/lib/track-public';
import { logError } from '@/lib/log';
import { checked, parseHeaders } from '@/server/auth';
import { trackMe, trackSignOut } from '@/server/contract/track';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/track/me → this customer's jobs { active, history } (counts as activity: +5 min) */
export const GET = checked(async (req: NextRequest) => {
  const c = trackCtx(req);
  try {
    if (!(await meIpOk(c.ipKey))) return trackJson({ ok: false, error: TRACK_MSG.rateLimited }, 429);
    const s = await touchSession(parseHeaders(req, trackMe)['x-track-session'], c.ip, c.ua, true);
    if (!s) {
      logEvent('customer_session_invalid', { ipHash: c.ipKey, requestId: c.requestId });
      return trackJson({ ok: false, error: TRACK_MSG.sessionExpired, reason: 'session' }, 401);
    }
    const jobs = await listJobsForCustomers(s.customerIds);
    return trackJson({ ok: true, ...jobs, expiresAt: s.expiresAt, maxExpiresAt: s.maxExpiresAt });
  } catch (e) {
    logError(e, 'track/me');
    return trackJson({ ok: false, error: TRACK_MSG.sessionExpired, reason: 'session' }, 500);
  }
});

/** DELETE /api/track/me — sign out (the token dies now) */
export const DELETE = checked(async (req: NextRequest) => {
  await endSession(parseHeaders(req, trackSignOut)['x-track-session']).catch((e) => logError(e, 'track/me sign-out'));
  return trackJson({ ok: true });
});
