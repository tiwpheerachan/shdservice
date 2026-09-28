/**
 * npm run test:track (scripts/test-track.mts) — security tests for the public tracking flow (spec §AQ / §AR).
 *
 * Runs against DATABASE_URL (drizzle/0014 must be applied). It only WRITES to the
 * tracking tables (track_ticket / track_rate / track_block / track_event) and only
 * READS jobs — no job row is changed. Every request uses a TEST-NET IP
 * (203.0.113.0/24) so the script can delete exactly what it created afterwards.
 * Cloudflare Siteverify is mocked; nothing leaves the machine except DB queries.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";

// ---- test environment (read at call time by the modules below) ----
const ORIGIN_SECRET = "test-origin-secret-" + Math.random().toString(36).slice(2);
Object.assign(process.env, {
  ORIGIN_AUTH_MODE: "enforce",
  ORIGIN_AUTH_SECRET: ORIGIN_SECRET,
  TURNSTILE_SECRET_KEY: "unit-test-secret",
  APP_BASE_URL: "https://svc.example.test",
  TRACK_LOG_SECRET: "unit-test-log-secret",
  SESSION_SECRET: "unit-test-session-secret-0123456789abcdef", // ≥ 32 chars
  SMS_PROVIDER: "log", // OTP goes to the log — captured below, like a developer reading it
});

// Siteverify mock: the Turnstile token decides the answer
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.includes("challenges.cloudflare.com")) return realFetch(input, init);
  const token = new URLSearchParams(String(init?.body ?? "")).get("response") ?? "";
  const reply = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  switch (token) {
    case "good":
      return reply({ success: true, hostname: "svc.example.test", action: "track" });
    case "bad":
      return reply({ success: false, "error-codes": ["invalid-input-response"] });
    case "wrong-host":
      return reply({ success: true, hostname: "evil.example", action: "track" });
    case "wrong-action":
      return reply({ success: true, hostname: "svc.example.test", action: "login" });
    case "http-500":
      return reply({}, 500);
    case "malformed":
      return new Response("<html>", { status: 200 });
    case "timeout":
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    default:
      return reply({ success: false });
  }
}) as typeof fetch;

const { db } = await import("@/db/client");
const guard = await import("@/server/track-guard");
const { clientIp } = await import("@/lib/client-ip");
const { originAuthOk } = await import("@/lib/origin-auth");
const { jobNoForLink, publicJobByNo, rotateToken, linkStatus } = await import("@/server/services/tracking");
const S = await import("@/lib/session");
const { POST: sessionPOST } = await import("@/app/api/track/session/route");
const { POST: dataPOST } = await import("@/app/api/track/data/route");
const { POST: otpRequestPOST } = await import("@/app/api/track/otp/request/route");
const { POST: otpVerifyPOST } = await import("@/app/api/track/otp/verify/route");
const { GET: meGET, DELETE: meDELETE } = await import("@/app/api/track/me/route");
const { POST: keepalivePOST } = await import("@/app/api/track/me/keepalive/route");
const { GET: meJobGET } = await import("@/app/api/track/me/jobs/[no]/route");
const { POST: linkKeepalivePOST } = await import("@/app/api/track/link/keepalive/route");

// capture "[sms:log] to 08…: … 123456 …" instead of sending an SMS
const smsLog: { to: string; text: string }[] = [];
const realLog = console.log;
console.log = (...a: unknown[]) => {
  const m = String(a[0] ?? "").match(/^\[sms:log\] to (\d+): (.*)$/s);
  if (m) smsLog.push({ to: m[1], text: m[2] });
  else realLog(...a);
};
const lastOtp = () => smsLog.at(-1)?.text.match(/\b(\d{6})\b/)?.[1] ?? "";
const otpHeaders = (ip: string, ua = UA, session?: string) => {
  const h: Record<string, string> = { "content-type": "application/json", "cf-connecting-ip": ip, "user-agent": ua, "x-origin-auth": ORIGIN_SECRET };
  if (session) h["x-track-session"] = session;
  return h;
};
async function otpReq(phone: string, ip: string, turnstileToken = "good") {
  usedIps.push(ip);
  const r = await otpRequestPOST(new NextRequest("https://svc.example.test/api/track/otp/request", { method: "POST", headers: otpHeaders(ip), body: JSON.stringify({ phone, turnstileToken }) }));
  return { status: r.status, json: (await r.json()) as { ok: boolean; requestId?: string; masked?: string; error?: string } };
}
async function otpVerify(requestId: string, code: string, ip: string, ua = UA) {
  usedIps.push(ip);
  const r = await otpVerifyPOST(new NextRequest("https://svc.example.test/api/track/otp/verify", { method: "POST", headers: otpHeaders(ip, ua), body: JSON.stringify({ requestId, code }) }));
  return { status: r.status, json: (await r.json()) as { ok: boolean; session?: string; expiresAt?: string; error?: string } };
}
async function me(session: string, ip: string, ua = UA) {
  usedIps.push(ip);
  const r = await meGET(new NextRequest("https://svc.example.test/api/track/me", { headers: otpHeaders(ip, ua, session) }));
  return { status: r.status, json: (await r.json()) as { ok: boolean; active?: { no: string }[]; history?: { no: string }[]; expiresAt?: string } };
}

// ---- helpers ----
let ipSeq = 10;
const nextIp = () => `203.0.113.${ipSeq++}`;
const usedIps: string[] = [];
const UA = "Mozilla/5.0 (test-track) Chrome/140";

function req(path: string, body: unknown, ip: string, opts: { ua?: string; origin?: string | null; cookie?: string } = {}) {
  usedIps.push(ip);
  const headers: Record<string, string> = { "content-type": "application/json", "cf-connecting-ip": ip, "user-agent": opts.ua ?? UA };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin !== null) headers["x-origin-auth"] = opts.origin ?? ORIGIN_SECRET;
  return new NextRequest(`https://svc.example.test${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}
async function session(body: unknown, ip: string, ua?: string) {
  const r = await sessionPOST(req("/api/track/session", body, ip, { ua }));
  return { status: r.status, cache: r.headers.get("cache-control"), json: (await r.json()) as { ok: boolean; ticket?: string; error?: string } };
}
async function data(body: unknown, ip: string, ua?: string) {
  const r = await dataPOST(req("/api/track/data", body, ip, { ua }));
  return { status: r.status, cache: r.headers.get("cache-control"), json: (await r.json()) as { ok: boolean; job?: Record<string, unknown>; error?: string } };
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

// two real open jobs. Links live 1 day unopened / 15 min after opening (drizzle/0016), so the
// run gives them FRESH links and puts the original token / timestamps back in `finally`.
type Orig = { job_no: string; track_token: string | null; track_token_at: string | null; track_opened_at: string | null; track_link_expires_at: string | null };
const pick = await db.execute<Orig>(sql`
  SELECT j.job_no, j.track_token, j.track_token_at::text, j.track_opened_at::text, j.track_link_expires_at::text FROM job j JOIN job_status s ON s.job_status_id = j.job_status_id
   WHERE j.record_status <> 'DELETED' AND s.job_status_group NOT IN ('Finished','Cancel')
   ORDER BY j.job_create_date DESC LIMIT 2`);
assert.ok(pick.rows.length === 2, "need two open jobs in the DB");
const originals = pick.rows;
const JOB_A = { job_no: originals[0].job_no, track_token: await rotateToken(originals[0].job_no) };
const JOB_B = { job_no: originals[1].job_no, track_token: await rotateToken(originals[1].job_no) };
const tempEmail = `track-test-${Date.now()}@example.invalid`;
/** HMACs of the two test phone numbers — declared here so `finally` can clean up after them */
let phoneHashes: string[] = [];
try {

const PUBLIC_KEYS = [
  "no", "customerMasked", "brandModel", "deviceRef", "receivedDate", "dueDate", "step", "stepLabel",
  "cancelled", "history", "shipper", "trackingNo", "closedDate", "courier",
].sort();

console.log("\nOrigin protection / trusted IP");
await test("request without X-Origin-Auth is not trusted (Direct Origin Attack)", async () => {
  const h = new Headers({ "cf-connecting-ip": "198.51.100.7" });
  assert.equal(originAuthOk(h), false);
  assert.equal(clientIp(h), "0.0.0.0", "spoofed CF-Connecting-IP must not be used");
});
await test("wrong X-Origin-Auth is not trusted", async () => {
  const h = new Headers({ "x-origin-auth": ORIGIN_SECRET + "x", "cf-connecting-ip": "198.51.100.7" });
  assert.equal(originAuthOk(h), false);
});
await test("valid X-Origin-Auth → CF-Connecting-IP trusted, X-Forwarded-For ignored", async () => {
  const h = new Headers({ "x-origin-auth": ORIGIN_SECRET, "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "1.2.3.4" });
  assert.equal(clientIp(h), "198.51.100.7");
});

console.log("\nTurnstile (fail closed)");
for (const [token, expect] of [
  ["good", "ok"], ["bad", "fail"], ["wrong-host", "fail"], ["wrong-action", "fail"],
  ["http-500", "unavailable"], ["malformed", "unavailable"], ["timeout", "unavailable"], ["", "fail"],
] as const) {
  await test(`siteverify "${token || "(empty)"}" → ${expect}`, async () => {
    assert.equal(await guard.verifyTurnstile(token, "203.0.113.1"), expect);
  });
}
await test("no secret configured → unavailable (no ticket)", async () => {
  const s = process.env.TURNSTILE_SECRET_KEY;
  process.env.TURNSTILE_SECRET_KEY = "";
  try {
    assert.equal(await guard.verifyTurnstile("good", "203.0.113.1"), "unavailable");
  } finally {
    process.env.TURNSTILE_SECRET_KEY = s;
  }
});
for (const t of ["bad", "wrong-host", "wrong-action", "timeout"]) {
  await test(`session with Turnstile "${t}" issues no ticket (Captcha Bypass Attempt)`, async () => {
    const r = await session({ linkToken: JOB_A.track_token, turnstileToken: t }, nextIp());
    assert.equal(r.json.ok, false);
    assert.equal(r.json.ticket, undefined);
    assert.equal(r.cache, "no-store");
  });
}

console.log("\nLink resolution (Token Enumeration)");
await test("valid link → job", async () => assert.equal(await jobNoForLink(JOB_A.track_token), JOB_A.job_no));
await test("unknown / malformed link → null", async () => {
  assert.equal(await jobNoForLink("A".repeat(43)), null);
  assert.equal(await jobNoForLink("short"), null);
});
await test("unknown link → 'link' hint (410), same body as an expired one — never says which", async () => {
  const unknown = await session({ linkToken: "B".repeat(43), turnstileToken: "good" }, nextIp());
  await db.execute(sql`UPDATE job SET track_opened_at = now() - interval '16 minutes' WHERE job_no = ${JOB_B.job_no}`);
  const expired = await session({ linkToken: JOB_B.track_token, turnstileToken: "good" }, nextIp());
  await db.execute(sql`UPDATE job SET track_opened_at = NULL WHERE job_no = ${JOB_B.job_no}`);
  assert.equal(unknown.status, 410);
  assert.deepEqual(unknown.json, expired.json);
  assert.equal((unknown.json as { reason?: string }).reason, "link");
});
await test("captcha failure is NOT reported as a link problem", async () => {
  const cap = await session({ linkToken: JOB_A.track_token, turnstileToken: "bad" }, nextIp());
  assert.equal(cap.status, 403);
  assert.equal((cap.json as { reason?: string }).reason, undefined);
});

console.log("\nLink lifetime (1 day unopened · 15 min after first open)");
const setLink = (issuedAgo: string, openedAgo: string | null) =>
  db.execute(sql`UPDATE job SET track_token_at = (now() AT TIME ZONE 'Asia/Bangkok') - ${issuedAgo}::interval,
    track_opened_at = ${openedAgo === null ? null : sql`now() - ${openedAgo}::interval`},
    track_link_expires_at = ${openedAgo === null ? null : sql`now() - ${openedAgo}::interval + interval '15 minutes'`}
    WHERE job_no = ${JOB_B.job_no}`);
const keepLink = async (token: string, ip = nextIp()) => {
  usedIps.push(ip);
  const r = await linkKeepalivePOST(new NextRequest("https://svc.example.test/api/track/link/keepalive", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, "user-agent": UA, "x-origin-auth": ORIGIN_SECRET },
    body: JSON.stringify({ linkToken: token }),
  }));
  return { status: r.status, json: (await r.json()) as { ok: boolean; expiresAt?: string } };
};
const leftMs = (iso?: string) => (iso ? Date.parse(iso) - Date.now() : NaN);
const openB = async () => (await session({ linkToken: JOB_B.track_token, turnstileToken: "good" }, nextIp())).status;
await test("fresh unopened link opens, and the first open is recorded", async () => {
  await setLink("1 minute", null);
  assert.equal(await openB(), 200);
  const st = await linkStatus(JOB_B.job_no);
  assert.equal(st.state, "opened");
  assert.ok(st.openedAt && st.expiresAt && Date.parse(st.expiresAt) - Date.parse(st.openedAt) === 15 * 60_000);
});
await test("opened 14 minutes ago → still works (refresh inside the window)", async () => {
  await setLink("2 hours", "14 minutes");
  assert.equal(await openB(), 200);
});
await test("opened 16 minutes ago → expired", async () => {
  await setLink("2 hours", "16 minutes");
  assert.equal(await openB(), 410);
  assert.equal((await linkStatus(JOB_B.job_no)).state, "expired");
});
await test("never opened, issued 23 h ago → still works", async () => {
  await setLink("23 hours", null);
  assert.equal(await openB(), 200);
});
await test("never opened, issued 25 h ago → expired", async () => {
  await setLink("25 hours", null);
  assert.equal(await openB(), 410);
  assert.equal((await linkStatus(JOB_B.job_no)).state, "expired");
});
await test("a signed-in staff preview does not start the customer's 15 minutes", async () => {
  await setLink("1 minute", null);
  const role = (await db.execute<{ t: string }>(sql`SELECT DISTINCT trim(user_type) t FROM app_config WHERE user_type IS NOT NULL LIMIT 1`)).rows[0].t;
  await db.execute(sql`INSERT INTO app_user (username, password, first_name, last_name, user_type, is_active, record_status, email_address)
    VALUES (${tempEmail.slice(0, 40)}, '', 'Track', 'Test', ${role}, true, 'ACTIVE', ${tempEmail})`);
  const now = Date.now();
  const cookie = `${S.SESSION_COOKIE}=${await S.signSession({ email: tempEmail, name: "t", role, approved: true, exp: now + 6e5, iat: now, sv: 0 })}`;
  const r = await sessionPOST(req("/api/track/session", { linkToken: JOB_B.track_token, turnstileToken: "good" }, nextIp(), { cookie }));
  assert.equal(r.status, 200);
  assert.equal((await linkStatus(JOB_B.job_no)).state, "unopened");
});
await test("first open → the page gets a ~15 min countdown", async () => {
  await setLink("1 minute", null);
  const r = await session({ linkToken: JOB_B.track_token, turnstileToken: "good" }, nextIp());
  const left = leftMs((r.json as { expiresAt?: string }).expiresAt);
  assert.ok(left > 14 * 60_000 && left <= 15 * 60_000 + 5000, `got ${Math.round(left / 1000)} s`);
});
await test("in use: keepalive keeps ≥ 5 min on an opened link", async () => {
  await setLink("1 hour", "12 minutes"); // 3 min left
  const k = await keepLink(JOB_B.track_token);
  assert.equal(k.status, 200);
  const left = leftMs(k.json.expiresAt);
  assert.ok(left > 4.5 * 60_000 && left <= 5 * 60_000 + 5000, `got ${Math.round(left / 1000)} s`);
});
await test("keepalive never goes past 60 min from the first open", async () => {
  await setLink("2 hours", "58 minutes");
  await db.execute(sql`UPDATE job SET track_link_expires_at = now() + interval '1 minute' WHERE job_no = ${JOB_B.job_no}`);
  const k = await keepLink(JOB_B.track_token);
  const left = leftMs(k.json.expiresAt);
  assert.ok(left <= 2 * 60_000 + 5000, `capped at open + 60 min (got ${Math.round(left / 1000)} s)`);
});
await test("keepalive does not revive an expired link, nor open an unopened one", async () => {
  await setLink("2 hours", "16 minutes");
  assert.equal((await keepLink(JOB_B.track_token)).status, 410);
  await setLink("1 minute", null);
  assert.equal((await keepLink(JOB_B.track_token)).status, 200);
  assert.equal((await linkStatus(JOB_B.job_no)).state, "unopened");
});
await test("issuing a new link resets the window and kills the old one", async () => {
  await setLink("1 minute", "5 minutes");
  const old = JOB_B.track_token;
  JOB_B.track_token = await rotateToken(JOB_B.job_no);
  assert.equal((await linkStatus(JOB_B.job_no)).state, "unopened");
  assert.equal(await jobNoForLink(old), null);
  assert.equal(await jobNoForLink(JOB_B.track_token), JOB_B.job_no);
});

console.log("\nTickets");
let ticketA = "";
const ipA = nextIp();
await test("valid link + Turnstile → ticket (32 random bytes, base64url)", async () => {
  const r = await session({ linkToken: JOB_A.track_token, turnstileToken: "good" }, ipA);
  assert.equal(r.json.ok, true);
  ticketA = r.json.ticket!;
  assert.match(ticketA, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(ticketA, "base64url").length, 32);
  assert.equal(r.cache, "no-store");
});
await test("DB stores sha256(ticket), never the raw ticket; TTL = 3 minutes", async () => {
  const raw = await db.execute(sql`SELECT 1 FROM track_ticket WHERE token_hash = ${Buffer.from(ticketA)} OR token_hash = convert_to(${ticketA}, 'UTF8')`);
  assert.equal(raw.rows.length, 0);
  const r = await db.execute<{ ttl: number; job_no: string }>(sql`
    SELECT extract(epoch FROM expires_at - created_at)::int AS ttl, job_no FROM track_ticket WHERE token_hash = ${guard.sha256(ticketA)}`);
  assert.equal(r.rows.length, 1);
  assert.equal(Number(r.rows[0].ttl), 180);
  assert.equal(r.rows[0].job_no, JOB_A.job_no);
});
await test("client-sent job_no / linkToken cannot change the job (Cross-Job Ticket Attempt)", async () => {
  const r = await data({ ticket: ticketA, job_no: JOB_B.job_no, jobId: JOB_B.job_no, linkToken: JOB_B.track_token }, ipA);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.job?.no, JOB_A.job_no);
  assert.equal(r.cache, "no-store");
});
await test("same ticket a second time → generic failure (Ticket Replay)", async () => {
  const r = await data({ ticket: ticketA }, ipA);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.error, "หมดเวลา กรุณายืนยันอีกครั้ง");
});
await test("ticket from another IP → fails; the mismatch does not burn it for its owner (Cross-IP)", async () => {
  const ip = nextIp();
  const s = await session({ linkToken: JOB_A.track_token, turnstileToken: "good" }, ip);
  const other = await data({ ticket: s.json.ticket }, nextIp());
  assert.equal(other.json.ok, false);
  const owner = await data({ ticket: s.json.ticket }, ip);
  assert.equal(owner.json.ok, true, "a mismatch must not consume the ticket for its owner");
});
await test("ticket from another User-Agent → fails (Cross-UA)", async () => {
  const ip = nextIp();
  const s = await session({ linkToken: JOB_A.track_token, turnstileToken: "good" }, ip);
  const r = await data({ ticket: s.json.ticket }, ip, "curl/8.0");
  assert.equal(r.json.ok, false);
});
await test("expired ticket → fails (Expired Ticket)", async () => {
  const ip = nextIp();
  const s = await session({ linkToken: JOB_A.track_token, turnstileToken: "good" }, ip);
  await db.execute(sql`UPDATE track_ticket SET expires_at = now() - interval '1 second' WHERE token_hash = ${guard.sha256(s.json.ticket!)}`);
  const r = await data({ ticket: s.json.ticket }, ip);
  assert.equal(r.json.ok, false);
});
await test("10 concurrent requests with one ticket → exactly one succeeds (Concurrent Ticket Replay)", async () => {
  const ip = nextIp();
  const job = await jobNoForLink(JOB_A.track_token);
  const t = await guard.issueTicket(job!, ip, UA);
  const results = await Promise.all(Array.from({ length: 10 }, () => guard.consumeTicket(t, ip, UA)));
  assert.equal(results.filter(Boolean).length, 1);
});
await test("failure messages never reveal the reason", async () => {
  const ip = nextIp();
  const s = await session({ linkToken: JOB_A.track_token, turnstileToken: "good" }, ip);
  const wrongUa = await data({ ticket: s.json.ticket }, ip, "other-ua");
  const garbage = await data({ ticket: "x".repeat(43) }, nextIp());
  const missing = await data({}, nextIp());
  assert.deepEqual(wrongUa.json, garbage.json);
  assert.deepEqual(garbage.json, missing.json);
});

