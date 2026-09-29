import { NextResponse, type NextRequest } from "next/server";
import {
  verifySession,
  signSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  SESSION_MAX_AGE_MS,
  SEEN_COOKIE,
  SEEN_TTL_S,
  type SessionUser,
} from "@/lib/session";
import { resolveUser } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Re-read the caller's role/status from app_user and re-issue the session cookie
 * so an admin's approval takes effect without logging out. Used by /pending and
 * the client-side AccessGuard.
 */
export async function GET(request: NextRequest) {
  const current = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!current) return NextResponse.json({ user: null }, { status: 401 });

  // the user row + session version decide — never the flags baked into the cookie
  const u = await resolveUser(current).catch(() => null);
  if (!u) {
    const res = NextResponse.json({ user: null }, { status: 401 });
    res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }
  const role = u.role;
  const approved = u.approved;

  // renew the idle timer, but never past the absolute lifetime counted from sign-in
  const exp = Math.min(Date.now() + SESSION_TTL_MS, current.iat + SESSION_MAX_AGE_MS);
  const updated: SessionUser = {
    ...current,
    role,
    approved,
    exp,
  };

  const res = NextResponse.json({ approved, role, email: current.email });
  res.cookies.set(SESSION_COOKIE, await signSession(updated), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(0, Math.floor((exp - Date.now()) / 1000)),
  });
  res.cookies.set(SEEN_COOKIE, "1", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SEEN_TTL_S });
  return res;
}
