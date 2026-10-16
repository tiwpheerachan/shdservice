import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { handle, requireUser } from '@/server/auth';
import { DOCS_ORIGIN } from '@/server/contract/openapi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api-docs: the APIDoc page built by `npm run docs:api` (src/server/contract → .apidoc/index.html),
 * for any approved user — the same people who can call the API (OneLink: anyone with any access).
 * No session cookie → proxy.ts sends the browser to /login first.
 *
 * Its inline scripts get a per-response nonce (next.config.mjs leaves this path's CSP to us). Try it
 * calls this host (the build's placeholder origin is swapped in) with the viewer's own session.
 */

let built: string | null = null;

async function page(): Promise<string | null> {
  if (built && process.env.NODE_ENV === 'production') return built;
  try {
    built = await readFile(path.join(process.cwd(), '.apidoc', 'index.html'), 'utf8');
    return built;
  } catch {
    return null;
  }
}

/**
 * The origin this page was requested on — not APP_BASE_URL (lib/sso appOrigin): a dev server on
 * another port or a preview host must have Try it call itself, since the CSP allows nothing else.
 */
function servedFrom(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!host) return new URL(req.url).origin;
  const proto =
    req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
    (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

export const GET = handle(async (req: NextRequest) => {
  await requireUser(req);
  const html = await page();
  if (!html) return new Response('The API docs are not built. Run: npm run docs:api', { status: 404 });

  const nonce = randomBytes(16).toString('base64');
  const body = html.replaceAll(DOCS_ORIGIN, servedFrom(req)).replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`);
  return new Response(body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
      'content-security-policy': [
        "default-src 'self'",
        // APIDoc's bundle compiles Vue templates at runtime (new Function), so this page alone allows
        // eval. Its content is our own static build, and the session cookie is httpOnly.
        `script-src 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    },
  });
});
