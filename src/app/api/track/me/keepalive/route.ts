import type { NextRequest } from 'next/server';
import { trackJson, trackCtx, meIpOk } from '@/server/track-http';
import { touchSession } from '@/server/track-otp';
import { TRACK_MSG } from '@/lib/track-public';
import { logError } from '@/lib/log';
import { checked, parseHeaders } from '@/server/auth';
import { trackMeKeepalive } from '@/server/contract/track';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** keeps ≥ 5 minutes on the clock, never past 60 minutes from sign-in */
export const POST = checked(async (req: NextRequest) => {
  const c = trackCtx(req);
  // a DB error reads as "limited" / "signed out" (logged), never a 500 to the page
  const ipOk = await meIpOk(c.ipKey).catch((e) => {
    logError(e, 'track/me/keepalive');
    return false;
  });
  if (!ipOk) return trackJson({ ok: false, error: TRACK_MSG.rateLimited }, 429);
  const token = parseHeaders(req, trackMeKeepalive)['x-track-session'];
  const s = await touchSession(token, c.ip, c.ua, true).catch((e) => {
    logError(e, 'track/me/keepalive');
    return null;
  });
  if (!s) return trackJson({ ok: false, error: TRACK_MSG.sessionExpired, reason: 'session' }, 401);
  return trackJson({ ok: true, expiresAt: s.expiresAt, maxExpiresAt: s.maxExpiresAt });
});
