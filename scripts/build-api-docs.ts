/* eslint-disable @typescript-eslint/no-explicit-any -- walks the generated OpenAPI JSON and APIDoc's own data, both untyped */
/**
 * Builds the API docs page (APIDoc v5) into .apidoc/index.html, served at /api-docs (src/app/api-docs/route.ts).
 *
 *   npm run docs:api
 *
 * Endpoints are not written twice: the OpenAPI spec generated from the zod contract (src/server/contract/openapi.ts)
 * is turned into APIDoc `@api` comments in .apidoc/src (never committed). Only the guides (docs/api/guides) are
 * hand-written.
 *
 * Each endpoint is emitted once per language with the same English text: an endpoint without a block in the
 * language being read would vanish from the page.
 *
 * Try it: the build writes a placeholder origin, which the route swaps for the request's own.
 * Input category "endpoints", not "api": APIDoc's built-in "api" category leaves out the @apiLang parser.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DOCS_ORIGIN, openapi } from '@/server/contract/openapi';

const root = path.resolve(import.meta.dirname, '..');
const docs = path.join(root, 'docs/api');
const out = path.join(root, '.apidoc');
const src = path.join(out, 'src');
const LANGS = ['en', 'th'] as const;
const PREFIX = '/api';

type Schema = Record<string, any>;
type Operation = Record<string, any>;
const spec = openapi as unknown as {
  tags: { name: string; description?: string }[];
  paths: Record<string, Record<string, any>>;
  security: Record<string, unknown>[];
  components: { schemas: Record<string, Schema> };
};
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** A schema with its $ref followed, and a lone allOf (how a $ref carries a description) unwrapped. */
function resolve(schema: Schema | undefined, seen: string[] = []): { schema: Schema; seen: string[] } {
  if (!schema) return { schema: {}, seen };
  if (schema.$ref) {
    const name = String(schema.$ref).split('/').pop()!;
    const target = spec.components.schemas[name];
    if (!target) throw new Error(`openapi: no schema ${schema.$ref}`);
    return resolve(target, [...seen, name]);
  }
  if (schema.allOf?.length === 1) {
    const inner = resolve(schema.allOf[0], seen);
    return { schema: { ...inner.schema, ...omit(schema, 'allOf') }, seen: inner.seen };
  }
  return { schema, seen };
}
const omit = (object: Schema, key: string) => Object.fromEntries(Object.entries(object).filter(([k]) => k !== key));
const refName = (schema: Schema | undefined) =>
  schema?.$ref ? String(schema.$ref).split('/').pop() : schema?.allOf?.[0]?.$ref?.split('/').pop();

/** APIDoc's type word: String, Number, Boolean, Object, File, and [] for a list. */
function typeOf(schema: Schema): string {
  const { schema: s } = resolve(schema);
  if (s.type === 'array') return `${typeOf(s.items ?? {})}[]`;
  if (s.format === 'binary') return 'File';
  if (s.type === 'integer' || s.type === 'number') return 'Number';
  if (s.type === 'boolean') return 'Boolean';
  if (s.type === 'object' || s.properties || s.additionalProperties) return 'Object';
  return 'String';
}

/**
 * `{String}`. Without APIDoc's `="a","b"` allowed values: 5.1.0 parses them and
 * then leaves them off the page, so they go in the description instead.
 */
const typeWord = (schema: Schema) => `{${typeOf(schema)}}`;

