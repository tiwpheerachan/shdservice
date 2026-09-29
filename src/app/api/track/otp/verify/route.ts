import type { NextRequest } from "next/server";
import { hit, logEvent } from "@/server/track-guard";
import { trackJson, trackCtx, readSmallJson } from "@/server/track-http";
import { verifyOtp } from "@/server/track-otp";
import { TRACK_MSG } from "@/lib/track-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/track/otp/verify { requestId, code } → { session, expiresAt }
 * The session token is for the page's memory only (sent back as `x-track-session`).
 * Wrong / expired / used / too many tries all read the same.
 */
export async function POST(req: NextRequest) {
  const c = trackCtx(req);
  try {
    if (!(await hit("otp_verify_ip_min", c.ipKey, 10, 60))) {
      logEvent("otp_rate_limited", { ipHash: c.ipKey, result: "verify", requestId: c.requestId });
      return trackJson({ ok: false, error: TRACK_MSG.rateLimited }, 429, { "Retry-After": "60" });
    }
    const body = await readSmallJson(req);
    const s = await verifyOtp(body.requestId, typeof body.code === "string" ? body.code.trim() : body.code, c.ip, c.ua);
    if (!s) {
      logEvent("otp_invalid", { ipHash: c.ipKey, requestId: c.requestId });
      return trackJson({ ok: false, error: TRACK_MSG.otpFail }, 401);
    }
    logEvent("otp_verified", { ipHash: c.ipKey, requestId: c.requestId });
    return trackJson({ ok: true, session: s.token, expiresAt: s.expiresAt });
  } catch (e) {
    console.error("[track/otp/verify]", e instanceof Error ? e.message.split("\n")[0] : e);
    return trackJson({ ok: false, error: TRACK_MSG.otpFail }, 500);
  }
}
