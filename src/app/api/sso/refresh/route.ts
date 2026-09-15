import { NextResponse, type NextRequest } from "next/server";
import {
  verifySession,
  signSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
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

  const u = await resolveUser(current);
  const role = u?.role ?? current.role ?? "";
  const approved = u ? u.approved : !!current.approved;

  const updated: SessionUser = {
    ...current,
    role,
    approved,
    exp: Date.now() + SESSION_TTL_MS,
  };

  const res = NextResponse.json({ approved, role, email: current.email });
  res.cookies.set(SESSION_COOKIE, await signSession(updated), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
