import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE, SEEN_COOKIE, SEEN_TTL_S } from "@/lib/session";
import { resolveUser } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  // a valid signature is not enough: the user row + session version must still match
  // (signed out on another device → every cookie of that user is dead)
  const user = session ? await resolveUser(session).catch(() => null) : null;
  if (!session || !user) return NextResponse.json({ user: null }, { status: 401 });
  const res = NextResponse.json({
    user: { email: session.email, name: user.name, avatar: user.avatar },
    exp: session.exp,
  });
  res.cookies.set(SEEN_COOKIE, "1", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SEEN_TTL_S });
  return res;
}
