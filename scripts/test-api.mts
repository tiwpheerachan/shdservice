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
  await expect([200], '/api/data/job_nos?mode=pending_parts');
  await expect([200], '/api/data/staff?usedAs=engineer');
  await expect([401], '/api/data/jobs', { as: null });

  console.log('\nLookups, alerts, files, docs');
  await expect([200], '/api/address');
  await expect([200], '/api/address?level=district&city=1');
  await expect([200], '/api/address?level=subdistrict&district=1');
  await expect([200], '/api/alerts/overdue');
  await expect([200], '/api/alerts/sale-orders-pending');
  await expect([200], '/api/customers/lookup?q=TDC001');
  await expect([200], '/api/customers/lookup?q=ทดสอบ');
  await expect([200], '/api/products/TDP1');
  await expect([404], '/api/products/NOPE-' + rand);
  await expect([200], '/api/export/customers');
  await expect([404], '/api/attachments/999999999');
  await expect([404], '/api/attachments/999999999', { method: 'DELETE' });
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
  await expect([200], '/api/jobs/TDJ0004');
  await expect([404], '/api/jobs/NOPE' + rand);
  await expect([404], '/api/jobs/J%25zz'); // a literal % (Next hands the segment over decoded once): no URIError
  await expect([200], '/api/jobs/TDJ0004/calls');
  await expect([200], '/api/jobs/TDJ0004/calls', { method: 'POST', body: { detail: 'โทรแจ้งลูกค้าแล้ว (test-api)' } });
  await expect([400], '/api/jobs/TDJ0004/calls', { method: 'POST', body: { detail: '' } });
  await expect([200], '/api/jobs/assign', {
    method: 'POST',
    body: { jobNos: ['TDJ0004'], engineerId: 9110, takeOver: true },
  });
  await expect([400], '/api/jobs', { method: 'POST', body: {} });
  await expect([200, 400, 409], '/api/jobs/TDJ0004', { method: 'PATCH', body: { version: -1 } });
  await expect([415], '/api/jobs/TDJ0004/close', { method: 'POST', headers: { 'content-type': 'text/plain' } });
  await expect([400], '/api/jobs/TDJ0004/close', { method: 'POST', body: {} });
  await expect([400], '/api/jobs/TDJ0004/outsource', { method: 'POST', body: {} });
  await expect([400], '/api/jobs/TDJ0004/repair', { method: 'POST', body: {} });
  await expect([400], '/api/jobs/TDJ0004/swap-refund', { method: 'POST', body: {} });
  await expect([200], '/api/jobs/TDJ0004/track-link');
  let linkToken = '';
  await test('POST /api/jobs/TDJ0004/track-link → 200 (a new link)', async () => {
    const r = await call('/api/jobs/TDJ0004/track-link', { method: 'POST' });
    assert.equal(r.status, 200);
    linkToken = String(r.body.url).split('/track/')[1] ?? '';
    assert.ok(linkToken);
  });

  console.log('\nCustomers, quotations, sale orders');
  let customerCode = '';
  await test('POST /api/customers → 201 (create)', async () => {
    const r = await call('/api/customers', {
      method: 'POST',
      body: { name: `ลูกค้า API ${rand}`, phone: `08${String(Date.now()).slice(-8)}`, type: 'Normal' },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    customerCode = String((r.body.row as { code: string }).code);
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
  let quotationNo = '';
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
    quotationNo = String((r.body.quotation as { no?: string } | undefined)?.no ?? '');
  });
  if (quotationNo) await expect([200], `/api/quotations/${quotationNo}`);
  await expect([404], '/api/quotations/NOPE' + rand);
  let soNo = '';
  await test('POST /api/sale-orders → 201 (create, sent for approval)', async () => {
    const r = await call('/api/sale-orders', {
      method: 'POST',
      body: { customerCode: 'TDC001', salesId: 9107, lines: [{ code: 'TDP1', qty: 1, price: 100 }], submit: true },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    soNo = String((r.body.order as { no: string }).no);
  });
  await expect([200], `/api/sale-orders/${soNo}`);
  await expect([404], '/api/sale-orders/SO0' + rand);
  await expect([200], `/api/sale-orders/${soNo}/approve`, {
    method: 'POST',
    body: { decision: 'approve' },
    as: MANAGER,
  });
  await expect([200], `/api/sale-orders/${soNo}/tracking`, { method: 'POST', body: { tracking: 'TH0123456789' } });
  await expect([200], '/api/documents/profile', {
    method: 'POST',
    body: { kind: 'sale_order', no: soNo, profileId: 1 },
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
    body: { type: 'other', payTo: 'คลังสินค้าดี', lines: [{ code: 'TDP1', qty: 1 }] },
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
  if (customerCode)
    await expect([200], '/api/admin/records', {
      method: 'POST',
      body: { table: 'customers', id: customerCode, status: 'INACTIVE' },
    });
  await expect([200], '/api/masters/colors', { method: 'POST', body: { name: `TD สี ${rand}` } });
  await expect([200], '/api/masters/symptoms', { method: 'POST', body: { name: `TD อาการ ${rand}`, group: 'TD' } });
  await expect([200, 400], '/api/masters/models', {
    method: 'POST',
    body: { name: `TD Model ${rand}`, brand: 'TD', price: '0' },
  });
  for (const kind of ['document-profiles', 'shipping-profiles']) {
    await expect([200], `/api/admin/${kind}`);
    let id = 0;
    await test(`POST /api/admin/${kind} → 200 (create)`, async () => {
      const r = await call(`/api/admin/${kind}`, {
        method: 'POST',
        body: { code: `TD${rand}`, nameTh: `โปรไฟล์ทดสอบ ${rand}` },
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      id = (r.body.row as { id: number }).id;
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
  await refuses(400, idRequired, '/api/admin/document-profiles', { method: 'DELETE' });
  await refuses(400, idRequired, '/api/admin/document-profiles?id=abc', { method: 'DELETE' });
  await refuses(400, idRequired, '/api/admin/shipping-profiles?id=0', { method: 'DELETE' });
  await refuses(400, idRequired, '/api/admin/shipping-profiles?id=1.2', { method: 'DELETE' });
  await refuses(404, { error: 'not found' }, '/api/attachments/id');
  await refuses(404, { error: 'not found' }, '/api/attachments/id', { method: 'DELETE' });
  // what the DB cannot take (DAST 2026-10-20): the caller's mistake → 400, not an "unhandled" 500
  const badInput = { error: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่' };
  await refuses(400, badInput, '/api/data/jobs?q=a%00b');
  await refuses(400, badInput, '/api/customers/lookup?q=a%00b');
  // a literal % in a number is just a character (Next decodes the segment once): not found, not 400 / 500
  await refuses(404, { error: 'ไม่พบใบสั่งขาย SO%n%s' }, '/api/sale-orders/SO%25n%25s');
  await refuses(400, { error: 'no items' }, '/api/admin/permissions', { method: 'POST', body: { items: 'all' } });
  await refuses(400, { error: 'no items' }, '/api/admin/permissions', {
    method: 'POST',
    body: { items: [{ role: ' ', menu: 'Customer', view: true }] },
  });
  await refuses(400, idRequired, '/api/admin/records', { method: 'POST', body: { table: 'customers' } });
  // the body is checked before the permission, as always: a stranger gets the same 400
  await refuses(400, { error: 'table not allowed: nope' }, '/api/admin/records', {
    method: 'POST',
    body: { table: 'nope', id: 1 },
    as: null,
  });
  await refuses(404, { error: 'unknown master: nope' }, '/api/masters/nope', { method: 'POST', body: { name: 'x' } });
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
  await refuses(400, { error: 'Idempotency-Key ยาวเกินไป' }, '/api/customers', {
    method: 'POST',
    body: { name: 'x' },
    headers: { 'idempotency-key': 'k'.repeat(101) },
  });
  await refuses(
    400,
    { error: 'กรอกข้อมูลไม่ครบ 1 ช่อง', details: { fields: { detail: 'ต้องระบุรายละเอียด' } } },
    '/api/jobs/TDJ0004/calls',
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
