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

/* a request path → its route.ts and params */
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
type Init = {
  method?: string;
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  as?: Who;
  /** false: a save that changes nothing (no row to log) — the trail check is skipped */
  audit?: false;
};

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
  const before = init.audit === false ? null : await logMarks();
  const res = await handler(req, { params: Promise.resolve(params) });
  const type = res.headers.get('content-type') ?? '';
  const body = type.includes('json') ? ((await res.json()) as Record<string, unknown>) : {};
  // a missing / wrong trail row is collected, not thrown: the flow goes on, the last test lists every one
  if (before)
    await checkTrail(method, pathname, res.status, who, before).catch((e: Error) => trailProblems.push(e.message));
  return { status: res.status, body };
}

/* the audit trail: every change leaves its row */
const trailProblems: string[] = [];
type Marks = { a: number; s: number };
const logMarks = async (): Promise<Marks> =>
  (
    await pool.query<Marks>(`SELECT (SELECT coalesce(max(pk), 0) FROM audit_log)::int AS a,
                                    (SELECT coalesce(max(pk), 0) FROM security_log)::int AS s`)
  ).rows[0]!;
type LogRow = {
  log: 'audit' | 'security';
  what: string;
  entity: string | null;
  email: string | null;
  role: string | null;
  request_id: string | null;
  session_id: string | null;
  permission: string | null;
  entity_no: string | null;
  entity_id: string | null;
};
/** bookkeeping, not a change of data: the public /track, the tutorial state, the video upload's first step */
const UNLOGGED = [/^\/api\/track\//, /^\/api\/me\/(tour|denied)$/, /^POST \/api\/attachments\/video$/];
/** a non-GET that answered 2xx wrote audit_log (or security_log: sign-in / out, print, role / permission / status) rows
 *  naming the caller as at the time, the request and the row; anything refused wrote no audit_log row. An export
 *  (GET /api/export/…) writes one security_log EXPORT and no audit_log row. */
async function checkTrail(method: string, path: string, status: number, who: Who, m: Marks) {
  const exporting = method === 'GET' && path.startsWith('/api/export/') && status === 200;
  if (method === 'GET' && !exporting) return;
  if (UNLOGGED.some((r) => r.test(path) || r.test(`${method} ${path}`))) return;
  const rows = (
    await pool.query<LogRow>(
      `SELECT 'audit' AS log, action AS what, entity, actor_email AS email, actor_role AS role, request_id, session_id,
              permission, entity_no, entity_id::text AS entity_id FROM audit_log WHERE pk > $1
       UNION ALL
       SELECT 'security', event || ' ' || result, entity, actor_email, actor_role, request_id, session_id, permission,
              entity_no, entity_id::text FROM security_log WHERE pk > $2`,
      [m.a, m.s],
    )
  ).rows;
  const audits = rows.filter((r) => r.log === 'audit');
  const where = `${method} ${path} → ${status}: ${JSON.stringify(rows)}`;
  if (exporting) {
    assert.deepEqual(
      rows.map((r) => [r.log, r.what]),
      [['security', 'EXPORT OK']],
      `export: one EXPORT, no audit_log row — ${where}`,
    );
  } else if (status >= 300) {
    assert.equal(audits.length, 0, `a refused change wrote audit_log — ${where}`);
    return;
  } else assert.ok(rows.length > 0, `a change with no audit_log / security_log row — ${where}`);
  for (const r of rows) {
    if (who) assert.equal(r.email?.toLowerCase(), who.email.toLowerCase(), `actor_email — ${where}`);
    assert.ok(r.request_id, `request_id — ${where}`);
    if (who) assert.ok(r.role && r.session_id, `actor_role / session_id — ${where}`);
    if (r.log === 'audit') {
      assert.ok(r.permission, `permission — ${where}`);
      assert.ok(r.entity_no || r.entity_id, `entity_no / entity_id — ${where}`);
      // a job / quotation / sale order row always names the record by its uuid too
      if (['job', 'quotation', 'sale_order'].includes(r.entity ?? '')) assert.ok(r.entity_id, `entity_id — ${where}`);
    }
  }
  assert.equal(new Set(rows.map((r) => r.request_id)).size, 1, `one request — ${where}`);
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
const expect = (statuses: number[], url: string, init?: Init) =>
  test(`${init?.method ?? 'GET'} ${url} → ${statuses.join(' / ')}`, async () => {
    const r = await call(url, init);
    assert.ok(statuses.includes(r.status), `got ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  });

// the /track limits count per IP across runs — start from none (throwaway DB)
await pool.query('DELETE FROM track_rate; DELETE FROM track_block');
try {
  console.log('\nData — every resource (and its page)');
  const PAGED = ['models', 'products', 'customers', 'issued_lines', 'movements', 'jobs', 'quotations', 'sale_orders'];
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
  const place = (
    await pool.query<{ c: string; d: string }>(
      `SELECT c.id::text AS c, d.id::text AS d FROM district d JOIN province c ON c.pk = d.province_pk ORDER BY d.pk LIMIT 1`,
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
  // a part by its uuid; its code — an old link — or an unknown uuid is 404, no redirect
  const uuidOf = async (sqlText: string) => (await pool.query<{ id: string }>(sqlText)).rows[0]!.id;
  const tdp1 = await uuidOf(`SELECT id::text AS id FROM product WHERE product_code = 'TDP1'`);
  await expect([200], `/api/products/${tdp1}`);
  await expect([200], `/api/products/${tdp1}/card?offset=50`);
  await expect([400], `/api/products/${tdp1}/card?offset=-1`);
  await expect([404], '/api/products/TDP1/card');
  await test('stock card: page 1 (newest 50) + โหลดเพิ่ม pages = the whole card, same lines / order / running balances', async () => {
    // 130 movements of one part (receipts and issues, some at the same time — the line pk breaks the tie)
    await pool.query(`
      DELETE FROM stock_move_line WHERE product_pk = 9297;
      DELETE FROM stock_move WHERE stock_move_no LIKE 'TDCARD%';
      DELETE FROM product_stock WHERE product_pk = 9297 OR pk = 9297; DELETE FROM product WHERE pk = 9297;
      INSERT INTO product (pk, product_code, product_name, record_status) OVERRIDING SYSTEM VALUE
        VALUES (9297, 'TDPCARD', 'TD การ์ดสต๊อก', 'ACTIVE');
      INSERT INTO stock_move (stock_move_no, stock_move_type_id, create_date, created_by_app_user_pk)
        SELECT 'TDCARD' || lpad(n::text, 4, '0'), CASE WHEN n % 3 = 0 THEN 5 ELSE 1 END,
               timestamp '2026-01-01' + (n / 2) * interval '1 hour', 9101
          FROM generate_series(1, 130) n;
      INSERT INTO stock_move_line (stock_move_pk, product_pk, item_quantity)
        SELECT m.pk, 9297, 1 + (m.pk % 4) FROM stock_move m WHERE m.stock_move_no LIKE 'TDCARD%' ORDER BY m.pk;`);
    const { productStockCard } = await import('@/server/services/stock');
    const id = await uuidOf(`SELECT id::text AS id FROM product WHERE product_code = 'TDPCARD'`);
    const first = (await call(`/api/products/${id}`)).body as { card: unknown[]; cardTotal: number };
    assert.equal(first.cardTotal, 130);
    assert.equal(first.card.length, 50);
    const lines = [...first.card];
    while (lines.length < first.cardTotal) {
      const more = (await call(`/api/products/${id}/card?offset=${lines.length}`)).body as {
        card: unknown[];
        total: number;
      };
      assert.equal(more.total, 130);
      assert.ok(more.card.length > 0, `a page at ${lines.length}`);
      lines.push(...more.card);
    }
    const whole = await productStockCard('TDPCARD');
    assert.deepEqual(lines, JSON.parse(JSON.stringify(whole)));
    // the balance rule: oldest first from 0, each line's before = the line before's after
    const card = whole as { before: number; income: number; outcome: number; after: number }[];
    for (let i = card.length - 1, bal = 0; i >= 0; i--) {
      const l = card[i]!;
      assert.equal(l.before, bal, `line ${i} before`);
      assert.equal(l.after, l.before + l.income - l.outcome, `line ${i} after`);
      bal = l.after;
    }
  });
  await expect([404], '/api/products/TDP1');
  await expect([404], '/api/products/00000000-0000-7000-8000-000000000000');
  await expect([404], '/api/products/NOPE-' + rand);
  // staff filters take a user's uuid (a name still works where the page types one)
  const tdAdmin = await uuidOf(`SELECT id::text AS id FROM app_user WHERE pk = 9101`);
  // the System Admin audit log, a non-admin refused; security_log has no web route
  await expect([200], `/api/audit?user=${tdAdmin}`);
  await expect([403], '/api/audit', { as: VIEWER });
  await expect([400], '/api/audit?from=2026-02-30');
  // the anomalies bell and its list: System Admin only
  await expect([200], '/api/alerts/anomalies');
  await expect([200], '/api/alerts/anomalies/list?category=stock_negative');
  await expect([200], '/api/alerts/anomalies/list?page=2&pageSize=5');
  await expect([403], '/api/alerts/anomalies', { as: VIEWER });
  await expect([403], '/api/alerts/anomalies/list?category=job_total', { as: VIEWER });
  await test('audit log: a job row holds user / master ids, a user row its uuid — the list (and its Excel) answers names, never a pk', async () => {
    const key = `TDJAUD${rand}`.slice(0, 20);
    const [u] = (
      await pool.query<{ name: string; email: string }>(
        `SELECT btrim(concat_ws(' ', btrim(first_name), btrim(last_name))) AS name, btrim(email_address) AS email FROM app_user WHERE pk = 9101`,
      )
    ).rows;
    await pool.query(
      `INSERT INTO audit_log (at, actor_name, action, module, entity, entity_key, summary, changes) VALUES
       (now(), 'qa', 'UPDATE', 'Job Management', 'job', $1, 'มอบหมายงานให้ช่าง #9101', $2),
       (now(), 'qa', 'LOGIN', 'Auth', 'app_user', $3, 'เข้าสู่ระบบ', NULL)`,
      [
        key,
        JSON.stringify({
          engineerId: [0, 9101],
          sendBy: [null, 9101],
          jobReturnBy: [null, 9101],
          jobStatusId: [1, 0],
          quotationStatusId: [1, 3],
          approveStatusId: [2, 4],
        }),
        tdAdmin,
      ],
    );
    const job = (await call(`/api/audit?no=${key}`)).body;
    const [r] = job.rows as { summary: string; changes: Record<string, unknown[]> }[];
    assert.deepEqual(r!.changes, {
      engineerId: [null, u!.name],
      sendBy: [null, u!.name],
      jobReturnBy: [null, u!.name],
      jobStatusId: ['รับงานใหม่', 'ยกเลิก'],
      quotationStatusId: ['รอเสนอราคา', 'ลูกค้าตกลงซ่อม'],
      approveStatusId: ['รออนุมัติ', 'อนุมัติแล้ว'],
    });
    assert.equal(r!.summary, `มอบหมายงานให้ช่าง ${u!.name}`);
    const login = (await call(`/api/audit?no=${tdAdmin}&action=LOGIN`)).body;
    const [l] = login.rows as { key: string }[];
    assert.equal(l!.key, `${u!.name} · ${u!.email}`);
  });
  await test("jobs: customerCode filters by the job's customer (customer_pk), not its text snapshot (that only for a job without one); a row carries the customer's uuid", async () => {
    await pool.query(`DELETE FROM job WHERE job_no = 'TDJCUS';
      INSERT INTO job (job_no, job_status_id, record_status, customer_pk, customer_detail, model_pk)
      VALUES ('TDJCUS', 1, 'ACTIVE', (SELECT pk FROM customer WHERE customer_code = 'TDC001'), 'X9 ข้อความเก่า',
              (SELECT pk FROM model WHERE model_code = 'TST-M'))`);
    const tdc1 = await uuidOf(`SELECT id::text AS id FROM customer WHERE customer_code = 'TDC001'`);
    const rows = (await call('/api/data/jobs?paged=1&pageSize=200&customerCode=TDC001&q=TDJCUS')).body.rows as {
      no: string;
      customerId?: string;
    }[];
    assert.deepEqual(
      rows.map((r) => [r.no, r.customerId]),
      [['TDJCUS', tdc1]],
    );
    assert.deepEqual((await call('/api/data/jobs?paged=1&customerCode=X9&q=TDJCUS')).body.rows, []);
  });
  await expect([200], `/api/data/products?paged=1&creator=${tdAdmin}`);
  await expect([200], `/api/data/report_rows?report=sale_order&createdBy=${tdAdmin}`);
  await expect([200], '/api/export/customers');
  // an attachment / a job by its uuid: an old int id / job number → 404, no redirect
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
  // direct=1 (the player's fallback from the media CDN) — ignored for a file outside R2
  await expect([404, 503], '/api/files?path=jobs/TDJ0004/attachments/x.mp4&direct=1&reason=network');
  await test('POST /api/attachments to a deleted job → 409, nothing stored', async () => {
    await pool.query(`DELETE FROM job_attachment WHERE job_pk = (SELECT pk FROM job WHERE job_no = 'TDJDEL');
      DELETE FROM job_status_log WHERE job_pk = (SELECT pk FROM job WHERE job_no = 'TDJDEL'); DELETE FROM job WHERE job_no = 'TDJDEL';
      INSERT INTO job (job_no, job_status_id, record_status, model_pk) VALUES ('TDJDEL', 1, 'DELETED', (SELECT pk FROM model WHERE model_code = 'TST-M'))`);
    const f = form({ jobNo: 'TDJDEL' });
    f.set(
      'file',
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], 'x.pdf', { type: 'application/pdf' }),
    );
    const r = await call('/api/attachments', { method: 'POST', form: f });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.deepEqual(r.body, { error: 'งานนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้' });
    const { rows } = await pool.query(
      `SELECT 1 FROM job_attachment WHERE job_pk = (SELECT pk FROM job WHERE job_no = 'TDJDEL')`,
    );
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
      engineerId: await uuidOf(`SELECT id::text AS id FROM app_user WHERE pk = 9110`),
      takeOver: true,
    },
    audit: false, // test:domain left TDJ0004 with this engineer: nothing changes, nothing to log
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
  await test('POST /api/me/denied → 200: a page the role may not open is logged (DENIED), one it may is not', async () => {
    const m = await logMarks();
    assert.equal(
      (await call('/api/me/denied', { method: 'POST', body: { path: '/admin/users' }, as: VIEWER })).status,
      200,
    );
    const [{ n }] = (
      await pool.query<{ n: number }>(
        `SELECT count(*)::int n FROM security_log WHERE pk > $1 AND event = 'DENIED' AND permission = 'page System Admin'`,
        [m.s],
      )
    ).rows;
    assert.equal(n, 1);
    assert.equal((await call('/api/me/denied', { method: 'POST', body: { path: 'admin' } })).status, 400);
  });
  await test('POST /api/me/tour → 200: a page answered, then never ask again (kept per account)', async () => {
    assert.equal((await call('/api/me/tour', { method: 'POST', body: { seen: '/jobs/new' } })).status, 200);
    assert.equal((await call('/api/me/tour', { method: 'POST', body: { seen: '/jobs/new' } })).status, 200);
    assert.equal((await call('/api/me/tour', { method: 'POST', body: { off: true } })).status, 200);
    const { rows } = await pool.query(
      `SELECT t.seen, t.off FROM app_user_tour t JOIN app_user u ON u.pk = t.app_user_pk WHERE lower(u.email_address) = lower($1)`,
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
    INSERT INTO customer (pk, customer_code, customer_name, phone_number, record_status) OVERRIDING SYSTEM VALUE
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
  // a quotation / sale order by its uuid; its number — an old link — or an unknown uuid is 404
  if (quotationId) await expect([200], `/api/quotations/${quotationId}`);
  await expect([404], '/api/quotations/NOPE' + rand);
  await expect([404], '/api/quotations/00000000-0000-7000-8000-000000000000');
  const salesId = await uuidOf(`SELECT id::text AS id FROM app_user WHERE pk = 9107`);
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
    audit: false, // the order is already SHD's: nothing changes, nothing to log
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
  await refuses(404, { error: 'ไม่พบงาน' }, '/api/jobs/J2612164'); // a job's number is no path
  // what the DB cannot take: the caller's mistake → 400, not an "unhandled" 500
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
  // a part / job / quotation / sale order goes by its uuid — looked up here by its code / number
  const DOC: Record<string, [string, string]> = {
    products: ['product', 'product_code'],
    jobs: ['job', 'job_no'],
    quotations: ['quotation', 'quotation_no'],
    sale_orders: ['sale_order', 'sale_order_no'],
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
    await pool.query(`DELETE FROM job_part WHERE job_pk = (SELECT pk FROM job WHERE job_no = 'TDJRDEL');
      DELETE FROM job_status_log WHERE job_pk = (SELECT pk FROM job WHERE job_no = 'TDJRDEL');
      DELETE FROM job WHERE job_no = 'TDJRDEL';
      INSERT INTO job (job_no, job_status_id, record_status, model_pk) VALUES ('TDJRDEL', 11, 'ACTIVE', (SELECT pk FROM model WHERE model_code = 'TST-M'));
      INSERT INTO job_part (job_pk, job_part_status_id, request_qty, grant_qty, return_qty)
        VALUES ((SELECT pk FROM job WHERE job_no = 'TDJRDEL'), 1, 3, 1, 0)`);
    const r = await del('jobs', 'TDJRDEL');
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.match(String(r.body.error), /อะไหล่รอเบิก/);
    const { rows } = await pool.query(`SELECT record_status AS rs FROM job WHERE job_no = 'TDJRDEL'`);
    assert.equal(rows[0].rs, 'ACTIVE');
    // every part back / cancelled → the delete goes through
    await pool.query(
      `UPDATE job_part SET job_part_status_id = 5, return_qty = 1 WHERE job_pk = (SELECT pk FROM job WHERE job_no = 'TDJRDEL')`,
    );
    assert.equal((await del('jobs', 'TDJRDEL')).status, 200);
  });
  await test('a part a job is still waiting for → 409 naming the job; the part stays', async () => {
    await pool.query(`DELETE FROM job_part WHERE job_pk = (SELECT pk FROM job WHERE job_no = 'TDJRPART');
      DELETE FROM job_status_log WHERE job_pk = (SELECT pk FROM job WHERE job_no = 'TDJRPART'); DELETE FROM job WHERE job_no = 'TDJRPART';
      INSERT INTO job (job_no, job_status_id, record_status, model_pk) VALUES ('TDJRPART', 11, 'ACTIVE', (SELECT pk FROM model WHERE model_code = 'TST-M'));
      INSERT INTO job_part (job_pk, product_pk, job_part_status_id, request_qty, grant_qty, return_qty)
        VALUES ((SELECT pk FROM job WHERE job_no = 'TDJRPART'), (SELECT pk FROM product WHERE product_code = 'TDP1'), 1, 1, 0, 0)`);
    const r = await del('products', 'TDP1');
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.match(String(r.body.error), /TDP1 มีงานรอเบิกอยู่ \(.*J/);
    const { rows } = await pool.query(`SELECT record_status AS rs FROM product WHERE product_code = 'TDP1'`);
    assert.equal(rows[0].rs, 'ACTIVE');
    await pool.query(`DELETE FROM job_part WHERE job_pk = (SELECT pk FROM job WHERE job_no = 'TDJRPART')`);
  });
  await test("a job's agreed quotation → 409 (the job would point at a deleted document)", async () => {
    await pool.query(`DELETE FROM job_status_log WHERE job_pk = (SELECT pk FROM job WHERE job_no = 'TDJRQ'); DELETE FROM job WHERE job_no = 'TDJRQ';
      DELETE FROM quotation WHERE quotation_no = 'TDQRDEL';
      INSERT INTO quotation (quotation_no, record_status) VALUES ('TDQRDEL', 'ACTIVE');
      INSERT INTO job (job_no, job_status_id, record_status, model_pk, approved_quotation_pk)
        VALUES ('TDJRQ', 12, 'ACTIVE', (SELECT pk FROM model WHERE model_code = 'TST-M'),
                (SELECT pk FROM quotation WHERE quotation_no = 'TDQRDEL'))`);
    const r = await del('quotations', 'TDQRDEL');
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.match(String(r.body.error), /TDJRQ/);
    await pool.query(`UPDATE job SET approved_quotation_pk = NULL WHERE job_no = 'TDJRQ'`);
    assert.equal((await del('quotations', 'TDQRDEL')).status, 200);
  });
  await test('a quotation / sale order cannot be set INACTIVE → 400 (a document is ACTIVE or DELETED)', async () => {
    const r = await del('quotations', 'TDQRDEL', undefined, 'INACTIVE');
    assert.equal(r.status, 400, JSON.stringify(r.body));
  });
  await test("someone else's pending sale order: only its creator, an approver or an admin may cancel it", async () => {
    await pool.query(`DELETE FROM sale_order WHERE sale_order_no = 'TDSORDEL';
      INSERT INTO sale_order (sale_order_no, approve_status_id, created_by_app_user_pk, record_status)
        VALUES ('TDSORDEL', 2, 9107, 'ACTIVE');
      DELETE FROM role_permission WHERE user_type = 'TD Canceller';
      INSERT INTO role_permission (user_type, module_name, can_insert, can_edit, can_delete, can_view)
        VALUES ('TD Canceller', 'Sale Order', true, true, true, true);
      -- a fixed pk in test-domain's 9100–9199 (it removes other td-* users), upserted: what it did points at it
      INSERT INTO app_user (pk, username, first_name, user_type, email_address, record_status, session_version)
        OVERRIDING SYSTEM VALUE
        VALUES (9111, 'td-canceller', 'TD Canceller', 'TD Canceller', 'td-canceller@example.invalid', 'ACTIVE', ${SV})
        ON CONFLICT (pk) DO UPDATE SET username = excluded.username, first_name = excluded.first_name,
          user_type = excluded.user_type, email_address = excluded.email_address, record_status = 'ACTIVE',
          session_version = excluded.session_version, last_login = DEFAULT`);
    const r = await del('sale_orders', 'TDSORDEL', { email: 'td-canceller@example.invalid' });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    const { rows } = await pool.query(`SELECT record_status AS rs FROM sale_order WHERE sale_order_no = 'TDSORDEL'`);
    assert.equal(rows[0].rs, 'ACTIVE');
    assert.equal((await del('sale_orders', 'TDSORDEL')).status, 200); // System Admin
    // its creator cancels it with Sale Order edit alone (no delete right — the TD Seller role)
    await pool.query(`DELETE FROM sale_order WHERE sale_order_no = 'TDSORDEL2';
      INSERT INTO sale_order (sale_order_no, approve_status_id, created_by_app_user_pk, record_status)
        VALUES ('TDSORDEL2', 1, 9107, 'ACTIVE')`);
    const own = await del('sale_orders', 'TDSORDEL2', { email: 'td-seller@example.invalid' });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    // a second cancel (another person, a stale page) is refused — the first one's who / why stay
    const again = await del('sale_orders', 'TDSORDEL2', undefined, 'DELETED', 'ทับเหตุผล');
    assert.equal(again.status, 409, JSON.stringify(again.body));
    const { rows: kept } = await pool.query(
      `SELECT document_cancel_remark AS r, cancelled_by_app_user_pk::int AS b FROM sale_order WHERE sale_order_no = 'TDSORDEL2'`,
    );
    assert.deepEqual(kept[0], { r: 'TD เหตุผล', b: 9107 });
    // the detail carries the reason; the list / export read ยกเลิก, not the last approval step
    const got = await call(
      `/api/sale-orders/${await uuidOf(`SELECT id::text AS id FROM sale_order WHERE sale_order_no = 'TDSORDEL2'`)}`,
    );
    const order = got.body.order as { cancelRemark: string; approve: string };
    assert.deepEqual([order.cancelRemark, order.approve], ['TD เหตุผล', 'ยกเลิก']);
  });
  // only System Admin restores a deleted customer (the delete dialog says so)
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
    // the last run's receipt line points at the part (its header stays, empty)
    await pool.query(`DELETE FROM stock_move_line WHERE product_pk = 9298;
      DELETE FROM product_stock WHERE product_pk = 9298 OR pk = 9298; DELETE FROM product WHERE pk = 9298;
      INSERT INTO product (pk, product_code, product_name, record_status) OVERRIDING SYSTEM VALUE
        VALUES (9298, 'TDPRCV', 'TD ปิดใช้งาน', 'INACTIVE');
      INSERT INTO product_stock (pk, product_pk, quantity_available, quantity_used, quantity_booking, quantity_remain)
        OVERRIDING SYSTEM VALUE VALUES (9298, 9298, 0, 0, 0, 0)`);
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
    await pool.query(`DELETE FROM sale_order WHERE sale_order_no = 'TDSORDEL3';
      INSERT INTO sale_order (sale_order_no, approve_status_id, created_by_app_user_pk, record_status)
        VALUES ('TDSORDEL3', 1, 9107, 'ACTIVE')`);
    for (const remark of ['', '   ']) {
      const r = await del('sale_orders', 'TDSORDEL3', undefined, 'DELETED', remark);
      assert.equal(r.status, 400, JSON.stringify(r.body));
    }
    const { rows } = await pool.query(`SELECT record_status AS rs FROM sale_order WHERE sale_order_no = 'TDSORDEL3'`);
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
  await test('every change left its audit trail (audit_log / security_log rows naming who, the request and the row)', () => {
    assert.deepEqual(trailProblems, []);
    return Promise.resolve();
  });
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
