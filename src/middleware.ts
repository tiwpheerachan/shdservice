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

  const login = new URL("/login", request.url);
  const path = request.nextUrl.pathname + request.nextUrl.search;
  if (path && path !== "/") login.searchParams.set("next", path);
  return NextResponse.redirect(login);
}
