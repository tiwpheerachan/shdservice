/**
 * npm run test:media — the media link (media.ts: what the app signs is what the Worker accepts), Range parsing, and
 * the Worker against an in-memory R2 bucket and edge cache. node:test, no Workers runtime needed.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_LINK_S, mediaSigOk, mediaUrl, parseRange } from './media';
import worker, { type Env } from './index';

const KEY = 'unit-test-media-key-0123456789abcdef';
const FILE = `jobs/J 1/attachments/v20261031120000${'ab'.repeat(10)}.mp4`;
const BASE = 'https://media.example.test';

test('the link the app builds verifies; anything changed does not', async () => {
  const now = Date.UTC(2026, 9, 31);
  const u = new URL(await mediaUrl(`${BASE}/`, KEY, FILE, 900, now));
  assert.equal(u.origin + u.pathname, `${BASE}/jobs/J%201/attachments/v20261031120000${'ab'.repeat(10)}.mp4`);
  const exp = u.searchParams.get('exp')!;
  const sig = u.searchParams.get('sig')!;
  assert.equal(Number(exp), now / 1000 + 900);
  assert.match(sig, /^[\w-]{43}$/);
  const key = decodeURIComponent(u.pathname.slice(1));
  assert.equal(await mediaSigOk(KEY, key, exp, sig, now), true);
  assert.equal(await mediaSigOk(KEY, key, exp, sig, now + 900_000), false); // expired
  assert.equal(await mediaSigOk(KEY, `${key}.jpg`, exp, sig, now), false); // another file
  assert.equal(await mediaSigOk(KEY, key, String(Number(exp) + 1), sig, now), false); // a longer life
  assert.equal(await mediaSigOk(KEY, key, `0${exp}`, sig, now), false);
  assert.equal(await mediaSigOk('another-key', key, exp, sig, now), false);
  assert.equal(await mediaSigOk('', key, exp, sig, now), false); // no secret set (the Worker without its secret)
  for (const bad of [
    null,
    '',
    'x',
    sig.slice(1),
    `${sig}A`,
    sig.slice(0, 20) + (sig[20] === 'A' ? 'B' : 'A') + sig.slice(21),
  ])
    assert.equal(await mediaSigOk(KEY, key, exp, bad, now), false, String(bad));
  // the same bytes with the last character's 2 unused bits set: not the canonical form → refused
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const alias = sig.slice(0, 42) + B64[B64.indexOf(sig[42]!) | 1];
  assert.equal(await mediaSigOk(KEY, key, exp, alias, now), false);
  assert.equal(await mediaSigOk(KEY, key, null, sig, now), false);
});

test('a link lives at most MAX_LINK_S (2 days); the secret is used trimmed on both sides', async () => {
  const now = Date.UTC(2026, 9, 31);
  const check = async (signKey: string, verifyKey: string, seconds: number) => {
    const u = new URL(await mediaUrl(BASE, signKey, FILE, seconds, now));
    return mediaSigOk(verifyKey, FILE, u.searchParams.get('exp'), u.searchParams.get('sig'), now);
  };
  assert.equal(MAX_LINK_S, 172800);
  assert.equal(await check(KEY, KEY, MAX_LINK_S), true);
  assert.equal(await check(KEY, KEY, MAX_LINK_S + 1), false);
  assert.equal(await check(` ${KEY}\n`, KEY, 900), true); // Render value pasted with a newline
  assert.equal(await check(KEY, `${KEY}\n`, 900), true); // wrangler secret put with a newline
  assert.equal(await check(KEY, `${KEY}x`, 900), false);
  assert.equal(await mediaSigOk(' \n', FILE, String(now / 1000 + 60), 'A'.repeat(43), now), false);
});

test('parseRange (RFC 9110)', () => {
  const size = 1000;
  const cases: [string | null, ReturnType<typeof parseRange>][] = [
    [null, null],
    ['bytes=0-', { offset: 0, length: 1000 }],
    ['bytes=0-0', { offset: 0, length: 1 }],
    ['bytes=100-199', { offset: 100, length: 100 }],
    ['bytes=900-5000', { offset: 900, length: 100 }], // clamped to the end
    ['bytes=-100', { offset: 900, length: 100 }],
    ['bytes=-5000', { offset: 0, length: 1000 }],
    ['bytes=1000-', 'unsatisfiable'],
    ['bytes=-0', 'unsatisfiable'],
    ['bytes=5-4', null], // invalid → ignored
    ['bytes=-', null],
    ['bytes=0-1,5-6', null], // several ranges → the whole object
    ['items=0-1', null],
  ];
  for (const [h, want] of cases) assert.deepEqual(parseRange(h, size), want, String(h));
  assert.equal(parseRange('bytes=0-', 0), 'unsatisfiable');
});

// the Worker with an in-memory R2 bucket and edge cache
const BYTES = new Uint8Array(1000).map((_, i) => i % 251);
const reads: string[] = [];
const env: Env = {
  MEDIA_SIGNING_KEY: KEY,
  APP_ORIGIN: 'https://app.example.test',
  MEDIA: {
    async head(key) {
      reads.push(`head ${key}`);
      if (r2Down) throw new Error('R2 unreachable');
      return obj(key);
    },
    async get(key, o) {
      reads.push(`get ${key} ${o?.range ? `${o.range.offset}+${o.range.length}` : 'all'}`);
      const found = obj(key);
      if (!found) return null;
      const r = o?.range ?? { offset: 0, length: BYTES.length };
      return { ...found, body: new Blob([BYTES.subarray(r.offset, r.offset + r.length)]).stream() };
    },
  },
};
let r2Down = false;
/** what R2 holds: the video, and an object whose stored metadata must not reach the browser */
const OBJECTS: Record<string, Record<string, string>> = {
  [FILE]: { contentType: 'video/mp4' },
  [`${FILE}.odd`]: { contentType: 'text/html; charset=utf-8', contentDisposition: 'inline', contentEncoding: 'gzip' },
};
function obj(key: string) {
  const httpMetadata = OBJECTS[key];
  return httpMetadata ? { size: BYTES.length, httpEtag: '"e1"', httpMetadata } : null;
}
// the edge cache: stores whole responses; answers a Range with 206 itself, as Cloudflare's does
const stored = new Map<string, { headers: Headers; bytes: Uint8Array }>();
Object.defineProperty(globalThis, 'caches', {
  configurable: true,
  value: {
    default: {
      async put(req: string, res: Response) {
        stored.set(req, { headers: new Headers(res.headers), bytes: new Uint8Array(await res.arrayBuffer()) });
      },
      async match(req: Request) {
        const s = stored.get(req.url);
        if (!s) return undefined;
        s.headers.set('Age', '120'); // as Cloudflare's cache adds
        const r = parseRange(req.headers.get('range'), s.bytes.length);
        if (!r || r === 'unsatisfiable') return new Response(s.bytes.slice(), { headers: s.headers });
        const h = new Headers(s.headers);
        h.set('Content-Range', `bytes ${r.offset}-${r.offset + r.length - 1}/${s.bytes.length}`);
        return new Response(s.bytes.slice(r.offset, r.offset + r.length), { status: 206, headers: h });
      },
    },
  },
});
async function get(url: string, init: RequestInit = {}, e: Env = env) {
  const waits: Promise<unknown>[] = [];
  const res = await worker.fetch(new Request(url, init), e, { waitUntil: (p) => void waits.push(p) });
  await Promise.all(waits);
  return res;
}

