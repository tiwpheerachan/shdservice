import { headers } from "next/headers";
import { clientIp } from "@/lib/client-ip";
import { TRACK_MSG } from "@/lib/track-public";
import { hit, hmac, logEvent } from "@/server/track-guard";
import { TrackClient } from "./track-client";

export const dynamic = "force-dynamic";

/**
 * /track — lookup for a customer without the link: job number OR quotation
 * number + the last 4 digits of their phone. Same flow as the link: Turnstile
 * every time → /api/track/session → one-time ticket → /api/track/data. It never
 * hands out the permanent link.
 */
export default async function TrackFormPage() {
  const h = await headers();
  const ipKey = hmac(`ip:${clientIp(h)}`);

  let allowed = true;
  try {
    allowed = await hit("page_ip_min", ipKey, 30, 60);
  } catch {
    allowed = true;
  }
  logEvent(allowed ? "track_page_open" : "page_rate_limited", { ipHash: ipKey, result: "form" });
  if (!allowed) {
    return <div className="surface mx-auto max-w-md p-6 text-center text-sm text-muted-foreground">{TRACK_MSG.rateLimited}</div>;
  }
  return <TrackClient mode="form" nonce={h.get("x-nonce") ?? undefined} />;
}
