/**
 * media-oneservice.shd-technology.co.th — job videos (and their thumbnails) from the private R2 bucket through Cloudflare's
 * edge cache. The app (src/server/storage.ts fileRedirect) checks who may see the file, then redirects here with a
 * link it signed (media.ts). Manual: docs/cloudflare-cdn.md.
 *
 * GET/HEAD only. A link not signed with MEDIA_SIGNING_KEY, or expired → 403. Served from this data center's cache
 * (caches.default, key = the URL WITHOUT exp/sig: every viewer shares one copy; it answers a Range itself, 206),
 * else from R2 — the requested range — while the whole object goes into the cache for 30 days (an object is never
 * rewritten: every upload gets a new random name and the browser's PUT carries If-None-Match: *). The browser may
 * keep its answer only until the link expires.
 */
import { mediaSigOk, parseRange } from './media';

// the slice of the Workers runtime used here (no @cloudflare/workers-types dependency)
interface R2Object {
  size: number;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
}
interface R2Bucket {
  head(key: string): Promise<R2Object | null>;
  get(
    key: string,
    o?: { range?: { offset: number; length: number } },
  ): Promise<(R2Object & { body: ReadableStream }) | null>;
}
export interface Env {
  MEDIA: R2Bucket;
  MEDIA_SIGNING_KEY: string;
  APP_ORIGIN: string;
}
interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

const EDGE = 'public, max-age=2592000, immutable';
/** the only types served as themselves (storage.ts VIDEO_TYPES + the .jpg thumbnail); anything else is bytes */
const TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg']);
const cors = (env: Env) => ({
  'Access-Control-Allow-Origin': env.APP_ORIGIN,
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
});
const fail = (env: Env, status: number, extra: Record<string, string> = {}) =>
  new Response(null, { status, headers: { ...cors(env), 'Cache-Control': 'no-store', ...extra } });

async function serve(req: Request, env: Env, ctx: Ctx): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(env, 405, { Allow: 'GET, HEAD' });

  const url = new URL(req.url);
  let key = '';
  try {
    key = decodeURIComponent(url.pathname.slice(1));
  } catch {}
  const exp = url.searchParams.get('exp');
  // no key / a "folder" → 403 like any unsigned link: nothing is ever listed
  if (!key || key.endsWith('/') || !(await mediaSigOk(env.MEDIA_SIGNING_KEY, key, exp, url.searchParams.get('sig'))))
    return fail(env, 403);

  // the browser keeps it until the link expires (≤ MAX_LINK_S: mediaSigOk refuses a longer life)
  const browser = `private, max-age=${Math.max(0, Number(exp) - Math.floor(Date.now() / 1000))}`;
  const reply = (body: ReadableStream | null, status: number, from: Headers, cache: 'HIT' | 'MISS') => {
    const h = new Headers(from);
    h.delete('Age'); // the edge copy's age is not the browser's business: it may keep it `browser` seconds
    h.set('Cache-Control', browser);
    h.set('Content-Security-Policy', "sandbox; default-src 'none'");
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('X-Media-Cache', cache);
    for (const [k, v] of Object.entries(cors(env))) h.set(k, v);
    if (req.method === 'HEAD') {
      void body?.cancel();
      body = null;
    }
    return new Response(body, { status, headers: h });
  };

  const cacheKey = url.origin + url.pathname;
  const cache = (caches as unknown as { default: Cache }).default;
  const range = req.headers.get('Range');
  const hit = await cache.match(new Request(cacheKey, { headers: range ? { Range: range } : {} }));
  if (hit) return reply(hit.body, hit.status, hit.headers, 'HIT');

  const head = await env.MEDIA.head(key);
  if (!head) return fail(env, 404);
  const r = parseRange(range, head.size);
  if (r === 'unsatisfiable') return fail(env, 416, { 'Content-Range': `bytes */${head.size}` });
  const obj = req.method === 'HEAD' ? null : await env.MEDIA.get(key, r ? { range: r } : {});
  if (req.method === 'GET' && !obj) return fail(env, 404);
  // only these from the stored object — never its other metadata (Content-Disposition, Content-Encoding, …)
  const type = head.httpMetadata?.contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  const h = new Headers({
    'Content-Type': TYPES.has(type) ? type : 'application/octet-stream',
    ETag: head.httpEtag,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(r ? r.length : head.size),
  });
  if (r) h.set('Content-Range', `bytes ${r.offset}-${r.offset + r.length - 1}/${head.size}`);

  // the cache is filled by the request that starts a view (no Range, or bytes=0-…), not by every seek
  // ponytail: a second full read from R2 (no tee: a tee would buffer up to 200 MB in 128 MB of memory); two viewers
  // starting at once in a cold data center both fill — harmless, the same bytes. waitUntil lives ~30 s past the
  // response: a fill that cannot copy 200 MB from R2 in that time is dropped and the next view tries again.
  if (req.method === 'GET' && (!r || r.offset === 0))
    ctx.waitUntil(
      env.MEDIA.get(key)
        .then((full) => {
          if (!full) return;
          const ch = new Headers(h);
          ch.delete('Content-Range');
          ch.set('Content-Length', String(full.size));
          ch.set('Cache-Control', EDGE);
          return cache.put(cacheKey, new Response(full.body, { headers: ch }));
        })
        .catch((e: unknown) => console.error('media cache fill failed', String(e))),
    );
  return reply(obj?.body ?? null, r ? 206 : 200, h, 'MISS');
}

const worker = {
  /** anything that throws (R2 / cache unreachable) → a bare 503, logged (wrangler tail / Workers Logs) — never details */
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    try {
      return await serve(req, env, ctx);
    } catch (e) {
      console.error('media failed', String(e));
      return fail(env, 503, { 'Retry-After': '30' });
    }
  },
};
export default worker;
