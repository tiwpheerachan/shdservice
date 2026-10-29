/**
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-video.mts
 * Video attachments (src/app/api/attachments/video): the browser PUTs the clip straight to Cloudflare R2 with a
 * presigned URL, then confirm checks what arrived — there, ≤ 200 MB, stored as a video, its first bytes `ftyp` /
 * EBML — before the attachment row goes in; refused → the object is removed. Both stores are fakes behind
 * globalThis.fetch: Supabase Storage (legacy .mp4 attachments still open from it) and a tiny S3-compatible R2 stub
 * that refuses anything without a SigV4 Authorization header or presigned query, and serves PUT / GET (Range) /
 * HEAD / DELETE. "The browser's PUT" is a write into the R2 map (or a real PUT to the presigned URL). Its own
 * fixtures (ids 988x, jobs QV*, users qv-*).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { AwsV4Signer } from 'aws4fetch';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

const MP4 = new Uint8Array([0, 0, 0, 0x20, ...new TextEncoder().encode('ftypisom'), 0, 0, 2, 0, 0, 0, 0]);
if (process.argv[2] === 'client') {
  // src/lib/video.ts runs in the browser — imported in a child process without the react-server condition (its
  // lib/api pulls next/navigation), with a fake XMLHttpRequest whose PUT never reaches storage
  const { mmss, prepareVideo, uploadVideo } = await import('@/lib/video');
  const { errMsg } = await import('@/lib/api');
  assert.deepEqual([59.2, 180, 180.3, 239.6].map(mmss), ['1:00', '3:00', '3:01', '4:00']); // never "3:60"
  const unreadable = new File([MP4], 'clip.mov', { type: 'video/quicktime' });
  unreadable.slice = () =>
    ({ arrayBuffer: () => Promise.reject(new DOMException('gone', 'NotReadableError')) }) as never;
  await assert.rejects(
    prepareVideo(unreadable, () => {}, new AbortController().signal),
    {
      message: 'อ่านไฟล์วิดีโอนี้ไม่ได้ — ถ้าไฟล์อยู่บน iCloud หรือคลาวด์ ให้ดาวน์โหลดลงเครื่องก่อน แล้วเลือกใหม่',
    },
  );
  const asked: unknown[] = [];
  globalThis.fetch = (async (_: string, init: RequestInit) => {
    asked.push(JSON.parse(String(init.body)));
    return Response.json({ file: `v20261028120000${'ab'.repeat(10)}.mp4`, url: 'https://r2.example.test/x' });
  }) as typeof fetch;
  globalThis.XMLHttpRequest = class {
    upload = {};
    onerror = () => {};
    open() {}
    setRequestHeader() {}
    send() {
      setTimeout(() => this.onerror());
    }
  } as never;
  const v = { file: new File([MP4], 'clip.mp4', { type: 'video/mp4' }), thumb: null, converted: true };
  const put = () => uploadVideo('QV0001', v, '', () => {}, new AbortController().signal).catch(errMsg);
  // online: storage did not take it — not "check your internet"
  assert.equal(await put(), 'อัปโหลดวิดีโอไปที่เก็บไม่สำเร็จ — ลองใหม่อีกครั้ง หากยังไม่ได้ แจ้งผู้ดูแลระบบ');
  assert.deepEqual(asked[0], { jobNo: 'QV0001', type: 'video/mp4', size: MP4.length }); // the size gets signed
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  assert.equal(await put(), 'เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
  process.exit(0);
}

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
const STORAGE = 'http://storage.qv.test';
Object.assign(process.env, {
  SESSION_SECRET: 'unit-test-session-secret-0123456789abcdef',
  NEXT_PUBLIC_SUPABASE_URL: STORAGE,
  SUPABASE_SECRET_KEY: 'qv-fake-key',
});
const R2 = {
  R2_ACCOUNT_ID: 'qvaccount',
  R2_ACCESS_KEY_ID: 'qv-r2-key',
  R2_SECRET_ACCESS_KEY: 'qv-r2-secret',
  R2_BUCKET: 'qv-videos',
};
const R2_OBJECTS = `https://${R2.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2.R2_BUCKET}/`;

// ---- fake storage: path → bytes + type; a signed URL serves Range as Supabase does ----
type Obj = { bytes: Uint8Array; type: string; size?: number };
const stored = new Map<string, Obj>();
const signs: { path: string; expiresIn: number }[] = [];
let storageDown = false; // Supabase Storage answering 500 (an outage, not a missing file)
const { BUCKET } = await import('@/server/storage');
const api = `${STORAGE}/storage/v1`;

// ---- fake R2: key → bytes + type; every call must carry a SigV4 signature (header or presigned query) ----
const r2 = new Map<string, Obj>();
const r2Calls: { method: string; key: string; signed: 'header' | 'query'; url: string }[] = [];
async function fakeR2(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const key = decodeURIComponent(url.href.slice(R2_OBJECTS.length).split('?')[0]!);
  const q = url.searchParams;
  const scope = `${R2.R2_ACCESS_KEY_ID}/\\d{8}/auto/s3/aws4_request`;
  const header = new RegExp(
    `^AWS4-HMAC-SHA256 Credential=${scope}, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$`,
  );
  const signed = header.test(req.headers.get('authorization') ?? '')
    ? 'header'
    : q.get('X-Amz-Algorithm') === 'AWS4-HMAC-SHA256' &&
        new RegExp(`^${scope}$`).test(q.get('X-Amz-Credential') ?? '') &&
        /^\d+$/.test(q.get('X-Amz-Expires') ?? '') &&
        /^[0-9a-f]{64}$/.test(q.get('X-Amz-Signature') ?? '')
      ? 'query'
      : null;
  if (!signed) return new Response('<Code>AccessDenied</Code>', { status: 403 });
  const body = req.method === 'PUT' ? new Uint8Array(await req.arrayBuffer()) : null;
  if (signed === 'query') {
    // a presigned URL: its signature recomputed from the request as it arrives (Content-Length = the bytes sent,
    // as on the wire) — another type, size or a signed header left out does not match
    const unsigned = new URL(req.url);
    unsigned.searchParams.delete('X-Amz-Signature');
    const names = q
      .get('X-Amz-SignedHeaders')!
      .split(';')
      .filter((h) => h !== 'host');
    const wire = (h: string) => (h === 'content-length' ? String(body?.length ?? 0) : (req.headers.get(h) ?? ''));
    const expected = await new AwsV4Signer({
      method: req.method,
      url: unsigned.href,
      headers: Object.fromEntries(
        names.filter((h) => h === 'content-length' || req.headers.has(h)).map((h) => [h, wire(h)]),
      ),
      accessKeyId: R2.R2_ACCESS_KEY_ID,
      secretAccessKey: R2.R2_SECRET_ACCESS_KEY,
      service: 's3',
      region: 'auto',
      datetime: q.get('X-Amz-Date')!,
      signQuery: true,
      allHeaders: true,
    }).sign();
    if (expected.url.searchParams.get('X-Amz-Signature') !== q.get('X-Amz-Signature'))
      return new Response('<Code>SignatureDoesNotMatch</Code>', { status: 403 });
  }
  r2Calls.push({ method: req.method, key, signed, url: req.url });
  if (req.method === 'PUT') {
    // a conditional write (R2 supports If-None-Match: *): never over an existing object
    if (req.headers.get('if-none-match') === '*' && r2.has(key))
      return new Response('<Code>PreconditionFailed</Code>', { status: 412 });
    r2.set(key, { bytes: body!, type: req.headers.get('content-type') ?? '' });
    return new Response(null, { headers: { etag: '"qv"' } });
  }
  if (req.method === 'DELETE') {
    r2.delete(key);
    return new Response(null, { status: 204 });
  }
  const o = r2.get(key);
  if (!o) return new Response('<Code>NoSuchKey</Code>', { status: 404 });
  const size = o.size ?? o.bytes.length;
  const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.get('range') ?? '');
  if (req.method === 'HEAD' || !range)
    return new Response(req.method === 'HEAD' ? null : o.bytes, {
      headers: { 'content-type': o.type, 'content-length': String(size), 'accept-ranges': 'bytes' },
    });
  const from = Number(range[1]);
  const to = Math.min(Number(range[2]), o.bytes.length - 1);
  return new Response(o.bytes.slice(from, to + 1), {
    status: 206,
    headers: { 'content-type': o.type, 'content-range': `bytes ${from}-${to}/${size}` },
  });
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith(R2_OBJECTS)) return fakeR2(new Request(input, init));
  const method = init?.method ?? 'GET';
  const path = (prefix: string) => decodeURIComponent(url.slice(prefix.length).split('?')[0]!);
  if (url === `${api}/bucket`) return Response.json({ name: BUCKET });
  if (method === 'POST' && url.startsWith(`${api}/object/upload/sign/${BUCKET}/`)) {
    const p = path(`${api}/object/upload/sign/${BUCKET}/`);
    return Response.json({ url: `/object/upload/sign/${BUCKET}/${p}?token=up` });
  }
  if (method === 'POST' && url.startsWith(`${api}/object/sign/${BUCKET}/`)) {
    const p = path(`${api}/object/sign/${BUCKET}/`);
    signs.push({ path: p, expiresIn: (JSON.parse(String(init?.body)) as { expiresIn: number }).expiresIn });
    if (storageDown) return Response.json({ statusCode: '500', error: 'internal', message: 'down' }, { status: 500 });
    if (!stored.has(p))
      return Response.json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, { status: 400 });
    return Response.json({ signedURL: `/object/sign/${BUCKET}/${p}?token=get` });
  }
  if (method === 'GET' && url.startsWith(`${api}/object/sign/${BUCKET}/`)) {
    const o = stored.get(path(`${api}/object/sign/${BUCKET}/`));
    if (!o) return new Response('', { status: 400 });
    const size = o.size ?? o.bytes.length;
    const end = Math.min(15, o.bytes.length - 1);
    return new Response(o.bytes.slice(0, end + 1), {
      status: 206,
      headers: { 'content-type': o.type, 'content-range': `bytes 0-${end}/${size}` },
    });
  }
  if (method === 'POST' && url.startsWith(`${api}/object/${BUCKET}/`)) {
    const p = path(`${api}/object/${BUCKET}/`);
    stored.set(p, { bytes: new Uint8Array(await new Response(init?.body).arrayBuffer()), type: 'image/jpeg' });
    return Response.json({ Key: `${BUCKET}/${p}` });
  }
  if (method === 'DELETE' && url === `${api}/object/${BUCKET}`) {
    for (const p of (JSON.parse(String(init?.body)) as { prefixes: string[] }).prefixes) stored.delete(p);
    return Response.json([]);
  }
  return new Response('', { status: 404 });
}) as typeof fetch;

const { pool } = await import('@/db/client');
const { signSession, SESSION_COOKIE } = await import('@/lib/session');
const issueRoute = await import('@/app/api/attachments/video/route');
const confirmRoute = await import('@/app/api/attachments/video/confirm/route');
const filesRoute = await import('@/app/api/files/route');
const attachmentRoute = await import('@/app/api/attachments/[id]/route');

const ADMIN = 'qv-admin@example.invalid';
const VIEWER = 'qv-viewer@example.invalid'; // Job Management view only
const ADMIN2 = 'qv-admin2@example.invalid'; // 30 uploads a minute per user: the later checks run as another admin
const SV = 3;
await pool.query(`
  INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
    SELECT 1, 'รับงานใหม่', 1, 'Open', true WHERE NOT EXISTS (SELECT 1 FROM job_status WHERE job_status_id = 1);
  DELETE FROM app_config WHERE user_type = 'QV Viewer';
  INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view)
    VALUES ('QV Viewer', 'Job Management', false, false, false, true);
  DELETE FROM app_user WHERE user_id BETWEEN 9881 AND 9883 OR email_address LIKE 'qv-%@example.invalid';
  INSERT INTO app_user (user_id, first_name, last_name, email_address, user_type, record_status, session_version) VALUES
    (9881, 'QV', 'admin', '${ADMIN}', 'System Admin', 'ACTIVE', ${SV}),
    (9882, 'QV', 'viewer', '${VIEWER}', 'QV Viewer', 'ACTIVE', ${SV}),
    (9883, 'QV', 'admin2', '${ADMIN2}', 'System Admin', 'ACTIVE', ${SV});
  DELETE FROM document_attach WHERE reference_item_code LIKE 'QV%';
  DELETE FROM job WHERE job_no IN ('QV0001', 'QV0002');
  INSERT INTO job (job_no, job_status_id, record_status) VALUES ('QV0001', 1, 'ACTIVE'), ('QV0002', 1, 'DELETED');
`);

// ---- helpers ----
async function call(
  handler: (req: NextRequest, ctx: never) => Promise<Response>,
  url: string,
  init: { body?: unknown; form?: FormData; as?: string; params?: Record<string, string> } = {},
) {
  const now = Date.now();
  const email = init.as ?? ADMIN;
  const headers: Record<string, string> = {
    cookie: `${SESSION_COOKIE}=${await signSession({ email, name: 'QV', exp: now + 600_000, iat: now, sv: SV })}`,
    'user-agent': 'qv',
    host: 'svc.example.test',
  };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const req = new NextRequest(`https://svc.example.test${url}`, {
    method: init.body === undefined && !init.form ? 'GET' : 'POST',
    headers,
    body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
  const res = await handler(req, { params: Promise.resolve(init.params ?? {}) } as never);
  return {
    status: res.status,
    location: res.headers.get('location') ?? '',
    cache: res.headers.get('cache-control') ?? '',
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}
const issue = (jobNo: string, type = 'video/mp4', as?: string, size: unknown = MP4.length) =>
  call(issueRoute.POST as never, '/api/attachments/video', { body: { jobNo, type, size }, as });
function confirm(file: string, extra: Record<string, string | Blob> = {}, as?: string) {
  const f = new FormData();
  f.set('jobNo', 'qv0001'); // upper-cased, as typed
  f.set('file', file);
  f.set('name', 'ลูกค้าถ่ายอาการ.mp4');
  f.set('remark', 'เสียงดังตอนเปิดเครื่อง');
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return call(confirmRoute.POST as never, '/api/attachments/video/confirm', { form: f, as });
}
const path = (file: string) => `jobs/QV0001/attachments/${file}`;
/** what "the browser's PUT" left in R2 */
const put = (file: string, o: Obj) => void r2.set(path(file), o);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0x42, 0xf7, 0x81, 1, 0x42, 0xf2, 0x81]);
/** an attachment row of QV0001 (what POST /api/attachments or confirm leaves) → its id */
const attach = async (file: string, recordStatus = 'ACTIVE', name = 'รูปหน้าเครื่อง.jpg') =>
  (
    await pool.query<{ id: string }>(
      `INSERT INTO document_attach (reference_topic, reference_item_code, original_file_name, system_file_name, record_status)
       VALUES ('Jobs', 'QV0001', $1, $2, $3) RETURNING id::text AS id`,
      [name, file, recordStatus],
    )
  ).rows[0]!.id;
