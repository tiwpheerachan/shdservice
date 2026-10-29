/**
 * scripts/test-qa-race-routes.mts — route races from the race audit (2026-10-21): a create sent 5× with one
 * Idempotency-Key (products G2, call log G3), the single export slot freed by the export before it (G7), uploads
 * that orphaned the file they replaced (G8), two track links issued at once (G11), two default document profiles /
 * a default deleted / a deleted profile assigned (G5), two admins saving the same profile form (G10).
 * Requests run concurrently (Promise.all); where the order matters a second DB session (`blocker()`) pins one
 * request between its check and its write, so each race is deterministic, not a timing lottery.
 *
 * TEST_DATABASE_URL=… API_CONTRACT_STRICT=1 NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-qa-race-routes.mts
 * Seeds its own fixtures (user 9870, jobs / products / profiles QRR*) and resets them at every start.
 * Storage is a fake Supabase Storage behind globalThis.fetch (a Set of paths, slow upload). ONLY a local *_test DB.
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';

assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
const STORAGE = 'http://storage.qrr.test';
Object.assign(process.env, {
  SESSION_SECRET: 'unit-test-session-secret-0123456789abcdef',
  APP_BASE_URL: 'https://svc.example.test',
  NEXT_PUBLIC_SUPABASE_URL: STORAGE,
  SUPABASE_SECRET_KEY: 'qrr-fake-key',
  DB_POOL_MAX: '20',
});

/* ---- fake storage: a Set of paths, every upload takes 100 ms (two at once overlap) ---- */
const stored = new Set<string>();
const { BUCKET } = await import('@/server/storage');
const objects = `${STORAGE}/storage/v1/object/${BUCKET}`;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = init?.method ?? 'GET';
  if (url === `${STORAGE}/storage/v1/bucket`) return Response.json({ name: BUCKET });
  if (method === 'POST' && url.startsWith(`${objects}/`)) {
    await new Promise((r) => setTimeout(r, 100));
    const path = decodeURIComponent(url.slice(objects.length + 1));
    stored.add(path);
    return Response.json({ Key: `${BUCKET}/${path}` });
  }
  if (method === 'DELETE' && url === objects) {
    for (const p of (JSON.parse(String(init?.body)) as { prefixes: string[] }).prefixes) stored.delete(p);
    return Response.json([]);
  }
  return new Response('', { status: 404 });
}) as typeof fetch;

const { pool } = await import('@/db/client');
const { HttpError } = await import('@/server/auth');
const { signSession, SESSION_COOKIE } = await import('@/lib/session');
const { jobNoForLink } = await import('@/server/services/tracking');
const { exportXlsx } = await import('@/server/export');
const { deleteDocumentProfile, setDocumentProfile } = await import('@/server/services/document-profiles');
const products = await import('@/app/api/products/route');
const calls = await import('@/app/api/jobs/[id]/calls/route');
const trackLink = await import('@/app/api/jobs/[id]/track-link/route');
const upload = await import('@/app/api/upload/route');
const docProfiles = await import('@/app/api/admin/document-profiles/route');
const shipProfiles = await import('@/app/api/admin/shipping-profiles/route');

const SV = 3;
const ADMIN = { id: 9870, email: 'qrr-admin@example.invalid' };
const ADMIN2 = { id: 9871, email: 'qrr-admin2@example.invalid' };
const J = (n: number) => `QRR${String(n).padStart(4, '0')}`;
const PART = 'QRRP1';
const Q = async <T = Record<string, unknown>,>(text: string, params: unknown[] = []) =>
  (await pool.query(text, params)).rows as T[];
/** a job's uuid — its API path (ADR 0008) */
const jobIdOf = async (no: string) =>
  (await Q<{ id: string }>('SELECT id::text AS id FROM job WHERE job_no = $1', [no]))[0]!.id;