/** One line of text: what the field is, then the facts the type word cannot carry. */
function describe(own: Schema, resolved: Schema): string {
  const notes: string[] = [];
  const text = own.description ?? resolved.description;
  if (text) notes.push(text);
  const format = resolved.format ?? (resolved.type === 'array' ? resolve(resolved.items).schema.format : undefined);
  if (format && format !== 'binary') notes.push(`Format: \`${format}\`.`);
  if (resolved.nullable || own.nullable) notes.push('May be `null`.');
  if (resolved.minimum !== undefined || resolved.maximum !== undefined) {
    notes.push(`Range: ${resolved.minimum ?? '…'}–${resolved.maximum ?? '…'}.`);
  }
  const values = (resolved.enum ?? (resolved.type === 'array' ? resolve(resolved.items).schema.enum : undefined)) as
    unknown[] | undefined;
  if (values) notes.push(`One of: ${values.map((value) => `\`${value}\``).join(', ')}.`);
  if (resolved.readOnly) notes.push('Read-only.');
  return oneLine(notes.join(' '));
}

interface Field {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: unknown;
  description: string;
}

/** Every field of an object, nested ones as `parent.child`, three levels down at most. */
function fieldsOf(schema: Schema | undefined, prefix = '', depth = 0, seen: string[] = []): Field[] {
  const { schema: s, seen: path } = resolve(schema, seen);
  const object = s.type === 'array' ? resolve(s.items, path) : { schema: s, seen: path };
  const properties = object.schema.properties as Record<string, Schema> | undefined;
  if (!properties) return [];
  const required = new Set<string>(object.schema.required ?? []);
  return Object.entries(properties).flatMap(([key, own]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    const { schema: resolved, seen: inner } = resolve(own, object.seen);
    const field: Field = {
      name,
      type: typeWord(own),
      required: required.has(key),
      defaultValue: resolved.default,
      description: describe(own, resolved),
    };
    // A schema met again inside itself is named, not unfolded forever.
    const recursive = refName(own) && object.seen.includes(refName(own)!);
    const deeper = depth < 2 && !recursive ? fieldsOf(own, name, depth + 1, inner) : [];
    return [field, ...deeper];
  });
}

/**
 * A made-up but plausible value for a schema: its example if it has one.
 * `sendable` is for a request body Try it will send as it stands: only the
 * fields it needs and the ones with a real example — a `"shortCode": "string"`
 * would be refused, or worse, taken.
 */
function sample(schema: Schema | undefined, depth = 0, seen: string[] = [], sendable = false): unknown {
  const { schema: s, seen: path } = resolve(schema, seen);
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (s.enum?.length) return s.enum[0];
  if (s.nullable && depth > 3) return null;
  const name = refName(schema);
  if (name && seen.includes(name)) return {};
  switch (s.type) {
    case 'string':
      return (
        (
          {
            'date-time': '2026-10-05T03:00:00.000Z',
            date: '2026-10-05',
            uuid: '0199b3c4-7d2e-7a10-9c4b-2f6e8d1a5b37',
            uri: 'https://example.com/promo',
            email: 'someone@example.com',
            binary: '(file)',
          } as Record<string, string>
        )[s.format] ?? 'string'
      );
    case 'integer':
    case 'number':
      return s.minimum ?? 0;
    case 'boolean':
      return false;
    case 'array':
      return depth > 4 ? [] : [sample(s.items, depth + 1, path)];
    default: {
      if (s.additionalProperties && !s.properties) return {};
      if (depth > 4 || !s.properties) return {};
      const required = new Set<string>(s.required ?? []);
      const wanted = Object.entries<Schema>(s.properties).filter(([key, value]) => {
        if (!sendable || required.has(key)) return true;
        const resolved = resolve(value).schema;
        return resolved.example !== undefined || value.example !== undefined;
      });
      return Object.fromEntries(wanted.map(([key, value]) => [key, sample(value, depth + 1, path, sendable)]));
    }
  }
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
/**
 * One tag (or one line of an example) as comment lines: nothing that ends the
 * comment, and no line after the tag's first that APIDoc would read as a tag.
 */
function block(text: string): string[] {
  const [first, ...rest] = text.replaceAll('*/', '*\\/').split('\n');
  return [first!, ...rest.map((line) => line.replace(/^(\s*)@/, '$1\\@'))].map((line) => (line ? ` * ${line}` : ' *'));
}

const STATUS_NAMES: Record<string, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  307: 'Temporary Redirect',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

/** `GET /links/{id}/labels` → `GetLinksIdLabels`. */
const nameOf = (method: string, route: string) =>
  [method, ...route.split(/[/{}.\-_]+/)]
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join('');
/** Tag → APIDoc group id, which may not contain spaces: "QR codes" → "QRCodes". */
const groupOf = (tag: string) =>
  tag
    .split(/\s+/)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join('');

/** `public` (no session), `optional` (some answers need one), or `session`. */
function securityOf(operation: Operation): 'public' | 'optional' | 'session' {
  const security = (operation.security ?? spec.security) as Record<string, unknown>[];
  if (security.length === 0) return 'public';
  return security.some((entry) => Object.keys(entry).length === 0) ? 'optional' : 'session';
}

function headersNote(headers: Record<string, Schema> | undefined): string {
  if (!headers) return '';
  return ` Headers: ${Object.entries(headers)
    .map(([name, header]) => `\`${name}\`${header.description ? ` — ${oneLine(header.description)}` : ''}`)
    .join('; ')}.`;
}

function fieldLine(tag: string, group: string, field: Field): string {
  const name = field.defaultValue !== undefined ? `${field.name}=${JSON.stringify(field.defaultValue)}` : field.name;
  return `@${tag}${group ? ` (${group})` : ''} ${field.type} ${field.required ? name : `[${name}]`} ${field.description}`.trimEnd();
}

function comment(
  route: string,
  method: string,
  operation: Operation,
  pathParams: Schema[],
  lang: string,
  order: number,
): string {
  const tag = operation.tags?.[0] ?? 'Other';
  const lines: string[] = [];
  const url = PREFIX + route.replace(/\{(\w+)\}/g, ':$1');
  lines.push(`@api {${method}} ${url} ${oneLine(operation.summary ?? `${method.toUpperCase()} ${route}`)}`);
  lines.push(`@apiLang ${lang}`, `@apiName ${nameOf(method, route)}`, `@apiGroup ${groupOf(tag)}`, '@apiVersion 1.0.0');
  const access = securityOf(operation);
  lines.push(`@apiPermission ${access}`);

  const notes: string[] = [];
  if (operation.description) notes.push(operation.description);
  if (access === 'public') notes.push('**Public:** no session needed.');
  if (access === 'optional') notes.push('**Session optional:** see the description for what needs one.');
  const quiet = Object.entries<Schema>(operation.responses ?? {}).filter(([code, response]) => {
    const json = response.content?.['application/json'];
    return Number(code) < 400 && !json;
  });
  for (const [code, response] of quiet) {
    notes.push(
      `**${code} ${STATUS_NAMES[code] ?? ''}** — ${oneLine(response.description ?? '')}${headersNote(response.headers)}`,
    );
  }
  lines.push(`@apiDescription ${notes.join('\n\n')}`);
  lines.push(`@apiSampleRequest ${url}`);

  const parameters = [...pathParams, ...(operation.parameters ?? [])] as Schema[];
  for (const parameter of parameters) {
    const field: Field = {
      name: parameter.name,
      type: typeWord(parameter.schema ?? {}),
      required: parameter.in === 'path' || Boolean(parameter.required),
      defaultValue: resolve(parameter.schema).schema.default,
      description: describe(parameter, resolve(parameter.schema).schema),
    };
    if (parameter.in === 'path') lines.push(fieldLine('apiParam', '', field));
    else if (parameter.in === 'query') lines.push(fieldLine('apiQuery', '', field));
    else if (parameter.in === 'header') lines.push(fieldLine('apiHeader', '', field));
  }

  const body = operation.requestBody?.content as Record<string, { schema: Schema }> | undefined;
  if (body) {
    const [type, { schema }] = Object.entries(body)[0]!;
    // @apiParam (Body), not @apiBody: APIDoc 5.1.0 parses @apiBody and then
    // drops it when it builds the page — the body would never be shown.
    for (const field of fieldsOf(schema)) lines.push(fieldLine('apiParam', 'Body', field));
    // No @apiParamExample either — 5.1.0 drops those too. The example goes
    // into Try it's Body box instead (see the fixes after the build).
    if (type === 'application/json')
      bodyExamples.set(`${method.toUpperCase()} ${url}`, JSON.stringify(sample(schema, 0, [], true), null, 2));
    else lines[lines.findIndex((line) => line.startsWith('@apiDescription'))] += `\n\n**Body:** \`${type}\`.`;
  }

  for (const [code, response] of Object.entries<Schema>(operation.responses ?? {})) {
    const json = response.content?.['application/json']?.schema as Schema | undefined;
    const status = Number(code);
    if (status >= 400) {
      const name = (STATUS_NAMES[code] ?? `Status ${code}`).replace(/\s+/g, '');
      lines.push(
        `@apiError (${code}) {Object} ${name} ${oneLine(response.description ?? '')}${headersNote(response.headers)}`,
      );
      continue;
    }
    if (json) {
      const fields = fieldsOf(json);
      const group = `${code} ${STATUS_NAMES[code] ?? ''}`.trim();
      if (fields.length === 0)
        lines.push(`@apiSuccess (${group}) {${typeOf(json)}} body ${oneLine(response.description ?? '')}`);
      for (const field of fields) lines.push(fieldLine('apiSuccess', group, field));
      lines.push(`@apiSuccessExample {json} ${group}`, ...JSON.stringify(sample(json), null, 2).split('\n'));
    } else if (response.content) {
      const types = Object.keys(response.content).join(', ');
      lines.push(
        `@apiSuccessExample {text} ${code} ${STATUS_NAMES[code] ?? ''}`.trimEnd(),
        `${types} — ${oneLine(response.description ?? '')}`,
      );
    }
  }

  return [`// ${order}`, '/**', ...lines.flatMap((line) => block(line)), ' */', ''].join('\n');
}

