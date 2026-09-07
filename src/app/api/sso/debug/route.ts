import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// Temporary diagnostic — reports whether the session cookie reaches the server
// and verifies. Does NOT expose any secret value. Remove once SSO is confirmed.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const raw = request.cookies.get(SESSION_COOKIE)?.value;
  const user = await verifySession(raw);
  return NextResponse.json({
    hasSessionCookie: !!raw,
    sessionCookieLen: raw?.length ?? 0,
    verified: !!user,
    user: user?.email ?? null,
    cookiesSeen: request.cookies.getAll().map((c) => c.name),
    secretSource: process.env.SESSION_SECRET
      ? "SESSION_SECRET"
      : process.env.CENTRAL_API_KEY
        ? "CENTRAL_API_KEY(fallback)"
        : "insecure-default",
    nodeEnv: process.env.NODE_ENV,
  });
}
