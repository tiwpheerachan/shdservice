/**
 * npm run test:track (scripts/test-track.mts) — security tests for the public tracking flow (spec §AQ / §AR).
 *
 * Runs ONLY against the throwaway local test database (tests/docker-compose.yml, migrated by
 * tests/prepare-db.mts) — never .env's DATABASE_URL. tests/seed.mts wipes and re-creates the
 * fixture jobs / customers / quotations and the tracking tables first, so the run may change
 * job rows (fresh links, link timestamps) and leaves its rows behind for inspection.
 * Every request uses a TEST-NET IP (203.0.113.0/24). Cloudflare Siteverify and ThaiBulkSMS are
 * mocked; nothing leaves the machine except queries to the local DB.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { TEST_DATABASE_URL, assertLocal } from '../tests/db-url.mts';
import { seed } from '../tests/seed.mts';

// the app modules read DATABASE_URL when they are imported (below) — point it at the test DB first
assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;

// ---- test environment (read at call time by the modules below) ----
const ORIGIN_SECRET = 'test-origin-secret-' + Math.random().toString(36).slice(2);
Object.assign(process.env, {
  ORIGIN_AUTH_MODE: 'enforce',
  ORIGIN_AUTH_SECRET: ORIGIN_SECRET,
  TURNSTILE_SECRET_KEY: 'unit-test-secret',
  APP_BASE_URL: 'https://svc.example.test',
  TRACK_LOG_SECRET: 'unit-test-log-secret',
  SESSION_SECRET: 'unit-test-session-secret-0123456789abcdef', // ≥ 32 chars
  SMS_PROVIDER: 'log', // OTP goes to the log — captured below, like a developer reading it
});

// Siteverify mock: the Turnstile token decides the answer
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith('https://otp.thaibulksms.com/')) return otpProviderMock(url, init);
  if (!url.includes('challenges.cloudflare.com')) return realFetch(input, init);
  const token = new URLSearchParams(String(init?.body ?? '')).get('response') ?? '';
  const reply = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  switch (token) {
    case 'good':
      return reply({ success: true, hostname: 'svc.example.test', action: 'track' });
    case 'bad':
      return reply({ success: false, 'error-codes': ['invalid-input-response'] });
    case 'wrong-host':
      return reply({ success: true, hostname: 'evil.example', action: 'track' });
    case 'wrong-action':
      return reply({ success: true, hostname: 'svc.example.test', action: 'login' });
    case 'http-500':
      return reply({}, 500);
    case 'malformed':
      return new Response('<html>', { status: 200 });
    case 'timeout':
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    default:
      return reply({ success: false });
  }
}) as typeof fetch;

// ThaiBulkSMS OTP service mock (used once SMS_PROVIDER=thaibulksms below): records every call;
// msisdn "0900000000" = the send fails; pin "2468" is the right code; token "tok-down" = service down
const OTP_KEY = '1234567890123';
const OTP_SECRET = 'unit-test-otp-secret';
const RIGHT_PIN = '2468';
const providerCalls: { path: string; f: Record<string, string> }[] = [];
let tokenSeq = 0;
function otpProviderMock(url: string, init?: RequestInit) {
  const path = url.replace('https://otp.thaibulksms.com', '');
  const f = Object.fromEntries(new URLSearchParams(String(init?.body ?? '')));
  providerCalls.push({ path, f });
  const reply = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (f.key !== OTP_KEY || f.secret !== OTP_SECRET)
    return reply({ code: 400, errors: [{ detail: [], message: 'Application not found.' }] }, 400);
  if (path === '/v2/otp/request') {
    if (f.msisdn === '0900000000')
      return reply(
        { code: 400, errors: [{ detail: 'ERROR_MSISDN', message: 'Gateway response send sms fail.' }] },
        400,
      );
    return reply({ status: 'success', token: `tok-${++tokenSeq}-${'x'.repeat(24)}`, refno: 'AB12C' });
  }
  if (path === '/v2/otp/verify') {
    if (f.token === 'tok-down') return reply({}, 503);
    return f.pin === RIGHT_PIN
      ? reply({ status: 'success', message: 'Code is correct.' })
      : reply({ code: 400, errors: [{ detail: [], message: 'Code is invalid.' }] }, 400);
  }
  return reply({}, 404);
}

const { db, pool } = await import('@/db/client');
await seed(pool);
const guard = await import('@/server/track-guard');
const { TRACK_MSG } = await import('@/lib/track-public');
const { clientIp } = await import('@/lib/client-ip');
const { originAuthOk } = await import('@/lib/origin-auth');
const { jobNoForLink, publicJobByNo, rotateToken, ensureToken, linkStatus, findDoc, docForLink } =
  await import('@/server/services/tracking');
const S = await import('@/lib/session');
const { POST: sessionPOST } = await import('@/app/api/track/session/route');
const { POST: dataPOST } = await import('@/app/api/track/data/route');
const { POST: otpRequestPOST } = await import('@/app/api/track/otp/request/route');
const { POST: otpVerifyPOST } = await import('@/app/api/track/otp/verify/route');
const { GET: meGET, DELETE: meDELETE } = await import('@/app/api/track/me/route');
const { POST: keepalivePOST } = await import('@/app/api/track/me/keepalive/route');
const { GET: meJobGET } = await import('@/app/api/track/me/jobs/[no]/route');
const { POST: linkKeepalivePOST } = await import('@/app/api/track/link/keepalive/route');
const { POST: docPOST } = await import('@/app/api/track/doc/route');

// capture "[sms:log] to 08…: … 123456 …" instead of sending an SMS
const smsLog: { to: string; text: string }[] = [];
const realLog = console.log;
console.log = (...a: unknown[]) => {
  const m = String(a[0] ?? '').match(/^\[sms:log\] to (\d+): (.*)$/s);
  if (m) smsLog.push({ to: m[1], text: m[2] });
  else realLog(...a);
};
const lastOtp = () => smsLog.at(-1)?.text.match(/\b(\d{4})\b/)?.[1] ?? '';
const otpHeaders = (ip: string, ua = UA, session?: string) => {
  const h: Record<string, string> = {
    'content-type': 'application/json',
    'cf-connecting-ip': ip,
    'user-agent': ua,
    'x-origin-auth': ORIGIN_SECRET,
  };
  if (session) h['x-track-session'] = session;
  return h;
};
async function otpReq(phone: string, ip: string, turnstileToken = 'good') {
  usedIps.push(ip);
  const r = await otpRequestPOST(
    new NextRequest('https://svc.example.test/api/track/otp/request', {
      method: 'POST',
      headers: otpHeaders(ip),
      body: JSON.stringify({ phone, turnstileToken }),
    }),
  );
  return {
    status: r.status,
    json: (await r.json()) as { ok: boolean; requestId?: string; masked?: string; error?: string },
  };
}
async function otpVerify(requestId: string, code: string, ip: string, ua = UA) {
  usedIps.push(ip);
  const r = await otpVerifyPOST(
    new NextRequest('https://svc.example.test/api/track/otp/verify', {
      method: 'POST',
      headers: otpHeaders(ip, ua),
      body: JSON.stringify({ requestId, code }),
    }),
  );
  return {
    status: r.status,
    json: (await r.json()) as { ok: boolean; session?: string; expiresAt?: string; error?: string },
  };
}
async function me(session: string, ip: string, ua = UA) {
  usedIps.push(ip);
  const r = await meGET(
    new NextRequest('https://svc.example.test/api/track/me', { headers: otpHeaders(ip, ua, session) }),
  );
  return {
    status: r.status,
    json: (await r.json()) as {
      ok: boolean;
      active?: { no: string }[];
      history?: { no: string }[];
      expiresAt?: string;
    },
  };
}

// ---- helpers ----
let ipSeq = 10;
const nextIp = () => `203.0.113.${ipSeq++}`;
const usedIps: string[] = [];
const UA = 'Mozilla/5.0 (test-track) Chrome/140';

function req(
  path: string,
  body: unknown,
  ip: string,
  opts: { ua?: string; origin?: string | null; cookie?: string } = {},
) {
  usedIps.push(ip);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'cf-connecting-ip': ip,
    'user-agent': opts.ua ?? UA,
  };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin !== null) headers['x-origin-auth'] = opts.origin ?? ORIGIN_SECRET;
  return new NextRequest(`https://svc.example.test${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
async function session(body: unknown, ip: string, ua?: string) {
  const r = await sessionPOST(req('/api/track/session', body, ip, { ua }));
  return {
    status: r.status,
    cache: r.headers.get('cache-control'),
    json: (await r.json()) as { ok: boolean; ticket?: string; error?: string },
  };
}
async function data(body: unknown, ip: string, ua?: string) {
  const r = await dataPOST(req('/api/track/data', body, ip, { ua }));
  return {
    status: r.status,
    cache: r.headers.get('cache-control'),
    json: (await r.json()) as { ok: boolean; job?: Record<string, unknown>; error?: string },
  };
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
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : e}`);
  }
}

// the two seeded open jobs, with fresh links (links live 1 day unopened / 15 min after opening, drizzle/0016)
const pick = await db.execute<{ job_no: string }>(sql`
  SELECT j.job_no FROM job j JOIN job_status s ON s.job_status_id = j.job_status_id
   WHERE j.record_status <> 'DELETED' AND s.job_status_group NOT IN ('Finished','Cancel')
   ORDER BY j.job_create_date DESC LIMIT 2`);
assert.ok(pick.rows.length === 2, 'need two open jobs in the DB (tests/seed.mts)');
const JOB_A = { job_no: pick.rows[0].job_no, track_token: (await rotateToken(pick.rows[0].job_no)).token };
const JOB_B = { job_no: pick.rows[1].job_no, track_token: (await rotateToken(pick.rows[1].job_no)).token };
const tempEmail = `track-test-${Date.now()}@example.invalid`;
/** HMACs of the two test phone numbers (their rate counters are cleared between tests) */
let phoneHashes: string[] = [];
try {
  const PUBLIC_KEYS = [
    'no',
    'customerMasked',
    'brandModel',
    'deviceRef',
    'receivedDate',
    'dueDate',
    'step',
    'stepLabel',
    'cancelled',
    'history',
    'shipper',
    'trackingNo',
    'closedDate',
    'courier',
    'docs',
  ].sort();

  console.log('\nOrigin protection / trusted IP');
  await test('request without X-Origin-Auth is not trusted (Direct Origin Attack)', async () => {
    const h = new Headers({ 'cf-connecting-ip': '198.51.100.7' });
    assert.equal(originAuthOk(h), false);
    assert.equal(clientIp(h), '0.0.0.0', 'spoofed CF-Connecting-IP must not be used');
  });
  await test('wrong X-Origin-Auth is not trusted', async () => {
    const h = new Headers({ 'x-origin-auth': ORIGIN_SECRET + 'x', 'cf-connecting-ip': '198.51.100.7' });
    assert.equal(originAuthOk(h), false);
  });
  await test('valid X-Origin-Auth → CF-Connecting-IP trusted, X-Forwarded-For ignored', async () => {
    const h = new Headers({
      'x-origin-auth': ORIGIN_SECRET,
      'cf-connecting-ip': '198.51.100.7',
      'x-forwarded-for': '1.2.3.4',
    });
    assert.equal(clientIp(h), '198.51.100.7');
  });

  console.log('\nTurnstile (fail closed)');
  for (const [token, expect] of [
    ['good', 'ok'],
    ['bad', 'fail'],
    ['wrong-host', 'fail'],
    ['wrong-action', 'fail'],
    ['http-500', 'unavailable'],
    ['malformed', 'unavailable'],
    ['timeout', 'unavailable'],
    ['', 'fail'],
  ] as const) {
    await test(`siteverify "${token || '(empty)'}" → ${expect}`, async () => {
      assert.equal(await guard.verifyTurnstile(token, '203.0.113.1'), expect);
    });
  }
  await test("Cloudflare's real test secrets are recognised (dev only)", async () => {
    for (const s of [
      '1x0000000000000000000000000000000AA',
      '2x0000000000000000000000000000000AA',
      '3x0000000000000000000000000000000AA',
    ]) {
      assert.ok(guard.TEST_SECRET.test(s), s);
    }
    assert.ok(!guard.TEST_SECRET.test('unit-test-secret'));
    // a test secret in production is refused outright (never trusted, never sent)
    const s = process.env.TURNSTILE_SECRET_KEY;
    const envAny = process.env as Record<string, string | undefined>;
    const nodeEnv = envAny.NODE_ENV;
    envAny.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    envAny.NODE_ENV = 'production';
    try {
      assert.equal(await guard.verifyTurnstile('XXXX.DUMMY.TOKEN.XXXX', '203.0.113.1'), 'unavailable');
    } finally {
      envAny.TURNSTILE_SECRET_KEY = s;
      envAny.NODE_ENV = nodeEnv;
    }
  });
  await test('no secret configured → unavailable (no ticket)', async () => {
    const s = process.env.TURNSTILE_SECRET_KEY;
    process.env.TURNSTILE_SECRET_KEY = '';
    try {
      assert.equal(await guard.verifyTurnstile('good', '203.0.113.1'), 'unavailable');
    } finally {
      process.env.TURNSTILE_SECRET_KEY = s;
    }
  });
  for (const t of ['bad', 'wrong-host', 'wrong-action', 'timeout']) {
    await test(`session with Turnstile "${t}" issues no ticket (Captcha Bypass Attempt)`, async () => {
      const r = await session({ linkToken: JOB_A.track_token, turnstileToken: t }, nextIp());
      assert.equal(r.json.ok, false);
      assert.equal(r.json.ticket, undefined);
      assert.equal(r.cache, 'no-store');
    });
  }

  console.log('\nLink resolution (Token Enumeration)');
  await test('valid link → job', async () => assert.equal(await jobNoForLink(JOB_A.track_token), JOB_A.job_no));
  await test('unknown / malformed link → null', async () => {
    assert.equal(await jobNoForLink('A'.repeat(43)), null);
    assert.equal(await jobNoForLink('short'), null);
  });
  await test("unknown link → 'link' hint (410), same body as an expired one — never says which", async () => {
    const unknown = await session({ linkToken: 'B'.repeat(43), turnstileToken: 'good' }, nextIp());
    await db.execute(
      sql`UPDATE job SET track_opened_at = now() - interval '16 minutes' WHERE job_no = ${JOB_B.job_no}`,
    );
    const expired = await session({ linkToken: JOB_B.track_token, turnstileToken: 'good' }, nextIp());
    await db.execute(sql`UPDATE job SET track_opened_at = NULL WHERE job_no = ${JOB_B.job_no}`);
    assert.equal(unknown.status, 410);
    assert.deepEqual(unknown.json, expired.json);
    assert.equal((unknown.json as { reason?: string }).reason, 'link');
  });
  await test('captcha failure is NOT reported as a link problem', async () => {
    const cap = await session({ linkToken: JOB_A.track_token, turnstileToken: 'bad' }, nextIp());
    assert.equal(cap.status, 403);
    assert.equal((cap.json as { reason?: string }).reason, undefined);
  });

  console.log('\nLink lifetime (1 day unopened · 15 min after first open)');
  const setLink = (issuedAgo: string, openedAgo: string | null) =>
    db.execute(sql`UPDATE job SET track_token_at = (now() AT TIME ZONE 'Asia/Bangkok') - ${issuedAgo}::interval,
    track_opened_at = ${openedAgo === null ? null : sql`now() - ${openedAgo}::interval`},
    track_link_expires_at = ${openedAgo === null ? null : sql`now() - ${openedAgo}::interval + interval '15 minutes'`}
    WHERE job_no = ${JOB_B.job_no}`);
  const keepLink = async (token: string, ip = nextIp()) => {
    usedIps.push(ip);
    const r = await linkKeepalivePOST(
      new NextRequest('https://svc.example.test/api/track/link/keepalive', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': ip,
          'user-agent': UA,
          'x-origin-auth': ORIGIN_SECRET,
        },
        body: JSON.stringify({ linkToken: token }),
      }),
    );
    return { status: r.status, json: (await r.json()) as { ok: boolean; expiresAt?: string } };
  };
  const leftMs = (iso?: string) => (iso ? Date.parse(iso) - Date.now() : NaN);
  const openB = async () => (await session({ linkToken: JOB_B.track_token, turnstileToken: 'good' }, nextIp())).status;
  await test('fresh unopened link opens, and the first open is recorded', async () => {
    await setLink('1 minute', null);
    assert.equal(await openB(), 200);
    const st = await linkStatus(JOB_B.job_no);
    assert.equal(st.state, 'opened');
    assert.ok(st.openedAt && st.expiresAt && Date.parse(st.expiresAt) - Date.parse(st.openedAt) === 15 * 60_000);
  });
  await test('opened 14 minutes ago → still works (refresh inside the window)', async () => {
    await setLink('2 hours', '14 minutes');
    assert.equal(await openB(), 200);
  });
  await test('opened 16 minutes ago → expired', async () => {
    await setLink('2 hours', '16 minutes');
    assert.equal(await openB(), 410);
    assert.equal((await linkStatus(JOB_B.job_no)).state, 'expired');
  });
  await test('never opened, issued 23 h ago → still works', async () => {
    await setLink('23 hours', null);
    assert.equal(await openB(), 200);
  });
  await test('never opened, issued 25 h ago → expired', async () => {
    await setLink('25 hours', null);
    assert.equal(await openB(), 410);
    assert.equal((await linkStatus(JOB_B.job_no)).state, 'expired');
  });
  await test("a signed-in staff preview does not start the customer's 15 minutes", async () => {
    await setLink('1 minute', null);
    const role = (
      await db.execute<{ t: string }>(
        sql`SELECT DISTINCT trim(user_type) t FROM app_config WHERE user_type IS NOT NULL LIMIT 1`,
      )
    ).rows[0].t;
    await db.execute(sql`INSERT INTO app_user (username, password, first_name, last_name, user_type, is_active, record_status, email_address)
    VALUES (${tempEmail.slice(0, 40)}, '', 'Track', 'Test', ${role}, true, 'ACTIVE', ${tempEmail})`);
    const now = Date.now();
    const cookie = `${S.SESSION_COOKIE}=${await S.signSession({ email: tempEmail, name: 't', role, approved: true, exp: now + 6e5, iat: now, sv: 0 })}`;
    const r = await sessionPOST(
      req('/api/track/session', { linkToken: JOB_B.track_token, turnstileToken: 'good' }, nextIp(), { cookie }),
    );
    assert.equal(r.status, 200);
    assert.equal((await linkStatus(JOB_B.job_no)).state, 'unopened');
  });
  await test('first open → the page gets a ~15 min countdown', async () => {
    await setLink('1 minute', null);
    const r = await session({ linkToken: JOB_B.track_token, turnstileToken: 'good' }, nextIp());
    const left = leftMs((r.json as { expiresAt?: string }).expiresAt);
    assert.ok(left > 14 * 60_000 && left <= 15 * 60_000 + 5000, `got ${Math.round(left / 1000)} s`);
  });
  await test('in use: keepalive keeps ≥ 5 min on an opened link', async () => {
    await setLink('1 hour', '12 minutes'); // 3 min left
    const k = await keepLink(JOB_B.track_token);
    assert.equal(k.status, 200);
    const left = leftMs(k.json.expiresAt);
    assert.ok(left > 4.5 * 60_000 && left <= 5 * 60_000 + 5000, `got ${Math.round(left / 1000)} s`);
  });
  await test('keepalive never goes past 60 min from the first open', async () => {
    await setLink('2 hours', '58 minutes');
    await db.execute(
      sql`UPDATE job SET track_link_expires_at = now() + interval '1 minute' WHERE job_no = ${JOB_B.job_no}`,
    );
    const k = await keepLink(JOB_B.track_token);
    const left = leftMs(k.json.expiresAt);
    assert.ok(left <= 2 * 60_000 + 5000, `capped at open + 60 min (got ${Math.round(left / 1000)} s)`);
  });
  await test('keepalive does not revive an expired link, nor open an unopened one', async () => {
    await setLink('2 hours', '16 minutes');
    assert.equal((await keepLink(JOB_B.track_token)).status, 410);
    await setLink('1 minute', null);
    assert.equal((await keepLink(JOB_B.track_token)).status, 200);
    assert.equal((await linkStatus(JOB_B.job_no)).state, 'unopened');
  });
  await test('issuing a new link resets the window and kills the old one', async () => {
    await setLink('1 minute', '5 minutes');
    const old = JOB_B.track_token;
    JOB_B.track_token = (await rotateToken(JOB_B.job_no)).token;
    assert.equal((await linkStatus(JOB_B.job_no)).state, 'unopened');
    assert.equal(await jobNoForLink(old), null);
    assert.equal(await jobNoForLink(JOB_B.track_token), JOB_B.job_no);
  });

  console.log('\nLink token at rest (drizzle/0025)');
  const sha256hex = (t: string) => createHash('sha256').update(t).digest('hex');
  const linkRow = async (jobNo: string) =>
    (
      await db.execute<{ raw: string | null; hash: string | null; row: string }>(sql`
    SELECT track_token AS raw, track_token_hash AS hash, row_to_json(j)::text AS row FROM job j WHERE job_no = ${jobNo}`)
    ).rows[0];
  await test('a generated link: the DB holds only its sha256, never the token; lookup works by hash', async () => {
    const r = await linkRow(JOB_B.job_no);
    assert.equal(r.raw, null);
    assert.equal(r.hash, sha256hex(JOB_B.track_token));
    assert.equal(r.row.includes(JOB_B.track_token), false, 'raw token stored somewhere in the job row');
    assert.equal(await jobNoForLink(JOB_B.track_token), JOB_B.job_no);
    assert.equal(await jobNoForLink(r.hash!.slice(0, 43)), null); // what a DB reader sees is no link
  });
  await test('first link of a job is returned once; later calls cannot show it again', async () => {
    const token = await ensureToken('TJ00003'); // seeded without a link
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const r = await linkRow('TJ00003');
    assert.equal(r.raw, null);
    assert.equal(r.hash, sha256hex(token));
    assert.equal(await ensureToken('TJ00003'), '');
    assert.equal(await jobNoForLink(token), 'TJ00003');
  });
  await test('deploy overlap: a raw token the OLD code writes is hashed by the trigger and keeps working', async () => {
    const old = 'oldCodeToken_' + 'x'.repeat(30); // 43 chars
    await db.execute(sql`UPDATE job SET track_token = ${old}, track_token_at = now() AT TIME ZONE 'Asia/Bangkok',
    track_opened_at = NULL, track_link_expires_at = NULL WHERE job_no = 'TJ00003'`);
    assert.equal((await linkRow('TJ00003')).hash, sha256hex(old));
    assert.equal(await jobNoForLink(old), 'TJ00003');
    const fresh = (await rotateToken('TJ00003')).token; // new code: raw column emptied, old link dead
    assert.equal((await linkRow('TJ00003')).raw, null);
    assert.equal(await jobNoForLink(old), null);
    assert.equal(await jobNoForLink(fresh), 'TJ00003');
  });

  console.log('\nTickets');
  let ticketA = '';
  const ipA = nextIp();
  await test('valid link + Turnstile → ticket (32 random bytes, base64url)', async () => {
    const r = await session({ linkToken: JOB_A.track_token, turnstileToken: 'good' }, ipA);
    assert.equal(r.json.ok, true);
    ticketA = r.json.ticket!;
    assert.match(ticketA, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(ticketA, 'base64url').length, 32);
    assert.equal(r.cache, 'no-store');
  });
  await test('DB stores sha256(ticket), never the raw ticket; TTL = 3 minutes', async () => {
    const raw = await db.execute(
      sql`SELECT 1 FROM track_ticket WHERE token_hash = ${Buffer.from(ticketA)} OR token_hash = convert_to(${ticketA}, 'UTF8')`,
    );
    assert.equal(raw.rows.length, 0);
    const r = await db.execute<{ ttl: number; job_no: string }>(sql`
    SELECT extract(epoch FROM expires_at - created_at)::int AS ttl, job_no FROM track_ticket WHERE token_hash = ${guard.sha256(ticketA)}`);
    assert.equal(r.rows.length, 1);
    assert.equal(Number(r.rows[0].ttl), 180);
    assert.equal(r.rows[0].job_no, JOB_A.job_no);
  });
  await test('client-sent job_no / linkToken cannot change the job (Cross-Job Ticket Attempt)', async () => {
    const r = await data(
      { ticket: ticketA, job_no: JOB_B.job_no, jobId: JOB_B.job_no, linkToken: JOB_B.track_token },
      ipA,
    );
    assert.equal(r.json.ok, true);
    assert.equal(r.json.job?.no, JOB_A.job_no);
    assert.equal(r.cache, 'no-store');
  });
  await test('same ticket a second time → generic failure (Ticket Replay)', async () => {
    const r = await data({ ticket: ticketA }, ipA);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.error, 'หมดเวลา กรุณายืนยันอีกครั้ง');
  });
  await test('ticket from another IP → fails; the mismatch does not burn it for its owner (Cross-IP)', async () => {
    const ip = nextIp();
    const s = await session({ linkToken: JOB_A.track_token, turnstileToken: 'good' }, ip);
    const other = await data({ ticket: s.json.ticket }, nextIp());
    assert.equal(other.json.ok, false);
    const owner = await data({ ticket: s.json.ticket }, ip);
    assert.equal(owner.json.ok, true, 'a mismatch must not consume the ticket for its owner');
  });
  await test('ticket from another User-Agent → fails (Cross-UA)', async () => {
    const ip = nextIp();
    const s = await session({ linkToken: JOB_A.track_token, turnstileToken: 'good' }, ip);
    const r = await data({ ticket: s.json.ticket }, ip, 'curl/8.0');
    assert.equal(r.json.ok, false);
  });
  await test('expired ticket → fails (Expired Ticket)', async () => {
    const ip = nextIp();
    const s = await session({ linkToken: JOB_A.track_token, turnstileToken: 'good' }, ip);
    await db.execute(
      sql`UPDATE track_ticket SET expires_at = now() - interval '1 second' WHERE token_hash = ${guard.sha256(s.json.ticket!)}`,
    );
    const r = await data({ ticket: s.json.ticket }, ip);
    assert.equal(r.json.ok, false);
  });
  await test('10 concurrent requests with one ticket → exactly one succeeds (Concurrent Ticket Replay)', async () => {
    const ip = nextIp();
    const job = await jobNoForLink(JOB_A.track_token);
    const t = await guard.issueTicket(job!, ip, UA);
    const results = await Promise.all(Array.from({ length: 10 }, () => guard.consumeTicket(t, ip, UA)));
    assert.equal(results.filter(Boolean).length, 1);
  });
  await test('failure messages never reveal the reason', async () => {
    const ip = nextIp();
    const s = await session({ linkToken: JOB_A.track_token, turnstileToken: 'good' }, ip);
    const wrongUa = await data({ ticket: s.json.ticket }, ip, 'other-ua');
    const garbage = await data({ ticket: 'x'.repeat(43) }, nextIp());
    const missing = await data({}, nextIp());
    assert.deepEqual(wrongUa.json, garbage.json);
    assert.deepEqual(garbage.json, missing.json);
  });

  console.log('\nAbuse / rate limits');
  await test('>5 invalid tickets in 10 min → IP blocked 15 min (Invalid Ticket Brute Force)', async () => {
    // the 5/min data limit alone stops a burst at 5 failures, so the 6th failure comes in a
    // later minute — seed 5 earlier failures, then the next bad ticket must trigger the block
    const ip = nextIp();
    usedIps.push(ip);
    const ipKey = guard.hmac(`ip:${ip}`);
    for (let i = 0; i < 5; i++) await guard.hit('ticket_fail', ipKey, 5, 600);
    const sixth = await data({ ticket: 'y'.repeat(43) }, ip);
    assert.equal(sixth.status, 401);
    assert.equal(await guard.isBlocked(`ticket:${ipKey}`), true, 'blocked after the 6th failure');
    // blocked: even a VALID ticket from this IP is refused for 15 minutes
    const s = await session({ linkToken: JOB_A.track_token, turnstileToken: 'good' }, ip);
    const r = await data({ ticket: s.json.ticket }, ip);
    assert.equal(r.status, 429);
    const left = await db.execute<{ mins: number }>(sql`
    SELECT round(extract(epoch FROM blocked_until - now()) / 60)::int AS mins FROM track_block WHERE key = ${`ticket:${ipKey}`}`);
    assert.equal(Number(left.rows[0]?.mins), 15);
  });
  await test('session: 10 / minute / IP', async () => {
    const ip = nextIp();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++)
      codes.push((await session({ linkToken: 'D'.repeat(43), turnstileToken: 'bad' }, ip)).status);
    assert.equal(codes.slice(0, 10).includes(429), false);
    assert.equal(codes[10], 429);
  });
  await test('session: 20 / hour / link (keyed by HMAC, not the raw token)', async () => {
    const link = 'C'.repeat(43);
    const codes: number[] = [];
    for (let i = 0; i < 21; i++)
      codes.push((await session({ linkToken: link, turnstileToken: 'bad' }, nextIp())).status);
    assert.equal(codes[20], 429);
    const raw = await db.execute(sql`SELECT 1 FROM track_rate WHERE key = ${link}`);
    assert.equal(raw.rows.length, 0);
  });
  await test('data: 5 / minute / IP', async () => {
    const ip = nextIp();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await data({ ticket: 'z'.repeat(43) }, ip)).status);
    assert.equal(codes[5], 429);
  });

  console.log('\nPublicJob (Data Leakage)');
  await test('PublicJob has exactly the whitelisted fields', async () => {
    const j = await publicJobByNo(JOB_A.job_no);
    assert.ok(j);
    assert.deepEqual(Object.keys(j!).sort(), PUBLIC_KEYS);
  });
  await test('no price / phone / address / email / note / full serial / token', async () => {
    const j = await publicJobByNo(JOB_A.job_no);
    const s = JSON.stringify(j).toLowerCase();
    for (const bad of [
      'price',
      'cost',
      'phone',
      'address',
      'email',
      'remark',
      'note',
      'engineer',
      'token',
      'imei',
      'customerid',
    ]) {
      assert.equal(s.includes(`"${bad}`), false, `field containing "${bad}"`);
    }
    assert.ok(!j!.deviceRef || /^•{4}.{0,4}$/.test(j!.deviceRef), 'serial must be masked');
    assert.equal(s.includes(JOB_A.track_token.toLowerCase()), false);
  });

  console.log('\nPhone + OTP (/track)');
  // a real customer with jobs (read only); a number that no customer has
  const cust = (
    await db.execute<{ phone: string }>(sql`
  SELECT right(regexp_replace(c.phone_number, '\\D', '', 'g'), 10) AS phone FROM customer c
   WHERE c.record_status <> 'DELETED' AND regexp_replace(c.phone_number, '\\D', '', 'g') ~ '^0[689][0-9]{8}$'
     AND EXISTS (SELECT 1 FROM job j WHERE j.customer_id = c.customer_id AND j.record_status <> 'DELETED')
   ORDER BY c.customer_id DESC LIMIT 1`)
  ).rows[0];
  assert.ok(cust, 'need a customer with a mobile number and a job');
  const PHONE = cust.phone;
  let NOBODY = '';
  for (let i = 0; i < 20 && !NOBODY; i++) {
    const cand = '09' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    const hitRow = await db.execute(
      sql`SELECT 1 FROM customer WHERE regexp_replace(coalesce(phone_number,''), '\\D', '', 'g') LIKE ${'%' + cand.slice(1) + '%'} LIMIT 1`,
    );
    if (!hitRow.rows.length) NOBODY = cand;
  }
  const { normalizePhone, customerIdsForPhone } = await import('@/server/track-otp');
  phoneHashes = [PHONE, NOBODY].map((p) => guard.hmac(`phone:${p}`));
  /** the resend cooldown of each test number (track-guard claimCooldown: a track_block row, not a counter) */
  const coolKeys = () => phoneHashes.map((h) => `cool:${h}`);
  const clearCooldowns = () => db.execute(sql`DELETE FROM track_block WHERE key IN ${coolKeys()}`);
  const clearPhoneLimits = async () => {
    await db.execute(sql`DELETE FROM track_rate WHERE key IN ${phoneHashes}`);
    await clearCooldowns();
  };
  const cooldownLeft = async (phone: string) =>
    (
      await db.execute<{ s: number }>(
        sql`SELECT extract(epoch FROM blocked_until - now())::float8 AS s FROM track_block WHERE key = ${`cool:${guard.hmac(`phone:${phone}`)}`}`,
      )
    ).rows[0]?.s ?? null;
  let otpSession = '';
  const otpIp = nextIp();
  const otpRowCount = async (requestId: string) =>
    (await db.execute(sql`SELECT 1 FROM track_otp WHERE request_hash = ${guard.sha256(requestId)}`)).rows.length;

  await test('phone formats normalize (0x / +66 / spaces / dashes); landlines and junk rejected', async () => {
    assert.equal(normalizePhone('081-234-5678'), '0812345678');
    assert.equal(normalizePhone('+66 81 234 5678'), '0812345678');
    assert.equal(normalizePhone('812345678'), '0812345678');
    assert.equal(normalizePhone('021234567'), null);
    assert.equal(normalizePhone('hello'), null);
  });
  await test('a field holding two numbers matches each exactly — never a 9-digit window across both', async () => {
    await db.execute(sql`
      INSERT INTO customer (customer_id, customer_code, customer_name, phone_number) VALUES
        (9101, 'TT9101', 'สองเบอร์', '086-234-5678 / 089-876-5432'),
        (9102, 'TT9102', 'สองเบอร์ +66', '+66 86 111 2222, 0863334444'),
        (9103, 'TT9103', 'สองเบอร์ เว้นวรรค', '0864445555 0865556666'),
        (9104, 'TT9104', 'เบอร์เดียว +66', '+66861234560'),
        (9105, 'TT9105', 'เบอร์เดียว 66', '66-86-123-4561')`);
    try {
      const ids = async (p: string) => (await customerIdsForPhone(p)).filter((id) => id > 9100);
      for (const [p, id] of [
        ['0862345678', 9101],
        ['0898765432', 9101],
        ['0861112222', 9102],
        ['0863334444', 9102],
        ['0864445555', 9103],
        ['0865556666', 9103],
        ['0861234560', 9104],
        ['0861234561', 9105],
      ] as const)
        assert.deepEqual(await ids(p), [id], p);
      // "08623456780898765432" holds 080-898-7654 across the " / " — a stranger, not this customer
      assert.deepEqual(await ids('0808987654'), []);
      assert.deepEqual(await ids('0644455550'), [], 'nor across a space ("…4555 0865…")');
      assert.deepEqual(await customerIdsForPhone(PHONE), [1], 'the fixture customer still matches');
    } finally {
      await db.execute(sql`DELETE FROM customer WHERE customer_id BETWEEN 9101 AND 9105`);
    }
  });
  await test('invalid number → 400, no SMS', async () => {
    const before = smsLog.length;
    const r = await otpReq('12345', nextIp());
    assert.equal(r.status, 400);
    assert.equal(smsLog.length, before);
  });
  await test('captcha failure → no OTP, no SMS', async () => {
    const before = smsLog.length;
    const r = await otpReq(PHONE, nextIp(), 'bad');
    assert.equal(r.status, 403);
    assert.equal(smsLog.length, before);
  });
  await test("unknown number → same answer as a customer's, NO SMS (no SMS pumping); a decoy OTP row for nobody", async () => {
    const before = smsLog.length;
    const r = await otpReq(NOBODY, nextIp());
    assert.equal(r.status, 200);
    assert.ok(r.json.ok && r.json.requestId && r.json.masked);
    await new Promise((res) => setTimeout(res, 150)); // the row is written after the answer
    assert.equal(smsLog.length, before);
    const rows = await db.execute<{ ids: number[]; has_code: boolean; token: string | null }>(
      sql`SELECT customer_ids AS ids, code_hash IS NOT NULL AS has_code, provider_token AS token
            FROM track_otp WHERE request_hash = ${guard.sha256(r.json.requestId!)}`,
    );
    assert.deepEqual(rows.rows, [{ ids: [], has_code: true, token: null }]);
  });
  let reqId = '';
  await test('customer number → SMS with a 4-digit code; DB keeps only hashes', async () => {
    await clearPhoneLimits();
    const r = await otpReq(PHONE, otpIp);
    assert.equal(r.status, 200);
    reqId = r.json.requestId!;
    await new Promise((res) => setTimeout(res, 100)); // the send is fire-and-forget
    assert.equal(smsLog.at(-1)?.to, PHONE);
    assert.match(lastOtp(), /^\d{4}$/);
    assert.equal(r.json.masked, `${PHONE.slice(0, 2)}x-xxx-${PHONE.slice(-4)}`);
    const row = (
      await db.execute<{ j: string }>(
        sql`SELECT row_to_json(o)::text j FROM track_otp o WHERE request_hash = ${guard.sha256(reqId)}`,
      )
    ).rows[0];
    assert.ok(row);
    assert.ok(!row.j.includes(lastOtp()) && !row.j.includes(PHONE) && !row.j.includes(reqId));
  });
  await test('resend right after an accepted request → 429 (cooldown), no SMS', async () => {
    // the previous test's request was accepted a moment ago: the sliding 60 s cooldown holds whatever the clock
    const before = smsLog.length;
    assert.equal((await otpReq(PHONE, nextIp())).status, 429);
    await new Promise((res) => setTimeout(res, 100));
    assert.equal(smsLog.length, before);
  });
  await test('5 wrong codes burn the OTP — the right one then fails too', async () => {
    const right = lastOtp();
    const wrong = right === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i++) assert.equal((await otpVerify(reqId, wrong, otpIp)).status, 401);
    assert.equal((await otpVerify(reqId, right, otpIp)).status, 401);
  });
  await test('right code → session; replaying the same code → refused', async () => {
    await clearPhoneLimits();
    const r = await otpReq(PHONE, otpIp);
    reqId = r.json.requestId!;
    await new Promise((res) => setTimeout(res, 100));
    const code = lastOtp();
    const v = await otpVerify(reqId, code, otpIp);
    assert.equal(v.status, 200);
    otpSession = v.json.session!;
    assert.match(otpSession, /^[A-Za-z0-9_-]{43}$/);
    const left = Date.parse(v.json.expiresAt!) - Date.now();
    assert.ok(left > 14 * 60_000 && left <= 15 * 60_000 + 5000, 'starts at 15 minutes');
    assert.equal((await otpVerify(reqId, code, otpIp)).status, 401);
  });
  await test('concurrent right answers → exactly one session', async () => {
    await clearPhoneLimits();
    const r = await otpReq(PHONE, otpIp);
    await new Promise((res) => setTimeout(res, 100));
    const code = lastOtp();
    const all = await Promise.all(Array.from({ length: 5 }, () => otpVerify(r.json.requestId!, code, otpIp)));
    assert.equal(all.filter((x) => x.status === 200).length, 1);
    for (const x of all)
      if (x.json.session)
        await db.execute(sql`DELETE FROM track_session WHERE token_hash = ${guard.sha256(x.json.session)}`);
  });
  await test('the cooldown slides: a turning clock minute does not reopen it; it ends 60 s after the accepted request', async () => {
    await clearPhoneLimits();
    assert.equal((await otpReq(PHONE, nextIp())).status, 200);
    const left = await cooldownLeft(PHONE);
    assert.ok(left !== null && left > 55 && left <= 60, `60 s from the accepted request (${left})`);
    // a new minute / hour starts every fixed window afresh — none of them is the cooldown
    await db.execute(sql`DELETE FROM track_rate WHERE key IN ${phoneHashes}`);
    assert.equal((await otpReq(PHONE, nextIp())).status, 429);
    assert.ok(Math.abs((await cooldownLeft(PHONE))! - left!) < 2, 'a refused request does not extend it');
    // 60 s later
    await db.execute(
      sql`UPDATE track_block SET blocked_until = now() - interval '1 second' WHERE key IN ${coolKeys()}`,
    );
    assert.equal((await otpReq(PHONE, nextIp())).status, 200);
    assert.ok((await cooldownLeft(PHONE))! > 55, 'claimed again');
    await new Promise((res) => setTimeout(res, 150)); // its send lands before the next test counts SMS
  });
  await test('concurrent requests for one number → exactly one accepted, one SMS', async () => {
    await clearPhoneLimits();
    const before = smsLog.length;
    // 3 = the hourly cap, so only the cooldown can refuse
    const all = await Promise.all(Array.from({ length: 3 }, () => otpReq(PHONE, nextIp())));
    assert.deepEqual(all.map((r) => r.status).sort(), [200, 429, 429]);
    await new Promise((res) => setTimeout(res, 150));
    assert.equal(smsLog.length - before, 1);
  });
  await test('a request refused by another limit does not start the cooldown', async () => {
    await clearPhoneLimits();
    const lock = `phone:${guard.hmac(`phone:${PHONE}`)}`;
    await guard.block(lock, 5);
    assert.equal((await otpReq(PHONE, nextIp())).status, 429);
    assert.equal(await cooldownLeft(PHONE), null);
    await db.execute(sql`DELETE FROM track_block WHERE key = ${lock}`);
    const before = smsLog.length;
    assert.equal((await otpReq(PHONE, nextIp())).status, 200);
    await new Promise((res) => setTimeout(res, 150)); // the send lands before the provider tests switch modes
    assert.equal(smsLog.length - before, 1);
  });

  await test('the wrong code that locks the IP out of the number retires the code — the right one is then refused', async () => {
    await clearPhoneLimits();
    const ip = nextIp();
    let r = await otpReq(PHONE, ip);
    await new Promise((res) => setTimeout(res, 100));
    const wrong = lastOtp() === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i++) assert.equal((await otpVerify(r.json.requestId!, wrong, ip)).status, 401); // 5 = OTP_FAILS_PER_PHONE_DAY
    await clearPhoneLimits(); // a new code for the same number + IP (still under the lock's ceiling)
    r = await otpReq(PHONE, ip);
    assert.equal(r.status, 200);
    await new Promise((res) => setTimeout(res, 100));
    const right = lastOtp();
    assert.equal((await otpVerify(r.json.requestId!, right === '0000' ? '1111' : '0000', ip)).status, 401); // 6th → lock
    assert.equal((await otpVerify(r.json.requestId!, right, ip)).status, 401, 'tries were left, but the lock holds');
    await db.execute(sql`DELETE FROM track_block WHERE key LIKE 'phone:%'`);
    await clearPhoneLimits();
  });
  await test('company-wide daily SMS cap (OTP_SMS_PER_DAY = 500): over it → the usual answer, no SMS, logged', async () => {
    await clearPhoneLimits();
    const ip = nextIp();
    await db.execute(sql`
      INSERT INTO track_rate (bucket, key, hits, window_start)
      VALUES ('otp_sms_global_day', 'all', 500, to_timestamp(floor(extract(epoch FROM now()) / 86400) * 86400))
      ON CONFLICT (bucket, key, window_start) DO UPDATE SET hits = 500`);
    try {
      const before = smsLog.length;
      const r = await otpReq(PHONE, ip);
      assert.equal(r.status, 200);
      await new Promise((res) => setTimeout(res, 300));
      assert.equal(smsLog.length, before, 'no SMS');
      assert.equal(await otpRowCount(r.json.requestId!), 0, 'no code to check either');
      const ev = await db.execute(
        sql`SELECT 1 FROM track_event WHERE event = 'otp_sms_global_cap' AND result = 'day' AND ip_hash = ${guard.ipKeyOf(ip)}`,
      );
      assert.equal(ev.rows.length, 1);
    } finally {
      await db.execute(sql`DELETE FROM track_rate WHERE bucket = 'otp_sms_global_day'`);
      await clearPhoneLimits();
    }
  });

  // ---- ThaiBulkSMS OTP service (production): it makes, sends and checks the code ----
  const setProviderMode = (on: boolean) =>
    Object.assign(
      process.env,
      on
        ? { SMS_PROVIDER: 'thaibulksms', THAIBULKSMS_OTP_KEY: OTP_KEY, THAIBULKSMS_OTP_SECRET: OTP_SECRET }
        : { SMS_PROVIDER: 'log', THAIBULKSMS_OTP_KEY: '', THAIBULKSMS_OTP_SECRET: '' },
    );
  const otpRow = async (requestId: string) =>
    (
      await db.execute<{ token: string | null; has_code: boolean }>(
        sql`SELECT provider_token AS token, code_hash IS NOT NULL AS has_code FROM track_otp WHERE request_hash = ${guard.sha256(requestId)}`,
      )
    ).rows[0];
  /** the provider call runs after the answer — wait for its token to land on the row */
  async function providerToken(requestId: string) {
    for (let i = 0; i < 40; i++) {
      const row = await otpRow(requestId);
      if (row?.token) return row.token;
      await new Promise((res) => setTimeout(res, 50));
    }
    return null;
  }
  setProviderMode(true);
  try {
    await test('provider: customer number → ThaiBulkSMS gets the number + app keys; the row keeps its token, no code of ours', async () => {
      await clearPhoneLimits();
      const ip = nextIp();
      const logged = smsLog.length;
      const calls = providerCalls.length;
      const r = await otpReq(PHONE, ip);
      assert.equal(r.status, 200);
      const token = await providerToken(r.json.requestId!);
      assert.match(token ?? '', /^tok-/);
      const sent = providerCalls.slice(calls);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].path, '/v2/otp/request');
      assert.deepEqual(sent[0].f, { key: OTP_KEY, secret: OTP_SECRET, msisdn: PHONE });
      assert.equal((await otpRow(r.json.requestId!)).has_code, false);
      assert.equal(smsLog.length, logged, 'no [sms:log] in provider mode');
    });
    await test('provider: unknown number → same answer, ThaiBulkSMS never called', async () => {
      await clearPhoneLimits();
      const calls = providerCalls.length;
      const r = await otpReq(NOBODY, nextIp());
      assert.equal(r.status, 200);
      assert.ok(r.json.requestId && r.json.masked);
      await new Promise((res) => setTimeout(res, 150));
      assert.equal(providerCalls.length, calls);
    });
    await test('provider: wrong code → 401 (checked by ThaiBulkSMS); right code → session; replay → refused without asking again', async () => {
      await clearPhoneLimits();
      const ip = nextIp();
      const r = await otpReq(PHONE, ip);
      const token = await providerToken(r.json.requestId!);
      assert.equal((await otpVerify(r.json.requestId!, '0000', ip)).status, 401);
      assert.deepEqual(providerCalls.at(-1), {
        path: '/v2/otp/verify',
        f: { key: OTP_KEY, secret: OTP_SECRET, token: token!, pin: '0000' },
      });
      const v = await otpVerify(r.json.requestId!, RIGHT_PIN, ip);
      assert.equal(v.status, 200);
      assert.match(v.json.session ?? '', /^[A-Za-z0-9_-]{43}$/);
      await db.execute(sql`DELETE FROM track_session WHERE token_hash = ${guard.sha256(v.json.session!)}`);
      const calls = providerCalls.length;
      assert.equal((await otpVerify(r.json.requestId!, RIGHT_PIN, ip)).status, 401);
      assert.equal(providerCalls.length, calls, 'a used OTP never reaches ThaiBulkSMS');
    });
    await test('provider: our 5-try cap comes first — the 6th try (even right) never reaches ThaiBulkSMS', async () => {
      await clearPhoneLimits();
      const ip = nextIp();
      const r = await otpReq(PHONE, ip);
      await providerToken(r.json.requestId!);
      for (let i = 0; i < 5; i++) assert.equal((await otpVerify(r.json.requestId!, '1111', ip)).status, 401);
      const calls = providerCalls.length;
      assert.equal((await otpVerify(r.json.requestId!, RIGHT_PIN, ip)).status, 401);
      assert.equal(providerCalls.length, calls);
    });
    await test('provider: service down while checking → 401, logged as otp_check_failed', async () => {
      await clearPhoneLimits();
      const ip = nextIp();
      const r = await otpReq(PHONE, ip);
      await providerToken(r.json.requestId!);
      await db.execute(
        sql`UPDATE track_otp SET provider_token = 'tok-down' WHERE request_hash = ${guard.sha256(r.json.requestId!)}`,
      );
      assert.equal((await otpVerify(r.json.requestId!, RIGHT_PIN, ip)).status, 401);
      await new Promise((res) => setTimeout(res, 150));
      const ev = await db.execute(
        sql`SELECT 1 FROM track_event WHERE event = 'otp_check_failed' AND ip_hash = ${guard.hmac(`ip:${ip}`)} AND at > now() - interval '1 minute'`,
      );
      assert.ok(ev.rows.length >= 1);
    });
    await test('provider: send refused (bad keys) → otp_send_failed, no token, every code refused', async () => {
      await clearPhoneLimits();
      const ip = nextIp();
      process.env.THAIBULKSMS_OTP_SECRET = 'wrong-secret';
      const r = await otpReq(PHONE, ip);
      assert.equal(r.status, 200, 'the page still gets the same answer');
      await new Promise((res) => setTimeout(res, 300));
      assert.equal((await otpRow(r.json.requestId!)).token, null);
      const ev = await db.execute(
        sql`SELECT 1 FROM track_event WHERE event = 'otp_send_failed' AND ip_hash = ${guard.hmac(`ip:${ip}`)} AND at > now() - interval '1 minute'`,
      );
      assert.ok(ev.rows.length >= 1);
      process.env.THAIBULKSMS_OTP_SECRET = OTP_SECRET;
      const calls = providerCalls.length;
      assert.equal((await otpVerify(r.json.requestId!, RIGHT_PIN, ip)).status, 401);
      assert.equal(providerCalls.length, calls);
    });
    await test('provider: a customer and a stranger read the same at verify — 401 + body, ≥ 800 ms, the IP locked after 6 wrong codes', async () => {
      // one IP per number: 2 OTPs × 3 wrong codes (the 6th locks this IP out of the number — OTP_FAILS_PER_PHONE_DAY = 5)
      const run = async (phone: string) => {
        const ip = nextIp();
        const answers = new Set<string>();
        let slowest = Infinity;
        for (let round = 0; round < 2; round++) {
          await clearPhoneLimits(); // the per-number cooldown / hour caps — not the per number+IP fail counter
          await db.execute(sql`DELETE FROM track_rate WHERE key = ${guard.ipKeyOf(ip)}`); // 10 verifies/min per IP
          const r = await otpReq(phone, ip);
          assert.equal(r.status, 200, `${phone === PHONE ? 'customer' : 'stranger'} round ${round}`);
          // the row lands after the answer (the customer's once ThaiBulkSMS gave its token)
          if (phone === PHONE) await providerToken(r.json.requestId!);
          else
            for (let i = 0; i < 40 && !(await otpRow(r.json.requestId!)); i++)
              await new Promise((res) => setTimeout(res, 50));
          const t0 = Date.now();
          const tries = await Promise.all(Array.from({ length: 3 }, () => otpVerify(r.json.requestId!, '1111', ip)));
          slowest = Math.min(slowest, Date.now() - t0);
          for (const t of tries) answers.add(JSON.stringify(t));
        }
        await clearPhoneLimits();
        const locked = await otpReq(phone, ip);
        return { answers: [...answers], slowest, locked: JSON.stringify(locked) };
      };
      const customer = await run(PHONE);
      const stranger = await run(NOBODY);
      assert.deepEqual(customer.answers, [
        JSON.stringify({ status: 401, json: { ok: false, error: TRACK_MSG.otpFail } }),
      ]);
      assert.deepEqual(stranger.answers, customer.answers, 'every wrong code reads the same');
      assert.ok(
        customer.slowest >= 790 && stranger.slowest >= 790,
        `≥ 800 ms (${customer.slowest} / ${stranger.slowest})`,
      );
      assert.equal(JSON.parse(customer.locked).status, 429, 'the 6th wrong code locked the IP out of the number');
      assert.equal(stranger.locked, customer.locked, 'and locks a stranger the same way');
    });
    await test('provider: 11 wrong codes spread over 3 IPs lock the NUMBER for every IP (OTP_FAILS_PER_PHONE_DAY_ALL = 10)', async () => {
      await db.execute(sql`DELETE FROM track_rate WHERE bucket LIKE 'otp_fail_phone_day%'`);
      await db.execute(sql`DELETE FROM track_block`);
      // the request caps (cooldown / hour) are cleared between rounds; the per-number wrong-code counter is not
      const clearRequestCaps = async () => {
        await db.execute(
          sql`DELETE FROM track_rate WHERE key IN ${phoneHashes} AND bucket <> 'otp_fail_phone_day_all'`,
        );
        await clearCooldowns();
      };
      for (const n of [5, 5, 1]) {
        const ip = nextIp();
        await clearRequestCaps();
        const r = await otpReq(PHONE, ip);
        assert.equal(r.status, 200);
        await providerToken(r.json.requestId!);
        for (let i = 0; i < n; i++) assert.equal((await otpVerify(r.json.requestId!, '1111', ip)).status, 401);
      }
      await clearRequestCaps();
      assert.equal((await otpReq(PHONE, nextIp())).status, 429, 'a fresh IP is refused: the number itself is locked');
      await db.execute(sql`DELETE FROM track_block`); // the next tests use this number
    });
    await test('provider: keys missing → the phone option is closed (503), nothing sent', async () => {
      process.env.THAIBULKSMS_OTP_KEY = '';
      const calls = providerCalls.length;
      assert.equal((await otpReq(PHONE, nextIp())).status, 503);
      assert.equal(providerCalls.length, calls);
      process.env.THAIBULKSMS_OTP_KEY = OTP_KEY;
    });
  } finally {
    setProviderMode(false);
    await clearPhoneLimits();
  }

  await test("job list holds only this customer's jobs (active + ≤ 2 years of history)", async () => {
    const r = await me(otpSession, otpIp);
    assert.equal(r.status, 200);
    const nos = [...(r.json.active ?? []), ...(r.json.history ?? [])].map((j) => j.no);
    assert.ok(nos.length > 0);
    const owners = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM job j WHERE j.job_no IN ${nos}
      AND NOT EXISTS (SELECT 1 FROM customer c WHERE c.customer_id = j.customer_id
        AND regexp_replace(coalesce(c.phone_number,''), '\\D', '', 'g') LIKE ${'%' + PHONE.slice(1) + '%'})`);
    assert.equal(Number(owners.rows[0].n), 0, 'a listed job belongs to someone else');
  });
  await test("own job detail → masked PublicJob; someone else's job → 404", async () => {
    const list = await me(otpSession, otpIp);
    const own = [...(list.json.active ?? []), ...(list.json.history ?? [])][0].no;
    const get = async (no: string) =>
      meJobGET(
        new NextRequest(`https://svc.example.test/api/track/me/jobs/${no}`, {
          headers: otpHeaders(otpIp, UA, otpSession),
        }),
        { params: Promise.resolve({ no }) },
      );
    const mine = await get(own);
    assert.equal(mine.status, 200);
    const j = ((await mine.json()) as { job: Record<string, unknown> }).job;
    assert.deepEqual(Object.keys(j).sort(), PUBLIC_KEYS);
    const other = (
      await db.execute<{ no: string }>(sql`
    SELECT j.job_no no FROM job j JOIN customer c ON c.customer_id = j.customer_id
     WHERE j.record_status <> 'DELETED' AND regexp_replace(coalesce(c.phone_number,''), '\\D', '', 'g') NOT LIKE ${'%' + PHONE.slice(1) + '%'} LIMIT 1`)
    ).rows[0].no;
    assert.equal((await get(other)).status, 404);
  });
  console.log('\nDocuments (/api/track/doc → /track/doc/<ticket>)');
  async function docReq(body: Record<string, unknown>, ip: string, opts: { session?: string; ua?: string } = {}) {
    usedIps.push(ip);
    const r = await docPOST(
      new NextRequest('https://svc.example.test/api/track/doc', {
        method: 'POST',
        headers: otpHeaders(ip, opts.ua ?? UA, opts.session),
        body: JSON.stringify(body),
      }),
    );
    return {
      status: r.status,
      cache: r.headers.get('cache-control'),
      json: (await r.json()) as { ok: boolean; url?: string; error?: string; reason?: string },
    };
  }
  const ticketOf = (url?: string) => url?.match(/^\/track\/doc\/([A-Za-z0-9_-]{43})$/)?.[1] ?? '';
  const ownJob = [
    ...((await me(otpSession, otpIp)).json.active ?? []),
    ...((await me(otpSession, otpIp)).json.history ?? []),
  ][0].no;
  let docTicket = '';
  await test('which documents: sent quotations only (no draft / cancelled), return note only once closed', async () => {
    const q = (
      await db.execute<{ job: string; no: string; st: number }>(sql`
    SELECT DISTINCT ON (quotation_status_id) reference_job_no job, quotation_no no, quotation_status_id st FROM quotation_hd
     WHERE record_status <> 'DELETED' AND quotation_status_id IN (3, 5) AND coalesce(reference_job_no, '') <> ''
     ORDER BY quotation_status_id, create_date DESC`)
    ).rows;
    const sent = q.find((r) => r.st === 3);
    const cancelled = q.find((r) => r.st === 5);
    assert.ok(sent && cancelled, 'need an accepted and a cancelled quotation');
    assert.equal((await findDoc(sent.job, 'quotation', sent.no))?.step, 'waiting');
    assert.equal(await findDoc(cancelled.job, 'quotation', cancelled.no), null);
    assert.equal(await findDoc(JOB_A.job_no, 'quotation', sent.no), null, "another job's quotation");
    assert.equal(await findDoc(JOB_A.job_no, 'return', JOB_A.job_no), null, 'open job has no return note');
    const closed = (
      await db.execute<{ no: string }>(sql`
    SELECT j.job_no no FROM job j JOIN job_status s ON s.job_status_id = j.job_status_id
     WHERE j.record_status <> 'DELETED' AND s.job_status_group = 'Finished' AND j.job_closed_date > '1901-01-01' LIMIT 1`)
    ).rows[0];
    assert.equal((await findDoc(closed.no, 'return', closed.no))?.step, 'returned');
    assert.equal((await findDoc(JOB_A.job_no, 'job', JOB_A.job_no))?.step, 'received');
    for (const [k, r] of [
      ['invoice', JOB_A.job_no],
      ['job', '../x'],
      ['job', ''],
      [null, JOB_A.job_no],
    ] as const) {
      assert.equal(await findDoc(JOB_A.job_no, k, r), null, `${k}/${r}`);
    }
  });
  await test('OTP: own job → one-time URL with no job / quotation number in it', async () => {
    const r = await docReq({ jobNo: ownJob, kind: 'job', ref: ownJob }, otpIp, { session: otpSession });
    assert.equal(r.status, 200);
    assert.equal(r.cache, 'no-store');
    docTicket = ticketOf(r.json.url);
    assert.ok(docTicket, `url shape: ${r.json.url}`);
    assert.equal(r.json.url!.includes(ownJob), false);
  });
  await test('DB stores sha256(ticket) only; TTL = 10 minutes', async () => {
    const rows = (
      await db.execute<{ raw: number; ttl: number }>(sql`
    SELECT (SELECT count(*)::int FROM track_doc_ticket WHERE encode(token_hash, 'escape') LIKE ${'%' + docTicket + '%'}) raw,
           extract(epoch FROM expires_at - created_at)::int ttl
      FROM track_doc_ticket WHERE token_hash = ${guard.sha256(docTicket)}`)
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].raw), 0);
    assert.ok(Math.abs(Number(rows[0].ttl) - 600) <= 1);
  });
  // LINE's in-app browser opens the link, then hands it to Safari: no IP / browser binding, not single-use
  await test('doc link: opens again and from any browser while the session lives; bad shape → null', async () => {
    const doc = { jobNo: ownJob, kind: 'job', ref: ownJob };
    assert.deepEqual(await docForLink(docTicket), doc);
    assert.deepEqual(await docForLink(docTicket), doc, 'second open');
    assert.equal(await docForLink('x'.repeat(43)), null);
    assert.equal(await docForLink('../../etc'), null);
  });
  await test('doc link: expired → null; its OTP session ended → null', async () => {
    const a = ticketOf(
      (await docReq({ jobNo: ownJob, kind: 'job', ref: ownJob }, otpIp, { session: otpSession })).json.url,
    );
    await db.execute(
      sql`UPDATE track_doc_ticket SET expires_at = now() - interval '1 second' WHERE token_hash = ${guard.sha256(a)}`,
    );
    assert.equal(await docForLink(a), null);
    const b = ticketOf(
      (await docReq({ jobNo: ownJob, kind: 'job', ref: ownJob }, otpIp, { session: otpSession })).json.url,
    );
    const hash = guard.sha256(otpSession);
    const [{ e }] = (
      await db.execute<{ e: string }>(sql`SELECT expires_at::text e FROM track_session WHERE token_hash = ${hash}`)
    ).rows;
    await db.execute(sql`UPDATE track_session SET expires_at = now() - interval '1 second' WHERE token_hash = ${hash}`);
    try {
      assert.equal(await docForLink(b), null);
    } finally {
      await db.execute(sql`UPDATE track_session SET expires_at = ${e}::timestamptz WHERE token_hash = ${hash}`);
    }
    assert.ok(await docForLink(b), 'live again with the session');
  });
  await test("OTP: someone else's job / another job's quotation / unknown kind → the same 404", async () => {
    const other = (
      await db.execute<{ no: string; q: string }>(sql`
    SELECT j.job_no no, q.quotation_no q FROM job j JOIN customer c ON c.customer_id = j.customer_id
      JOIN quotation_hd q ON q.reference_job_no = j.job_no AND q.quotation_status_id = 3 AND q.record_status <> 'DELETED'
     WHERE j.record_status <> 'DELETED' AND regexp_replace(coalesce(c.phone_number,''), '\\D', '', 'g') NOT LIKE ${'%' + PHONE.slice(1) + '%'} LIMIT 1`)
    ).rows[0];
    const a = await docReq({ jobNo: other.no, kind: 'job', ref: other.no }, otpIp, { session: otpSession });
    const b = await docReq({ jobNo: ownJob, kind: 'quotation', ref: other.q }, otpIp, { session: otpSession });
    const c = await docReq({ jobNo: ownJob, kind: 'invoice', ref: ownJob }, otpIp, { session: otpSession });
    for (const x of [a, b, c]) {
      assert.equal(x.status, 404);
      assert.deepEqual(x.json, a.json, 'same body — never says which');
    }
  });
  await test('OTP: session from another IP / browser → 401, no ticket', async () => {
    assert.equal(
      (await docReq({ jobNo: ownJob, kind: 'job', ref: ownJob }, nextIp(), { session: otpSession })).status,
      401,
    );
    assert.equal(
      (await docReq({ jobNo: ownJob, kind: 'job', ref: ownJob }, otpIp, { session: otpSession, ua: 'curl/8' })).status,
      401,
    );
  });
  await test('link: the link decides the job — a jobNo in the body is ignored', async () => {
    const ok = await docReq({ linkToken: JOB_A.track_token, kind: 'job', ref: JOB_A.job_no }, nextIp());
    assert.equal(ok.status, 200);
    assert.ok(ticketOf(ok.json.url));
    const other = await docReq(
      { linkToken: JOB_A.track_token, jobNo: JOB_B.job_no, kind: 'job', ref: JOB_B.job_no },
      nextIp(),
    );
    assert.equal(other.status, 404);
  });
  await test('link: unknown / expired link, or no authorisation at all → 410, no ticket', async () => {
    assert.equal((await docReq({ linkToken: 'B'.repeat(43), kind: 'job', ref: JOB_A.job_no }, nextIp())).status, 410);
    assert.equal((await docReq({ kind: 'job', ref: JOB_A.job_no, jobNo: JOB_A.job_no }, nextIp())).status, 410);
  });
  await test('documents: 10 / minute / IP', async () => {
    const ip = nextIp();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++)
      codes.push((await docReq({ linkToken: 'D'.repeat(43), kind: 'job', ref: 'X' }, ip)).status);
    assert.equal(codes.filter((c) => c === 429).length, 1);
    assert.equal(codes.at(-1), 429);
  });
  await test('session from another IP / browser → 401', async () => {
    assert.equal((await me(otpSession, nextIp())).status, 401);
    assert.equal((await me(otpSession, otpIp, 'curl/8')).status, 401);
  });
  await test('activity keeps ≥ 5 min on the clock, never past 60 min from sign-in', async () => {
    const th = guard.sha256(otpSession);
    await db.execute(sql`UPDATE track_session SET expires_at = now() + interval '1 minute' WHERE token_hash = ${th}`);
    const k1 = await keepalivePOST(
      new NextRequest('https://svc.example.test/api/track/me/keepalive', {
        method: 'POST',
        headers: otpHeaders(otpIp, UA, otpSession),
      }),
    );
    const left1 = Date.parse(((await k1.json()) as { expiresAt: string }).expiresAt) - Date.now();
    assert.ok(
      left1 > 4.5 * 60_000 && left1 <= 5 * 60_000 + 5000,
      `extended to ~5 min (got ${Math.round(left1 / 1000)} s)`,
    );
    await db.execute(
      sql`UPDATE track_session SET expires_at = now() + interval '30 seconds', max_expires_at = now() + interval '2 minutes' WHERE token_hash = ${th}`,
    );
    const k2 = await keepalivePOST(
      new NextRequest('https://svc.example.test/api/track/me/keepalive', {
        method: 'POST',
        headers: otpHeaders(otpIp, UA, otpSession),
      }),
    );
    const left2 = Date.parse(((await k2.json()) as { expiresAt: string }).expiresAt) - Date.now();
    assert.ok(left2 <= 2 * 60_000 + 5000, 'capped at the 60-minute limit');
  });
  await test('expired session → 401', async () => {
    await db.execute(
      sql`UPDATE track_session SET expires_at = now() - interval '1 second' WHERE token_hash = ${guard.sha256(otpSession)}`,
    );
    assert.equal((await me(otpSession, otpIp)).status, 401);
  });
  await test('sign out kills the session', async () => {
    await db.execute(
      sql`UPDATE track_session SET expires_at = now() + interval '10 minutes', max_expires_at = now() + interval '10 minutes' WHERE token_hash = ${guard.sha256(otpSession)}`,
    );
    assert.equal((await me(otpSession, otpIp)).status, 200);
    await meDELETE(
      new NextRequest('https://svc.example.test/api/track/me', {
        method: 'DELETE',
        headers: otpHeaders(otpIp, UA, otpSession),
      }),
    );
    assert.equal((await me(otpSession, otpIp)).status, 401);
  });
  await test('3 OTPs per number per hour', async () => {
    await clearPhoneLimits();
    // the resend cooldown is separate — clear it between sends, the hour counter stays
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      codes.push((await otpReq(PHONE, nextIp())).status);
      await clearCooldowns();
    }
    assert.deepEqual(codes, [200, 200, 200, 429]);
  });

  console.log('\nHousekeeping');
  await test('housekeeping keeps a day counter that is still counting (window began > 2 h ago), drops an ended one', async () => {
    await db.execute(sql`
      INSERT INTO track_rate (bucket, key, hits, window_start) VALUES
        ('otp_fail_phone_day', 'hk-current', 7, now() - interval '20 hours'),
        ('otp_fail_phone_day', 'hk-ended', 7, now() - interval '26 hours')`);
    await guard.housekeeping();
    const left = await db.execute<{ key: string }>(
      sql`SELECT key FROM track_rate WHERE key IN ('hk-current', 'hk-ended') ORDER BY key`,
    );
    assert.deepEqual(
      left.rows.map((r) => r.key),
      ['hk-current'],
    );
    await db.execute(sql`DELETE FROM track_rate WHERE key = 'hk-current'`);
  });
  await test('housekeeping drops an OTP expired over a day ago, keeps a live one', async () => {
    const old = guard.sha256('hk-otp-old');
    const live = guard.sha256('hk-otp-live');
    await db.execute(sql`
      INSERT INTO track_otp (request_hash, phone_hash, customer_ids, issued_ip, expires_at) VALUES
        (${old}, 'hk', '{}', '203.0.113.1', now() - interval '25 hours'),
        (${live}, 'hk', '{}', '203.0.113.1', now() + interval '5 minutes')`);
    await guard.housekeeping();
    const left = await db.execute<{ live: boolean }>(
      sql`SELECT request_hash = ${live} AS live FROM track_otp WHERE phone_hash = 'hk'`,
    );
    assert.deepEqual(left.rows, [{ live: true }]);
    await db.execute(sql`DELETE FROM track_otp WHERE phone_hash = 'hk'`);
  });

  console.log('\nBody size');
  await test('a /track body over 8 KB → 413 before it is parsed: by Content-Length, and while streaming one without', async () => {
    const url = 'https://svc.example.test/api/track/data';
    const big = JSON.stringify({ ticket: 'x'.repeat(9000) });
    const declared = await dataPOST(
      new NextRequest(url, {
        method: 'POST',
        headers: { ...otpHeaders(nextIp()), 'content-length': String(Buffer.byteLength(big)) },
        body: big,
      }),
    );
    const chunk = new TextEncoder().encode('x'.repeat(4000));
    const stream = new ReadableStream<Uint8Array>({
      pull(ctl) {
        ctl.enqueue(chunk); // endless: refused once past 8 KB, never read to the end
      },
    });
    const chunked = await dataPOST(
      new NextRequest(url, {
        method: 'POST',
        headers: otpHeaders(nextIp()),
        body: stream,
        duplex: 'half',
      } as RequestInit),
    );
    for (const r of [declared, chunked])
      assert.deepEqual([r.status, await r.json()], [413, { ok: false, error: TRACK_MSG.tooLarge }]);
    // a small body still reads as before (a bad ticket → 401)
    const small = await dataPOST(req('/api/track/data', { ticket: 'nope' }, nextIp()));
    assert.equal(small.status, 401);
  });

  console.log('\nLogs');
  await test('no raw link token / ticket / Turnstile token / origin secret in track_event', async () => {
    await new Promise((r) => setTimeout(r, 500)); // logEvent is fire-and-forget
    const r = await db.execute<{ row: string }>(sql`
    SELECT row_to_json(e)::text AS row FROM track_event e
     WHERE e.ip_hash IN ${[...new Set(usedIps)].map((ip) => guard.hmac(`ip:${ip}`))}`);
    assert.ok(r.rows.length > 0, 'events were logged');
    const all = r.rows.map((x) => x.row).join('\n');
    for (const secret of [JOB_A.track_token, ticketA, docTicket, ORIGIN_SECRET, 'unit-test-secret', '203.0.113.']) {
      assert.equal(all.includes(secret), false, `log contains ${secret.slice(0, 12)}…`);
    }
  });
} finally {
  console.log = realLog;
  // no cleanup: tests/seed.mts wipes the fixture and tracking tables at the start of every run
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