rmSync(out, { recursive: true, force: true });
mkdirSync(src, { recursive: true });

/** A request body to start Try it with, by `METHOD /api/path`. */
const bodyExamples = new Map<string, string>();
/** Where each endpoint sits in the spec, which is the order the sidebar lists them in. */
const rank = new Map<string, number>();
const files = new Map<string, string[]>();
let order = 0;
for (const [route, item] of Object.entries(spec.paths)) {
  const pathParams = (item.parameters ?? []) as Schema[];
  for (const method of METHODS) {
    const operation = item[method] as Operation | undefined;
    if (!operation) continue;
    order += 1;
    rank.set(`${method.toUpperCase()} ${PREFIX}${route.replace(/\{(\w+)\}/g, ':$1')}`, order);
    const group = groupOf(operation.tags?.[0] ?? 'Other');
    const chunks = files.get(group) ?? [];
    for (const lang of LANGS) chunks.push(comment(route, method, operation, pathParams, lang, order));
    files.set(group, chunks);
  }
}
for (const [group, chunks] of files) {
  writeFileSync(
    path.join(src, `${group}.js`),
    `// Generated from src/server/contract/openapi.ts by scripts/build-api-docs.ts — do not edit.\n\n${chunks.join('\n')}`,
  );
}

const config = JSON.parse(readFileSync(path.join(docs, 'apidoc.json'), 'utf8'));
config.url = DOCS_ORIGIN;
config.sampleUrl = DOCS_ORIGIN;
config.order = spec.tags.map((tag) => groupOf(tag.name)).filter((group) => files.has(group));
config.inputs = { endpoints: [src], docs: [path.join(docs, 'guides')] };
const configPath = path.join(out, 'apidoc.json');
writeFileSync(configPath, JSON.stringify(config, null, 2));

