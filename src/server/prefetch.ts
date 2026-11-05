import 'server-only';
import { headers } from 'next/headers';
import { NextRequest } from 'next/server';
import { GET as dataGet } from '@/app/api/data/[resource]/route';
import { GET as jobGet } from '@/app/api/jobs/[id]/route';
import { GET as quotationGet } from '@/app/api/quotations/[id]/route';
import { GET as auditGet } from '@/app/api/audit/route';
import { GET as documentProfilesGet } from '@/app/api/admin/document-profiles/route';
import { PREFETCH_ID, PREFETCH_PACKED } from '@/data/keys';
import { pack } from '@/lib/obscure';

/**
 * A page's first data, read while the server renders it so it arrives in the HTML instead of after hydration.
 * Not a second way to read data: each URL is answered by its OWN route handler, called in-process with the browser's
 * headers — same sign-in, permission and contract checks, same rate limit; a refusal is left out for the hook to
 * fetch itself. After `timeoutMs` the page renders with what has answered. PREFETCH_ID tells <Prefetched> a
 * back/forward replay was already seeded.
 */
const ROUTES: [RegExp, (req: NextRequest, segment: string) => Promise<Response>][] = [
  [/^\/api\/data\/([^/]+)$/, (req, resource) => dataGet(req, { params: Promise.resolve({ resource }) })],
  [/^\/api\/jobs\/([^/]+)$/, (req, id) => jobGet(req, { params: Promise.resolve({ id }) })],
  [/^\/api\/quotations\/([^/]+)$/, (req, id) => quotationGet(req, { params: Promise.resolve({ id }) })],
  // the audit log (no path parameter: the group is only what `segment` reads)
  [/^\/api\/(audit)$/, (req) => auditGet(req)],
  [/^\/api\/admin\/(document-profiles)$/, (req) => documentProfilesGet(req)],
];

export async function prefetch(urls: string[], opts: { timeoutMs?: number } = {}): Promise<Record<string, unknown>> {
  return packPrefetched(await prefetchRaw(urls, opts));
}

/**
 * <Prefetched>'s payload: the answers packed (they hold e-mail addresses, and none may be in the server HTML —
 * src/lib/obscure.ts); <Prefetched> unpacks them. For a page that reads an answer itself first (prefetchRaw).
 */
export function packPrefetched(all: Record<string, unknown>): Record<string, unknown> {
  const { [PREFETCH_ID]: id, ...answers } = all;
  return { [PREFETCH_PACKED]: pack(JSON.stringify(answers)), [PREFETCH_ID]: id ?? crypto.randomUUID() };
}

/** prefetch(), the answers as they are (not packed) — a page that reads one itself, then packPrefetched() */
export async function prefetchRaw(urls: string[], { timeoutMs = 1500 } = {}): Promise<Record<string, unknown>> {
  const incoming = await headers(); // also makes the page dynamic: rendered per request, never cached
  const origin = `http://${incoming.get('host') ?? 'localhost'}`;
  const done: Record<string, unknown> = {};
  const calls = urls.map(async (url) => {
    try {
      const u = new URL(url, origin);
      const route = ROUTES.find(([re]) => re.test(u.pathname));
      if (!route) return;
      // the segment as Next.js hands it to the handler: decoded
      const segment = decodeURIComponent(route[0].exec(u.pathname)![1]!);
      const res = await route[1](new NextRequest(u, { headers: new Headers(incoming) }), segment);
      if (res.ok) done[url] = await res.json();
    } catch {
      // left out: the hook reads it and shows the error itself
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.all(calls), new Promise((r) => (timer = setTimeout(r, timeoutMs)))]);
  clearTimeout(timer);
  // a copy: an answer that lands after the deadline must not join while it renders
  return { ...done, [PREFETCH_ID]: crypto.randomUUID() };
}

/** a page's `searchParams` as the URLSearchParams the browser's useSearchParams() would give */
export function searchOf(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp))
    for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) out.append(k, one);
  return out;
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
