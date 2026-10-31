import 'server-only';
import sharp from 'sharp';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AwsClient } from 'aws4fetch';
import { LRUCache } from 'lru-cache';
import { NextResponse } from 'next/server';
import { isoDateTime } from '@/lib/dates';
import { HttpError } from '@/server/http-error';
import { logError } from '@/lib/log';
import { mediaUrl } from '../../workers/media/src/media';

/**
 * File storage — one PRIVATE Supabase Storage bucket `oneservice`, served only
 * through /api/files (signed URL, login required). Layout:
 *   jobs/{jobNo}/attachments/{file}   document_attach.system_file_name  (file name only, 50 chars)
 *   jobs/{jobNo}/slip/{file}          job.job_payment_slip_file_name    (full path)
 *   sale-orders/{soNo}/slip/{file}    sale_out_hd.slip_file_name        (full path)
 *   products/{code}/{file}            product.pictrue_file_name         (file name only, 50 chars)
 * Legacy product images and job attachments (the old server's FileUpload folder)
 * were copied into the same layout; rows whose file was missing on the old server
 * just show their file name.
 * Video attachments are the exception: Cloudflare R2 (onR2 below), same paths.
 */
export const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'oneservice';

export const filePath = {
  attachment: (jobNo: string, file: string) => `jobs/${jobNo}/attachments/${file}`,
  jobSlip: (jobNo: string, file: string) => `jobs/${jobNo}/slip/${file}`,
  saleOrderSlip: (soNo: string, file: string) => `sale-orders/${soNo}/slip/${file}`,
  productImage: (code: string, file: string) => `products/${code}/${file}`,
  // the profile's uuid (ADR 0008); logos stored before it keep their profiles/{int}/ path
  profileLogo: (id: string, file: string) => `profiles/${id}/${file}`,
  shipperLogo: (id: string, file: string) => `shippers/${id}/${file}`,
};

/** Accept either a stored full path or a bare file name (legacy / short columns). */
export function resolvePath(stored: string, fallback: (file: string) => string): string {
  return stored.includes('/') ? stored : fallback(stored);
}

export const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Video job attachments (a customer's clip of the fault): converted in the browser (src/lib/video.ts) and PUT
 * straight to Cloudflare R2 with a presigned URL — never through this server — then checked by
 * checkStoredVideo. Kept forever for now; a retention rule (e.g. delete N days after the job closes) may come
 * (R2 moves them to Infrequent Access after 30 days — a lifecycle rule set in Cloudflare).
 */
export const VIDEO_TYPES: ReadonlySet<string> = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/** extension stored for each accepted type — never the one in the user's file name */
const EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};
/** a logo may also be an SVG (logos only — never a photo / slip: sharp would rasterise it) */
export const LOGO_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']);

/** first bytes of each accepted type (OneLink lib/api/validate.ts) */
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
  'application/pdf': (b) => ascii(b, 0, 5) === '%PDF-',
  // text: checked whole by svgProblem
  'image/svg+xml': () => true,
  // ISO base media (MP4 / MOV): the first box is `ftyp`; WebM: the EBML header
  'video/mp4': (b) => ascii(b, 4, 8) === 'ftyp',
  'video/quicktime': (b) => ascii(b, 4, 8) === 'ftyp',
  'video/webm': (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
};

/**
 * An SVG is a document, not pixels: it can carry script, event handlers, links and other files. Shown through
 * <img> none of that runs, but the file is also opened on its own (a signed storage URL) — so only a plain
 * drawing is taken: no script / handlers / javascript: / embedded HTML / entities, nothing loaded from elsewhere
 * (an embedded raster `data:image/png|jpeg|webp|gif` and `#id` references are fine). Refused, never "cleaned".
 */
