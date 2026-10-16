/**
 * npm run test:routes-input — every route reads its input through the parse helpers of src/server/auth.ts
 * (parseParams / parseQuery / parseHeaders / parseBody / parseForm / parseTrackBody), against the schemas its
 * operation declares in src/server/contract, and never by hand. Pure: reads the route files.
 *
 * That is what makes the API description true (adr/0007): the document is generated from those schemas,
 * so a body read with request.json() or a query read off searchParams would be input the document does not
 * describe and nothing checks. A route that needs something new adds it to its operation.
 *
 * Headers that are transport, not API input, stay readable: content-length (refuse an upload before
 * buffering it), host (the base URL of a link), sec-fetch-site (a browser's own CSRF signal) and
 * user-agent (the audit line). Cookies are the session, described by the document's security scheme.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'src/app/api');
const TRANSPORT_HEADERS = ['content-length', 'host', 'sec-fetch-site', 'user-agent'];

function routes(dir = ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routes(path);
    return entry.name === 'route.ts' ? [path] : [];
  });
}

const BY_HAND: Array<[RegExp, string]> = [
  [/\b(req|request)\.(json|formData|text|arrayBuffer|blob)\(/, 'reads the body by hand — use parseBody / parseForm'],
  [/\b(readJson|readSmallJson)\(/, 'reads the body without its schema — use parseBody / parseTrackBody'],
  [
    /\.searchParams\.(get|getAll|has|forEach|entries|keys|values)\(|\.nextUrl\b/,
    'reads the query by hand — use parseQuery',
  ],
  [/await\s+(\w+\.)?params\b/, 'takes path params unchecked — use parseParams'],
  [
    new RegExp(`\\.headers\\.get\\((?!\\s*'(${TRANSPORT_HEADERS.join('|')})')`),
    'reads a header by hand — declare it and use parseHeaders',
  ],
];

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

const files = routes();
console.log('\nRoutes read their input through src/server/contract');
test('finds the routes it checks', () => assert.ok(files.length > 50, `${files.length} route files`));

test('no route reads params / query / headers / body by hand', () => {
  const problems = files.flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return BY_HAND.filter(([pattern]) => pattern.test(source)).map(
      ([, why]) => `${relative(process.cwd(), file)} ${why}`,
    );
  });
  assert.deepEqual(problems, []);
});

test('a route with a dynamic segment reads it with parseParams', () => {
  const missing = files
    .filter((file) => /\[\w+\]/.test(relative(ROOT, file)))
    .filter((file) => !readFileSync(file, 'utf8').includes('parseParams('))
    .map((file) => relative(process.cwd(), file));
  assert.deepEqual(missing, []);
});

test('the patterns catch what they are for', () => {
  const caught = (src: string) => BY_HAND.some(([pattern]) => pattern.test(src));
  for (const src of [
    'const body = await req.json();',
    'const form = await request.formData();',
    'const body = await readJson(req);',
    "const q = new URL(req.url).searchParams.get('q');",
    "const q = req.nextUrl.searchParams.get('q');",
    'const { no } = await ctx.params;',
    'const { id } = await params;',
    "const t = req.headers.get('x-track-session');",
    'const t = req.headers.get(TRACK_SESSION_HEADER);',
  ])
    assert.ok(caught(src), src);
  for (const src of [
    "const n = Number(req.headers.get('content-length') ?? 0);",
    "appBaseUrl(req.headers.get('host'))",
    'identity = await res.json(); // an upstream answer, not the request',
    "to.searchParams.set('error', reason);",
    'const { no } = await parseParams(ctx, jobGet);',
  ])
    assert.ok(!caught(src), src);
});

console.log(`\n${passed} passed, ${failures.length} failed (${files.length} route files)`);
if (failures.length) process.exit(1);
