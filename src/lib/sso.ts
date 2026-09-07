// Central SSO endpoints (SHD). client_id is public; the API key that authorizes
// the verify call is server-only (CENTRAL_API_KEY).
export const SSO = {
  clientId: process.env.SSO_CLIENT_ID || "cli_168eb7414da1a2e2",
  authorizeUrl: "https://sso.shd-technology.co.th/api/v1/sso/authorize",
  verifyUrl: "https://sso.shd-technology.co.th/api/v1/sso/verify",
  sessionUrl: "https://sso.shd-technology.co.th/api/v1/sso/session",
};

export const STATE_COOKIE = "os_state";
export const DEFAULT_AFTER_LOGIN = "/jobs/dashboard";

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
