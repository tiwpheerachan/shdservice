/**
 * Server log: one JSON object per line, so Render's log search can filter by
 * field ({"level":"error","reqId":"…"}). Never log request bodies, cookies, query
 * strings or OTP codes. Errors go through scrubError(): drizzle writes the bound
 * query parameters into the message and stack ("\nparams: …") — customer names,
 * phones, addresses, track tokens — and those must not reach the log store.
 *
 * No node: imports — the proxy (src/proxy.ts) logs through this too.
 */
type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const EMAIL = /[^\s@"'<>,;:()]+@[^\s@"'<>,;:()]+\.[^\s@"'<>,;:()]+/g;

/** Up to the stack frames, not the end of the line: a parameter can hold a newline of its own. */
export function scrubText(s: string): string {
  return s.replace(/\nparams: [\s\S]*?(?=\n\s+at |$)/, '\nparams: [redacted]').replace(EMAIL, '[email]');
}

/** An error as a log field: name, code, message and stack (scrubbed), and its cause one level down. */
export function scrubError(e: unknown, depth = 0): unknown {
  if (!(e instanceof Error)) return typeof e === 'string' ? scrubText(e) : e;
  const code = (e as { code?: unknown }).code;
  return {
    name: e.name,
    ...(code !== undefined ? { code } : {}),
    message: scrubText(e.message).slice(0, 2000),
    stack: e.stack ? scrubText(e.stack).split('\n').slice(0, 15).join('\n') : undefined,
    ...(e.cause !== undefined && depth < 2 ? { cause: scrubError(e.cause, depth + 1) } : {}),
  };
}

/** Ties one request's lines together: Cloudflare's ray id (same id as Cloudflare's logs), else Render's, else new. */
export function requestId(req?: { headers: Headers }): string {
  const h = req?.headers;
  return h?.get('cf-ray') || h?.get('rndr-id') || h?.get('x-request-id') || crypto.randomUUID().slice(0, 12);
}

function write(level: Level, msg: string, fields: Fields) {
  let line: string;
  try {
    line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields });
  } catch {
    // one circular / BigInt field must not cost the error itself: keep the ids and err
    const { err, reqId, ref } = fields as { err?: unknown; reqId?: unknown; ref?: unknown };
    line = JSON.stringify({
      level,
      time: new Date().toISOString(),
      msg,
      reqId,
      ref,
      err: String(JSON.stringify(err) ?? err),
      note: 'other fields not serialisable',
    });
  }
  if (level === 'info') console.log(line);
  else console.error(line);
}

export const log = {
  info: (msg: string, fields: Fields = {}) => write('info', msg, fields),
  warn: (msg: string, fields: Fields = {}) => write('warn', msg, fields),
};

/** A path safe to log: /track/<token> and /track/doc/<ticket> are bearer links — never logged. */
export function safePath(path: string): string {
  return (path.split('?')[0] ?? path)
    .replace(/^\/track\/doc\/[^/]+/, '/track/doc/[ticket]')
    .replace(/^\/track\/(?!doc(?:\/|$))[^/]+/, '/track/[token]');
}

/** Request context for a log line: id, method and path — never the query string. */
export function requestFields(req: Request): Fields {
  return { reqId: requestId(req), method: req.method, path: safePath(new URL(req.url).pathname) };
}

/** An error worth someone's attention, with its (scrubbed) stack. */
export function logError(e: unknown, msg: string, fields: Fields = {}, req?: Request): void {
  write('error', msg, { ...(req ? requestFields(req) : {}), ...fields, err: scrubError(e) });
}
