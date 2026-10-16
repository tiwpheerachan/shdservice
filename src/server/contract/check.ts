import { z } from 'zod';
import { log } from '@/lib/log';
import { registry } from './index';

/**
 * The contract, held to what the routes actually send — outside production only.
 *
 * checked() (src/server/auth.ts — handle() uses it) passes every response here: the operation is
 * found by method and path, and the body is parsed with the schema declared for its status. A field
 * the schema does not name is drift as much as a wrong type. Non-JSON bodies (redirects, xlsx) are
 * checked for their media type only. Drift is a log line "API contract drift" under `next dev`, and
 * an exception with API_CONTRACT_STRICT=1 (the tests) — the response itself is never changed.
 */

type Content = Record<string, { schema?: unknown }>;

const routes = registry.definitions
  .flatMap((definition) => (definition.type === 'route' ? [definition.route] : []))
  .map((route) => ({
    method: route.method.toUpperCase(),
    path: route.path,
    pattern: new RegExp(`^/api${route.path.replace(/\./g, '\\.').replace(/\{\w+\}/g, '[^/]+')}$`),
    responses: route.responses as Record<string, { content?: Content }>,
  }))
  // a literal segment wins over a parameter: /jobs/assign is not /jobs/{no}
  .sort((a, b) => a.path.split('{').length - b.path.split('{').length);

/** `GET /jobs/{no} 200` for every response that matched its declaration — read by scripts/test-api.mts. */
export const checked = new Set<string>();

/** What is wrong with this response against the contract, or undefined. */
export async function responseProblem(request: Request, response: Response): Promise<string | undefined> {
  const { pathname } = new URL(request.url);
  const route = routes.find((each) => each.method === request.method && each.pattern.test(pathname));
  // not an operation (e.g. /api/data/<unknown>) — scripts/test-openapi.mts is what insists every route is one
  if (!route) return undefined;

  const name = `${route.method} ${route.path} ${response.status}`;
  const declared = route.responses[response.status];
  if (!declared) {
    // the opaque 500 of handle() is every operation's and no operation's
    return response.status === 500 ? undefined : `${name}: status not declared`;
  }

  const content = declared.content ?? {};
  const type = response.headers.get('content-type')?.split(';')[0]?.trim();
  if (!type || response.body === null) {
    if (Object.keys(content).length) return `${name}: declares a body, sent none`;
  } else if (!(type in content)) {
    return `${name}: sent ${type}, declared ${Object.keys(content).join(', ') || 'no body'}`;
  } else if (type === 'application/json') {
    const sent: unknown = await response.clone().json();
    const result = (content[type]!.schema as z.ZodType).safeParse(sent);
    if (!result.success) return `${name}:\n${z.prettifyError(result.error)}`;
    const extra = undocumented(sent, result.data);
    if (extra.length) return `${name}: fields the contract does not declare: ${extra.join(', ')}`;
  }
  checked.add(name);
  return undefined;
}

/** Log (dev) or throw (API_CONTRACT_STRICT=1) when the response breaks the contract. */
export async function checkResponse(request: Request, response: Response): Promise<void> {
  const problem = await responseProblem(request, response);
  if (!problem) return;
  if (process.env.API_CONTRACT_STRICT === '1') throw new Error(`API contract drift — ${problem}`);
  log.warn('API contract drift', { problem });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Paths present in what was sent and gone from what the schema parsed: the keys it strips. */
function undocumented(sent: unknown, parsed: unknown, at = ''): string[] {
  if (Array.isArray(sent) && Array.isArray(parsed)) {
    return sent.flatMap((item, index) => undocumented(item, parsed[index], `${at}[${index}]`));
  }
  if (!isRecord(sent) || !isRecord(parsed)) return [];
  return Object.keys(sent).flatMap((key) => {
    const path = at ? `${at}.${key}` : key;
    return key in parsed ? undocumented(sent[key], parsed[key], path) : [path];
  });
}
