import type { NextRequest } from "next/server";
import { hit, hmac, isBlocked, issueDocTicket, logEvent } from "@/server/track-guard";
import { trackJson, trackCtx, readSmallJson, str, TRACK_SESSION_HEADER } from "@/server/track-http";
import { touchSession } from "@/server/track-otp";
import { findDoc, jobNoForCustomers, jobNoForLink } from "@/server/services/tracking";
import { TRACK_MSG } from "@/lib/track-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/track/doc { kind, ref, jobNo | linkToken } → { url: "/track/doc/<ticket>" }
 *
 * The job comes from an authorisation the server issued, never from the body alone:
 *   x-track-session header (phone + OTP) → the job must belong to that customer
 *   linkToken (/track/<token>)          → the job of that live link (any jobNo in the body is ignored)
 * The document must be one `findDoc` lists for that job. The answer is a 60-second, single-use
 * ticket bound to this IP + browser — the URL carries no job number, quotation number or token.
 * Not yours / does not exist / not issued to customers → the same 404.
 */
export async function POST(req: NextRequest) {
  const c = trackCtx(req);
  const notFound = () => trackJson({ ok: false, error: TRACK_MSG.docFail }, 404);
  try {
    if (!(await hit("doc_ip_min", c.ipKey, 10, 60)) || !(await hit("doc_ip_hour", c.ipKey, 60, 3600)) || (await isBlocked(`ticket:${c.ipKey}`))) {
      logEvent("doc_rate_limited", { ipHash: c.ipKey, requestId: c.requestId });
      return trackJson({ ok: false, error: TRACK_MSG.rateLimited }, 429, { "Retry-After": "60" });
    }
    const body = await readSmallJson(req);

    let jobNo: string | null;
    const sessionToken = req.headers.get(TRACK_SESSION_HEADER);
    if (sessionToken) {
      const s = await touchSession(sessionToken, c.ip, c.ua, true);
      if (!s) return trackJson({ ok: false, error: TRACK_MSG.sessionExpired, reason: "session" }, 401);
      jobNo = await jobNoForCustomers(str(body.jobNo, 50), s.customerIds);
    } else {
      const linkToken = str(body.linkToken, 128).trim();
      if (!(await hit("doc_link_min", hmac(`link:${linkToken}`), 10, 60))) {
        logEvent("doc_rate_limited", { ipHash: c.ipKey, result: "link", requestId: c.requestId });
        return trackJson({ ok: false, error: TRACK_MSG.rateLimited }, 429, { "Retry-After": "60" });
      }
      jobNo = await jobNoForLink(linkToken);
      if (!jobNo) return trackJson({ ok: false, error: TRACK_MSG.linkExpired, reason: "link" }, 410);
    }
    if (!jobNo) return notFound();

    const doc = await findDoc(jobNo, body.kind, body.ref);
    if (!doc) return notFound();
    const ticket = await issueDocTicket({ jobNo, kind: doc.kind, ref: doc.ref }, c.ip, c.ua);
    logEvent("doc_ticket_issued", { ipHash: c.ipKey, jobNo, result: doc.kind, requestId: c.requestId });
    return trackJson({ ok: true, url: `/track/doc/${ticket}` });
  } catch (e) {
    console.error("[track/doc]", e instanceof Error ? e.message.split("\n")[0] : e);
    return trackJson({ ok: false, error: TRACK_MSG.docFail }, 500);
  }
}