console.log("\nAbuse / rate limits");
await test(">5 invalid tickets in 10 min → IP blocked 15 min (Invalid Ticket Brute Force)", async () => {
  // the 5/min data limit alone stops a burst at 5 failures, so the 6th failure comes in a
  // later minute — seed 5 earlier failures, then the next bad ticket must trigger the block
  const ip = nextIp();
  usedIps.push(ip);
  const ipKey = guard.hmac(`ip:${ip}`);
  for (let i = 0; i < 5; i++) await guard.hit("ticket_fail", ipKey, 5, 600);
  const sixth = await data({ ticket: "y".repeat(43) }, ip);
  assert.equal(sixth.status, 401);
  assert.equal(await guard.isBlocked(`ticket:${ipKey}`), true, "blocked after the 6th failure");
  // blocked: even a VALID ticket from this IP is refused for 15 minutes
  const s = await session({ linkToken: JOB_A.track_token, turnstileToken: "good" }, ip);
  const r = await data({ ticket: s.json.ticket }, ip);
  assert.equal(r.status, 429);
  const left = await db.execute<{ mins: number }>(sql`
    SELECT round(extract(epoch FROM blocked_until - now()) / 60)::int AS mins FROM track_block WHERE key = ${`ticket:${ipKey}`}`);
  assert.equal(Number(left.rows[0]?.mins), 15);
});
await test("session: 10 / minute / IP", async () => {
  const ip = nextIp();
  const codes: number[] = [];
  for (let i = 0; i < 11; i++) codes.push((await session({ linkToken: "D".repeat(43), turnstileToken: "bad" }, ip)).status);
  assert.equal(codes.slice(0, 10).includes(429), false);
  assert.equal(codes[10], 429);
});
await test("session: 20 / hour / link (keyed by HMAC, not the raw token)", async () => {
  const link = "C".repeat(43);
  const codes: number[] = [];
  for (let i = 0; i < 21; i++) codes.push((await session({ linkToken: link, turnstileToken: "bad" }, nextIp())).status);
  assert.equal(codes[20], 429);
  const raw = await db.execute(sql`SELECT 1 FROM track_rate WHERE key = ${link}`);
  assert.equal(raw.rows.length, 0);
});
await test("data: 5 / minute / IP", async () => {
  const ip = nextIp();
  const codes: number[] = [];
  for (let i = 0; i < 6; i++) codes.push((await data({ ticket: "z".repeat(43) }, ip)).status);
  assert.equal(codes[5], 429);
});

