import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SEEN_COOKIE } from "@/lib/session";
import { originAuthMode, originAuthOk, originAuthSecret } from "@/lib/origin-auth";
import { THEME_SCRIPT } from "@/lib/theme-script-source";

// Middleware runs in the EDGE runtime, where the HMAC secret (CENTRAL_API_KEY)
// is NOT reliably available — so it must NOT verify the cookie signature here,
// or every navigation would be wrongly rejected. It only checks that a session
// cookie is PRESENT. The real verification (signature, expiry, approval) happens
// in the Node-runtime (app) layout and API routes, which do have the secret.
//
// It runs on EVERY path except /api/health, in three steps:
//   1. origin guard  — the request must come through Cloudflare (X-Origin-Auth)
//   2. /track        — security headers + CSP nonce for the public tracking pages
//   3. login gate    — the old matcher's pages need a session cookie
export const config = {
  // /api/health stays reachable for Render's health check (it calls the origin directly)
  matcher: ["/((?!api/health(?:/|$)).*)"],
};

/** paths the login gate used to skip (the previous matcher) */
const PUBLIC_PATH = /^\/(?:api(?:\/|$)|_next\/static|_next\/image|login(?:\/|$)|track(?:\/|$)|favicon\.ico$|robots\.txt$)|\.(?:png|jpg|jpeg|svg|ico|webp)$/i;
/** public tracking pages (not /api/track — those are JSON and set their own headers) */
const TRACK_PAGE = /^\/track(?:\/|$)/;

function guard(request: NextRequest): NextResponse | null {
  const mode = originAuthMode();
  if (mode === "off") return null;
  if (!originAuthSecret()) {
    // misconfigured production: fail closed rather than trusting spoofable headers
    if (mode === "enforce") return new NextResponse("Service misconfigured", { status: 503 });
    console.warn(JSON.stringify({ event: "origin_auth_unconfigured", mode }));
    return null;
  }
  if (originAuthOk(request.headers)) return null;
  // never log the header value — only that it was missing / wrong
  console.warn(JSON.stringify({ event: "origin_auth_failed", mode, path: request.nextUrl.pathname }));
  return mode === "enforce" ? new NextResponse("Forbidden", { status: 403 }) : null;
}

/** CSP hash of the root layout's inline theme script (it cannot carry the nonce) — computed once */
let themeHash: Promise<string> | null = null;
function themeScriptHash(): Promise<string> {
  themeHash ??= crypto.subtle.digest("SHA-256", new TextEncoder().encode(THEME_SCRIPT)).then((buf) => {
    let bin = "";
    for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
    return `'sha256-${btoa(bin)}'`;
  });
  return themeHash;
}

async function trackPage(request: NextRequest): Promise<NextResponse> {
  // per-request nonce: Next.js reads it from the request CSP header and stamps its own scripts
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${await themeScriptHash()} 'strict-dynamic' https://challenges.cloudflare.com${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const reqHeaders = new Headers(request.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}

export async function middleware(request: NextRequest) {
  const blocked = guard(request);
  if (blocked) return blocked;

  const path = request.nextUrl.pathname;
  if (TRACK_PAGE.test(path)) return trackPage(request);
  if (PUBLIC_PATH.test(path)) return NextResponse.next();

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
  const full = path + request.nextUrl.search;
  to.pathname = "/login";
  to.search = "";
  if (expired) to.searchParams.set("expired", "1");
  if (full && full !== "/") to.searchParams.set("next", full);
  return NextResponse.redirect(to);
}
