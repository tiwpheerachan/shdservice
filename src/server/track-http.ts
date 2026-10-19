import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { clientIp } from '@/lib/client-ip';
import { TRACK_MSG } from '@/lib/track-public';
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

/** the most a /track body may be: no field is ever longer than a few hundred chars */
const MAX_BODY_BYTES = 8_192;
/** a /track body over MAX_BODY_BYTES — every route that reads one answers bodyTooLarge() for it */
export class BodyTooLarge extends Error {}
export const bodyTooLarge = () => trackJson({ ok: false, error: TRACK_MSG.tooLarge }, 413);

/** the body as text, refused (BodyTooLarge) past `max` bytes: by Content-Length before reading, else while
 *  streaming — a chunked body without a length is never buffered whole. A broken stream reads as ''. */
async function readCapped(req: NextRequest, max: number): Promise<string> {
  if (Number(req.headers.get('content-length') ?? 0) > max) throw new BodyTooLarge();
  const reader = req.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      size += r.value.byteLength;
      if (size > max) {
        void reader.cancel().catch(() => undefined);
        throw new BodyTooLarge();
      }
      chunks.push(r.value);
    }
  } catch (e) {
    if (e instanceof BodyTooLarge) throw e;
    return '';
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** small JSON body only — routes read it with parseTrackBody; not JSON / not an object reads as `{}` */
export async function readSmallJson(req: NextRequest): Promise<Record<string, unknown>> {
  const text = await readCapped(req, MAX_BODY_BYTES);
  if (!text) return {};
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
