/**
 * npm run test:auth — sign-in redirect safety (src/lib/sso.ts). Pure: no DB, no network.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { safeNext, DEFAULT_AFTER_LOGIN } from '../src/lib/sso.ts';
import { safePath } from '../src/lib/log.ts';

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
  // dot-segments fold into "//host" (found in review 2026-10-14 — the first fix let these out)
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

console.log(`\n${failed ? 'FAILED' : 'all passed'} (${failed} failed)`);
if (failed) process.exit(1);
