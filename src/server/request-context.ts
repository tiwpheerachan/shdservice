import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { clientIp, UNKNOWN_IP } from '@/lib/client-ip';
import { requestId } from '@/lib/log';
import type { Action, Right } from '@/lib/modules';
import type { CurrentUser } from '@/server/auth';

/**
 * Who is asking, captured once per API request (checked() / handle() in src/server/auth.ts run every route in it).
 * audit() / security() (src/server/audit.ts) stamp every log row from it, and assertActor() re-checks at write time
 * what the request relied on (R2: a role removed / reduced / deactivated mid-action cannot complete it).
 *
 * IP: clientIp() (src/lib/client-ip.ts) — CF-Connecting-IP, trusted only once the request proved it came through
 * Cloudflare (X-Origin-Auth); Render's X-Forwarded-For is client-controlled behind Cloudflare and only read while the
 * origin check is off (local dev) / `log`. Unknown (0.0.0.0) is stored as NULL, never a made-up address.
 */
export type Need =
  | { kind: 'admin' }
  /** any one of `modules` with `action` (requireCan: one module; requireView: any of the screens) */
  | { kind: 'grant'; modules: readonly string[]; action: Action }
  | { kind: 'right'; right: Right };

/** `guard`: requireCan / requireView / requireAdmin refused; `write`: assertActor refused inside the write;
 *  `legacy`: a legacy row's money / quantity (legacy-lock.ts). `entity` + one of pk / id / no = the record, when known */
export type Denied = {
  reason: string;
  permission: string | null;
  role: string | null;
  at: 'guard' | 'write' | 'legacy' | 'page';
  /** who, when the request's user was never set (an inactive / signed-out account) */
  actorPk?: number;
  entity?: string;
  pk?: number;
  id?: string;
  no?: string;
};

export type RequestCtx = {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
  /** the URL path ('' in a page) — a refusal names the record it names (/api/jobs/{id}/…) */
  path: string;
  /** sessionIdOf(the session) — an identifier of the sign-in, never the cookie */
  sessionId: string | null;
  /** the signed-in user requireUser() resolved */
  user?: CurrentUser;
  /** what the guards / hasRight() let through — assertActor() re-checks each inside the write */
  needs: Need[];
  /** set by assertActor() when it refused; checked() writes the DENIED security_log row once the tx rolled back */
  denied?: Denied;
  /** a refusal was already considered for the log (written, or left out by the throttle) — handle() adds none */
  deniedSeen?: boolean;
  /** the last right / grant hasRight() / can() answered no to — names the permission of a 403 a service throws */
  refused?: string;
};

const als = new AsyncLocalStorage<RequestCtx>();

export const requestCtx = (): RequestCtx | undefined => als.getStore();

function ctxOf(h: Headers, path = ''): RequestCtx {
  const ip = clientIp(h);
  return {
    ip: ip === UNKNOWN_IP ? null : ip,
    userAgent: h.get('user-agent')?.slice(0, 300) || null,
    requestId: requestId({ headers: h }),
    path,
    sessionId: null,
    needs: [],
  };
}

/** Run `fn` with this request's context (a nested call keeps the outer one). */
export function runInRequest<T>(req: Request, fn: () => Promise<T>): Promise<T> {
  if (als.getStore()) return fn();
  return als.run(ctxOf(req.headers, new URL(req.url).pathname), fn);
}

/** The same for a server component (the print pages: their PRINT line names the ip / agent / session too).
 *  `user` = userFromCookies() of the page; null = nobody signed in. */
export async function runInPage<T>(user: CurrentUser | null, fn: () => Promise<T>): Promise<T> {
  if (als.getStore()) return fn();
  const c = ctxOf(new Headers(await headers()));
  return als.run(c, () => {
    if (user) setRequestUser(user);
    return fn();
  });
}

/** A sign-in's identifier: email + its sign-in time (SessionUser.iat, never renewed) — stable for the session's life,
 *  the same on every device row of the log, and says nothing about the cookie. */
export const sessionIdOf = (email: string, iat: number) =>
  createHash('sha256').update(`${email.trim().toLowerCase()}|${iat}`).digest('hex').slice(0, 32);

export function setRequestUser(u: CurrentUser) {
  const c = als.getStore();
  if (!c) return;
  c.user = u;
  c.sessionId = sessionIdOf(u.session.email, u.session.iat);
}

/** record that the request relied on `n` — only for the request's own user (another user's right is not a need) */
export function need(user: unknown, n: Need) {
  const c = als.getStore();
  if (!c?.user || c.user !== user) return;
  const k = JSON.stringify(n);
  if (!c.needs.some((x) => JSON.stringify(x) === k)) c.needs.push(n);
}

/** audit_log / security_log `permission`: "Job Management:edit", "Report", "System Admin" */
export const permissionOf = (needs: readonly Need[]): string | null =>
  needs
    .map((n) =>
      n.kind === 'admin' ? 'System Admin' : n.kind === 'right' ? n.right : `${n.modules.join('|')}:${n.action}`,
    )
    .join(', ') || null;

/** sign-in / sign-out (no requireUser): the session the log rows name */
export function setRequestSession(email: string, iat: number) {
  const c = als.getStore();
  if (c) c.sessionId = sessionIdOf(email, iat);
}

/** a guard's refusal (requireCan / requireView / requireAdmin): checked() logs it as DENIED — at most once a minute per
 *  user + permission, so a screen polling what it may not see cannot fill the log.
 *  ponytail: per process (one Render instance) */
const lastDenied = new Map<string, number>();
export function guardDenied(
  user: Pick<CurrentUser, 'pk' | 'userType'>,
  permission: string,
  reason: string,
  at: Denied['at'] = 'guard',
) {
  const c = als.getStore();
  if (!c) return;
  c.deniedSeen = true;
  const key = `${user.pk}|${permission}`;
  const now = Date.now();
  if (now - (lastDenied.get(key) ?? 0) < 60_000) return;
  if (lastDenied.size > 10_000) lastDenied.clear();
  lastDenied.set(key, now);
  c.denied = { reason, permission, role: user.userType, at, actorPk: user.pk };
}

/** hasRight() / can() said no for the request's own user: a 403 the caller throws next names this permission */
export function refused(user: unknown, permission: string) {
  const c = als.getStore();
  if (c?.user && c.user === user) c.refused = permission;
}

/** a refusal checked() logs as DENIED once the request ends (the first one of the request) */
export function markDenied(d: Denied) {
  const c = als.getStore();
  if (!c) return;
  c.deniedSeen = true;
  if (!c.denied) c.denied = d;
}
