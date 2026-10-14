import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/**
 * A stand-in for the central SSO, for the e2e tests only (OneLink's fake, with OneService's calls).
 * A sign-in runs through the app's real code: /api/sso/login → here → /api/sso/callback, which
 * trades the code at /sso/verify with its client secret and seals its own session cookie.
 *
 *   GET  /api/v1/sso/authorize      sign-in form (email + name); submit → redirect_uri?code&state.
 *                                   Unknown client / unregistered redirect_uri = 400, as for real.
 *   POST /api/v1/sso/verify         {code, client_id, client_secret} → {sub, email, name, iat}
 *                                   (top level — what api/sso/callback reads). A code works once.
 *   POST /api/v1/sso/session        {client_id, client_secret, sub} → {active} (false once revoked)
 *   GET  /api/v1/directory/user     Bearer CENTRAL_API_KEY → {ok, person}
 *   GET  /api/v1/directory/search   Bearer CENTRAL_API_KEY → no one
 *   POST /__e2e/revoke              {sub} — the tests' lever: that central session is over
 *
 * Plain node:http, nothing imported from the app: its settings come from playwright.config.ts.
 */

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`fake-sso: ${name} is not set`);
  return value;
};

const PORT = Number(env('FAKE_SSO_PORT'));
const CLIENT_ID = env('SSO_CLIENT_ID');
const CLIENT_SECRET = env('SSO_CLIENT_SECRET');
const API_KEY = env('CENTRAL_API_KEY');
/** the one callback registered for this client */
const REDIRECT_URI = env('FAKE_SSO_REDIRECT_URI');
const CODE_TTL_MS = 60_000;

const codes = new Map<string, { email: string; name: string; expires: number }>();
const revoked = new Set<string>();

/** stable per email, like the real (permanent) sub */
const subFor = (email: string) => `e2e-${createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16)}`;

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
}

const escape = (value: string) => value.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function form(params: URLSearchParams): string {
  const hidden = ['client_id', 'redirect_uri', 'state']
    .map((name) => `<input type="hidden" name="${name}" value="${escape(params.get(name) ?? '')}">`)
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fake SSO</title></head><body>
<main><h1>Fake SSO</h1>
<form method="post" action="/api/v1/sso/authorize">${hidden}
<label>Email <input type="email" name="email" required></label>
<label>Name <input type="text" name="name"></label>
<button type="submit">Continue</button>
</form></main></body></html>`;
}

const badClient = (params: URLSearchParams) =>
  params.get('client_id') !== CLIENT_ID || params.get('redirect_uri') !== REDIRECT_URI || !params.get('state');

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);
  const route = `${request.method} ${url.pathname}`;
  try {
    if (route === 'GET /health') return json(response, 200, { ok: true });

    if (route === 'GET /api/v1/sso/authorize') {
      if (badClient(url.searchParams)) return json(response, 400, { error: 'invalid_client_or_redirect_uri' });
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(form(url.searchParams));
      return;
    }

    if (route === 'POST /api/v1/sso/authorize') {
      const params = new URLSearchParams(await body(request));
      if (badClient(params)) return json(response, 400, { error: 'invalid_client_or_redirect_uri' });
      const email = params.get('email')?.trim() ?? '';
      const code = randomUUID();
      codes.set(code, {
        email,
        name: params.get('name')?.trim() || (email.split('@')[0] ?? email),
        expires: Date.now() + CODE_TTL_MS,
      });
      const back = new URL(REDIRECT_URI);
      back.searchParams.set('code', code);
      back.searchParams.set('state', params.get('state')!);
      response.writeHead(302, { location: back.toString() }).end();
      return;
    }

    if (route === 'POST /api/v1/sso/verify') {
      const input = JSON.parse(await body(request)) as { code?: string; client_id?: string; client_secret?: string };
      if (input.client_id !== CLIENT_ID || input.client_secret !== CLIENT_SECRET)
        return json(response, 401, { error: 'invalid_client' });
      const grant = input.code ? codes.get(input.code) : undefined;
      if (input.code) codes.delete(input.code);
      if (!grant || grant.expires < Date.now()) return json(response, 400, { error: 'invalid_code' });
      return json(response, 200, {
        sub: subFor(grant.email),
        email: grant.email,
        name: grant.name,
        iat: Math.floor(Date.now() / 1000),
      });
    }

    if (route === 'POST /api/v1/sso/session') {
      const input = JSON.parse(await body(request)) as { client_id?: string; client_secret?: string; sub?: string };
      if (input.client_id !== CLIENT_ID || input.client_secret !== CLIENT_SECRET)
        return json(response, 401, { error: 'invalid_client' });
      return json(response, 200, { active: !revoked.has(input.sub ?? '') });
    }

    if (url.pathname.startsWith('/api/v1/directory/') && request.headers.authorization !== `Bearer ${API_KEY}`)
      return json(response, 401, { error: 'missing_api_key' });

    if (route === 'GET /api/v1/directory/user') {
      const email = (url.searchParams.get('email') ?? '').toLowerCase();
      return json(response, 200, {
        ok: true,
        synced_at: new Date().toISOString(),
        stale: false,
        person: {
          union_id: subFor(email),
          name: email.split('@')[0],
          email,
          departments: [],
          job_title: '',
          avatar_url: '',
          status: 'active',
        },
      });
    }

    if (route === 'GET /api/v1/directory/search')
      return json(response, 200, { ok: true, items: [], synced_at: new Date().toISOString(), stale: false });

    if (route === 'POST /__e2e/revoke') {
      revoked.add((JSON.parse(await body(request)) as { sub: string }).sub);
      response.writeHead(204).end();
      return;
    }

    json(response, 404, { error: 'not_found', route });
  } catch (error) {
    json(response, 500, { error: String(error) });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`fake-sso listening on http://127.0.0.1:${PORT}`));