test('the Worker: refuses, serves a range from R2 while filling the cache, then answers from the cache', async () => {
  const link = await mediaUrl(BASE, KEY, FILE, 900);
  assert.equal((await get(link.replace(/sig=[\w-]+/, `sig=${'A'.repeat(43)}`))).status, 403);
  assert.equal((await get(link.replace(/exp=\d+/, 'exp=1'))).status, 403);
  assert.equal((await get(BASE + '/')).status, 403);
  assert.equal((await get(link, { method: 'POST' })).status, 405);
  assert.equal((await get(await mediaUrl(BASE, KEY, `${FILE}.gone`, 900))).status, 404);
  assert.equal(reads.length, 1); // nothing read from R2 for a refused link

  reads.length = 0;
  const first = await get(link, { headers: { Range: 'bytes=0-99' } });
  assert.equal(first.status, 206);
  assert.deepEqual(new Uint8Array(await first.arrayBuffer()), BYTES.subarray(0, 100));
  const h = Object.fromEntries(first.headers);
  assert.equal(h['content-range'], 'bytes 0-99/1000');
  assert.equal(h['content-length'], '100');
  assert.deepEqual(
    [h['accept-ranges'], h.etag, h['content-type'], h['x-media-cache']],
    ['bytes', '"e1"', 'video/mp4', 'MISS'],
  );
  assert.equal(h['access-control-allow-origin'], 'https://app.example.test');
  assert.match(h['cache-control']!, /^private, max-age=(899|900)$/);
  assert.deepEqual(reads, [`head ${FILE}`, `get ${FILE} 0+100`, `get ${FILE} all`]);
  // one cached copy for everyone: the key has no exp / sig; the edge keeps it 30 days
  const keyUrl = `${BASE}/${FILE.replace(' ', '%20')}`;
  assert.deepEqual([...stored.keys()], [keyUrl]);
  assert.equal(stored.get(keyUrl)!.headers.get('cache-control'), 'public, max-age=2592000, immutable');
  assert.equal(stored.get(keyUrl)!.headers.has('content-range'), false);

  // another viewer, another signature, a seek: from the cache, R2 untouched, still private for the browser
  reads.length = 0;
  const other = await get(await mediaUrl(BASE, KEY, FILE, 600), { headers: { Range: 'bytes=500-' } });
  assert.deepEqual([other.status, other.headers.get('x-media-cache')], [206, 'HIT']);
  assert.equal(other.headers.get('content-range'), 'bytes 500-999/1000');
  assert.match(other.headers.get('cache-control')!, /^private, max-age=(599|600)$/);
  assert.equal(other.headers.get('age'), null); // the edge copy's Age is dropped
  assert.deepEqual(new Uint8Array(await other.arrayBuffer()), BYTES.subarray(500));
  assert.deepEqual(reads, []);
});

