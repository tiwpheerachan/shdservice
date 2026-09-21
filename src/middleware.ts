import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SEEN_COOKIE } from "@/lib/session";

// Middleware runs in the EDGE runtime, where the HMAC secret (CENTRAL_API_KEY)
// is NOT reliably available — so it must NOT verify the cookie signature here,
// or every navigation would be wrongly rejected. It only checks that a session
// cookie is PRESENT. The real verification (signature, expiry, approval) happens
// in the Node-runtime (app) layout and API routes, which do have the secret.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|login|favicon.ico|robots.txt|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};

export function middleware(request: NextRequest) {
  const hasCookie = !!request.cookies.get(SESSION_COOKIE)?.value;
  if (hasCookie) return NextResponse.next();

  // No cookie → our own /login page, ALWAYS. Never bounce an anonymous visitor
  // straight through to the central SSO (and on to Google): an onrender.com URL
  // that auto-forwards to a Google sign-in is exactly what phishing kits do, and
  // Google Web Risk flagged the site for it (2026-09-18). The user clicks the
  // button on /login; only that click starts the SSO flow.
  // A browser that HAD a session (os_seen marker) gets an "expired" note.
  const expired = !!request.cookies.get(SEEN_COOKIE)?.value;
  const to = request.nextUrl.clone();
  const path = request.nextUrl.pathname + request.nextUrl.search;
  to.pathname = "/login";
  to.search = "";
  if (expired) to.searchParams.set("expired", "1");
  if (path && path !== "/") to.searchParams.set("next", path);
  return NextResponse.redirect(to);
}
