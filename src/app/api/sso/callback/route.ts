import { NextResponse, type NextRequest } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { DEFAULT_AFTER_LOGIN, SSO, STATE_COOKIE, STATE_SEP, appOrigin, safeNext } from '@/lib/sso';
import {
  signSession,
  verifySession,
  SEEN_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  type SessionUser,
} from '@/lib/session';
import { lookupByEmail } from '@/lib/directory';
import { provisionFailure, provisionSsoUser } from '@/server/services/users';
import { audit } from '@/server/audit';
import { db } from '@/db/client';
import { PENDING_ROLE, isApproved } from '@/lib/access';
import { log, logError, scrubText } from '@/lib/log';
import { checked, parseQuery } from '@/server/auth';
import { ssoCallback } from '@/server/contract/misc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Auto-provision the signed-in employee into `app_user` (the single user table)
 * and return their effective role/status. New users start pending (user_type
 * NULL) until an admin assigns a role; owner emails are always System Admin.
 * A failure returns the sign-in error code — user_conflict (a unique clash on app_user: an admin must
 * look, retrying will not help) or db_unavailable — and NO cookie is issued (a session always needs its
 * app_user row — the server never trusts a role baked into the cookie).
 */
async function provision(opts: {
  email: string;
  name: string;
  larkId: string;
  department: string;
  phone: string;
  avatar: string;
  title: string;
}): Promise<
  { role: string; status: string; userId: number; sessionVersion: number } | 'user_conflict' | 'db_unavailable'
> {
  try {
    const r = await provisionSsoUser(opts);
    return {
      role: r.userType ?? PENDING_ROLE,
      status: r.isActive ? 'Active' : 'Inactive',
      userId: r.userId,
      sessionVersion: r.sessionVersion,
    };
  } catch (e) {
    const { reason, constraint } = provisionFailure(e);
    logError(e, `sso provision failed (${reason})`, constraint ? { constraint } : {});
    return reason;
  }
}