execFileSync(path.join(root, 'node_modules/.bin/apidoc'), ['generate', '-c', configPath, '-o', out], {
  stdio: ['ignore', 'ignore', 'inherit'],
});

/*
 * Fixes for APIDoc 5.1.0 with two languages (pinned exactly in package.json —
 * each step checks its anchor and fails the build if the template changed):
 * - the sidebar looks endpoint titles up by language, but the generated index
 *   has one untagged entry per endpoint → titles in every language on the
 *   entry, read by the language in use; endpoints in the spec's order;
 * - groups are titled with their ids → the spec's tag names;
 * - guide pages are listed in reverse and titled from their file names → our
 *   order, and the page's own H1;
 * - Try it's Body box starts empty → it starts with the spec's example body;
 * - Try it's parameter table shows descriptions as raw HTML → as plain text;
 * - a guide is drawn by a generic component that heads every field ("Html",
 *   "Icon", "Generated At") and runs the HTML through a markdown-ish pass that
 *   turns `utm_*` into italics → the guide's HTML as it is, under the page's
 *   own title (so without the guide's H1 a second time).
 */
const file = path.join(out, 'index.html');
let html = readFileSync(file, 'utf8');
const DATA = /window\.__APICAT_DATA__ = (\{.*\})\s*;?\s*\n/;
const match = html.match(DATA);
if (!match) throw new Error('APIDoc output changed: __APICAT_DATA__ not found');
const data = JSON.parse(match[1]!);

const byId = new Map<string, any>(
  Object.values<any>(data.api)
    .flatMap((shard) => shard.endpoints)
    .map((endpoint: any) => [endpoint.id, endpoint]),
);
const titlesOf = (id: string) =>
  Object.fromEntries(Object.entries<any>(byId.get(id)?.languages ?? {}).map(([lang, value]) => [lang, value.title]));
