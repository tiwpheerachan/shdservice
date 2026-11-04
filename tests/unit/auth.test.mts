/**
 * Sign-in redirect safety (src/lib/sso.ts). Pure: no DB, no network.
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { safeNext, DEFAULT_AFTER_LOGIN } from '@/lib/sso';
import { safePath } from '@/lib/log';
import { hostCookie, SESSION_COOKIE } from '@/lib/session';
import { NextRequest } from 'next/server';
import { proxy, config as proxyConfig } from '@/proxy';
import { BYPASS_COOKIE } from '@/lib/maintenance';
import { THEME_SCRIPT } from '@/lib/theme-script-source';

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

for (const [input, want] of cases)
  test(`safeNext(${JSON.stringify(input)}) → ${want}`, () => {
    assert.equal(safeNext(input), want);
    const target = new URL(safeNext(input), 'https://app.example');
    assert.equal(target.origin, 'https://app.example');
    assert.equal(safeNext(safeNext(input)), safeNext(input), 'not idempotent'); // the callback re-runs it
  });

for (const [p, want] of [
  ['/track/AbCdEf_123-xyz', '/track/[token]'],
  ['/track/doc/TICKET123', '/track/doc/[ticket]'],
  ['/track', '/track'],
  ['/track/AbC?x=1', '/track/[token]'],
  ['/jobs/list', '/jobs/list'],
] as const)
  test(`logged path ${p} → ${want} (never the /track bearer token)`, () => assert.equal(safePath(p), want));

test('os_session / os_state → __Host- names in production, plain otherwise', () => {
  const env = process.env as Record<string, string | undefined>;
  const was = env.NODE_ENV;
  try {
    assert.equal(SESSION_COOKIE, 'os_session', 'outside production (http dev / tests) the plain name');
    env.NODE_ENV = 'production';
    assert.equal(hostCookie('os_session'), '__Host-os_session');
    assert.equal(hostCookie('os_state'), '__Host-os_state');
  } finally {
    env.NODE_ENV = was;
  }
});

/*
 * Every API handler checks who is calling. The proxy lets every /api/* path past the
 * login gate, so a new route that forgets requireUser/requireCan/requireView/requireAdmin
 * is open to the internet. Public by design: sso/* (sign-in itself), track/* (customer
 * page — own Turnstile/ticket/OTP guards), health (up/down only, admin detail checks itself).
 */
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
test('API handlers are guarded: every non-public handler calls require*/readResource/exportXlsx', () => {
  walk('src/app/api');
  const problems: string[] = [];
  let handlers = 0;
  for (const file of routes.filter((r) => !PUBLIC.test(r))) {
    const src = readFileSync(file, 'utf8');
    // every way a route can export a handler; `export { x as GET }` hides the body → not allowed
    if (/export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(src))
      problems.push(`${file}: re-exported handler — write it inline so its guard is checkable`);
    const starts = [
      ...src.matchAll(/export (?:async\s+)?(?:const|let|function) (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g),
    ];
    for (const [i, m] of starts.entries()) {
      handlers++;
      const body = src.slice(m.index, starts[i + 1]?.index ?? src.length);
      if (!GUARD.test(body)) problems.push(`${file} ${m[1]} has no require*/readResource/exportXlsx`);
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(
    handlers >= 40,
    `only ${handlers} handlers found in ${routes.length} route files — did the route layout change?`,
  );
});

describe('maintenance mode (src/proxy.ts → src/lib/maintenance.ts)', () => {
  const env = process.env as Record<string, string | undefined>;
  const SECRET = 'a'.repeat(15) + 'Z';
  const req = (path: string, cookie?: string) =>
    proxy(new NextRequest(`https://app.example${path}`, { headers: cookie ? { cookie } : {} }));
  beforeAll(() => {
    env.MAINTENANCE_MODE = '1';
    env.MAINTENANCE_UNTIL = '21 ต.ค. <18:00>';
    env.MAINTENANCE_BYPASS_SECRET = SECRET;
  });
  afterAll(() => {
    delete env.MAINTENANCE_MODE;
    delete env.MAINTENANCE_UNTIL;
    delete env.MAINTENANCE_BYPASS_SECRET;
  });
  for (const path of ['/', '/jobs/list', '/track/AbC123', '/login']) {
    test(`${path} → 503 Thai page, no-store, Retry-After, script only by hash`, async () => {
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
    test(`${path} → 503 JSON`, async () => {
      const res = await req(path);
      assert.equal(res.status, 503);
      assert.ok(res.headers.get('retry-after'));
      assert.match(((await res.json()) as { error: string }).error, /^ระบบปิดปรับปรุง/);
    });
  }
  test('wrong / short secret → still 503, no cookie', async () => {
    for (const v of [SECRET.slice(0, -1) + 'Y', SECRET + 'x', '']) {
      const res = await req(`/?maintenance_bypass=${v}`);
      assert.equal(res.status, 503);
      assert.equal(res.headers.get('set-cookie'), null);
    }
    const res = await req('/jobs/list', `${BYPASS_COOKIE}=${SECRET.slice(0, -1)}Y`);
    assert.equal(res.status, 503);
    env.MAINTENANCE_BYPASS_SECRET = 'short-secret';
    try {
      assert.equal((await req('/?maintenance_bypass=short-secret')).status, 503, 'under 16 chars never opens');
    } finally {
      env.MAINTENANCE_BYPASS_SECRET = SECRET;
    }
  });
  test('right secret → redirect without it + HttpOnly SameSite=Lax cookie', async () => {
    const res = await req(`/jobs/list?x=1&maintenance_bypass=${SECRET}`);
    assert.equal(res.status, 307);
    assert.equal(res.headers.get('location'), 'https://app.example/jobs/list?x=1');
    const c = res.headers.get('set-cookie') ?? '';
    assert.ok(c.startsWith(`${BYPASS_COOKIE}=${SECRET};`), c);
    assert.match(c, /HttpOnly/i);
    assert.match(c, /SameSite=lax/i);
    assert.match(c, /Path=\//);
  });
  test('bypass cookie → the real app (login gate, CSP)', async () => {
    const page = await req('/jobs/list', `${BYPASS_COOKIE}=${SECRET}`);
    assert.equal(page.status, 307, 'no session → /login as usual');
    assert.match(page.headers.get('location') ?? '', /\/login\?next=/);
    const track = await req('/track/AbC123', `${BYPASS_COOKIE}=${SECRET}`);
    assert.equal(track.status, 200);
    assert.match(track.headers.get('content-security-policy') ?? '', /'nonce-/);
  });
  test('MAINTENANCE_MODE unset → as before', async () => {
    delete env.MAINTENANCE_MODE;
    assert.equal((await req('/track/AbC123')).status, 200);
    assert.equal((await req('/api/jobs')).status, 200);
    assert.equal((await req('/jobs/list')).status, 307);
    const res = await req(`/?maintenance_bypass=${SECRET}`);
    assert.equal(res.headers.get('set-cookie'), null);
  });
});

test('manifest public, media origin in media-src only when it is an https URL (src/proxy.ts)', async () => {
  const env = process.env as Record<string, string | undefined>;
  const req = (path: string) => proxy(new NextRequest(`https://app.example${path}`));
  try {
    // the manifest: no login redirect, and the proxy does not even run for it (like public/ images)
    assert.equal((await req('/manifest.webmanifest')).status, 200);
    const skip = new RegExp(`^${proxyConfig.matcher[0]!.replace('/(', '(')}$`);
    assert.ok(!skip.test('manifest.webmanifest') && !skip.test('logo.png'), 'matcher skips public files');
    assert.ok(skip.test('jobs/manifest.webmanifest') && skip.test('api/files'), 'matcher still guards the rest');
    const mediaSrc = async () =>
      /media-src ([^;]*)/.exec((await req('/track/AbC123')).headers.get('content-security-policy') ?? '')?.[1];
    delete env.MEDIA_BASE_URL;
    assert.equal(await mediaSrc(), "'self' blob:");
    env.MEDIA_BASE_URL = 'https://media.example.test/';
    assert.equal(await mediaSrc(), "'self' blob: https://media.example.test");
    env.MEDIA_BASE_URL = 'javascript:alert(1)';
    assert.equal(await mediaSrc(), "'self' blob:");
  } finally {
    delete env.MEDIA_BASE_URL;
  }
});
