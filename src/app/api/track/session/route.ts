import type { NextRequest } from "next/server";
import { hit, hmac, verifyTurnstile, issueTicket, logEvent } from "@/server/track-guard";
import { trackJson, trackCtx, readSmallJson, str } from "@/server/track-http";
import { jobNoForLink, markLinkOpened, linkExpiry } from "@/server/services/tracking";
import { userFromRequest } from "@/server/auth";
import { TRACK_MSG } from "@/lib/track-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/track/session { linkToken, turnstileToken } — the staff-sent link
 * (/track/<token>): Turnstile → resolve the job → one-time ticket.
 * (The /track page itself uses phone + OTP: /api/track/otp/*.)
 *
 * Order matters: rate limits BEFORE Siteverify (a flood must not become a flood
 * of Cloudflare calls), and the database is touched for the job only AFTER the
 * captcha passed.
 */
export async function POST(req: NextRequest) {
  const c = trackCtx(req);
  const fail = () => trackJson({ ok: false, error: TRACK_MSG.sessionFail }, 403);
  const limited = () => trackJson({ ok: false, error: TRACK_MSG.rateLimited }, 429, { "Retry-After": "60" });

  try {
    const body = await readSmallJson(req);
    const linkToken = str(body.linkToken, 128).trim();
    const turnstileToken = str(body.turnstileToken, 4096);
    if (!linkToken) return fail();

    // 1. per-IP limits
    if (!(await hit("session_ip_min", c.ipKey, 10, 60)) || !(await hit("session_ip_hour", c.ipKey, 30, 3600))) {
      logEvent("session_rate_limited", { ipHash: c.ipKey, result: "ip", requestId: c.requestId });
      return limited();
    }

    // 2. per-link limit (HMAC of the token, never the token)
    const linkHash = hmac(`link:${linkToken}`);
    if (!(await hit("session_link_hour", linkHash, 20, 3600))) {
      logEvent("session_rate_limited", { ipHash: c.ipKey, linkHash, result: "link", requestId: c.requestId });
      return limited();
    }

    // 3. Turnstile — fail closed
    const ts = await verifyTurnstile(turnstileToken, c.ip);
    if (ts !== "ok") {
      logEvent(ts === "unavailable" ? "turnstile_unavailable" : "turnstile_fail", { ipHash: c.ipKey, linkHash, requestId: c.requestId });
      return ts === "unavailable" ? trackJson({ ok: false, error: TRACK_MSG.unavailable }, 503) : fail();
    }
    logEvent("turnstile_pass", { ipHash: c.ipKey, linkHash, requestId: c.requestId });

    // 4. only now: which job? (unknown / deleted / expired all look the same)
    const jobNo = await jobNoForLink(linkToken);
    if (!jobNo) {
      logEvent("link_invalid", { ipHash: c.ipKey, linkHash, result: "link", requestId: c.requestId });
      // tell the page it is the LINK (expired / used up / unknown — never which), so it can
      // show the "ask for a new link" hint instead of the captcha again. Tokens are 256-bit
      // random, so confirming that a guessed one is not valid reveals nothing.
      return trackJson({ ok: false, error: TRACK_MSG.linkExpired, reason: "link" }, 410);
    }
    // the customer's first open starts the link's 15-minute window — a signed-in staff
    // member checking "ดูหน้าที่ลูกค้าเห็น" must not burn the customer's link
    const staff = await userFromRequest(req).catch(() => null);
    if (!staff?.approved) await markLinkOpened(jobNo);

    // 5. one job, one use, 3 minutes, this IP, this browser
    const ticket = await issueTicket(jobNo, c.ip, c.ua);
    logEvent("ticket_issued", { ipHash: c.ipKey, linkHash, jobNo, requestId: c.requestId });
    // the page shows a countdown to this (and extends it while in use: /api/track/link/keepalive)
    return trackJson({ ok: true, ticket, expiresAt: await linkExpiry(jobNo) });
  } catch (e) {
    console.error("[track/session]", e instanceof Error ? e.message : e);
    return fail();
  }
}