data['api.index'].endpoints = data['api.index'].endpoints.map((entry: any) => ({
  ...entry,
  titles: titlesOf(entry.id),
}));
const rankOf = (id: string) => {
  const entry = data['api.index'].endpoints.find((each: any) => each.id === id);
  return entry ? (rank.get(`${entry.method} ${entry.path}`) ?? 999) : 999;
};
const tagTitle = new Map(spec.tags.map((tag) => [groupOf(tag.name), tag.name]));
for (const group of data.navigation.groups) {
  group.endpoints.sort((a: string, b: string) => rankOf(a) - rankOf(b));
  group.title = tagTitle.get(group.id) ?? group.title;
}
for (const endpoint of byId.values()) {
  const example = bodyExamples.get(`${endpoint.method} ${endpoint.url}`);
  if (!example) continue;
  // On the endpoint, each version and each language of either: the page builds
  // what it shows from whichever of those it is looking at.
  for (const version of [endpoint, ...(Array.isArray(endpoint.versions) ? endpoint.versions : [])]) {
    version.bodyExample = example;
    for (const variant of Object.values<any>(version.languages ?? {})) variant.bodyExample = example;
  }
}
const missing = [...rank.keys()].filter(
  (key) => !data['api.index'].endpoints.some((entry: any) => `${entry.method} ${entry.path}` === key),
);
if (missing.length) throw new Error(`APIDoc dropped ${missing.length} endpoint(s): ${missing.slice(0, 5).join(', ')}`);

for (const guide of Object.values<any>(data.docs ?? {})) {
  if (typeof guide?.html === 'string') guide.html = guide.html.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/, '');
}

// The IoT / code indexes this build has none of: present and empty, so the page does not fetch
// /data/cat.iot.index.json and /data/cat.code.index.json (404s) looking for them.
data['iot.index'] = { elements: [] };
data['code.index'] = { elements: [] };

const listed = data.cat.docs;
const guides = Object.keys(listed)
  .filter((key) => !['header', 'footer'].includes(key) && !key.startsWith('group.'))
  .sort();
data.cat.docs = Object.fromEntries(
  ['header', 'footer', ...guides, ...Object.keys(listed).filter((key) => key.startsWith('group.'))]
    .filter((key) => key in listed)
    .map((key) => [key, listed[key]]),
);

const NAV_LOOKUP = 'Cr.id===vr&&(!_r||Cr.lang===_r)';
const NAV_TITLE = 'title:(Br==null?void 0:Br.summary)||formatEndpointTitle(vr)';
if (!html.includes(NAV_LOOKUP) || !html.includes(NAV_TITLE))
  throw new Error('APIDoc template changed: sidebar anchors not found');
const LIST =
  'ar.push({filename:ur.split("/").pop(),directory:"cat.docs",path:ur,key:lr,title:formatFileName(ur.split("/").pop())})';
if (!html.includes(LIST)) throw new Error('APIDoc template changed: docs list anchor not found');
const TRY_IT_OPENED = '["POST","PUT","PATCH"].includes(sr.endpoint.method)&&(gr.value="body")},{immediate:!0})';
if (!html.includes(TRY_IT_OPENED)) throw new Error('APIDoc template changed: Try it endpoint watcher not found');
const TRY_IT_NOTE = 'title:vn.description},toDisplayString$1(vn.description||"-")';
if (!html.includes(TRY_IT_NOTE)) throw new Error('APIDoc template changed: Try it description cell not found');
const GUIDE_HIDDEN = 'ir=["name","title","version","description","type","filename","relativePath"]';
const GUIDE_HEADING = 'sr(vr)?createCommentVNode("",!0):(openBlock(),createElementBlock("h2"';
const GUIDE_BODY = 'createElementBlock("div",{key:1,innerHTML:ur(yr)}';
for (const anchor of [GUIDE_HIDDEN, GUIDE_HEADING, GUIDE_BODY]) {
  if (!html.includes(anchor)) throw new Error('APIDoc template changed: guide renderer anchors not found');
}
// Tags dropped, then entities decoded by a textarea — which parses but never runs anything.
const PLAIN =
  '(()=>{const t=document.createElement("textarea");t.innerHTML=String(vn.description||"-").replace(/<[^>]*>/g,"");return t.value})()';

