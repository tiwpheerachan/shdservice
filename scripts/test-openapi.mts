/**
 * npm run test:openapi — the API description (src/server/contract) against the routes. Pure: no DB.
 *
 *  - every route.ts under src/app/api is described, with exactly the verbs it exports, and nothing
 *    is described that has no route (GET /api/data/{resource} is described per resource — those names
 *    are held to src/server/resources.ts);
 *  - public operations are exactly /health, /sso/* and /track/*;
 *  - no parameter or property anywhere in it (requests, responses, nested) is named `pk` / `*_pk` / `*Pk` (or the
 *    plural): the bigint `pk` never leaves the backend, the API speaks `id` uuid only;
 *  - the document equals tests/fixtures/openapi.snapshot.json, so every change to it shows in review.
 *    After an intended change: npm run test:openapi -- --update
 *
 * Response shapes are held to the real answers by scripts/test-api.mts (test:db).
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openapi } from '@/server/contract/openapi';

const ROOT = join(process.cwd(), 'src/app/api');
const SNAPSHOT = 'tests/fixtures/openapi.snapshot.json';

/** every route.ts: its OpenAPI-shaped path ([no] → {no}) and the verbs it exports */
function routesOnDisk(dir = ROOT, prefix = ''): { path: string; verbs: string[] }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'route.ts') {
      const source = readFileSync(join(dir, entry.name), 'utf8');
      const verbs = [...source.matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g)].map(
        (m) => m[1]!,
      );
      return [{ path: prefix || '/', verbs }];
    }
    if (!entry.isDirectory()) return [];
    return routesOnDisk(join(dir, entry.name), `${prefix}/${entry.name.replace(/^\[(.+)\]$/, '{$1}')}`);
  });
}

const routes = routesOnDisk()
  .map((r) => ({ ...r, pattern: new RegExp(`^${r.path.replace(/\./g, '\\.').replace(/\{\w+\}/g, '[^/]+')}$`) }))
  // as Next routes: a literal segment wins over a parameter
  .sort((a, b) => a.path.split('{').length - b.path.split('{').length);
