/**
 * npm run test:auth — sign-in redirect safety (src/lib/sso.ts). Pure: no DB, no network.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { safeNext, DEFAULT_AFTER_LOGIN } from '../src/lib/sso.ts';
import { safePath } from '../src/lib/log.ts';
import { hostCookie, SESSION_COOKIE } from '../src/lib/session.ts';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy.ts';
import { BYPASS_COOKIE } from '../src/lib/maintenance.ts';
import { THEME_SCRIPT } from '../src/lib/theme-script-source.ts';

const D = DEFAULT_AFTER_LOGIN;
const cases: [string | null | undefined, string][] = [
  [null, D],
  ['', D],
  ['https://evil.example', D],
  ['//evil.example', D],
  ['/\\evil.example', D],
  ['/\t/evil.example', D], // tab is stripped by the URL parser → //evil.example
  [decodeURIComponent('/%09/evil.example'), D],
  [decodeURIComponent('/%09%5Cevil.example'), D],
  ['/\n/evil.example', D],
  ['javascript:alert(1)', D],
  // dot-segments fold into "//host"
  ['/.//evil.example', D],
  ['/..//evil.example', D],
  [decodeURIComponent('/%2e//evil.example'), D],
  ['/a/..//evil.example', D],
  ['/./\\evil.example', D],
  ['/jobs/dashboard', '/jobs/dashboard'],
  ['/jobs?x=1#y', '/jobs?x=1#y'],
  ['/customers/123/edit', '/customers/123/edit'],
];

let failed = 0;
for (const [input, want] of cases) {
  try {
    assert.equal(safeNext(input), want);
    const target = new URL(safeNext(input), 'https://app.example');
    assert.equal(target.origin, 'https://app.example');
    assert.equal(safeNext(safeNext(input)), safeNext(input), 'not idempotent'); // the callback re-runs it
    console.log(`  ✓ ${JSON.stringify(input)}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${JSON.stringify(input)}: ${(e as Error).message}`);
  }
}
console.log('\nLogged paths never carry a /track bearer token');
for (const [p, want] of [
  ['/track/AbCdEf_123-xyz', '/track/[token]'],
  ['/track/doc/TICKET123', '/track/doc/[ticket]'],
  ['/track', '/track'],
  ['/track/AbC?x=1', '/track/[token]'],
  ['/jobs/list', '/jobs/list'],
] as const) {
  try {
    assert.equal(safePath(p), want);
    console.log(`  ✓ ${p} → ${want}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${p}: ${(e as Error).message}`);
  }
}

console.log('\nCookie names: __Host- in production only');
{
  const env = process.env as Record<string, string | undefined>;
  const was = env.NODE_ENV;
  try {
    assert.equal(SESSION_COOKIE, 'os_session', 'outside production (http dev / tests) the plain name');
    env.NODE_ENV = 'production';
    assert.equal(hostCookie('os_session'), '__Host-os_session');
    assert.equal(hostCookie('os_state'), '__Host-os_state');
    console.log('  ✓ os_session / os_state → __Host- names in production, plain otherwise');
  } catch (e) {
    failed++;
    console.log(`  ✗ ${(e as Error).message}`);
  } finally {
    env.NODE_ENV = was;
  }
}

/*
 * Every API handler checks who is calling. The proxy lets every /api/* path past the
 * login gate, so a new route that forgets requireUser/requireCan/requireView/requireAdmin
 * is open to the internet. Public by design: sso/* (sign-in itself), track/* (customer
 * page — own Turnstile/ticket/OTP guards), health (up/down only, admin detail checks itself).
 */
