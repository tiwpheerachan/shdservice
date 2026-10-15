import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, SEEN_COOKIE, SEEN_TTL_S } from '@/lib/session';
import { resolveUser, HttpError } from '@/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  // a valid signature is not enough: the user row + session version must still match
  // (signed out on another device → every cookie of that user is dead)
  // DB unreachable (503) is "unknown", not "signed out": answer 503 so the client keeps its last answer
  const user = session
    ? await resolveUser(session).catch((e) => (e instanceof HttpError && e.status === 503 ? e : null))
    : null;
  if (user instanceof HttpError) return NextResponse.json({ error: user.message }, { status: 503 });
  // no session cookie AND no os_seen marker = this browser signed out (logout clears both) → the other
  // open tabs go to /login?bye=1, not "expired" with their page as `next`; an idle expiry keeps os_seen
  if (!session || !user)
    return NextResponse.json(
      {
        user: null,
        ...(!request.cookies.get(SESSION_COOKIE)?.value &&
          !request.cookies.get(SEEN_COOKIE)?.value && { signedOut: true }),
      },
      { status: 401 },
    );
  // read-only: this never re-issues the cookie (the idle timer is renewed only by real activity →
  // /api/sso/refresh). AccessGuard polls this for "still signed in / still approved".
  const res = NextResponse.json({
    user: { email: session.email, name: user.name, avatar: user.avatar },
    exp: session.exp,
    approved: user.approved,
    // has a role but the account is INACTIVE / DELETED → /pending says "disabled", not "awaiting approval"
    disabled: !user.isActive && !!user.userType,
  });
  // os_seen = who last used this browser: sign-in drops a `next` page that belonged to someone else
  // (src/app/api/sso/callback). Never a secret — only an id, httpOnly.
  res.cookies.set(SEEN_COOKIE, String(user.userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SEEN_TTL_S,
  });
  return res;
}
