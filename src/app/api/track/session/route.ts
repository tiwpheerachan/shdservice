import type { NextRequest } from "next/server";
import { hit, isBlocked, block, hmac, verifyTurnstile, issueTicket, logEvent } from "@/server/track-guard";
import { trackJson, trackCtx, readSmallJson, str } from "@/server/track-http";
import { jobNoForLink, jobNoForNumber } from "@/server/services/tracking";
import { TRACK_MSG } from "@/lib/track-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/track/session — Turnstile → resolve the job → one-time ticket.
 *
 *   { linkToken, turnstileToken }            opened from the link staff sent
 *   { no, phone4, turnstileToken }           the /track form (job / quotation no. + last 4 of phone)
 *
 * Order matters: rate limits BEFORE Siteverify (a flood must not become a flood
 * of Cloudflare calls), and the database is touched for the job only AFTER the
 * captcha passed. Every failure reads the same to the caller.
 */
const FORM_MISS_LIMIT = 5; // misses per job number …
const FORM_MISS_WINDOW = 15 * 60; // … per 15 minutes → locked for 15 minutes

export async function POST(req: NextRequest) {
  const c = trackCtx(req);
  const fail = () => trackJson({ ok: false, error: TRACK_MSG.sessionFail }, 403);
  const limited = () => trackJson({ ok: false, error: TRACK_MSG.rateLimited }, 429, { "Retry-After": "60" });

  try {
    const body = await readSmallJson(req);
    const linkToken = str(body.linkToken, 128).trim();
    const formNo = str(body.no, 32).trim().toUpperCase();
    const phone4 = str(body.phone4, 16).replace(/\D/g, "");
    const turnstileToken = str(body.turnstileToken, 4096);
    const byLink = !!linkToken;

    // 1. per-IP limits
    if (!(await hit("session_ip_min", c.ipKey, 10, 60)) || !(await hit("session_ip_hour", c.ipKey, 30, 3600))) {
      logEvent("session_rate_limited", { ipHash: c.ipKey, result: "ip", requestId: c.requestId });
      return limited();
    }

    // 2. per-link limit (HMAC of the token, never the token) / per-number lockout for the form
    const linkHash = byLink ? hmac(`link:${linkToken}`) : undefined;
    const formKey = !byLink && formNo ? `form:${hmac(`no:${formNo}`)}` : undefined;
    if (linkHash && !(await hit("session_link_hour", linkHash, 20, 3600))) {
      logEvent("session_rate_limited", { ipHash: c.ipKey, linkHash, result: "link", requestId: c.requestId });
      return limited();
    }
    if (formKey && (await isBlocked(formKey))) {
      logEvent("form_locked", { ipHash: c.ipKey, requestId: c.requestId });
      return limited();
    }

    // 3. Turnstile — fail closed
    const ts = await verifyTurnstile(turnstileToken, c.ip);
    if (ts !== "ok") {
      logEvent(ts === "unavailable" ? "turnstile_unavailable" : "turnstile_fail", { ipHash: c.ipKey, linkHash, requestId: c.requestId });
      return ts === "unavailable" ? trackJson({ ok: false, error: TRACK_MSG.unavailable }, 503) : fail();
    }
    logEvent("turnstile_pass", { ipHash: c.ipKey, linkHash, requestId: c.requestId });

    // 4. only now: which job? (unknown / deleted / expired / wrong phone all look the same)
    const jobNo = byLink ? await jobNoForLink(linkToken) : await jobNoForNumber(formNo, phone4);
    if (!jobNo) {
      logEvent("link_invalid", { ipHash: c.ipKey, linkHash, result: byLink ? "link" : "form", requestId: c.requestId });
      if (formKey && !(await hit("form_miss", formKey, FORM_MISS_LIMIT, FORM_MISS_WINDOW))) {
        await block(formKey, 15);
      }
      return fail();
    }

    // 5. one job, one use, 3 minutes, this IP, this browser
    const ticket = await issueTicket(jobNo, c.ip, c.ua);
    logEvent("ticket_issued", { ipHash: c.ipKey, linkHash, jobNo, requestId: c.requestId });
    return trackJson({ ok: true, ticket });
  } catch (e) {
    console.error("[track/session]", e instanceof Error ? e.message : e);
    return fail();
  }
}
