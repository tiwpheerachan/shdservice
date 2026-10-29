/**
 * npm run test:api (scripts/test-api.mts) — every operation of src/server/contract called once the way
 * the pages call it, against the local test DB, and every answer held to its declaration.
 *
 * The bodies are checked by the contract itself: API_CONTRACT_STRICT=1 makes checked()
 * (src/server/auth.ts) throw on any response that does not parse with its declared schema, carries a
 * field the schema does not name, or has a status it does not declare. The last test fails for any
 * operation nobody here called.
 *
 * Runs after test:domain (npm run test:db) and uses its fixtures: the System Admin td-admin (9101),
 * jobs TDJ*, customer TDC001, parts TDP*. ONLY against the throwaway local test database.
 */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { NextRequest } from 'next/server';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
Object.assign(process.env, {
  API_CONTRACT_STRICT: '1',
  SESSION_SECRET: 'unit-test-session-secret-0123456789abcdef',
  TRACK_LOG_SECRET: 'unit-test-log-secret',
  TURNSTILE_SECRET_KEY: 'unit-test-secret',
  APP_BASE_URL: 'https://svc.example.test',
  SMS_PROVIDER: 'log',
});
// Siteverify: token "good" passes for our host; everything else outside is refused, never fetched
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  const ok = url.includes('challenges.cloudflare.com');
  return new Response(JSON.stringify(ok ? { success: true, hostname: 'svc.example.test', action: 'track' } : {}), {
    status: ok ? 200 : 503,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

const { pool } = await import('@/db/client');
const { signSession, SESSION_COOKIE } = await import('@/lib/session');
const { checked } = await import('@/server/contract/check');
const { registry } = await import('@/server/contract');
const { today } = await import('@/lib/dates');

const ADMIN = { email: 'td-admin@example.invalid' };
const MANAGER = { email: 'td-manager@example.invalid' }; // approves sale orders (SO Approve)
const VIEWER = { email: 'td-viewer@example.invalid' }; // Customer view only
const SELLER2 = { email: 'td-seller2@example.invalid' }; // signs out at the end (bumps its session_version)
const SV = 3; // test-domain's fixture session_version
const rand = Math.random().toString(36).slice(2, 7).toUpperCase();

/* ---- routes on disk: a request path → its route.ts and params ---- */
const ROOT = join(process.cwd(), 'src/app/api');
function routeFiles(dir = ROOT, prefix = ''): { dir: string; template: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.name === 'route.ts'
      ? [{ dir: prefix, template: prefix }]
      : e.isDirectory()
        ? routeFiles(join(dir, e.name), `${prefix}/${e.name}`)
        : [],
  );
}
const ROUTES = routeFiles()
  .map((r) => ({
    ...r,
    names: [...r.template.matchAll(/\[(\w+)\]/g)].map((m) => m[1]!),
    pattern: new RegExp(`^/api${r.template.replace(/\./g, '\\.').replace(/\[\w+\]/g, '([^/]+)')}$`),
  }))
  .sort((a, b) => a.names.length - b.names.length);

type Who = { email: string } | null;
type Init = { method?: string; body?: unknown; form?: FormData; headers?: Record<string, string>; as?: Who };

async function call(url: string, init: Init = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const method = init.method ?? 'GET';
  const pathname = new URL(url, 'https://svc.example.test').pathname;
  const route = ROUTES.find((r) => r.pattern.test(pathname));
  assert.ok(route, `no route for ${pathname}`);
  const values = route.pattern.exec(pathname)!.slice(1);
  const params = Object.fromEntries(route.names.map((name, i) => [name, decodeURIComponent(values[i]!)]));
  const mod = (await import(`@/app/api${route.dir}/route`)) as Record<string, unknown>;
  const handler = mod[method] as (req: NextRequest, ctx: unknown) => Promise<Response>;
  assert.ok(handler, `${method} ${route.dir} is not exported`);

  const headers: Record<string, string> = { 'user-agent': 'test-api', host: 'svc.example.test', ...init.headers };
  const who = init.as === undefined ? ADMIN : init.as;
  if (who) {
    const now = Date.now();
    headers.cookie = `${SESSION_COOKIE}=${await signSession({ email: who.email, name: who.email, exp: now + 600_000, iat: now, sv: SV })}`;
  }
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const req = new NextRequest(`https://svc.example.test${url}`, {
    method,
    headers,
    body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
  const res = await handler(req, { params: Promise.resolve(params) });
  const type = res.headers.get('content-type') ?? '';
  const body = type.includes('json') ? ((await res.json()) as Record<string, unknown>) : {};
  return { status: res.status, body };
}

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message.replace(/\n/g, '\n      ') : e}`);
  }
}
/** call and expect one of `statuses` */
const expect = (statuses: number[], url: string, init?: Init) =>
  test(`${init?.method ?? 'GET'} ${url} → ${statuses.join(' / ')}`, async () => {
    const r = await call(url, init);
    assert.ok(statuses.includes(r.status), `got ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  });

