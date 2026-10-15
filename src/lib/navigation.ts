import { allowUnload, hasUnsavedChanges } from '@/lib/use-unsaved-changes';

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
  if (typeof window === 'undefined') return;
  allowUnload(); // the app decided — an unsaved form can't be saved without the session anyway
  window.location.assign(new URL(path, window.location.origin).href);
}

/** AccessGuard shows the "session expired — your data is still here" dialog on this window event */
export const SESSION_EXPIRED_EVENT = 'shd:session-expired';

/** the session is gone but this page must stay (a save failed, or a form holds typed data): ask the
 *  user to sign in again in a NEW tab — the cookie is shared, so saving here works again after */
export function sessionExpired() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

/** session expired → our /login with the "expired" note, back to this exact page (filters included) after.
 *  A form with unsaved edits is never thrown away for it: the dialog instead (sessionExpired). */
export function toLogin() {
  if (typeof window === 'undefined') return;
  if (hasUnsavedChanges()) return sessionExpired();
  const here = window.location.pathname + window.location.search;
  hardNavigate(`/login?expired=1&next=${encodeURIComponent(here)}`);
}