/** {email: "string(24)", user: {sub: "string(35)", …}} — the structure of a value, none of its content */
function shapeOf(v: unknown, depth = 0): unknown {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array(${v.length})`;
  if (typeof v === 'object') {
    if (depth >= 2) return `object(${Object.keys(v as object).length} keys)`;
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shapeOf(x, depth + 1)]));
  }
  return typeof v === 'string' ? `string(${v.length})` : typeof v;
}

function fail(request: NextRequest, reason: string) {
  const to = new URL('/login', appOrigin(request));
  to.searchParams.set('error', reason);
  return NextResponse.redirect(to);
}

export const GET = checked(async (request: NextRequest) => {
  const { code, state } = parseQuery(request, ssoCallback);
  const cookieStates = (request.cookies.get(STATE_COOKIE)?.value ?? '').split(STATE_SEP).filter(Boolean);
  const nextFromState = safeNext(state?.split('|')[1]);

  // Reloading the callback URL (or a second tab finishing after the first) must
  // not throw the user out: if this browser already holds a valid session, go on.
  const existing = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const continueIfSignedIn = () =>
    existing ? NextResponse.redirect(new URL(nextFromState, appOrigin(request))) : null;

  if (!code) return continueIfSignedIn() ?? fail(request, 'missing_code');
  if (!state || !cookieStates.includes(state)) return continueIfSignedIn() ?? fail(request, 'state_mismatch');

  const clientSecret = process.env.SSO_CLIENT_SECRET;
  if (!clientSecret) return fail(request, 'server_not_configured');

  let identity: Record<string, unknown>;
  try {
    // verify authenticates the app with client_id + client_secret (in the body)
    const res = await fetch(SSO.verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        client_id: SSO.clientId,
        client_secret: clientSecret,
      }),
      cache: 'no-store',
      // a hung SSO must not hold the callback (and a connection) open; no retry — the code is one-time
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // surface the SSO's reason in the server log (Render → Logs) without leaking secrets
      const body = await res.text().catch(() => '');
      // the central service names the account in its 403 text ("account x@… is inactive") — scrubbed
      log.warn('sso verify failed', { status: res.status, client: SSO.clientId, body: scrubText(body.slice(0, 300)) });
      // a code that was already exchanged (page reload) while a session exists → just continue
      return continueIfSignedIn() ?? fail(request, `verify_${res.status}`);
    }
    identity = await res.json();
    // SSO_DEBUG=shape (or 1): what /sso/verify answered — field names, types and sizes,
    // never a value (safe in production for one sign-in; needed before keying users on `sub`)
    if (process.env.SSO_DEBUG === 'shape' || process.env.SSO_DEBUG === '1')
      log.info('sso verify shape', { shape: shapeOf(identity) });
  } catch {
    return fail(request, 'verify_unreachable');
  }

  // central may nest the user under `user` / `profile` / `data`
  const u =
    (identity.user as Record<string, unknown>) ??
    (identity.profile as Record<string, unknown>) ??
    (identity.data as Record<string, unknown>) ??
    identity;

  // top-level email first (what /sso/verify documents and OneLink reads); a nested
  // `user`/`profile` object can exist without one (e.g. phone-only Lark accounts)
  const email = str(identity.email).trim() || str(u.email).trim();
  if (!email) {
    logError('no email in verify response', 'sso callback refused', {
      topKeys: Object.keys(identity),
      userKeys: Object.keys(u ?? {}),
    });
    return fail(request, 'no_email');
  }

  // Enrich with the full directory profile (department, title, phone, avatar).
  const prof = await lookupByEmail(email);

  const name = str(identity.name) || str(u.name) || str(u.en_name) || prof?.name || (email.split('@')[0] ?? email);
  const avatar = str(u.avatar_url) || str(u.avatar) || prof?.avatar || '';

  const provisioned = await provision({
    email,
    name,
    larkId: prof?.id ?? '',
    department: prof?.department ?? '',
    phone: prof?.phone ?? '',
    avatar,
    title: prof?.title ?? '',
  });
  if (typeof provisioned === 'string') return fail(request, provisioned);
  const { role, status, userId, sessionVersion } = provisioned;

  // audit: LOGIN (best-effort — never blocks sign-in)
  try {
    await audit(db, userId, {
      action: 'LOGIN',
      module: 'Auth',
      entity: 'app_user',
      key: userId || email,
      summary: `เข้าสู่ระบบ ${email} · ${role}`,
      meta: { ip: clientIp(request.headers), ua: request.headers.get('user-agent')?.slice(0, 200) ?? null },
    });
  } catch (e) {
    logError(e, 'sso audit login failed');
  }

  const user: SessionUser = {
    email,
    name,
    avatar,
    // for the central-session check in /api/sso/refresh (sub is permanent; iat = that session)
    sub: str(identity.sub) || str(u.sub) || undefined,
    ssoIat: typeof identity.iat === 'number' ? identity.iat : typeof u.iat === 'number' ? u.iat : null,
    chk: Date.now(),
    role,
    approved: isApproved(role, status),
    exp: Date.now() + SESSION_TTL_MS,
    iat: Date.now(),
    sv: sessionVersion,
  };

  // os_seen = who last used this browser (set by /api/sso/me; '0' after ออกจากระบบ): a `next` left by
  // someone else's session — or made after a sign-out (a reload, a 401 in another tab) — is dropped, so a
  // shared PC never opens the previous person's page. No os_seen at all (a browser that never signed in
  // here, e.g. a link opened on a new PC) keeps it: nobody used this browser before.
  const seen = request.cookies.get(SEEN_COOKIE)?.value;
  const next = seen === undefined || seen === String(userId) ? nextFromState : DEFAULT_AFTER_LOGIN;
  const res = NextResponse.redirect(new URL(next, appOrigin(request)));
  // set ONLY the session cookie here — a single Set-Cookie on the redirect,
  // so proxies (Render) can't drop it while folding multiple Set-Cookie headers.
  // os_state has Max-Age=600 and expires on its own.
  res.cookies.set(SESSION_COOKIE, await signSession(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
});
