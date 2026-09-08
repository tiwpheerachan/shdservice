import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// Middleware only checks AUTHENTICATION (is there a valid session cookie?).
// AUTHORIZATION (is the user approved?) is done fresh from the DB in the (app)
// layout on every request, so an admin's approval takes effect immediately and
// never depends on a stale cookie flag.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|login|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};

export async function middleware(request: NextRequest) {
  const user = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (user) return NextResponse.next();

  // Not signed in → go straight to central SSO login.
  const to = request.nextUrl.clone();
  const path = request.nextUrl.pathname + request.nextUrl.search;
  to.pathname = "/api/sso/login";
  to.search = "";
  if (path && path !== "/") to.searchParams.set("next", path);
  return NextResponse.redirect(to);
}