test('the Worker: a seek in a cold cache does not fill it; HEAD has no body; 416 past the end', async () => {
  stored.clear();
  reads.length = 0;
  const link = await mediaUrl(BASE, KEY, FILE, 900);
  const seek = await get(link, { headers: { Range: 'bytes=-10' } });
  assert.deepEqual([seek.status, seek.headers.get('content-range')], [206, 'bytes 990-999/1000']);
  assert.equal(stored.size, 0);
  const head = await get(link, { method: 'HEAD' });
  assert.deepEqual([head.status, head.headers.get('content-length'), await head.text()], [200, '1000', '']);
  const past = await get(link, { headers: { Range: 'bytes=1000-' } });
  assert.deepEqual([past.status, past.headers.get('content-range')], [416, 'bytes */1000']);
  const whole = await get(link);
  assert.deepEqual([whole.status, (await whole.arrayBuffer()).byteLength], [200, 1000]);
  assert.equal(stored.size, 1);
});

test('the Worker: only safe headers from R2, a sandbox CSP, a capped life, a trimmed key, 503 when R2 fails', async () => {
  stored.clear();
  const odd = await get(await mediaUrl(BASE, KEY, `${FILE}.odd`, 900), { headers: { Range: 'bytes=0-9' } });
  assert.equal(odd.status, 206);
  assert.equal(odd.headers.get('content-type'), 'application/octet-stream'); // text/html is not served as itself
  assert.deepEqual([odd.headers.get('content-disposition'), odd.headers.get('content-encoding')], [null, null]);
  assert.equal(odd.headers.get('content-security-policy'), "sandbox; default-src 'none'");
  assert.equal(odd.headers.get('x-content-type-options'), 'nosniff');
  const cached = stored.get(`${BASE}/${FILE.replace(' ', '%20')}.odd`)!.headers;
  assert.equal(cached.get('content-type'), 'application/octet-stream');
  // a link longer than 2 days (signed with the key) → 403, so the browser never keeps one longer
  assert.equal((await get(await mediaUrl(BASE, KEY, FILE, MAX_LINK_S + 60))).status, 403);
  const day = await get(await mediaUrl(BASE, KEY, FILE, 86400), { method: 'HEAD' });
  assert.match(day.headers.get('cache-control')!, /^private, max-age=(86399|86400)$/);
  // the Worker's secret set with a trailing newline still accepts the app's links
  const padded = { ...env, MEDIA_SIGNING_KEY: `${KEY}\n` };
  assert.equal((await get(await mediaUrl(BASE, KEY, FILE, 900), { method: 'HEAD' }, padded)).status, 200);
  // R2 throwing: a bare 503, nothing about why
  stored.clear();
  r2Down = true;
  const errors: unknown[] = [];
  const log = console.error;
  console.error = (...a: unknown[]) => void errors.push(a);
  try {
    const down = await get(await mediaUrl(BASE, KEY, FILE, 900));
    assert.deepEqual([down.status, down.headers.get('cache-control'), await down.text()], [503, 'no-store', '']);
    assert.equal(errors.length, 1);
  } finally {
    console.error = log;
    r2Down = false;
  }
});
