// Central SSO endpoints (SHD). client_id is public; the API key that authorizes
// the verify call is server-only (CENTRAL_API_KEY).
export const SSO = {
  clientId: process.env.SSO_CLIENT_ID || "cli_6e53e9248bcff7fb",
  authorizeUrl: "https://sso.shd-technology.co.th/api/v1/sso/authorize",
  verifyUrl: "https://sso.shd-technology.co.th/api/v1/sso/verify",
  sessionUrl: "https://sso.shd-technology.co.th/api/v1/sso/session",
};

export const STATE_COOKIE = "os_state";
/** os_state holds the last few login states (newest first), separated by this. */
export const STATE_SEP = ";";
export const MAX_STATES = 5;
export const DEFAULT_AFTER_LOGIN = "/jobs/dashboard";

/**
 * Only ever bounce to a path inside this app. `next` comes from the URL, so an
 * absolute URL ("https://evil…"), a protocol-relative one ("//evil…") or a
 * backslash trick would turn the login flow into an open redirect for phishing.
 */
export function safeNext(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\") || /[\r\n]/.test(s)) return DEFAULT_AFTER_LOGIN;
  return s;
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

