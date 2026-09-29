import { headers } from "next/headers";
import { clientIp } from "@/lib/client-ip";
import { TRACK_MSG } from "@/lib/track-public";
import { hit, hmac, logEvent } from "@/server/track-guard";
import { TrackClient } from "./track-client";
import { smsAvailable, smsProvider } from "@/server/sms";

export const dynamic = "force-dynamic";

/**
 * /track — the customer's own lookup: Cloudflare gate → mobile number → SMS OTP → their jobs
 * (in progress + 2 years of history). No SMS provider configured in production = the page
 * says the service is not open yet (the dev "log" provider never runs in production).
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
  return (
    <TrackClient
      mode="form"
      nonce={h.get("x-nonce") ?? undefined}
      otpAvailable={smsAvailable()}
      devOtpLog={smsProvider() === "log"}
    />
  );
}