await pool.query(`
  INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
    SELECT 2, 'กำลังดำเนินการ', 2, 'Open', true WHERE NOT EXISTS (SELECT 1 FROM job_status WHERE job_status_id = 2);
  DELETE FROM job_call_log WHERE job_no LIKE 'QRR%';
  DELETE FROM job_log WHERE job_no LIKE 'QRR%';
  DELETE FROM job WHERE job_no LIKE 'QRR%';
  DELETE FROM app_user WHERE user_id IN (${ADMIN.id}, ${ADMIN2.id}) OR email_address LIKE 'qrr-%@example.invalid';
  INSERT INTO app_user (user_id, first_name, last_name, email_address, user_type, record_status, session_version)
    VALUES (${ADMIN.id}, 'QRR', 'admin', '${ADMIN.email}', 'System Admin', 'ACTIVE', ${SV}),
           (${ADMIN2.id}, 'QRR', 'admin2', '${ADMIN2.email}', 'System Admin', 'ACTIVE', ${SV});
  INSERT INTO job (job_no, job_status_id, customer_detail, product_model_name, job_create_date, job_reception_date, record_status)
    SELECT 'QRR' || lpad(n::text, 4, '0'), 2, 'ลูกค้า QRR', 'Model QRR', now(), current_date, 'ACTIVE' FROM generate_series(1, 9) n;
  DELETE FROM product_none_serial WHERE product_id IN (SELECT product_id FROM product WHERE product_code = '${PART}' OR product_name LIKE 'QRR %');
  DELETE FROM product WHERE product_code = '${PART}' OR product_name LIKE 'QRR %';
  INSERT INTO product (product_id, product_code, product_name, record_status, pictrue_file_name) VALUES (9870, '${PART}', 'อะไหล่ QRR', 'ACTIVE', '');
  DELETE FROM document_profile WHERE code LIKE 'QRR%';
  DELETE FROM shipping_profile WHERE code LIKE 'QRR%';
  UPDATE document_profile SET is_default = false WHERE pk <> 1;
  UPDATE document_profile SET is_default = true, is_active = true, deleted_at = NULL WHERE pk = 1;
`);

