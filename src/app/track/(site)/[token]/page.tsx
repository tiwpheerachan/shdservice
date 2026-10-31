import { headers } from 'next/headers';
import { clientIp, ipBucket } from '@/lib/client-ip';
import { TRACK_MSG } from '@/lib/track-public';
import { hit, hmac, logEvent } from '@/server/track-guard';
import { TrackClient } from '../track-client';

export const dynamic = 'force-dynamic';

/**
 * Page shell only: the token is NOT looked up here — valid, unknown, expired or deleted all get the same page (no
 * enumeration before the captcha). /api/track/session resolves it after Turnstile; data via /api/track/data.
 */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const ipKey = hmac(`ip:${ipBucket(clientIp(h))}`); // same key as trackCtx (IPv6 → /64)

  let allowed = true;
  try {
    allowed = await hit('page_ip_min', ipKey, 30, 60);
  } catch {
    allowed = true; // counter table unreachable → the captcha + API limits still stand
  }
  logEvent(allowed ? 'track_page_open' : 'page_rate_limited', { ipHash: ipKey });
  if (!allowed) {
    return (
      <div className="surface mx-auto max-w-md p-6 text-center text-sm text-muted-foreground">
        {TRACK_MSG.rateLimited}
      </div>
    );
  }

  const linkToken = token.slice(0, 128); // Next hands the segment over decoded
  return <TrackClient mode="link" linkToken={linkToken} />;
}
