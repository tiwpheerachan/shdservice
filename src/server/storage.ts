import 'server-only';
import sharp from 'sharp';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isoDateTime } from '@/lib/dates';
import { HttpError } from '@/server/http-error';
import { logError } from '@/lib/log';

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
 */
export const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'oneservice';

export const filePath = {
  attachment: (jobNo: string, file: string) => `jobs/${jobNo}/attachments/${file}`,
  jobSlip: (jobNo: string, file: string) => `jobs/${jobNo}/slip/${file}`,
  saleOrderSlip: (soNo: string, file: string) => `sale-orders/${soNo}/slip/${file}`,
  productImage: (code: string, file: string) => `products/${code}/${file}`,
  profileLogo: (id: number, file: string) => `profiles/${id}/${file}`,
  shipperLogo: (id: number, file: string) => `shippers/${id}/${file}`,
};

/** Accept either a stored full path or a bare file name (legacy / short columns). */
export function resolvePath(stored: string, fallback: (file: string) => string): string {
  return stored.includes('/') ? stored : fallback(stored);
}

export const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** extension stored for each accepted type — never the one in the user's file name */
const EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'image/svg+xml': '.svg',
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

export async function uploadFile(path: string, file: File | Blob, contentType?: string): Promise<void> {
  const s = storage();
  // create the bucket on first use per process (no-op if it exists) — not a round-trip per upload
  bucketReady ??= s.createBucket(BUCKET, { public: false }).then(
    () => undefined,
    () => undefined,
  );
  await bucketReady;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await s
    .from(BUCKET)
    .upload(path, buf, { contentType: contentType || (file as File).type || 'application/octet-stream', upsert: true });
  if (error)
    throw new Error(
      `อัปโหลดไฟล์ไม่สำเร็จ (Supabase Storage: ${error.message}) — ตรวจสอบ SUPABASE_SECRET_KEY / bucket "${BUCKET}"`,
    );
}

export async function signedUrl(path: string, seconds = 120): Promise<string | null> {
  const { data, error } = await storage().from(BUCKET).createSignedUrl(path, seconds);
  if (error) {
    logError(error, 'storage signedUrl failed');
    return null;
  }
  return data.signedUrl;
}

export async function removeFile(path: string): Promise<void> {
  // a leftover object is not worth failing the save that replaced it — logged, then dropped
  const { error } = await storage()
    .from(BUCKET)
    .remove([path])
    .catch((e: unknown) => ({ error: e }));
  if (error) logError(error, 'storage removeFile failed');
}