console.log("\nPublicJob (Data Leakage)");
await test("PublicJob has exactly the whitelisted fields", async () => {
  const j = await publicJobByNo(JOB_A.job_no);
  assert.ok(j);
  assert.deepEqual(Object.keys(j!).sort(), PUBLIC_KEYS);
});
await test("no price / phone / address / email / note / full serial / token", async () => {
  const j = await publicJobByNo(JOB_A.job_no);
  const s = JSON.stringify(j).toLowerCase();
  for (const bad of ["price", "cost", "phone", "address", "email", "remark", "note", "engineer", "token", "imei", "customerid"]) {
    assert.equal(s.includes(`"${bad}`), false, `field containing "${bad}"`);
  }
  assert.ok(!j!.deviceRef || /^•{4}.{0,4}$/.test(j!.deviceRef), "serial must be masked");
  assert.equal(s.includes(JOB_A.track_token.toLowerCase()), false);
});

console.log("\nPhone + OTP (/track)");
// a real customer with jobs (read only); a number that no customer has
const cust = (await db.execute<{ phone: string }>(sql`
  SELECT right(regexp_replace(c.phone_number, '\\D', '', 'g'), 10) AS phone FROM customer c
   WHERE c.record_status <> 'DELETED' AND regexp_replace(c.phone_number, '\\D', '', 'g') ~ '^0[689][0-9]{8}$'
     AND EXISTS (SELECT 1 FROM job j WHERE j.customer_id = c.customer_id AND j.record_status <> 'DELETED')
   ORDER BY c.customer_id DESC LIMIT 1`)).rows[0];
