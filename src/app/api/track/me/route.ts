import type { NextRequest } from "next/server";
import { hit, logEvent } from "@/server/track-guard";
import { trackJson, trackCtx, TRACK_SESSION_HEADER } from "@/server/track-http";
import { touchSession, endSession } from "@/server/track-otp";
import { listJobsForCustomers } from "@/server/services/tracking";
import { TRACK_MSG } from "@/lib/track-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/track/me → this customer's jobs { active, history } (counts as activity: +5 min) */
export async function GET(req: NextRequest) {
  const c = trackCtx(req);
  try {
    if (!(await hit("me_ip_min", c.ipKey, 30, 60))) return trackJson({ ok: false, error: TRACK_MSG.rateLimited }, 429);
    const s = await touchSession(req.headers.get(TRACK_SESSION_HEADER), c.ip, c.ua, true);
    if (!s) {
      logEvent("customer_session_invalid", { ipHash: c.ipKey, requestId: c.requestId });
      return trackJson({ ok: false, error: TRACK_MSG.sessionExpired, reason: "session" }, 401);
    }
    const jobs = await listJobsForCustomers(s.customerIds);
    return trackJson({ ok: true, ...jobs, expiresAt: s.expiresAt, maxExpiresAt: s.maxExpiresAt });
  } catch (e) {
    console.error("[track/me]", e instanceof Error ? e.message.split("\n")[0] : e);
    return trackJson({ ok: false, error: TRACK_MSG.sessionExpired, reason: "session" }, 500);
  }
}

/** DELETE /api/track/me — sign out (the token dies now) */
export async function DELETE(req: NextRequest) {
  await endSession(req.headers.get(TRACK_SESSION_HEADER)).catch(() => {});
  return trackJson({ ok: true });
}
