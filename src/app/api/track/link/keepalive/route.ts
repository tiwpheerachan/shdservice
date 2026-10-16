import type { NextRequest } from 'next/server';
import { hit, hmac } from '@/server/track-guard';
import { trackJson, trackCtx } from '@/server/track-http';
import { extendLink } from '@/server/services/tracking';
import { TRACK_MSG } from '@/lib/track-public';
import { logError } from '@/lib/log';
import { checked, parseTrackBody } from '@/server/auth';
import { trackLinkKeepalive } from '@/server/contract/track';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/track/link/keepalive { linkToken } → { expiresAt }
 * The /track/<token> page calls this while the customer is actually using it: an opened link
 * keeps ≥ 5 minutes on the clock, never past 60 minutes from its first open. It never reopens
 * an expired link and never opens an unopened one. 410 = the link is no longer live.
 */
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
    logError(e, 'track/link/keepalive');
    return trackJson({ ok: false, error: TRACK_MSG.linkExpired, reason: 'link' }, 500);
  }
});