console.log('\nAPI handlers are guarded');
const PUBLIC = /^src\/app\/api\/(sso|track|health)(\/|$)/;
const GUARD = /\brequire(User|Can|View|Admin)\(|\breadResource\(|\bexportXlsx\(/;
const routes: string[] = [];
const walk = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === 'route.ts') routes.push(p);
  }
};
walk('src/app/api');
let handlers = 0;
for (const file of routes.filter((r) => !PUBLIC.test(r))) {
  const src = readFileSync(file, 'utf8');
  // every way a route can export a handler; `export { x as GET }` hides the body → not allowed
  if (/export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(src)) {
    failed++;
    console.log(`  ✗ ${file}: re-exported handler — write it inline so its guard is checkable`);
  }
  const starts = [
    ...src.matchAll(/export (?:async\s+)?(?:const|let|function) (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g),
  ];
  for (const [i, m] of starts.entries()) {
    handlers++;
    const body = src.slice(m.index, starts[i + 1]?.index ?? src.length);
    try {
      assert.ok(GUARD.test(body), `${file} ${m[1]} has no require*/readResource/exportXlsx`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${(e as Error).message}`);
    }
  }
}
console.log(`  checked ${handlers} handlers in ${routes.length} route files`);
if (handlers < 40) {
  failed++;
  console.log(`  ✗ only ${handlers} handlers found — did the route layout change?`);
}

console.log('\nMaintenance mode (src/proxy.ts → src/lib/maintenance.ts)');
{
  const env = process.env as Record<string, string | undefined>;
  const SECRET = 'a'.repeat(15) + 'Z';
  const req = (path: string, cookie?: string) =>
    proxy(new NextRequest(`https://app.example${path}`, { headers: cookie ? { cookie } : {} }));
  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}: ${(e as Error).message}`);
    }
  };
  try {
    env.MAINTENANCE_MODE = '1';
    env.MAINTENANCE_UNTIL = '21 ต.ค. <18:00>';
    env.MAINTENANCE_BYPASS_SECRET = SECRET;
    for (const path of ['/', '/jobs/list', '/track/AbC123', '/login']) {
      await check(`${path} → 503 Thai page, no-store, Retry-After, script only by hash`, async () => {
        const res = await req(path);
        assert.equal(res.status, 503);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.ok(Number(res.headers.get('retry-after')) > 0);
        const html = await res.text();
        assert.match(html, /ระบบปิดปรับปรุง/);
        assert.match(html, /กรุณากลับมาใหม่ภายหลัง/);
        assert.match(html, /02-100-4578/);
        assert.match(html, /21 ต\.ค\. &lt;18:00&gt;/, 'MAINTENANCE_UNTIL shown, escaped');
        assert.ok(html.includes(`<script>${THEME_SCRIPT}</script>`), 'theme script byte for byte');
        assert.equal(html.match(/<script/g)?.length, 1, 'no other script');
        const csp = res.headers.get('content-security-policy') ?? '';
        assert.match(csp, /script-src 'sha256-[^']+';/);
        assert.doesNotMatch(csp, /script-src[^;]*unsafe/);
      });
    }
    for (const path of ['/api/jobs', '/api/sso/login', '/api/track/session']) {
      await check(`${path} → 503 JSON`, async () => {
        const res = await req(path);
        assert.equal(res.status, 503);
        assert.ok(res.headers.get('retry-after'));
        assert.match(((await res.json()) as { error: string }).error, /^ระบบปิดปรับปรุง/);
      });
    }
    await check('wrong / short secret → still 503, no cookie', async () => {
      for (const v of [SECRET.slice(0, -1) + 'Y', SECRET + 'x', '']) {
        const res = await req(`/?maintenance_bypass=${v}`);
        assert.equal(res.status, 503);
        assert.equal(res.headers.get('set-cookie'), null);
      }
      const res = await req('/jobs/list', `${BYPASS_COOKIE}=${SECRET.slice(0, -1)}Y`);
      assert.equal(res.status, 503);
      env.MAINTENANCE_BYPASS_SECRET = 'short-secret';
      assert.equal((await req('/?maintenance_bypass=short-secret')).status, 503, 'under 16 chars never opens');
      env.MAINTENANCE_BYPASS_SECRET = SECRET;
    });
    await check('right secret → redirect without it + HttpOnly SameSite=Lax cookie', async () => {
      const res = await req(`/jobs/list?x=1&maintenance_bypass=${SECRET}`);
      assert.equal(res.status, 307);
      assert.equal(res.headers.get('location'), 'https://app.example/jobs/list?x=1');
      const c = res.headers.get('set-cookie') ?? '';
      assert.ok(c.startsWith(`${BYPASS_COOKIE}=${SECRET};`), c);
      assert.match(c, /HttpOnly/i);
      assert.match(c, /SameSite=lax/i);
      assert.match(c, /Path=\//);
    });
    await check('bypass cookie → the real app (login gate, CSP)', async () => {
      const page = await req('/jobs/list', `${BYPASS_COOKIE}=${SECRET}`);
      assert.equal(page.status, 307, 'no session → /login as usual');
      assert.match(page.headers.get('location') ?? '', /\/login\?next=/);
      const track = await req('/track/AbC123', `${BYPASS_COOKIE}=${SECRET}`);
      assert.equal(track.status, 200);
      assert.match(track.headers.get('content-security-policy') ?? '', /'nonce-/);
    });
    await check('MAINTENANCE_MODE unset → as before', async () => {
      delete env.MAINTENANCE_MODE;
      assert.equal((await req('/track/AbC123')).status, 200);
      assert.equal((await req('/api/jobs')).status, 200);
      assert.equal((await req('/jobs/list')).status, 307);
      const res = await req(`/?maintenance_bypass=${SECRET}`);
      assert.equal(res.headers.get('set-cookie'), null);
    });
  } finally {
    delete env.MAINTENANCE_MODE;
    delete env.MAINTENANCE_UNTIL;
    delete env.MAINTENANCE_BYPASS_SECRET;
  }
}

console.log(`\n${failed ? 'FAILED' : 'all passed'} (${failed} failed)`);
if (failed) process.exit(1);
