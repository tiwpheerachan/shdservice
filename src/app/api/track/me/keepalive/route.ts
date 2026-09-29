import type { NextRequest } from "next/server";
import { hit } from "@/server/track-guard";
import { trackJson, trackCtx, TRACK_SESSION_HEADER } from "@/server/track-http";
import { touchSession } from "@/server/track-otp";
import { TRACK_MSG } from "@/lib/track-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/track/me/keepalive — the page calls this while the customer is actually using it:
 * keeps ≥ 5 minutes on the clock, never past 60 minutes from sign-in.
 */
export async function POST(req: NextRequest) {
  const c = trackCtx(req);
  if (!(await hit("me_ip_min", c.ipKey, 30, 60).catch(() => false))) return trackJson({ ok: false, error: TRACK_MSG.rateLimited }, 429);
  const s = await touchSession(req.headers.get(TRACK_SESSION_HEADER), c.ip, c.ua, true).catch(() => null);
  if (!s) return trackJson({ ok: false, error: TRACK_MSG.sessionExpired, reason: "session" }, 401);
  return trackJson({ ok: true, expiresAt: s.expiresAt, maxExpiresAt: s.maxExpiresAt });
}
