/**
 * Full page loads — for the few moments the app must start clean instead of routing client-side
 * (in-app links use <Link> / router.push):
 *  - the session is gone → /login (drops every cached list / form of the old session)
 *  - a new role or approval → reload so the server hands out the new permissions
 *
 * Never send a signed-out visitor straight to /api/sso/login: an app URL that auto-forwards to a
 * Google sign-in is what phishing kits do (Google Web Risk flagged the site for it, 2026-09-18).
 * The /login page's button is the only way into SSO.
 */
export function hardNavigate(path: string) {
  if (typeof window === "undefined") return;
  window.location.assign(new URL(path, window.location.origin).href);
}

/** session expired → our /login with the "expired" note, back to this exact page (filters included) after */
export function toLogin() {
  if (typeof window === "undefined") return;
  const here = window.location.pathname + window.location.search;
  hardNavigate(`/login?expired=1&next=${encodeURIComponent(here)}`);
}
