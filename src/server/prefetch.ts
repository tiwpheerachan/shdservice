import 'server-only';
import { headers } from 'next/headers';
import { NextRequest } from 'next/server';
import { GET as dataGet } from '@/app/api/data/[resource]/route';
import { GET as jobGet } from '@/app/api/jobs/[id]/route';
import { GET as quotationGet } from '@/app/api/quotations/[id]/route';
import { GET as auditGet } from '@/app/api/audit/route';
import { GET as documentProfilesGet } from '@/app/api/admin/document-profiles/route';
import { PREFETCH_ID } from '@/data/keys';

/**
 * A page's first data, read while the server renders it, so it arrives in the HTML instead of after
 * hydration (the client hooks would only ask once the JS has run — seconds on a slow phone).
 *
 * Not a second way to read data: each URL is answered by its OWN route handler, called in-process with
 * the browser's request headers (session cookie included) — the same sign-in, permission, input and
 * contract checks, the same rate limit, the same JSON. Whatever the API would refuse this user is
 * refused here too and simply left out; the page's hook then asks for it itself and shows the usual
 * answer (refusal, error).
 *
 * Give it the hooks' own keys (src/data/keys.ts); hand the result to <Prefetched> (src/data/db.ts).
 * All calls run in parallel; after `timeoutMs` the page renders with what has answered so far, so a slow
 * database never holds the HTML back for long (a late answer is dropped — its hook fetches it).
 * The result also carries a fresh id under PREFETCH_ID: back/forward replays this payload, and the id
 * tells <Prefetched> it has seeded these (by then older) answers already.
 */
const ROUTES: [RegExp, (req: NextRequest, segment: string) => Promise<Response>][] = [
  [/^\/api\/data\/([^/]+)$/, (req, resource) => dataGet(req, { params: Promise.resolve({ resource }) })],
  [/^\/api\/jobs\/([^/]+)$/, (req, id) => jobGet(req, { params: Promise.resolve({ id }) })],
  [/^\/api\/quotations\/([^/]+)$/, (req, id) => quotationGet(req, { params: Promise.resolve({ id }) })],
  // the audit log (no path parameter: the group is only what `segment` reads)
  [/^\/api\/(audit)$/, (req) => auditGet(req)],
  [/^\/api\/admin\/(document-profiles)$/, (req) => documentProfilesGet(req)],
];

export async function prefetch(urls: string[], { timeoutMs = 1500 } = {}): Promise<Record<string, unknown>> {
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