export function svgProblem(text: string): string | null {
  const raw = text.replace(/^\uFEFF/, '');
  if (!/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE svg[^>[]*>\s*)*<svg[\s>]/i.test(raw))
    return 'ไฟล์ไม่ใช่ SVG จริง';
  // read as the browser will: character references decoded (&#106;avascript: is javascript:), and a URL's
  // tabs / newlines dropped (java&#9;script:) — the checks below run on that, and on the raw text
  const decoded = raw
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16) % 0x110000))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(Number(d) % 0x110000))
    .replace(
      /&(colon|tab|newline|lpar|rpar|sol|num|amp|quot|apos);/gi,
      (m, n: string) =>
        ({
          colon: ':',
          tab: '\t',
          newline: '\n',
          lpar: '(',
          rpar: ')',
          sol: '/',
          num: '#',
          amp: '&',
          quot: '"',
          apos: "'",
        })[n.toLowerCase()] ?? m,
    );
  const squeezed = decoded.replace(/[\s\u0000-\u001f]+/g, '').toLowerCase();
  const bad =
    // animation elements can rewrite any attribute (an href into javascript:) after the file is checked
    /<script|<foreignObject|<iframe|<embed|<object|<!ENTITY|<(?:set|animate|animateMotion|animateTransform|discard|handler|listener)[\s/>]|\son[a-z]+\s*=|(?:href|src)\s*=\s*["']?\s*(?!#|data:image\/(?:png|jpe?g|webp|gif);)[^"'\s>]|url\(\s*["']?\s*(?!#|data:image\/(?:png|jpe?g|webp|gif);)[^)"'\s]|@import/i;
  return bad.test(raw) || bad.test(decoded) || /(?:javascript|vbscript|livescript):|data:text\/html/.test(squeezed)
    ? 'SVG นี้มีสคริปต์ ภาพเคลื่อนไหว หรือลิงก์ไปไฟล์อื่น — ส่งออกเป็น SVG ธรรมดา หรือใช้ PNG แทน'
    : null;
}

/**
 * An uploaded file is there, not empty, within the size, one of `types` — and its
 * bytes say so. The declared type alone is the browser's guess from the name: an SVG
 * or HTML file renamed .png would otherwise reach sharp/librsvg or be served to staff.
 * Returns an error message (Thai) or null.
 */
export async function fileProblem(file: File, types: ReadonlySet<string> = ALLOWED_TYPES): Promise<string | null> {
  if (file.size === 0) return 'ไฟล์ว่างเปล่า';
  if (file.size > MAX_FILE_BYTES) return 'ไฟล์ใหญ่เกิน 10MB';
  const label = [...types].map((t) => EXT[t]?.slice(1).toUpperCase()).join(', ');
  if (!types.has(file.type)) return `รองรับเฉพาะ ${label}`;
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!SIGNATURES[file.type]?.(head))
    return `ไฟล์ไม่ใช่ ${EXT[file.type]?.slice(1).toUpperCase()} จริง — รองรับเฉพาะ ${label}`;
  if (file.type === 'image/svg+xml') return svgProblem(await file.text());
  return null;
}

/** Longest edge kept for uploaded photos (product images / payment slips). */
export const IMAGE_MAX_EDGE = 1600;

/** a photo never needs more than this; a tiny file declaring 16k×16k pixels would eat ~1 GB of RAM */
export const MAX_IMAGE_PIXELS = 40_000_000;
export class ImageTooLargeError extends Error {}

/**
 * Shrink an uploaded photo before it goes to the bucket: apply EXIF rotation,
 * cap the longest edge at IMAGE_MAX_EDGE, re-encode at quality 82. jpg/webp
 * keep their format. A PNG WITHOUT transparency is a photo saved in the wrong
 * container (lossless PNG barely shrinks it) — it comes back as JPEG with a
 * .jpg name; a PNG with transparency (logo, graphic) stays PNG. The stored
 * file name is generated from the returned name, so nothing legacy is renamed.
 * Anything that is not a raster image, or that would not get smaller and carries no EXIF, is
 * returned untouched (EXIF — GPS, camera serial — is always stripped by re-encoding); a decode failure falls back to the original file rather
 * than rejecting the upload.
 */
export async function optimizeImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const input = Buffer.from(await file.arrayBuffer());
  // header only (no decode): reject decompression bombs before sharp allocates the pixels
  const meta = await sharp(input, { failOn: 'none', limitInputPixels: false })
    .metadata()
    .catch(() => null);
  if (meta?.width && meta.height && meta.width * meta.height > MAX_IMAGE_PIXELS) throw new ImageTooLargeError();
  try {
    const img = sharp(input, { failOn: 'none', limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate()
      .resize({ width: IMAGE_MAX_EDGE, height: IMAGE_MAX_EDGE, fit: 'inside', withoutEnlargement: true });
    let type = file.type;
    let name = file.name;
    let out: Buffer;
    // phones/screens often export photos as PNG with a fully opaque alpha channel — stats().isOpaque sees through that
    if (
      type === 'image/png' &&
      !(await sharp(input, { failOn: 'none', limitInputPixels: MAX_IMAGE_PIXELS }).stats()).isOpaque
    ) {
      out = await img.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    } else if (type === 'image/webp') {
      out = await img.webp({ quality: 82 }).toBuffer();
    } else {
      out = await img.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
      if (type === 'image/png') {
        type = 'image/jpeg';
        name = name.replace(/\.png$/i, '') + '.jpg';
      }
    }
    if (out.length >= input.length && type === file.type && !meta?.exif) return file;
    return new File([new Uint8Array(out)], name, { type, lastModified: file.lastModified });
  } catch {
    return file;
  }
}

let client: SupabaseClient | null = null;
let bucketReady: Promise<void> | null = null;
function storage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new HttpError(
      503,
      'ระบบจัดเก็บไฟล์ยังไม่ได้ตั้งค่า (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY) — แนบไฟล์ไม่ได้ชั่วคราว',
    );
  if (!client)
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      // a hung Storage must not hold upload requests (and memory on a 512 MB instance)
      global: {
        fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) }),
      },
    });
  return client.storage;
}

