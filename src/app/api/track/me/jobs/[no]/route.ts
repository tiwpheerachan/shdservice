import type { NextRequest } from "next/server";
import { hit, logEvent } from "@/server/track-guard";
import { trackJson, trackCtx, TRACK_SESSION_HEADER } from "@/server/track-http";
import { touchSession } from "@/server/track-otp";
import { publicJobForCustomers } from "@/server/services/tracking";
import { TRACK_MSG } from "@/lib/track-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/track/me/jobs/:no → the (masked) job — only if it belongs to the signed-in customer */
export async function GET(req: NextRequest, ctx: { params: Promise<{ no: string }> }) {
  const c = trackCtx(req);
  try {
    if (!(await hit("me_ip_min", c.ipKey, 30, 60))) return trackJson({ ok: false, error: TRACK_MSG.rateLimited }, 429);
    const s = await touchSession(req.headers.get(TRACK_SESSION_HEADER), c.ip, c.ua, true);
    if (!s) return trackJson({ ok: false, error: TRACK_MSG.sessionExpired, reason: "session" }, 401);
    const { no } = await ctx.params;
    const job = await publicJobForCustomers(decodeURIComponent(no), s.customerIds);
    // someone else's job and a job that does not exist look the same
    if (!job) return trackJson({ ok: false, error: "ไม่พบรายการ" }, 404);
    logEvent("ticket_consumed", { ipHash: c.ipKey, jobNo: job.no, result: "otp", requestId: c.requestId });
    return trackJson({ ok: true, job, expiresAt: s.expiresAt });
  } catch (e) {
    console.error("[track/me/jobs]", e instanceof Error ? e.message.split("\n")[0] : e);
    return trackJson({ ok: false, error: TRACK_MSG.sessionExpired, reason: "session" }, 500);
  }
}
