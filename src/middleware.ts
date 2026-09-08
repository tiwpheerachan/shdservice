import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { DEFAULT_AFTER_LOGIN } from "@/lib/sso";

// Protect every page. Excluded: the login page, all /api routes (SSO + directory
// guard themselves), Next internals, and static assets.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|login|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};

const PENDING_PATH = "/pending";

export async function middleware(request: NextRequest) {
  const user = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const pathname = request.nextUrl.pathname;

  // Not signed in → go STRAIGHT to the central SSO login (never via the app's
  // own /login page). /api/sso/login sets CSRF state and returns to `next`.
  if (!user) {
    const to = request.nextUrl.clone();
    const path = pathname + request.nextUrl.search;
    to.pathname = "/api/sso/login";
    to.search = "";
    if (path && path !== "/") to.searchParams.set("next", path);
    return NextResponse.redirect(to);
  }

  // Signed in but NOT approved (no real role assigned yet) → hold at /pending.
  if (!user.approved) {
    if (pathname === PENDING_PATH) return NextResponse.next();
    const to = request.nextUrl.clone();
    to.pathname = PENDING_PATH;
    to.search = "";
    return NextResponse.redirect(to);
  }

  // Approved user shouldn't sit on the pending screen.
  if (pathname === PENDING_PATH) {
    const to = request.nextUrl.clone();
    to.pathname = DEFAULT_AFTER_LOGIN;
    to.search = "";
    return NextResponse.redirect(to);
  }

  return NextResponse.next();
}