/**
 * Stored name: Bangkok timestamp + 20 hex of a random UUID (76 random bits — a path is not guessable from
 * the upload time) + the extension of the file's (checked) type. 39 chars: fits the 50-char name columns.
 */
export function systemFileName(type: string): string {
  const ext = EXT[type] ?? '';
  const stamp = isoDateTime(new Date(), { seconds: true }).replace(/\D/g, ''); // Bangkok, whatever the server TZ
  return `${stamp}${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}${ext}`;
}

/**
 * Which store a path is in. A video POST /api/attachments/video issues is named `v` + systemFileName — the `v`
 * is what sends it to Cloudflare R2: jobs/{no}/attachments/v{14 digits}{20 hex}.mp4|mov|webm, and its thumbnail
 * (the same + `.jpg`). Everything else stays in Supabase: images, PDFs, slips, logos — and the legacy system's
 * .mp4 attachments, whose names have no such `v` (so a video is never routed by its extension alone).
 */
const ON_R2 = /^jobs\/[^/]+\/attachments\/v\d{14}[0-9a-f]{20}\.(?:mp4|mov|webm)(?:\.jpg)?$/;
export const onR2 = (path: string) => ON_R2.test(path);
/** a new video's stored name (40 chars) — see onR2 */
export const videoFileName = (type: string) => `v${systemFileName(type)}`;

/**
 * Cloudflare R2 — bucket R2_BUCKET (private), S3 API signed with SigV4 (aws4fetch), path-style
 * https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com/{bucket}/{key}. Unset → the video API answers 503 and the
 * attach box offers no video (R2_MISSING); images / PDFs are unaffected.
 */
const R2_ENV = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const;
export const R2_MISSING = 'ยังไม่ได้ตั้งค่าที่เก็บวิดีโอ — ติดต่อผู้ดูแลระบบ';
const r2Env = (k: (typeof R2_ENV)[number]) => (process.env[k] ?? '').trim();
export const r2Ready = () => R2_ENV.every((k) => !!r2Env(k));
let r2Client: AwsClient | null = null;
/** the client and the object's URL; 503 when R2 is not configured */
function r2(path: string) {
  if (!r2Ready()) throw new HttpError(503, R2_MISSING);
  r2Client ??= new AwsClient({
    accessKeyId: r2Env('R2_ACCESS_KEY_ID'),
    secretAccessKey: r2Env('R2_SECRET_ACCESS_KEY'),
    service: 's3',
    region: 'auto',
    retries: 1, // its default (10, with backoff) would hold a request far past the 15 s timeout
  });
  const url = new URL(`https://${r2Env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${r2Env('R2_BUCKET')}/${path}`);
  return { client: r2Client, url };
}
/**
 * MEDIA_BASE_URL + MEDIA_SIGNING_KEY both set: an R2 object is played (not downloaded) through the media Worker —
 * Cloudflare's edge cache, workers/media, docs/cloudflare-cdn.md — with a link signed here, same lifetime. Unset (dev,
 * CI, until the Worker is deployed) → the presigned R2 URL, as before.
 */
function mediaEnv() {
  const base = (process.env.MEDIA_BASE_URL ?? '').trim();
  const key = (process.env.MEDIA_SIGNING_KEY ?? '').trim();
  return base && key ? { base, key } : null;
}
/** a presigned R2 URL (the query carries the signature and `X-Amz-Expires`) */
const r2Presign = async (client: AwsClient, url: URL, init: RequestInit) =>
  (await client.sign(url, { ...init, aws: { signQuery: true, allHeaders: true } })).url;

/** the bucket, created on first use per process (no-op if it exists) — not a round-trip per upload */
async function bucket() {
  const s = storage();
  bucketReady ??= s.createBucket(BUCKET, { public: false }).then(
    () => undefined,
    () => undefined,
  );
  await bucketReady;
  return s;
}

