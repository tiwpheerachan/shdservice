import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";
import { appOrigin, isRouterFetch } from "@/lib/sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Next's client router prefetches links (RSC / Next-Router-Prefetch headers).
  // Never sign out on one of those — only on a real top-level navigation.
  if (isRouterFetch(request)) return new NextResponse(null, { status: 204 });
  const res = NextResponse.redirect(new URL("/login?bye=1", appOrigin(request)));
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
