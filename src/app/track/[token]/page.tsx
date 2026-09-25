import { headers } from "next/headers";
import { clientIp } from "@/lib/client-ip";
import { TRACK_MSG } from "@/lib/track-public";
import { hit, hmac, logEvent } from "@/server/track-guard";
import { TrackClient } from "../track-client";

export const dynamic = "force-dynamic";

/**
 * /track/<linkToken> — the page SHELL only.
 *
 * The token is NOT looked up here: a valid, unknown, expired or deleted token all
 * get the same page (no enumeration, nothing to learn before the captcha). The job
 * is resolved by /api/track/session after Turnstile, and its data comes from
 * /api/track/data with a one-time ticket. Security headers + CSP nonce: middleware.
 */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const ipKey = hmac(`ip:${clientIp(h)}`);

  let allowed = true;
  try {
    allowed = await hit("page_ip_min", ipKey, 30, 60);
  } catch {
    allowed = true; // counter table unreachable → the captcha + API limits still stand
  }
  logEvent(allowed ? "track_page_open" : "page_rate_limited", { ipHash: ipKey });
  if (!allowed) {
    return <div className="surface mx-auto max-w-md p-6 text-center text-sm text-muted-foreground">{TRACK_MSG.rateLimited}</div>;
  }

  let linkToken = "";
  try {
    linkToken = decodeURIComponent(token).slice(0, 128);
  } catch {
    linkToken = "";
  }
  return <TrackClient mode="link" linkToken={linkToken} nonce={h.get("x-nonce") ?? undefined} />;
}
