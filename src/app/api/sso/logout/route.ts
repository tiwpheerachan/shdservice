import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SEEN_COOKIE, verifySession } from "@/lib/session";
import { appOrigin, isRouterFetch } from "@/lib/sso";
import { bumpSessionVersion } from "@/server/auth";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Next's client router prefetches links (RSC / Next-Router-Prefetch headers).
  // Never sign out on one of those — only on a real top-level navigation.
  if (isRouterFetch(request)) return new NextResponse(null, { status: 204 });
  // a link on another site must not sign anyone out (on every device): only our own pages
  // (same-origin) or a typed URL / bookmark ("none") may. No header = not a browser page.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return NextResponse.redirect(new URL("/", appOrigin(request)));
  // server-side sign-out: bump app_user.session_version → this cookie AND every other
  // device's cookie for this user stop working (a copied cookie is dead too)
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) {
    try {
      await bumpSessionVersion(session.email);
    } catch (e) {
      logError(e, "sso logout: session_version bump failed");
    }
  }
  const res = NextResponse.redirect(new URL("/login?bye=1", appOrigin(request)));
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(SEEN_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
