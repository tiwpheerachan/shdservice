import { NextResponse, type NextRequest } from 'next/server';
import {
  verifySession,
  signSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  SESSION_MAX_AGE_MS,
  SEEN_COOKIE,
  SEEN_TTL_S,
  type SessionUser,
} from '@/lib/session';
import { resolveUser, HttpError } from '@/server/auth';
import { centralSessionActive } from '@/lib/sso';
import { log } from '@/lib/log';

const CENTRAL_CHECK_MS = 5 * 60 * 1000;

/** SSO_SESSION_CHECK = off | log (default: ask, log "inactive", sign nobody out) | enforce */
function centralCheckMode(): 'off' | 'log' | 'enforce' {
  const m = (process.env.SSO_SESSION_CHECK ?? '').trim().toLowerCase();
  return m === 'off' || m === 'enforce' ? m : 'log';
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Re-read the caller's role/status from app_user and re-issue the session cookie
 * so an admin's approval takes effect without logging out. Used by /pending and
 * the client-side AccessGuard.
 */
export async function GET(request: NextRequest) {
  const current = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!current) return NextResponse.json({ user: null }, { status: 401 });

  // the user row + session version decide — never the flags baked into the cookie
  // DB unreachable (503) must not sign anyone out: keep the cookie, the client retries later
  const u = await resolveUser(current).catch((e) => (e instanceof HttpError && e.status === 503 ? e : null));
  if (u instanceof HttpError) return NextResponse.json({ error: u.message }, { status: 503 });
  if (!u) {
    const res = NextResponse.json({ user: null }, { status: 401 });
    res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
    return res;
  }
  const role = u.role;
  const approved = u.approved;

  // Single logout: someone signed out / switched off at the central SSO (left the company)
  // loses this session at the next renewal instead of keeping it up to 12 h. Asked at most
  // every CENTRAL_CHECK_MS; no answer keeps the session (an SSO outage must not sign
  // everyone out — new sign-ins fail then anyway, and the 30-min idle / 12-h caps still hold).
  let chk = current.chk;
  const mode = centralCheckMode();
  if (mode !== 'off' && current.sub && Date.now() - (current.chk ?? 0) > CENTRAL_CHECK_MS) {
    const active = await centralSessionActive(current.sub, current.ssoIat);
    if (active === true) {
      chk = Date.now();
      // rollout: proves the endpoint answers for real users before switching to enforce
      if (mode === 'log') log.info('sso central session active', { userId: u.userId });
    } else if (active === false) {
      log.warn('sso central session inactive', { userId: u.userId, mode });
      if (mode === 'enforce') {
        const res = NextResponse.json({ user: null }, { status: 401 });
        res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
        return res;
      }
    } else log.warn('sso central session check unavailable', { userId: u.userId });
  } else if (mode === 'log' && !current.sub) {
    // rollout visibility: a session without sub is never checked (cookies from before this
    // deploy, or /sso/verify not sending sub) — say so instead of looking like "all fine"
    log.info('sso central session check skipped: no sub', { userId: u.userId });
  }

  // renew the idle timer, but never past the absolute lifetime counted from sign-in
  const exp = Math.min(Date.now() + SESSION_TTL_MS, current.iat + SESSION_MAX_AGE_MS);
  const updated: SessionUser = {
    ...current,
    role,
    approved,
    exp,
    chk,
  };

  const res = NextResponse.json({ approved, role, email: current.email });
  res.cookies.set(SESSION_COOKIE, await signSession(updated), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.max(0, Math.floor((exp - Date.now()) / 1000)),
  });
  res.cookies.set(SEEN_COOKIE, String(u.userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SEEN_TTL_S,
  });
  return res;
}