const open = (p: string, as?: string) =>
  call(filesRoute.GET as never, `/api/files?path=${encodeURIComponent(p)}`, { as });
const rows = async (file: string) =>
  (
    await pool.query(
      `SELECT remark FROM document_attach WHERE reference_item_code = 'QV0001' AND system_file_name = $1`,
      [file],
    )
  ).rows;

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : e}`);
  }
}

console.log('\nR2 not configured: the video API answers 503, nothing else breaks');
await test('issue / confirm → 503 ยังไม่ได้ตั้งค่าที่เก็บวิดีโอ; a legacy Supabase .mp4 still opens', async () => {
  const missing = { error: 'ยังไม่ได้ตั้งค่าที่เก็บวิดีโอ — ติดต่อผู้ดูแลระบบ' };
  assert.deepEqual(await issue('QV0001').then((r) => [r.status, r.body]), [503, missing]);
  const c = await confirm(`v20261028120000${'ab'.repeat(10)}.mp4`);
  assert.deepEqual([c.status, c.body], [503, missing]);
  await attach(`v20261028120000${'ab'.repeat(10)}.mp4`, 'ACTIVE', 'คลิป.mp4');
  const v = await call(filesRoute.GET as never, `/api/files?path=${path(`v20261028120000${'ab'.repeat(10)}.mp4`)}`);
  assert.equal(v.status, 503);
  stored.set(path('legacy-clip.mp4'), { bytes: MP4, type: 'video/mp4' });
  await attach('legacy-clip.mp4', 'ACTIVE', 'คลิปเก่า.mp4');
  const legacy = await call(filesRoute.GET as never, `/api/files?path=${path('legacy-clip.mp4')}`);
  assert.equal(legacy.status, 307);
  assert.ok(legacy.location.startsWith(`${api}/object/sign/${BUCKET}/`), legacy.location);
  assert.equal(r2Calls.length, 0);
});
Object.assign(process.env, R2);

console.log('\nIssuing the upload URL: the rights and the job of POST /api/attachments');
await test('without Job Management edit → 403', async () => {
  assert.equal((await issue('QV0001', 'video/mp4', VIEWER)).status, 403);
});
await test('an unknown job → 404, a deleted one → 409; a type that is no video → 400', async () => {
  assert.deepEqual((await issue('QVNOPE')).body, { error: 'ไม่พบหมายเลขงาน QVNOPE' });
  assert.deepEqual(await issue('QV0002').then((r) => [r.status, r.body.error]), [
    409,
    'งานนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้',
  ]);
  assert.equal((await issue('QV0001', 'text/html')).status, 400);
});
await test('a path chosen by the server: jobs/{jobNo}/attachments/v{generated}.mp4 / .webm, an R2 presigned PUT that never overwrites', async () => {
  const r = await issue('qv0001');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const file = String(r.body.file);
  assert.match(file, /^v\d{14}[0-9a-f]{20}\.mp4$/);
  const url = new URL(String(r.body.url));
  assert.equal(`${url.origin}${url.pathname}`, `${R2_OBJECTS}${path(file)}`);
  assert.equal(url.searchParams.get('X-Amz-Expires'), '7200');
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host;if-none-match');
  // "the browser" (src/lib/video.ts uploadVideo): PUT to it with the type it was issued for and If-None-Match: *
  const browserPut = (body: Uint8Array, headers = { 'Content-Type': 'video/mp4', 'If-None-Match': '*' }) =>
    fetch(url, { method: 'PUT', headers, body });
  assert.equal(
    (await browserPut(MP4, { 'Content-Type': 'video/mp4' } as never)).status,
    403,
    'the condition is signed',
  );
  assert.equal((await browserPut(new Uint8Array([...MP4, 0]))).status, 403, 'the size is signed: one byte more');
  assert.equal((await browserPut(MP4, { 'Content-Type': 'video/webm', 'If-None-Match': '*' })).status, 403);
  assert.equal(r2.has(path(file)), false);
  assert.equal((await browserPut(MP4)).status, 200);
  assert.deepEqual(r2.get(path(file)), { bytes: MP4, type: 'video/mp4' });
  // the same URL again (within its 2 h) cannot overwrite what is there — not even after confirm checked it
  assert.equal((await browserPut(MP4)).status, 412);
  assert.deepEqual(r2.get(path(file)), { bytes: MP4, type: 'video/mp4' });
  assert.equal(stored.has(path(file)), false, 'nothing in Supabase');
  r2.delete(path(file));
  assert.match(String((await issue('QV0001', 'video/webm')).body.file), /^v.*\.webm$/);
});

await test('the size is asked first: over 200 MB → 413, none / not a whole number → 400, no URL', async () => {
  const over = await issue('QV0001', 'video/mp4', ADMIN2, 200 * 1024 * 1024 + 1);
  assert.deepEqual([over.status, over.body], [413, { error: 'วิดีโอใหญ่เกิน 200MB' }]);
  assert.equal((await issue('QV0001', 'video/mp4', ADMIN2, 200 * 1024 * 1024)).status, 200);
  for (const size of [null, 0, 1.5, '19'])
    assert.deepEqual(await issue('QV0001', 'video/mp4', ADMIN2, size).then((r) => [r.status, r.body]), [
      400,
      { error: 'ไม่ทราบขนาดไฟล์วิดีโอ' },
    ]);
});

console.log('\nConfirm: what arrived is checked before the row goes in');
const fresh = async (type = 'video/mp4', as?: string) => String((await issue('QV0001', type, as)).body.file);
await test('without Job Management edit → 403, the upload stays for its owner', async () => {
  const file = await fresh();
  put(file, { bytes: MP4, type: 'video/mp4' });
  assert.equal((await confirm(file, {}, VIEWER)).status, 403);
  assert.ok(r2.has(path(file)));
});
await test('nothing uploaded → 404, no row', async () => {
  const file = await fresh();
  const r = await confirm(file);
  assert.deepEqual([r.status, r.body.error], [404, 'ไม่พบไฟล์วิดีโอที่อัปโหลด — แนบใหม่อีกครั้ง']);
  assert.equal((await rows(file)).length, 0);
});
await test('a PDF sent as video/mp4, or ftyp bytes stored as text/html → 415, removed, no row', async () => {
  for (const o of [
    { bytes: new TextEncoder().encode('%PDF-1.7\n%âãÏÓ\n1 0'), type: 'video/mp4' },
    { bytes: MP4, type: 'text/html' },
    { bytes: WEBM, type: 'video/mp4' }, // a WebM under an .mp4 name
  ]) {
    const file = await fresh();
    put(file, o);
    const r = await confirm(file);
    assert.deepEqual([r.status, r.body.error], [415, 'ไฟล์ที่อัปโหลดไม่ใช่วิดีโอ MP4 / MOV / WebM จริง']);
    assert.equal(r2.has(path(file)), false);
    assert.ok(r2Calls.some((c) => c.method === 'DELETE' && c.key === path(file) && c.signed === 'header'));
    assert.equal((await rows(file)).length, 0);
  }
});
await test('over 200 MB (Content-Range) → 413, removed — the check read 16 bytes, not the file', async () => {
  const file = await fresh();
  put(file, { bytes: MP4, type: 'video/mp4', size: 200 * 1024 * 1024 + 1 });
  const r = await confirm(file);
  assert.deepEqual([r.status, r.body.error], [413, 'วิดีโอใหญ่เกิน 200MB']);
  assert.equal(r2.has(path(file)), false);
});
await test('a thumbnail that is no JPEG → 415, the video removed too', async () => {
  const file = await fresh();
  put(file, { bytes: MP4, type: 'video/mp4' });
  const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 't.jpg', {
    type: 'image/png',
  });
  const r = await confirm(file, { thumb: png });
  assert.equal(r.status, 415, JSON.stringify(r.body));
  assert.equal(r2.has(path(file)), false);
});
await test('a thumbnail over 1 MB sent without content-length (chunked) → 413, the video removed — never stored', async () => {
  const file = await fresh('video/mp4', ADMIN2);
  put(file, { bytes: MP4, type: 'video/mp4' });
  const big = new Uint8Array(1024 * 1024 + 1);
  big.set([0xff, 0xd8, 0xff]);
  const r = await confirm(file, { thumb: new File([big], 'thumb.jpg', { type: 'image/jpeg' }) }, ADMIN2);
  assert.deepEqual([r.status, r.body], [413, { error: 'ภาพตัวอย่างใหญ่เกิน 1MB' }]);
  assert.equal(r2.has(`${path(file)}.jpg`), false);
  assert.equal((await rows(file)).length, 0);
});
await test('a remark is kept to its column: 100 characters', async () => {
  const file = await fresh('video/mp4', ADMIN2);
  put(file, { bytes: MP4, type: 'video/mp4' });
  const r = await confirm(file, { remark: 'ก'.repeat(150) }, ADMIN2);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(await rows(file), [{ remark: 'ก'.repeat(100) }]);
});
await test('a real MP4 + JPEG thumbnail → attached (row, thumbnail beside it); confirming it again → 409, kept', async () => {
  const file = await fresh();
  put(file, { bytes: MP4, type: 'video/mp4', size: 90 * 1024 * 1024 });
  const jpeg = await sharp({ create: { width: 32, height: 18, channels: 3, background: '#336699' } })
    .jpeg()
    .toBuffer();
  r2Calls.length = 0;
  const r = await confirm(file, { thumb: new File([new Uint8Array(jpeg)], 'thumb.jpg', { type: 'image/jpeg' }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, {
    ok: true,
    row: { id: (r.body.row as { id: number }).id, name: 'ลูกค้าถ่ายอาการ.mp4', file, remark: 'เสียงดังตอนเปิดเครื่อง' },
  });
  assert.deepEqual(await rows(file), [{ remark: 'เสียงดังตอนเปิดเครื่อง' }]);
  // checked in R2 by one signed ranged GET; the thumbnail stored beside it, in R2 too
  assert.deepEqual(
    r2Calls.map((c) => [c.method, c.key, c.signed]),
    [
      ['GET', path(file), 'header'],
      ['PUT', `${path(file)}.jpg`, 'header'],
    ],
  );
  assert.equal(r2.get(`${path(file)}.jpg`)?.type, 'image/jpeg');
  assert.equal(
    [...stored.keys()].some((k) => k.startsWith(path(file))),
    false,
    'nothing in Supabase',
  );
  const again = await confirm(file);
  assert.deepEqual([again.status, again.body.error], [409, 'แนบวิดีโอนี้ไว้แล้ว']);
  assert.ok(r2.has(path(file)), 'an attached video is never removed by a refused confirm');
});
await test('a WebM (an original the browser could not convert) without a thumbnail → attached', async () => {
  const file = await fresh('video/webm');
  put(file, { bytes: WEBM, type: 'video/webm' });
  const r = await confirm(file);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await rows(file)).length, 1);
});
await test('a file name the server did not issue (another folder, another type) → 400', async () => {
  // (a name without the leading v is a legacy one — never issued now)
  for (const file of [
    '../slip/x.mp4',
    'v20261028120000abcdef0123456789abcd.pdf',
    '20261028120000abcdef0123456789abcd.mp4',
  ])
    assert.deepEqual((await confirm(file)).body, { error: 'ไม่พบไฟล์วิดีโอที่อัปโหลด' });
});

console.log('\nPlaying it: /api/files');
await test('an R2 video: a presigned GET for 15 minutes (download=1 → attachment), its thumbnail a day', async () => {
  const file = [...r2.keys()].find((p) => r2.has(`${p}.jpg`))!; // the attached one
  const play = await call(filesRoute.GET as never, `/api/files?path=${encodeURIComponent(file)}`);
  const down = await call(filesRoute.GET as never, `/api/files?path=${encodeURIComponent(file)}&download=1`);
  const thumb = await call(filesRoute.GET as never, `/api/files?path=${encodeURIComponent(file + '.jpg')}`);
  assert.deepEqual([play.status, down.status, thumb.status], [307, 307, 307]);
  const [p, d, t] = [play, down, thumb].map((r) => new URL(r.location));
  assert.equal(`${p!.origin}${p!.pathname}`, `${R2_OBJECTS}${file}`);
  assert.equal(`${t!.origin}${t!.pathname}`, `${R2_OBJECTS}${file}.jpg`);
  assert.deepEqual(
    [p, d, t].map((u) => u!.searchParams.get('X-Amz-Expires')),
    ['900', '900', '86400'],
  );
  // the thumbnail is a picture: the same URL again (the browser keeps it), the video a fresh one each time
  const again = await call(filesRoute.GET as never, `/api/files?path=${encodeURIComponent(file + '.jpg')}`);
  assert.equal(again.location, thumb.location);
  assert.match(thumb.cache, /^private, max-age=8\d{4}$/);
  assert.equal(play.cache, 'private, max-age=840');
  // saved under the attached name, not v2026….mp4
  assert.equal(
    d!.searchParams.get('response-content-disposition'),
    `attachment; filename*=UTF-8''${encodeURIComponent('ลูกค้าถ่ายอาการ.mp4')}`,
  );
  assert.equal(p!.searchParams.has('response-content-disposition'), false);
  // the presigned URL opens it (a ranged read, as a <video> does)
  const res = await fetch(play.location, { headers: { Range: 'bytes=0-7' } });
  assert.deepEqual([res.status, res.headers.get('content-range')], [206, `bytes 0-7/${90 * 1024 * 1024}`]);
  assert.equal(
    (await call(filesRoute.GET as never, `/api/files?path=${encodeURIComponent(file)}`, { as: VIEWER })).status,
    307,
  );
});
await test('a legacy .mp4 (and an older name without the v) still opens from Supabase, 15 minutes', async () => {
  await attach('20261001090000abcdef0123456789abcd.mp4', 'ACTIVE', 'a&b #1.mp4');
  for (const [legacy, name] of [
    ['legacy-clip.mp4', 'คลิปเก่า.mp4'],
    ['20261001090000abcdef0123456789abcd.mp4', 'a&b #1.mp4'],
  ] as const) {
    stored.set(path(legacy), { bytes: MP4, type: 'video/mp4' });
    signs.length = 0;
    const r = await call(filesRoute.GET as never, `/api/files?path=${encodeURIComponent(path(legacy))}&download=1`);
    assert.equal(r.status, 307);
    assert.ok(r.location.startsWith(`${api}/object/sign/${BUCKET}/${path(legacy)}`), r.location);
    assert.equal(new URL(r.location).searchParams.get('download'), name); // its attached name, & and # intact
    assert.deepEqual(signs, [{ path: path(legacy), expiresIn: 900 }]);
  }
});

await test('a picture is signed once a day and kept by the browser; a slip / PDF signs anew, 2 minutes', async () => {
  const twice = async (p: string) => {
    stored.set(p, { bytes: MP4, type: 'image/jpeg' });
    signs.length = 0;
    const a = await call(filesRoute.GET as never, `/api/files?path=${encodeURIComponent(p)}`);
    const b = await call(filesRoute.GET as never, `/api/files?path=${encodeURIComponent(p)}`);
    assert.deepEqual([a.status, b.status], [307, 307]);
    assert.equal(a.location, b.location);
    return { signs: signs.map((x) => x.expiresIn), cache: b.cache };
  };
  await attach('20261029100000abcdef0123456789abcd.webp');
  await attach('a.pdf', 'ACTIVE', 'ใบเสนอราคา.pdf');
  const photo = await twice(path('20261029100000abcdef0123456789abcd.webp'));
  assert.deepEqual(photo.signs, [86400]); // signed once, the second answered from the cache
  assert.match(photo.cache, /^private, max-age=8\d{4}$/);
  const logo = await twice('profiles/1/20261029100000abcdef0123456789abcd.png');
  assert.deepEqual([logo.signs, logo.cache.startsWith('public, max-age=8')], [[86400], true]);
  for (const p of ['jobs/QV0001/slip/20261029100000abcdef0123456789abcd.jpg', path('a.pdf')])
    assert.deepEqual(await twice(p), { signs: [120, 120], cache: 'private, max-age=60' });
});

console.log('\nOpening an attachment: only while its row is there, one answer for both routes');
await test('a removed attachment (soft delete), its video thumbnail, a file never attached → 404 — even when cached', async () => {
  const pic = '20261029110000abcdef0123456789abcd.jpg';
  stored.set(path(pic), { bytes: MP4, type: 'image/jpeg' });
  const id = await attach(pic);
  assert.equal((await open(path(pic))).status, 307); // now in the picture cache
  await pool.query(`UPDATE document_attach SET record_status = 'DELETED' WHERE id = $1`, [id]);
  assert.deepEqual(await open(path(pic)).then((r) => [r.status, r.body]), [404, { error: 'ไม่พบไฟล์' }]);
  // a video's thumbnail follows the video's row
  const clip = [...r2.keys()].find((p) => r2.has(`${p}.jpg`))!;
  assert.equal((await open(`${clip}.jpg`)).status, 307);
  await pool.query(`UPDATE document_attach SET record_status = 'DELETED' WHERE system_file_name = $1`, [
    clip.split('/').pop(),
  ]);
  assert.equal((await open(`${clip}.jpg`)).status, 404);
  assert.equal((await open(clip)).status, 404);
  stored.set(path('never-attached.png'), { bytes: MP4, type: 'image/png' });
  assert.equal((await open(path('never-attached.png'))).status, 404);
  assert.equal((await open('jobs/QV0002/attachments/legacy-clip.mp4')).status, 404, 'another job’s folder');
  // a legacy row holding the full path opens too
  stored.set(path('full-path.pdf'), { bytes: MP4, type: 'application/pdf' });
  await attach(path('full-path.pdf'));
  assert.equal((await open(path('full-path.pdf'))).status, 307);
});
await test('a picture from the list (/api/attachments/{id}) gets the same day-long URL and cache as /api/files', async () => {
  const pic = '20261029120000abcdef0123456789abcd.png';
  stored.set(path(pic), { bytes: MP4, type: 'image/png' });
  const id = await attach(pic);
  signs.length = 0;
  const viaId = await call(attachmentRoute.GET as never, `/api/attachments/${id}`, { params: { id } });
  const viaPath = await open(path(pic));
  assert.deepEqual([viaId.status, viaPath.status], [307, 307]);
  assert.equal(viaId.location, viaPath.location);
  assert.match(viaId.cache, /^private, max-age=8\d{4}$/);
  assert.deepEqual(signs, [{ path: path(pic), expiresIn: 86400 }]); // signed once for both
  // download=2 is no download: the same cached URL, nothing signed again
  const two = await call(filesRoute.GET as never, `/api/files?path=${encodeURIComponent(path(pic))}&download=2`);
  assert.equal(two.location, viaPath.location);
  assert.equal(signs.length, 1);
  // a PDF from the list: 2 minutes, as before
  const pdf = await attach('a.pdf');
  const p = await call(attachmentRoute.GET as never, `/api/attachments/${pdf}`, { params: { id: pdf } });
  assert.deepEqual([p.status, p.cache], [307, 'private, max-age=60']);
});
await test('a legacy row without a file name → 404 (it would sign the job folder)', async () => {
  for (const file of ['', ' ']) {
    stored.set(path(file), { bytes: MP4, type: 'application/octet-stream' }); // signable, were it asked
    const id = await attach(file, 'ACTIVE', '');
    const r = await call(attachmentRoute.GET as never, `/api/attachments/${id}`, { params: { id } });
    assert.equal(r.status, 404);
  }
});
await test('storage failing is not a missing file: 503 ระบบจัดเก็บไฟล์ขัดข้อง; a missing file stays 404', async () => {
  stored.set(path('outage.pdf'), { bytes: MP4, type: 'application/pdf' });
  const id = await attach('outage.pdf');
  storageDown = true;
  try {
    const r = await open(path('outage.pdf'));
    assert.deepEqual([r.status, r.body.error], [503, 'ระบบจัดเก็บไฟล์ขัดข้อง ลองใหม่ภายหลัง']);
    const viaId = await call(attachmentRoute.GET as never, `/api/attachments/${id}`, { params: { id } });
    assert.equal(viaId.status, 503);
  } finally {
    storageDown = false;
  }
  await attach('gone.pdf');
  assert.deepEqual(await open(path('gone.pdf')).then((r) => [r.status, r.body.error]), [
    404,
    'ไม่พบไฟล์ (อาจอยู่บนระบบเก่า)',
  ]);
});
await test('src/lib/video.ts: m:ss of a too-long clip, a file that cannot be read, a PUT that never reached storage', async () => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', import.meta.filename, 'client'], {
    env: { ...process.env, NODE_OPTIONS: '' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

await pool.end();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