const paths = openapi.paths as Record<string, Record<string, { security?: unknown[] }>>;
/** the route file that serves a documented path */
const fileOf = (path: string) => routes.find((r) => r.pattern.test(path));

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : e}`);
  }
}

console.log('\nOpenAPI document vs src/app/api');
test('finds the routes it checks', () => assert.ok(routes.length > 50, `${routes.length} route files`));

test('every route file is described, with exactly the verbs it exports', () => {
  const problems = routes.flatMap((route) => {
    const described = Object.entries(paths)
      .filter(([path]) => fileOf(path) === route)
      .flatMap(([, item]) => Object.keys(item).map((verb) => verb.toUpperCase()));
    const missing = route.verbs.filter((v) => !described.includes(v));
    const extra = [...new Set(described)].filter((v) => !route.verbs.includes(v));
    return [
      ...missing.map((v) => `${v} ${route.path} is not described — add it to src/server/contract`),
      ...extra.map((v) => `${v} ${route.path} is described but the route does not export it`),
    ];
  });
  assert.deepEqual(problems, []);
});

test('nothing is described that has no route file', () => {
  assert.deepEqual(
    Object.keys(paths).filter((path) => !fileOf(path)),
    [],
  );
});

test('GET /data/{resource} is described for exactly the resources src/server/resources.ts serves', () => {
  const source = readFileSync('src/server/resources.ts', 'utf8');
  const fn = source.slice(source.indexOf('export async function readResource'));
  const simple = readFileSync('src/server/services/masters.ts', 'utf8').match(/type SimpleKind = ([^;]+);/)![1]!;
  const served = new Set([
    ...[...fn.matchAll(/resource === '(\w+)'/g)].map((m) => m[1]!),
    ...[...fn.matchAll(/case '(\w+)':/g)].map((m) => m[1]!),
    ...[...simple.matchAll(/'(\w+)'/g)].map((m) => m[1]!),
  ]);
  const described = Object.keys(paths)
    .filter((p) => p.startsWith('/data/'))
    .map((p) => p.slice('/data/'.length));
  assert.deepEqual([...described].sort(), [...served].sort());
});

test('public operations are exactly /health, /sso/* and /track/*', () => {
  const PUBLIC = /^\/(health|sso\/.+|track\/.+)$/;
  const wrong = Object.entries(paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([, op]) => (Array.isArray(op.security) && op.security.length === 0) !== PUBLIC.test(path))
      .map(([verb]) => `${verb.toUpperCase()} ${path}`),
  );
  assert.deepEqual(wrong, []);
});

/** where a parameter or property named like a bigint pk sits in the document */
const PK_NAME = /^pks?$|(_pk|Pk)s?$/;
function pkNames(node: unknown, at = '#'): string[] {
  if (Array.isArray(node)) return node.flatMap((v, i) => pkNames(v, `${at}/${i}`));
  if (!node || typeof node !== 'object') return [];
  const o = node as Record<string, unknown>;
  const props = o.properties && typeof o.properties === 'object' ? Object.keys(o.properties) : [];
  const own = [...props, ...(typeof o.in === 'string' && typeof o.name === 'string' ? [o.name] : [])]
    .filter((n) => PK_NAME.test(n))
    .map((n) => `${at}: ${n}`);
  return [...own, ...Object.entries(o).flatMap(([k, v]) => pkNames(v, `${at}/${k}`))];
}

test('no parameter or property is named pk / *_pk / *Pk — the API speaks id (uuid) only', () => {
  assert.deepEqual(pkNames(openapi), []);
});

test('…and that check finds one injected anywhere (query, body, nested response, component)', () => {
  type Obj = Record<string, unknown>;
  /** the first object (depth-first) that `ok` accepts */
  const first = (n: unknown, ok: (o: Obj) => boolean): Obj | undefined => {
    if (!n || typeof n !== 'object') return undefined;
    if (!Array.isArray(n) && ok(n as Obj)) return n as Obj;
    for (const v of Object.values(n)) {
      const hit = first(v, ok);
      if (hit) return hit;
    }
  };
  const json = (schema: unknown) => ({ content: { 'application/json': { schema } } });
  const inject: ((doc: Obj) => void)[] = [
    (d) => (first(d, (o) => Array.isArray(o.parameters))!.parameters as unknown[]).push({ in: 'query', name: 'pk' }),
    (d) => (first(d, (o) => 'requestBody' in o)!.requestBody = json({ properties: { customer_pk: {} } })),
    (d) => {
      const responses = first(d, (o) => 'responses' in o)!.responses as Obj;
      responses['200'] = json({
        type: 'array',
        items: { properties: { lines: { items: { properties: { jobPk: {} } } } } },
      });
    },
    (d) => ((first(d, (o) => 'schemas' in o)!.schemas as Obj).Injected = { properties: { createdByAppUserPks: {} } }),
  ];
  for (const f of inject) {
    const doc = JSON.parse(JSON.stringify(openapi)) as Obj;
    f(doc);
    assert.equal(pkNames(doc).length, 1, f.toString());
  }
});

test('every $ref it uses is defined', () => {
  const refs = [...JSON.stringify(openapi).matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)].map((m) => m[1]!);
  const defined = Object.keys(openapi.components.schemas);
  assert.deepEqual(
    [...new Set(refs)].filter((ref) => !defined.includes(ref)),
    [],
  );
});

test(`the document equals ${SNAPSHOT} (npm run test:openapi -- --update after an intended change)`, () => {
  const now = `${JSON.stringify(openapi, null, 2)}\n`;
  if (process.argv.includes('--update')) writeFileSync(SNAPSHOT, now);
  let before = '';
  try {
    before = readFileSync(SNAPSHOT, 'utf8');
  } catch {
    // no snapshot yet: the assertion below says how to make one
  }
  assert.ok(before === now, 'the document changed — review the diff, then run: npm run test:openapi -- --update');
});

const operations = Object.values(paths).flatMap((item) => Object.keys(item)).length;
console.log(`\n${passed} passed, ${failures.length} failed (${operations} operations described)`);
if (failures.length) process.exit(1);