assert.ok(cust, "need a customer with a mobile number and a job");
const PHONE = cust.phone;
let NOBODY = "";
for (let i = 0; i < 20 && !NOBODY; i++) {
  const cand = "09" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  const hitRow = await db.execute(sql`SELECT 1 FROM customer WHERE regexp_replace(coalesce(phone_number,''), '\\D', '', 'g') LIKE ${"%" + cand.slice(1) + "%"} LIMIT 1`);
  if (!hitRow.rows.length) NOBODY = cand;
}
const { normalizePhone } = await import("@/server/track-otp");
phoneHashes = [PHONE, NOBODY].map((p) => guard.hmac(`phone:${p}`));
const clearPhoneLimits = () => db.execute(sql`DELETE FROM track_rate WHERE key IN ${phoneHashes}`);
let otpSession = "";
const otpIp = nextIp();

await test("phone formats normalize (0x / +66 / spaces / dashes); landlines and junk rejected", async () => {
  assert.equal(normalizePhone("081-234-5678"), "0812345678");
  assert.equal(normalizePhone("+66 81 234 5678"), "0812345678");
  assert.equal(normalizePhone("812345678"), "0812345678");
  assert.equal(normalizePhone("021234567"), null);
  assert.equal(normalizePhone("hello"), null);
});
await test("invalid number → 400, no SMS", async () => {
  const before = smsLog.length;
  const r = await otpReq("12345", nextIp());
  assert.equal(r.status, 400);
  assert.equal(smsLog.length, before);
});
await test("captcha failure → no OTP, no SMS", async () => {
  const before = smsLog.length;
  const r = await otpReq(PHONE, nextIp(), "bad");
  assert.equal(r.status, 403);
  assert.equal(smsLog.length, before);
});
await test("unknown number → same answer as a customer's, but NO SMS and no OTP row (no SMS pumping)", async () => {
  const before = smsLog.length;
  const r = await otpReq(NOBODY, nextIp());
  assert.equal(r.status, 200);
  assert.ok(r.json.ok && r.json.requestId && r.json.masked);
  assert.equal(smsLog.length, before);
  const rows = await db.execute(sql`SELECT 1 FROM track_otp WHERE phone_hash = ${guard.hmac(`phone:${NOBODY}`)}`);
  assert.equal(rows.rows.length, 0);
});
let reqId = "";
await test("customer number → SMS with a 6-digit code; DB keeps only hashes", async () => {
  await clearPhoneLimits();
  const r = await otpReq(PHONE, otpIp);
  assert.equal(r.status, 200);
  reqId = r.json.requestId!;
  await new Promise((res) => setTimeout(res, 100)); // the send is fire-and-forget
  assert.equal(smsLog.at(-1)?.to, PHONE);
  assert.match(lastOtp(), /^\d{6}$/);
  assert.equal(r.json.masked, `${PHONE.slice(0, 2)}x-xxx-${PHONE.slice(-4)}`);
  const row = (await db.execute<{ j: string }>(sql`SELECT row_to_json(o)::text j FROM track_otp o WHERE request_hash = ${guard.sha256(reqId)}`)).rows[0];
  assert.ok(row);
  assert.ok(!row.j.includes(lastOtp()) && !row.j.includes(PHONE) && !row.j.includes(reqId));
});
await test("resend within a minute → 429 (cooldown)", async () => {
  assert.equal((await otpReq(PHONE, nextIp())).status, 429);
});
await test("5 wrong codes burn the OTP — the right one then fails too", async () => {
  const right = lastOtp();
  const wrong = right === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) assert.equal((await otpVerify(reqId, wrong, otpIp)).status, 401);
  assert.equal((await otpVerify(reqId, right, otpIp)).status, 401);
});
await test("right code → session; replaying the same code → refused", async () => {
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
  assert.ok(left > 14 * 60_000 && left <= 15 * 60_000 + 5000, "starts at 15 minutes");
  assert.equal((await otpVerify(reqId, code, otpIp)).status, 401);
});
await test("concurrent right answers → exactly one session", async () => {
  await clearPhoneLimits();
  const r = await otpReq(PHONE, otpIp);
  await new Promise((res) => setTimeout(res, 100));
  const code = lastOtp();
  const all = await Promise.all(Array.from({ length: 5 }, () => otpVerify(r.json.requestId!, code, otpIp)));
  assert.equal(all.filter((x) => x.status === 200).length, 1);
  for (const x of all) if (x.json.session) await db.execute(sql`DELETE FROM track_session WHERE token_hash = ${guard.sha256(x.json.session)}`);
});
await test("job list holds only this customer's jobs (active + ≤ 2 years of history)", async () => {
  const r = await me(otpSession, otpIp);
  assert.equal(r.status, 200);
  const nos = [...(r.json.active ?? []), ...(r.json.history ?? [])].map((j) => j.no);
  assert.ok(nos.length > 0);
  const owners = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM job j WHERE j.job_no IN ${nos}
      AND NOT EXISTS (SELECT 1 FROM customer c WHERE c.customer_id = j.customer_id
        AND regexp_replace(coalesce(c.phone_number,''), '\\D', '', 'g') LIKE ${"%" + PHONE.slice(1) + "%"})`);
  assert.equal(Number(owners.rows[0].n), 0, "a listed job belongs to someone else");
});
await test("own job detail → masked PublicJob; someone else's job → 404", async () => {
  const list = await me(otpSession, otpIp);
  const own = [...(list.json.active ?? []), ...(list.json.history ?? [])][0].no;
  const get = async (no: string) => meJobGET(new NextRequest(`https://svc.example.test/api/track/me/jobs/${no}`, { headers: otpHeaders(otpIp, UA, otpSession) }), { params: Promise.resolve({ no }) });
  const mine = await get(own);
  assert.equal(mine.status, 200);
  const j = ((await mine.json()) as { job: Record<string, unknown> }).job;
  assert.deepEqual(Object.keys(j).sort(), PUBLIC_KEYS);
  const other = (await db.execute<{ no: string }>(sql`
    SELECT j.job_no no FROM job j JOIN customer c ON c.customer_id = j.customer_id
     WHERE j.record_status <> 'DELETED' AND regexp_replace(coalesce(c.phone_number,''), '\\D', '', 'g') NOT LIKE ${"%" + PHONE.slice(1) + "%"} LIMIT 1`)).rows[0].no;
  assert.equal((await get(other)).status, 404);
});
await test("session from another IP / browser → 401", async () => {
  assert.equal((await me(otpSession, nextIp())).status, 401);
  assert.equal((await me(otpSession, otpIp, "curl/8")).status, 401);
});
await test("activity keeps ≥ 5 min on the clock, never past 60 min from sign-in", async () => {
  const th = guard.sha256(otpSession);
  await db.execute(sql`UPDATE track_session SET expires_at = now() + interval '1 minute' WHERE token_hash = ${th}`);
  const k1 = await keepalivePOST(new NextRequest("https://svc.example.test/api/track/me/keepalive", { method: "POST", headers: otpHeaders(otpIp, UA, otpSession) }));
  const left1 = Date.parse(((await k1.json()) as { expiresAt: string }).expiresAt) - Date.now();
  assert.ok(left1 > 4.5 * 60_000 && left1 <= 5 * 60_000 + 5000, `extended to ~5 min (got ${Math.round(left1 / 1000)} s)`);
  await db.execute(sql`UPDATE track_session SET expires_at = now() + interval '30 seconds', max_expires_at = now() + interval '2 minutes' WHERE token_hash = ${th}`);
  const k2 = await keepalivePOST(new NextRequest("https://svc.example.test/api/track/me/keepalive", { method: "POST", headers: otpHeaders(otpIp, UA, otpSession) }));
  const left2 = Date.parse(((await k2.json()) as { expiresAt: string }).expiresAt) - Date.now();
  assert.ok(left2 <= 2 * 60_000 + 5000, "capped at the 60-minute limit");
});
await test("expired session → 401", async () => {
  await db.execute(sql`UPDATE track_session SET expires_at = now() - interval '1 second' WHERE token_hash = ${guard.sha256(otpSession)}`);
  assert.equal((await me(otpSession, otpIp)).status, 401);
});
await test("sign out kills the session", async () => {
  await db.execute(sql`UPDATE track_session SET expires_at = now() + interval '10 minutes', max_expires_at = now() + interval '10 minutes' WHERE token_hash = ${guard.sha256(otpSession)}`);
  assert.equal((await me(otpSession, otpIp)).status, 200);
  await meDELETE(new NextRequest("https://svc.example.test/api/track/me", { method: "DELETE", headers: otpHeaders(otpIp, UA, otpSession) }));
  assert.equal((await me(otpSession, otpIp)).status, 401);
});
await test("3 OTPs per number per hour", async () => {
  await clearPhoneLimits();
  // the minute cooldown is separate — clear it between sends, the hour counter stays
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) {
    codes.push((await otpReq(PHONE, nextIp())).status);
    await db.execute(sql`DELETE FROM track_rate WHERE bucket = 'otp_phone_min' AND key IN ${phoneHashes}`);
  }
  assert.deepEqual(codes, [200, 200, 200, 429]);
});

