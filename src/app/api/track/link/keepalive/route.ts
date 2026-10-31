import type { NextRequest } from 'next/server';
import { hit, hmac } from '@/server/track-guard';
import { bodyTooLarge, BodyTooLarge, trackJson, trackCtx } from '@/server/track-http';
import { extendLink } from '@/server/services/tracking';
import { TRACK_MSG } from '@/lib/track-public';
import { logError } from '@/lib/log';
import { checked, parseTrackBody } from '@/server/auth';
import { trackLinkKeepalive } from '@/server/contract/track';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** an opened link keeps ≥ 5 minutes on the clock, never past 60 minutes from first open; never reopens an expired link or opens an unopened one. 410 = no longer live. */
export const POST = checked(async (req: NextRequest) => {
  const c = trackCtx(req);
  try {
    const linkToken = (await parseTrackBody(req, trackLinkKeepalive)).linkToken.trim();
    if (
      !(await hit('link_keepalive_ip_min', c.ipKey, 20, 60)) ||
      !(await hit('link_keepalive_min', hmac(`link:${linkToken}`), 10, 60))
    ) {
      return trackJson({ ok: false, error: TRACK_MSG.rateLimited }, 429);
    }
    const expiresAt = await extendLink(linkToken);
    if (!expiresAt) return trackJson({ ok: false, error: TRACK_MSG.linkExpired, reason: 'link' }, 410);
    return trackJson({ ok: true, expiresAt });
  } catch (e) {
    if (e instanceof BodyTooLarge) return bodyTooLarge();
    logError(e, 'track/link/keepalive');
    return trackJson({ ok: false, error: TRACK_MSG.linkExpired, reason: 'link' }, 500);
  }
});
