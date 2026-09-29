import type { NextRequest } from "next/server";
import { hit, hmac } from "@/server/track-guard";
import { trackJson, trackCtx, readSmallJson, str } from "@/server/track-http";
import { extendLink } from "@/server/services/tracking";
import { TRACK_MSG } from "@/lib/track-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/track/link/keepalive { linkToken } → { expiresAt }
 * The /track/<token> page calls this while the customer is actually using it: an opened link
 * keeps ≥ 5 minutes on the clock, never past 60 minutes from its first open. It never reopens
 * an expired link and never opens an unopened one. 410 = the link is no longer live.
 */
export async function POST(req: NextRequest) {
  const c = trackCtx(req);
  try {
    const body = await readSmallJson(req);
    const linkToken = str(body.linkToken, 128).trim();
    if (!(await hit("link_keepalive_ip_min", c.ipKey, 20, 60)) || !(await hit("link_keepalive_min", hmac(`link:${linkToken}`), 10, 60))) {
      return trackJson({ ok: false, error: TRACK_MSG.rateLimited }, 429);
    }
    const expiresAt = await extendLink(linkToken);
    if (!expiresAt) return trackJson({ ok: false, error: TRACK_MSG.linkExpired, reason: "link" }, 410);
    return trackJson({ ok: true, expiresAt });
  } catch (e) {
    console.error("[track/link/keepalive]", e instanceof Error ? e.message.split("\n")[0] : e);
    return trackJson({ ok: false, error: TRACK_MSG.linkExpired, reason: "link" }, 500);
  }
}
