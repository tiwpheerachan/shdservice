import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE, SEEN_COOKIE, SEEN_TTL_S } from "@/lib/session";
import { resolveUser, HttpError } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  // a valid signature is not enough: the user row + session version must still match
  // (signed out on another device → every cookie of that user is dead)
  // DB unreachable (503) is "unknown", not "signed out": answer 503 so the client keeps its last answer
  const user = session ? await resolveUser(session).catch((e) => (e instanceof HttpError && e.status === 503 ? e : null)) : null;
  if (user instanceof HttpError) return NextResponse.json({ error: user.message }, { status: 503 });
  if (!session || !user) return NextResponse.json({ user: null }, { status: 401 });
  // read-only: this never re-issues the cookie (the idle timer is renewed only by real activity →
  // /api/sso/refresh). AccessGuard polls this for "still signed in / still approved".
  const res = NextResponse.json({
    user: { email: session.email, name: user.name, avatar: user.avatar },
    exp: session.exp,
    approved: user.approved,
    // has a role but the account is INACTIVE / DELETED → /pending says "disabled", not "awaiting approval"
    disabled: !user.isActive && !!user.userType,
  });
  res.cookies.set(SEEN_COOKIE, "1", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SEEN_TTL_S });
  return res;
}