// jsPDF (the page's PDF export) bundles DOMPurify 3.3.0, which has known sanitizer bypasses: its whole
// module — from the license comment to its one export — becomes the pinned devDependency's build
const PURIFY_START = '/*! @license DOMPurify 3.3.0';
const PURIFY_END = 'var purify=createDOMPurify();';
const purifyFrom = html.indexOf(PURIFY_START);
const purifyTo = html.indexOf(PURIFY_END, purifyFrom);
if (purifyFrom < 0 || purifyTo < 0 || html.includes(PURIFY_START, purifyFrom + 1))
  throw new Error('APIDoc template changed: bundled DOMPurify module not found');
const PURIFY_EXPORT = /var purify_default = createDOMPurify\(\);\s*export \{ purify_default as default \};[\s\S]*$/;
const purifyEs = readFileSync(path.join(root, 'node_modules/dompurify/dist/purify.es.mjs'), 'utf8');
if (!PURIFY_EXPORT.test(purifyEs)) throw new Error('dompurify build changed: its default export not found');
html =
  html.slice(0, purifyFrom) +
  `var purify=(()=>{${purifyEs.replace(PURIFY_EXPORT, 'return createDOMPurify();')}})();` +
  html.slice(purifyTo + PURIFY_END.length);

html = html
  .replace(DATA, () => `window.__APICAT_DATA__ = ${JSON.stringify(data)};\n`)
  .replace(
    LIST,
    LIST.replace('title:formatFileName(', 'title:(window.__APICAT_DATA__.docs?.[lr]?.title)||formatFileName('),
  )
  .replace(TRY_IT_OPENED, () =>
    TRY_IT_OPENED.replace('},{immediate', ',vr.body=sr.endpoint.bodyExample||""},{immediate'),
  )
  .replaceAll(TRY_IT_NOTE, () => `title:${PLAIN}},toDisplayString$1(${PLAIN})`)
  .replace(GUIDE_HIDDEN, () => GUIDE_HIDDEN.replace('"relativePath"]', '"relativePath","icon","generatedAt"]'))
  .replace(GUIDE_HEADING, () => GUIDE_HEADING.replace('sr(vr)?', 'sr(vr)||vr==="html"?'))
  .replace(
    GUIDE_BODY,
    () =>
      'createElementBlock("div",{key:1,class:vr==="html"?"prose dark:prose-invert max-w-none custom-markdown":void 0,innerHTML:vr==="html"?yr:ur(yr)}',
  )
  .replace(NAV_LOOKUP, 'Cr.id===vr')
  .replace(NAV_TITLE, 'title:(Br==null?void 0:(Br.titles&&Br.titles[_r])||Br.summary)||formatEndpointTitle(vr)')
  .replace('<title>APIDoc v5 - Documentation</title>', '<title>OneService API</title>')
  // Spanish defaults the English UI falls back to.
  .replaceAll(
    '"Referencia completa de todos los endpoints de la API"',
    '"Every OneService API endpoint · API ทั้งหมดของ OneService"',
  )
  .replace('},"Respuesta",-1)', '},"Response",-1)')
  .replace('("api.tryIt","Enviar una petición de ejemplo")', '("api.tryIt","Try it")');

/*
 * One language switch, ไทย / English (the header's): APIDoc ships seven UI languages and no Thai,
 * and a second per-endpoint switch whose TH changed nothing (every endpoint has the same English
 * text in both). The header offers ไทย and English instead, ไทย = the English words with the visible
 * ones in Thai, picking one also sets the content language, and the per-endpoint box is gone.
 * Plus the requests that only ever 404: /data/home.md and /favicon.svg (/favicon.ico).
 */
