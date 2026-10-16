import type { NextRequest } from 'next/server';
import { hit, hmac, isBlocked, logEvent } from '@/server/track-guard';
import { trackJson, trackCtx } from '@/server/track-http';
import { touchSession } from '@/server/track-otp';
import { findDoc, issueDocLink, jobNoForCustomers, jobNoForLink } from '@/server/services/tracking';
import { TRACK_MSG } from '@/lib/track-public';
import { logError } from '@/lib/log';
import { checked, parseHeaders, parseTrackBody } from '@/server/auth';
import { trackDoc } from '@/server/contract/track';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/track/doc { kind, ref, jobNo | linkToken } → { url: "/track/doc/<ticket>" }
 *
 * The job comes from an authorisation the server issued, never from the body alone:
 *   x-track-session header (phone + OTP) → the job must belong to that customer
 *   linkToken (/track/<token>)          → the job of that live link (any jobNo in the body is ignored)
 * The document must be one `findDoc` lists for that job. The answer is a 10-minute document link
 * bound to that session / link (issueDocLink) — not to this browser, so LINE → Safari still opens it.
 * The URL carries no job number, quotation number or token.
 * Not yours / does not exist / not issued to customers → the same 404.
 */
export const POST = checked(async (req: NextRequest) => {
  const c = trackCtx(req);
  const notFound = () => trackJson({ ok: false, error: TRACK_MSG.docFail }, 404);
  try {
    if (
      !(await hit('doc_ip_min', c.ipKey, 10, 60)) ||
      !(await hit('doc_ip_hour', c.ipKey, 60, 3600)) ||
      (await isBlocked(`ticket:${c.ipKey}`))
    ) {
      logEvent('doc_rate_limited', { ipHash: c.ipKey, requestId: c.requestId });
      return trackJson({ ok: false, error: TRACK_MSG.rateLimited }, 429, { 'Retry-After': '60' });
    }
    const body = await parseTrackBody(req, trackDoc);

    let jobNo: string | null;
    let auth: string; // the session / link the document link is bound to
    const sessionToken = parseHeaders(req, trackDoc)['x-track-session'];
    if (sessionToken) {
      const s = await touchSession(sessionToken, c.ip, c.ua, true);
      if (!s) return trackJson({ ok: false, error: TRACK_MSG.sessionExpired, reason: 'session' }, 401);
      jobNo = await jobNoForCustomers(body.jobNo, s.customerIds);
      auth = sessionToken;
    } else {
      const linkToken = body.linkToken.trim();
      if (!(await hit('doc_link_min', hmac(`link:${linkToken}`), 10, 60))) {
        logEvent('doc_rate_limited', { ipHash: c.ipKey, result: 'link', requestId: c.requestId });
        return trackJson({ ok: false, error: TRACK_MSG.rateLimited }, 429, { 'Retry-After': '60' });
      }
      jobNo = await jobNoForLink(linkToken);
      auth = linkToken;
      if (!jobNo) return trackJson({ ok: false, error: TRACK_MSG.linkExpired, reason: 'link' }, 410);
    }
    if (!jobNo) return notFound();

    const doc = await findDoc(jobNo, body.kind, body.ref);
    if (!doc) return notFound();
    const ticket = await issueDocLink({ jobNo, kind: doc.kind, ref: doc.ref }, auth, c.ip);
    logEvent('doc_ticket_issued', { ipHash: c.ipKey, jobNo, result: doc.kind, requestId: c.requestId });
    return trackJson({ ok: true, url: `/track/doc/${ticket}` });
  } catch (e) {
    logError(e, 'track/doc');
    return trackJson({ ok: false, error: TRACK_MSG.docFail }, 500);
  }
});