// ---- helpers ----
type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: NextRequest, ctx: Ctx) => Promise<Response>;
type Init = { method?: string; body?: unknown; form?: FormData; headers?: Record<string, string>; as?: string };
async function request(url: string, init: Init = {}) {
  const now = Date.now();
  const cookie = `${SESSION_COOKIE}=${await signSession({ email: init.as ?? ADMIN.email, name: 'qrr', exp: now + 600_000, iat: now, sv: SV })}`;
  return new NextRequest(`https://svc.example.test${url}`, {
    method: init.method ?? 'GET',
    headers: {
      'user-agent': 'test-qa-race-routes',
      host: 'svc.example.test',
      cookie,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}
async function call(h: unknown, url: string, init: Init = {}, params: Record<string, string> = {}) {
  const res = await (h as Handler)(await request(url, init), { params: Promise.resolve(params) });
  const body = (res.headers.get('content-type') ?? '').includes('json')
    ? ((await res.json()) as Record<string, unknown>)
    : {};
  return { status: res.status, body };
}
const fire = <T,>(n: number, f: () => Promise<T>) => Promise.all(Array.from({ length: n }, f));
const statuses = (rs: { status: number }[]) => rs.map((r) => r.status).sort((a, b) => a - b);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** a separate connection, outside the app's pool — the "other session" that holds a lock */
async function blocker() {
  const c = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await c.connect();
  await c.query('BEGIN');
  return c;
}
/** the HTTP status a service call ends with (200 = resolved) */
const status = (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: unknown) => {
      if (e instanceof HttpError) return e.status;
      throw e;
    },
  );
const png = async (c: string) =>
  new Uint8Array(
    await sharp({ create: { width: 8, height: 8, channels: 3, background: c } })
      .png()
      .toBuffer(),
  );
async function uploadImage(kind: string, id: string | number, color: string) {
  const f = new FormData();
  f.set('kind', kind);
  f.set('id', String(id));
  f.set('file', new File([await png(color)], 'x.png', { type: 'image/png' }));
  return call(upload.POST, '/api/upload', { method: 'POST', form: f });
}
const saveDocProfile = (body: Record<string, unknown>) =>
  call(docProfiles.POST, '/api/admin/document-profiles', { method: 'POST', body });
const liveDefaults = async () =>
  (
    await Q<{ code: string }>(`SELECT code FROM document_profile WHERE is_default AND deleted_at IS NULL ORDER BY pk`)
  ).map((r) => r.code);

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

try {
  console.log('\n1 · one Idempotency-Key, 5 requests at once → one record');
  await test('G2 POST /api/products ×5 (create, one key) → one product', async () => {
    const name = `QRR part ${Date.now()}`;
    const rs = await fire(5, () =>
      call(products.POST, '/api/products', {
        method: 'POST',
        body: { name },
        headers: { 'Idempotency-Key': `qrr-p-${name}` },
      }),
    );
    const rows = await Q(`SELECT product_code FROM product WHERE product_name = $1`, [name]);
    assert.equal(rows.length, 1, `statuses ${statuses(rs)}`);
    assert.ok(
      rs.every((r) => r.status === 200 || r.status === 409),
      `statuses ${statuses(rs)}`,
    );
  });
  await test('G3 POST /api/jobs/{no}/calls ×5 (one key) → one call-log line', async () => {
    const detail = `QRR call ${Date.now()}`;
    const j1 = await jobIdOf(J(1));
    const rs = await fire(5, () =>
      call(
        calls.POST,
        `/api/jobs/${j1}/calls`,
        { method: 'POST', body: { detail }, headers: { 'Idempotency-Key': `qrr-c-${detail}` } },
        { id: j1 },
      ),
    );
    const [{ n }] = await Q<{ n: number }>(`SELECT count(*)::int n FROM job_call_log WHERE call_log_description = $1`, [
      detail,
    ]);
    assert.equal(n, 1, `statuses ${statuses(rs)}`);
  });

  console.log('\n2 · two track links issued at once (G11)');
  await test('the job\'s first link: one "first link" audit line, the other logged as a new link (old one dead)', async () => {
    const [{ mark }] = await Q<{ mark: number }>(`SELECT coalesce(max(pk), 0)::int mark FROM audit_log`);
    for (const no of [J(2), J(3), J(4)]) {
      const id = await jobIdOf(no);
      const rs = await fire(2, () => call(trackLink.POST, `/api/jobs/${id}/track-link`, { method: 'POST' }, { id }));
      assert.deepEqual(statuses(rs), [200, 200]);
      const live = await Promise.all(
        rs.map(async (r) => (await jobNoForLink(String(r.body.url).split('/track/')[1] ?? '')) !== null),
      );
      assert.equal(live.filter(Boolean).length, 1, 'the later link works, the earlier one is dead');
      const audits = await Q<{ s: string }>(
        `SELECT summary s FROM audit_log WHERE entity = 'job' AND entity_key = $1 AND pk > $2 ORDER BY pk`,
        [no, mark],
      );
      assert.deepEqual(
        audits.map((a) => (/ใหม่/.test(a.s) ? 'new' : 'first')),
        ['first', 'new'],
        audits.map((a) => a.s).join(' | '),
      );
    }
  });

  await test('each answer carries its own link id; the status read (GET) matches only the live one', async () => {
    for (const no of [J(6), J(7), J(8)]) {
      const id = await jobIdOf(no);
      // same second on purpose: issue times compare equal, the ids must not
      const rs = await fire(2, () => call(trackLink.POST, `/api/jobs/${id}/track-link`, { method: 'POST' }, { id }));
      const ids = rs.map((r) => (r.body.status as { id?: string }).id);
      assert.ok(
        ids.every((id) => typeof id === 'string' && id.length > 0),
        `ids ${ids}`,
      );
      assert.notEqual(ids[0], ids[1], 'two issues → two ids');
      const now = (await call(trackLink.GET, `/api/jobs/${id}/track-link`, {}, { id })).body.status as { id: string };
      const live = await Promise.all(
        rs.map(async (r) => (await jobNoForLink(String(r.body.url).split('/track/')[1] ?? '')) !== null),
      );
      assert.deepEqual(
        ids.map((id) => id === now.id),
        live,
        "the GET id is the live link's",
      );
    }
  });

  console.log('\n3 · two uploads replacing the same picture at once leave no orphan (G8)');
  {
    // profiles by their uuid (ADR 0008) — a new logo goes under profiles/{uuid}/
    const [{ id: shipperId }] = await Q<{ id: string }>(
      `INSERT INTO shipping_profile (code, name_th, name_en, track_url, sort_order) VALUES ('QRRSHIP', 'ขนส่ง QRR', '', '', 99) RETURNING id::text AS id`,
    );
    const mk = await saveDocProfile({ code: 'QRRLOGO', nameTh: 'QRR โลโก้' });
    const docId = (mk.body.row as { id: string }).id;
    for (const [kind, id, prefix] of [
      ['profile-logo', docId, `profiles/${docId}/`],
      ['shipper-logo', shipperId, `shippers/${shipperId}/`],
      ['product-image', PART, `products/${PART}/`],
    ] as const) {
      await test(`${kind} ×2 at once (over a stored one) → storage holds exactly the file the row names`, async () => {
        const first = await uploadImage(kind, id, '#000');
        assert.equal(first.status, 200, JSON.stringify(first.body));
        const rs = await Promise.all([uploadImage(kind, id, '#f00'), uploadImage(kind, id, '#0f0')]);
        assert.deepEqual(statuses(rs), [200, 200]);
        const [{ p }] =
          kind === 'profile-logo'
            ? await Q<{ p: string }>(`SELECT logo_path p FROM document_profile WHERE id = $1`, [id])
            : kind === 'shipper-logo'
              ? await Q<{ p: string }>(`SELECT logo_path p FROM shipping_profile WHERE id = $1`, [id])
              : await Q<{ p: string }>(
                  `SELECT 'products/${PART}/' || pictrue_file_name p FROM product WHERE product_code = $1`,
                  [id],
                );
        assert.deepEqual(
          [...stored].filter((s) => s.startsWith(prefix)),
          [p],
        );
      });
    }
  }

  console.log('\n4 · the single export slot (G7)');
  await test("an export's own release never frees the slot another export took — a 3rd one meanwhile → 429", async () => {
    const drain = async (s: ReadableStream<Uint8Array>) => {
      const r = s.getReader();
      while (!(await r.read()).done);
    };
    /** 'running' = still pending after `ms` (past the slot check, waiting in loadRows), else its status */
    const probe = (p: Promise<unknown>, ms: number) =>
      Promise.race([status(p), sleep(ms).then(() => 'running' as const)]);
    const b = await blocker();
    await b.query('LOCK TABLE job IN ACCESS EXCLUSIVE MODE'); // export B (jobs) waits in loadRows, holding the slot
    let B: Promise<{ stream: ReadableStream<Uint8Array> }> | null = null;
    let C: Promise<{ stream: ReadableStream<Uint8Array> }> | null = null;
    try {
      const A = await exportXlsx(await request('/api/export/customers'), 'customers', {});
      // B retried until the slot is free (A frees it once its rows are written, before its zip is finished)
      for (let tries = 0; !B && tries < 100; tries++) {
        const p = exportXlsx(await request('/api/export/jobs'), 'jobs', {});
        const s = await probe(p, 150);
        if (s === 'running') B = p;
        else assert.equal(s, 429);
      }
      assert.ok(B, 'B never got the slot');
      await drain(A.stream); // A finishes: its 'close' and .finally run while B holds the slot
      await sleep(100);
      C = exportXlsx(await request('/api/export/customers'), 'customers', {});
      assert.equal(await probe(C, 2000), 429, 'B still runs — C must wait');
    } finally {
      await b.query('COMMIT');
      await b.end();
      if (B) await drain((await B).stream);
      if (C) await C.then((c) => drain(c.stream)).catch(() => undefined);
    }
  });
  await test('a user over the limit never holds the slot: another user exporting at that moment is not told busy', async () => {
    const drain = async (s: ReadableStream<Uint8Array>) => {
      const r = s.getReader();
      while (!(await r.read()).done);
    };
    const as2 = { as: ADMIN2.email };
    for (let i = 0; i < 5; i++)
      await drain((await exportXlsx(await request('/api/export/customers', as2), 'customers', {})).stream);
    const [over, other] = [await request('/api/export/customers', as2), await request('/api/export/customers')];
    const [o, a] = await Promise.allSettled([exportXlsx(over, 'customers', {}), exportXlsx(other, 'customers', {})]);
    assert.equal(o.status, 'rejected');
    assert.match(String((o as PromiseRejectedResult).reason?.message), /เรียกใช้งานถี่เกินไป/);
    assert.equal(a.status, 'fulfilled', `other user: ${(a as PromiseRejectedResult).reason?.message}`);
    await drain((a as PromiseFulfilledResult<{ stream: ReadableStream<Uint8Array> }>).value.stream);
  });

  console.log('\n5 · document profiles: exactly one default (G5)');
  await test('two new profiles saved as default at once → one default', async () => {
    const rs = await Promise.all([
      saveDocProfile({ code: 'QRRDEFA', nameTh: 'QRR A', isDefault: true }),
      saveDocProfile({ code: 'QRRDEFB', nameTh: 'QRR B', isDefault: true }),
    ]);
    assert.deepEqual(statuses(rs), [200, 200]);
    assert.equal((await liveDefaults()).length, 1, `defaults: ${await liveDefaults()}`);
  });
  await test('a profile deleted while it is being made the default → still exactly one live default', async () => {
    const mk = await saveDocProfile({ code: 'QRRDEL', nameTh: 'QRR ลบ' });
    const row = mk.body.row as Record<string, unknown>;
    const b = await blocker();
    await b.query('SELECT 1 FROM document_profile WHERE id = $1 FOR UPDATE', [row.id]); // both writes wait on it
    const save = saveDocProfile({ ...row, isDefault: true });
    const del = status(deleteDocumentProfile(String(row.id), ADMIN.id));
    await sleep(300);
    await b.query('COMMIT');
    await b.end();
    const [s, d] = [(await save).status, await del];
    const live = await liveDefaults();
    assert.equal(live.length, 1, `save ${s}, delete ${d} → live defaults: ${live}`);
  });
  await test('a profile deleted while a job is being moved to it → the move does not commit after the delete', async () => {
    const mk = await saveDocProfile({ code: 'QRRSET', nameTh: 'QRR ย้าย' });
    const pid = (mk.body.row as { id: string }).id;
    const b = await blocker();
    await b.query('SELECT 1 FROM job WHERE job_no = $1 FOR UPDATE', [J(5)]); // the move waits at its write
    const order: string[] = [];
    const set = status(setDocumentProfile('job', J(5), pid, ADMIN.id)).then((s) => (order.push('set'), s));
    await sleep(100);
    const del = status(deleteDocumentProfile(pid, ADMIN.id)).then((s) => (order.push('delete'), s));
    await sleep(300);
    await b.query('COMMIT');
    await b.end();
    const [s, d] = [await set, await del];
    assert.ok(!(order[0] === 'delete' && s === 200), `delete ${d} finished first, then the move answered ${s}`);
  });

  console.log('\n6 · two admins save the same loaded form (G10)');
  await test('document profile: one save wins, the other → 409 stale; nothing lost silently', async () => {
    const mk = await saveDocProfile({ code: 'QRRLOST', nameTh: 'QRR แก้', phone: '02-111-1111', nameEn: 'Old EN' });
    const loaded = mk.body.row as Record<string, unknown>;
    const rs = await Promise.all([
      saveDocProfile({ ...loaded, phone: '02-222-2222', expect: loaded }),
      saveDocProfile({ ...loaded, nameEn: 'New EN', expect: loaded }),
    ]);
    assert.deepEqual(statuses(rs), [200, 409]);
    assert.equal((rs.find((r) => r.status === 409)!.body.details as { stale?: boolean }).stale, true);
    const [row] = await Q<{ phone: string; en: string }>(
      `SELECT phone, name_en en FROM document_profile WHERE id = $1`,
      [loaded.id],
    );
    assert.ok((row.phone === '02-222-2222') !== (row.en === 'New EN'), JSON.stringify(row));
  });
  await test('shipping profile: one save wins, the other → 409 stale', async () => {
    const save = (body: Record<string, unknown>) =>
      call(shipProfiles.POST, '/api/admin/shipping-profiles', { method: 'POST', body });
    const mk = await save({ code: 'QRRLOST', nameTh: 'QRR ขนส่ง', nameEn: 'Old', trackUrl: 'https://t.example/{no}' });
    const loaded = mk.body.row as Record<string, unknown>;
    const rs = await Promise.all([
      save({ ...loaded, nameTh: 'QRR ขนส่ง ใหม่', expect: loaded }),
      save({ ...loaded, nameEn: 'New', expect: loaded }),
    ]);
    assert.deepEqual(statuses(rs), [200, 409]);
    assert.equal((rs.find((r) => r.status === 409)!.body.details as { stale?: boolean }).stale, true);
  });
} finally {
  await pool.query(`
    UPDATE job SET document_profile_id = NULL WHERE job_no LIKE 'QRR%';
    UPDATE document_profile SET is_default = false WHERE pk <> 1;
    UPDATE document_profile SET is_default = true WHERE pk = 1;
    UPDATE document_profile SET deleted_at = coalesce(deleted_at, now()::timestamp) WHERE code LIKE 'QRR%';
  `);
  await pool.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