export async function uploadFile(path: string, file: File | Blob, contentType?: string): Promise<void> {
  const buf = Buffer.from(await file.arrayBuffer());
  const type = contentType || (file as File).type || 'application/octet-stream';
  if (onR2(path)) {
    const { client, url } = r2(path);
    const res = await client.fetch(url, {
      method: 'PUT',
      body: buf,
      headers: { 'content-type': type },
      signal: AbortSignal.timeout(15_000),
    });
    await res.body?.cancel();
    if (!res.ok) throw new Error(`อัปโหลดไฟล์ไม่สำเร็จ (R2: ${res.status}) — ตรวจสอบ R2_ACCESS_KEY_ID / R2_BUCKET`);
    return;
  }
  const s = await bucket();
  // names are never reused (systemFileName): what a browser keeps for a day is still the file (api/files PICTURE)
  const { error } = await s.from(BUCKET).upload(path, buf, { contentType: type, upsert: true, cacheControl: '86400' });
  if (error)
    throw new Error(
      `อัปโหลดไฟล์ไม่สำเร็จ (Supabase Storage: ${error.message}) — ตรวจสอบ SUPABASE_SECRET_KEY / bucket "${BUCKET}"`,
    );
}

/**
 * A presigned R2 URL the browser PUTs one video to, valid 2 h — a video is too big to pass through this server.
 * Signed with Content-Type `type`, Content-Length `size` (R2 refuses any other size — the caller checked it is
 * ≤ MAX_VIDEO_BYTES) and `If-None-Match: *` (a conditional write: R2 answers 412 when the key exists), so like
 * Supabase's upload URL it can never overwrite — not even the video it put there.
 * ponytail: a URL issued but never confirmed leaves its object in R2 (≤ 200 MB each, 30 issues a minute per user) —
 * a sweep of unconfirmed v… objects (or an R2 lifecycle rule) when that ever costs something.
 */
export async function signedUploadUrl(path: string, type: string, size: number): Promise<string> {
  const { client, url } = r2(path);
  url.searchParams.set('X-Amz-Expires', String(2 * 60 * 60));
  return r2Presign(client, url, {
    method: 'PUT',
    headers: { 'content-type': type, 'content-length': String(size), 'if-none-match': '*' },
  });
}

/**
 * A video the browser put straight into the bucket (signedUploadUrl — nothing here saw it): there, not empty,
 * ≤ MAX_VIDEO_BYTES, stored as the type its name says, and its first bytes say so too (`ftyp` / EBML). One ranged
 * GET reads 16 bytes and the size (Content-Range) — never the whole file. Throws 404 / 413 / 415 (Thai).
 */
export async function checkStoredVideo(path: string): Promise<void> {
  const type = [...VIDEO_TYPES].find((t) => path.endsWith(EXT[t]!));
  const init = { headers: { Range: 'bytes=0-15' }, signal: AbortSignal.timeout(15_000) };
  let res: Response | null;
  if (onR2(path)) {
    const { client, url } = r2(path);
    res = await client.fetch(url, init);
  } else {
    const url = await signedUrl(path, 60);
    res = url ? await fetch(url, init) : null;
  }
  if (!res?.ok) {
    await res?.body?.cancel();
    throw new HttpError(404, 'ไม่พบไฟล์วิดีโอที่อัปโหลด — แนบใหม่อีกครั้ง');
  }
  const size = Number(res.headers.get('content-range')?.split('/')[1] ?? res.headers.get('content-length'));
  const head = await firstBytes(res, 16);
  if (size > MAX_VIDEO_BYTES) throw new HttpError(413, 'วิดีโอใหญ่เกิน 200MB');
  if (!(size > 0) || !type || res.headers.get('content-type')?.split(';')[0] !== type || !SIGNATURES[type]!(head))
    throw new HttpError(415, 'ไฟล์ที่อัปโหลดไม่ใช่วิดีโอ MP4 / MOV / WebM จริง');
}

/** the first `n` bytes of a body; the rest is dropped unread (a server ignoring Range would send it all) */
async function firstBytes(res: Response, n: number): Promise<Uint8Array> {
  const out = new Uint8Array(n);
  let got = 0;
  const reader = res.body?.getReader();
  while (reader && got < n) {
    const { done, value } = await reader.read();
    if (done) break;
    const part = value.subarray(0, n - got);
    out.set(part, got);
    got += part.length;
  }
  await reader?.cancel();
  return out.subarray(0, got);
}

/**
 * A signed GET URL; `download` = sent as a download (a string: the name to save it as). null = the store has no
 * such file; any other failure of the store → 503 (logged) — an outage is not a missing file.
 */
