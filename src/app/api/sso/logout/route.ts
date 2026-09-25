import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SEEN_COOKIE, verifySession } from "@/lib/session";
import { appOrigin, isRouterFetch } from "@/lib/sso";
import { bumpSessionVersion } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Next's client router prefetches links (RSC / Next-Router-Prefetch headers).
  // Never sign out on one of those — only on a real top-level navigation.
  if (isRouterFetch(request)) return new NextResponse(null, { status: 204 });
  // server-side sign-out: bump app_user.session_version → this cookie AND every other
  // device's cookie for this user stop working (a copied cookie is dead too)
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) {
    try {
      await bumpSessionVersion(session.email);
    } catch (e) {
      console.error("[sso] logout: session_version bump failed:", e instanceof Error ? e.message.split("\n")[0] : e);
    }
  }
  const res = NextResponse.redirect(new URL("/login?bye=1", appOrigin(request)));
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(SEEN_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
