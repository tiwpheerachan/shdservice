import type { NextRequest } from 'next/server';
import { logEvent } from '@/server/track-guard';
import { trackJson, trackCtx, meIpOk } from '@/server/track-http';
import { touchSession } from '@/server/track-otp';
import { publicJobForCustomers } from '@/server/services/tracking';
import { TRACK_MSG } from '@/lib/track-public';
import { logError } from '@/lib/log';
import { checked, parseHeaders, parseParams } from '@/server/auth';
import { trackMeJob } from '@/server/contract/track';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/track/me/jobs/:no → the (masked) job — only if it belongs to the signed-in customer */
export const GET = checked(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  const c = trackCtx(req);
  try {
    if (!(await meIpOk(c.ipKey))) return trackJson({ ok: false, error: TRACK_MSG.rateLimited }, 429);
    const s = await touchSession(parseHeaders(req, trackMeJob)['x-track-session'], c.ip, c.ua, true);
    if (!s) return trackJson({ ok: false, error: TRACK_MSG.sessionExpired, reason: 'session' }, 401);
    const { no } = await parseParams(ctx, trackMeJob);
    const job = await publicJobForCustomers(decodeURIComponent(no), s.customerIds);
    // someone else's job and a job that does not exist look the same
    if (!job) return trackJson({ ok: false, error: TRACK_MSG.notFound }, 404);
    logEvent('ticket_consumed', { ipHash: c.ipKey, jobNo: job.no, result: 'otp', requestId: c.requestId });
    return trackJson({ ok: true, job, expiresAt: s.expiresAt });
  } catch (e) {
    logError(e, 'track/me/jobs');
    return trackJson({ ok: false, error: TRACK_MSG.sessionExpired, reason: 'session' }, 500);
  }
});
