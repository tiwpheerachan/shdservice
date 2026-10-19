import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { clientIp } from '@/lib/client-ip';
import { hit, ipKeyOf } from './track-guard';

/** every tracking response: never cached anywhere (spec §P, §AE) */
const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

export function trackJson(body: Record<string, unknown>, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...extra } });
}

/** per-request context: trusted IP (ticket binding, Turnstile) + the HMAC of its rate bucket (IPv6 → /64,
 *  so rotating addresses does not reset the limits; also the log ipHash), UA and a request id */
export function trackCtx(req: NextRequest) {
  const ip = clientIp(req.headers);
  return {
    ip,
    ipKey: ipKeyOf(ip),
    ua: req.headers.get('user-agent') ?? '',
    requestId: randomUUID(),
  };
}

/** the signed-in customer's routes (/api/track/me*): 30 requests a minute per IP */
export const meIpOk = (ipKey: string) => hit('me_ip_min', ipKey, 30, 60);

/** small JSON body only (no field is ever longer than a few hundred chars) — routes read it with parseTrackBody */
export async function readSmallJson(req: NextRequest): Promise<Record<string, unknown>> {
  const text = await req.text().catch(() => '');
  if (!text || text.length > 8_192) return {};
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
