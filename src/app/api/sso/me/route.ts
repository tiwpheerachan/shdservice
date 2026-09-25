import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE, SEEN_COOKIE, SEEN_TTL_S } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  const res = NextResponse.json({
    user: { email: user.email, name: user.name, avatar: user.avatar },
    exp: user.exp,
  });
  res.cookies.set(SEEN_COOKIE, "1", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SEEN_TTL_S });
  return res;
}