// the /track limits count per IP across runs — start from none (throwaway DB)
await pool.query('DELETE FROM track_rate; DELETE FROM track_block');
try {
  console.log('\nData — every resource (and its page)');
  const PAGED = [
    'audit_log',
    'models',
    'products',
    'customers',
    'issued_lines',
    'movements',
    'jobs',
    'quotations',
    'sale_orders',
  ];
  for (const path of Object.keys((await import('@/server/contract/openapi')).openapi.paths)) {
    if (!path.startsWith('/data/')) continue;
    const name = path.slice('/data/'.length);
    await expect([200], `/api/data/${name}`);
    if (PAGED.includes(name)) await expect([200], `/api/data/${name}?paged=1&pageSize=5`);
  }
  await expect([200], '/api/data/products?fields=lite&q=TDP');
  await expect([200], '/api/data/quotations?paged=1&no=TDQ&customer=ทดสอบ&customerCode=TDC&imei=35');
  await expect([200], '/api/data/job_nos?mode=pending_parts');
  await expect([200], '/api/data/staff?usedAs=engineer');
  await expect([401], '/api/data/jobs', { as: null });

  console.log('\nLookups, alerts, files, docs');
  await expect([200], '/api/address');
  // a province / district by its uuid (ADR 0008)
  const place = (
    await pool.query<{ c: string; d: string }>(
      `SELECT c.id::text AS c, d.id::text AS d FROM mt_district d JOIN mt_city c USING (city_id) ORDER BY d.district_id LIMIT 1`,
    )
  ).rows[0];
  await test('GET /api/address by uuid → the districts / sub-districts; an old int id → no rows', async () => {
    const rows = async (q: string) => ((await call(`/api/address?${q}`)).body.rows as unknown[]).length;
    if (place) assert.ok((await rows(`level=district&city=${place.c}`)) > 0, 'districts of the province');
    assert.equal(await rows('level=district&city=1'), 0);
  });
  await expect([200], `/api/address?level=subdistrict&district=${place?.d ?? ''}`);
  // "+ เพิ่มชื่อ" แขวง / ตำบล — its rules: scripts/test-qa-parity-d.mts
  await expect([400], '/api/address', { method: 'POST', body: { district: 0, name: '', postal: '' } });
  await expect([200], '/api/alerts/overdue');
  await expect([200], '/api/alerts/sale-orders-pending');
  await expect([200], '/api/customers/lookup?q=TDC001');
  await expect([200], '/api/customers/lookup?q=ทดสอบ');
  // a part by its uuid (ADR 0008); its code — an old link — or an unknown uuid is 404, no redirect
  const uuidOf = async (sqlText: string) => (await pool.query<{ id: string }>(sqlText)).rows[0]!.id;
  const tdp1 = await uuidOf(`SELECT id::text AS id FROM product WHERE product_code = 'TDP1'`);
  await expect([200], `/api/products/${tdp1}`);
  await expect([404], '/api/products/TDP1');
  await expect([404], '/api/products/00000000-0000-7000-8000-000000000000');
  await expect([404], '/api/products/NOPE-' + rand);
  // staff filters take a user's uuid (a name still works where the page types one)
  const tdAdmin = await uuidOf(`SELECT id::text AS id FROM app_user WHERE user_id = 9101`);
  await expect([200], `/api/data/audit_log?paged=1&user=${tdAdmin}`);
  await expect([200], `/api/data/products?paged=1&creator=${tdAdmin}`);
  await expect([200], `/api/data/report_rows?report=sale_order&createdBy=${tdAdmin}`);
  await expect([200], '/api/export/customers');
  // an attachment / a job by its uuid (ADR 0008): an old int id / job number → 404, no redirect
  await expect([404], '/api/attachments/999999999');
  await expect([404], '/api/attachments/00000000-0000-7000-8000-000000000000', { method: 'DELETE' });
  await expect([400], '/api/files');
  await expect([404, 503], '/api/files?path=products/TDP1/x.jpg');
  await expect([200], '/api/openapi.json');
  await expect([200], '/api/health', { as: null });
  await expect([200], '/api/health');
  await expect([500], '/api/directory/search?q=td'); // no CENTRAL_API_KEY here

  console.log('\nUploads');
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  await expect([400], '/api/upload', { method: 'POST', form: form({ kind: 'product-image', id: 'TDP1' }) });
  await expect([400], '/api/attachments', { method: 'POST', form: form({ jobNo: 'TDJ0004' }) });
  // video attachments: the storage side (signed upload, the checks of what arrived) is scripts/test-qa-video.mts
  await expect([404], '/api/attachments/video', {
    method: 'POST',
    body: { jobNo: 'NOPE' + rand, type: 'video/mp4', size: 1024 },
  });
  await expect([404], '/api/attachments/video/confirm', {
    method: 'POST',
    form: form({ jobNo: 'NOPE' + rand, file: 'v20261028120000abcdef0123456789abcd.mp4' }),
  });
  await expect([404, 503], '/api/files?path=jobs/TDJ0004/attachments/x.mp4&download=1');
  await test('POST /api/attachments to a deleted job → 409, nothing stored', async () => {
    await pool.query(`DELETE FROM job WHERE job_no = 'TDJDEL';
      INSERT INTO job (job_no, job_status_id, record_status) VALUES ('TDJDEL', 1, 'DELETED')`);
    const f = form({ jobNo: 'TDJDEL' });
    f.set(
      'file',
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], 'x.pdf', { type: 'application/pdf' }),
    );
    const r = await call('/api/attachments', { method: 'POST', form: f });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.deepEqual(r.body, { error: 'งานนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้' });
    const { rows } = await pool.query(`SELECT 1 FROM document_attach WHERE reference_item_code = 'TDJDEL'`);
    assert.equal(rows.length, 0);
  });
  await test('POST /api/attachments with a 10000×10000 PNG → 413 (photos go through optimizeImage)', async () => {
    // a PNG header declaring 100 M pixels: optimizeImage refuses it before decoding — the route maps that
    const chunk = (type: string, data: Buffer) => {
      const body = Buffer.concat([Buffer.from(type), data]);
      const head = Buffer.alloc(4);
      head.writeUInt32BE(data.length);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(body));
      return Buffer.concat([head, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(10_000, 0);
    ihdr.writeUInt32BE(10_000, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // RGB
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.alloc(64))),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    const f = form({ jobNo: 'TDJ0004' });
    f.set('file', new File([new Uint8Array(png)], 'x.png', { type: 'image/png' }));
    const r = await call('/api/attachments', { method: 'POST', form: f });
    assert.equal(r.status, 413, JSON.stringify(r.body));
    assert.deepEqual(r.body, { error: 'รูปมีความละเอียดสูงเกินไป (เกิน 40 ล้านพิกเซล)' });
  });

  console.log('\nJobs');
  const tdj4 = await uuidOf(`SELECT id::text AS id FROM job WHERE job_no = 'TDJ0004'`);
  const J4 = `/api/jobs/${tdj4}`;
  await expect([200], J4);
  await expect([404], '/api/jobs/TDJ0004'); // its number: an old link
  await expect([404], '/api/jobs/00000000-0000-7000-8000-000000000000');
  await expect([404], '/api/jobs/J%25zz'); // a literal % (Next hands the segment over decoded once): no URIError
  await expect([404], '/api/jobs/TDJ0004/calls');
  await expect([200], `${J4}/calls`);
  await expect([200], `${J4}/calls`, { method: 'POST', body: { detail: 'โทรแจ้งลูกค้าแล้ว (test-api)' } });
  await expect([400], `${J4}/calls`, { method: 'POST', body: { detail: '' } });
  await expect([200], '/api/jobs/assign', {
    method: 'POST',
    body: {
      jobNos: ['TDJ0004'],
      engineerId: await uuidOf(`SELECT id::text AS id FROM app_user WHERE user_id = 9110`),
      takeOver: true,
    },
  });
  await expect([400], '/api/jobs', { method: 'POST', body: {} });
  await expect([200, 400, 409], J4, { method: 'PATCH', body: { version: -1 } });
  await expect([415], `${J4}/close`, { method: 'POST', headers: { 'content-type': 'text/plain' } });
  await expect([400], `${J4}/close`, { method: 'POST', body: {} });
  await expect([400], `${J4}/outsource`, { method: 'POST', body: {} });
  await expect([400], `${J4}/repair`, { method: 'POST', body: {} });
  await expect([400], `${J4}/swap-refund`, { method: 'POST', body: {} });
  await test("POST /api/jobs/TDJ0004/swap-refund → 400: a status off the Swap list (19 = Refund's); no New Serial asked", async () => {
    const { n } = (
      await pool.query<{ n: string }>('SELECT job_status_name AS n FROM job_status WHERE job_status_id = 19')
    ).rows[0]!;
    const r = await call(`${J4}/swap-refund`, { method: 'POST', body: { status: n } });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.deepEqual(Object.keys((r.body.details as { fields: object }).fields), ['status']);
  });
  await test('POST /api/jobs/TDJ0004/close → 400: Serial เครื่องใหม่ checked when typed (newSerial)', async () => {
    const body = { status: 'x', newSerial: 'SN ใหม่', return: { type: 'ลูกค้ามารับเอง', date: '2026-10-28' } };
    const r = await call(`${J4}/close`, { method: 'POST', body });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.ok((r.body.details as { fields: Record<string, string> }).fields.newSerial);
  });
  await expect([200], `${J4}/track-link`);
  let linkToken = '';
  await test('POST /api/jobs/TDJ0004/track-link → 200 (a new link)', async () => {
    const r = await call(`${J4}/track-link`, { method: 'POST' });
    assert.equal(r.status, 200);
    linkToken = String(r.body.url).split('/track/')[1] ?? '';
    assert.ok(linkToken);
  });
  await test('GET /api/jobs/checks → 200: a Serial already on another job is named (the job edited left out)', async () => {
    await pool.query(`UPDATE job SET product_serial = 'TDCHK0001SERIAL' WHERE job_no = 'TDJ0004'`);
    const other = await call('/api/jobs/checks?serial=tdchk0001serial&so=&brand=&shop=&customer=&job=TDJXXXX');
    assert.equal(other.status, 200, JSON.stringify(other.body));
    const serial = other.body.serial as { jobs: { no: string }[]; looksLike: string | null; unusual: boolean };
    assert.deepEqual(
      serial.jobs.map((j) => j.no),
      ['TDJ0004'],
    );
    const self = await call('/api/jobs/checks?serial=TDCHK0001SERIAL&job=TDJ0004');
    assert.deepEqual((self.body.serial as { jobs: unknown[] }).jobs, [], 'the job being edited is not "another job"');
  });
  await test('GET /api/jobs/suggestions → 200: shop names typed before; an unknown field answers none', async () => {
    const r = await call('/api/jobs/suggestions?field=shop&q=a');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(Array.isArray(r.body.values));
    const other = await call('/api/jobs/suggestions?field=nope&q=a');
    assert.deepEqual([other.status, other.body.values], [200, []]);
  });
  await test('POST /api/me/tour → 200: a page answered, then never ask again (kept per account)', async () => {
    assert.equal((await call('/api/me/tour', { method: 'POST', body: { seen: '/jobs/new' } })).status, 200);
    assert.equal((await call('/api/me/tour', { method: 'POST', body: { seen: '/jobs/new' } })).status, 200);
    assert.equal((await call('/api/me/tour', { method: 'POST', body: { off: true } })).status, 200);
    const { rows } = await pool.query(
      `SELECT t.seen, t.off FROM app_user_tour t JOIN app_user u USING (user_id) WHERE lower(u.email_address) = lower($1)`,
      [ADMIN.email],
    );
    assert.deepEqual(rows, [{ seen: ['/jobs/new'], off: true }], 'the path once, off kept');
  });

  console.log('\nCustomers, quotations, sale orders');
  let customerId = '';
  await test('POST /api/customers → 201 (create)', async () => {
    const r = await call('/api/customers', {
      method: 'POST',
      body: { name: `ลูกค้า API ${rand}`, phone: `08${String(Date.now()).slice(-8)}`, type: 'Normal' },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    customerId = String((r.body.row as { id: string }).id);
  });
  // deleted customers (PDPA) are System Admin's alone: anyone else asking for them gets the live list, no 400
  await pool.query(`DELETE FROM customer WHERE customer_code = 'TDCDEL';
    INSERT INTO customer (customer_id, customer_code, customer_name, phone_number, record_status)
      VALUES (9601, 'TDCDEL', 'TD ลูกค้าที่ลบแล้ว', '02-000-0001', 'DELETED')`);
  for (const [who, sees] of [
    [VIEWER, false],
    [ADMIN, true],
  ] as const)
    for (const url of ['/api/data/customers?deleted=only&q=TDCDEL', '/api/data/customers?paged=1&deleted=all&q=TDCDEL'])
      await test(`GET ${url} as ${who.email} → ${sees ? 'the' : 'no'} deleted customer`, async () => {
        const r = await call(url, { as: who });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const body = r.body as unknown;
        const rows = (Array.isArray(body) ? body : (body as { rows: unknown[] }).rows) as { code: string }[];
        assert.equal(
          rows.some((c) => c.code === 'TDCDEL'),
          sees,
        );
      });
  await expect([200, 409], '/api/customers', {
    method: 'POST',
    body: { code: 'TDC001', name: 'ลูกค้า ทดสอบโดเมน', phone: '02-000-0000', version: -1 },
  });
  let quotationId = '';
  await test('POST /api/quotations → 201 (create)', async () => {
    const r = await call('/api/quotations', {
      method: 'POST',
      body: {
        customerCode: 'TDC001',
        jobNo: 'J9900005',
        lines: [
          {
            itemType: 'Service',
            code: '',
            detail: 'ค่าบริการ',
            qty: 1,
            unit: 'ครั้ง',
            unitPrice: 100,
            discount: 0,
            discountPercent: 0,
          },
        ],
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    quotationId = String((r.body.quotation as { id?: string } | undefined)?.id ?? '');
  });
  // a quotation / sale order by its uuid (ADR 0008); its number — an old link — or an unknown uuid is 404
  if (quotationId) await expect([200], `/api/quotations/${quotationId}`);
  await expect([404], '/api/quotations/NOPE' + rand);
  await expect([404], '/api/quotations/00000000-0000-7000-8000-000000000000');
  const salesId = await uuidOf(`SELECT id::text AS id FROM app_user WHERE user_id = 9107`);
  const shdId = await uuidOf(`SELECT id::text AS id FROM document_profile WHERE code = 'SHD'`);
  let soNo = '';
  let soId = '';
  await test('POST /api/sale-orders → 201 (create, sent for approval)', async () => {
    const r = await call('/api/sale-orders', {
      method: 'POST',
      body: { customerCode: 'TDC001', salesId, lines: [{ code: 'TDP1', qty: 1, price: 100 }], submit: true },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ({ no: soNo, id: soId } = r.body.order as { no: string; id: string });
  });
  await expect([200], `/api/sale-orders/${soId}`);
  await expect([404], `/api/sale-orders/${soNo}`);
  await expect([404], '/api/sale-orders/SO0' + rand);
  // ออกเอกสารในนาม: open while waiting, fixed once approved (src/lib/profile-lock.ts)
  await expect([200], '/api/documents/profile', {
    method: 'POST',
    body: { kind: 'sale_order', no: soNo, profileId: shdId },
  });
  await expect([200], `/api/sale-orders/${soId}/approve`, {
    method: 'POST',
    body: { decision: 'approve' },
    as: MANAGER,
  });
  await expect([200], `/api/sale-orders/${soId}/tracking`, { method: 'POST', body: { tracking: 'TH0123456789' } });
  await expect([409], '/api/documents/profile', {
    method: 'POST',
    body: { kind: 'sale_order', no: soNo, profileId: shdId },
  });
  await expect([400], '/api/documents/profile', { method: 'POST', body: { kind: 'nope' } });

  console.log('\nStock and products');
  await test('POST /api/products → 200 (create)', async () => {
    const r = await call('/api/products', { method: 'POST', body: { name: `อะไหล่ API ${rand}` } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
  let whi = '';
  await test('POST /api/stock/receive → 201', async () => {
    const r = await call('/api/stock/receive', {
      method: 'POST',
      body: { date: today(), lines: [{ code: 'TDP1', qty: 2 }] },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    whi = String(r.body.no);
  });
  await expect([200], `/api/stock/movements/${whi}`);
  await expect([201], '/api/stock/issue', {
    method: 'POST',
    body: { type: 'other', payTo: 'TD td-admin', lines: [{ code: 'TDP1', qty: 1 }] },
  });
  await expect([200, 409], '/api/stock/pick-lines?type=job&ref=TDJ0002');
  await expect([200], `/api/stock/pick-lines?type=sale&ref=${soNo}`);
  await expect([200], '/api/stock/pick-lines?type=return&ref=TDJ0002');
  await expect([400], '/api/stock/pick-lines?type=job');
  await expect([200], '/api/stock/pick-orders');

  console.log('\nAdmin');
  await expect([200], '/api/admin/users');
  await expect([200], '/api/admin/users', {
    method: 'POST',
    body: { name: `TD Api ${rand}`, role: 'Engineer', email: `td-api-${rand.toLowerCase()}@example.invalid` },
  });
  await expect([200], '/api/admin/permissions');
  await expect([200], '/api/admin/permissions', {
    method: 'POST',
    body: { items: [{ role: 'TD Api', menu: 'Customer', view: true }] },
  });
  await expect([200], '/api/admin/permissions?role=TD%20Api', { method: 'DELETE' }); // nobody holds it
  if (customerId)
    await expect([200], '/api/admin/records', {
      method: 'POST',
      body: { table: 'customers', id: customerId, status: 'INACTIVE' },
    });
  await expect([200], '/api/masters/colors', { method: 'POST', body: { name: `TD สี ${rand}` } });
  await expect([200], '/api/masters/symptoms', { method: 'POST', body: { name: `TD อาการ ${rand}`, group: 'TD' } });
  await expect([200, 400], '/api/masters/models', {
    method: 'POST',
    body: { name: `TD Model ${rand}`, brand: 'TD', price: '0' },
  });
  for (const kind of ['document-profiles', 'shipping-profiles']) {
    await expect([200], `/api/admin/${kind}`);
    let id = '';
    await test(`POST /api/admin/${kind} → 200 (create)`, async () => {
      const r = await call(`/api/admin/${kind}`, {
        method: 'POST',
        body: { code: `TD${rand}`, nameTh: `โปรไฟล์ทดสอบ ${rand}` },
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      id = (r.body.row as { id: string }).id;
    });
    await expect([200], `/api/admin/${kind}?id=${id}`, { method: 'DELETE' });
  }

  console.log('\nSign-in');
  await expect([307], '/api/sso/login');
  await expect([307], '/api/sso/callback');
  await expect([200], '/api/sso/me');
  await expect([401], '/api/sso/me', { as: null });
  await expect([200], '/api/sso/refresh');
  await expect([401], '/api/sso/refresh', { as: null });
  await expect([307], '/api/sso/logout', { as: SELLER2 });

  console.log('\nPublic tracking');
  let ticket = '';
  await test('POST /api/track/session → 200 (a ticket for the link)', async () => {
    const r = await call('/api/track/session', {
      method: 'POST',
      body: { linkToken, turnstileToken: 'good' },
      as: null,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    ticket = String(r.body.ticket);
  });
  await expect([200], '/api/track/data', { method: 'POST', body: { ticket }, as: null });
  await expect([401], '/api/track/data', { method: 'POST', body: { ticket }, as: null }); // used once
  await expect([200, 404], '/api/track/doc', {
    method: 'POST',
    body: { kind: 'job', ref: 'TDJ0004', linkToken },
    as: null,
  });
  await expect([200], '/api/track/link/keepalive', { method: 'POST', body: { linkToken }, as: null });
  await expect([410], '/api/track/session', {
    method: 'POST',
    body: { linkToken: 'x'.repeat(43), turnstileToken: 'good' },
    as: null,
  });
  await expect([401], '/api/track/me', { as: null });
  await expect([200], '/api/track/me', { method: 'DELETE', as: null });
  await expect([401], '/api/track/me/keepalive', { method: 'POST', as: null });
  await expect([401], '/api/track/me/jobs/TDJ0004', { as: null });
  await expect([400], '/api/track/otp/request', {
    method: 'POST',
    body: { phone: '12', turnstileToken: 'good' },
    as: null,
  });
  await expect([401], '/api/track/otp/verify', { method: 'POST', body: { requestId: 'x', code: '0000' }, as: null });

  console.log('\nInput read through the contract — refused in the words the route always used');
  /** call and expect exactly this status and JSON body */
  const refuses = (status: number, body: Record<string, unknown>, url: string, init?: Init) =>
    test(`${init?.method ?? 'GET'} ${url} → ${status} ${JSON.stringify(body)}`, async () => {
      const r = await call(url, init);
      assert.equal(r.status, status, JSON.stringify(r.body));
      assert.deepEqual(r.body, body);
    });
  const idRequired = { error: 'id required' };
  // a profile by its uuid: none, an old int id or junk is no profile
  const noProfile = { error: 'ไม่พบโปรไฟล์' };
  await refuses(404, noProfile, '/api/admin/document-profiles', { method: 'DELETE' });
  await refuses(404, noProfile, '/api/admin/document-profiles?id=abc', { method: 'DELETE' });
  await refuses(404, noProfile, '/api/admin/shipping-profiles?id=1', { method: 'DELETE' });
  await refuses(404, noProfile, '/api/admin/shipping-profiles?id=00000000-0000-7000-8000-000000000000', {
    method: 'DELETE',
  });
  await refuses(404, { error: 'ไม่พบไฟล์แนบ' }, '/api/attachments/id');
  await refuses(404, { error: 'ไม่พบไฟล์แนบ' }, '/api/attachments/id', { method: 'DELETE' });
  await refuses(404, { error: 'ไม่พบงาน' }, '/api/jobs/J2612164'); // a job's number is no path (ADR 0008)
  // what the DB cannot take (DAST 2026-10-20): the caller's mistake → 400, not an "unhandled" 500
  const badInput = { error: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่' };
  await refuses(400, badInput, '/api/data/jobs?q=a%00b');
  await refuses(400, badInput, '/api/customers/lookup?q=a%00b');
  // a literal % in a path is just a character (Next decodes the segment once): not found, not 400 / 500
  await refuses(404, { error: 'ไม่พบใบสั่งขาย' }, '/api/sale-orders/SO%25n%25s');
  await refuses(400, { error: 'no items' }, '/api/admin/permissions', { method: 'POST', body: { items: 'all' } });
  await refuses(400, { error: 'no items' }, '/api/admin/permissions', {
    method: 'POST',
    body: { items: [{ role: ' ', menu: 'Customer', view: true }] },
  });
  await refuses(400, idRequired, '/api/admin/records', { method: 'POST', body: { table: 'customers' } });
  // the body is checked before the permission, as always: a stranger gets the same 400
  await refuses(400, { error: 'table not allowed: nope' }, '/api/admin/records', {
    method: 'POST',
    body: { table: 'nope', id: 'x' }, // a row id is text (a uuid / model code) — a number is no id
    as: null,
  });
  await refuses(404, { error: 'unknown master: nope' }, '/api/masters/nope', { method: 'POST', body: { name: 'x' } });

  console.log('\nDeleting through /api/admin/records — what a delete would leave behind is refused');
  // a part / job / quotation / sale order goes by its uuid (ADR 0008) — looked up here by its code / number
  const DOC: Record<string, [string, string]> = {
    products: ['product', 'product_code'],
    jobs: ['job', 'job_no'],
    quotations: ['quotation_hd', 'quotation_no'],
    sale_orders: ['sale_out_hd', 'sale_out_hd_no'],
    customers: ['customer', 'customer_code'],
  };
  const del = async (table: string, key: string, as?: Who, status = 'DELETED', remark = 'TD เหตุผล') => {
    const d = DOC[table];
    const id = d
      ? (await pool.query<{ id: string }>(`SELECT id::text AS id FROM ${d[0]} WHERE ${d[1]} = $1`, [key])).rows[0]!.id
      : key;
    return call('/api/admin/records', {
      method: 'POST',
      body: { table, id, status, remark }, // jobs / quotations / sale orders: DELETED needs a reason
      ...(as === undefined ? {} : { as }),
    });
  };
  await test('a job with a part waiting for stock / issued and not back → 409, the job stays', async () => {
    await pool.query(`DELETE FROM job_order_spare_part_log WHERE job_no = 'TDJRDEL';
      DELETE FROM job_log WHERE job_no = 'TDJRDEL';
      DELETE FROM job WHERE job_no = 'TDJRDEL';
      INSERT INTO job (job_no, job_status_id, record_status) VALUES ('TDJRDEL', 11, 'ACTIVE');
      INSERT INTO job_order_spare_part_log (job_no, order_status_id, request_qty, grant_qty, return_qty)
        VALUES ('TDJRDEL', 1, 3, 1, 0)`);
    const r = await del('jobs', 'TDJRDEL');
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.match(String(r.body.error), /อะไหล่รอเบิก/);
    const { rows } = await pool.query(`SELECT record_status AS rs FROM job WHERE job_no = 'TDJRDEL'`);
    assert.equal(rows[0].rs, 'ACTIVE');
    // every part back / cancelled → the delete goes through
    await pool.query(
      `UPDATE job_order_spare_part_log SET order_status_id = 5, return_qty = 1 WHERE job_no = 'TDJRDEL'`,
    );
    assert.equal((await del('jobs', 'TDJRDEL')).status, 200);
  });
  await test('a part a job is still waiting for → 409 naming the job; the part stays', async () => {
    await pool.query(`DELETE FROM job_order_spare_part_log WHERE job_no = 'TDJRPART';
      DELETE FROM job_log WHERE job_no = 'TDJRPART'; DELETE FROM job WHERE job_no = 'TDJRPART';
      INSERT INTO job (job_no, job_status_id, record_status) VALUES ('TDJRPART', 11, 'ACTIVE');
      INSERT INTO job_order_spare_part_log (job_no, spare_part_code, order_status_id, request_qty, grant_qty, return_qty)
        VALUES ('TDJRPART', 'TDP1', 1, 1, 0, 0)`);
    const r = await del('products', 'TDP1');
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.match(String(r.body.error), /TDP1 มีงานรอเบิกอยู่ \(.*J/);
    const { rows } = await pool.query(`SELECT record_status AS rs FROM product WHERE product_code = 'TDP1'`);
    assert.equal(rows[0].rs, 'ACTIVE');
    await pool.query(`DELETE FROM job_order_spare_part_log WHERE job_no = 'TDJRPART'`);
  });
  await test("a job's agreed quotation → 409 (the job would point at a deleted document)", async () => {
    await pool.query(`DELETE FROM job WHERE job_no = 'TDJRQ'; DELETE FROM quotation_hd WHERE quotation_no = 'TDQRDEL';
      INSERT INTO quotation_hd (quotation_no, record_status) VALUES ('TDQRDEL', 'ACTIVE');
      INSERT INTO job (job_no, job_status_id, record_status, quotation_no_approved) VALUES ('TDJRQ', 12, 'ACTIVE', 'TDQRDEL')`);
    const r = await del('quotations', 'TDQRDEL');
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.match(String(r.body.error), /TDJRQ/);
    await pool.query(`UPDATE job SET quotation_no_approved = NULL WHERE job_no = 'TDJRQ'`);
    assert.equal((await del('quotations', 'TDQRDEL')).status, 200);
  });
  await test('a quotation / sale order cannot be set INACTIVE → 400 (a document is ACTIVE or DELETED)', async () => {
    const r = await del('quotations', 'TDQRDEL', undefined, 'INACTIVE');
    assert.equal(r.status, 400, JSON.stringify(r.body));
  });
  await test("someone else's pending sale order: only its creator, an approver or an admin may cancel it", async () => {
    await pool.query(`DELETE FROM sale_out_hd WHERE sale_out_hd_no = 'TDSORDEL';
      INSERT INTO sale_out_hd (sale_out_hd_no, approve_status_id, document_create_by, record_status)
        VALUES ('TDSORDEL', 2, 9107, 'ACTIVE');
      DELETE FROM app_config WHERE user_type = 'TD Canceller';
      INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view)
        VALUES ('TD Canceller', 'Sale Order', true, true, true, true);
      DELETE FROM app_user WHERE email_address = 'td-canceller@example.invalid';
      INSERT INTO app_user (username, password, first_name, user_type, is_active, email_address, record_status,
                            session_version)
        VALUES ('td-canceller', '', 'TD Canceller', 'TD Canceller', true, 'td-canceller@example.invalid', 'ACTIVE',
                ${SV})`);
    const r = await del('sale_orders', 'TDSORDEL', { email: 'td-canceller@example.invalid' });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    const { rows } = await pool.query(`SELECT record_status AS rs FROM sale_out_hd WHERE sale_out_hd_no = 'TDSORDEL'`);
    assert.equal(rows[0].rs, 'ACTIVE');
    assert.equal((await del('sale_orders', 'TDSORDEL')).status, 200); // System Admin
    // its creator cancels it with Sale Order edit alone (no delete right — the TD Seller role)
    await pool.query(`DELETE FROM sale_out_hd WHERE sale_out_hd_no = 'TDSORDEL2';
      INSERT INTO sale_out_hd (sale_out_hd_no, approve_status_id, document_create_by, record_status)
        VALUES ('TDSORDEL2', 1, 9107, 'ACTIVE')`);
    const own = await del('sale_orders', 'TDSORDEL2', { email: 'td-seller@example.invalid' });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    // a second cancel (another person, a stale page) is refused — the first one's who / why stay
    const again = await del('sale_orders', 'TDSORDEL2', undefined, 'DELETED', 'ทับเหตุผล');
    assert.equal(again.status, 409, JSON.stringify(again.body));
    const { rows: kept } = await pool.query(
      `SELECT document_cancel_remark AS r, document_cancel_by AS b FROM sale_out_hd WHERE sale_out_hd_no = 'TDSORDEL2'`,
    );
    assert.deepEqual(kept[0], { r: 'TD เหตุผล', b: 9107 });
    // the detail carries the reason; the list / export read ยกเลิก, not the last approval step
    const got = await call(
      `/api/sale-orders/${await uuidOf(`SELECT id::text AS id FROM sale_out_hd WHERE sale_out_hd_no = 'TDSORDEL2'`)}`,
    );
    const order = got.body.order as { cancelRemark: string; approve: string };
    assert.deepEqual([order.cancelRemark, order.approve], ['TD เหตุผล', 'ยกเลิก']);
  });
  // QA follow-ups 2026-10-21: only System Admin restores a deleted customer (the delete dialog says so)
  await test('restoring a deleted customer: Customer del alone → 403, System Admin → 200', async () => {
    await pool.query(`DELETE FROM customer WHERE customer_code = 'TDCRST';
      INSERT INTO customer (customer_code, customer_name, phone_number, record_status)
        VALUES ('TDCRST', 'TD ลูกค้าลบแล้ว', '02-000-0901', 'DELETED')`);
    const clerk = await del('customers', 'TDCRST', { email: 'td-clerk@example.invalid' }, 'ACTIVE');
    assert.deepEqual([clerk.status, clerk.body.error], [403, 'กู้คืนลูกค้าที่ลบแล้วได้เฉพาะผู้ดูแลระบบ']);
    const { rows } = await pool.query(`SELECT record_status AS rs FROM customer WHERE customer_code = 'TDCRST'`);
    assert.equal(rows[0].rs, 'DELETED');
    assert.equal((await del('customers', 'TDCRST', undefined, 'ACTIVE')).status, 200);
  });
  await test('the customer lookup offers a deleted customer to nobody unless System Admin asks deleted=all', async () => {
    await pool.query(`DELETE FROM customer WHERE customer_code = 'TDCLKD';
      INSERT INTO customer (customer_code, customer_name, phone_number, record_status)
        VALUES ('TDCLKD', 'TD ลูกค้าลบแล้ว 2', '02-000-0902', 'DELETED')`);
    const codes = async (url: string, as?: Who) =>
      ((await call(url, as === undefined ? {} : { as })).body.rows as { code: string }[]).map((r) => r.code);
    assert.deepEqual(await codes('/api/customers/lookup?q=TDCLKD'), [], 'admin, a picker');
    assert.deepEqual(await codes('/api/customers/lookup?q=TDCLKD&deleted=all'), ['TDCLKD'], 'admin, by code');
    // the customers page's ?edit=<uuid> link: that customer by its uuid
    const [{ id }] = (await pool.query<{ id: string }>(`SELECT id::text FROM customer WHERE customer_code = 'TDCLKD'`))
      .rows;
    assert.deepEqual(await codes(`/api/customers/lookup?q=${id}&deleted=all`), ['TDCLKD'], 'admin, ?edit=<uuid>');
    assert.deepEqual(await codes(`/api/customers/lookup?q=${id}`), [], 'admin, a picker by uuid');
    const clerk = { email: 'td-clerk@example.invalid' };
    assert.deepEqual(await codes('/api/customers/lookup?q=TDCLKD&deleted=all', clerk), [], 'non-admin asking');
  });
  await test('stock receive lists INACTIVE parts (deleted=exclude) — pickers stay ACTIVE; receiving one → 201', async () => {
    await pool.query(`DELETE FROM product_none_serial WHERE product_id = 9298 OR item_id = 9298; DELETE FROM product WHERE product_id = 9298;
      INSERT INTO product (product_id, product_code, product_name, record_status) VALUES (9298, 'TDPRCV', 'TD ปิดใช้งาน', 'INACTIVE');
      INSERT INTO product_none_serial (item_id, product_id, quantity_available, quantity_used, quantity_booking, quantity_remain)
        VALUES (9298, 9298, 0, 0, 0, 0)`);
    const lite = async (deleted: string) =>
      (await call(`/api/data/products?fields=lite&q=TDPRCV${deleted}`)).body as unknown as {
        sysCode: string;
        status: string;
      }[];
    assert.deepEqual(
      (await lite('&deleted=exclude')).map((r) => [r.sysCode, r.status]),
      [['TDPRCV', 'Inactive']],
    );
    assert.deepEqual(await lite('&deleted=active'), [], 'picker search');
    assert.deepEqual(await lite(''), [], 'no mode');
    const r = await call('/api/stock/receive', {
      method: 'POST',
      body: { date: today(), lines: [{ code: 'TDPRCV', qty: 1 }] },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  });
  await test('cancelling a sale order needs a reason → 400 under remark, nothing changed', async () => {
    await pool.query(`DELETE FROM sale_out_hd WHERE sale_out_hd_no = 'TDSORDEL3';
      INSERT INTO sale_out_hd (sale_out_hd_no, approve_status_id, document_create_by, record_status)
        VALUES ('TDSORDEL3', 1, 9107, 'ACTIVE')`);
    for (const remark of ['', '   ']) {
      const r = await del('sale_orders', 'TDSORDEL3', undefined, 'DELETED', remark);
      assert.equal(r.status, 400, JSON.stringify(r.body));
    }
    const { rows } = await pool.query(`SELECT record_status AS rs FROM sale_out_hd WHERE sale_out_hd_no = 'TDSORDEL3'`);
    assert.equal(rows[0].rs, 'ACTIVE');
  });

  await refuses(404, { error: 'unknown export: nope' }, '/api/export/nope');
  await refuses(400, { error: 'kind required' }, '/api/documents/profile', { method: 'POST', body: { kind: 'x' } });
  await refuses(400, { error: 'no required' }, '/api/documents/profile', { method: 'POST', body: { kind: 'job' } });
  await refuses(400, { error: 'profileId required' }, '/api/documents/profile', {
    method: 'POST',
    body: { kind: 'job', no: 'tdj0004', profileId: 'none' },
  });
  await refuses(400, { error: 'ref required' }, '/api/stock/pick-lines?type=job');
  await refuses(400, { error: 'type must be job, sale or return' }, '/api/stock/pick-lines?ref=TDJ0004&type=all');
  await refuses(400, { error: 'path required' }, '/api/files?path=products/../x.jpg');
  await refuses(400, { error: 'file required' }, '/api/upload', {
    method: 'POST',
    form: form({ kind: 'product-image', id: 'TDP1' }),
  });
  await test('POST /api/upload with a file and no id → 400 {"error":"id required"}', async () => {
    const f = new FormData();
    f.set('kind', 'product-image');
    f.set('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'x.png', { type: 'image/png' }));
    const r = await call('/api/upload', { method: 'POST', form: f });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, idRequired);
  });
  await refuses(400, { error: 'expected multipart/form-data' }, '/api/upload', { method: 'POST', body: {} });
  await refuses(400, { error: 'ไม่พบไฟล์' }, '/api/attachments', { method: 'POST', form: form({ jobNo: 'TDJ0004' }) });
  await refuses(400, { error: 'รองรับเฉพาะวิดีโอ MP4, MOV, WebM' }, '/api/attachments/video', {
    method: 'POST',
    body: { jobNo: 'TDJ0004', type: 'video/x-msvideo', size: 1024 },
  });
  await refuses(400, { error: 'ไม่พบไฟล์วิดีโอที่อัปโหลด' }, '/api/attachments/video/confirm', {
    method: 'POST',
    form: form({ jobNo: 'TDJ0004', file: '../slip/x.mp4' }),
  });
  await refuses(400, { error: 'Idempotency-Key ยาวเกินไป' }, '/api/customers', {
    method: 'POST',
    body: { name: 'x' },
    headers: { 'idempotency-key': 'k'.repeat(101) },
  });
  await refuses(
    400,
    { error: 'กรอกข้อมูลไม่ครบ 1 ช่อง', details: { fields: { detail: 'ต้องระบุรายละเอียด' } } },
    `${J4}/calls`,
    { method: 'POST', body: { detail: ' ' } },
  );
  // a choice outside its values is read as left out, an unknown name is a filter — never a 400
  await expect([200], '/api/data/jobs?paged=1&dir=sideways&deleted=nope&open=yes&dateBy=x&whatever=1');
  await expect([200], '/api/address?level=country');

  console.log('\nCoverage');
  await test('every declared operation was called and answered as declared', async () => {
    const reached = new Set([...checked].map((name) => name.split(' ').slice(0, 2).join(' ')));
    const declared = registry.definitions.flatMap((d) =>
      d.type === 'route' ? [`${d.route.method.toUpperCase()} ${d.route.path}`] : [],
    );
    assert.deepEqual(
      declared.filter((name) => !reached.has(name)),
      [],
    );
  });
} finally {
  await pool.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
