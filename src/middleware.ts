import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// Protect every page. Excluded: the login page, all /api routes (SSO + directory
// guard themselves), Next internals, and static assets.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|login|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};

export async function middleware(request: NextRequest) {
  const user = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (user) return NextResponse.next();

  // No valid session → go STRAIGHT to the central SSO login (sso.shd-technology.co.th),
  // never via the app's own /login page. /api/sso/login sets the CSRF state and
  // redirects to the central portal, returning to `next` after login.
  const to = request.nextUrl.clone();
  const path = request.nextUrl.pathname + request.nextUrl.search;
  to.pathname = "/api/sso/login";
  to.search = "";
  if (path && path !== "/") to.searchParams.set("next", path);
  return NextResponse.redirect(to);
}