export async function signedUrl(
  path: string,
  seconds = 120,
  download: boolean | string = false,
): Promise<string | null> {
  if (onR2(path)) {
    const media = !download && mediaEnv();
    if (media) return mediaUrl(media.base, media.key, path, seconds);
    const { client, url } = r2(path);
    url.searchParams.set('X-Amz-Expires', String(seconds));
    if (download) {
      const name =
        download === true
          ? ''
          : `; filename*=UTF-8''${encodeURIComponent(download).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`;
      url.searchParams.set('response-content-disposition', `attachment${name}`);
    }
    return r2Presign(client, url, { method: 'GET' });
  }
  const { data, error } = await storage().from(BUCKET).createSignedUrl(path, seconds);
  if (error) {
    // Supabase answers a missing object with 400 + statusCode "404" (newer versions: a 404)
    const e = error as { status?: number; statusCode?: string };
    if (e.status === 404 || e.statusCode === '404') return null;
    logError(error, 'storage signedUrl failed');
    throw new HttpError(503, 'ระบบจัดเก็บไฟล์ขัดข้อง ลองใหม่ภายหลัง');
  }
  // supabase-js puts its `download` option into the URL unencoded (a name with & or # would break it)
  return download
    ? `${data.signedUrl}&download=${download === true ? '' : encodeURIComponent(download)}`
    : data.signedUrl;
}

const URL_TTL_S = 120;
// a video plays from the signed URL itself, fetching ranges while it plays and seeks — valid long enough to watch
const VIDEO_TTL_S = 15 * 60;
const VIDEO = /\.(?:mp4|mov|webm)$/i;
/**
 * A picture (photo, product image, logo, a video's thumbnail — never a slip: a customer's payment details) gets ONE
 * signed URL a day, shared by everyone who may see it: the browser keeps the redirect and the image, Supabase's CDN
 * serves the same URL again — reopening a job does not download its pictures again. The price: a copied link opens
 * for up to a day, and a browser keeps what it saw after its rights are taken away.
 */
const PICTURE_TTL_S = 24 * 60 * 60;
const PICTURE = /\.(?:jpe?g|png|webp|svg)$/i;
const SLIP = /\/slip\//;
// ponytail: per process (one Render instance) — a restart signs anew, the old URLs stay valid until they expire
const pictures = new LRUCache<string, { url: string; exp: number }>({ max: 5000, ttl: (PICTURE_TTL_S - 3600) * 1000 });

/**
 * The answer of GET /api/files and GET /api/attachments/{id} (the caller checked who may see it): a redirect to the
 * file's signed URL that the browser may keep while it is valid — a picture a day (the same URL for both routes), a
 * video 15 minutes, a slip / PDF 2. 404 when the store has no such file (not kept: the next request tries again).
 */
export async function fileRedirect(path: string, o: { download?: boolean | string; isPublic?: boolean } = {}) {
  const picture = PICTURE.test(path) && !SLIP.test(path);
  const ttl = picture ? PICTURE_TTL_S : VIDEO.test(path) ? VIDEO_TTL_S : URL_TTL_S;
  const key = `${path}\n${o.download || ''}`; // no download: one entry, whatever said so
  let signed = picture ? pictures.get(key) : undefined;
  if (!signed) {
    const url = await signedUrl(path, ttl, o.download);
    if (!url) throw new HttpError(404, 'ไม่พบไฟล์ (อาจอยู่บนระบบเก่า)');
    signed = { url, exp: Date.now() + ttl * 1000 };
    if (picture) pictures.set(key, signed);
  }
  const maxAge = Math.floor((signed.exp - Date.now()) / 1000) - 60;
  return NextResponse.redirect(signed.url, {
    headers: { 'Cache-Control': `${o.isPublic ? 'public' : 'private'}, max-age=${maxAge}` },
  });
}

export async function removeFile(path: string): Promise<void> {
  // a leftover object is not worth failing the save that replaced it — logged, then dropped
  if (onR2(path)) {
    if (!r2Ready()) return; // nothing can be there
    try {
      const { client, url } = r2(path);
      const res = await client.fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(15_000) });
      await res.body?.cancel();
      if (!res.ok) throw new Error(`R2 DELETE answered ${res.status}`);
    } catch (e) {
      logError(e, 'storage removeFile failed');
    }
    return;
  }
  const { error } = await storage()
    .from(BUCKET)
    .remove([path])
    .catch((e: unknown) => ({ error: e }));
  if (error) logError(error, 'storage removeFile failed');
}
