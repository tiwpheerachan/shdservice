import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registry } from './index';

/**
 * The description of /api, in OpenAPI 3.0: served at /api/openapi.json and built into /api-docs
 * by scripts/build-api-docs.ts. Generated from the declarations in this folder; only what no single
 * operation owns is written here. 3.0, not 3.1: the docs build reads 3.0's `nullable`.
 */

/**
 * The origin the docs page is built with, swapped by src/app/api-docs/route.ts for the request's own
 * so Try it calls the deployment serving the page. `.invalid` never resolves: an unswapped page
 * fails loudly instead of calling somewhere real.
 */
export const DOCS_ORIGIN = 'https://oneservice-docs.invalid';

const description = [
  'The API the OneService pages call — for the internal team. Every path is under `/api`.',
  '',
  '**Sign-in.** The `os_session` cookie, set by `/api/sso/callback` after the central SSO. No API keys:',
  'a script calls the API as a signed-in person would. 30 minutes idle (renewed by `/api/sso/refresh`),',
  "12 hours at most; signing out bumps the user's session_version, so every cookie of theirs dies.",
  'Permissions come from the role (app_config): view / add / edit / del per module, plus special rights.',
  '',
  '**Writes.** A body is JSON with `Content-Type: application/json` (anything else is 415 — the CSRF rule,',
  'with the proxy refusing cross-site writes), at most 1 MB. Uploads are multipart.',
  '',
  '**Errors.** `{ "error": "<Thai message>" }`, plus `details` when there is more: `details.fields` =',
  '{ field: message } for a failed form rule (400), `details.stale` for an edit someone saved first (409).',
  'An unexpected error is a 500 with `ref` — the details are in the server log.',
  '',
  '**Idempotency-Key** on create POSTs: the same key again gets the stored answer, never a second document.',
  '',
  '**row_version.** Edits send back the `version` they loaded; if the row moved since → 409 `details.stale`.',
  '',
  '**Public paths** (no session): `/api/health`, `/api/sso/*`, `/api/track/*` (the customer tracking page,',
  'fail-closed), and the public logo folders of `/api/files`.',
].join('\n');

const tags = [
  { name: 'Jobs', description: 'งานซ่อม — the job screens.' },
  { name: 'Customers' },
  { name: 'Quotations', description: 'ใบเสนอราคา' },
  { name: 'Sale orders', description: 'ใบสั่งขาย' },
  { name: 'Documents' },
  { name: 'Products', description: 'อะไหล่' },
  { name: 'Stock', description: 'รับเข้า / จ่ายออก' },
  { name: 'Alerts', description: 'The notification bell.' },
  { name: 'Files' },
  {
    name: 'Data',
    description: 'The read side of the pages: GET /api/data/{resource} (one route; each resource its own shape).',
  },
  { name: 'Admin', description: 'System Admin screens.' },
  { name: 'Sign-in', description: 'Central SSO. Browser navigations, not fetches (except me / refresh).' },
  { name: 'Public tracking', description: 'The customer tracking page (/track). No session cookie.' },
  { name: 'Public', description: 'Reachable without a session.' },
  { name: 'Docs' },
];

registry.registerComponent('securitySchemes', 'session', {
  type: 'apiKey',
  in: 'cookie',
  name: 'os_session',
  description: 'Set by signing in (/api/sso/login). The browser sends it — nothing to paste.',
});

const generated = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.3',
  info: { title: 'OneService API', version: '1.0.0', description },
  servers: [{ url: '/api' }],
  tags,
  security: [{ session: [] }],
});

/** Paths in reading order: by tag as `tags` lists them, then path, then GET, POST, PUT, PATCH, DELETE. */
function ordered(paths: NonNullable<typeof generated.paths>): typeof paths {
  const VERBS = ['get', 'post', 'put', 'patch', 'delete'];
  const tagOf = (item: Record<string, { tags?: string[] }>) =>
    tags.findIndex((tag) => tag.name === Object.values(item)[0]?.tags?.[0]);
  return Object.fromEntries(
    Object.entries(paths)
      .sort(([a, x], [b, y]) => tagOf(x as never) - tagOf(y as never) || a.localeCompare(b))
      .map(([path, item]) => [
        path,
        Object.fromEntries(Object.entries(item).sort(([a], [b]) => VERBS.indexOf(a) - VERBS.indexOf(b))),
      ]),
  );
}

// a fixed top-level key order (the snapshot test compares it as text)
export const openapi = {
  openapi: generated.openapi,
  info: generated.info,
  servers: generated.servers,
  tags: generated.tags,
  paths: ordered(generated.paths ?? {}),
  components: { schemas: generated.components?.schemas ?? {}, securitySchemes: generated.components?.securitySchemes },
  security: generated.security,
};
