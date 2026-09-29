import type { NextRequest } from "next/server";
import { hit, verifyTurnstile, logEvent } from "@/server/track-guard";
import { trackJson, trackCtx, readSmallJson, str } from "@/server/track-http";
import { requestOtp } from "@/server/track-otp";
import { smsAvailable } from "@/server/sms";
import { TRACK_MSG } from "@/lib/track-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/track/otp/request { phone, turnstileToken } → { requestId, masked, expiresIn, resendIn }
 *
 * Same answer for every well-formed number — a customer's or not — so the endpoint cannot
 * be used to find out who is a customer. Per IP: 5/min, 20/hour; per number: 1/min, 3/hour
 * (server/track-otp.ts). The captcha comes first; SMS go out only to customer numbers.
 */
export async function POST(req: NextRequest) {
  const c = trackCtx(req);
  const limited = (msg: string = TRACK_MSG.rateLimited) => trackJson({ ok: false, error: msg }, 429, { "Retry-After": "60" });
  try {
    if (!smsAvailable()) return trackJson({ ok: false, error: TRACK_MSG.otpUnavailable }, 503);
    const body = await readSmallJson(req);
    const phone = str(body.phone, 32);
    const turnstileToken = str(body.turnstileToken, 4096);

    if (!(await hit("otp_ip_min", c.ipKey, 5, 60)) || !(await hit("otp_ip_hour", c.ipKey, 20, 3600))) {
      logEvent("otp_rate_limited", { ipHash: c.ipKey, result: "ip", requestId: c.requestId });
      return limited();
    }
    const ts = await verifyTurnstile(turnstileToken, c.ip);
    if (ts !== "ok") {
      logEvent(ts === "unavailable" ? "turnstile_unavailable" : "turnstile_fail", { ipHash: c.ipKey, requestId: c.requestId });
      return ts === "unavailable"
        ? trackJson({ ok: false, error: TRACK_MSG.unavailable }, 503)
        : trackJson({ ok: false, error: TRACK_MSG.sessionFail, reason: "captcha" }, 403);
    }
    logEvent("turnstile_pass", { ipHash: c.ipKey, requestId: c.requestId });

    const r = await requestOtp(phone, c.ip, c.requestId);
    if (!r.ok) return r.reason === "rate" ? limited(TRACK_MSG.otpRate) : trackJson({ ok: false, error: TRACK_MSG.phoneInvalid }, 400);
    return trackJson({ ok: true, requestId: r.requestId, masked: r.masked, expiresIn: r.expiresIn, resendIn: r.resendIn });
  } catch (e) {
    console.error("[track/otp/request]", e instanceof Error ? e.message.split("\n")[0] : e);
    return trackJson({ ok: false, error: TRACK_MSG.sessionFail }, 500);
  }
}