console.log("\nLogs");
await test("no raw link token / ticket / Turnstile token / origin secret in track_event", async () => {
  await new Promise((r) => setTimeout(r, 500)); // logEvent is fire-and-forget
  const r = await db.execute<{ row: string }>(sql`
    SELECT row_to_json(e)::text AS row FROM track_event e
     WHERE e.ip_hash IN ${[...new Set(usedIps)].map((ip) => guard.hmac(`ip:${ip}`))}`);
  assert.ok(r.rows.length > 0, "events were logged");
  const all = r.rows.map((x) => x.row).join("\n");
  for (const secret of [JOB_A.track_token, ticketA, ORIGIN_SECRET, "unit-test-secret", "203.0.113."]) {
    assert.equal(all.includes(secret), false, `log contains ${secret.slice(0, 12)}…`);
  }
});

} finally {
console.log = realLog;
// ---- OTP rows of this run (by the two test numbers) ----
if (phoneHashes.length) {
  await db.execute(sql`DELETE FROM track_otp WHERE phone_hash IN ${phoneHashes}`);
  await db.execute(sql`DELETE FROM track_session WHERE phone_hash IN ${phoneHashes}`);
  await db.execute(sql`DELETE FROM track_rate WHERE key IN ${phoneHashes}`);
}
// ---- restore the two jobs' links exactly as they were ----
for (const o of originals) {
  await db.execute(sql`UPDATE job SET track_token = ${o.track_token}, track_token_at = ${o.track_token_at}::timestamp,
    track_opened_at = ${o.track_opened_at}::timestamptz, track_link_expires_at = ${o.track_link_expires_at}::timestamptz WHERE job_no = ${o.job_no}`);
}
await db.execute(sql`DELETE FROM app_user WHERE email_address = ${tempEmail}`);
// ---- cleanup: only what this run created ----
const ipHashes = [...new Set(usedIps)].map((ip) => guard.hmac(`ip:${ip}`));
await db.execute(sql`DELETE FROM track_event WHERE ip_hash IN ${ipHashes}`);
await db.execute(sql`DELETE FROM track_rate WHERE key IN ${ipHashes} OR key = ${guard.hmac(`link:${"C".repeat(43)}`)}
  OR key = ${guard.hmac(`link:${"B".repeat(43)}`)} OR key = ${guard.hmac(`link:${"D".repeat(43)}`)}
  OR key = ${guard.hmac(`link:${JOB_A.track_token}`)} OR key = ${guard.hmac(`link:${JOB_B.track_token}`)}`);
await db.execute(sql`DELETE FROM track_block WHERE key IN ${ipHashes.map((h) => `ticket:${h}`)}`);
await db.execute(sql`DELETE FROM track_ticket WHERE host(issued_ip) LIKE '203.0.113.%'`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
