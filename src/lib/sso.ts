// Central SSO endpoints (SHD). client_id is public; the API key that authorizes
// the verify call is server-only (CENTRAL_API_KEY).
// SSO_ORIGIN exists for the e2e tests' fake SSO (tests/e2e) — production leaves it unset.
export const SSO_ORIGIN = (process.env.SSO_ORIGIN || "https://sso.shd-technology.co.th").replace(/\/+$/, "");
export const SSO = {
  clientId: process.env.SSO_CLIENT_ID || "cli_6e53e9248bcff7fb",
  authorizeUrl: `${SSO_ORIGIN}/api/v1/sso/authorize`,
  verifyUrl: `${SSO_ORIGIN}/api/v1/sso/verify`,
  sessionUrl: `${SSO_ORIGIN}/api/v1/sso/session`,
};

/**
 * Is this person's central session still active (signed out / switched off centrally →
 * false)? POST /sso/session {client_id, client_secret, sub, iat} → {active}. Same call
 * as OneBridge (lib/auth/sso.ts). "unavailable" = no usable answer; the caller decides.
 * Server-only (client secret) — called from route handlers only.
 */
export async function centralSessionActive(sub: string, iat: number | null | undefined): Promise<boolean | "unavailable"> {
  const secret = process.env.SSO_CLIENT_SECRET;
  if (!secret) return "unavailable";
  try {
    const res = await fetch(SSO.sessionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: SSO.clientId, client_secret: secret, sub, ...(iat ? { iat } : {}) }),
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return "unavailable";
    const body = (await res.json().catch(() => null)) as { active?: unknown } | null;
    return typeof body?.active === "boolean" ? body.active : "unavailable";
  } catch {
    return "unavailable";
  }
}

export const STATE_COOKIE = "os_state";
/** os_state holds the last few login states (newest first), separated by this. */
export const STATE_SEP = ";";
export const MAX_STATES = 5;
export const DEFAULT_AFTER_LOGIN = "/jobs/dashboard";

/**
 * Only ever bounce to a path inside this app. `next` comes from the URL, so an
 * absolute URL ("https://evil…"), a protocol-relative one ("//evil…") or a
 * backslash trick would turn the login flow into an open redirect for phishing.
 * Parsed with the same URL parser the redirect uses (it drops tabs/newlines and
 * reads "\" as "/"), so "/<tab>/evil" can't pass a string check and then leave.
 */
export function safeNext(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  if (!s.startsWith("/")) return DEFAULT_AFTER_LOGIN;
  try {
    const base = "http://next.invalid";
    const url = new URL(s, base);
    const out = url.pathname + url.search + url.hash;
    // the parser also folds "/./" and "/../" — "/.//evil" comes out as "//evil", which a
    // redirect then reads as protocol-relative (another host). The result must stay a path.
    return url.origin === base && !out.startsWith("//") ? out : DEFAULT_AFTER_LOGIN;
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
}

/**
 * The app's PUBLIC origin (scheme + host), for building redirect_uri and
 * post-login redirects. Behind a proxy (Render) `request.url` is the internal
 * address (e.g. https://localhost:10000), so we must derive it from:
 *   1. APP_BASE_URL        — manual override
 *   2. RENDER_EXTERNAL_URL — injected automatically by Render
 *   3. x-forwarded-proto/host headers set by the proxy
 *   4. request.url         — last resort (correct on local dev)
 */
export function appOrigin(request: Request): string {
  const manual = process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL;
  if (manual) return manual.replace(/\/+$/, "");

  const h = request.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return new URL(request.url).origin;
}

/**
 * True for requests made by Next's client router (soft navigation / link
 * prefetch) rather than a real top-level navigation. Such requests must never
 * start or end an SSO flow: the browser drops cookies on their cross-site redirect
 * chain and every prefetched link would mint its own login state.
 */
export function isRouterFetch(request: Request): boolean {
  return !!(request.headers.get("rsc") || request.headers.get("next-router-prefetch"));
}


/**
 * Absolute base URL for links we EMBED in documents (QR codes, emails) where no
 * request object is at hand. APP_BASE_URL is the one that matters in production
 * — behind Cloudflare/Render the request host is not reliable.
 */
export function appBaseUrl(headerHost?: string | null): string {
  const manual = process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL;
  if (manual) return manual.replace(/\/+$/, "");
  if (headerHost) return `${headerHost.startsWith("localhost") ? "http" : "https"}://${headerHost}`;
  return "";
}
