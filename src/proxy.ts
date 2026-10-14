import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SEEN_COOKIE } from "@/lib/session";
import { originAuthMode, originAuthOk, originAuthSecret } from "@/lib/origin-auth";
import { THEME_SCRIPT } from "@/lib/theme-script-source";
import { appOrigin } from "@/lib/sso";
import { log, safePath } from "@/lib/log";

// Proxy (Next 16's name for middleware; always the Node.js runtime). It only
// checks that a session cookie is PRESENT — the real verification (signature,
// expiry, user row, approval) happens in the (app) layout and every API route,
// which is where it has always been; a stale cookie that gets past here is still
// rejected there.
//
// It runs on EVERY path except /api/health, in these steps:
//   1. origin guard  — the request must come through Cloudflare (X-Origin-Auth)
//      + CSRF: cookie-carrying /api writes from another site are refused
//   2. /track        — security headers + CSP nonce for the public tracking pages
//   3. login gate    — the old matcher's pages need a session cookie
export const config = {
  // /api/health stays reachable for Render's health check (it calls the origin directly).
  // Static files skip the proxy too: /_next/static (hashed build output), /_next/image (off —
  // images.unoptimized), favicon/robots and top-level images (= public/). Safe for origin auth:
  // they are the same public bytes for everyone, carry no data and run no app code, and
  // Cloudflare still fronts them in production. The image pattern is top-level only
  // ([^/]+ before the extension), so /api/files/x.png and every page stay behind the guard.
  matcher: ["/((?!api/health(?:/|$)|_next/static/|_next/image(?:/|$)|favicon\\.ico$|robots\\.txt$|[^/]+\\.(?:png|jpe?g|svg|ico|webp)$).*)"],
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
    log.warn("origin_auth_unconfigured", { mode });
    return null;
  }
  if (originAuthOk(request.headers)) return null;
  // never log the header value — only that it was missing / wrong
  log.warn("origin_auth_failed", { mode, path: safePath(request.nextUrl.pathname) });
  return mode === "enforce" ? new NextResponse("Forbidden", { status: 403 }) : null;
}

/**
 * CSRF, beside SameSite=Lax (which does not cover a sibling host on the same site):
 * a cookie-carrying write from a page that is not this app is refused (any path — no
 * server actions exist, and a path test would only invite encoding tricks).
 * Browsers say where a request came from — Sec-Fetch-Site on every modern one,
 * Origin on cross-origin POSTs. Neither header = not a browser page (curl, server),
 * so it cannot be a forgery riding on someone's cookie. (OneLink lib/api/same-origin.ts)
 */
function crossSiteWrite(request: NextRequest): boolean {
  if (/^(GET|HEAD|OPTIONS)$/.test(request.method)) return false;
  if (!request.cookies.get(SESSION_COOKIE)?.value) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = request.headers.get("origin");
  return origin !== null && origin !== appOrigin(request);
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

export async function proxy(request: NextRequest) {
  const blocked = guard(request);
  if (blocked) return blocked;
  if (crossSiteWrite(request)) {
    log.warn("cross_site_write_refused", { path: safePath(request.nextUrl.pathname), site: request.headers.get("sec-fetch-site") });
    return NextResponse.json({ error: "cross-site request refused" }, { status: 403 });
  }

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