const THAI_UI = {
  nav: {
    home: 'หน้าแรก',
    docs: 'เอกสาร',
    expandAll: 'ขยายทั้งหมด',
    collapseAll: 'ย่อทั้งหมด',
    apiReference: 'API ทั้งหมด',
    apiReferenceDescription: 'ทุก endpoint ของ API',
    documentation: 'เอกสาร',
    documentationDescription: 'คู่มือและเอกสารทั่วไป',
  },
  homepage: {
    exploreApi: 'ดู API',
    apiStatistics: 'สถิติ API',
    totalEndpoints: 'จำนวน endpoint',
    apiGroups: 'กลุ่ม API',
    endpointsByMethod: 'Endpoint ตาม HTTP method',
    apiGroupsList: 'กลุ่ม API',
    quickAccess: 'ทางลัด',
    guidesAndTutorials: 'คู่มือ',
    completeApiDocumentation: 'เอกสาร API ทั้งหมด',
  },
  api: {
    description: 'คำอธิบาย',
    parameters: 'พารามิเตอร์',
    response: 'คำตอบ',
    responses: 'คำตอบ',
    success: 'สำเร็จ',
    error: 'ข้อผิดพลาด',
    examples: 'ตัวอย่าง',
    tryIt: 'ลองเรียก',
    send: 'ส่ง',
    sending: 'กำลังส่ง…',
    request: 'คำขอ',
    version: 'เวอร์ชัน',
  },
  search: {
    placeholder: 'ค้นหาในเอกสาร…',
    noResults: 'ไม่พบผลลัพธ์สำหรับ "{query}"',
    typeToSearch: 'พิมพ์เพื่อค้นหา',
  },
  docs: { title: 'เอกสาร', documentation: 'เอกสาร' },
  common: {
    loading: 'กำลังโหลด…',
    error: 'ข้อผิดพลาด',
    required: 'จำเป็น',
    optional: 'ไม่บังคับ',
    default: 'ค่าเริ่มต้น',
    type: 'ชนิด',
    name: 'ชื่อ',
    value: 'ค่า',
    close: 'ปิด',
    copy: 'คัดลอก',
    copied: 'คัดลอกแล้ว',
    language: 'ภาษา',
    tableOfContents: 'สารบัญ',
  },
  messages: { noEndpointsAvailable: 'ไม่มี endpoint ในหมวดนี้' },
};
/** `en` with THAI_UI laid over it, built in the page (the bundle's own `en` messages) */
const THAI_MESSAGES = `((b,o)=>{const m=(a,c)=>{for(const k in c)a[k]=c[k]&&typeof c[k]=="object"?m({...a[k]},c[k]):c[k];return a};return m({...b},o)})(en,${JSON.stringify(THAI_UI)})`;
const LANG_NAMES = '{es:"Español",en:"English",zh:"中文",pt:"Português",fr:"Français",de:"Deutsch",ja:"日本語"}';
const FIXES: [anchor: string, replacement: string, count?: number][] = [
  ['messages:{es,en,zh:zhCN,pt:ptBR,fr,de,ja}', `messages:{en,th:${THAI_MESSAGES}}`],
  ['supportedLocales=["es","en","zh","pt","fr","de","ja"]', 'supportedLocales=["th","en"]'],
  ['typeof navigator>"u")return"es"', 'typeof navigator>"u")return"th"'],
  ['return supportedLocales.includes(rr)?rr:"es"', 'return supportedLocales.includes(rr)?rr:"th"'],
  // a language saved by the old menu (ja, es, …) no longer exists → start from the browser's / ไทย
  [
    'typeof localStorage>"u"?"es":localStorage.getItem("apidoc-locale")||getBrowserLocale()',
    'typeof localStorage>"u"?"th":supportedLocales.find(l=>l===localStorage.getItem("apidoc-locale"))||getBrowserLocale()',
  ],
  ['fallbackLocale:"es"', 'fallbackLocale:"en"'],
  [LANG_NAMES, '{th:"ไทย",en:"English"}', 2],
  ['renderList(["es","en","zh","pt","fr","de","ja"]', 'renderList(["th","en"]'],
  ['gr=localStorage.getItem("apicat_language")', 'gr=i18n.global.locale.value'],
  ['console.log("Changing language to:",vr),rr.value=vr,', 'rr.value=vr,useDocsStore().setLanguage(vr),'],
  ['changeLang=nr=>{locale.value=nr,', 'changeLang=nr=>{locale.value=nr,useDocsStore().setLanguage(nr),'],
  [
    'ur.value&&!cr.value?(openBlock(),createElementBlock("div",_hoisted_12$c',
    '!1?(openBlock(),createElementBlock("div",_hoisted_12$c',
  ],
  ['await fetch("/data/home.md")', '{ok:!1}'],
  [
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg">\n  <link rel="alternate icon" href="/favicon.ico">',
    // an empty icon also stops the browser's /favicon.ico request
    '<link rel="icon" href="data:,">',
  ],
  ['<html lang="es">', '<html lang="th">'],
];
for (const [anchor, replacement, count = 1] of FIXES) {
  if (html.split(anchor).length - 1 !== count) throw new Error(`APIDoc template changed: ${anchor.slice(0, 60)}`);
  html = html.replaceAll(anchor, () => replacement);
}
writeFileSync(file, html);
console.log(`API docs → ${path.relative(root, file)} (${order} endpoints)`);
