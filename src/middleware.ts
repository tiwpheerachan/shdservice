import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

// Middleware runs in the EDGE runtime, where the HMAC secret (CENTRAL_API_KEY)
// is NOT reliably available — so it must NOT verify the cookie signature here,
// or every navigation would be wrongly rejected. It only checks that a session
// cookie is PRESENT. The real verification (signature, expiry, approval) happens
// in the Node-runtime (app) layout and API routes, which do have the secret.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|login|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};

export function middleware(request: NextRequest) {
  const hasCookie = !!request.cookies.get(SESSION_COOKIE)?.value;
  if (hasCookie) return NextResponse.next();

  // No cookie at all → straight to central SSO login.
  const to = request.nextUrl.clone();
  const path = request.nextUrl.pathname + request.nextUrl.search;
  to.pathname = "/api/sso/login";
  to.search = "";
  if (path && path !== "/") to.searchParams.set("next", path);
  return NextResponse.redirect(to);
}
